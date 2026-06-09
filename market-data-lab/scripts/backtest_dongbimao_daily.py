from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import polars as pl

from common import data_path, load_env, parse_date, write_parquet


@dataclass
class Metrics:
    total_return: float
    cagr: float
    volatility: float
    sharpe: float
    max_drawdown: float
    win_rate: float
    avg_daily_return: float
    avg_positions: float
    avg_turnover: float


def year_files(root: Path, start: date, end: date) -> list[str]:
    files = []
    for path in root.glob("*.parquet"):
        if path.name.startswith("._"):
            continue
        year = int(path.stem.rsplit("_", 1)[-1])
        if start.year - 1 <= year <= end.year:
            files.append(str(path))
    return sorted(files)


def load_data(start: date, end: date, warmup_days: int) -> pd.DataFrame:
    scan_start = start - timedelta(days=warmup_days)
    daily_root = data_path("processed", "polygon", "stocks_split_adjusted", "1d")
    universe_root = data_path("features", "polygon", "universe", "daily_tradable_universe_by_year")
    daily_files = year_files(daily_root, scan_start, end)
    universe_files = year_files(universe_root, scan_start, end)
    if not daily_files or not universe_files:
        raise SystemExit("Missing daily adjusted or universe parquet files.")

    daily = (
        pl.scan_parquet(daily_files)
        .filter((pl.col("trade_date") >= scan_start) & (pl.col("trade_date") <= end))
        .select(["symbol", "trade_date", "adj_open", "adj_high", "adj_low", "adj_close", "adj_volume"])
    )
    universe = (
        pl.scan_parquet(universe_files)
        .filter((pl.col("trade_date") >= scan_start) & (pl.col("trade_date") <= end))
        .select(["symbol", "trade_date", "tradable_core"])
    )
    df = daily.join(universe, on=["symbol", "trade_date"], how="inner").collect(engine="streaming")
    out = df.to_pandas().sort_values(["symbol", "trade_date"]).reset_index(drop=True)
    out["trade_date"] = pd.to_datetime(out["trade_date"]).dt.date
    return out


def add_signals(df: pd.DataFrame, ema_span: int) -> pd.DataFrame:
    df = df.copy()
    grouped = df.groupby("symbol", sort=False)
    df["ema_high"] = grouped["adj_high"].transform(lambda s: s.ewm(span=ema_span, adjust=False).mean())
    df["ema_low"] = grouped["adj_low"].transform(lambda s: s.ewm(span=ema_span, adjust=False).mean())
    df["prev_close"] = grouped["adj_close"].shift(1)
    df["prev_ema_high"] = grouped["ema_high"].shift(1)
    df["prev_ema_low"] = grouped["ema_low"].shift(1)

    cross_high = ((df["adj_close"] > df["ema_high"]) & (df["prev_close"] <= df["prev_ema_high"])) | (
        (df["adj_close"] < df["ema_high"]) & (df["prev_close"] >= df["prev_ema_high"])
    )
    cross_low = ((df["adj_close"] > df["ema_low"]) & (df["prev_close"] <= df["prev_ema_low"])) | (
        (df["adj_close"] < df["ema_low"]) & (df["prev_close"] >= df["prev_ema_low"])
    )
    df["bullish"] = cross_high & (df["prev_close"] < df["adj_close"]) & df["tradable_core"].fillna(False)
    df["bearish"] = cross_low & (df["prev_close"] > df["adj_close"]) & df["tradable_core"].fillna(False)
    return df


def add_forward_returns(df: pd.DataFrame, horizons: list[int]) -> pd.DataFrame:
    grouped = df.groupby("symbol", sort=False)
    df = df.copy()
    df["next_open"] = grouped["adj_open"].shift(-1)
    df["ret_next_open"] = grouped["adj_open"].shift(-1) / df["adj_open"] - 1.0
    for horizon in horizons:
        df[f"fwd_open_ret_{horizon}d"] = grouped["adj_open"].shift(-(horizon + 1)) / grouped["adj_open"].shift(-1) - 1.0
    return df


def make_positions(df: pd.DataFrame, mode: str) -> pd.Series:
    raw = pd.Series(np.nan, index=df.index, dtype="float64")
    if mode == "long_short":
        raw.loc[df["bullish"]] = 1.0
        raw.loc[df["bearish"]] = -1.0
    elif mode == "long_only":
        raw.loc[df["bullish"]] = 1.0
        raw.loc[df["bearish"]] = 0.0
    else:
        raise ValueError(mode)
    target = raw.groupby(df["symbol"], sort=False).ffill().fillna(0.0)
    position = target.groupby(df["symbol"], sort=False).shift(1).fillna(0.0)
    position = position.where(df["tradable_core"].fillna(False), 0.0)
    return position


def portfolio_returns(df: pd.DataFrame, mode: str, start: date, end: date, cost_bps: float) -> pd.DataFrame:
    work = df.copy()
    work["position"] = make_positions(work, mode)
    work = work[(work["trade_date"] >= start) & (work["trade_date"] <= end) & work["ret_next_open"].notna()].copy()
    work["active"] = work["position"].abs() > 0
    active_counts = work.groupby("trade_date")["active"].sum().rename("active_positions")
    work = work.join(active_counts, on="trade_date")
    work["weight"] = np.where(work["active_positions"] > 0, work["position"] / work["active_positions"], 0.0)
    work["prev_weight"] = work.groupby("symbol", sort=False)["weight"].shift(1).fillna(0.0)
    work["weighted_return"] = work["weight"] * work["ret_next_open"]
    work["turnover_component"] = (work["weight"] - work["prev_weight"]).abs()

    daily = work.groupby("trade_date", sort=True).agg(
        gross_return=("weighted_return", "sum"),
        active_positions=("active", "sum"),
        long_positions=("position", lambda x: (x > 0).sum()),
        short_positions=("position", lambda x: (x < 0).sum()),
        turnover=("turnover_component", "sum"),
    )
    all_dates = pd.Index(sorted(work["trade_date"].unique()), name="trade_date")
    daily = daily.reindex(all_dates).fillna(0.0)
    daily["cost"] = daily["turnover"] * cost_bps / 10_000.0
    daily["net_return"] = daily["gross_return"] - daily["cost"]
    daily["equity_gross"] = (1.0 + daily["gross_return"]).cumprod()
    daily["equity_net"] = (1.0 + daily["net_return"]).cumprod()
    daily["mode"] = mode
    return daily.reset_index()


def compute_metrics(daily: pd.DataFrame, return_col: str = "net_return") -> Metrics:
    returns = daily[return_col].fillna(0.0)
    equity = (1.0 + returns).cumprod()
    years = max(len(returns) / 252.0, 1e-9)
    total_return = equity.iloc[-1] - 1.0 if len(equity) else 0.0
    cagr = equity.iloc[-1] ** (1.0 / years) - 1.0 if len(equity) else 0.0
    volatility = returns.std(ddof=0) * np.sqrt(252)
    sharpe = (returns.mean() / returns.std(ddof=0) * np.sqrt(252)) if returns.std(ddof=0) > 0 else np.nan
    drawdown = equity / equity.cummax() - 1.0
    return Metrics(
        total_return=float(total_return),
        cagr=float(cagr),
        volatility=float(volatility),
        sharpe=float(sharpe),
        max_drawdown=float(drawdown.min()),
        win_rate=float((returns > 0).mean()),
        avg_daily_return=float(returns.mean()),
        avg_positions=float(daily["active_positions"].mean()),
        avg_turnover=float(daily["turnover"].mean()),
    )


def signal_stats(df: pd.DataFrame, start: date, end: date, horizons: list[int]) -> pd.DataFrame:
    rows = []
    sample = df[(df["trade_date"] >= start) & (df["trade_date"] <= end) & df["tradable_core"].fillna(False)]
    for signal_name, direction in [("bullish", 1.0), ("bearish", -1.0)]:
        signals = sample[sample[signal_name]].copy()
        for horizon in horizons:
            ret = signals[f"fwd_open_ret_{horizon}d"] * direction
            ret = ret.replace([np.inf, -np.inf], np.nan).dropna()
            rows.append(
                {
                    "signal": signal_name,
                    "horizon": f"{horizon}d",
                    "count": int(ret.shape[0]),
                    "mean": float(ret.mean()) if not ret.empty else np.nan,
                    "median": float(ret.median()) if not ret.empty else np.nan,
                    "win_rate": float((ret > 0).mean()) if not ret.empty else np.nan,
                    "p25": float(ret.quantile(0.25)) if not ret.empty else np.nan,
                    "p75": float(ret.quantile(0.75)) if not ret.empty else np.nan,
                }
            )
    return pd.DataFrame(rows)


def fmt_pct(value: float) -> str:
    return "n/a" if pd.isna(value) else f"{value:.2%}"


def fmt_num(value: float) -> str:
    return "n/a" if pd.isna(value) else f"{value:,.2f}"


def write_report(
    output_dir: Path,
    start: date,
    end: date,
    metrics: dict[str, Metrics],
    signal_summary: pd.DataFrame,
    cost_bps: float,
) -> None:
    lines = [
        "# Dongbimao Daily Backtest",
        "",
        f"- date_range: {start}..{end}",
        "- execution: signal confirmed at daily close, filled at next open",
        "- prices: Polygon split-adjusted daily OHLC",
        "- universe: `tradable_core` daily filter",
        f"- transaction_cost: {cost_bps:.2f} bps per one-way turnover",
        "",
        "## Portfolio Results",
        "",
        "| mode | total_return | CAGR | vol | Sharpe | max_drawdown | win_rate | avg_positions | avg_turnover |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for mode, m in metrics.items():
        lines.append(
            f"| {mode} | {fmt_pct(m.total_return)} | {fmt_pct(m.cagr)} | {fmt_pct(m.volatility)} | "
            f"{fmt_num(m.sharpe)} | {fmt_pct(m.max_drawdown)} | {fmt_pct(m.win_rate)} | "
            f"{m.avg_positions:,.0f} | {fmt_num(m.avg_turnover)} |"
        )

    lines.extend(
        [
            "",
            "## Signal Forward Returns",
            "",
            "| signal | horizon | count | mean | median | win_rate | p25 | p75 |",
            "|---|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for _, row in signal_summary.iterrows():
        lines.append(
            f"| {row['signal']} | {row['horizon']} | {int(row['count']):,} | {fmt_pct(row['mean'])} | "
            f"{fmt_pct(row['median'])} | {fmt_pct(row['win_rate'])} | {fmt_pct(row['p25'])} | {fmt_pct(row['p75'])} |"
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "dongbimao_daily_backtest.md").write_text("\n".join(lines) + "\n")


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2024-05-13")
    parser.add_argument("--end", default="2026-05-11")
    parser.add_argument("--ema-span", type=int, default=31)
    parser.add_argument("--cost-bps", type=float, default=5.0)
    parser.add_argument("--warmup-days", type=int, default=160)
    args = parser.parse_args()
    start = parse_date(args.start)
    end = parse_date(args.end)
    if not start or not end:
        raise SystemExit("Both --start and --end are required")

    output_dir = data_path("reports", "dongbimao_daily")
    df = load_data(start, end, args.warmup_days)
    df = add_signals(df, args.ema_span)
    df = add_forward_returns(df, [1, 5, 20])

    curves = []
    metrics = {}
    for mode in ["long_short", "long_only"]:
        daily = portfolio_returns(df, mode, start, end, args.cost_bps)
        curves.append(daily)
        metrics[mode] = compute_metrics(daily, "net_return")
    equity = pd.concat(curves, ignore_index=True)
    signal_summary = signal_stats(df, start, end, [1, 5, 20])

    output_dir.mkdir(parents=True, exist_ok=True)
    equity.to_csv(output_dir / "equity_curves.csv", index=False)
    signal_summary.to_csv(output_dir / "signal_forward_returns.csv", index=False)
    signals = df.loc[
        (df["trade_date"] >= start)
        & (df["trade_date"] <= end)
        & (df["tradable_core"].fillna(False))
        & (df["bullish"] | df["bearish"]),
        [
            "symbol",
            "trade_date",
            "bullish",
            "bearish",
            "adj_close",
            "ema_high",
            "ema_low",
            "fwd_open_ret_1d",
            "fwd_open_ret_5d",
            "fwd_open_ret_20d",
        ],
    ].copy()
    write_parquet(signals, output_dir / "signals.parquet")
    write_report(output_dir, start, end, metrics, signal_summary, args.cost_bps)
    print(output_dir / "dongbimao_daily_backtest.md")


if __name__ == "__main__":
    main()

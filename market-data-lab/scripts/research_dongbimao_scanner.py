from __future__ import annotations

import argparse
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import polars as pl

from backtest_dongbimao_daily import add_forward_returns, add_signals, load_data
from common import data_path, load_env, parse_date, write_parquet


def add_scanner_filters(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy().sort_values(["symbol", "trade_date"])
    grouped = df.groupby("symbol", sort=False)
    df["dollar_volume"] = df["adj_close"] * df["adj_volume"]
    df["ret_20d"] = grouped["adj_close"].pct_change(20)
    df["ret_60d"] = grouped["adj_close"].pct_change(60)
    df["vol_20d"] = grouped["adj_close"].pct_change().transform(lambda s: s.rolling(20, min_periods=10).std()) * np.sqrt(252)
    df["range_pct"] = (df["adj_high"] - df["adj_low"]) / df["adj_close"]
    df["adv20"] = grouped["dollar_volume"].transform(lambda s: s.rolling(20, min_periods=10).median())

    spy = (
        df[df["symbol"] == "SPY"][
            ["trade_date", "adj_close"]
        ]
        .rename(columns={"adj_close": "spy_close"})
        .sort_values("trade_date")
        .copy()
    )
    spy["spy_sma200"] = spy["spy_close"].rolling(200, min_periods=120).mean()
    spy["spy_ret20"] = spy["spy_close"].pct_change(20)
    spy["market_ok"] = (spy["spy_close"] > spy["spy_sma200"]) & (spy["spy_ret20"] > -0.03)
    df = df.merge(spy[["trade_date", "market_ok"]], on="trade_date", how="left")
    df["market_ok"] = df["market_ok"].fillna(False)

    df["rs_rank_60d"] = df.groupby("trade_date")["ret_60d"].rank(pct=True)
    df["rs_rank_20d"] = df.groupby("trade_date")["ret_20d"].rank(pct=True)

    df["filter_liquid"] = df["adv20"] >= 5_000_000
    df["filter_price"] = df["adj_close"] >= 5
    df["filter_strength"] = (df["rs_rank_60d"] >= 0.70) & (df["rs_rank_20d"] >= 0.55)
    df["filter_volatility"] = (df["vol_20d"] <= 1.20) & (df["range_pct"] <= 0.18)
    df["scanner_pass"] = (
        df["bullish"]
        & df["tradable_core"].fillna(False)
        & df["market_ok"]
        & df["filter_liquid"]
        & df["filter_price"]
        & df["filter_strength"]
        & df["filter_volatility"]
    )
    return df


def summarize_signals(df: pd.DataFrame, masks: dict[str, pd.Series], horizons: list[int]) -> pd.DataFrame:
    rows = []
    for name, mask in masks.items():
        signals = df[mask].copy()
        for horizon in horizons:
            ret = signals[f"fwd_open_ret_{horizon}d"].replace([np.inf, -np.inf], np.nan).dropna()
            rows.append(
                {
                    "bucket": name,
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


def top_daily_picks(df: pd.DataFrame, start: date, end: date, top_n: int) -> pd.DataFrame:
    signals = df[(df["trade_date"] >= start) & (df["trade_date"] <= end) & df["scanner_pass"]].copy()
    signals["score"] = (
        signals["rs_rank_60d"].fillna(0) * 0.45
        + signals["rs_rank_20d"].fillna(0) * 0.25
        + np.clip(signals["adv20"].fillna(0) / 50_000_000, 0, 1) * 0.15
        + (1 - np.clip(signals["vol_20d"].fillna(1), 0, 1.5) / 1.5) * 0.15
    )
    return (
        signals.sort_values(["trade_date", "score"], ascending=[True, False])
        .groupby("trade_date", as_index=False)
        .head(top_n)
    )


def fmt_pct(value: float) -> str:
    return "n/a" if pd.isna(value) else f"{value:.2%}"


def write_report(output_dir: Path, start: date, end: date, summary: pd.DataFrame, picks: pd.DataFrame) -> None:
    lines = [
        "# Dongbimao Scanner Research",
        "",
        f"- date_range: {start}..{end}",
        "- base signal: original bullish daily close signal",
        "- scanner filters: market trend, liquidity, price, relative strength, volatility/range",
        "- forward returns: next open entry, fixed holding window",
        "",
        "## Signal Quality",
        "",
        "| bucket | horizon | count | mean | median | win_rate | p25 | p75 |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for _, row in summary.iterrows():
        lines.append(
            f"| {row['bucket']} | {row['horizon']} | {int(row['count']):,} | {fmt_pct(row['mean'])} | "
            f"{fmt_pct(row['median'])} | {fmt_pct(row['win_rate'])} | {fmt_pct(row['p25'])} | {fmt_pct(row['p75'])} |"
        )

    recent = picks.sort_values("trade_date").tail(30)
    lines.extend(
        [
            "",
            "## Recent Picks",
            "",
            "| date | symbol | score | close | rs60 | rs20 | adv20 | vol20 |",
            "|---|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for _, row in recent.iterrows():
        lines.append(
            f"| {row['trade_date']} | {row['symbol']} | {row['score']:.3f} | {row['adj_close']:.2f} | "
            f"{row['rs_rank_60d']:.2f} | {row['rs_rank_20d']:.2f} | {row['adv20']:,.0f} | {fmt_pct(row['vol_20d'])} |"
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "dongbimao_scanner_research.md").write_text("\n".join(lines) + "\n")


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2024-05-13")
    parser.add_argument("--end", default="2026-05-11")
    parser.add_argument("--top-n", type=int, default=20)
    args = parser.parse_args()
    start = parse_date(args.start)
    end = parse_date(args.end)
    if not start or not end:
        raise SystemExit("Both --start and --end are required")

    df = load_data(start, end, warmup_days=260)
    df = add_signals(df, ema_span=31)
    df = add_forward_returns(df, [1, 5, 20])
    df = add_scanner_filters(df)
    sample = df[(df["trade_date"] >= start) & (df["trade_date"] <= end)]

    masks = {
        "base_bullish": sample["bullish"] & sample["tradable_core"].fillna(False),
        "scanner_pass": sample["scanner_pass"],
        "scanner_market_only": sample["bullish"] & sample["tradable_core"].fillna(False) & sample["market_ok"],
        "scanner_strength_liquid": sample["bullish"]
        & sample["tradable_core"].fillna(False)
        & sample["market_ok"]
        & sample["filter_liquid"]
        & sample["filter_price"]
        & sample["filter_strength"],
    }
    summary = summarize_signals(sample, masks, [1, 5, 20])
    picks = top_daily_picks(sample, start, end, args.top_n)

    output_dir = data_path("reports", "dongbimao_scanner")
    output_dir.mkdir(parents=True, exist_ok=True)
    summary.to_csv(output_dir / "scanner_signal_quality.csv", index=False)
    picks[
        [
            "trade_date",
            "symbol",
            "score",
            "adj_close",
            "rs_rank_60d",
            "rs_rank_20d",
            "adv20",
            "vol_20d",
            "fwd_open_ret_1d",
            "fwd_open_ret_5d",
            "fwd_open_ret_20d",
        ]
    ].to_csv(output_dir / "scanner_daily_picks.csv", index=False)
    write_parquet(picks, output_dir / "scanner_daily_picks.parquet")
    write_report(output_dir, start, end, summary, picks)
    print(output_dir / "dongbimao_scanner_research.md")


if __name__ == "__main__":
    main()

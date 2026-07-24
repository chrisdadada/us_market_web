#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from build_product_data import risk_for_indicator  # noqa: E402


DEFAULT_DATA_ROOT = Path("/Volumes/Extreme SSD/market-data-lab/data")
SERIES_IDS = [
    "VIXCLS",
    "DGS10",
    "DGS30",
    "DGS2",
    "T10Y2Y",
    "FEDFUNDS",
    "CPIAUCSL",
    "DTWEXBGS",
    "DCOILWTICO",
    "DCOILBRENTEU",
    "UNRATE",
    "BAMLH0A0HYM2",
]
MONTHLY_LAGS = {"CPIAUCSL": 45, "FEDFUNDS": 35, "UNRATE": 35}
HORIZONS = [5, 20, 60]
LABEL_ORDER = ["偏强", "中性", "防守"]


def load_fred_series(fred_dir: Path, series_id: str) -> pd.DataFrame:
    path = fred_dir / f"{series_id}.parquet"
    if not path.exists():
        raise FileNotFoundError(path)
    frame = pd.read_parquet(path, columns=["date", "value"])
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce").astype("datetime64[ns]")
    frame["value"] = pd.to_numeric(frame["value"], errors="coerce")
    frame = frame.dropna().sort_values("date").drop_duplicates("date", keep="last")
    if series_id == "CPIAUCSL":
        frame["value"] = frame["value"].pct_change(12) * 100
        frame = frame.dropna()
    frame["change"] = frame["value"].diff().fillna(0)
    frame["available_date"] = frame["date"] + pd.to_timedelta(MONTHLY_LAGS.get(series_id, 1), unit="D")
    frame["risk"] = [
        risk_for_indicator(series_id, value, change)[2]
        for value, change in zip(frame["value"], frame["change"], strict=True)
    ]
    return frame[["available_date", "risk"]]


def load_benchmark_prices(data_root: Path, start: str | None, end: str | None) -> pd.DataFrame:
    daily_dir = data_root / "processed" / "polygon" / "stocks_split_adjusted" / "1d"
    frames: list[pd.DataFrame] = []
    for path in sorted(daily_dir.glob("daily_split_adjusted_*.parquet")):
        frame = pd.read_parquet(
            path,
            columns=["symbol", "trade_date", "adj_close"],
            filters=[("symbol", "in", ["SPY", "QQQ"])],
        )
        frames.append(frame)
    if not frames:
        raise FileNotFoundError(f"No benchmark price files in {daily_dir}")
    prices = pd.concat(frames, ignore_index=True)
    prices["trade_date"] = pd.to_datetime(prices["trade_date"], errors="coerce").astype("datetime64[ns]")
    prices["adj_close"] = pd.to_numeric(prices["adj_close"], errors="coerce")
    prices = prices.dropna().drop_duplicates(["trade_date", "symbol"], keep="last")
    prices = prices.pivot(index="trade_date", columns="symbol", values="adj_close").sort_index()
    if start:
        prices = prices[prices.index >= pd.Timestamp(start)]
    if end:
        prices = prices[prices.index <= pd.Timestamp(end)]
    missing = {"SPY", "QQQ"} - set(prices.columns)
    if missing:
        raise ValueError(f"Missing benchmark prices: {', '.join(sorted(missing))}")
    return prices[["SPY", "QQQ"]].dropna()


def build_temperature_history(prices: pd.DataFrame, fred_dir: Path) -> pd.DataFrame:
    history = pd.DataFrame({"trade_date": prices.index}).sort_values("trade_date")
    history["trade_date"] = pd.to_datetime(history["trade_date"]).astype("datetime64[ns]")
    risk_columns: list[str] = []
    for series_id in SERIES_IDS:
        series = load_fred_series(fred_dir, series_id).sort_values("available_date")
        column = f"risk_{series_id}"
        series = series.rename(columns={"risk": column})
        history = pd.merge_asof(
            history,
            series,
            left_on="trade_date",
            right_on="available_date",
            direction="backward",
        ).drop(columns=["available_date"])
        risk_columns.append(column)
    history["indicator_count"] = history[risk_columns].notna().sum(axis=1)
    history["average_risk"] = history[risk_columns].mean(axis=1)
    history["score"] = (100 - history["average_risk"] * 28).clip(0, 100).round()
    history["label"] = np.select(
        [history["score"] >= 70, history["score"] >= 50],
        ["偏强", "中性"],
        default="防守",
    )
    return history.set_index("trade_date")


def add_forward_metrics(frame: pd.DataFrame, prices: pd.DataFrame) -> pd.DataFrame:
    out = frame.join(prices, how="inner")
    for symbol in ["SPY", "QQQ"]:
        close = out[symbol].to_numpy(dtype=float)
        for horizon in HORIZONS:
            returns = np.full(len(close), np.nan)
            drawdowns = np.full(len(close), np.nan)
            for index in range(len(close) - horizon):
                path = close[index + 1:index + horizon + 1] / close[index] - 1
                returns[index] = close[index + horizon] / close[index] - 1
                drawdowns[index] = float(np.min(path))
            out[f"{symbol}_{horizon}d_return"] = returns
            out[f"{symbol}_{horizon}d_drawdown"] = drawdowns
    return out


def add_candidate_v2(frame: pd.DataFrame) -> pd.DataFrame:
    out = frame.copy()
    trend_penalty = pd.Series(0.0, index=out.index)
    trend_ready = pd.Series(True, index=out.index)
    for symbol, short_penalty, long_penalty in [
        ("SPY", 12, 15),
        ("QQQ", 8, 10),
    ]:
        lagged = out[symbol].shift(1)
        ma50 = lagged.rolling(50, min_periods=50).mean()
        ma200 = lagged.rolling(200, min_periods=200).mean()
        above50 = lagged > ma50
        above200 = lagged > ma200
        out[f"v2_{symbol.lower()}_above_50"] = above50
        out[f"v2_{symbol.lower()}_above_200"] = above200
        trend_penalty += (~above50).astype(float) * short_penalty
        trend_penalty += (~above200).astype(float) * long_penalty
        trend_ready &= ma200.notna()

    stress = out[["risk_VIXCLS", "risk_BAMLH0A0HYM2"]].max(axis=1) / 3
    rates = out[["risk_DGS10", "risk_DGS30", "risk_DGS2"]].mean(axis=1) / 2
    oil = out[["risk_DCOILWTICO", "risk_DCOILBRENTEU"]].max(axis=1) / 2
    inflation = pd.concat([out["risk_CPIAUCSL"] / 2, oil], axis=1).mean(axis=1)
    growth = out[["risk_T10Y2Y", "risk_UNRATE"]].mean(axis=1) / 2
    dollar = out["risk_DTWEXBGS"] / 2
    macro_risk = (
        stress * 0.35
        + rates * 0.20
        + inflation * 0.15
        + growth * 0.15
        + dollar * 0.15
    )
    score = 100 - trend_penalty - macro_risk * 30
    extreme_stress = (
        out[["risk_VIXCLS", "risk_BAMLH0A0HYM2"]].max(axis=1).ge(3)
        & ~out["v2_spy_above_50"]
    )
    score = score.mask(extreme_stress, np.minimum(score, 49))
    score = score.where(trend_ready & macro_risk.notna()).clip(0, 100).round()
    out["v2_score"] = score
    out["v2_label"] = pd.Series(
        np.select([score >= 70, score >= 50], ["偏强", "中性"], default="防守"),
        index=out.index,
    ).where(score.notna())
    return out


def select_sample(
    frame: pd.DataFrame,
    min_indicators: int,
    label_column: str,
    period_start: str | None,
    period_end: str | None,
) -> pd.DataFrame:
    sample = frame[(frame["indicator_count"] >= min_indicators) & frame[label_column].notna()]
    if period_start:
        sample = sample[sample.index >= pd.Timestamp(period_start)]
    if period_end:
        sample = sample[sample.index <= pd.Timestamp(period_end)]
    return sample


def summarize_sample(
    frame: pd.DataFrame,
    sample_name: str,
    min_indicators: int,
    sampling: str,
    model: str,
    label_column: str,
    period: str,
    period_start: str | None,
    period_end: str | None,
) -> pd.DataFrame:
    sample = select_sample(frame, min_indicators, label_column, period_start, period_end)
    if sampling == "episode_start":
        sample = sample[sample[label_column] != sample[label_column].shift()]
    rows: list[dict[str, Any]] = []
    for symbol in ["SPY", "QQQ"]:
        for horizon in HORIZONS:
            return_column = f"{symbol}_{horizon}d_return"
            drawdown_column = f"{symbol}_{horizon}d_drawdown"
            for label in LABEL_ORDER:
                values = sample[sample[label_column] == label][[return_column, drawdown_column]].dropna()
                rows.append({
                    "model": model,
                    "period": period,
                    "sample": sample_name,
                    "min_indicators": min_indicators,
                    "sampling": sampling,
                    "benchmark": symbol,
                    "horizon_days": horizon,
                    "regime": label,
                    "count": int(len(values)),
                    "mean_return": values[return_column].mean(),
                    "median_return": values[return_column].median(),
                    "win_rate": (values[return_column] > 0).mean(),
                    "p10_return": values[return_column].quantile(0.1),
                    "average_drawdown": values[drawdown_column].mean(),
                    "drawdown_5pct_rate": (values[drawdown_column] <= -0.05).mean(),
                    "worst_drawdown": values[drawdown_column].min(),
                })
    return pd.DataFrame(rows)


def build_regime_summary(
    frame: pd.DataFrame,
    sample_name: str,
    min_indicators: int,
    model: str,
    label_column: str,
    score_column: str,
    period: str,
    period_start: str | None,
    period_end: str | None,
) -> pd.DataFrame:
    sample = select_sample(frame, min_indicators, label_column, period_start, period_end)
    rows = []
    for label in LABEL_ORDER:
        values = sample[sample[label_column] == label]
        starts = (sample[label_column] == label) & (sample[label_column].shift() != label)
        rows.append({
            "model": model,
            "period": period,
            "sample": sample_name,
            "min_indicators": min_indicators,
            "regime": label,
            "days": int(len(values)),
            "episodes": int(starts.sum()),
            "share": len(values) / len(sample) if len(sample) else np.nan,
            "average_score": values[score_column].mean(),
            "minimum_score": values[score_column].min(),
            "maximum_score": values[score_column].max(),
            "start": values.index.min().date().isoformat() if len(values) else "",
            "end": values.index.max().date().isoformat() if len(values) else "",
        })
    return pd.DataFrame(rows)


def serializable(value: Any) -> Any:
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return None if np.isnan(value) else float(value)
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    return value


def write_outputs(
    output_dir: Path,
    history: pd.DataFrame,
    summary: pd.DataFrame,
    regimes: pd.DataFrame,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    history.reset_index().to_csv(output_dir / "temperature_history.csv", index=False)
    summary.to_csv(output_dir / "forward_returns.csv", index=False)
    regimes.to_csv(output_dir / "regime_distribution.csv", index=False)
    report = {
        "method": {
            "v1_score": "round(clamp(100 - average_risk * 28, 0, 100))",
            "v2_score": (
                "100 - grouped_macro_risk * 30 - SPY/QQQ 50d/200d trend penalties; "
                "extreme VIX/credit stress caps score at 49 when SPY is below its 50d average"
            ),
            "v2_macro_weights": {
                "volatility_and_credit": 0.35,
                "rates": 0.20,
                "inflation_and_oil": 0.15,
                "curve_and_employment": 0.15,
                "dollar": 0.15,
            },
            "v2_trend_penalties": {
                "SPY_below_50d": 12,
                "SPY_below_200d": 15,
                "QQQ_below_50d": 8,
                "QQQ_below_200d": 10,
            },
            "labels": {"偏强": ">=70", "中性": "50-69", "防守": "<50"},
            "daily_release_lag_days": 1,
            "monthly_release_lag_days": MONTHLY_LAGS,
            "warnings": [
                "FRED values are latest revised observations, not point-in-time ALFRED vintages.",
                "Daily regime observations overlap across forward-return windows.",
                "The complete 12-indicator sample begins when BAMLH0A0HYM2 becomes available.",
            ],
        },
        "coverage": {
            "start": history.index.min().date().isoformat(),
            "end": history.index.max().date().isoformat(),
            "rows": int(len(history)),
            "first_12_indicator_date": (
                history[history["indicator_count"] == len(SERIES_IDS)].index.min().date().isoformat()
                if (history["indicator_count"] == len(SERIES_IDS)).any()
                else None
            ),
            "first_v2_date": (
                history[history["v2_label"].notna()].index.min().date().isoformat()
                if history["v2_label"].notna().any()
                else None
            ),
        },
        "regimes": [
            {key: serializable(value) for key, value in row.items()}
            for row in regimes.to_dict("records")
        ],
        "forward_returns": [
            {key: serializable(value) for key, value in row.items()}
            for row in summary.to_dict("records")
        ],
    }
    (output_dir / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Backtest the current market-temperature rules.")
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--start", default="2016-05-11")
    parser.add_argument("--end")
    args = parser.parse_args()

    output_dir = args.output_dir or args.data_root / "reports" / "market_temperature_backtest"
    prices = load_benchmark_prices(args.data_root, args.start, args.end)
    history = build_temperature_history(prices, args.data_root / "raw" / "fred")
    history = add_forward_metrics(history, prices)
    history = add_candidate_v2(history)
    samples = [
        ("长期可用指标", 11),
        ("完整12项", 12),
    ]
    models = [
        ("v1_current", "label", "score"),
        ("v2_candidate", "v2_label", "v2_score"),
    ]
    periods = [
        ("全部", args.start, args.end),
        ("训练期", args.start, "2021-12-31"),
        ("样本外", "2022-01-01", args.end),
    ]
    summary = pd.concat(
        [
            summarize_sample(
                history,
                name,
                minimum,
                sampling,
                model,
                label_column,
                period,
                period_start,
                period_end,
            )
            for name, minimum in samples
            for model, label_column, _ in models
            for period, period_start, period_end in periods
            for sampling in ["daily_overlapping", "episode_start"]
        ],
        ignore_index=True,
    )
    regimes = pd.concat(
        [
            build_regime_summary(
                history,
                name,
                minimum,
                model,
                label_column,
                score_column,
                period,
                period_start,
                period_end,
            )
            for name, minimum in samples
            for model, label_column, score_column in models
            for period, period_start, period_end in periods
        ],
        ignore_index=True,
    )
    write_outputs(output_dir, history, summary, regimes)
    print(f"wrote {output_dir}")
    print(regimes[regimes["period"] == "全部"].to_string(index=False))
    print(summary[
        (summary["period"] == "样本外")
        & (summary["sample"] == "长期可用指标")
        & (summary["sampling"] == "episode_start")
        & (summary["horizon_days"] == 20)
    ].to_string(index=False))


if __name__ == "__main__":
    main()

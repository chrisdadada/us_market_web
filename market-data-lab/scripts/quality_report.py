from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from common import ROOT, data_path, load_env, write_parquet


EXPECTED_RTH_BARS = {"1m": 390, "5m": 78, "15m": 26, "30m": 13, "60m": 7}


def inspect_file(path: Path, timeframe: str) -> tuple[list[str], pd.DataFrame]:
    df = pd.read_parquet(path)
    if df.empty:
        return [f"## {path.stem}", "", "empty file", ""], pd.DataFrame()

    if "datetime" in df.columns:
        dt = pd.to_datetime(df["datetime"])
    elif "timestamp_et" in df.columns:
        dt = pd.to_datetime(df["timestamp_et"])
    else:
        raise ValueError(f"{path} has neither datetime nor timestamp_et")
    df["dt"] = dt.dt.tz_localize(None) if getattr(dt.dt, "tz", None) else dt
    rth = df[(df["dt"].dt.time >= pd.Timestamp("09:30").time()) & (df["dt"].dt.time < pd.Timestamp("16:00").time())]
    counts = rth.groupby(["symbol", rth["dt"].dt.date]).size()
    expected = EXPECTED_RTH_BARS.get(timeframe)
    incomplete = counts[counts != expected] if expected else counts.iloc[0:0]
    timestamp_column = "datetime" if "datetime" in df.columns else "timestamp_et"
    duplicates = int(df.duplicated(["symbol", timestamp_column]).sum())
    price_columns = ["open", "high", "low", "close"]
    missing_price_rows = int(df[price_columns].isna().any(axis=1).sum())
    missing_volume_rows = int(df["volume"].isna().sum()) if "volume" in df.columns else 0
    missing_price_mask = df[price_columns].isna().any(axis=1)
    missing_volume_mask = df["volume"].isna() if "volume" in df.columns else pd.Series(False, index=df.index)
    ohlc_bad_mask = (
        (df["high"] < df["low"])
        | (df["open"] > df["high"])
        | (df["open"] < df["low"])
        | (df["close"] > df["high"])
        | (df["close"] < df["low"])
    )
    ohlc_bad = int(ohlc_bad_mask.sum())
    non_positive_mask = (df[price_columns] <= 0).any(axis=1)
    non_positive_prices = int(non_positive_mask.sum())
    negative_volume_mask = df["volume"] < 0 if "volume" in df.columns else pd.Series(False, index=df.index)
    negative_volume = int(negative_volume_mask.sum())
    synthetic_rate = None
    if "is_synthetic" in df.columns:
        synthetic_rate = float(df["is_synthetic"].fillna(False).mean())

    jump_rows = 0
    max_abs_return = np.nan
    jump_mask = pd.Series(False, index=df.index)
    return_series = pd.Series(np.nan, index=df.index, dtype="float64")
    if "close" in df.columns:
        ordered = df.sort_values(["symbol", "dt"])
        returns = ordered.groupby("symbol")["close"].pct_change()
        returns = returns.replace([np.inf, -np.inf], np.nan)
        return_series.loc[ordered.index] = returns.to_numpy()
        abs_returns = returns.abs()
        max_abs_return = float(abs_returns.max(skipna=True)) if not abs_returns.empty else np.nan
        jump_rows = int((abs_returns > 0.2).sum(skipna=True))
        jump_mask.loc[ordered.index] = (abs_returns > 0.2).fillna(False).to_numpy()

    volume_spike_rows = 0
    volume_spike_mask = pd.Series(False, index=df.index)
    volume_ratio = pd.Series(np.nan, index=df.index, dtype="float64")
    if "volume" in df.columns:
        ordered = df.sort_values(["symbol", "dt"])
        rolling_median = (
            ordered.groupby("symbol")["volume"]
            .rolling(60, min_periods=20)
            .median()
            .reset_index(level=0, drop=True)
        )
        volume = ordered["volume"].reset_index(drop=True)
        baseline = rolling_median.reset_index(drop=True)
        spike = (baseline > 0) & (volume > baseline * 50)
        volume_spike_rows = int(spike.sum())
        volume_spike_mask.loc[ordered.index] = spike.to_numpy()
        ratio = pd.Series(np.nan, index=ordered.index, dtype="float64")
        ratio.loc[ordered.index] = np.where(baseline > 0, volume / baseline, np.nan)
        volume_ratio.loc[ordered.index] = ratio.loc[ordered.index].to_numpy()

    lines = [
        f"## {path.stem}",
        "",
        f"- rows: {len(df):,}",
        f"- first: {df['dt'].min()}",
        f"- last: {df['dt'].max()}",
        f"- duplicate symbol/timestamp rows: {duplicates}",
        f"- missing price rows: {missing_price_rows}",
        f"- missing volume rows: {missing_volume_rows}",
        f"- OHLC logic error rows: {ohlc_bad}",
        f"- non-positive price rows: {non_positive_prices}",
        f"- negative volume rows: {negative_volume}",
        f"- >20% one-bar close jump rows: {jump_rows}",
        f"- max abs one-bar close return: {max_abs_return:.4f}" if not np.isnan(max_abs_return) else "- max abs one-bar close return: n/a",
        f"- volume spike rows vs 60-bar median: {volume_spike_rows}",
        f"- RTH symbol-days: {counts.shape[0]}",
    ]
    if synthetic_rate is not None:
        lines.append(f"- synthetic bar rate: {synthetic_rate:.4%}")
    if expected:
        lines.append(f"- expected RTH bars/day: {expected}")
        lines.append(f"- incomplete RTH symbol-days: {incomplete.shape[0]}")
        if not incomplete.empty:
            sample = ", ".join(f"{symbol}/{day}:{value}" for (symbol, day), value in incomplete.head(10).items())
            lines.append(f"- incomplete sample: {sample}")
    lines.append("")

    anomaly_masks = {
        "missing_price": missing_price_mask,
        "missing_volume": missing_volume_mask,
        "ohlc_logic": ohlc_bad_mask,
        "non_positive_price": non_positive_mask,
        "negative_volume": negative_volume_mask,
        "close_jump_gt_20pct": jump_mask,
        "volume_spike_gt_50x_60bar_median": volume_spike_mask,
    }
    anomaly_frames = []
    base_columns = [
        column
        for column in [
            "symbol",
            timestamp_column,
            "open",
            "high",
            "low",
            "close",
            "volume",
            "transactions",
            "session",
            "is_synthetic",
        ]
        if column in df.columns
    ]
    for anomaly_type, mask in anomaly_masks.items():
        rows = df.loc[mask, base_columns].copy()
        if rows.empty:
            continue
        rows["date_file"] = path.stem
        rows["anomaly_type"] = anomaly_type
        rows["close_return"] = return_series.loc[rows.index].to_numpy()
        rows["volume_ratio_vs_60bar_median"] = volume_ratio.loc[rows.index].to_numpy()
        anomaly_frames.append(rows)
    anomalies = pd.concat(anomaly_frames, ignore_index=True) if anomaly_frames else pd.DataFrame()
    return lines, anomalies


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=None)
    parser.add_argument("--timeframe", default="1m")
    args = parser.parse_args()

    input_dir = args.input or data_path("processed", "bars", "1m")
    files = sorted(file for file in input_dir.glob("*.parquet") if not file.name.startswith("."))
    if not files:
        raise SystemExit(f"No parquet files found in {input_dir}")

    report = ["# Market Data Quality Report", ""]
    anomaly_frames = []
    for file in files:
        lines, anomalies = inspect_file(file, args.timeframe)
        report.extend(lines)
        if not anomalies.empty:
            anomaly_frames.append(anomalies)

    out = data_path("reports", f"quality_{args.timeframe}.md")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(report))
    print(out)

    if anomaly_frames:
        anomaly_out = data_path("reports", f"quality_anomalies_{args.timeframe}.parquet")
        write_parquet(pd.concat(anomaly_frames, ignore_index=True), anomaly_out)
        print(anomaly_out)


if __name__ == "__main__":
    main()

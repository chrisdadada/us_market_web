from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from common import ROOT, data_path, load_env, write_parquet


TIMEFRAME_MINUTES = {"5m": 5, "15m": 15, "30m": 30, "60m": 60}


def aggregate_file(path: Path, timeframe: str) -> pd.DataFrame:
    minutes = TIMEFRAME_MINUTES[timeframe]
    df = pd.read_parquet(path)
    if df.empty:
        return df

    if "datetime" in df.columns:
        dt = pd.to_datetime(df["datetime"])
    elif "timestamp_et" in df.columns:
        dt = pd.to_datetime(df["timestamp_et"])
    else:
        raise ValueError(f"{path} has neither datetime nor timestamp_et")
    df["dt"] = dt.dt.tz_localize(None) if getattr(dt.dt, "tz", None) else dt
    df["date"] = df["dt"].dt.date
    session_anchor = pd.to_datetime(df["date"].astype(str) + " 09:30:00")
    offset = ((df["dt"] - session_anchor).dt.total_seconds() // 60).astype("int64")
    bucket = (offset // minutes) * minutes
    df["bucket_dt"] = session_anchor + pd.to_timedelta(bucket, unit="m")

    aggregations = {
        "open": ("open", "first"),
        "high": ("high", "max"),
        "low": ("low", "min"),
        "close": ("close", "last"),
        "volume": ("volume", "sum"),
        "source": ("source", "first"),
    }
    if "transactions" in df.columns:
        aggregations["transactions"] = ("transactions", "sum")
    if "is_synthetic" in df.columns:
        aggregations["synthetic_bars"] = ("is_synthetic", "sum")
        aggregations["bar_count"] = ("is_synthetic", "size")

    grouped = df.sort_values("dt").groupby(["symbol", "bucket_dt"], as_index=False)
    out = grouped.agg(**aggregations)
    out["timestamp_et"] = out["bucket_dt"].dt.strftime("%Y-%m-%d %H:%M:%S")
    out["timeframe"] = timeframe
    if "synthetic_bars" in out.columns:
        out["synthetic_rate"] = out["synthetic_bars"] / out["bar_count"]

    columns = [
        "symbol",
        "timestamp_et",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "transactions",
        "source",
        "timeframe",
        "synthetic_bars",
        "bar_count",
        "synthetic_rate",
    ]
    return out[[column for column in columns if column in out.columns]]


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=None)
    parser.add_argument("--timeframes", nargs="+", default=["5m", "15m", "30m", "60m"])
    args = parser.parse_args()

    input_dir = args.input or data_path("processed", "bars_rth", "1m")
    files = sorted(file for file in input_dir.glob("*.parquet") if not file.name.startswith("."))
    if not files:
        raise SystemExit(f"No parquet files found in {input_dir}")

    for timeframe in args.timeframes:
        out_dir = data_path("processed", "bars", timeframe)
        for file in files:
            print(f"aggregate {file.stem} -> {timeframe}")
            df = aggregate_file(file, timeframe)
            if not df.empty:
                write_parquet(df, out_dir / file.name)


if __name__ == "__main__":
    main()

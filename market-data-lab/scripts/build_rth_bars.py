from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from common import data_path, load_env, write_parquet


def iter_parquet_files(path: Path) -> list[Path]:
    return sorted(file for file in path.glob("*.parquet") if not file.name.startswith("."))


def add_session(df: pd.DataFrame) -> pd.DataFrame:
    dt = pd.to_datetime(df["timestamp_et"])
    if getattr(dt.dt, "tz", None) is not None:
        dt = dt.dt.tz_convert("America/New_York").dt.tz_localize(None)
    df = df.copy()
    df["dt"] = dt
    t = df["dt"].dt.time
    pre_start = pd.Timestamp("04:00").time()
    rth_start = pd.Timestamp("09:30").time()
    rth_end = pd.Timestamp("16:00").time()
    after_end = pd.Timestamp("20:00").time()
    df["session"] = "closed"
    df.loc[(t >= pre_start) & (t < rth_start), "session"] = "premarket"
    df.loc[(t >= rth_start) & (t < rth_end), "session"] = "rth"
    df.loc[(t >= rth_end) & (t < after_end), "session"] = "afterhours"
    return df


def complete_symbol_day(group: pd.DataFrame) -> pd.DataFrame:
    group = group.sort_values("dt").drop_duplicates("dt")
    symbol = group["symbol"].iloc[0]
    day = group["dt"].dt.date.iloc[0]
    start = pd.Timestamp(f"{day} 09:30:00")
    end = pd.Timestamp(f"{day} 15:59:00")
    index = pd.date_range(start, end, freq="1min")

    base = group.set_index("dt").reindex(index)
    base.index.name = "dt"
    base["symbol"] = symbol
    base["is_synthetic"] = base["close"].isna()

    for column in ["close", "open", "high", "low"]:
        base[column] = base[column].ffill().bfill()
    base["open"] = base["open"].fillna(base["close"])
    base["high"] = base["high"].fillna(base["close"])
    base["low"] = base["low"].fillna(base["close"])

    base["volume"] = base["volume"].fillna(0)
    if "transactions" in base.columns:
        base["transactions"] = base["transactions"].fillna(0)
    else:
        base["transactions"] = 0

    base["source"] = base["source"].ffill().bfill().fillna("polygon")
    base["timeframe"] = "1m"
    base["session"] = "rth"
    base["timestamp_et"] = base.index.strftime("%Y-%m-%d %H:%M:%S")
    return base.reset_index(drop=True)


def build_file(path: Path) -> pd.DataFrame:
    df = pd.read_parquet(path)
    if df.empty:
        return df
    df = add_session(df)
    rth = df[df["session"] == "rth"].copy()
    if rth.empty:
        return rth
    groups = []
    for _, group in rth.groupby(["symbol", rth["dt"].dt.date], sort=False):
        groups.append(complete_symbol_day(group))
    out = pd.concat(groups, ignore_index=True)
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
        "session",
        "is_synthetic",
    ]
    return out[columns].sort_values(["symbol", "timestamp_et"])


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    input_dir = args.input or data_path("processed", "bars", "1m")
    output_dir = args.output or data_path("processed", "bars_rth", "1m")

    files = iter_parquet_files(input_dir)
    if not files:
        raise SystemExit(f"No parquet files found in {input_dir}")
    for file in files:
        print(f"build rth {file.name}")
        df = build_file(file)
        if not df.empty:
            write_parquet(df, output_dir / file.name)


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
from datetime import date, datetime
from pathlib import Path

import pandas as pd
import polars as pl

from common import data_path, load_env, parse_date


def parse_file_date(path: Path) -> date:
    return datetime.strptime(path.name.removesuffix(".parquet"), "%Y-%m-%d").date()


def daily_paths(root: Path, start: date, end: date) -> list[str]:
    paths = []
    for path in root.glob("*/*/*.parquet"):
        if path.name.startswith("._"):
            continue
        day = parse_file_date(path)
        if start <= day <= end:
            paths.append(str(path))
    return sorted(paths)


def split_breakpoints() -> pl.DataFrame:
    splits = pd.read_parquet(data_path("raw", "polygon_rest", "splits.parquet"))
    splits = splits.rename(columns={"ticker": "symbol"})
    splits["execution_date"] = pd.to_datetime(splits["execution_date"]).dt.date
    splits["split_price_factor"] = splits["split_from"].astype(float) / splits["split_to"].astype(float)
    splits = splits.sort_values(["symbol", "execution_date", "id"])

    rows = []
    for symbol, group in splits.groupby("symbol", sort=False):
        ratios = group["split_price_factor"].to_list()
        dates = group["execution_date"].to_list()
        total = 1.0
        for ratio in ratios:
            total *= ratio
        rows.append(
            {
                "symbol": symbol,
                "effective_date": date(1900, 1, 1),
                "split_price_factor": total,
                "split_volume_factor": 1.0 / total if total else None,
                "breakpoint_type": "initial",
            }
        )
        future = total
        for event_date, ratio in zip(dates, ratios):
            future = future / ratio
            rows.append(
                {
                    "symbol": symbol,
                    "effective_date": event_date,
                    "split_price_factor": future,
                    "split_volume_factor": 1.0 / future if future else None,
                    "breakpoint_type": "split",
                }
            )
    return pl.DataFrame(rows).with_columns(pl.col("effective_date").cast(pl.Date))


def write_split_adjusted_daily(start: date, end: date, breakpoints: pl.DataFrame) -> None:
    daily_root = data_path("processed", "polygon", "stocks", "1d")
    output_root = data_path("processed", "polygon", "stocks_split_adjusted", "1d")
    bp = breakpoints.sort(["symbol", "effective_date"])
    for year in range(start.year, end.year + 1):
        year_start = max(start, date(year, 1, 1))
        year_end = min(end, date(year, 12, 31))
        paths = daily_paths(daily_root, year_start, year_end)
        if not paths:
            continue
        daily = pl.scan_parquet(paths).collect().sort(["symbol", "trade_date"])
        adjusted = (
            daily.join_asof(bp, left_on="trade_date", right_on="effective_date", by="symbol", strategy="backward")
            .with_columns(
                [
                    pl.col("split_price_factor").fill_null(1.0),
                    pl.col("split_volume_factor").fill_null(1.0),
                ]
            )
            .with_columns(
                [
                    (pl.col("open") * pl.col("split_price_factor")).alias("adj_open"),
                    (pl.col("high") * pl.col("split_price_factor")).alias("adj_high"),
                    (pl.col("low") * pl.col("split_price_factor")).alias("adj_low"),
                    (pl.col("close") * pl.col("split_price_factor")).alias("adj_close"),
                    (pl.col("volume") * pl.col("split_volume_factor")).alias("adj_volume"),
                ]
            )
            .sort(["trade_date", "symbol"])
        )
        output = output_root / f"daily_split_adjusted_{year}.parquet"
        output.parent.mkdir(parents=True, exist_ok=True)
        tmp = output.with_suffix(".parquet.tmp")
        adjusted.write_parquet(tmp, compression="zstd", statistics=True)
        tmp.replace(output)
        print(f"{output} rows={adjusted.height:,}", flush=True)


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2016-05-11")
    parser.add_argument("--end", default="2026-05-11")
    args = parser.parse_args()
    start = parse_date(args.start)
    end = parse_date(args.end)
    if not start or not end:
        raise SystemExit("Both --start and --end are required")

    bp = split_breakpoints()
    out = data_path("features", "polygon", "adjustments", "split_factor_breakpoints.parquet")
    out.parent.mkdir(parents=True, exist_ok=True)
    bp.write_parquet(out, compression="zstd", statistics=True)
    print(f"{out} rows={bp.height:,}")
    write_split_adjusted_daily(start, end, bp)


if __name__ == "__main__":
    main()

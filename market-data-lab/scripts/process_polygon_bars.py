from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import date, datetime
from pathlib import Path

import polars as pl

from common import data_path, env, load_env, parse_date


PRICE_COLUMNS = ["open", "high", "low", "close"]


def parse_file_date(path: Path) -> date:
    return datetime.strptime(path.name.removesuffix(".csv.gz").removesuffix(".parquet"), "%Y-%m-%d").date()


def month_path(root: Path, day: date) -> Path:
    return root / f"{day:%Y}" / f"{day:%m}" / f"{day:%Y-%m-%d}.parquet"


def iter_files(root: Path, start: date, end: date, suffix: str) -> list[Path]:
    files: list[Path] = []
    for path in root.glob(f"*/*/*{suffix}"):
        if path.name.startswith("._"):
            continue
        day = parse_file_date(path)
        if start <= day <= end:
            files.append(path)
    return sorted(files)


def read_symbol_filter(symbols_file: Path | None) -> list[str] | None:
    if not symbols_file:
        return None
    symbols: list[str] = []
    for raw in symbols_file.read_text().splitlines():
        line = raw.strip()
        if line and not line.startswith("#"):
            symbols.append(line.split()[0].upper())
    return symbols or None


def normalize_minute_expr(symbols: list[str] | None) -> pl.LazyFrame:
    scan = pl.scan_csv(SOURCE_FILE, infer_schema_length=0)
    lf = scan.rename({"ticker": "symbol"})
    if symbols:
        lf = lf.filter(pl.col("symbol").is_in(symbols))
    return (
        lf.with_columns(
            [
                pl.col("window_start").cast(pl.Int64),
                pl.col("volume").cast(pl.Float64),
                pl.col("open").cast(pl.Float64),
                pl.col("close").cast(pl.Float64),
                pl.col("high").cast(pl.Float64),
                pl.col("low").cast(pl.Float64),
                pl.col("transactions").cast(pl.Int64),
            ]
        )
        .with_columns(
            [
                pl.from_epoch("window_start", time_unit="ns").alias("timestamp_utc"),
                pl.from_epoch("window_start", time_unit="ns")
                .dt.replace_time_zone("UTC")
                .dt.convert_time_zone("America/New_York")
                .alias("timestamp_et"),
            ]
        )
        .with_columns(
            [
                pl.lit("polygon").alias("source"),
                pl.lit("1m").alias("timeframe"),
                pl.col("timestamp_et").dt.date().alias("trade_date"),
            ]
        )
        .select(
            [
                "symbol",
                "timestamp_utc",
                "timestamp_et",
                "trade_date",
                "open",
                "high",
                "low",
                "close",
                "volume",
                "transactions",
                "source",
                "timeframe",
            ]
        )
        .sort(["symbol", "timestamp_utc"])
    )


def normalize_daily_expr(symbols: list[str] | None) -> pl.LazyFrame:
    scan = pl.scan_csv(SOURCE_FILE, infer_schema_length=0)
    lf = scan.rename({"ticker": "symbol"})
    if symbols:
        lf = lf.filter(pl.col("symbol").is_in(symbols))
    return (
        lf.with_columns(
            [
                pl.col("window_start").cast(pl.Int64),
                pl.col("volume").cast(pl.Float64),
                pl.col("open").cast(pl.Float64),
                pl.col("close").cast(pl.Float64),
                pl.col("high").cast(pl.Float64),
                pl.col("low").cast(pl.Float64),
                pl.col("transactions").cast(pl.Int64),
            ]
        )
        .with_columns(
            [
                pl.from_epoch("window_start", time_unit="ns").alias("timestamp_utc"),
                pl.from_epoch("window_start", time_unit="ns").dt.date().alias("trade_date"),
                pl.lit("polygon").alias("source"),
                pl.lit("1d").alias("timeframe"),
            ]
        )
        .select(
            [
                "symbol",
                "timestamp_utc",
                "trade_date",
                "open",
                "high",
                "low",
                "close",
                "volume",
                "transactions",
                "source",
                "timeframe",
            ]
        )
        .sort(["symbol", "trade_date"])
    )


SOURCE_FILE = ""


def convert_one(
    raw_file: Path,
    output_root: Path,
    symbols: list[str] | None,
    overwrite: bool,
    timeframe: str,
) -> str:
    day = parse_file_date(raw_file)
    out = month_path(output_root, day)
    if out.exists() and out.stat().st_size > 0 and not overwrite:
        return f"exists {out}"
    out.parent.mkdir(parents=True, exist_ok=True)

    global SOURCE_FILE
    SOURCE_FILE = str(raw_file)
    lf = normalize_daily_expr(symbols) if timeframe == "1d" else normalize_minute_expr(symbols)
    df = lf.collect(engine="streaming")
    if df.is_empty():
        return f"empty {raw_file}"
    tmp = out.with_suffix(".parquet.tmp")
    df.write_parquet(tmp, compression="zstd", statistics=True)
    tmp.replace(out)
    return f"converted {timeframe} {raw_file.name} rows={df.height:,}"


def rth_filter_one(input_file: Path, output_root: Path, overwrite: bool) -> str:
    day = parse_file_date(input_file)
    out = month_path(output_root, day)
    if out.exists() and out.stat().st_size > 0 and not overwrite:
        return f"exists {out}"
    out.parent.mkdir(parents=True, exist_ok=True)

    lf = (
        pl.scan_parquet(input_file)
        .filter(
            (pl.col("timestamp_et").dt.time() >= datetime.strptime("09:30", "%H:%M").time())
            & (pl.col("timestamp_et").dt.time() < datetime.strptime("16:00", "%H:%M").time())
        )
        .with_columns([pl.lit("rth").alias("session")])
        .sort(["symbol", "timestamp_utc"])
    )
    df = lf.collect(engine="streaming")
    if df.is_empty():
        return f"empty {input_file}"
    tmp = out.with_suffix(".parquet.tmp")
    df.write_parquet(tmp, compression="zstd", statistics=True)
    tmp.replace(out)
    return f"rth {input_file.name} rows={df.height:,}"


def aggregate_one(input_file: Path, output_root: Path, timeframe: str, overwrite: bool) -> str:
    minutes = int(timeframe.removesuffix("m"))
    day = parse_file_date(input_file)
    out = month_path(output_root / timeframe, day)
    if out.exists() and out.stat().st_size > 0 and not overwrite:
        return f"exists {out}"
    out.parent.mkdir(parents=True, exist_ok=True)

    lf = (
        pl.scan_parquet(input_file)
        .with_columns(
            [
                (
                    pl.col("timestamp_et").dt.date().cast(pl.String)
                    + pl.lit(" 09:30:00")
                )
                .str.strptime(pl.Datetime, "%Y-%m-%d %H:%M:%S")
                .dt.replace_time_zone("America/New_York")
                .alias("session_start_et")
            ]
        )
        .with_columns(
            [
                (
                    (pl.col("timestamp_et") - pl.col("session_start_et")).dt.total_minutes()
                    // minutes
                    * minutes
                ).alias("bucket_offset_min")
            ]
        )
        .with_columns(
            [
                (pl.col("session_start_et") + pl.duration(minutes=pl.col("bucket_offset_min"))).alias(
                    "timestamp_et"
                )
            ]
        )
        .sort(["symbol", "timestamp_utc"])
        .group_by(["symbol", "timestamp_et"], maintain_order=True)
        .agg(
            [
                pl.col("timestamp_utc").first(),
                pl.col("trade_date").first(),
                pl.col("open").first(),
                pl.col("high").max(),
                pl.col("low").min(),
                pl.col("close").last(),
                pl.col("volume").sum(),
                pl.col("transactions").sum(),
                pl.col("source").first(),
                pl.lit(timeframe).alias("timeframe"),
                pl.len().alias("bar_count"),
            ]
        )
        .sort(["symbol", "timestamp_et"])
    )
    df = lf.collect(engine="streaming")
    if df.is_empty():
        return f"empty {input_file}"
    tmp = out.with_suffix(".parquet.tmp")
    df.write_parquet(tmp, compression="zstd", statistics=True)
    tmp.replace(out)
    return f"aggregate {input_file.name} -> {timeframe} rows={df.height:,}"


def run_parallel(tasks: list[tuple], workers: int) -> None:
    if workers <= 1:
        for fn, args in tasks:
            print(fn(*args), flush=True)
        return
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(fn, *args) for fn, args in tasks]
        for future in as_completed(futures):
            print(future.result(), flush=True)


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    convert = sub.add_parser("convert-1m")
    convert.add_argument("--start", default=env("INTRADAY_START", "2016-05-09"))
    convert.add_argument("--end", default=env("INTRADAY_END") or datetime.now().date().isoformat())
    convert.add_argument("--workers", type=int, default=4)
    convert.add_argument("--symbols", type=Path)
    convert.add_argument("--overwrite", action="store_true")

    convert_day = sub.add_parser("convert-1d")
    convert_day.add_argument("--start", default="2016-05-11")
    convert_day.add_argument("--end", default=env("DAILY_END") or datetime.now().date().isoformat())
    convert_day.add_argument("--workers", type=int, default=4)
    convert_day.add_argument("--symbols", type=Path)
    convert_day.add_argument("--overwrite", action="store_true")

    rth = sub.add_parser("build-rth")
    rth.add_argument("--start", default=env("INTRADAY_START", "2016-05-09"))
    rth.add_argument("--end", default=env("INTRADAY_END") or datetime.now().date().isoformat())
    rth.add_argument("--workers", type=int, default=4)
    rth.add_argument("--overwrite", action="store_true")

    aggregate = sub.add_parser("aggregate")
    aggregate.add_argument("--start", default=env("INTRADAY_START", "2016-05-09"))
    aggregate.add_argument("--end", default=env("INTRADAY_END") or datetime.now().date().isoformat())
    aggregate.add_argument("--timeframes", nargs="+", default=["5m", "15m", "30m", "60m"])
    aggregate.add_argument("--workers", type=int, default=4)
    aggregate.add_argument("--overwrite", action="store_true")

    args = parser.parse_args()
    start = parse_date(args.start)
    end = parse_date(args.end)
    if not start or not end:
        raise SystemExit("Both --start and --end are required")

    raw_root = data_path("raw", "polygon", env("POLYGON_STOCKS_MINUTE_PREFIX", "us_stocks_sip/minute_aggs_v1"))
    raw_day_root = data_path("raw", "polygon", "us_stocks_sip", "day_aggs_v1")
    processed_root = data_path("processed", "polygon", "stocks", "1m")
    processed_day_root = data_path("processed", "polygon", "stocks", "1d")
    rth_root = data_path("processed", "polygon", "stocks_rth", "1m")
    aggregate_root = data_path("processed", "polygon", "stocks_rth")

    if args.command == "convert-1m":
        symbols = read_symbol_filter(args.symbols)
        files = iter_files(raw_root, start, end, ".csv.gz")
        tasks = [(convert_one, (file, processed_root, symbols, args.overwrite, "1m")) for file in files]
        run_parallel(tasks, args.workers)
    elif args.command == "convert-1d":
        symbols = read_symbol_filter(args.symbols)
        files = iter_files(raw_day_root, start, end, ".csv.gz")
        tasks = [(convert_one, (file, processed_day_root, symbols, args.overwrite, "1d")) for file in files]
        run_parallel(tasks, args.workers)
    elif args.command == "build-rth":
        files = iter_files(processed_root, start, end, ".parquet")
        tasks = [(rth_filter_one, (file, rth_root, args.overwrite)) for file in files]
        run_parallel(tasks, args.workers)
    elif args.command == "aggregate":
        files = iter_files(rth_root, start, end, ".parquet")
        tasks = []
        for timeframe in args.timeframes:
            tasks.extend((aggregate_one, (file, aggregate_root, timeframe, args.overwrite)) for file in files)
        run_parallel(tasks, args.workers)


if __name__ == "__main__":
    main()

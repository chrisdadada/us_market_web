from __future__ import annotations

import argparse
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path
from typing import Iterable, Optional

import pandas_market_calendars as mcal
import pandas as pd

from common import data_path, env, load_env, parse_date, read_symbols, write_parquet


def require_boto3():
    try:
        import boto3
        from boto3.s3.transfer import TransferConfig
        from botocore.config import Config
        from botocore.exceptions import ClientError
    except ImportError as exc:
        raise SystemExit(
            "Missing boto3. Run: make install-data-deps"
        ) from exc
    return boto3, ClientError, Config, TransferConfig


def date_range(start: date, end: date) -> Iterable[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def trading_days(start: date, end: date, calendar_name: str) -> Iterable[date]:
    if calendar_name.lower() in {"all", "calendar"}:
        yield from date_range(start, end)
        return
    calendar = mcal.get_calendar(calendar_name)
    schedule = calendar.schedule(start_date=start, end_date=end)
    for session in schedule.index:
        yield pd.Timestamp(session).date()


def polygon_client():
    boto3, _, Config, _ = require_boto3()
    return boto3.client(
        "s3",
        endpoint_url=env("POLYGON_S3_ENDPOINT", "https://files.polygon.io"),
        aws_access_key_id=env("POLYGON_S3_ACCESS_KEY", required=True),
        aws_secret_access_key=env("POLYGON_S3_SECRET_KEY", required=True),
        config=Config(
            connect_timeout=int(env("POLYGON_S3_CONNECT_TIMEOUT", "10")),
            read_timeout=int(env("POLYGON_S3_READ_TIMEOUT", "120")),
            max_pool_connections=int(env("POLYGON_S3_MAX_POOL_CONNECTIONS", "32")),
            retries={"max_attempts": int(env("POLYGON_S3_MAX_ATTEMPTS", "5")), "mode": "standard"},
        ),
    )


def object_key(day: date, prefix: str) -> str:
    return f"{prefix}/{day:%Y}/{day:%m}/{day:%Y-%m-%d}.csv.gz"


def raw_path(day: date, prefix: str) -> Path:
    return data_path("raw", "polygon", prefix, f"{day:%Y}", f"{day:%m}", f"{day:%Y-%m-%d}.csv.gz")


def download_one(s3, bucket: str, prefix: str, day: date, client_error, transfer_config) -> str:
    key = object_key(day, prefix)
    target = raw_path(day, prefix)
    if target.exists() and target.stat().st_size > 0:
        return f"exists {target}"
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f"{target.name}.part.{os.getpid()}")
    if tmp.exists():
        tmp.unlink()
    try:
        s3.download_file(bucket, key, str(tmp), Config=transfer_config)
    except client_error as exc:
        if tmp.exists():
            tmp.unlink()
        code = exc.response.get("Error", {}).get("Code")
        if code in {"403", "404", "NoSuchKey"}:
            return f"skip missing {day}"
        raise
    if not tmp.exists() or tmp.stat().st_size <= 0:
        raise RuntimeError(f"downloaded empty file for s3://{bucket}/{key}")
    tmp.replace(target)
    return f"downloaded s3://{bucket}/{key}"


def download(start: date, end: date, workers: int, prefix: str, calendar_name: str) -> None:
    _, ClientError, _, TransferConfig = require_boto3()
    load_env()
    s3 = polygon_client()
    bucket = env("POLYGON_S3_BUCKET", "flatfiles", required=True)
    transfer_config = TransferConfig(max_concurrency=1, use_threads=False)

    days = list(trading_days(start, end, calendar_name))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(download_one, s3, bucket, prefix, day, ClientError, transfer_config) for day in days]
        for future in as_completed(futures):
            print(future.result(), flush=True)


def convert_file(path: Path, symbols: Optional[set[str]]) -> Optional[Path]:
    df = pd.read_csv(path, compression="gzip")
    if df.empty:
        return None
    df = df.rename(columns={"ticker": "symbol"})
    if symbols:
        df = df[df["symbol"].isin(symbols)]
    if df.empty:
        return None

    df["timestamp_utc"] = pd.to_datetime(df["window_start"], unit="ns", utc=True)
    df["timestamp_et"] = df["timestamp_utc"].dt.tz_convert("America/New_York")
    df["source"] = "polygon"
    df["timeframe"] = "1m"

    columns = [
        "symbol",
        "timestamp_utc",
        "timestamp_et",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "transactions",
        "source",
        "timeframe",
    ]
    for column in columns:
        if column not in df.columns:
            df[column] = pd.NA

    day = path.stem.replace(".csv", "")
    out = data_path("processed", "bars", "1m", f"{day}.parquet")
    write_parquet(df[columns].sort_values(["symbol", "timestamp_utc"]), out)
    return out


def convert(start: date, end: date, symbols_file: Optional[Path]) -> None:
    load_env()
    prefix = env("POLYGON_STOCKS_MINUTE_PREFIX", "us_stocks_sip/minute_aggs_v1", required=True)
    symbols = set(read_symbols(symbols_file)) if symbols_file else None
    for day in date_range(start, end):
        source = raw_path(day, prefix)
        if not source.exists():
            print(f"skip missing raw file {source}")
            continue
        day_name = source.stem.replace(".csv", "")
        out = data_path("processed", "bars", "1m", f"{day_name}.parquet")
        if out.exists() and out.stat().st_size > 0:
            print(f"exists {out}")
            continue
        print(f"convert {source}")
        converted = convert_file(source, symbols)
        if converted:
            print(converted)


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    for name in ["download", "convert"]:
        cmd = sub.add_parser(name)
        cmd.add_argument("--start", default=env("INTRADAY_START", "2024-01-02"))
        cmd.add_argument("--end", default=env("INTRADAY_END", "2024-01-05"))
        if name == "convert":
            cmd.add_argument("--symbols", type=Path)
        if name == "download":
            cmd.add_argument("--prefix", default=env("POLYGON_STOCKS_MINUTE_PREFIX", "us_stocks_sip/minute_aggs_v1"))
            cmd.add_argument("--calendar", default="NYSE")
            cmd.add_argument("--workers", type=int, default=int(env("POLYGON_DOWNLOAD_WORKERS", "4")))

    args = parser.parse_args()
    start = parse_date(args.start)
    end = parse_date(args.end)
    if not start or not end:
        raise SystemExit("Both --start and --end are required")

    if args.command == "download":
        download(start, end, args.workers, args.prefix, args.calendar)
    elif args.command == "convert":
        convert(start, end, args.symbols)


if __name__ == "__main__":
    main()

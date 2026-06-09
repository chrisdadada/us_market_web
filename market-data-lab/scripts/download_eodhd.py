from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path
from time import sleep

import pandas as pd
import requests

from common import (
    chunk_months,
    data_path,
    eodhd_symbol,
    env,
    load_env,
    parse_date,
    read_symbols,
    unix_seconds,
    write_parquet,
)


BASE_URL = "https://eodhistoricaldata.com/api"


def request_json(url: str, params: dict) -> list:
    response = requests.get(url, params=params, timeout=30)
    if response.status_code != 200:
        raise RuntimeError(f"{response.status_code} {response.text[:300]}")
    data = response.json()
    if isinstance(data, dict) and data.get("errors"):
        raise RuntimeError(str(data["errors"]))
    if isinstance(data, dict) and data.get("message"):
        raise RuntimeError(str(data["message"]))
    return data


def normalize_daily(symbol: str, rows: list) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["symbol"] = symbol
    df["source"] = "eodhd"
    df["timeframe"] = "1d"
    keep = [
        "symbol",
        "date",
        "open",
        "high",
        "low",
        "close",
        "adjusted_close",
        "volume",
        "source",
        "timeframe",
    ]
    for column in keep:
        if column not in df.columns:
            df[column] = pd.NA
    return df[keep].sort_values(["symbol", "date"])


def normalize_intraday(symbol: str, interval: str, rows: list) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    if "datetime" not in df.columns and "timestamp" in df.columns:
        df["datetime"] = pd.to_datetime(df["timestamp"], unit="s", utc=True).dt.strftime("%Y-%m-%d %H:%M:%S")
    df["symbol"] = symbol
    df["source"] = "eodhd"
    df["timeframe"] = interval
    keep = ["symbol", "datetime", "open", "high", "low", "close", "volume", "source", "timeframe"]
    for column in keep:
        if column not in df.columns:
            df[column] = pd.NA
    return df[keep].sort_values(["symbol", "datetime"])


def download_daily(symbols: list[str], start: date, end: date, api_key: str) -> None:
    out_dir = data_path("raw", "eodhd", "daily", "1d")
    for symbol in symbols:
        url = f"{BASE_URL}/eod/{eodhd_symbol(symbol)}"
        params = {
            "api_token": api_key,
            "fmt": "json",
            "period": "d",
            "from": start.isoformat(),
            "to": end.isoformat(),
        }
        print(f"daily {symbol} {start}..{end}")
        rows = request_json(url, params)
        df = normalize_daily(symbol, rows)
        if not df.empty:
            write_parquet(df, out_dir / f"{symbol}.parquet")
        sleep(0.2)


def download_intraday(symbols: list[str], interval: str, start: date, end: date, api_key: str) -> None:
    out_dir = data_path("raw", "eodhd", "intraday", interval)
    for symbol in symbols:
        frames = []
        for chunk_start, chunk_end in chunk_months(start, end):
            url = f"{BASE_URL}/intraday/{eodhd_symbol(symbol)}"
            params = {
                "api_token": api_key,
                "fmt": "json",
                "interval": interval,
                "from": unix_seconds(chunk_start),
                "to": unix_seconds(chunk_end, end_of_day=True),
            }
            print(f"intraday {interval} {symbol} {chunk_start}..{chunk_end}")
            rows = request_json(url, params)
            df = normalize_intraday(symbol, interval, rows)
            if not df.empty:
                frames.append(df)
            sleep(0.25)
        if frames:
            full = pd.concat(frames, ignore_index=True).drop_duplicates(["symbol", "datetime"])
            write_parquet(full.sort_values(["symbol", "datetime"]), out_dir / f"{symbol}.parquet")


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", choices=["daily", "intraday"])
    parser.add_argument("--symbols", type=Path, default=ROOT / "config" / "symbols_core.txt")
    parser.add_argument("--interval", default="1m", choices=["1m", "5m", "1h"])
    parser.add_argument("--start")
    parser.add_argument("--end")
    args = parser.parse_args()

    api_key = env("EODHD_API_KEY", required=True)
    today = date.today()
    symbols = read_symbols(args.symbols)

    if args.dataset == "daily":
        start = parse_date(args.start or env("DAILY_START"), date(2000, 1, 1))
        end = parse_date(args.end or env("DAILY_END"), today)
        download_daily(symbols, start, end, api_key)
    else:
        start = parse_date(args.start or env("INTRADAY_START"), date(2024, 1, 1))
        end = parse_date(args.end or env("INTRADAY_END"), today)
        download_intraday(symbols, args.interval, start, end, api_key)


if __name__ == "__main__":
    main()

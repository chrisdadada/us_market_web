from __future__ import annotations

import argparse
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pandas as pd
import requests

from common import data_path, env, load_env, write_parquet


BASE_URL = "https://data.nasdaq.com/api/v3/datatables/SHARADAR"


def parse_tables(raw: str) -> list[str]:
    return [item.strip().upper() for item in raw.replace(" ", "").split(",") if item.strip()]


def download_table(table: str, api_key: str, ticker: str | None = None) -> pd.DataFrame:
    params = {"api_key": api_key}
    if ticker:
        params["ticker"] = ticker.upper()
    url = f"{BASE_URL}/{table}.csv"
    response = requests.get(url, params=params, timeout=120)
    if response.status_code != 200:
        raise RuntimeError(f"{table}: {response.status_code} {response.text[:500]}")
    return pd.read_csv(BytesIO(response.content))


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--tables", default=env("SHARADAR_TABLES", "TICKERS,ACTIONS,SP500,SF1"))
    parser.add_argument("--ticker", help="Optional ticker filter for large tables such as SF1 or SEP.")
    args = parser.parse_args()

    api_key = env("NASDAQ_DATA_LINK_API_KEY", required=True)
    for table in parse_tables(args.tables):
        print(f"sharadar {table}")
        df = download_table(table, api_key, args.ticker)
        if df.empty:
            print(f"empty {table}")
            continue
        suffix = f"_{args.ticker.upper()}" if args.ticker else ""
        out = data_path("raw", "sharadar", f"{table}{suffix}.parquet")
        write_parquet(df, out)
        print(out)


if __name__ == "__main__":
    main()


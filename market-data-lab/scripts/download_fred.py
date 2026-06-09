from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path
from time import sleep

import pandas as pd
import requests

from common import ROOT, data_path, env, load_env, parse_date, read_series, write_parquet


URL = "https://api.stlouisfed.org/fred/series/observations"


def download_series(series_id: str, api_key: str, start: date, end: date) -> pd.DataFrame:
    params = {
        "series_id": series_id,
        "api_key": api_key,
        "file_type": "json",
        "observation_start": start.isoformat(),
        "observation_end": end.isoformat(),
    }
    response = requests.get(URL, params=params, timeout=30)
    if response.status_code != 200:
        raise RuntimeError(f"{series_id}: {response.status_code} {response.text[:300]}")
    rows = response.json().get("observations", [])
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["series_id"] = series_id
    df["value"] = pd.to_numeric(df["value"].replace(".", pd.NA), errors="coerce")
    return df[["series_id", "date", "value", "realtime_start", "realtime_end"]]


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--series", type=Path, default=ROOT / "config" / "fred_series.txt")
    parser.add_argument("--start")
    parser.add_argument("--end")
    args = parser.parse_args()

    api_key = env("FRED_API_KEY", required=True)
    start = parse_date(args.start or env("MACRO_START"), date(1990, 1, 1))
    end = parse_date(args.end or env("MACRO_END"), date.today())
    out_dir = data_path("raw", "fred")

    for series_id in read_series(args.series):
        print(f"fred {series_id} {start}..{end}")
        df = download_series(series_id, api_key, start, end)
        if not df.empty:
            write_parquet(df, out_dir / f"{series_id}.parquet")
        sleep(0.2)


if __name__ == "__main__":
    main()

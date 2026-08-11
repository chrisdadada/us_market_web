from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
from pathlib import Path
from time import sleep
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import pandas as pd
import requests

from common import ROOT, data_path, env, load_env, parse_date, public_url, read_symbols, write_parquet


BASE_URL = "https://api.polygon.io"


def with_api_key(url: str, api_key: str) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.setdefault("apiKey", api_key)
    return urlunparse(parsed._replace(query=urlencode(query)))


def get_json(session: requests.Session, url: str, params: dict, api_key: str) -> dict:
    response = session.get(with_api_key(url, api_key), params=params, timeout=90)
    if response.status_code != 200:
        raise RuntimeError(f"{public_url(url)}: {response.status_code} {response.text[:500]}")
    data = response.json()
    if data.get("status") in {"ERROR", "NOT_AUTHORIZED"}:
        raise RuntimeError(f"{public_url(url)}: {data}")
    return data


def year_ranges(start: date, end: date) -> list[tuple[date, date]]:
    ranges: list[tuple[date, date]] = []
    current = date(start.year, 1, 1)
    while current <= end:
        chunk_start = max(start, current)
        chunk_end = min(end, date(current.year, 12, 31))
        ranges.append((chunk_start, chunk_end))
        current = date(current.year + 1, 1, 1)
    return ranges


def paginate_contracts(
    session: requests.Session,
    api_key: str,
    underlying: str,
    start: date,
    end: date,
    expired: bool,
    pause: float,
) -> pd.DataFrame:
    url = f"{BASE_URL}/v3/reference/options/contracts"
    params = {
        "underlying_ticker": underlying,
        "expiration_date.gte": start.isoformat(),
        "expiration_date.lte": end.isoformat(),
        "expired": str(expired).lower(),
        "limit": 1000,
        "sort": "expiration_date",
        "order": "asc",
    }
    rows: list[dict] = []
    pages = 0
    while url:
        data = get_json(session, url, params, api_key)
        pages += 1
        rows.extend(data.get("results") or [])
        next_url = data.get("next_url")
        url = with_api_key(next_url, api_key) if next_url else ""
        params = {}
        if pause:
            sleep(pause)
    df = pd.DataFrame(rows)
    if not df.empty:
        df["query_underlying"] = underlying
        df["query_expired"] = expired
        df["downloaded_at_utc"] = datetime.now(timezone.utc).isoformat()
    print(
        f"{underlying} {start}..{end} expired={expired} pages={pages:,} rows={len(df):,}",
        flush=True,
    )
    return df


def out_path(underlying: str, start: date, end: date) -> Path:
    return data_path(
        "raw",
        "polygon_rest",
        "options_contracts",
        underlying,
        f"options_contracts_{underlying}_{start:%Y%m%d}_{end:%Y%m%d}.parquet",
    )


def download_underlying(
    session: requests.Session,
    api_key: str,
    underlying: str,
    start: date,
    end: date,
    pause: float,
    overwrite: bool,
) -> None:
    for chunk_start, chunk_end in year_ranges(start, end):
        path = out_path(underlying, chunk_start, chunk_end)
        marker = path.with_suffix(".empty")
        if not overwrite and (path.exists() or marker.exists()):
            print(f"skip {underlying} {chunk_start}..{chunk_end}", flush=True)
            continue

        frames = [
            paginate_contracts(session, api_key, underlying, chunk_start, chunk_end, True, pause),
            paginate_contracts(session, api_key, underlying, chunk_start, chunk_end, False, pause),
        ]
        df = pd.concat([frame for frame in frames if not frame.empty], ignore_index=True)
        if df.empty:
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.write_text(datetime.now(timezone.utc).isoformat() + "\n")
            continue

        df = df.drop_duplicates(subset=["ticker"]).sort_values(
            ["expiration_date", "strike_price", "contract_type", "ticker"]
        )
        df["source"] = "polygon"
        df["endpoint"] = "/v3/reference/options/contracts"
        write_parquet(df, path)
        print(f"saved {path} rows={len(df):,}", flush=True)


def write_report() -> Path:
    root = data_path("raw", "polygon_rest", "options_contracts")
    files = sorted(file for file in root.glob("*/*.parquet") if not file.name.startswith("._"))
    rows = 0
    underlyings: set[str] = set()
    min_exp = None
    max_exp = None
    for file in files:
        df = pd.read_parquet(file, columns=["query_underlying", "expiration_date"])
        rows += len(df)
        if len(df):
            underlyings.update(df["query_underlying"].dropna().astype(str).unique())
            lo = str(df["expiration_date"].min())
            hi = str(df["expiration_date"].max())
            min_exp = lo if min_exp is None else min(min_exp, lo)
            max_exp = hi if max_exp is None else max(max_exp, hi)

    report = data_path("reports", "polygon_options_contracts_inventory.md")
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(
        "\n".join(
            [
                "# Polygon Options Contracts Inventory",
                "",
                f"Generated at UTC: {datetime.now(timezone.utc).isoformat()}",
                "",
                f"- files: {len(files):,}",
                f"- rows: {rows:,}",
                f"- underlyings: {len(underlyings):,}",
                f"- expiration range: {min_exp or ''}..{max_exp or ''}",
            ]
        )
        + "\n"
    )
    print(report, flush=True)
    return report


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbols", type=Path, default=ROOT / "config" / "symbols_core.txt")
    parser.add_argument("--underlyings", default="", help="Comma-separated override, e.g. SPY,QQQ,IWM")
    parser.add_argument("--start", default="2024-01-01")
    parser.add_argument("--end", default="")
    parser.add_argument("--pause", type=float, default=0.02)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--report-only", action="store_true")
    args = parser.parse_args()

    start = parse_date(args.start, date(2024, 1, 1))
    end = parse_date(args.end, date.today())
    api_key = env("POLYGON_API_KEY", required=True)

    if not args.report_only:
        symbols = (
            [item.strip().upper() for item in args.underlyings.split(",") if item.strip()]
            if args.underlyings
            else read_symbols(args.symbols)
        )
        session = requests.Session()
        for symbol in symbols:
            download_underlying(session, api_key, symbol, start, end, args.pause, args.overwrite)

    write_report()


if __name__ == "__main__":
    main()

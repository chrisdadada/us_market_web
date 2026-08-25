from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
from pathlib import Path
from time import sleep
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import pandas as pd
import requests

from common import data_path, env, load_env, public_url, read_symbols, write_parquet


BASE_URL = "https://api.polygon.io"


def with_api_key(url: str, api_key: str) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.setdefault("apiKey", api_key)
    return urlunparse(parsed._replace(query=urlencode(query)))


def get_json(
    session: requests.Session,
    url: str,
    params: dict,
    api_key: str,
    *,
    max_retries: int = 5,
    retry_sleep: float = 5.0,
) -> dict:
    request_url = with_api_key(url, api_key)
    log_url = public_url(url)
    last_error: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            response = session.get(request_url, params=params, timeout=60)
            break
        except requests.RequestException as exc:
            last_error = exc
            if attempt >= max_retries:
                raise
            wait = retry_sleep * (attempt + 1)
            print(f"WARN: retrying {log_url} after {type(exc).__name__}: attempt={attempt + 1}/{max_retries} sleep={wait:.1f}s", flush=True)
            sleep(wait)
    else:
        raise RuntimeError(f"{log_url}: request failed") from last_error
    if response.status_code != 200:
        raise RuntimeError(f"{log_url}: {response.status_code} {response.text[:500]}")
    data = response.json()
    if data.get("status") == "ERROR":
        raise RuntimeError(f"{log_url}: {data}")
    return data


def paginate(session: requests.Session, path: str, params: dict, api_key: str, pause: float) -> pd.DataFrame:
    url = f"{BASE_URL}{path}"
    rows: list[dict] = []
    pages = 0
    while url:
        data = get_json(session, url, params, api_key)
        pages += 1
        results = data.get("results") or []
        if isinstance(results, dict):
            results = [results]
        rows.extend(results)
        if pages % 25 == 0:
            print(f"{path} pages={pages} rows={len(rows):,}", flush=True)
        next_url = data.get("next_url")
        url = with_api_key(next_url, api_key) if next_url else ""
        params = {}
        if pause:
            sleep(pause)
    return pd.DataFrame(rows)


def save(df: pd.DataFrame, name: str) -> Path | None:
    if df.empty:
        print(f"empty {name}", flush=True)
        return None
    df["downloaded_at_utc"] = datetime.now(timezone.utc).isoformat()
    out = data_path("raw", "polygon_rest", f"{name}.parquet")
    write_parquet(df, out)
    print(out, flush=True)
    return out


def save_under(df: pd.DataFrame, folder: str, name: str) -> Path | None:
    if df.empty:
        print(f"empty {folder}/{name}", flush=True)
        return None
    df["downloaded_at_utc"] = datetime.now(timezone.utc).isoformat()
    out = data_path("raw", "polygon_rest", folder, f"{name}.parquet")
    write_parquet(df, out)
    print(out, flush=True)
    return out


def year_ranges(start: date, end: date) -> list[tuple[date, date]]:
    ranges: list[tuple[date, date]] = []
    current = start
    while current <= end:
        chunk_end = min(date(current.year, 12, 31), end)
        ranges.append((current, chunk_end))
        current = date(current.year + 1, 1, 1)
    return ranges


def download_ticker_types(session: requests.Session, api_key: str, pause: float) -> None:
    df = paginate(session, "/v3/reference/tickers/types", {"asset_class": "stocks"}, api_key, pause)
    save(df, "ticker_types_stocks")


def download_tickers(session: requests.Session, api_key: str, pause: float, date: str | None) -> None:
    base = {"market": "stocks", "limit": 1000, "sort": "ticker"}
    if date:
        base["date"] = date
    for active in [True, False]:
        params = {**base, "active": str(active).lower()}
        suffix = "active" if active else "inactive"
        if date:
            suffix = f"{suffix}_{date}"
        df = paginate(session, "/v3/reference/tickers", params, api_key, pause)
        save(df, f"tickers_{suffix}")


def download_corporate_actions(
    session: requests.Session,
    api_key: str,
    pause: float,
    start: str | None,
    end: str | None,
) -> None:
    date_filters = {
        "splits": "execution_date",
        "dividends": "ex_dividend_date",
    }
    paths = {
        "splits": "/v3/reference/splits",
        "dividends": "/v3/reference/dividends",
    }
    for name, path in paths.items():
        date_field = date_filters[name]
        params = {"limit": 1000, "sort": date_field, "order": "asc"}
        if start:
            params[f"{date_field}.gte"] = start
        if end:
            params[f"{date_field}.lte"] = end
        df = paginate(session, path, params, api_key, pause)
        save(df, name)


def download_dividends_by_year(
    session: requests.Session,
    api_key: str,
    pause: float,
    start: str,
    end: str | None,
) -> None:
    start_day = datetime.strptime(start, "%Y-%m-%d").date()
    end_day = datetime.strptime(end, "%Y-%m-%d").date() if end else datetime.now().date()
    for chunk_start, chunk_end in year_ranges(start_day, end_day):
        params = {
            "limit": 1000,
            "sort": "ex_dividend_date",
            "order": "asc",
            "ex_dividend_date.gte": chunk_start.isoformat(),
            "ex_dividend_date.lte": chunk_end.isoformat(),
        }
        df = paginate(session, "/v3/reference/dividends", params, api_key, pause)
        save_under(df, "dividends_by_year", f"dividends_{chunk_start.year}")


def download_ticker_events(
    session: requests.Session,
    api_key: str,
    pause: float,
    symbols_file: Path,
    limit_symbols: int | None,
) -> None:
    rows: list[dict] = []
    symbols = read_symbols(symbols_file)
    if limit_symbols:
        symbols = symbols[:limit_symbols]
    for symbol in symbols:
        data = get_json(
            session,
            f"{BASE_URL}/vX/reference/tickers/{symbol}/events",
            {"types": "ticker_change"},
            api_key,
        )
        result = data.get("results") or {}
        events = result.get("events") or []
        for event in events:
            rows.append(
                {
                    "ticker_query": symbol,
                    "name": result.get("name"),
                    "cik": result.get("cik"),
                    "composite_figi": result.get("composite_figi"),
                    **event,
                }
            )
        if pause:
            sleep(pause)
    save(pd.DataFrame(rows), "ticker_events")


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--datasets",
        default="ticker_types,tickers,corporate_actions",
        help="Comma-separated: ticker_types,tickers,corporate_actions,dividends_by_year,ticker_events",
    )
    parser.add_argument("--date", help="Point-in-time date for tickers endpoint, YYYY-MM-DD.")
    parser.add_argument("--start", default="2016-05-09")
    parser.add_argument("--end", default="")
    parser.add_argument("--pause", type=float, default=0.05)
    parser.add_argument("--symbols", type=Path, default=Path("config/symbols_core.txt"))
    parser.add_argument("--limit-symbols", type=int)
    args = parser.parse_args()

    api_key = env("POLYGON_API_KEY", required=True)
    datasets = {item.strip() for item in args.datasets.split(",") if item.strip()}
    session = requests.Session()

    if "ticker_types" in datasets:
        download_ticker_types(session, api_key, args.pause)
    if "tickers" in datasets:
        download_tickers(session, api_key, args.pause, args.date)
    if "corporate_actions" in datasets:
        download_corporate_actions(session, api_key, args.pause, args.start, args.end or None)
    if "dividends_by_year" in datasets:
        download_dividends_by_year(session, api_key, args.pause, args.start, args.end or None)
    if "ticker_events" in datasets:
        download_ticker_events(session, api_key, args.pause, args.symbols, args.limit_symbols)


if __name__ == "__main__":
    main()

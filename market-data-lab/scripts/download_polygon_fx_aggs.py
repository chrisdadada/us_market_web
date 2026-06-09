from __future__ import annotations

import argparse
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from common import data_path, env, load_env, parse_date, write_parquet


BASE_URL = "https://api.polygon.io"


def polygon_symbol(symbol: str) -> str:
    symbol = symbol.upper().replace("/", "")
    if symbol.startswith("C:"):
        return symbol
    return f"C:{symbol}"


def safe_symbol(symbol: str) -> str:
    return polygon_symbol(symbol).replace(":", "_").replace("/", "")


def year_chunks(start: date, end: date) -> list[tuple[date, date]]:
    return [(date(year, 1, 1), date(year, 12, 31)) for year in range(start.year, end.year + 1)]


def clip_chunk(chunk: tuple[date, date], start: date, end: date) -> tuple[date, date]:
    chunk_start, chunk_end = chunk
    return max(chunk_start, start), min(chunk_end, end)


def request_json(session: requests.Session, url: str, params: dict[str, Any], pause: float) -> dict[str, Any]:
    while True:
        response = session.get(url, params=params, timeout=60)
        if response.status_code == 429:
            wait = float(response.headers.get("Retry-After") or max(pause, 2.0))
            print(f"rate limited; sleep {wait:.1f}s", flush=True)
            time.sleep(wait)
            continue
        if not response.ok:
            try:
                detail = response.json()
            except Exception:
                detail = {}
            message = detail.get("error") or detail.get("message") or response.reason
            raise RuntimeError(f"Polygon request failed: status={response.status_code} message={message}")
        return response.json()


def download_aggs(
    session: requests.Session,
    api_key: str,
    ticker: str,
    multiplier: int,
    timespan: str,
    start: date,
    end: date,
    pause: float,
) -> pd.DataFrame:
    url = f"{BASE_URL}/v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{start.isoformat()}/{end.isoformat()}"
    params: dict[str, Any] = {
        "adjusted": "true",
        "sort": "asc",
        "limit": 50000,
        "apiKey": api_key,
    }
    rows: list[dict[str, Any]] = []
    while url:
        payload = request_json(session, url, params, pause)
        rows.extend(payload.get("results") or [])
        next_url = payload.get("next_url")
        url = next_url if next_url else ""
        params = {"apiKey": api_key} if next_url else {}
        if pause:
            time.sleep(pause)

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df = df.rename(
        columns={
            "t": "timestamp_ms",
            "o": "open",
            "h": "high",
            "l": "low",
            "c": "close",
            "v": "volume",
            "vw": "vwap",
            "n": "transactions",
        }
    )
    df["symbol"] = ticker.replace("C:", "")
    df["polygon_ticker"] = ticker
    df["timestamp_utc"] = pd.to_datetime(df["timestamp_ms"], unit="ms", utc=True)
    df["timestamp_et"] = df["timestamp_utc"].dt.tz_convert("America/New_York")
    df["trade_date"] = df["timestamp_utc"].dt.date
    df["source"] = "polygon"
    df["timeframe"] = f"{multiplier}{timespan[0]}"
    df["downloaded_at_utc"] = datetime.now(timezone.utc).isoformat()

    columns = [
        "symbol",
        "polygon_ticker",
        "timestamp_utc",
        "timestamp_et",
        "trade_date",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "vwap",
        "transactions",
        "source",
        "timeframe",
        "downloaded_at_utc",
    ]
    for column in columns:
        if column not in df.columns:
            df[column] = pd.NA
    return df[columns].sort_values("timestamp_utc").drop_duplicates(subset=["symbol", "timestamp_utc"])


def write_report(symbol: str, outputs: list[Path], report_path: Path) -> None:
    lines = [
        "# Polygon FX / Metal Aggregates Inventory",
        "",
        f"- symbol: `{symbol}`",
        f"- generated_at_utc: {datetime.now(timezone.utc).isoformat()}",
        "",
        "| timeframe | file | rows | first | last |",
        "| --- | ---: | ---: | --- | --- |",
    ]
    for path in outputs:
        df = pd.read_parquet(path)
        timeframe = str(df["timeframe"].iloc[0]) if not df.empty else "--"
        first = str(df["timestamp_utc"].min()) if not df.empty else "--"
        last = str(df["timestamp_utc"].max()) if not df.empty else "--"
        lines.append(f"| {timeframe} | `{path}` | {len(df):,} | {first} | {last} |")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser(description="Download Polygon FX/metal aggregate bars such as XAUUSD.")
    parser.add_argument("--symbol", default="XAUUSD")
    parser.add_argument("--start", default="2016-01-01")
    parser.add_argument("--end", default=date.today().isoformat())
    parser.add_argument("--timeframes", default="5m,1d", help="Comma list. Supported: 5m,1d.")
    parser.add_argument("--pause", type=float, default=0.05)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    api_key = env("POLYGON_API_KEY", required=True)
    start = parse_date(args.start)
    end = parse_date(args.end)
    if not start or not end:
        raise SystemExit("Both --start and --end are required.")

    ticker = polygon_symbol(args.symbol)
    safe = safe_symbol(args.symbol)
    session = requests.Session()
    outputs: list[Path] = []

    for timeframe in [item.strip().lower() for item in args.timeframes.split(",") if item.strip()]:
        if timeframe == "5m":
            multiplier, timespan = 5, "minute"
        elif timeframe == "1d":
            multiplier, timespan = 1, "day"
        else:
            raise SystemExit(f"Unsupported timeframe: {timeframe}")

        out_dir = data_path("processed", "polygon", "fx", timeframe, safe)
        for raw_chunk in year_chunks(start, end):
            chunk_start, chunk_end = clip_chunk(raw_chunk, start, end)
            if chunk_start > chunk_end:
                continue
            out = out_dir / f"{safe}_{timeframe}_{chunk_start.year}.parquet"
            if out.exists() and out.stat().st_size > 0 and not args.overwrite:
                print(f"exists {out}", flush=True)
                outputs.append(out)
                continue
            print(f"download {ticker} {timeframe} {chunk_start}..{chunk_end}", flush=True)
            df = download_aggs(session, api_key, ticker, multiplier, timespan, chunk_start, chunk_end, args.pause)
            if df.empty:
                print(f"warn empty {ticker} {timeframe} {chunk_start.year}", flush=True)
                continue
            write_parquet(df, out)
            print(f"saved {out} rows={len(df):,}", flush=True)
            outputs.append(out)

    write_report(
        safe,
        sorted(set(outputs)),
        data_path("reports", "polygon_fx_aggs_inventory.md"),
    )


if __name__ == "__main__":
    main()

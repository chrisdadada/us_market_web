#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT: Path | None = None
DEFAULT_WATCHLIST = [
    "AAPL",
    "AMZN",
    "AMD",
    "AVGO",
    "GOOG",
    "GOOGL",
    "META",
    "MSFT",
    "MU",
    "NVDA",
    "TSLA",
    "TSM",
]


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download and merge upcoming earnings calendar rows from multiple providers.")
    parser.add_argument("--start", default=datetime.now(UTC).date().isoformat(), help="Start date, YYYY-MM-DD.")
    parser.add_argument("--end", default=None, help="End date, YYYY-MM-DD. Defaults to start + 90 days.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--watchlist", default=",".join(DEFAULT_WATCHLIST), help="Comma-separated symbols to warn on if missing.")
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--nasdaq-workers", type=int, default=8)
    parser.add_argument("--fmp-api-key", default=os.environ.get("FMP_API_KEY", ""))
    parser.add_argument(
        "--alpha-vantage-api-key",
        default=os.environ.get("ALPHA_VANTAGE_API_KEY") or os.environ.get("ALPHAVANTAGE_API_KEY", ""),
    )
    parser.add_argument("--finnhub-api-key", default=os.environ.get("FINNHUB_API_KEY", ""))
    return parser.parse_args()


def fetch_json(url: str, timeout: int) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": "dongbimao-earnings-calendar/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_text(url: str, timeout: int) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "dongbimao-earnings-calendar/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8")


def clean_symbol(value: Any) -> str:
    return str(value or "").upper().strip()


def clean_date(value: Any) -> str:
    return str(value or "").strip()[:10]


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def clean_number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def source_summary(row: dict[str, Any], source_name: str) -> str:
    details: list[str] = []
    eps = clean_number(
        row.get("epsEstimated")
        or row.get("epsEstimate")
        or row.get("estimate")
        or row.get("epsForecast")
        or row.get("epsEstimate")
    )
    revenue = clean_number(row.get("revenueEstimated") or row.get("revenueEstimate"))
    fiscal = row.get("fiscalDateEnding") or row.get("fiscalPeriod") or row.get("quarter") or row.get("fiscalQuarterEnding")
    if eps is not None:
        details.append(f"预估 EPS {eps:g}")
    if revenue is not None:
        details.append(f"预估收入 {revenue:g}")
    if fiscal:
        details.append(f"财期 {fiscal}")
    return "；".join(details) if details else f"财报日期来自 {source_name}。"


def make_event(source_name: str, row: dict[str, Any]) -> dict[str, Any] | None:
    symbol = clean_symbol(row.get("symbol") or row.get("ticker"))
    event_date = clean_date(row.get("date") or row.get("reportDate"))
    if not symbol or not event_date:
        return None
    company = clean_text(row.get("company") or row.get("companyName") or row.get("name") or symbol)
    event_time = clean_text(row.get("time") or row.get("hour") or row.get("when"))
    return {
        "date": event_date,
        "time": event_time,
        "symbol": symbol,
        "company": company,
        "title": f"{symbol} 财报",
        "type": "earnings",
        "impact": "medium",
        "sourceName": source_name,
        "relatedModules": ["财经日历", "股票库", "财报观察"],
        "relatedAssets": [symbol],
        "summary": f"{company}：{source_summary(row, source_name)}",
        "raw": row,
    }


def fetch_fmp(start: date, end: date, api_key: str, timeout: int) -> list[dict[str, Any]]:
    if not api_key:
        return []
    params = urllib.parse.urlencode({"from": start.isoformat(), "to": end.isoformat(), "apikey": api_key})
    rows = fetch_json(f"https://financialmodelingprep.com/stable/earnings-calendar?{params}", timeout)
    raw_rows = rows if isinstance(rows, list) else rows.get("data", []) if isinstance(rows, dict) else []
    return [event for row in raw_rows if isinstance(row, dict) for event in [make_event("Financial Modeling Prep", row)] if event]


def alpha_horizon(start: date, end: date) -> str:
    days = (end - start).days
    if days <= 92:
        return "3month"
    if days <= 184:
        return "6month"
    return "12month"


def fetch_alpha_vantage(start: date, end: date, api_key: str, timeout: int) -> list[dict[str, Any]]:
    if not api_key:
        return []
    params = urllib.parse.urlencode(
        {
            "function": "EARNINGS_CALENDAR",
            "horizon": alpha_horizon(start, end),
            "apikey": api_key,
        }
    )
    text = fetch_text(f"https://www.alphavantage.co/query?{params}", timeout)
    events: list[dict[str, Any]] = []
    for row in csv.DictReader(io.StringIO(text)):
        event = make_event("Alpha Vantage", row)
        if not event:
            continue
        try:
            event_date = date.fromisoformat(event["date"])
        except ValueError:
            continue
        if start <= event_date <= end:
            events.append(event)
    return events


def fetch_finnhub(start: date, end: date, api_key: str, timeout: int) -> list[dict[str, Any]]:
    if not api_key:
        return []
    params = urllib.parse.urlencode({"from": start.isoformat(), "to": end.isoformat(), "token": api_key})
    payload = fetch_json(f"https://finnhub.io/api/v1/calendar/earnings?{params}", timeout)
    raw_rows = payload.get("earningsCalendar", []) if isinstance(payload, dict) else payload if isinstance(payload, list) else []
    return [event for row in raw_rows if isinstance(row, dict) for event in [make_event("Finnhub", row)] if event]


def normalize_nasdaq_time(value: Any) -> str:
    text = clean_text(value).lower()
    if "after" in text:
        return "after market close"
    if "pre" in text or "before" in text:
        return "before market open"
    if "during" in text:
        return "during market hours"
    return clean_text(value)


def fetch_nasdaq_web_day(day: date, timeout: int) -> list[dict[str, Any]]:
    params = urllib.parse.urlencode({"date": day.isoformat()})
    url = f"https://api.nasdaq.com/api/calendar/earnings?{params}"
    payload = fetch_json(url, timeout)
    data = payload.get("data") if isinstance(payload, dict) else {}
    data = data if isinstance(data, dict) else {}
    rows = data.get("rows")
    rows = rows if isinstance(rows, list) else []
    events: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        normalized = {
            **row,
            "date": day.isoformat(),
            "company": row.get("name"),
            "time": normalize_nasdaq_time(row.get("time")),
        }
        event = make_event("Nasdaq Web", normalized)
        if event:
            events.append(event)
    return events


def fetch_nasdaq_web(start: date, end: date, timeout: int, workers: int) -> list[dict[str, Any]]:
    days: list[date] = []
    current = start
    while current <= end:
        days.append(current)
        current += timedelta(days=1)
    events: list[dict[str, Any]] = []
    max_workers = max(1, min(workers, 12))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(fetch_nasdaq_web_day, day, timeout): day for day in days}
        for future in as_completed(futures):
            day = futures[future]
            try:
                events.extend(future.result())
            except Exception as exc:
                print(f"WARN: Nasdaq web earnings fetch failed for {day.isoformat()}: {exc}", file=sys.stderr)
            time.sleep(0.02)
    return events


def merge_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_symbol_date: dict[tuple[str, str], dict[str, Any]] = {}
    for event in events:
        symbol = clean_symbol(event.get("symbol") or (event.get("relatedAssets") or [""])[0])
        event_date = clean_date(event.get("date"))
        if not symbol or not event_date:
            continue
        key = (symbol, event_date)
        existing = by_symbol_date.get(key)
        if not existing:
            event["sources"] = [event.get("sourceName")]
            event["confidence"] = "single-source"
            by_symbol_date[key] = event
            continue
        sources = [source for source in existing.get("sources", []) if source]
        source_name = event.get("sourceName")
        if source_name and source_name not in sources:
            sources.append(source_name)
        existing["sources"] = sources
        existing["confidence"] = "multi-source" if len(sources) > 1 else "single-source"
        if not existing.get("time") and event.get("time"):
            existing["time"] = event["time"]
    return sorted(by_symbol_date.values(), key=lambda row: (row["date"], row.get("time") or "", row["symbol"]))


def build_calendar_payload(
    start: date,
    end: date,
    *,
    watchlist: list[str] | None = None,
    timeout: int = 30,
    nasdaq_workers: int = 8,
    fmp_api_key: str = "",
    alpha_vantage_api_key: str = "",
    finnhub_api_key: str = "",
) -> dict[str, Any]:
    provider_events: dict[str, list[dict[str, Any]]] = {}
    errors: dict[str, str] = {}
    providers = [
        ("Nasdaq Web", lambda: fetch_nasdaq_web(start, end, timeout, nasdaq_workers), True),
        ("Financial Modeling Prep", lambda: fetch_fmp(start, end, fmp_api_key, timeout), bool(fmp_api_key)),
        ("Alpha Vantage", lambda: fetch_alpha_vantage(start, end, alpha_vantage_api_key, timeout), bool(alpha_vantage_api_key)),
        ("Finnhub", lambda: fetch_finnhub(start, end, finnhub_api_key, timeout), bool(finnhub_api_key)),
    ]
    for source_name, fetcher, configured in providers:
        if not configured:
            provider_events[source_name] = []
            continue
        try:
            provider_events[source_name] = fetcher()
        except Exception as exc:
            provider_events[source_name] = []
            errors[source_name] = str(exc)
    events = merge_events([event for rows in provider_events.values() for event in rows])
    watch = watchlist or []
    present = {clean_symbol(event.get("symbol")) for event in events}
    missing_watchlist = [symbol for symbol in watch if symbol not in present]
    return {
        "description": "Future earnings calendar merged from configured providers.",
        "updatedAt": utc_now(),
        "sourceName": "Multi-source earnings calendar",
        "windowStart": start.isoformat(),
        "windowEnd": end.isoformat(),
        "providerCounts": {source: len(rows) for source, rows in provider_events.items()},
        "providerErrors": errors,
        "missingWatchlist": missing_watchlist,
        "events": events,
    }


def main() -> int:
    args = parse_args()
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end) if args.end else start + timedelta(days=90)
    watchlist = [clean_symbol(symbol) for symbol in args.watchlist.split(",") if clean_symbol(symbol)]
    out = build_calendar_payload(
        start,
        end,
        watchlist=watchlist,
        timeout=args.timeout,
        nasdaq_workers=args.nasdaq_workers,
        fmp_api_key=args.fmp_api_key,
        alpha_vantage_api_key=args.alpha_vantage_api_key,
        finnhub_api_key=args.finnhub_api_key,
    )
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {len(out['events'])} earnings events to {args.output}")
    else:
        print(f"fetched {len(out['events'])} earnings events")
    print(f"providerCounts={out['providerCounts']}")
    if out["providerErrors"]:
        print(f"providerErrors={out['providerErrors']}", file=sys.stderr)
    if out["missingWatchlist"]:
        print(f"WARN: missing earnings dates for watchlist symbols: {', '.join(out['missingWatchlist'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / ".tmp" / "earnings-calendar.json"
FMP_ENDPOINT = "https://financialmodelingprep.com/stable/earnings-calendar"


def today_iso() -> str:
    return datetime.now(UTC).date().isoformat()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download future earnings calendar rows from Financial Modeling Prep.")
    parser.add_argument("--start", default=today_iso(), help="Start date, YYYY-MM-DD.")
    parser.add_argument("--end", default=None, help="End date, YYYY-MM-DD. Defaults to start + 90 days.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--api-key", default=os.environ.get("FMP_API_KEY", ""))
    parser.add_argument("--timeout", type=int, default=30)
    return parser.parse_args()


def normalize_event(row: dict[str, Any]) -> dict[str, Any] | None:
    symbol = str(row.get("symbol") or row.get("ticker") or "").upper().strip()
    event_date = str(row.get("date") or row.get("reportDate") or "").strip()
    if not symbol or not event_date:
        return None
    company = str(row.get("company") or row.get("companyName") or row.get("name") or symbol).strip()
    eps_estimate = row.get("epsEstimated", row.get("epsEstimate"))
    revenue_estimate = row.get("revenueEstimated", row.get("revenueEstimate"))
    details = []
    if eps_estimate not in (None, ""):
        details.append(f"预估 EPS {eps_estimate}")
    if revenue_estimate not in (None, ""):
        details.append(f"预估收入 {revenue_estimate}")
    fiscal = row.get("fiscalDateEnding") or row.get("fiscalPeriod")
    if fiscal:
        details.append(f"财期 {fiscal}")
    summary = "；".join(details) if details else "财报日期来自 Financial Modeling Prep earnings-calendar。"
    return {
        "date": event_date[:10],
        "time": str(row.get("time") or row.get("when") or "").strip(),
        "symbol": symbol,
        "company": company,
        "title": f"{symbol} 财报",
        "type": "earnings",
        "impact": "medium",
        "sourceName": "Financial Modeling Prep",
        "relatedModules": ["财经日历", "股票库", "财报观察"],
        "relatedAssets": [symbol],
        "summary": f"{company}：{summary}",
        "raw": row,
    }


def main() -> int:
    args = parse_args()
    if not args.api_key:
        print("warning: FMP_API_KEY is not configured; skipping FMP earnings calendar download", file=sys.stderr)
        return 0
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end) if args.end else start + timedelta(days=90)
    params = urllib.parse.urlencode({"from": start.isoformat(), "to": end.isoformat(), "apikey": args.api_key})
    url = f"{FMP_ENDPOINT}?{params}"
    request = urllib.request.Request(url, headers={"User-Agent": "dongbimao-data-refresh/1.0"})
    with urllib.request.urlopen(request, timeout=args.timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    rows = payload if isinstance(payload, list) else payload.get("data", []) if isinstance(payload, dict) else []
    events = [event for row in rows if isinstance(row, dict) for event in [normalize_event(row)] if event]
    out = {
        "description": "Future earnings calendar downloaded from Financial Modeling Prep.",
        "updatedAt": datetime.now(UTC).isoformat(),
        "sourceName": "Financial Modeling Prep",
        "windowStart": start.isoformat(),
        "windowEnd": end.isoformat(),
        "events": events,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(events)} FMP earnings events to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

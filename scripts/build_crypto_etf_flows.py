#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import time
import urllib.request
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


SOURCE_URL = "https://defillama.com/etfs"


class NextDataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.capture = False
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "script" and values.get("id") == "__NEXT_DATA__":
            self.capture = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self.capture:
            self.capture = False

    def handle_data(self, data: str) -> None:
        if self.capture:
            self.parts.append(data)


def fetch_page(timeout: int = 30, attempts: int = 4) -> str:
    request = urllib.request.Request(
        SOURCE_URL,
        headers={"User-Agent": "Mozilla/5.0 (compatible; DongbimaoData/1.0)"},
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read().decode("utf-8")
        except Exception as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"ETF source request failed after {attempts} attempts: {last_error}")


def parse_page_props(html: str) -> dict[str, Any]:
    parser = NextDataParser()
    parser.feed(html)
    if not parser.parts:
        raise ValueError("ETF source is missing __NEXT_DATA__")
    payload = json.loads("".join(parser.parts))
    page_props = payload.get("props", {}).get("pageProps")
    if not isinstance(page_props, dict):
        raise ValueError("ETF source pageProps is invalid")
    return page_props


def clean_flow(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def asset_summary(rows: list[dict[str, Any]], key: str) -> dict[str, Any]:
    history = [
        {"date": row["date"], "flowUsd": row[key]}
        for row in rows
        if row.get(key) is not None
    ]
    if len(history) < 21:
        raise ValueError(f"ETF source has fewer than 21 {key.upper()} observations")
    return {
        "latestDate": history[-1]["date"],
        "latestFlowUsd": history[-1]["flowUsd"],
        "flow5dUsd": sum(item["flowUsd"] for item in history[-5:]),
        "flow21dUsd": sum(item["flowUsd"] for item in history[-21:]),
        "history": history,
    }


def build_payload(page_props: dict[str, Any]) -> dict[str, Any]:
    raw_flows = page_props.get("flows")
    if not isinstance(raw_flows, dict):
        raise ValueError("ETF source flows are invalid")

    rows: list[dict[str, Any]] = []
    for raw_timestamp, raw_row in raw_flows.items():
        if not isinstance(raw_row, dict):
            continue
        try:
            timestamp = int(raw_row.get("date") or raw_timestamp)
            day = datetime.fromtimestamp(timestamp, UTC).date().isoformat()
        except (TypeError, ValueError, OverflowError):
            continue
        btc = clean_flow(raw_row.get("Bitcoin"))
        eth = clean_flow(raw_row.get("Ethereum"))
        if btc is None and eth is None:
            continue
        rows.append({"date": day, "btcFlowUsd": btc, "ethFlowUsd": eth})

    rows.sort(key=lambda row: row["date"])
    deduped = {row["date"]: row for row in rows}
    rows = [deduped[day] for day in sorted(deduped)]
    btc = asset_summary(rows, "btcFlowUsd")
    eth = asset_summary(rows, "ethFlowUsd")
    as_of = max(btc["latestDate"], eth["latestDate"])
    age_days = (datetime.now(UTC).date() - datetime.fromisoformat(as_of).date()).days
    if age_days < -1 or age_days > 10:
        raise ValueError(f"ETF source as-of date is not credible: {as_of}")

    history = [
        {
            **row,
            "totalFlowUsd": sum(value for value in (row["btcFlowUsd"], row["ethFlowUsd"]) if value is not None),
        }
        for row in rows
    ]
    return {
        "asOf": as_of,
        "generatedAt": datetime.now(UTC).isoformat(),
        "source": {
            "name": "DefiLlama (Farside)",
            "url": SOURCE_URL,
            "providerUpdatedAt": str(page_props.get("lastUpdated") or ""),
        },
        "assets": {"BTC": btc, "ETH": eth},
        "history": history,
    }


def fetch_payload(timeout: int = 30, attempts: int = 4) -> dict[str, Any]:
    return build_payload(parse_page_props(fetch_page(timeout, attempts)))


def main() -> None:
    parser = argparse.ArgumentParser(description="Build US spot BTC/ETH ETF flow payload.")
    parser.add_argument("--input", type=Path, help="Read a saved DefiLlama ETF page instead of downloading it.")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--attempts", type=int, default=4)
    args = parser.parse_args()
    html = args.input.read_text(encoding="utf-8") if args.input else fetch_page(args.timeout, args.attempts)
    payload = build_payload(parse_page_props(html))
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    main()

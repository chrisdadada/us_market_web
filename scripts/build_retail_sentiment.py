#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


CBOE_URL = "https://www.cboe.com/data/mktstat.aspx?dt={date}"
AAII_URL = "https://www.aaii.com/sentimentsurvey/sent_results?adv=yes"
FINRA_URL = "https://www.finra.org/rules-guidance/key-topics/margin-accounts/margin-statistics"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self.row: list[str] | None = None
        self.cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self.row = []
        elif tag in {"td", "th"} and self.row is not None:
            self.cell = []

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self.row is not None and self.cell is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.row:
                self.rows.append(self.row)
            self.row = None

    def handle_data(self, data: str) -> None:
        if self.cell is not None:
            self.cell.append(data)


def fetch_text(url: str, timeout: int = 30, attempts: int = 3) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                text = response.read().decode("utf-8")
                if "Pardon Our Interruption" in text:
                    raise RuntimeError("source returned an access challenge")
                return text
        except Exception as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(2**attempt)
    raise RuntimeError(f"source request failed after {attempts} attempts: {last_error}")


def table_rows(html: str) -> list[list[str]]:
    parser = TableParser()
    parser.feed(html)
    return parser.rows


def parse_percent(value: str) -> float:
    return float(value.replace("%", "").replace(",", "").strip())


def parse_cboe_ratio(html: str) -> float:
    match = re.search(r'EQUITY PUT/CALL RATIO\\",\\"value\\":\\"([0-9.]+)', html)
    if not match:
        raise ValueError("Cboe equity put/call ratio is missing")
    ratio = float(match.group(1))
    if not 0 < ratio < 10:
        raise ValueError("Cboe equity put/call ratio is outside the credible range")
    return ratio


def parse_aaii_history(html: str, today: date | None = None) -> list[dict[str, Any]]:
    today = today or datetime.now(UTC).date()
    history: list[dict[str, Any]] = []
    previous: date | None = None
    year = today.year
    for row in table_rows(html):
        if len(row) < 4 or not re.fullmatch(r"[A-Z][a-z]{2} \d{1,2}", row[0]):
            continue
        while True:
            reported = datetime.strptime(f"{row[0]} {year}", "%b %d %Y").date()
            if (previous and reported >= previous) or reported > today + timedelta(days=7):
                year -= 1
                continue
            break
        bullish, neutral, bearish = (parse_percent(value) for value in row[1:4])
        if not 99 <= bullish + neutral + bearish <= 101:
            raise ValueError(f"AAII percentages do not total 100 for {reported}")
        history.append(
            {
                "date": reported.isoformat(),
                "bullishPct": round(bullish, 1),
                "neutralPct": round(neutral, 1),
                "bearishPct": round(bearish, 1),
            }
        )
        previous = reported
    history.reverse()
    if len(history) < 4:
        raise ValueError("AAII source has fewer than 4 observations")
    return history


def parse_finra_history(html: str) -> list[dict[str, Any]]:
    history: list[dict[str, Any]] = []
    for row in table_rows(html):
        if len(row) < 2 or not re.fullmatch(r"[A-Z][a-z]{2}-\d{2}", row[0]):
            continue
        month = datetime.strptime(row[0], "%b-%y").strftime("%Y-%m")
        history.append({"date": month, "balanceUsdMillions": int(row[1].replace(",", ""))})
    history.reverse()
    if len(history) < 2:
        raise ValueError("FINRA source has fewer than 2 observations")
    return history


def fetch_cboe_history(today: date | None = None, timeout: int = 30, attempts: int = 3) -> list[dict[str, Any]]:
    today = today or datetime.now(UTC).date()
    candidates: list[date] = []
    cursor = today
    while len(candidates) < 12:
        if cursor.weekday() < 5:
            candidates.append(cursor)
        cursor -= timedelta(days=1)

    def fetch_day(day: date) -> dict[str, Any] | None:
        try:
            ratio = parse_cboe_ratio(fetch_text(CBOE_URL.format(date=day.isoformat()), timeout, attempts))
        except ValueError:
            return None
        return {
            "date": day.isoformat(),
            "putCallRatio": ratio,
            "callSharePct": round(100 / (1 + ratio), 1),
        }

    with ThreadPoolExecutor(max_workers=4) as executor:
        rows = [row for row in executor.map(fetch_day, candidates) if row]
    rows.sort(key=lambda row: row["date"])
    if len(rows) < 6:
        raise ValueError("Cboe source has fewer than 6 observations")
    return rows


def validate_freshness(
    options: list[dict[str, Any]], survey: list[dict[str, Any]], margin: list[dict[str, Any]], today: date
) -> None:
    options_age = (today - date.fromisoformat(options[-1]["date"])).days
    survey_age = (today - date.fromisoformat(survey[-1]["date"])).days
    margin_date = date.fromisoformat(f'{margin[-1]["date"]}-01')
    margin_age_months = (today.year - margin_date.year) * 12 + today.month - margin_date.month
    if not -1 <= options_age <= 10:
        raise ValueError(f"Cboe latest date is stale or invalid: {options[-1]['date']}")
    if not -1 <= survey_age <= 14:
        raise ValueError(f"AAII latest date is stale or invalid: {survey[-1]['date']}")
    if not 0 <= margin_age_months <= 3:
        raise ValueError(f"FINRA latest month is stale or invalid: {margin[-1]['date']}")


def build_payload(
    options_history: list[dict[str, Any]],
    survey_history: list[dict[str, Any]],
    margin_history: list[dict[str, Any]],
    today: date | None = None,
) -> dict[str, Any]:
    today = today or datetime.now(UTC).date()
    validate_freshness(options_history, survey_history, margin_history, today)
    latest_options = options_history[-1]
    previous_options = options_history[-2]
    latest_survey = survey_history[-1]
    latest_margin = margin_history[-1]
    previous_margin = margin_history[-2]
    margin_change = (
        (latest_margin["balanceUsdMillions"] / previous_margin["balanceUsdMillions"] - 1) * 100
    )
    return {
        "asOf": latest_options["date"],
        "generatedAt": datetime.now(UTC).isoformat(),
        "options": {
            **latest_options,
            "changePp": round(latest_options["callSharePct"] - previous_options["callSharePct"], 1),
            "history": options_history,
        },
        "survey": {
            **latest_survey,
            "spreadPp": round(latest_survey["bullishPct"] - latest_survey["bearishPct"], 1),
            "history": survey_history,
        },
        "margin": {
            **latest_margin,
            "changePct": round(margin_change, 1),
            "history": margin_history,
        },
    }


def fetch_payload(timeout: int = 30, attempts: int = 3) -> dict[str, Any]:
    today = datetime.now(UTC).date()
    options = fetch_cboe_history(today, timeout, attempts)
    survey = parse_aaii_history(fetch_text(AAII_URL, timeout, attempts), today)
    margin = parse_finra_history(fetch_text(FINRA_URL, timeout, attempts))
    return build_payload(options, survey, margin, today)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build official US retail-sentiment indicators.")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--attempts", type=int, default=3)
    args = parser.parse_args()
    text = json.dumps(fetch_payload(args.timeout, args.attempts), ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    main()

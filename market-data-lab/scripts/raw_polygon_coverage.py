from __future__ import annotations

import argparse
from collections import Counter
from datetime import date, datetime
from pathlib import Path

import pandas as pd
import pandas_market_calendars as mcal

from common import data_path, env, load_env


def parse_day(path: Path) -> date | None:
    name = path.name
    if not name.endswith(".csv.gz") or name.startswith("._"):
        return None
    try:
        return datetime.strptime(name.removesuffix(".csv.gz"), "%Y-%m-%d").date()
    except ValueError:
        return None


def scan_raw_dates(raw_root: Path) -> set[date]:
    dates: set[date] = set()
    for path in raw_root.glob("*/*/*.csv.gz"):
        day = parse_day(path)
        if day:
            dates.add(day)
    return dates


def trading_days(start: date, end: date) -> list[date]:
    calendar = mcal.get_calendar("NYSE")
    sessions = calendar.schedule(start_date=start, end_date=end).index
    return [pd.Timestamp(session).date() for session in sessions]


def month_key(day: date) -> str:
    return f"{day:%Y-%m}"


def build_report(actual_dates: set[date], start: date, end: date, raw_root: Path) -> str:
    expected_dates = set(trading_days(start, end))
    in_range_actual = {day for day in actual_dates if start <= day <= end}
    missing = sorted(expected_dates - in_range_actual)
    non_trading_files = sorted(in_range_actual - expected_dates)

    expected_months = Counter(month_key(day) for day in expected_dates)
    actual_months = Counter(month_key(day) for day in in_range_actual if day in expected_dates)
    missing_months = Counter(month_key(day) for day in missing)
    extra_months = Counter(month_key(day) for day in non_trading_files)
    months = sorted(set(expected_months) | set(actual_months) | set(missing_months) | set(extra_months))

    lines = [
        "# Raw Polygon Minute Coverage",
        "",
        f"- raw_root: `{raw_root}`",
        f"- coverage_start: {start}",
        f"- coverage_end: {end}",
        f"- raw_files_total: {len(actual_dates):,}",
        f"- expected_trading_days: {len(expected_dates):,}",
        f"- downloaded_trading_days: {len(in_range_actual & expected_dates):,}",
        f"- missing_trading_days: {len(missing):,}",
        f"- non_trading_day_files: {len(non_trading_files):,}",
        "",
    ]

    if missing:
        lines.extend(["## Missing Trading Days", ""])
        lines.extend(f"- {day}" for day in missing)
        lines.append("")

    if non_trading_files:
        lines.extend(["## Non-Trading Day Files", ""])
        lines.extend(f"- {day}" for day in non_trading_files)
        lines.append("")

    lines.extend(
        [
            "## Monthly Coverage",
            "",
            "| month | expected | downloaded | missing | non_trading_files |",
            "|---|---:|---:|---:|---:|",
        ]
    )
    for month in months:
        lines.append(
            f"| {month} | {expected_months[month]} | {actual_months[month]} | "
            f"{missing_months[month]} | {extra_months[month]} |"
        )
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--start")
    parser.add_argument("--end")
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--prefix",
        default=env("POLYGON_STOCKS_MINUTE_PREFIX", "us_stocks_sip/minute_aggs_v1"),
    )
    args = parser.parse_args()

    raw_root = data_path("raw", "polygon", args.prefix)
    actual_dates = scan_raw_dates(raw_root)
    if not actual_dates:
        raise SystemExit(f"No raw Polygon files found in {raw_root}")

    start = datetime.strptime(args.start, "%Y-%m-%d").date() if args.start else min(actual_dates)
    end = datetime.strptime(args.end, "%Y-%m-%d").date() if args.end else max(actual_dates)
    report = build_report(actual_dates, start, end, raw_root)

    output = args.output or data_path("reports", "raw_polygon_minute_coverage.md")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(report)
    print(output)


if __name__ == "__main__":
    main()

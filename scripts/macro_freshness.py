#!/usr/bin/env python3
from __future__ import annotations

from datetime import date, timedelta


MONTHLY_KEYS = {"fedfunds", "cpiaucsl", "unrate"}
DAILY_STALE_AFTER_BUSINESS_DAYS = 2
MONTHLY_STALE_AFTER_MONTHS = 2


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def business_day_lag(value: date, reference: date) -> int:
    lag = 0
    cursor = value
    while cursor < reference:
        cursor += timedelta(days=1)
        if cursor.weekday() < 5:
            lag += 1
    return lag


def freshness_fields(key: str, as_of: str | None, reference_as_of: str | None) -> dict[str, object]:
    value = parse_date(as_of)
    reference = parse_date(reference_as_of)
    monthly = key.lower() in MONTHLY_KEYS
    if not value or not reference:
        return {"frequency": "monthly" if monthly else "daily", "stale": True, "includedInScore": False}
    if monthly:
        lag = max(0, (reference.year - value.year) * 12 + reference.month - value.month)
        stale = lag > MONTHLY_STALE_AFTER_MONTHS
        return {
            "frequency": "monthly",
            "displayPeriod": value.strftime("%Y-%m"),
            "sourceLagMonths": lag,
            "stale": stale,
            "includedInScore": not stale,
        }
    lag = business_day_lag(value, reference)
    stale = lag > DAILY_STALE_AFTER_BUSINESS_DAYS
    return {
        "frequency": "daily",
        "displayPeriod": value.isoformat(),
        "sourceLagBusinessDays": lag,
        "stale": stale,
        "includedInScore": not stale,
    }


def self_test() -> None:
    assert business_day_lag(date(2026, 8, 6), date(2026, 8, 7)) == 1
    assert business_day_lag(date(2026, 8, 7), date(2026, 8, 10)) == 1
    assert freshness_fields("DXY", "2026-07-31", "2026-08-07")["stale"] is True
    assert freshness_fields("CPIAUCSL", "2026-06-01", "2026-08-07")["stale"] is False


if __name__ == "__main__":
    self_test()

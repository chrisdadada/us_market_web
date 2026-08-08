#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sqlite3
from datetime import date
from pathlib import Path

from macro_freshness import MONTHLY_KEYS, freshness_fields, parse_date

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "product.db"
def derive_market_asof(conn: sqlite3.Connection):
    row = conn.execute("SELECT MAX(trade_date) FROM market_board_rows").fetchone()
    return parse_date(row[0] if row else None)


def freshness_rows(db_path: Path) -> tuple[date | None, list[dict[str, object]]]:
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        market_asof = derive_market_asof(conn)
        rows = []
        for row in conn.execute(
            """
            SELECT indicator_key, name, as_of
            FROM market_temperature_indicators
            ORDER BY
              CASE WHEN indicator_key IN ('fedfunds', 'cpiaucsl', 'unrate') THEN 1 ELSE 0 END,
              indicator_key
            """
        ):
            as_of = parse_date(row["as_of"])
            rows.append(
                {
                    "key": row["indicator_key"],
                    "name": row["name"],
                    "asOf": as_of,
                    "cadence": "monthly" if row["indicator_key"] in MONTHLY_KEYS else "daily",
                    **freshness_fields(row["indicator_key"], row["as_of"], market_asof.isoformat() if market_asof else None),
                }
            )
    return market_asof, rows


def print_report(db_path: Path) -> None:
    market_asof, rows = freshness_rows(db_path)
    print("Macro indicator freshness")
    print(f"  db: {db_path}")
    print(f"  market asof: {market_asof or '--'}")
    daily = [row for row in rows if row["cadence"] == "daily"]
    monthly = [row for row in rows if row["cadence"] == "monthly"]
    current = [row for row in daily if not row["stale"]]
    lagging = [row for row in daily if row["stale"]]
    print(f"  daily indicators: {len(current)} current, {len(lagging)} source-lagged")
    for row in daily:
        lag = row.get("sourceLagBusinessDays")
        status = "current" if not row["stale"] else f"source-lag {lag} business days"
        print(f"    {row['name']}: {row['asOf'] or '--'} ({status})")
    print(f"  monthly indicators: {len(monthly)} normal monthly cadence")
    for row in monthly:
        print(f"    {row['name']}: {row['asOf'] or '--'} (monthly)")


def self_test() -> None:
    assert parse_date("2026-07-31T00:00:00Z") is not None
    assert parse_date("") is None


def main() -> None:
    parser = argparse.ArgumentParser(description="Report macro indicator source freshness in product.db.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not args.db.exists():
        raise SystemExit(f"Product DB not found: {args.db}")
    print_report(args.db)


if __name__ == "__main__":
    main()

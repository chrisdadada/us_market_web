#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "product.db"


def query_one(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> int:
    return int(conn.execute(sql, params).fetchone()[0])


def query_rows(conn: sqlite3.Connection, sql: str) -> list[dict[str, Any]]:
    conn.row_factory = sqlite3.Row
    return [dict(row) for row in conn.execute(sql).fetchall()]


def dataset_payload(conn: sqlite3.Connection, table: str, name: str) -> dict[str, Any]:
    if table not in {"datasets", "raw_payloads"}:
        raise ValueError(f"unsupported payload table: {table}")
    row = conn.execute(f"SELECT payload_json FROM {table} WHERE name = ?", (name,)).fetchone()
    if not row:
        return {}
    try:
        return json.loads(row[0])
    except (TypeError, json.JSONDecodeError):
        return {}


def build_report(db_path: Path) -> dict[str, Any]:
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        symbols = {
            "total": query_one(conn, "SELECT COUNT(*) FROM symbols"),
            "liquid": query_one(conn, "SELECT COUNT(*) FROM symbols WHERE COALESCE(latest_dollar_volume, 0) >= 5000000"),
            "unknownSector": query_one(
                conn,
                """
                SELECT COUNT(*)
                FROM symbols
                WHERE sector IS NULL OR sector = '' OR sector IN ('未分类', '板块待补', '--')
                """,
            ),
            "marketCapMissing": query_one(conn, "SELECT COUNT(*) FROM symbols WHERE market_cap_value IS NULL"),
            "eventLinked": query_one(conn, "SELECT COUNT(DISTINCT symbol) FROM stock_event_rows"),
            "earningsLinked": query_one(conn, "SELECT COUNT(DISTINCT symbol) FROM earnings_quality_rows"),
        }
        market_boards = query_rows(
            conn,
            """
            SELECT board,
                   COUNT(*) AS rows,
                   COUNT(DISTINCT symbol) AS symbols,
                   SUM(CASE WHEN sector IS NULL OR sector = '' OR sector IN ('未分类', '板块待补', '--') THEN 1 ELSE 0 END) AS unknownSector,
                   SUM(CASE WHEN market_cap_value IS NULL THEN 1 ELSE 0 END) AS marketCapMissing
            FROM market_board_rows
            GROUP BY board
            ORDER BY board
            """,
        )
        calendar = query_rows(
            conn,
            """
            SELECT COALESCE(event_type, 'unknown') AS type, COUNT(*) AS rows
            FROM calendar_events
            GROUP BY COALESCE(event_type, 'unknown')
            ORDER BY type
            """,
        )
        options = query_rows(
            conn,
            """
            SELECT board, COUNT(*) AS rows
            FROM options_flow_rows
            GROUP BY board
            ORDER BY board
            """,
        )
        datasets = query_rows(
            conn,
            """
            SELECT name, row_count AS rowCount, as_of AS asOf, generated_at AS generatedAt
            FROM datasets
            ORDER BY name
            """,
        )
        dataset_valuation_payload = dataset_payload(conn, "datasets", "index-valuation")
        valuation_payload = dataset_payload(conn, "raw_payloads", "index-valuation")
        qqq = next(
            (
                item
                for item in valuation_payload.get("indices") or []
                if (item.get("index") or {}).get("symbol") == "QQQ"
            ),
            valuation_payload,
        )
        forward = qqq.get("forwardValuation") or {}
    total = max(1, symbols["total"])
    return {
        "db": str(db_path),
        "symbols": symbols,
        "ratios": {
            "unknownSectorPct": round(symbols["unknownSector"] / total * 100, 2),
            "marketCapMissingPct": round(symbols["marketCapMissing"] / total * 100, 2),
        },
        "marketBoards": market_boards,
        "calendar": calendar,
        "options": options,
        "datasets": datasets,
        "indexValuation": {
            "forwardAsOf": forward.get("asOf"),
            "forwardHistoryRows": len(forward.get("history") or []),
            "hasFiveYearRange": "5y" in (forward.get("ranges") or {}),
            "payloadsMatch": valuation_payload == dataset_valuation_payload,
        },
    }


def validate(report: dict[str, Any], args: argparse.Namespace) -> tuple[list[str], list[str]]:
    failures: list[str] = []
    warnings: list[str] = []
    symbols = report["symbols"]
    ratios = report["ratios"]
    if symbols["total"] < args.min_symbols:
        failures.append(f"symbols total {symbols['total']} < {args.min_symbols}")
    if symbols["liquid"] < args.min_liquid_symbols:
        failures.append(f"liquid symbols {symbols['liquid']} < {args.min_liquid_symbols}")
    if ratios["unknownSectorPct"] > args.max_unknown_sector_pct:
        failures.append(f"unknown sector {ratios['unknownSectorPct']}% > {args.max_unknown_sector_pct}%")
    if ratios["marketCapMissingPct"] > args.max_market_cap_missing_pct:
        failures.append(f"market cap missing {ratios['marketCapMissingPct']}% > {args.max_market_cap_missing_pct}%")
    for board in report["marketBoards"]:
        if int(board["rows"] or 0) < args.min_board_rows:
            failures.append(f"{board['board']} board rows {board['rows']} < {args.min_board_rows}")
    calendar_counts = {row["type"]: int(row["rows"] or 0) for row in report["calendar"]}
    if calendar_counts.get("macro", 0) < args.min_macro_events:
        failures.append(f"macro calendar events {calendar_counts.get('macro', 0)} < {args.min_macro_events}")
    if calendar_counts.get("earnings", 0) < args.min_earnings_events:
        failures.append(f"earnings calendar events {calendar_counts.get('earnings', 0)} < {args.min_earnings_events}")
    elif calendar_counts.get("earnings", 0) == 0:
        warnings.append("earnings calendar is not connected yet")
    option_rows = sum(int(row["rows"] or 0) for row in report["options"])
    if args.min_options_rows > 0 and option_rows < args.min_options_rows:
        failures.append(f"options flow rows {option_rows} < {args.min_options_rows}")
    elif option_rows == 0:
        warnings.append("options flow is skipped for the current non-options data phase")
    valuation = report["indexValuation"]
    if valuation["forwardHistoryRows"] < args.min_forward_valuation_history:
        failures.append(
            "QQQ forward valuation history "
            f"{valuation['forwardHistoryRows']} < {args.min_forward_valuation_history}"
        )
    if not valuation["hasFiveYearRange"]:
        failures.append("QQQ forward valuation 5y range is missing")
    if not valuation["payloadsMatch"]:
        failures.append("index-valuation datasets and raw_payloads are out of sync")
    return failures, warnings


def print_text_report(report: dict[str, Any], failures: list[str], warnings: list[str]) -> None:
    symbols = report["symbols"]
    ratios = report["ratios"]
    print("Product data coverage")
    print(f"  db: {report['db']}")
    print(
        "  symbols: "
        f"{symbols['total']} total, {symbols['liquid']} liquid, "
        f"{symbols['unknownSector']} unknown sector ({ratios['unknownSectorPct']}%), "
        f"{symbols['marketCapMissing']} missing market cap ({ratios['marketCapMissingPct']}%)"
    )
    print(f"  linked: {symbols['eventLinked']} event, {symbols['earningsLinked']} earnings-quality")
    print("  market boards:")
    for board in report["marketBoards"]:
        print(
            f"    {board['board']}: {board['rows']} rows, "
            f"{board['symbols']} symbols, {board['unknownSector']} unknown sector"
        )
    print("  calendar:")
    if report["calendar"]:
        for row in report["calendar"]:
            print(f"    {row['type']}: {row['rows']}")
    else:
        print("    none")
    print("  options:")
    if report["options"]:
        for row in report["options"]:
            print(f"    {row['board']}: {row['rows']}")
    else:
        print("    none")
    valuation = report["indexValuation"]
    print(
        "  QQQ forward valuation: "
        f"{valuation['forwardHistoryRows']} history rows, "
        f"as of {valuation['forwardAsOf'] or '--'}, "
        f"5y range {'ready' if valuation['hasFiveYearRange'] else 'missing'}, "
        f"API payload {'synced' if valuation['payloadsMatch'] else 'out of sync'}"
    )
    for warning in warnings:
        print(f"  WARN: {warning}")
    for failure in failures:
        print(f"  FAIL: {failure}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Check product SQLite coverage after data refresh.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    parser.add_argument("--min-symbols", type=int, default=800)
    parser.add_argument("--min-liquid-symbols", type=int, default=200)
    parser.add_argument("--min-board-rows", type=int, default=800)
    parser.add_argument("--min-macro-events", type=int, default=1)
    parser.add_argument("--min-earnings-events", type=int, default=0)
    parser.add_argument("--min-options-rows", type=int, default=0)
    parser.add_argument("--min-forward-valuation-history", type=int, default=100)
    parser.add_argument("--max-unknown-sector-pct", type=float, default=20.0)
    parser.add_argument("--max-market-cap-missing-pct", type=float, default=5.0)
    args = parser.parse_args()

    if not args.db.exists():
        raise SystemExit(f"Product DB not found: {args.db}")
    report = build_report(args.db)
    failures, warnings = validate(report, args)
    payload = {**report, "ok": not failures, "warnings": warnings, "failures": failures}
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_text_report(report, failures, warnings)
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

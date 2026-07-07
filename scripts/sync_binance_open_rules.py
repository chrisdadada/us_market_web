#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "product.db"
BINANCE_EXCHANGE_INFO = "https://api.binance.com/api/v3/exchangeInfo"

import sys

sys.path.insert(0, str(ROOT / "server"))
import open_portfolio  # noqa: E402


def now_text() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch_binance_rules(url: str) -> list[tuple[str, str, str, str, str, str]]:
    with urlopen(url, timeout=30) as response:
        payload = json.load(response)

    rows = []
    for item in payload.get("symbols", []):
        if item.get("status") != "TRADING" or item.get("quoteAsset") != "USDT":
            continue
        lot_size = next((f for f in item.get("filters", []) if f.get("filterType") == "LOT_SIZE"), None)
        if not lot_size:
            continue
        rows.append(
            (
                item["baseAsset"].upper(),
                "crypto",
                lot_size["stepSize"],
                lot_size.get("minQty", ""),
                "binance_spot_usdt",
                now_text(),
            )
        )
    return rows


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def current_amount(row: sqlite3.Row) -> Decimal:
    if row["trade_amount"]:
        return Decimal(str(row["trade_amount"]))
    return open_portfolio.INITIAL_CAPITAL * Decimal(str(row["position_pct"])) / Decimal("100")


def current_quantity(row: sqlite3.Row, amount: Decimal, price: Decimal) -> Decimal:
    if row["trade_quantity"]:
        return Decimal(str(row["trade_quantity"]))
    return amount / price


def normalize_trades(conn: sqlite3.Connection) -> list[tuple[int, str, Decimal, Decimal]]:
    if not table_exists(conn, "open_portfolio_trades"):
        return []

    steps = open_portfolio.load_quantity_steps(conn)
    positions: dict[str, dict[str, Decimal]] = {}
    changes: list[tuple[int, str, Decimal, Decimal]] = []
    rows = conn.execute("SELECT * FROM open_portfolio_trades ORDER BY trade_time ASC, id ASC").fetchall()

    for row in rows:
        symbol = row["symbol"]
        price = Decimal(str(row["price"]))
        step = open_portfolio.quantity_step(symbol, steps)
        min_qty = open_portfolio.min_quantity(symbol, steps)
        old_amount = current_amount(row)
        old_qty = current_quantity(row, old_amount, price)

        if row["side"] == "buy":
            qty = open_portfolio.floor_to_step(old_amount / price, step)
            if qty < min_qty:
                raise ValueError(f"交易 {row['id']} {symbol} 买入金额不够最小数量")
            amount = qty * price
        else:
            qty = open_portfolio.floor_to_step(old_qty, step)
            if qty < min_qty:
                raise ValueError(f"交易 {row['id']} {symbol} 卖出数量小于最小数量")
            amount = qty * price

        position = positions.setdefault(symbol, {"qty": Decimal("0"), "cost": Decimal("0")})
        if row["side"] == "buy":
            position["qty"] += qty
            position["cost"] += amount
        else:
            if qty > position["qty"] + open_portfolio.EPS:
                if qty - position["qty"] <= step and old_qty >= position["qty"]:
                    qty = open_portfolio.floor_to_step(position["qty"], step)
                    amount = qty * price
                else:
                    raise ValueError(f"交易 {row['id']} {symbol} 卖出数量超过持仓")
            avg_cost = position["cost"] / position["qty"] if position["qty"] else Decimal("0")
            position["qty"] -= qty
            position["cost"] -= avg_cost * qty
            if position["qty"].copy_abs() <= open_portfolio.EPS or position["cost"].copy_abs() <= open_portfolio.MONEY_EPS:
                position["qty"] = Decimal("0")
                position["cost"] = Decimal("0")

        if qty != old_qty or amount != old_amount:
            changes.append((row["id"], symbol, old_qty, qty))
            conn.execute(
                """
                UPDATE open_portfolio_trades
                SET trade_quantity = ?, trade_amount = ?, position_pct = ?
                WHERE id = ?
                """,
                (
                    float(qty),
                    float(amount),
                    float(amount / open_portfolio.INITIAL_CAPITAL * Decimal("100")),
                    row["id"],
                ),
            )

    open_portfolio.calculate(open_portfolio.list_rows(conn), steps)
    return changes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--url", default=BINANCE_EXCHANGE_INFO)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--rules-only", action="store_true")
    args = parser.parse_args()

    rules = fetch_binance_rules(args.url)
    if not rules:
        raise SystemExit("no Binance rules fetched")

    with sqlite3.connect(args.db) as conn:
        conn.row_factory = sqlite3.Row
        open_portfolio.ensure_schema(conn)
        conn.executemany(
            """
            INSERT OR REPLACE INTO open_portfolio_symbol_rules
            (symbol, asset_type, quantity_step, min_quantity, source, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            rules,
        )
        changes = [] if args.rules_only else normalize_trades(conn)
        if args.apply:
            conn.commit()
        else:
            conn.rollback()

    print(f"rules={len(rules)} trade_changes={len(changes)} applied={args.apply}")
    for trade_id, symbol, old_qty, new_qty in changes[:20]:
        print(f"trade {trade_id} {symbol}: {old_qty} -> {new_qty}")
    if len(changes) > 20:
        print(f"... {len(changes) - 20} more")


if __name__ == "__main__":
    main()

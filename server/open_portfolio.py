from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
import re
from typing import Any


INITIAL_CAPITAL = Decimal("10000000")
EPS = Decimal("0.000001")
MONEY_EPS = Decimal("0.01")
SYMBOL_RE = re.compile(r"^[A-Z0-9._-]{1,20}$")


def ensure_schema(conn: Any) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS open_portfolio_trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          trade_time TEXT NOT NULL,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
          price REAL NOT NULL CHECK (price > 0),
          position_pct REAL NOT NULL CHECK (position_pct > 0),
          trade_amount REAL,
          trade_quantity REAL,
          note TEXT,
          created_at TEXT NOT NULL
        )
        """
    )
    columns = {row[1] for row in conn.execute("PRAGMA table_info(open_portfolio_trades)").fetchall()}
    if "trade_amount" not in columns:
        conn.execute("ALTER TABLE open_portfolio_trades ADD COLUMN trade_amount REAL")
    if "trade_quantity" not in columns:
        conn.execute("ALTER TABLE open_portfolio_trades ADD COLUMN trade_quantity REAL")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_open_portfolio_trades_time ON open_portfolio_trades(trade_time, id)")


def money(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def number(value: Decimal, places: str = "0.000001") -> float:
    return float(value.quantize(Decimal(places), rounding=ROUND_HALF_UP))


def normalize_time(value: Any) -> str:
    text = str(value or "").strip().replace("T", " ")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    if re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", text):
        return text[:10]
    if re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", text):
        return text[:10]
    raise ValueError("时间格式不正确")


def normalize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    symbol = str(payload.get("symbol", "")).strip().upper()
    if not SYMBOL_RE.fullmatch(symbol):
        raise ValueError("标的不正确")
    side = str(payload.get("side", "")).strip().lower()
    if side not in {"buy", "sell"}:
        raise ValueError("方向不正确")
    try:
        price = Decimal(str(payload.get("price", "")))
    except Exception as exc:
        raise ValueError("价格不正确") from exc
    if price <= 0:
        raise ValueError("价格必须大于 0")
    if side == "sell":
        try:
            quantity = Decimal(str(payload.get("quantity", payload.get("tradeQuantity", ""))))
        except Exception as exc:
            raise ValueError("卖出数量不正确") from exc
        if quantity <= 0:
            raise ValueError("卖出数量必须大于 0")
        amount = quantity * price
    else:
        try:
            amount = Decimal(str(payload.get("amount", payload.get("tradeAmount", ""))))
        except Exception as exc:
            raise ValueError("买入金额不正确") from exc
        if amount <= 0:
            raise ValueError("买入金额必须大于 0")
        quantity = amount / price
    position_pct = amount / INITIAL_CAPITAL * Decimal("100")
    return {
        "trade_time": normalize_time(payload.get("tradeTime", payload.get("trade_time", ""))),
        "symbol": symbol,
        "side": side,
        "price": float(price),
        "position_pct": float(position_pct),
        "trade_amount": float(amount),
        "trade_quantity": float(quantity),
        "note": str(payload.get("note", "")).strip()[:200],
    }


def list_rows(conn: Any) -> list[Any]:
    ensure_schema(conn)
    return list(conn.execute("SELECT * FROM open_portfolio_trades ORDER BY trade_time ASC, id ASC").fetchall())


def trade_payload(row: Any, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
        "id": row["id"],
        "tradeTime": row["trade_time"],
        "symbol": row["symbol"],
        "side": row["side"],
        "price": row["price"],
        "positionPct": row["position_pct"],
        "amount": row["trade_amount"] if "trade_amount" in row.keys() and row["trade_amount"] else None,
        "quantity": row["trade_quantity"] if "trade_quantity" in row.keys() and row["trade_quantity"] else None,
        "note": row["note"] or "",
    }
    payload.update(extra or {})
    return payload


def calculate(rows: list[Any]) -> dict[str, Any]:
    positions: dict[str, dict[str, Decimal]] = {}
    trades: list[dict[str, Any]] = []
    curve = [{"time": "", "value": money(INITIAL_CAPITAL)}]
    realized_total = Decimal("0")

    for row in rows:
        symbol = row["symbol"]
        price = Decimal(str(row["price"]))
        amount = Decimal(str(row["trade_amount"])) if "trade_amount" in row.keys() and row["trade_amount"] else INITIAL_CAPITAL * Decimal(str(row["position_pct"])) / Decimal("100")
        qty = Decimal(str(row["trade_quantity"])) if "trade_quantity" in row.keys() and row["trade_quantity"] else amount / price
        position = positions.setdefault(symbol, {"qty": Decimal("0"), "cost": Decimal("0")})
        realized = Decimal("0")

        if row["side"] == "buy":
            position["qty"] += qty
            position["cost"] += amount
        else:
            if qty > position["qty"] + EPS:
                raise ValueError(f"{symbol} 卖出数量超过持仓")
            avg_cost = position["cost"] / position["qty"] if position["qty"] else Decimal("0")
            cost_out = avg_cost * qty
            realized = amount - cost_out
            realized_total += realized
            position["qty"] -= qty
            position["cost"] -= cost_out
            if position["qty"].copy_abs() <= EPS or position["cost"].copy_abs() <= MONEY_EPS:
                position["qty"] = Decimal("0")
                position["cost"] = Decimal("0")

        equity = INITIAL_CAPITAL + realized_total
        trades.append(
            trade_payload(
                row,
                {
                    "amount": money(amount),
                    "quantity": number(qty),
                    "realizedPnl": money(realized),
                    "equityAfter": money(equity),
                },
            )
        )
        curve.append({"time": row["trade_time"], "value": money(equity)})

    holdings = []
    for symbol, position in sorted(positions.items()):
        if position["qty"] <= EPS or position["cost"].copy_abs() <= MONEY_EPS:
            continue
        avg_cost = position["cost"] / position["qty"]
        holdings.append(
            {
                "symbol": symbol,
                "quantity": number(position["qty"]),
                "avgCost": money(avg_cost),
                "cost": money(position["cost"]),
                "positionPct": number(position["cost"] / INITIAL_CAPITAL * Decimal("100"), "0.01"),
            }
        )

    equity = INITIAL_CAPITAL + realized_total
    return {
        "initialCapital": money(INITIAL_CAPITAL),
        "equity": money(equity),
        "realizedPnl": money(realized_total),
        "realizedReturnPct": number(realized_total / INITIAL_CAPITAL * Decimal("100"), "0.01"),
        "holdings": holdings,
        "trades": list(reversed(trades)),
        "curve": curve,
    }


def payload(conn: Any) -> dict[str, Any]:
    return calculate(list_rows(conn))


def add_trade(conn: Any, raw_payload: dict[str, Any], created_at: str) -> dict[str, Any]:
    ensure_schema(conn)
    item = normalize_payload(raw_payload)
    cursor = conn.execute(
        """
        INSERT INTO open_portfolio_trades (trade_time, symbol, side, price, position_pct, trade_amount, trade_quantity, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (item["trade_time"], item["symbol"], item["side"], item["price"], item["position_pct"], item["trade_amount"], item["trade_quantity"], item["note"], created_at),
    )
    calculate(list_rows(conn))
    return {"id": cursor.lastrowid, **payload(conn)}


def delete_trade(conn: Any, trade_id: int) -> bool:
    ensure_schema(conn)
    cursor = conn.execute("DELETE FROM open_portfolio_trades WHERE id = ?", (trade_id,))
    calculate(list_rows(conn))
    return cursor.rowcount > 0


def _demo() -> None:
    rows = [
        {"id": 1, "trade_time": "2026-01-01", "symbol": "ABC", "side": "buy", "price": 10, "position_pct": 20, "trade_amount": 2000000, "trade_quantity": 200000, "note": ""},
        {"id": 2, "trade_time": "2026-01-02", "symbol": "ABC", "side": "sell", "price": 20, "position_pct": 10, "trade_amount": 1000000, "trade_quantity": 50000, "note": ""},
        {"id": 3, "trade_time": "2026-01-03", "symbol": "ABC", "side": "buy", "price": 30, "position_pct": 30, "trade_amount": 3000000, "trade_quantity": 100000, "note": ""},
    ]
    result = calculate(rows)
    assert result["realizedPnl"] == 500000
    assert result["equity"] == 10500000
    assert result["holdings"][0]["quantity"] == 250000
    assert result["holdings"][0]["avgCost"] == 18


if __name__ == "__main__":
    _demo()

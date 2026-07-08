from __future__ import annotations

from decimal import Decimal, ROUND_FLOOR, ROUND_HALF_UP
import re
from typing import Any


INITIAL_CAPITAL = Decimal("10000000")
EPS = Decimal("0.000001")
MONEY_EPS = Decimal("0.01")
SYMBOL_RE = re.compile(r"^[A-Z0-9._-]{1,20}$")
DEFAULT_QUANTITY_RULES = {"BTC": (Decimal("0.00001"), Decimal("0.00001"))}


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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS open_portfolio_symbol_rules (
          symbol TEXT PRIMARY KEY,
          asset_type TEXT NOT NULL,
          quantity_step TEXT NOT NULL,
          min_quantity TEXT,
          source TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )


def money(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def number(value: Decimal, places: str = "0.000001") -> float:
    return float(value.quantize(Decimal(places), rounding=ROUND_HALF_UP))


def load_quantity_steps(conn: Any) -> dict[str, tuple[Decimal, Decimal]]:
    ensure_schema(conn)
    stock_symbols = {
        row["symbol"]
        for row in conn.execute(
            "SELECT symbol FROM symbols WHERE symbol IS NOT NULL"
        ).fetchall()
    } if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'symbols'").fetchone() else set()
    rows = conn.execute("SELECT symbol, quantity_step, min_quantity FROM open_portfolio_symbol_rules").fetchall()
    steps = DEFAULT_QUANTITY_RULES.copy()
    for row in rows:
        if row["symbol"] in stock_symbols:
            continue
        step = Decimal(str(row["quantity_step"]))
        min_qty = Decimal(str(row["min_quantity"] or row["quantity_step"]))
        if min_qty <= 0:
            min_qty = step
        steps[row["symbol"]] = (step, min_qty)
    return steps


def quantity_step(symbol: str, steps: dict[str, tuple[Decimal, Decimal]] | None = None) -> Decimal:
    return (steps or DEFAULT_QUANTITY_RULES).get(symbol, (Decimal("1"), Decimal("1")))[0]


def min_quantity(symbol: str, steps: dict[str, tuple[Decimal, Decimal]] | None = None) -> Decimal:
    return (steps or DEFAULT_QUANTITY_RULES).get(symbol, (Decimal("1"), Decimal("1")))[1]


def floor_to_step(value: Decimal, step: Decimal) -> Decimal:
    return (value / step).to_integral_value(rounding=ROUND_FLOOR) * step


def validate_quantity(symbol: str, quantity: Decimal, steps: dict[str, tuple[Decimal, Decimal]] | None = None) -> None:
    step = quantity_step(symbol, steps)
    if quantity < min_quantity(symbol, steps):
        raise ValueError(f"{symbol} 数量小于最小数量")
    if floor_to_step(quantity, step) != quantity:
        raise ValueError(f"{symbol} 数量不符合交易规则")


def normalize_time(value: Any) -> str:
    text = str(value or "").strip().replace("T", " ")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    if re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", text):
        return text[:10]
    if re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", text):
        return text[:10]
    raise ValueError("时间格式不正确")


def normalize_payload(payload: dict[str, Any], steps: dict[str, tuple[Decimal, Decimal]] | None = None) -> dict[str, Any]:
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
    step = quantity_step(symbol, steps)
    if side == "sell":
        try:
            quantity = Decimal(str(payload.get("quantity", payload.get("tradeQuantity", ""))))
        except Exception as exc:
            raise ValueError("卖出数量不正确") from exc
        if quantity <= 0:
            raise ValueError("卖出数量必须大于 0")
        validate_quantity(symbol, quantity, steps)
        amount = quantity * price
    else:
        try:
            amount = Decimal(str(payload.get("amount", payload.get("tradeAmount", ""))))
        except Exception as exc:
            raise ValueError("买入金额不正确") from exc
        if amount <= 0:
            raise ValueError("买入金额必须大于 0")
        quantity = floor_to_step(amount / price, step)
        if quantity < min_quantity(symbol, steps):
            raise ValueError(f"{symbol} 买入金额不够最小数量")
        amount = quantity * price
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


def trade_payload(row: Any, extra: dict[str, Any] | None = None, steps: dict[str, tuple[Decimal, Decimal]] | None = None) -> dict[str, Any]:
    payload = {
        "id": row["id"],
        "tradeTime": row["trade_time"],
        "symbol": row["symbol"],
        "side": row["side"],
        "price": row["price"],
        "positionPct": row["position_pct"],
        "amount": row["trade_amount"] if "trade_amount" in row.keys() and row["trade_amount"] else None,
        "quantity": row["trade_quantity"] if "trade_quantity" in row.keys() and row["trade_quantity"] else None,
        "quantityStep": float(quantity_step(row["symbol"], steps)),
        "note": row["note"] or "",
    }
    payload.update(extra or {})
    return payload


def calculate(rows: list[Any], steps: dict[str, tuple[Decimal, Decimal]] | None = None, enforce_cash: bool = False, enforce_trade_id: int | None = None) -> dict[str, Any]:
    positions: dict[str, dict[str, Decimal]] = {}
    trades: list[dict[str, Any]] = []
    curve = [{"time": "", "value": money(INITIAL_CAPITAL)}]
    realized_total = Decimal("0")
    cash = INITIAL_CAPITAL

    for row in rows:
        symbol = row["symbol"]
        price = Decimal(str(row["price"]))
        amount = Decimal(str(row["trade_amount"])) if "trade_amount" in row.keys() and row["trade_amount"] else INITIAL_CAPITAL * Decimal(str(row["position_pct"])) / Decimal("100")
        qty = Decimal(str(row["trade_quantity"])) if "trade_quantity" in row.keys() and row["trade_quantity"] else amount / price
        position = positions.setdefault(symbol, {"qty": Decimal("0"), "cost": Decimal("0")})
        realized = Decimal("0")

        if row["side"] == "buy":
            if (enforce_cash or row["id"] == enforce_trade_id) and amount > cash + MONEY_EPS:
                raise ValueError(f"{symbol} 买入金额超过可用资金")
            cash -= amount
            position["qty"] += qty
            position["cost"] += amount
        else:
            if qty > position["qty"] + EPS:
                raise ValueError(f"{symbol} 卖出数量超过持仓")
            avg_cost = position["cost"] / position["qty"] if position["qty"] else Decimal("0")
            cost_out = avg_cost * qty
            realized = amount - cost_out
            realized_total += realized
            cash += amount
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
                    "quantity": number(qty, str(quantity_step(symbol, steps))),
                    "realizedPnl": money(realized),
                    "equityAfter": money(equity),
                },
                steps,
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
                "quantity": number(position["qty"], str(quantity_step(symbol, steps))),
                "quantityStep": float(quantity_step(symbol, steps)),
                "avgCost": money(avg_cost),
                "cost": money(position["cost"]),
                "positionPct": number(position["cost"] / INITIAL_CAPITAL * Decimal("100"), "0.01"),
            }
        )

    equity = INITIAL_CAPITAL + realized_total
    return {
        "initialCapital": money(INITIAL_CAPITAL),
        "equity": money(equity),
        "availableCash": money(cash),
        "realizedPnl": money(realized_total),
        "realizedReturnPct": number(realized_total / INITIAL_CAPITAL * Decimal("100"), "0.01"),
        "holdings": holdings,
        "trades": list(reversed(trades)),
        "curve": curve,
    }


def payload(conn: Any) -> dict[str, Any]:
    return calculate(list_rows(conn), load_quantity_steps(conn))


def add_trade(conn: Any, raw_payload: dict[str, Any], created_at: str) -> dict[str, Any]:
    ensure_schema(conn)
    steps = load_quantity_steps(conn)
    item = normalize_payload(raw_payload, steps)
    cursor = conn.execute(
        """
        INSERT INTO open_portfolio_trades (trade_time, symbol, side, price, position_pct, trade_amount, trade_quantity, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (item["trade_time"], item["symbol"], item["side"], item["price"], item["position_pct"], item["trade_amount"], item["trade_quantity"], item["note"], created_at),
    )
    calculate(list_rows(conn), steps, enforce_trade_id=cursor.lastrowid)
    return {"id": cursor.lastrowid, **payload(conn)}


def delete_trade(conn: Any, trade_id: int) -> bool:
    ensure_schema(conn)
    cursor = conn.execute("DELETE FROM open_portfolio_trades WHERE id = ?", (trade_id,))
    calculate(list_rows(conn), load_quantity_steps(conn))
    return cursor.rowcount > 0


def update_trade_note(conn: Any, trade_id: int, note: str) -> bool:
    ensure_schema(conn)
    cursor = conn.execute("UPDATE open_portfolio_trades SET note = ? WHERE id = ?", (str(note or "").strip(), trade_id))
    return cursor.rowcount > 0


def _demo() -> None:
    import sqlite3

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    conn.execute("CREATE TABLE symbols (symbol TEXT PRIMARY KEY)")
    conn.execute("INSERT INTO symbols (symbol) VALUES ('QQQ')")
    conn.execute(
        "INSERT INTO open_portfolio_symbol_rules (symbol, asset_type, quantity_step, min_quantity, source, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ("ETH", "crypto", "0.0001", "0.0005", "test", "2026-01-01"),
    )
    conn.execute(
        "INSERT INTO open_portfolio_symbol_rules (symbol, asset_type, quantity_step, min_quantity, source, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ("QQQ", "crypto", "0.01", "0.01", "test", "2026-01-01"),
    )
    steps = load_quantity_steps(conn)
    assert quantity_step("QQQ", steps) == Decimal("1")
    try:
        normalize_payload({"tradeTime": "2026-01-01", "symbol": "QQQ", "side": "buy", "price": 650, "amount": 200}, steps)
    except ValueError as exc:
        assert "买入金额不够最小数量" in str(exc)
    else:
        raise AssertionError("stock symbols must override Binance symbols")
    eth = normalize_payload({"tradeTime": "2026-01-01", "symbol": "ETH", "side": "buy", "price": 3333, "amount": 1000}, steps)
    assert eth["trade_quantity"] == 0.3000
    try:
        normalize_payload({"tradeTime": "2026-01-01", "symbol": "ETH", "side": "buy", "price": 3333, "amount": 1}, steps)
    except ValueError as exc:
        assert "买入金额不够最小数量" in str(exc)
    else:
        raise AssertionError("buy amount below min quantity must fail")

    stock = normalize_payload({"tradeTime": "2026-01-01", "symbol": "ABC", "side": "buy", "price": 39, "amount": 2000000})
    assert stock["trade_quantity"] == 51282
    assert stock["trade_amount"] == 1999998
    btc = normalize_payload({"tradeTime": "2026-01-01", "symbol": "BTC", "side": "buy", "price": 100000, "amount": 1000})
    assert btc["trade_quantity"] == 0.01
    try:
        normalize_payload({"tradeTime": "2026-01-01", "symbol": "ABC", "side": "sell", "price": 10, "quantity": 1.5})
    except ValueError:
        pass
    else:
        raise AssertionError("stock quantity must be integer")
    try:
        normalize_payload({"tradeTime": "2026-01-01", "symbol": "BTC", "side": "sell", "price": 100000, "quantity": "0.000021"})
    except ValueError:
        pass
    else:
        raise AssertionError("BTC quantity must follow Binance step")

    rows = [
        {"id": 1, "trade_time": "2026-01-01", "symbol": "ABC", "side": "buy", "price": 10, "position_pct": 20, "trade_amount": 2000000, "trade_quantity": 200000, "note": ""},
        {"id": 2, "trade_time": "2026-01-02", "symbol": "ABC", "side": "sell", "price": 20, "position_pct": 10, "trade_amount": 1000000, "trade_quantity": 50000, "note": ""},
        {"id": 3, "trade_time": "2026-01-03", "symbol": "ABC", "side": "buy", "price": 30, "position_pct": 30, "trade_amount": 3000000, "trade_quantity": 100000, "note": ""},
    ]
    result = calculate(rows)
    assert result["realizedPnl"] == 500000
    assert result["equity"] == 10500000
    assert result["availableCash"] == 6000000
    assert result["holdings"][0]["quantity"] == 250000
    assert result["holdings"][0]["avgCost"] == 18
    conn.executemany(
        "INSERT INTO open_portfolio_trades (id, trade_time, symbol, side, price, position_pct, trade_amount, trade_quantity, note, created_at) VALUES (:id, :trade_time, :symbol, :side, :price, :position_pct, :trade_amount, :trade_quantity, :note, '2026-01-01')",
        rows,
    )
    assert update_trade_note(conn, 2, "减仓") is True
    updated = payload(conn)
    assert updated["trades"][1]["note"] == "减仓"
    assert updated["realizedPnl"] == 500000
    try:
        calculate([
            {"id": 1, "trade_time": "2026-01-01", "symbol": "ABC", "side": "buy", "price": 10, "position_pct": 200, "trade_amount": 20000000, "trade_quantity": 2000000, "note": ""},
        ], enforce_cash=True)
    except ValueError as exc:
        assert "买入金额超过可用资金" in str(exc)
    else:
        raise AssertionError("buy must not exceed cash")


if __name__ == "__main__":
    _demo()

from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


ACTIVE_STATUSES = ("waiting_entry", "running", "paused", "holding_protection", "ending")
SYMBOL_PATTERN = re.compile(r"^[A-Z0-9]{5,20}$")
ZERO = Decimal("0")
HUNDRED = Decimal("100")


class RollingError(ValueError):
    pass


class MarketUnavailable(RuntimeError):
    pass


def decimal_value(value: Any, label: str, minimum: Decimal, maximum: Decimal) -> Decimal:
    try:
        result = Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, AttributeError):
        raise RollingError(f"{label}格式不正确") from None
    if not result.is_finite() or result < minimum or result > maximum:
        raise RollingError(f"{label}应在 {minimum} 至 {maximum} 之间")
    return result


def decimal_text(value: Decimal | None) -> str | None:
    if value is None:
        return None
    text = format(value.normalize(), "f")
    return "0" if text in {"-0", ""} else text


def now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def normalize_config(payload: dict[str, Any]) -> dict[str, Any]:
    symbol = str(payload.get("symbol") or "").strip().upper()
    if not SYMBOL_PATTERN.fullmatch(symbol):
        raise RollingError("请输入正确的 U 本位合约代码")
    side = str(payload.get("side") or "")
    trigger_direction = str(payload.get("triggerDirection") or "")
    entry_mode = str(payload.get("entryMode") or "")
    entry_direction = str(payload.get("entryDirection") or "rise")
    interval_type = str(payload.get("intervalType") or "")
    if side not in {"long", "short"}:
        raise RollingError("请选择做多或做空")
    if trigger_direction not in {"rise", "fall"}:
        raise RollingError("请选择加仓触发方向")
    if entry_mode not in {"immediate", "conditional"}:
        raise RollingError("请选择首仓方式")
    if entry_direction not in {"rise", "fall"}:
        raise RollingError("首仓触发方向不正确")
    if interval_type not in {"percent", "absolute"}:
        raise RollingError("加仓间隔类型不正确")
    max_adds = decimal_value(payload.get("maxAdds"), "最大加仓次数", ZERO, Decimal("1000000"))
    if max_adds != max_adds.to_integral_value():
        raise RollingError("最大加仓次数必须是非负整数")
    config = {
        "schemaVersion": 1,
        "symbol": symbol,
        "side": side,
        "triggerDirection": trigger_direction,
        "initialNotional": decimal_text(decimal_value(payload.get("initialNotional"), "首次仓位价值", Decimal("0.00000001"), Decimal("1000000000000000000"))),
        "leverage": decimal_text(decimal_value(payload.get("leverage"), "杠杆", Decimal("0.00000001"), Decimal("1000000000000000000"))),
        "entryMode": entry_mode,
        "entryDirection": entry_direction,
        "entryTriggerPrice": None,
        "intervalType": interval_type,
        "intervalValue": decimal_text(decimal_value(payload.get("intervalValue"), "加仓间隔", Decimal("0.00000001"), Decimal("1000000000000000000"))),
        "addPercent": decimal_text(decimal_value(payload.get("addPercent"), "单次加仓比例", Decimal("0.00000001"), Decimal("1000000000000000000"))),
        "maxAdds": int(max_adds),
        "protectionDistance": decimal_text(decimal_value(payload.get("protectionDistance"), "保护距离", Decimal("0.00000001"), Decimal("1000000000000000000"))),
    }
    if entry_mode == "conditional":
        config["entryTriggerPrice"] = decimal_text(
            decimal_value(payload.get("entryTriggerPrice"), "首仓触发价", Decimal("0.00000001"), Decimal("1000000000"))
        )
    if trigger_direction == "fall" and interval_type == "percent" and Decimal(str(config["intervalValue"])) >= HUNDRED:
        raise RollingError("下跌百分比间隔必须小于 100")
    return config


def decimal_config(config: dict[str, Any], key: str) -> Decimal:
    return Decimal(str(config[key]))


def trigger_price(config: dict[str, Any], fill_price: Decimal) -> Decimal | None:
    if int(config["maxAdds"]) <= 0:
        return None
    interval = decimal_config(config, "intervalValue")
    if config["intervalType"] == "percent":
        factor = interval / HUNDRED
        result = fill_price * (Decimal("1") + factor if config["triggerDirection"] == "rise" else Decimal("1") - factor)
    else:
        result = fill_price + interval if config["triggerDirection"] == "rise" else fill_price - interval
    if result <= ZERO:
        raise RollingError("下一触发价必须大于 0")
    return result


def protection_price(config: dict[str, Any], average_price: Decimal) -> Decimal:
    distance = decimal_config(config, "protectionDistance") / HUNDRED
    result = average_price * (Decimal("1") - distance if config["side"] == "long" else Decimal("1") + distance)
    if result <= ZERO:
        raise RollingError("保护价必须大于 0")
    return result


def initial_state(config: dict[str, Any], fill_price: Decimal) -> dict[str, Any]:
    target = decimal_config(config, "initialNotional")
    quantity = target / fill_price
    return {
        "quantity": decimal_text(quantity),
        "averagePrice": decimal_text(fill_price),
        "totalNotional": decimal_text(target),
        "fixedAddNotional": decimal_text(target * decimal_config(config, "addPercent") / HUNDRED),
        "addsCompleted": 0,
        "nextTriggerPrice": decimal_text(trigger_price(config, fill_price)),
        "protectionPrice": decimal_text(protection_price(config, fill_price)),
        "entryPrice": decimal_text(fill_price),
        "exitPrice": None,
        "estimatedPnl": None,
        "lastFillPrice": decimal_text(fill_price),
    }


def empty_state() -> dict[str, Any]:
    return {
        "quantity": "0",
        "averagePrice": None,
        "totalNotional": "0",
        "fixedAddNotional": None,
        "addsCompleted": 0,
        "nextTriggerPrice": None,
        "protectionPrice": None,
        "entryPrice": None,
        "exitPrice": None,
        "estimatedPnl": None,
        "lastFillPrice": None,
    }


def condition_met(direction: str, price: Decimal, target: Decimal) -> bool:
    return price >= target if direction == "rise" else price <= target


def pnl(config: dict[str, Any], state: dict[str, Any], price: Decimal) -> Decimal:
    quantity = Decimal(str(state["quantity"]))
    average = Decimal(str(state["averagePrice"]))
    result = quantity * (price - average)
    return result if config["side"] == "long" else -result


def apply_price(config: dict[str, Any], state: dict[str, Any], status: str, price: Decimal) -> tuple[str, dict[str, Any], dict[str, Any] | None]:
    if status == "waiting_entry":
        target = Decimal(str(config["entryTriggerPrice"]))
        if not condition_met(config["entryDirection"], price, target):
            return status, state, None
        next_state = initial_state(config, price)
        next_status = "holding_protection" if int(config["maxAdds"]) == 0 else "running"
        return next_status, next_state, {"type": "entry", "price": decimal_text(price)}

    if status == "ending":
        estimated_pnl = pnl(config, state, price) if state.get("averagePrice") else ZERO
        next_state = {**state, "exitPrice": decimal_text(price), "estimatedPnl": decimal_text(estimated_pnl)}
        return "ended", next_state, {"type": "ended", "price": decimal_text(price)}

    protection = Decimal(str(state["protectionPrice"]))
    protection_hit = price <= protection if config["side"] == "long" else price >= protection
    if protection_hit:
        next_state = {**state, "exitPrice": decimal_text(price), "estimatedPnl": decimal_text(pnl(config, state, price))}
        return "ended", next_state, {"type": "protection_exit", "price": decimal_text(price)}

    if status in {"paused", "holding_protection"} or state.get("nextTriggerPrice") is None:
        return status, state, None
    next_trigger = Decimal(str(state["nextTriggerPrice"]))
    if not condition_met(config["triggerDirection"], price, next_trigger):
        return status, state, None

    fixed_add = Decimal(str(state["fixedAddNotional"]))
    added_quantity = fixed_add / price
    old_quantity = Decimal(str(state["quantity"]))
    old_average = Decimal(str(state["averagePrice"]))
    quantity = old_quantity + added_quantity
    average = (old_quantity * old_average + added_quantity * price) / quantity
    old_protection = Decimal(str(state["protectionPrice"]))
    candidate_protection = protection_price(config, average)
    tightened = max(old_protection, candidate_protection) if config["side"] == "long" else min(old_protection, candidate_protection)
    adds_completed = int(state["addsCompleted"]) + 1
    finished_adding = adds_completed >= int(config["maxAdds"])
    next_state = {
        **state,
        "quantity": decimal_text(quantity),
        "averagePrice": decimal_text(average),
        "totalNotional": decimal_text(Decimal(str(state["totalNotional"])) + fixed_add),
        "addsCompleted": adds_completed,
        "nextTriggerPrice": None if finished_adding else decimal_text(trigger_price(config, price)),
        "protectionPrice": decimal_text(tightened),
        "lastFillPrice": decimal_text(price),
    }
    return "holding_protection" if finished_adding else "running", next_state, {"type": "add", "price": decimal_text(price), "addNumber": adds_completed}


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        f"""
        CREATE TABLE IF NOT EXISTS rolling_plans (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          status TEXT NOT NULL,
          config_json TEXT NOT NULL,
          state_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          ended_at TEXT,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_rolling_plans_user_updated
          ON rolling_plans(user_id, updated_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_rolling_active_user_symbol
          ON rolling_plans(user_id, symbol)
          WHERE status IN ({','.join(repr(item) for item in ACTIVE_STATUSES)});
        CREATE TABLE IF NOT EXISTS rolling_plan_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          plan_id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          price TEXT,
          detail_json TEXT NOT NULL DEFAULT '{{}}',
          created_at TEXT NOT NULL,
          FOREIGN KEY(plan_id) REFERENCES rolling_plans(id) ON DELETE CASCADE,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_rolling_events_plan_id
          ON rolling_plan_events(plan_id, id DESC);
        """
    )


def append_event(conn: sqlite3.Connection, plan_id: str, user_id: int, event: dict[str, Any]) -> None:
    detail = {key: value for key, value in event.items() if key not in {"type", "price"}}
    conn.execute(
        "INSERT INTO rolling_plan_events(plan_id, user_id, event_type, price, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (plan_id, user_id, event["type"], event.get("price"), json.dumps(detail, separators=(",", ":")), now_iso()),
    )


def create_plan(conn: sqlite3.Connection, user_id: int, payload: dict[str, Any], price: Decimal, rules: dict[str, Decimal]) -> str:
    config = normalize_config(payload)
    if config["symbol"] != rules["symbol"]:
        raise RollingError("交易标的不可用")
    timestamp = now_iso()
    plan_id = uuid.uuid4().hex
    should_enter = config["entryMode"] == "immediate"
    if not should_enter:
        entry_target = Decimal(str(config["entryTriggerPrice"]))
        invalid_target = entry_target <= price if config["entryDirection"] == "rise" else entry_target >= price
        if invalid_target:
            raise RollingError("首仓触发价必须位于当前价格的正确方向")
    status = "holding_protection" if should_enter and int(config["maxAdds"]) == 0 else "running" if should_enter else "waiting_entry"
    state = initial_state(config, price) if should_enter else empty_state()
    try:
        conn.execute(
            "INSERT INTO rolling_plans(id, user_id, symbol, status, config_json, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (plan_id, user_id, config["symbol"], status, json.dumps(config, separators=(",", ":")), json.dumps(state, separators=(",", ":")), timestamp, timestamp),
        )
    except sqlite3.IntegrityError as exc:
        raise RollingError("该交易标的已有运行中的计划") from exc
    append_event(conn, plan_id, user_id, {"type": "entry" if should_enter else "waiting_entry", "price": decimal_text(price)})
    return plan_id


def process_symbol(conn: sqlite3.Connection, symbol: str, price: Decimal) -> int:
    rows = conn.execute(
        "SELECT * FROM rolling_plans WHERE symbol = ? AND status IN ('waiting_entry','running','paused','holding_protection','ending') ORDER BY created_at",
        (symbol,),
    ).fetchall()
    changed = 0
    for row in rows:
        config = json.loads(row["config_json"])
        state = json.loads(row["state_json"])
        next_status, next_state, event = apply_price(config, state, row["status"], price)
        if not event:
            continue
        timestamp = now_iso()
        cursor = conn.execute(
            "UPDATE rolling_plans SET status = ?, state_json = ?, updated_at = ?, ended_at = ? WHERE id = ? AND status = ?",
            (
                next_status,
                json.dumps(next_state, separators=(",", ":")),
                timestamp,
                timestamp if next_status == "ended" else None,
                row["id"],
                row["status"],
            ),
        )
        if cursor.rowcount != 1:
            continue
        append_event(conn, row["id"], int(row["user_id"]), event)
        changed += 1
    return changed


class BinanceMarket:
    def __init__(self, base_url: str = "https://fapi.binance.com", timeout: float = 5.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._rules: dict[str, dict[str, Decimal | str]] = {}
        self._rules_at = 0.0

    def _json(self, path: str) -> Any:
        request = urllib.request.Request(f"{self.base_url}{path}", headers={"User-Agent": "Dongbimao-Rolling/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
            raise MarketUnavailable("Binance 行情暂时不可用") from exc

    def prices(self) -> dict[str, Decimal]:
        payload = self._json("/fapi/v1/ticker/price")
        if not isinstance(payload, list):
            raise MarketUnavailable("Binance 行情返回异常")
        result: dict[str, Decimal] = {}
        for item in payload:
            try:
                result[str(item["symbol"])] = Decimal(str(item["price"]))
            except (KeyError, InvalidOperation):
                continue
        return result

    def quote(self, symbol: str) -> Decimal:
        query = urllib.parse.urlencode({"symbol": symbol})
        payload = self._json(f"/fapi/v1/ticker/price?{query}")
        try:
            return Decimal(str(payload["price"]))
        except (KeyError, InvalidOperation, TypeError) as exc:
            raise RollingError("交易标的不存在") from exc

    def rules(self, symbol: str) -> dict[str, Any]:
        if not self._rules or time.time() - self._rules_at > 6 * 3600:
            payload = self._json("/fapi/v1/exchangeInfo")
            rules: dict[str, dict[str, Any]] = {}
            for item in payload.get("symbols", []):
                if item.get("status") != "TRADING" or item.get("contractType") != "PERPETUAL" or item.get("quoteAsset") != "USDT":
                    continue
                filters = {entry.get("filterType"): entry for entry in item.get("filters", [])}
                lot = filters.get("LOT_SIZE", {})
                price_filter = filters.get("PRICE_FILTER", {})
                try:
                    rules[item["symbol"]] = {
                        "symbol": item["symbol"],
                        "qtyStep": Decimal(str(lot["stepSize"])),
                        "tickSize": Decimal(str(price_filter["tickSize"])),
                    }
                except (KeyError, InvalidOperation):
                    continue
            self._rules = rules
            self._rules_at = time.time()
        if symbol not in self._rules:
            raise RollingError("仅支持 Binance U 本位永续合约")
        return self._rules[symbol]


class RollingRuntime:
    def __init__(self, db_path: Path, market: BinanceMarket | None = None, poll_seconds: float = 1.0):
        self.db_path = Path(db_path)
        self.market = market or BinanceMarket()
        self.poll_seconds = max(0.25, poll_seconds)
        self.latest: dict[str, tuple[Decimal, float]] = {}
        self.market_error = ""
        self._rules: dict[str, dict[str, Any]] = {}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.RLock()

    def _db(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="rolling-runtime", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)

    def _active_symbols(self) -> list[str]:
        with self._db() as conn:
            return [row["symbol"] for row in conn.execute(
                "SELECT DISTINCT symbol FROM rolling_plans WHERE status IN ('waiting_entry','running','paused','holding_protection','ending')"
            ).fetchall()]

    def _run(self) -> None:
        while not self._stop.wait(self.poll_seconds):
            try:
                symbols = self._active_symbols()
                if not symbols:
                    continue
                prices = self.market.prices()
                timestamp = time.time()
                with self._lock:
                    for symbol in symbols:
                        if symbol in prices:
                            self.latest[symbol] = (prices[symbol], timestamp)
                    self.market_error = ""
                with self._db() as conn:
                    for symbol in symbols:
                        if symbol not in prices:
                            continue
                        process_symbol(conn, symbol, prices[symbol])
                    conn.commit()
            except Exception as exc:
                with self._lock:
                    self.market_error = str(exc) or "Binance 行情暂时不可用"

    def quote(self, symbol: str, max_age: float = 2.0) -> dict[str, Any]:
        symbol = str(symbol or "").strip().upper()
        if not SYMBOL_PATTERN.fullmatch(symbol):
            raise RollingError("请输入正确的 U 本位合约代码")
        with self._lock:
            cached = self.latest.get(symbol)
        if cached and time.time() - cached[1] <= max_age:
            price, timestamp = cached
        else:
            price = self.market.quote(symbol)
            timestamp = time.time()
            with self._lock:
                self.latest[symbol] = (price, timestamp)
                self.market_error = ""
        return {"symbol": symbol, "price": decimal_text(price), "asOf": timestamp, "connected": True}

    def create(self, user_id: int, payload: dict[str, Any]) -> str:
        config = normalize_config(payload)
        quote = self.quote(config["symbol"], max_age=1.0)
        rules = self._rules.get(config["symbol"]) or self.market.rules(config["symbol"])
        with self._db() as conn:
            return create_plan(conn, user_id, config, Decimal(str(quote["price"])), rules)

    def action(self, user_id: int, plan_id: str, action: str) -> None:
        targets = {
            "pause": (("running",), "paused", "paused"),
            "resume": (("paused",), "running", "resumed"),
            "end": (("waiting_entry", "running", "paused"), "ending", "ending"),
        }
        if action not in targets:
            raise RollingError("操作不存在")
        allowed, next_status, event_type = targets[action]
        placeholders = ",".join("?" for _ in allowed)
        with self._db() as conn:
            row = conn.execute("SELECT * FROM rolling_plans WHERE id = ? AND user_id = ?", (plan_id, user_id)).fetchone()
            if not row:
                raise RollingError("计划不存在")
            if row["status"] not in allowed:
                raise RollingError("当前状态不能执行该操作")
            cursor = conn.execute(
                f"UPDATE rolling_plans SET status = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status IN ({placeholders})",
                (next_status, now_iso(), plan_id, user_id, *allowed),
            )
            if cursor.rowcount != 1:
                raise RollingError("计划状态已变化，请刷新后重试")
            append_event(conn, plan_id, user_id, {"type": event_type})

    def snapshot(self, user_id: int) -> dict[str, Any]:
        with self._db() as conn:
            rows = conn.execute(
                "SELECT * FROM rolling_plans WHERE user_id = ? ORDER BY CASE WHEN status = 'ended' THEN 1 ELSE 0 END, updated_at DESC LIMIT 50",
                (user_id,),
            ).fetchall()
            plan_ids = [row["id"] for row in rows]
            events: dict[str, list[dict[str, Any]]] = {plan_id: [] for plan_id in plan_ids}
            if plan_ids:
                placeholders = ",".join("?" for _ in plan_ids)
                event_rows = conn.execute(
                    f"SELECT * FROM rolling_plan_events WHERE plan_id IN ({placeholders}) AND user_id = ? ORDER BY id DESC",
                    (*plan_ids, user_id),
                ).fetchall()
                for event in event_rows:
                    bucket = events[event["plan_id"]]
                    if len(bucket) < 20:
                        bucket.append({
                            "id": event["id"],
                            "type": event["event_type"],
                            "price": event["price"],
                            "detail": json.loads(event["detail_json"] or "{}"),
                            "createdAt": event["created_at"],
                        })
        result = []
        now = time.time()
        with self._lock:
            latest = dict(self.latest)
            market_error = self.market_error
        for row in rows:
            config = json.loads(row["config_json"])
            state = json.loads(row["state_json"])
            cached = latest.get(row["symbol"])
            current_price = cached[0] if cached else None
            fresh = bool(cached and now - cached[1] <= max(5.0, self.poll_seconds * 4))
            current_notional = None
            current_pnl = None
            estimated_margin = None
            if current_price is not None and state.get("averagePrice"):
                current_notional = Decimal(str(state["quantity"])) * current_price
                current_pnl = pnl(config, state, current_price)
                estimated_margin = current_notional / decimal_config(config, "leverage")
            result.append({
                "id": row["id"],
                "symbol": row["symbol"],
                "status": row["status"],
                "config": config,
                "state": state,
                "currentPrice": decimal_text(current_price),
                "currentNotional": decimal_text(current_notional),
                "estimatedPnl": decimal_text(current_pnl),
                "estimatedMargin": decimal_text(estimated_margin),
                "marketConnected": fresh,
                "marketAsOf": cached[1] if cached else None,
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
                "endedAt": row["ended_at"],
                "events": events[row["id"]],
            })
        return {"plans": result, "marketError": market_error}

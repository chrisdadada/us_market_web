#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import mimetypes
from contextlib import contextmanager
from datetime import date, datetime, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import parse_qs, unquote, urlparse


DB_PATH = Path(os.environ.get("APP_DB", "/var/lib/ytd-gainers/app.db"))
STATIC_ROOT = Path(os.environ.get("APP_STATIC_ROOT", str(Path(__file__).resolve().parents[1]))).resolve()
API_DATA_ROOT = Path(os.environ.get("APP_API_DATA_ROOT", str(STATIC_ROOT / "data" / "api"))).resolve()
PRODUCT_DB_ENV = os.environ.get("PRODUCT_DB") or os.environ.get("APP_PRODUCT_DB")
HOST = os.environ.get("APP_HOST", "127.0.0.1")
PORT = int(os.environ.get("APP_PORT", "8787"))
SESSION_SECRET = os.environ.get("SESSION_SECRET", "")
SESSION_TTL = int(os.environ.get("SESSION_TTL_SECONDS", str(14 * 24 * 3600)))
SUPER_ADMIN_EMAIL = os.environ.get("SUPER_ADMIN_EMAIL", "admin@meigustrategy.local").strip().lower()
SUPER_ADMIN_PASSWORD = os.environ.get("SUPER_ADMIN_PASSWORD", "")
SIGNALS_API_TOKEN = os.environ.get("SIGNALS_API_TOKEN", "")

PLANS = {"free", "paid"}
ROLES = {"user", "admin", "super_admin"}
LEGACY_PAID_PLANS = {"paid", "pro", "pro_plus"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_dumps(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 210_000)
    return b64url(salt), b64url(digest)


def verify_password(password: str, salt: str, password_hash: str) -> bool:
    _, candidate = hash_password(password, b64url_decode(salt))
    return hmac.compare_digest(candidate, password_hash)


def get_secret() -> bytes:
    if not SESSION_SECRET:
        raise RuntimeError("SESSION_SECRET is required")
    return SESSION_SECRET.encode("utf-8")


def sign_session(user_id: int, issued_at: int | None = None) -> str:
    issued_at = issued_at or int(time.time())
    payload = {"uid": user_id, "iat": issued_at, "exp": issued_at + SESSION_TTL}
    payload_part = b64url(json_dumps(payload))
    sig = hmac.new(get_secret(), payload_part.encode("ascii"), hashlib.sha256).digest()
    return f"{payload_part}.{b64url(sig)}"


def verify_session(token: str) -> int | None:
    try:
        payload_part, sig_part = token.split(".", 1)
        expected = hmac.new(get_secret(), payload_part.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(b64url(expected), sig_part):
            return None
        payload = json.loads(b64url_decode(payload_part))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return int(payload["uid"])
    except Exception:
        return None


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def product_db_candidates() -> list[Path]:
    candidates: list[Path] = []
    if PRODUCT_DB_ENV:
        candidates.append(Path(PRODUCT_DB_ENV))
    candidates.extend(
        [
            STATIC_ROOT / "data" / "product.db",
            Path("/opt/dongbimao-prod/data/product.db"),
            Path("/opt/dongbimao-dev/data/product.db"),
            Path(__file__).resolve().parents[1] / "data" / "product.db",
        ]
    )
    unique: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        resolved = candidate.expanduser().resolve()
        key = str(resolved)
        if key not in seen:
            seen.add(key)
            unique.append(resolved)
    return unique


def product_db_path() -> Path | None:
    for candidate in product_db_candidates():
        if candidate.is_file():
            return candidate
    return None


@contextmanager
def product_db() -> Iterator[sqlite3.Connection]:
    path = product_db_path()
    if not path:
        raise FileNotFoundError("product.db not found")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


def parse_json_field(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def int_param(params: dict[str, list[str]], name: str, default: int, *, minimum: int = 1, maximum: int = 500) -> int:
    raw = params.get(name, [str(default)])[0]
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def product_dataset_meta(conn: sqlite3.Connection) -> dict[str, Any]:
    info = {
        row["key"]: row["value"]
        for row in conn.execute("SELECT key, value FROM product_db_info").fetchall()
    }
    datasets = [
        {
            "name": row["name"],
            "asOf": row["as_of"],
            "generatedAt": row["generated_at"],
            "rowCount": row["row_count"],
            "sourcePath": row["source_path"],
        }
        for row in conn.execute(
            """
            SELECT name, source_path, as_of, generated_at, row_count
            FROM datasets
            ORDER BY name
            """
        ).fetchall()
    ]
    counts = parse_json_field(info.get("table_counts"), {})
    return {
        "schemaVersion": info.get("schema_version"),
        "generatedAt": info.get("generated_at"),
        "counts": counts,
        "datasets": datasets,
    }


def product_symbol_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "symbol": row["symbol"],
        "company": row["company"],
        "chineseName": row["chinese_name"],
        "sector": row["sector"],
        "marketCap": row["market_cap_label"],
        "marketCapValue": row["market_cap_value"],
        "price": row["latest_price"],
        "dollarVolume": row["latest_dollar_volume"],
        "volumeRatio": row["latest_volume_ratio"],
        "latestSource": row["latest_source"],
        "sources": parse_json_field(row["sources_json"], []),
        "updatedAt": row["updated_at"],
    }


def product_market_row_payload(row: sqlite3.Row) -> dict[str, Any]:
    payload = {
        "board": row["board"],
        "rank": row["rank"],
        "symbol": row["symbol"],
        "tradeDate": row["trade_date"],
        "company": row["company"],
        "chineseName": row["chinese_name"],
        "sector": row["sector"],
        "risk": row["risk"],
        "actionNote": row["action_note"],
        "price": row["price"],
        "changePct": row["change_pct"],
        "volume": row["volume_label"],
        "dollarVolume": row["dollar_volume"],
        "volumeRatio": row["volume_ratio"],
        "marketCap": row["market_cap_label"],
        "marketCapValue": row["market_cap_value"],
    }
    if row["board"] == "ytd":
        payload["changeYtd"] = row["change_pct"]
    else:
        payload["change"] = row["change_pct"]
    return payload


def product_raw_payload(conn: sqlite3.Connection, name: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT payload_json FROM raw_payloads WHERE name = ?", (name,)).fetchone()
    if not row:
        return None
    payload = parse_json_field(row["payload_json"], None)
    return payload if isinstance(payload, dict) else None


def product_market_board_payload(conn: sqlite3.Connection, board: str, limit: int = 500) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT *
        FROM market_board_rows
        WHERE board = ?
        ORDER BY rank ASC
        LIMIT ?
        """,
        (board, limit),
    ).fetchall()
    return [product_market_row_payload(row) for row in rows]


def product_bootstrap_payload(conn: sqlite3.Connection) -> dict[str, Any]:
    meta = product_dataset_meta(conn)
    ytd_raw = product_raw_payload(conn, "ytd-gainers") or {}
    movers_raw = product_raw_payload(conn, "market-movers") or {}
    core_raw = product_raw_payload(conn, "core-signals")
    strength_raw = product_raw_payload(conn, "strength-scanner")
    strength_review_raw = product_raw_payload(conn, "strength-review")
    sector_flow_raw = product_raw_payload(conn, "sector-flow")
    market_temperature_raw = product_raw_payload(conn, "market-temperature")
    generated_at = meta.get("generatedAt")

    ytd_rows = product_market_board_payload(conn, "ytd", 500)
    ytd = {
        **ytd_raw,
        "updatedAt": ytd_raw.get("updatedAt") or generated_at,
        "rows": ytd_rows,
    }

    raw_boards = movers_raw.get("boards") if isinstance(movers_raw.get("boards"), dict) else {}
    boards: dict[str, Any] = {}
    for board in ["day", "week", "month", "volume"]:
        raw_board = raw_boards.get(board) if isinstance(raw_boards.get(board), dict) else {}
        boards[board] = {
            **raw_board,
            "rows": product_market_board_payload(conn, board, 500),
        }
    movers = {
        **movers_raw,
        "updatedAt": movers_raw.get("updatedAt") or generated_at,
        "boards": boards,
    }
    return {
        "meta": meta,
        "ytd": ytd,
        "movers": movers,
        "core": core_raw,
        "strength": strength_raw,
        "strengthReview": strength_review_raw,
        "sectorFlow": sector_flow_raw,
        "marketTemperature": market_temperature_raw,
    }


def product_sector_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "asOf": row["as_of"],
        "rank": row["rank"],
        "sector": row["sector"],
        "status": row["status"],
        "count": row["stock_count"],
        "upCount": row["up_count"],
        "downCount": row["down_count"],
        "breadthPct": row["breadth_pct"],
        "avgChangePct": row["avg_change_pct"],
        "activeValue": row["active_value"],
        "netFlowProxy": row["net_flow_proxy"],
        "inflowProxy": row["inflow_proxy"],
        "outflowProxy": row["outflow_proxy"],
        "leaders": parse_json_field(row["leaders_json"], []),
    }


def product_event_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "board": row["board"],
        "rank": row["rank"],
        "symbol": row["symbol"],
        "companyName": row["company_name"],
        "eventDate": row["event_date"],
        "eventType": row["event_type"],
        "eventLabel": row["event_label"],
        "reason": row["reason"],
        "risk": row["risk"],
        "close": row["close"],
        "signalScore": row["signal_score"],
        "return20dPct": row["return_20d_pct"],
        "fwd5dPct": row["fwd_5d_pct"],
        "fwd20dPct": row["fwd_20d_pct"],
        "fwd60dPct": row["fwd_60d_pct"],
        "liquidity": row["liquidity_label"],
        "priceTargetUpsidePct": row["price_target_upside_pct"],
        "shortInterest": row["short_interest"],
        "daysToCover": row["days_to_cover"],
    }


def product_earnings_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "board": row["board"],
        "rank": row["rank"],
        "symbol": row["symbol"],
        "companyName": row["company_name"],
        "score": row["score"],
        "qualityScore": row["quality_score"],
        "confluenceScore": row["confluence_score"],
        "userAngle": row["user_angle"],
        "userReason": row["user_reason"],
        "userRisk": row["user_risk"],
        "return20dPct": row["return_20d_pct"],
        "close": row["close"],
        "dollarVolume20d": row["dollar_volume_20d"],
        "latestEarningsDate": row["latest_earnings_date"],
        "latestGuidanceDate": row["latest_guidance_date"],
    }


def product_calendar_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["event_id"],
        "date": row["event_date"],
        "time": row["event_time"],
        "title": row["title"],
        "type": row["event_type"],
        "impact": row["impact"],
        "sourceName": row["source_name"],
        "relatedModules": parse_json_field(row["related_modules_json"], []),
        "relatedAssets": parse_json_field(row["related_assets_json"], []),
        "summary": row["summary"],
    }


def product_strength_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "rank": row["rank"],
        "bucket": row["bucket"],
        "symbol": row["symbol"],
        "company": row["company"],
        "exchange": row["exchange"],
        "sector": row["sector"],
        "price": row["price"],
        "score": row["score"],
        "label": row["label"],
        "action": row["action"],
        "primaryFactor": row["primary_factor"],
        "liquidity": row["liquidity_label"],
        "marketCap": row["market_cap_label"],
        "marketCapValue": row["market_cap_value"],
        "periods": parse_json_field(row["periods_json"], {}),
        "relative": parse_json_field(row["relative_json"], {}),
    }


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              email TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL,
              salt TEXT NOT NULL,
              role TEXT NOT NULL DEFAULT 'user',
              plan TEXT NOT NULL DEFAULT 'free',
              subscription_expires_at TEXT,
              created_by_user_id INTEGER,
              is_active INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              last_login_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

            CREATE TABLE IF NOT EXISTS signal_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              source TEXT NOT NULL DEFAULT 'dongbimao',
              event_type TEXT NOT NULL,
              symbol TEXT NOT NULL,
              theme TEXT,
              direction TEXT,
              direction_text TEXT,
              price TEXT,
              live_price TEXT,
              interval_value TEXT,
              interval_label TEXT,
              first_signal_at TEXT,
              current_time TEXT,
              signal_age TEXT,
              market_change_pct TEXT,
              directional_change_pct TEXT,
              max_favorable_pct TEXT,
              max_adverse_pct TEXT,
              payload_json TEXT NOT NULL,
              received_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS signal_states (
              symbol TEXT PRIMARY KEY,
              source TEXT NOT NULL DEFAULT 'dongbimao',
              theme TEXT,
              direction TEXT,
              direction_text TEXT,
              price TEXT,
              live_price TEXT,
              interval_value TEXT,
              interval_label TEXT,
              first_signal_at TEXT,
              current_time TEXT,
              signal_age TEXT,
              market_change_pct TEXT,
              directional_change_pct TEXT,
              max_favorable_pct TEXT,
              max_adverse_pct TEXT,
              last_event_type TEXT,
              updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_signal_events_symbol ON signal_events(symbol);
            CREATE INDEX IF NOT EXISTS idx_signal_events_received_at ON signal_events(received_at);
            """
        )
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "created_by_user_id" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN created_by_user_id INTEGER")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by_user_id)")
        if SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD:
            existing = conn.execute("SELECT id FROM users WHERE email = ?", (SUPER_ADMIN_EMAIL,)).fetchone()
            salt, password_hash = hash_password(SUPER_ADMIN_PASSWORD)
            timestamp = now_iso()
            if existing:
                conn.execute(
                    """
                    UPDATE users
                    SET password_hash = ?, salt = ?, role = 'super_admin', plan = 'paid',
                        is_active = 1, updated_at = ?
                    WHERE email = ?
                    """,
                    (password_hash, salt, timestamp, SUPER_ADMIN_EMAIL),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO users
                    (email, password_hash, salt, role, plan, subscription_expires_at, is_active, created_at, updated_at)
                    VALUES (?, ?, ?, 'super_admin', 'paid', NULL, 1, ?, ?)
                    """,
                    (SUPER_ADMIN_EMAIL, password_hash, salt, timestamp, timestamp),
                )


def subscription_is_active(value: Any) -> bool:
    text = str(value or "").strip()
    if not text:
        return True
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return False
    if isinstance(parsed, datetime):
        if parsed.tzinfo is None:
            return parsed.date() >= date.today()
        return parsed >= datetime.now(timezone.utc)
    return True


def current_paid_plan(row: sqlite3.Row) -> bool:
    return is_paid_plan(row["plan"]) and subscription_is_active(row["subscription_expires_at"])


def user_to_public(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "email": row["email"],
        "role": row["role"],
        "plan": "paid" if current_paid_plan(row) else "free",
        "subscriptionExpiresAt": row["subscription_expires_at"],
        "isSuperAdmin": row["role"] == "super_admin",
    }


def entitlements(row: sqlite3.Row | None) -> dict[str, bool]:
    if not row:
        return {"paid": False, "pro": False, "proPlus": False, "admin": False}
    is_admin = row["role"] in {"admin", "super_admin"}
    paid = is_admin or current_paid_plan(row)
    return {
        "paid": paid,
        "pro": paid,
        "proPlus": paid,
        "admin": is_admin,
    }


def find_user_by_id(user_id: int) -> sqlite3.Row | None:
    with db() as conn:
        return conn.execute("SELECT * FROM users WHERE id = ? AND is_active = 1", (user_id,)).fetchone()


def find_user_by_email(email: str) -> sqlite3.Row | None:
    with db() as conn:
        return conn.execute("SELECT * FROM users WHERE email = ? AND is_active = 1", (email,)).fetchone()


def normalize_expires(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
        return text
    except ValueError:
        return None


def normalize_plan(value: Any) -> str:
    plan = str(value or "free").strip().lower()
    if plan in {"pro", "pro_plus"}:
        return "paid"
    return plan if plan in PLANS else "free"


def is_paid_plan(value: Any) -> bool:
    return str(value or "free").strip().lower() in LEGACY_PAID_PLANS


def parse_percent(value: Any) -> float | None:
    text = str(value or "").strip().replace("%", "").replace("+", "").replace(",", "")
    if not text or text in {"--", "暂未出现"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def format_percent_value(value: float | None) -> str:
    if value is None:
        return "--"
    prefix = "+" if value > 0 else ""
    return f"{prefix}{value:.2f}%"


def signal_value_missing(value: Any) -> bool:
    text = str(value or "").strip()
    return not text or text in {"--", "暂不可用", "不可用", "null", "None"}


def ensure_can_write_role(admin: sqlite3.Row, role: str, target: sqlite3.Row | None = None) -> tuple[bool, str | None]:
    if role == "super_admin":
        return False, "超级管理员账号保留为系统唯一入口，不能在后台新增或调整"
    if target and target["role"] == "super_admin":
        return False, "超级管理员不能被修改或停用"
    if admin["role"] == "admin" and target and target["created_by_user_id"] != admin["id"]:
        return False, "普通管理员只能管理自己创建的用户"
    if role == "admin" and admin["role"] != "super_admin":
        return False, "只有超级管理员可以设置管理员"
    return True, None


def admin_user_payload(row: sqlite3.Row) -> dict[str, Any]:
    has_paid_access = current_paid_plan(row)
    return {
        "id": row["id"],
        "email": row["email"],
        "role": row["role"],
        "plan": "paid" if is_paid_plan(row["plan"]) else "free",
        "hasPaidAccess": has_paid_access,
        "subscriptionExpiresAt": row["subscription_expires_at"],
        "subscriptionStatus": "active" if has_paid_access else "expired" if is_paid_plan(row["plan"]) else "free",
        "isActive": bool(row["is_active"]),
        "createdAt": row["created_at"],
        "lastLoginAt": row["last_login_at"],
        "isSuperAdmin": row["role"] == "super_admin",
        "createdBy": {
            "id": row["created_by_user_id"],
            "email": row["created_by_email"] if "created_by_email" in row.keys() else None,
        },
    }


SIGNAL_FIELDS = [
    "source",
    "event_type",
    "symbol",
    "theme",
    "direction",
    "direction_text",
    "price",
    "live_price",
    "interval",
    "interval_label",
    "first_signal_at",
    "current_time",
    "signal_age",
    "market_change_pct",
    "directional_change_pct",
    "max_favorable_pct",
    "max_adverse_pct",
]


def signal_token_valid(headers: Any) -> bool:
    if not SIGNALS_API_TOKEN:
        return True
    auth = str(headers.get("Authorization", ""))
    bearer = auth.removeprefix("Bearer ").strip() if auth.startswith("Bearer ") else ""
    provided = str(headers.get("X-Signal-Token", "")).strip() or bearer
    return hmac.compare_digest(provided, SIGNALS_API_TOKEN)


def normalize_signal_payload(payload: dict[str, Any]) -> dict[str, str]:
    normalized = {field: str(payload.get(field, "") or "").strip() for field in SIGNAL_FIELDS}
    normalized["source"] = normalized["source"] or "dongbimao"
    normalized["event_type"] = normalized["event_type"] or "signal"
    normalized["symbol"] = normalized["symbol"].upper()
    normalized["direction"] = normalized["direction"].lower()
    if normalized["direction"] not in {"long", "short", "neutral", ""}:
        normalized["direction"] = str(payload.get("direction", "") or "").strip().lower()
    return normalized


def signal_event_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "source": row["source"],
        "eventType": row["event_type"],
        "symbol": row["symbol"],
        "theme": row["theme"],
        "direction": row["direction"],
        "directionText": row["direction_text"],
        "price": row["price"],
        "livePrice": row["live_price"],
        "interval": row["interval_value"],
        "intervalLabel": row["interval_label"],
        "firstSignalAt": row["first_signal_at"],
        "currentTime": row["current_time"],
        "signalAge": row["signal_age"],
        "marketChangePct": row["market_change_pct"],
        "directionalChangePct": row["directional_change_pct"],
        "maxFavorablePct": row["max_favorable_pct"],
        "maxAdversePct": row["max_adverse_pct"],
        "receivedAt": row["received_at"],
    }


def signal_state_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "source": row["source"],
        "eventType": row["last_event_type"],
        "symbol": row["symbol"],
        "theme": row["theme"],
        "direction": row["direction"],
        "directionText": row["direction_text"],
        "price": row["price"],
        "livePrice": row["live_price"],
        "interval": row["interval_value"],
        "intervalLabel": row["interval_label"],
        "firstSignalAt": row["first_signal_at"],
        "currentTime": row["current_time"],
        "signalAge": row["signal_age"],
        "marketChangePct": row["market_change_pct"],
        "directionalChangePct": row["directional_change_pct"],
        "maxFavorablePct": row["max_favorable_pct"],
        "maxAdversePct": row["max_adverse_pct"],
        "updatedAt": row["updated_at"],
    }


def upsert_signal(payload: dict[str, Any]) -> dict[str, Any]:
    signal = normalize_signal_payload(payload)
    if not signal["symbol"]:
        raise ValueError("symbol 不能为空")
    received_at = now_iso()
    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    with db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO signal_events
            (source, event_type, symbol, theme, direction, direction_text, price, live_price,
             interval_value, interval_label, first_signal_at, current_time, signal_age,
             market_change_pct, directional_change_pct, max_favorable_pct, max_adverse_pct,
             payload_json, received_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                signal["source"], signal["event_type"], signal["symbol"], signal["theme"],
                signal["direction"], signal["direction_text"], signal["price"], signal["live_price"],
                signal["interval"], signal["interval_label"], signal["first_signal_at"],
                signal["current_time"], signal["signal_age"], signal["market_change_pct"],
                signal["directional_change_pct"], signal["max_favorable_pct"],
                signal["max_adverse_pct"], payload_json, received_at,
            ),
        )
        existing_state = conn.execute("SELECT * FROM signal_states WHERE symbol = ?", (signal["symbol"],)).fetchone()
        live_price = signal["live_price"]
        market_change_pct = signal["market_change_pct"]
        directional_change_pct = signal["directional_change_pct"]
        if existing_state:
            if signal_value_missing(live_price):
                live_price = existing_state["live_price"] or live_price
            if signal_value_missing(market_change_pct):
                market_change_pct = existing_state["market_change_pct"] or market_change_pct
            if signal_value_missing(directional_change_pct):
                directional_change_pct = existing_state["directional_change_pct"] or directional_change_pct
        state_values = (
            signal["source"], signal["theme"], signal["direction"], signal["direction_text"],
            signal["price"], live_price, signal["interval"], signal["interval_label"],
            signal["first_signal_at"], signal["current_time"], signal["signal_age"],
            market_change_pct, directional_change_pct,
            signal["max_favorable_pct"], signal["max_adverse_pct"], signal["event_type"],
            received_at, signal["symbol"],
        )
        if existing_state:
            conn.execute(
                """
                UPDATE signal_states
                SET source = ?, theme = ?, direction = ?, direction_text = ?, price = ?, live_price = ?,
                    interval_value = ?, interval_label = ?, first_signal_at = ?, current_time = ?,
                    signal_age = ?, market_change_pct = ?, directional_change_pct = ?,
                    max_favorable_pct = ?, max_adverse_pct = ?, last_event_type = ?, updated_at = ?
                WHERE symbol = ?
                """,
                state_values,
            )
        else:
            conn.execute(
                """
                INSERT INTO signal_states
                (source, theme, direction, direction_text, price, live_price, interval_value,
                 interval_label, first_signal_at, current_time, signal_age, market_change_pct,
                 directional_change_pct, max_favorable_pct, max_adverse_pct, last_event_type, updated_at, symbol)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                state_values,
            )
        event = conn.execute("SELECT * FROM signal_events WHERE id = ?", (cursor.lastrowid,)).fetchone()
        state = conn.execute("SELECT * FROM signal_states WHERE symbol = ?", (signal["symbol"],)).fetchone()
    return {"event": signal_event_payload(event), "state": signal_state_payload(state)}


def read_signal_dashboard() -> dict[str, Any]:
    with db() as conn:
        feed_rows = conn.execute(
            "SELECT * FROM signal_events ORDER BY id DESC LIMIT 200"
        ).fetchall()
        state_rows = conn.execute(
            "SELECT * FROM signal_states ORDER BY updated_at DESC LIMIT 200"
        ).fetchall()
    states = [signal_state_payload(row) for row in state_rows]
    feed = [signal_event_payload(row) for row in feed_rows]
    for item in states:
        recent_valid = next(
            (
                event for event in feed
                if event["symbol"] == item["symbol"]
                and not signal_value_missing(event["livePrice"])
                and not signal_value_missing(event["marketChangePct"])
            ),
            None,
        )
        if recent_valid:
            if signal_value_missing(item["livePrice"]):
                item["livePrice"] = recent_valid["livePrice"]
            if signal_value_missing(item["marketChangePct"]):
                item["marketChangePct"] = recent_valid["marketChangePct"]
            if signal_value_missing(item["directionalChangePct"]):
                item["directionalChangePct"] = recent_valid["directionalChangePct"]
    switches = [item for item in feed if item["eventType"] in {"switch", "direction_change"}]
    review_queue = [item for item in states if item["intervalLabel"]][:12]
    sector_map: dict[str, dict[str, Any]] = {}
    for item in states:
        theme = item["theme"] or "未分类"
        if theme not in sector_map:
            sector_map[theme] = {
                "theme": theme,
                "total": 0,
                "long": 0,
                "short": 0,
                "symbols": [],
                "capturedValues": [],
                "bestSymbol": None,
                "bestCapture": None,
            }
        sector_map[theme]["total"] += 1
        if item["direction"] == "long":
            sector_map[theme]["long"] += 1
        if item["direction"] == "short":
            sector_map[theme]["short"] += 1
        sector_map[theme]["symbols"].append(item["symbol"])
        capture_value = parse_percent(item["maxFavorablePct"] or item["directionalChangePct"] or item["marketChangePct"])
        if capture_value is not None:
            sector_map[theme]["capturedValues"].append(capture_value)
            if sector_map[theme]["bestCapture"] is None or capture_value > sector_map[theme]["bestCapture"]:
                sector_map[theme]["bestCapture"] = capture_value
                sector_map[theme]["bestSymbol"] = item["symbol"]
    sectors = []
    for item in sector_map.values():
        values = item.pop("capturedValues")
        best_capture = item.pop("bestCapture")
        item["capturedMovePct"] = format_percent_value(best_capture)
        item["averageCapturedPct"] = format_percent_value((sum(values) / len(values)) if values else None)
        item["longRatioPct"] = format_percent_value((item["long"] / item["total"] * 100) if item["total"] else None)
        sectors.append(item)
    sectors = sorted(sectors, key=lambda item: (item["total"], parse_percent(item["capturedMovePct"]) or -999), reverse=True)[:8]
    latest_state = states[0] if states else None
    directional_values = [
        value
        for value in (parse_percent(item["directionalChangePct"] or item["marketChangePct"]) for item in states)
        if value is not None
    ]
    favorable_values = [
        value
        for value in (parse_percent(item["maxFavorablePct"] or item["directionalChangePct"] or item["marketChangePct"]) for item in states)
        if value is not None
    ]
    positive_count = sum(1 for value in directional_values if value > 0)
    positive_ratio = (positive_count / len(directional_values) * 100) if directional_values else None
    avg_directional = (sum(directional_values) / len(directional_values)) if directional_values else None
    best_capture = max(favorable_values) if favorable_values else None
    return {
        "overview": {
            "activeSymbols": len(states),
            "switches24h": len(switches),
            "reviewQueue": len(review_queue),
            "eventCount": len(feed),
            "capturedMovePct": format_percent_value(best_capture),
            "averageDirectionalPct": format_percent_value(avg_directional),
            "positiveRatioPct": format_percent_value(positive_ratio),
        },
        "feed": feed,
        "states": states,
        "sectors": sectors,
        "reviewQueue": review_queue,
        "latestState": latest_state,
    }


TRADE_RECORDS = [
    {"symbol": "CRCL", "direction": "做多", "theme": "稳定币", "profit": "+264,992 USD", "period": "主升段", "reason": "稳定币主线确认后进入自选，趋势延续时提高权重。"},
    {"symbol": "BMNR", "direction": "上行观察", "theme": "加密美股", "profit": "+302,824 USD", "period": "趋势段", "reason": "加密资产代理标的，波动放大时需要控制单一方向暴露。"},
    {"symbol": "TSLA", "direction": "做多", "theme": "特斯拉", "profit": "+334,641 USD", "period": "波段", "reason": "关键支撑位确认后跟随趋势，跌破规则线降低头寸。"},
    {"symbol": "NBIS", "direction": "做多", "theme": "AI 算力", "profit": "持仓中", "period": "跟踪中", "reason": "AI 云算力方向，高弹性持仓，按风险预算动态调整。"},
]


class Handler(BaseHTTPRequestHandler):
    server_version = "YTDAuthAPI/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def send_json(self, payload: Any, status: int = 200, cookies: list[str] | None = None) -> None:
        body = json_dumps(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for cookie in cookies or []:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def send_static(self, request_path: str) -> None:
        parsed = urlparse(request_path)
        raw_path = unquote(parsed.path)
        if raw_path.startswith("/data/") and raw_path.endswith(".json"):
            self.send_error(HTTPStatus.NOT_FOUND, "Static JSON datasets are not public")
            return
        relative = raw_path.lstrip("/") or "index.html"
        candidate = (STATIC_ROOT / relative).resolve()

        if not str(candidate).startswith(str(STATIC_ROOT)) or not candidate.is_file():
            if "." not in Path(relative).name:
                candidate = STATIC_ROOT / "index.html"
            else:
                self.send_error(HTTPStatus.NOT_FOUND, "File not found")
                return

        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        body = candidate.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8" if content_type.startswith("text/") or content_type == "application/javascript" else content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache" if candidate.name == "index.html" else "public, max-age=60")
        self.end_headers()
        self.wfile.write(body)

    def send_api_data(self, request_path: str) -> None:
        parsed = urlparse(request_path)
        parts = [part for part in unquote(parsed.path).split("/") if part]
        name = "manifest" if len(parts) <= 2 else parts[2]
        aliases = {"data": "manifest", "status": "health"}
        name = aliases.get(name, name)
        if not name.replace("-", "").replace("_", "").isalnum():
            self.send_json({"error": "数据集名称不正确"}, HTTPStatus.BAD_REQUEST)
            return
        candidate = (API_DATA_ROOT / f"{name}.json").resolve()
        if not str(candidate).startswith(str(API_DATA_ROOT)) or not candidate.is_file():
            self.send_json({"error": "数据集不存在", "dataset": name}, HTTPStatus.NOT_FOUND)
            return
        try:
            payload = json.loads(candidate.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            self.send_json({"error": "数据集 JSON 格式错误", "dataset": name}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        self.send_json(payload)

    def send_product_api(self, request_path: str) -> None:
        parsed = urlparse(request_path)
        parts = [part for part in unquote(parsed.path).split("/") if part]
        params = parse_qs(parsed.query)
        try:
            with product_db() as conn:
                if len(parts) == 2 or (len(parts) == 3 and parts[2] in {"health", "meta"}):
                    meta = product_dataset_meta(conn)
                    self.send_json({"ok": True, **meta})
                    return

                if len(parts) >= 3 and parts[2] == "bootstrap":
                    self.send_json(product_bootstrap_payload(conn))
                    return

                if len(parts) >= 4 and parts[2] == "raw":
                    name = parts[3]
                    if not re.fullmatch(r"[a-z0-9-]+", name):
                        self.send_json({"error": "数据集名称不正确"}, HTTPStatus.BAD_REQUEST)
                        return
                    payload = product_raw_payload(conn, name)
                    if payload is None:
                        self.send_json({"error": "数据集不存在", "dataset": name}, HTTPStatus.NOT_FOUND)
                        return
                    self.send_json(payload)
                    return

                if len(parts) >= 3 and parts[2] == "symbols":
                    if len(parts) >= 4:
                        self.send_product_symbol_detail(conn, parts[3])
                        return
                    self.send_product_symbol_search(conn, params)
                    return

                if len(parts) >= 3 and parts[2] == "market":
                    self.send_product_market_board(conn, params)
                    return

                if len(parts) >= 3 and parts[2] == "sectors":
                    self.send_product_sectors(conn, params)
                    return

                if len(parts) >= 3 and parts[2] == "calendar":
                    self.send_product_calendar(conn, params)
                    return

                if len(parts) >= 3 and parts[2] == "events":
                    self.send_product_events(conn, params)
                    return

                self.send_json({"error": "产品数据接口不存在"}, HTTPStatus.NOT_FOUND)
        except FileNotFoundError:
            self.send_json({"error": "产品数据库不存在，请先运行 scripts/build_product_db.py", "code": "product_db_missing"}, HTTPStatus.SERVICE_UNAVAILABLE)
        except sqlite3.Error as exc:
            self.send_json({"error": f"产品数据库读取失败：{exc}", "code": "product_db_error"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def send_product_symbol_search(self, conn: sqlite3.Connection, params: dict[str, list[str]]) -> None:
        limit = int_param(params, "limit", 50, maximum=3000)
        query = str(params.get("query", [""])[0] or params.get("q", [""])[0]).strip().upper()
        sector = str(params.get("sector", [""])[0]).strip()
        where = []
        values: list[Any] = []
        if query:
            like = f"%{query}%"
            where.append("(symbol LIKE ? OR UPPER(COALESCE(company, '')) LIKE ? OR UPPER(COALESCE(chinese_name, '')) LIKE ?)")
            values.extend([like, like, like])
        if sector:
            where.append("sector = ?")
            values.append(sector)
        where_sql = "WHERE " + " AND ".join(where) if where else ""
        rows = conn.execute(
            f"""
            SELECT *
            FROM symbols
            {where_sql}
            ORDER BY
              CASE WHEN symbol = ? THEN 0 WHEN symbol LIKE ? THEN 1 ELSE 2 END,
              COALESCE(market_cap_value, 0) DESC,
              symbol
            LIMIT ?
            """,
            (*values, query, f"{query}%", limit),
        ).fetchall()
        self.send_json({"rows": [product_symbol_payload(row) for row in rows]})

    def send_product_symbol_detail(self, conn: sqlite3.Connection, symbol: str) -> None:
        target = str(symbol or "").strip().upper()
        profile = conn.execute("SELECT * FROM symbols WHERE symbol = ?", (target,)).fetchone()
        if not profile:
            self.send_json({"error": "股票不存在", "symbol": target}, HTTPStatus.NOT_FOUND)
            return
        market_rows = conn.execute(
            """
            SELECT *
            FROM market_board_rows
            WHERE symbol = ?
            ORDER BY CASE board
              WHEN 'day' THEN 1
              WHEN 'week' THEN 2
              WHEN 'month' THEN 3
              WHEN 'ytd' THEN 4
              WHEN 'volume' THEN 5
              ELSE 99
            END
            """,
            (target,),
        ).fetchall()
        peers = conn.execute(
            """
            SELECT *
            FROM symbols
            WHERE sector = ? AND symbol != ?
            ORDER BY COALESCE(market_cap_value, 0) DESC
            LIMIT 8
            """,
            (profile["sector"], target),
        ).fetchall() if profile["sector"] else []
        events = conn.execute(
            """
            SELECT *
            FROM stock_event_rows
            WHERE symbol = ?
            ORDER BY event_date DESC, rank ASC
            LIMIT 10
            """,
            (target,),
        ).fetchall()
        earnings = conn.execute(
            """
            SELECT *
            FROM earnings_quality_rows
            WHERE symbol = ?
            ORDER BY CASE board WHEN 'quality' THEN 1 WHEN 'confluence' THEN 2 ELSE 99 END
            LIMIT 10
            """,
            (target,),
        ).fetchall()
        strength = conn.execute("SELECT * FROM strength_rows WHERE symbol = ?", (target,)).fetchone()
        self.send_json(
            {
                "profile": product_symbol_payload(profile),
                "marketRows": [product_market_row_payload(row) for row in market_rows],
                "peers": [product_symbol_payload(row) for row in peers],
                "events": [product_event_payload(row) for row in events],
                "earnings": [product_earnings_payload(row) for row in earnings],
                "strength": product_strength_payload(strength) if strength else None,
            }
        )

    def send_product_market_board(self, conn: sqlite3.Connection, params: dict[str, list[str]]) -> None:
        board = str(params.get("board", ["ytd"])[0] or "ytd")
        if board not in {"ytd", "day", "week", "month", "volume"}:
            self.send_json({"error": "榜单不存在", "board": board}, HTTPStatus.BAD_REQUEST)
            return
        limit = int_param(params, "limit", 100, maximum=500)
        sector = str(params.get("sector", [""])[0]).strip()
        where = ["board = ?"]
        values: list[Any] = [board]
        if sector:
            where.append("sector = ?")
            values.append(sector)
        rows = conn.execute(
            f"""
            SELECT *
            FROM market_board_rows
            WHERE {" AND ".join(where)}
            ORDER BY rank ASC
            LIMIT ?
            """,
            (*values, limit),
        ).fetchall()
        self.send_json({"board": board, "rows": [product_market_row_payload(row) for row in rows]})

    def send_product_sectors(self, conn: sqlite3.Connection, params: dict[str, list[str]]) -> None:
        limit = int_param(params, "limit", 20, maximum=100)
        include_unknown = str(params.get("includeUnknown", ["false"])[0]).lower() in {"1", "true", "yes"}
        where_sql = "" if include_unknown else "WHERE sector NOT IN ('未分类', '板块待补', '--')"
        rows = conn.execute(
            f"""
            SELECT *
            FROM sector_flow_rows
            {where_sql}
            ORDER BY COALESCE(net_flow_proxy, 0) DESC, rank ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        self.send_json({"rows": [product_sector_payload(row) for row in rows]})

    def send_product_calendar(self, conn: sqlite3.Connection, params: dict[str, list[str]]) -> None:
        limit = int_param(params, "limit", 50, maximum=200)
        impact = str(params.get("impact", [""])[0]).strip()
        where = []
        values: list[Any] = []
        if impact:
            where.append("impact = ?")
            values.append(impact)
        where_sql = "WHERE " + " AND ".join(where) if where else ""
        rows = conn.execute(
            f"""
            SELECT *
            FROM calendar_events
            {where_sql}
            ORDER BY event_date ASC, event_time ASC, title ASC
            LIMIT ?
            """,
            (*values, limit),
        ).fetchall()
        self.send_json({"rows": [product_calendar_payload(row) for row in rows]})

    def send_product_events(self, conn: sqlite3.Connection, params: dict[str, list[str]]) -> None:
        limit = int_param(params, "limit", 100, maximum=500)
        board = str(params.get("board", [""])[0]).strip()
        where = []
        values: list[Any] = []
        if board:
            where.append("board = ?")
            values.append(board)
        where_sql = "WHERE " + " AND ".join(where) if where else ""
        rows = conn.execute(
            f"""
            SELECT *
            FROM stock_event_rows
            {where_sql}
            ORDER BY COALESCE(signal_score, 0) DESC, rank ASC
            LIMIT ?
            """,
            (*values, limit),
        ).fetchall()
        self.send_json({"rows": [product_event_payload(row) for row in rows]})

    def current_user(self) -> sqlite3.Row | None:
        cookie = SimpleCookie(self.headers.get("Cookie"))
        morsel = cookie.get("mg_session")
        if not morsel:
            return None
        user_id = verify_session(morsel.value)
        if not user_id:
            return None
        return find_user_by_id(user_id)

    def require_user(self) -> sqlite3.Row | None:
        user = self.current_user()
        if not user:
            self.send_json({"error": "未登录", "code": "unauthenticated"}, HTTPStatus.UNAUTHORIZED)
            return None
        return user

    def require_admin(self) -> sqlite3.Row | None:
        user = self.require_user()
        if not user:
            return None
        if user["role"] not in {"admin", "super_admin"}:
            self.send_json({"error": "无管理员权限", "code": "forbidden"}, HTTPStatus.FORBIDDEN)
            return None
        return user

    def do_GET(self) -> None:
        if self.path == "/api/health":
            self.send_json({"ok": True, "time": now_iso()})
            return

        if self.path == "/api/auth/status":
            user = self.current_user()
            self.send_json(
                {
                    "authenticated": bool(user),
                    "user": user_to_public(user) if user else None,
                    "entitlements": entitlements(user),
                }
            )
            return

        if self.path == "/api/pro/trade-records":
            user = self.require_user()
            if not user:
                return
            rights = entitlements(user)
            if not rights["paid"]:
                self.send_json({"error": "需要付费会员权限", "code": "upgrade_required"}, HTTPStatus.FORBIDDEN)
                return
            self.send_json({"records": TRADE_RECORDS})
            return

        if self.path == "/api/data" or self.path.startswith("/api/data/"):
            self.send_api_data(self.path)
            return

        if self.path == "/api/product" or self.path.startswith("/api/product/"):
            self.send_product_api(self.path)
            return

        if self.path == "/api/signals":
            self.send_json(read_signal_dashboard())
            return

        if self.path == "/api/admin/users":
            user = self.require_admin()
            if not user:
                return
            with db() as conn:
                where_sql = ""
                params: tuple[Any, ...] = ()
                if user["role"] != "super_admin":
                    where_sql = "WHERE u.created_by_user_id = ? OR u.id = ?"
                    params = (user["id"], user["id"])
                rows = conn.execute(
                    """
                    SELECT u.id, u.email, u.role, u.plan, u.subscription_expires_at, u.created_by_user_id,
                           u.is_active, u.created_at, u.last_login_at, c.email AS created_by_email
                    FROM users u
                    LEFT JOIN users c ON c.id = u.created_by_user_id
                    """ + where_sql + """
                    ORDER BY u.id DESC
                    LIMIT 200
                    """,
                    params,
                ).fetchall()
            users = [admin_user_payload(row) for row in rows]
            performance_map: dict[str, dict[str, Any]] = {}
            for item in users:
                creator_email = item["createdBy"]["email"] or "系统 / 超级管理员"
                creator_id = item["createdBy"]["id"] or 0
                key = f"{creator_id}:{creator_email}"
                if key not in performance_map:
                    performance_map[key] = {
                        "creatorId": creator_id,
                        "creatorEmail": creator_email,
                        "total": 0,
                        "active": 0,
                        "paid": 0,
                    }
                performance_map[key]["total"] += 1
                performance_map[key]["active"] += 1 if item["isActive"] else 0
                performance_map[key]["paid"] += 1 if item["hasPaidAccess"] else 0
            self.send_json(
                {
                    "users": users,
                    "summary": {
                        "total": len(users),
                        "active": sum(1 for item in users if item["isActive"]),
                        "paid": sum(1 for item in users if item["hasPaidAccess"]),
                        "admin": sum(1 for item in users if item["role"] in {"admin", "super_admin"}),
                    },
                    "performance": sorted(
                        performance_map.values(),
                        key=lambda item: (item["paid"], item["active"], item["total"]),
                        reverse=True,
                    ),
                }
            )
            return

        if self.path.startswith("/api/"):
            self.send_json({"error": "接口不存在"}, HTTPStatus.NOT_FOUND)
            return

        self.send_static(self.path)

    def do_POST(self) -> None:
        if self.path == "/api/auth/login":
            try:
                payload = self.read_json()
            except Exception:
                self.send_json({"error": "请求格式错误"}, HTTPStatus.BAD_REQUEST)
                return
            email = str(payload.get("email", "")).strip().lower()
            password = str(payload.get("password", ""))
            user = find_user_by_email(email) if email else None
            if not user or not verify_password(password, user["salt"], user["password_hash"]):
                self.send_json({"error": "账号或密码不正确"}, HTTPStatus.UNAUTHORIZED)
                return
            with db() as conn:
                conn.execute("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?", (now_iso(), now_iso(), user["id"]))
            token = sign_session(int(user["id"]))
            cookie = f"mg_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_TTL}"
            fresh_user = find_user_by_id(int(user["id"]))
            self.send_json(
                {
                    "authenticated": True,
                    "user": user_to_public(fresh_user),
                    "entitlements": entitlements(fresh_user),
                },
                cookies=[cookie],
            )
            return

        if self.path == "/api/auth/logout":
            self.send_json(
                {"ok": True},
                cookies=["mg_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"],
            )
            return

        if self.path == "/api/signals":
            if not signal_token_valid(self.headers):
                self.send_json({"error": "信号接口 token 不正确", "code": "invalid_signal_token"}, HTTPStatus.UNAUTHORIZED)
                return
            try:
                payload = self.read_json()
                result = upsert_signal(payload)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception as exc:
                self.send_json({"error": f"信号入库失败：{exc}"}, HTTPStatus.BAD_REQUEST)
                return
            self.send_json({"ok": True, **result}, HTTPStatus.CREATED)
            return

        if self.path == "/api/admin/users/update-plan":
            admin = self.require_admin()
            if not admin:
                return
            payload = self.read_json()
            user_id = int(payload.get("userId", 0))
            plan = normalize_plan(payload.get("plan", "free"))
            role = str(payload.get("role", "user"))
            subscription_expires_at = normalize_expires(payload.get("subscriptionExpiresAt"))
            is_active = 1 if payload.get("isActive", True) else 0
            if plan not in PLANS or role not in ROLES:
                self.send_json({"error": "权限参数不正确"}, HTTPStatus.BAD_REQUEST)
                return
            with db() as conn:
                target = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                if not target:
                    self.send_json({"error": "用户不存在"}, HTTPStatus.NOT_FOUND)
                    return
                allowed, message = ensure_can_write_role(admin, role, target)
                if not allowed:
                    self.send_json({"error": message}, HTTPStatus.FORBIDDEN)
                    return
                conn.execute(
                    """
                    UPDATE users
                    SET plan = ?, role = ?, subscription_expires_at = ?, is_active = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (plan, role, subscription_expires_at, is_active, now_iso(), user_id),
                )
                fresh = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            self.send_json({"ok": True, "user": admin_user_payload(fresh)})
            return

        if self.path == "/api/admin/users/create":
            admin = self.require_admin()
            if not admin:
                return
            payload = self.read_json()
            email = str(payload.get("email", "")).strip().lower()
            password = str(payload.get("password", ""))
            role = str(payload.get("role", "user"))
            plan = normalize_plan(payload.get("plan", "free"))
            subscription_expires_at = normalize_expires(payload.get("subscriptionExpiresAt"))
            is_active = 1 if payload.get("isActive", True) else 0
            if not email or "@" not in email:
                self.send_json({"error": "邮箱格式不正确"}, HTTPStatus.BAD_REQUEST)
                return
            if len(password) < 8:
                self.send_json({"error": "密码至少 8 位"}, HTTPStatus.BAD_REQUEST)
                return
            if plan not in PLANS or role not in ROLES:
                self.send_json({"error": "权限参数不正确"}, HTTPStatus.BAD_REQUEST)
                return
            allowed, message = ensure_can_write_role(admin, role)
            if not allowed:
                self.send_json({"error": message}, HTTPStatus.FORBIDDEN)
                return
            salt, password_hash = hash_password(password)
            timestamp = now_iso()
            try:
                with db() as conn:
                    cursor = conn.execute(
                        """
                        INSERT INTO users
                        (email, password_hash, salt, role, plan, subscription_expires_at, created_by_user_id, is_active, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (email, password_hash, salt, role, plan, subscription_expires_at, admin["id"], is_active, timestamp, timestamp),
                    )
                    fresh = conn.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
            except sqlite3.IntegrityError:
                self.send_json({"error": "该邮箱已存在"}, HTTPStatus.CONFLICT)
                return
            self.send_json({"ok": True, "user": admin_user_payload(fresh)}, HTTPStatus.CREATED)
            return

        if self.path == "/api/admin/users/reset-password":
            admin = self.require_admin()
            if not admin:
                return
            payload = self.read_json()
            user_id = int(payload.get("userId", 0))
            password = str(payload.get("password", ""))
            if len(password) < 8:
                self.send_json({"error": "密码至少 8 位"}, HTTPStatus.BAD_REQUEST)
                return
            with db() as conn:
                target = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                if not target:
                    self.send_json({"error": "用户不存在"}, HTTPStatus.NOT_FOUND)
                    return
                if target["role"] == "super_admin" and admin["id"] != target["id"]:
                    self.send_json({"error": "不能重置超级管理员密码"}, HTTPStatus.FORBIDDEN)
                    return
                if admin["role"] == "admin" and target["created_by_user_id"] != admin["id"]:
                    self.send_json({"error": "普通管理员只能管理自己创建的用户"}, HTTPStatus.FORBIDDEN)
                    return
                salt, password_hash = hash_password(password)
                conn.execute(
                    "UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?",
                    (password_hash, salt, now_iso(), user_id),
                )
            self.send_json({"ok": True})
            return

        self.send_json({"error": "接口不存在"}, HTTPStatus.NOT_FOUND)


def main() -> None:
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"auth api listening on http://{HOST}:{PORT}, db={DB_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    main()

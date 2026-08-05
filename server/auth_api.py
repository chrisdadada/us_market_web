#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import posixpath
import re
import secrets
import sqlite3
import threading
import time
import mimetypes
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import parse_qs, quote, urlencode, unquote, urlparse

import funding_scanner
import open_portfolio


DB_PATH = Path(os.environ.get("APP_DB", "/var/lib/ytd-gainers/app.db"))
STATIC_ROOT = Path(os.environ.get("APP_STATIC_ROOT", str(Path(__file__).resolve().parents[1]))).resolve()
API_DATA_ROOT = Path(os.environ.get("APP_API_DATA_ROOT", str(STATIC_ROOT / "data" / "api"))).resolve()
PRODUCT_DB_ENV = os.environ.get("PRODUCT_DB") or os.environ.get("APP_PRODUCT_DB")
UPLOAD_ROOT = Path(os.environ.get("APP_UPLOAD_ROOT", "/var/lib/ytd-gainers/uploads")).resolve()
UPLOAD_MAX_BYTES = int(os.environ.get("APP_UPLOAD_MAX_BYTES", str(8 * 1024 * 1024)))
HOST = os.environ.get("APP_HOST", "127.0.0.1")
PORT = int(os.environ.get("APP_PORT", "8787"))
SESSION_SECRET = os.environ.get("SESSION_SECRET", "")
SESSION_TTL = int(os.environ.get("SESSION_TTL_SECONDS", str(14 * 24 * 3600)))
REGISTER_IP_LIMIT = int(os.environ.get("REGISTER_IP_LIMIT", "12"))
REGISTER_IP_WINDOW_SECONDS = int(os.environ.get("REGISTER_IP_WINDOW_SECONDS", str(60 * 60)))
REGISTER_EMAIL_LIMIT = int(os.environ.get("REGISTER_EMAIL_LIMIT", "3"))
REGISTER_EMAIL_WINDOW_SECONDS = int(os.environ.get("REGISTER_EMAIL_WINDOW_SECONDS", str(60 * 60)))
LOGIN_FAIL_IP_LIMIT = int(os.environ.get("LOGIN_FAIL_IP_LIMIT", "30"))
LOGIN_FAIL_EMAIL_LIMIT = int(os.environ.get("LOGIN_FAIL_EMAIL_LIMIT", "10"))
LOGIN_FAIL_WINDOW_SECONDS = int(os.environ.get("LOGIN_FAIL_WINDOW_SECONDS", str(15 * 60)))
PASSWORD_RESET_IP_LIMIT = int(os.environ.get("PASSWORD_RESET_IP_LIMIT", "5"))
PASSWORD_RESET_EMAIL_LIMIT = int(os.environ.get("PASSWORD_RESET_EMAIL_LIMIT", "3"))
PASSWORD_RESET_WINDOW_SECONDS = int(os.environ.get("PASSWORD_RESET_WINDOW_SECONDS", str(60 * 60)))
PASSWORD_RESET_TTL_SECONDS = int(os.environ.get("PASSWORD_RESET_TTL_SECONDS", str(30 * 60)))
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
MAIL_FROM = os.environ.get("MAIL_FROM", "")
PUBLIC_SITE_URL = os.environ.get("PUBLIC_SITE_URL", "")
EMAIL_MAX_LENGTH = 254
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
SUPER_ADMIN_EMAIL = os.environ.get("SUPER_ADMIN_EMAIL", "admin@meigustrategy.local").strip().lower()
SUPER_ADMIN_PASSWORD = os.environ.get("SUPER_ADMIN_PASSWORD", "")
SIGNALS_API_TOKEN = os.environ.get("SIGNALS_API_TOKEN", "")
MARKET_OPINION_SECTIONS = {
    "weekly": "周度前瞻",
    "premarket": "盘前前瞻",
    "daily": "每日个股行情观点",
    "research": "研报解析",
    "postmarket": "盘后复盘延展",
    "journal": "交易日记",
}
ALLOWED_UPLOAD_MIMES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

PLANS = {"free", "paid", "monthly", "yearly"}
ROLES = {"user", "admin", "super_admin"}
LEGACY_PAID_PLANS = {"paid", "pro", "pro_plus", "monthly", "yearly"}
REGISTERED_DATASETS = {"market-temperature", "macro-series"}
PAID_DATASETS = {"strength-scanner", "strength-review", "crypto-etf-flows"}
US_STOCK_COURSE_TITLES = ("美股定投课程", "美股投资框架课")
MARKET_OPINION_STATUSES = {"published", "draft"}
COURSE_STATUSES = {"published", "draft"}
COURSE_PROGRESS_STATUSES = {"updating", "finished"}
COURSE_VIDEO_STATUSES = {"processing", "ready", "failed"}
COURSE_COS_SECRET_ID = os.environ.get("COURSE_COS_SECRET_ID") or os.environ.get("TENCENT_COS_SECRET_ID") or ""
COURSE_COS_SECRET_KEY = os.environ.get("COURSE_COS_SECRET_KEY") or os.environ.get("TENCENT_COS_SECRET_KEY") or ""
COURSE_COS_BUCKET = os.environ.get("COURSE_COS_BUCKET") or os.environ.get("TENCENT_COS_BUCKET") or ""
COURSE_COS_REGION = os.environ.get("COURSE_COS_REGION") or os.environ.get("TENCENT_COS_REGION") or ""
COURSE_COS_DOMAIN = os.environ.get("COURSE_COS_DOMAIN", "").strip().rstrip("/")
COURSE_COS_SIGN_TTL = int(os.environ.get("COURSE_COS_SIGN_TTL_SECONDS", "1800"))
COURSE_HLS_SIGN_TTL = max(COURSE_COS_SIGN_TTL, 7200)
COURSE_IMAGE_SIGN_TTL = max(COURSE_COS_SIGN_TTL, 3600)
COURSE_CDN_ENABLED = os.environ.get("COURSE_CDN_ENABLED", "0") == "1"
COURSE_CDN_DOMAIN = os.environ.get("COURSE_CDN_DOMAIN", "").strip().rstrip("/")
COURSE_CDN_AUTH_KEY = os.environ.get("COURSE_CDN_AUTH_KEY", "").strip()
COURSE_CDN_SIGN_TTL = int(os.environ.get("COURSE_CDN_SIGN_TTL_SECONDS", "1800"))
COURSE_CDN_VIDEO_KEYS = {
    key.strip().lstrip("/")
    for key in re.split(r"[,\n]+", os.environ.get("COURSE_CDN_VIDEO_KEYS", ""))
    if key.strip()
}
COURSE_PLAY_REUSE_SECONDS = max(0, int(os.environ.get("COURSE_PLAY_REUSE_SECONDS", "120")))
COURSE_PLAY_OBSERVATION_WINDOW_SECONDS = max(60, int(os.environ.get("COURSE_PLAY_OBSERVATION_WINDOW_SECONDS", "600")))
COURSE_VIDEO_UPLOAD_MAX_BYTES = int(os.environ.get("COURSE_VIDEO_UPLOAD_MAX_BYTES", str(5 * 1024 * 1024 * 1024)))
COURSE_VIDEO_AUTO_PROCESS_ENABLED = os.environ.get("COURSE_VIDEO_AUTO_PROCESS_ENABLED", "0") == "1"
COURSE_VIDEO_OPTIMIZE_BITRATE_KBPS = int(os.environ.get("COURSE_VIDEO_OPTIMIZE_BITRATE_KBPS", "3000"))
COURSE_VIDEO_TARGET_BITRATE_KBPS = int(os.environ.get("COURSE_VIDEO_TARGET_BITRATE_KBPS", "2300"))
COURSE_VIDEO_MAX_WIDTH = int(os.environ.get("COURSE_VIDEO_MAX_WIDTH", "1920"))
COURSE_VIDEO_PROCESS_TIMEOUT_SECONDS = int(os.environ.get("COURSE_VIDEO_PROCESS_TIMEOUT_SECONDS", "21600"))
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
REGISTER_RATE_BUCKETS: dict[str, list[float]] = {}
REGISTER_RATE_LOCK = threading.Lock()
LOGIN_FAIL_BUCKETS: dict[str, list[float]] = {}
LOGIN_FAIL_LOCK = threading.Lock()
PASSWORD_RESET_BUCKETS: dict[str, list[float]] = {}
PASSWORD_RESET_LOCK = threading.Lock()
COURSE_PLAY_GRANTS: dict[tuple[int, int, str, str], dict[str, Any]] = {}
COURSE_PLAY_EVENTS: list[dict[str, Any]] = []
COURSE_PLAY_LOCK = threading.Lock()


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


def reset_register_rate_limits() -> None:
    with REGISTER_RATE_LOCK:
        REGISTER_RATE_BUCKETS.clear()
    with LOGIN_FAIL_LOCK:
        LOGIN_FAIL_BUCKETS.clear()
    with PASSWORD_RESET_LOCK:
        PASSWORD_RESET_BUCKETS.clear()


def register_rate_check(ip: str, email: str) -> tuple[bool, int]:
    now = time.time()
    checks = [
        (f"ip:{ip or 'unknown'}", REGISTER_IP_LIMIT, REGISTER_IP_WINDOW_SECONDS),
        (f"email:{email or 'unknown'}", REGISTER_EMAIL_LIMIT, REGISTER_EMAIL_WINDOW_SECONDS),
    ]
    with REGISTER_RATE_LOCK:
        retry_after = 0
        cleaned: dict[str, list[float]] = {}
        for key, limit, window in checks:
            if limit <= 0 or window <= 0:
                cleaned[key] = []
                continue
            attempts = [value for value in REGISTER_RATE_BUCKETS.get(key, []) if now - value < window]
            cleaned[key] = attempts
            if len(attempts) >= limit:
                oldest = min(attempts)
                retry_after = max(retry_after, max(1, int(window - (now - oldest))))
        if retry_after:
            for key, attempts in cleaned.items():
                REGISTER_RATE_BUCKETS[key] = attempts
            return False, retry_after
        for key, attempts in cleaned.items():
            attempts.append(now)
            REGISTER_RATE_BUCKETS[key] = attempts
    return True, 0


def normalize_email(email: Any) -> str:
    return str(email or "").strip().lower()


def validate_email(email: str) -> None:
    if not email or len(email) > EMAIL_MAX_LENGTH or not EMAIL_PATTERN.fullmatch(email):
        raise ValueError("邮箱格式不正确")


def validate_password(password: str) -> None:
    if len(password) < PASSWORD_MIN_LENGTH:
        raise ValueError("密码至少 8 位")
    if len(password) > PASSWORD_MAX_LENGTH:
        raise ValueError("密码不能超过 128 位")


def login_failure_retry_after(ip: str, email: str) -> int:
    now = time.time()
    checks = [
        (f"ip:{ip or 'unknown'}", LOGIN_FAIL_IP_LIMIT),
        (f"email:{email or 'unknown'}", LOGIN_FAIL_EMAIL_LIMIT),
    ]
    with LOGIN_FAIL_LOCK:
        retry_after = 0
        for key, limit in checks:
            if limit <= 0 or LOGIN_FAIL_WINDOW_SECONDS <= 0:
                LOGIN_FAIL_BUCKETS[key] = []
                continue
            attempts = [value for value in LOGIN_FAIL_BUCKETS.get(key, []) if now - value < LOGIN_FAIL_WINDOW_SECONDS]
            LOGIN_FAIL_BUCKETS[key] = attempts
            if len(attempts) >= limit:
                oldest = min(attempts)
                retry_after = max(retry_after, max(1, int(LOGIN_FAIL_WINDOW_SECONDS - (now - oldest))))
    return retry_after


def record_login_failure(ip: str, email: str) -> None:
    if LOGIN_FAIL_WINDOW_SECONDS <= 0:
        return
    now = time.time()
    checks = [
        (f"ip:{ip or 'unknown'}", LOGIN_FAIL_IP_LIMIT),
        (f"email:{email or 'unknown'}", LOGIN_FAIL_EMAIL_LIMIT),
    ]
    with LOGIN_FAIL_LOCK:
        for key, limit in checks:
            if limit <= 0:
                LOGIN_FAIL_BUCKETS[key] = []
                continue
            attempts = [value for value in LOGIN_FAIL_BUCKETS.get(key, []) if now - value < LOGIN_FAIL_WINDOW_SECONDS]
            attempts.append(now)
            LOGIN_FAIL_BUCKETS[key] = attempts


def password_reset_rate_check(ip: str, email: str) -> tuple[bool, int]:
    now = time.time()
    checks = [
        (f"ip:{ip or 'unknown'}", PASSWORD_RESET_IP_LIMIT),
        (f"email:{email or 'unknown'}", PASSWORD_RESET_EMAIL_LIMIT),
    ]
    with PASSWORD_RESET_LOCK:
        retry_after = 0
        for key, limit in checks:
            if limit <= 0 or PASSWORD_RESET_WINDOW_SECONDS <= 0:
                PASSWORD_RESET_BUCKETS[key] = []
                continue
            attempts = [value for value in PASSWORD_RESET_BUCKETS.get(key, []) if now - value < PASSWORD_RESET_WINDOW_SECONDS]
            PASSWORD_RESET_BUCKETS[key] = attempts
            if len(attempts) >= limit:
                oldest = min(attempts)
                retry_after = max(retry_after, max(1, int(PASSWORD_RESET_WINDOW_SECONDS - (now - oldest))))
        if retry_after:
            return False, retry_after
        for key in [item[0] for item in checks]:
            PASSWORD_RESET_BUCKETS.setdefault(key, []).append(now)
    return True, 0


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


def verify_session(token: str) -> dict[str, Any] | None:
    try:
        payload_part, sig_part = token.split(".", 1)
        expected = hmac.new(get_secret(), payload_part.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(b64url(expected), sig_part):
            return None
        payload = json.loads(b64url_decode(payload_part))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        int(payload["uid"])
        return payload
    except Exception:
        return None


def reset_course_play_observation() -> None:
    with COURSE_PLAY_LOCK:
        COURSE_PLAY_GRANTS.clear()
        COURSE_PLAY_EVENTS.clear()


def course_play_fingerprint(value: str) -> str:
    return hmac.new(get_secret(), str(value or "unknown").encode("utf-8"), hashlib.sha256).hexdigest()[:16]


def observed_course_play_url(
    user_id: int,
    lesson_id: int,
    video_key: str,
    client_ip: str,
    user_agent: str,
) -> tuple[str, int]:
    now = int(time.time())
    ip_key = course_play_fingerprint(client_ip)
    device_key = course_play_fingerprint(user_agent)
    cache_key = (int(user_id), int(lesson_id), str(video_key), device_key)
    window_start = now - COURSE_PLAY_OBSERVATION_WINDOW_SECONDS

    with COURSE_PLAY_LOCK:
        for key in [key for key, value in COURSE_PLAY_GRANTS.items() if int(value["reuseUntil"]) < now]:
            COURSE_PLAY_GRANTS.pop(key, None)
        COURSE_PLAY_EVENTS[:] = [event for event in COURSE_PLAY_EVENTS if int(event["at"]) >= window_start]

        grant = COURSE_PLAY_GRANTS.get(cache_key)
        reused = bool(COURSE_PLAY_REUSE_SECONDS > 0 and grant and int(grant["reuseUntil"]) >= now)
        if not reused:
            url = course_hls_playlist_url(lesson_id, video_key) if course_video_is_hls(video_key) else signed_course_video_url(video_key, now=now)
            ttl = course_video_url_ttl(video_key)
            grant = {
                "id": secrets.token_hex(8),
                "url": url,
                "urlHash": hashlib.sha256(url.encode("utf-8")).hexdigest()[:16],
                "issuedAt": now,
                "reuseUntil": now + COURSE_PLAY_REUSE_SECONDS,
                "expiresAt": now + ttl,
            }
            COURSE_PLAY_GRANTS[cache_key] = grant

        event = {
            "at": now,
            "userId": int(user_id),
            "lessonId": int(lesson_id),
            "ip": ip_key,
            "device": device_key,
            "newGrant": not reused,
        }
        COURSE_PLAY_EVENTS.append(event)
        user_events = [item for item in COURSE_PLAY_EVENTS if item["userId"] == int(user_id)]
        ip_events = [item for item in COURSE_PLAY_EVENTS if item["ip"] == ip_key]
        observation = {
            "event": "course_play_grant",
            "at": datetime.fromtimestamp(now, timezone.utc).isoformat(),
            "userId": int(user_id),
            "lessonId": int(lesson_id),
            "grantId": grant["id"],
            "urlHash": grant["urlHash"],
            "ipHash": ip_key,
            "deviceHash": device_key,
            "reused": reused,
            "recentUserRequests": len(user_events),
            "recentUserNewGrants": sum(bool(item["newGrant"]) for item in user_events),
            "recentUserIps": len({item["ip"] for item in user_events}),
            "recentIpRequests": len(ip_events),
            "recentIpUsers": len({item["userId"] for item in ip_events}),
        }

    print("course_play_observation " + json.dumps(observation, separators=(",", ":")), flush=True)
    return str(grant["url"]), max(60, int(grant["expiresAt"]) - now)


def timestamp_epoch(value: Any) -> int:
    text = str(value or "").strip()
    if not text:
        return 0
    try:
        return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return 0


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


def market_opinion_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:60] or str(int(time.time()))


def market_opinion_list(value: Any, *, upper: bool = False) -> list[str]:
    if isinstance(value, list):
        raw = value
    else:
        raw = re.split(r"[,，\n]+", str(value or ""))
    items = [str(item).strip() for item in raw if str(item).strip()]
    return [item.upper() for item in items] if upper else items


def safe_upload_filename(value: str, fallback: str = "image") -> str:
    stem = Path(str(value or fallback)).stem
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", stem).strip(".-")
    return (cleaned[:48] or fallback).lower()


def upload_root() -> Path:
    return UPLOAD_ROOT.expanduser().resolve()


def ensure_upload_child(path: Path) -> Path:
    root = upload_root()
    resolved = path.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError("上传路径不正确") from exc
    return resolved


def decode_upload_image(payload: dict[str, Any]) -> tuple[bytes, str, str]:
    mime = str(payload.get("type", "")).strip().lower()
    data = str(payload.get("data", "")).strip()
    match = re.match(r"^data:(image/(?:png|jpeg|jpg|webp|gif));base64,(.+)$", data, re.I | re.S)
    if match:
        mime = match.group(1).lower().replace("image/jpg", "image/jpeg")
        data = match.group(2)
    if mime == "image/jpg":
        mime = "image/jpeg"
    if mime not in ALLOWED_UPLOAD_MIMES:
        raise ValueError("只支持 PNG、JPG、WebP、GIF 图片")
    try:
        raw = base64.b64decode(data, validate=True)
    except Exception as exc:
        raise ValueError("图片数据不正确") from exc
    if not raw:
        raise ValueError("图片为空")
    if len(raw) > UPLOAD_MAX_BYTES:
        raise ValueError("图片太大，单张不能超过 8MB")
    return raw, mime, ALLOWED_UPLOAD_MIMES[mime]


def save_upload_image(payload: dict[str, Any]) -> dict[str, str]:
    raw, mime, ext = decode_upload_image(payload)
    if str(payload.get("scope") or "").strip().lower() == "courses":
        return upload_course_image(str(payload.get("name") or "course-cover"), mime, raw, ext)
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    root = upload_root()
    scope = str(payload.get("scope") or "opinions").strip().lower()
    if scope not in {"opinions", "courses"}:
        scope = "opinions"
    folder = ensure_upload_child(root / scope / day)
    folder.mkdir(parents=True, exist_ok=True)
    name = safe_upload_filename(str(payload.get("name", "")))
    filename = f"{int(time.time())}-{secrets.token_hex(5)}-{name}{ext}"
    path = ensure_upload_child(folder / filename)
    path.write_bytes(raw)
    relative_path = f"{scope}/{day}/{filename}"
    return {
        "url": f"/api/upload?path={quote(relative_path, safe='/._-')}",
        "mime": mime,
        "name": filename,
    }


def db_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def normalize_market_opinion_datetime(value: Any) -> str:
    text = str(value or "").strip().replace("T", " ")
    if not text:
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        return f"{text} 00:00:00"
    match = re.match(r"^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::(\d{2}))?", text)
    if match:
        return f"{match.group(1)} {match.group(2)}:{match.group(3) or '00'}"
    return text[:19]


def save_market_opinion(payload: dict[str, Any]) -> dict[str, Any]:
    section = str(payload.get("section", "")).strip()
    title = str(payload.get("title", "")).strip()
    body = str(payload.get("body", "")).strip()
    trade_date = normalize_market_opinion_datetime(payload.get("tradeDate"))
    status = str(payload.get("status", "published")).strip().lower()
    item_id = str(payload.get("id", "")).strip()
    if section not in MARKET_OPINION_SECTIONS:
        raise ValueError("栏目不正确")
    if status not in MARKET_OPINION_STATUSES:
        raise ValueError("发布状态不正确")
    if not title:
        raise ValueError("标题不能为空")
    if status == "published" and not body:
        raise ValueError("正文不能为空")

    item = {
        "id": item_id or f"{section}-{market_opinion_slug(trade_date)}-{market_opinion_slug(title)}",
        "section": section,
        "sectionLabel": MARKET_OPINION_SECTIONS[section],
        "title": title,
        "tradeDate": trade_date,
        "status": status,
        "featured": bool(payload.get("featured")),
        "summary": str(payload.get("summary", "")).strip(),
        "symbols": market_opinion_list(payload.get("symbols"), upper=True),
        "topics": market_opinion_list(payload.get("topics")),
        "highlights": market_opinion_list(payload.get("highlights")),
        "body": body,
    }

    with product_db_write() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO market_opinion_items
            (item_id, section, section_label, title, trade_date, summary,
             symbols_json, topics_json, highlights_json, body, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item["id"],
                item["section"],
                item["sectionLabel"],
                item["title"],
                item["tradeDate"],
                item["summary"],
                db_json(item["symbols"]),
                db_json(item["topics"]),
                db_json(item["highlights"]),
                item["body"],
                db_json(item),
            ),
        )
    return item


def query_market_opinions(
    *,
    include_drafts: bool = False,
    section: str = "",
    limit: int = 50,
    offset: int = 0,
    status: str = "",
    date_from: str = "",
    date_to: str = "",
    query: str = "",
    sort: str = "latest",
) -> dict[str, Any]:
    where = []
    values: list[Any] = []
    if section:
        where.append("section = ?")
        values.append(section)
    if date_from:
        where.append("substr(trade_date, 1, 10) >= ?")
        values.append(date_from)
    if date_to:
        where.append("substr(trade_date, 1, 10) <= ?")
        values.append(date_to)
    where_sql = "WHERE " + " AND ".join(where) if where else ""
    with product_db() as conn:
        rows = conn.execute(
            f"""
            SELECT *
            FROM market_opinion_items
            {where_sql}
            ORDER BY trade_date DESC, item_id DESC
            """,
            values,
        ).fetchall()
    items = [product_market_opinion_payload(row) for row in rows]
    if not include_drafts:
        items = [item for item in items if item.get("status") == "published"]
    if status in MARKET_OPINION_STATUSES:
        items = [item for item in items if item.get("status") == status]
    needle = query.strip().lower()
    if needle:
        items = [
            item
            for item in items
            if needle
            in " ".join(
                [
                    str(item.get("title") or ""),
                    str(item.get("summary") or ""),
                    str(item.get("sectionLabel") or ""),
                    " ".join(item.get("symbols") or []),
                    " ".join(item.get("topics") or []),
                ]
            ).lower()
        ]
    items.sort(key=lambda item: (1 if item.get("featured") else 0, str(item.get("tradeDate") or "")), reverse=True)
    if sort == "draftFirst":
        items.sort(key=lambda item: 0 if item.get("status") == "draft" else 1)
    elif sort == "publishedFirst":
        items.sort(key=lambda item: 0 if item.get("status") == "published" else 1)
    total = len(items)
    start = max(0, offset)
    end = start + max(0, limit)
    return {
        "rows": items[start:end],
        "total": total,
        "limit": limit,
        "offset": start,
        "section": section,
    }


def list_market_opinions(
    *,
    include_drafts: bool = False,
    section: str = "",
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    return query_market_opinions(
        include_drafts=include_drafts,
        section=section,
        limit=limit,
        offset=offset,
    )["rows"]


def delete_market_opinion(item_id: str) -> bool:
    item_id = str(item_id or "").strip()
    if not item_id:
        return False
    with product_db_write() as conn:
        cursor = conn.execute("DELETE FROM market_opinion_items WHERE item_id = ?", (item_id,))
    return cursor.rowcount > 0


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


@contextmanager
def product_db_write() -> Iterator[sqlite3.Connection]:
    path = product_db_path()
    if not path:
        raise FileNotFoundError("product.db not found")
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        with conn:
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


def product_coverage_payload(conn: sqlite3.Connection) -> dict[str, Any]:
    counts = product_dataset_meta(conn).get("counts", {})
    symbol_total = int(conn.execute("SELECT COUNT(*) FROM symbols").fetchone()[0])
    liquid_symbols = int(
        conn.execute(
            "SELECT COUNT(*) FROM symbols WHERE COALESCE(latest_dollar_volume, 0) >= 5000000"
        ).fetchone()[0]
    )
    unknown_sector = int(
        conn.execute(
            """
            SELECT COUNT(*)
            FROM symbols
            WHERE sector IS NULL OR sector = '' OR sector IN ('未分类', '板块待补', '--')
            """
        ).fetchone()[0]
    )
    market_cap_missing = int(conn.execute("SELECT COUNT(*) FROM symbols WHERE market_cap_value IS NULL").fetchone()[0])
    event_symbols = int(conn.execute("SELECT COUNT(DISTINCT symbol) FROM stock_event_rows").fetchone()[0])
    earnings_symbols = int(conn.execute("SELECT COUNT(DISTINCT symbol) FROM earnings_quality_rows").fetchone()[0])
    market_boards = [
        {
            "board": row["board"],
            "rows": row["rows"],
            "symbols": row["symbols"],
            "unknownSector": row["unknown_sector"],
            "marketCapMissing": row["market_cap_missing"],
        }
        for row in conn.execute(
            """
            SELECT board,
                   COUNT(*) AS rows,
                   COUNT(DISTINCT symbol) AS symbols,
                   SUM(CASE WHEN sector IS NULL OR sector = '' OR sector IN ('未分类', '板块待补', '--') THEN 1 ELSE 0 END) AS unknown_sector,
                   SUM(CASE WHEN market_cap_value IS NULL THEN 1 ELSE 0 END) AS market_cap_missing
            FROM market_board_rows
            GROUP BY board
            ORDER BY board
            """
        ).fetchall()
    ]
    calendar = [
        {"type": row["event_type"] or "unknown", "rows": row["rows"]}
        for row in conn.execute(
            """
            SELECT event_type, COUNT(*) AS rows
            FROM calendar_events
            GROUP BY event_type
            ORDER BY event_type
            """
        ).fetchall()
    ]
    options = [
        {"board": row["board"], "rows": row["rows"]}
        for row in conn.execute(
            """
            SELECT board, COUNT(*) AS rows
            FROM options_flow_rows
            GROUP BY board
            ORDER BY board
            """
        ).fetchall()
    ]
    gaps = []
    if symbol_total < 800:
        gaps.append("股票主表低于 800 只")
    if unknown_sector / max(1, symbol_total) > 0.2:
        gaps.append("未分类板块比例偏高")
    if market_cap_missing / max(1, symbol_total) > 0.05:
        gaps.append("市值字段缺口偏高")
    if not any(item["type"] == "earnings" and item["rows"] > 0 for item in calendar):
        gaps.append("财报日历待接入")
    return {
        "ok": symbol_total >= 800 and bool(market_boards),
        "counts": counts,
        "symbols": {
            "total": symbol_total,
            "liquid": liquid_symbols,
            "unknownSector": unknown_sector,
            "marketCapMissing": market_cap_missing,
            "eventLinked": event_symbols,
            "earningsLinked": earnings_symbols,
        },
        "marketBoards": market_boards,
        "calendar": calendar,
        "options": options,
        "gaps": gaps,
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


def product_stock_library_payload(row: sqlite3.Row) -> dict[str, Any]:
    payload = product_symbol_payload(row)
    payload.update(
        {
            "dayChange": row["day_change"],
            "weekChange": row["week_change"],
            "monthChange": row["month_change"],
            "ytdChange": row["ytd_change"],
            "dayPrice": row["day_price"],
            "eventLabel": row["event_label"],
            "eventDate": row["event_date"],
            "hasEvent": bool(row["has_event"]),
            "qualityLabel": row["quality_label"],
            "qualityScore": row["quality_score"],
            "strengthLabel": row["strength_label"],
            "strengthScore": row["strength_score"],
        }
    )
    return payload


def product_market_row_payload(row: sqlite3.Row, include_tracking_analysis: bool = False) -> dict[str, Any]:
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
    raw_payload = parse_json_field(row["payload_json"], {})
    if include_tracking_analysis and isinstance(raw_payload, dict):
        key_levels = raw_payload.get("keyLevels")
        price_history = raw_payload.get("priceHistory")
        if isinstance(key_levels, dict):
            payload["keyLevels"] = key_levels
        if isinstance(price_history, list):
            payload["priceHistory"] = price_history
    return payload


def product_stock_library_order(sort_key: str, sort_dir: str = "desc") -> str:
    direction = "ASC" if str(sort_dir).lower() == "asc" else "DESC"
    expressions = {
        "dollarVolume": "COALESCE(s.latest_dollar_volume, volume.dollar_volume, day.dollar_volume)",
        "dayChange": "day.change_pct",
        "weekChange": "week.change_pct",
        "monthChange": "month.change_pct",
        "ytdChange": "ytd.change_pct",
        "marketCap": "s.market_cap_value",
    }
    if sort_key == "symbol":
        return f"s.symbol {'DESC' if direction == 'DESC' else 'ASC'}"
    expr = expressions.get(sort_key, expressions["dollarVolume"])
    return f"CASE WHEN {expr} IS NULL THEN 1 ELSE 0 END ASC, {expr} {direction}, s.symbol ASC"


def product_raw_payload(conn: sqlite3.Connection, name: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT payload_json FROM raw_payloads WHERE name = ?", (name,)).fetchone()
    if not row:
        return None
    payload = parse_json_field(row["payload_json"], None)
    return payload if isinstance(payload, dict) else None


def product_market_board_payload(
    conn: sqlite3.Connection,
    board: str,
    limit: int = 500,
    symbols: list[str] | None = None,
    include_tracking_analysis: bool = False,
) -> list[dict[str, Any]]:
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
    merged = list(rows)
    seen = {row["symbol"] for row in merged}
    extra_symbols = [symbol for symbol in (symbols or []) if symbol and symbol not in seen]
    if extra_symbols:
        placeholders = ",".join(["?"] * len(extra_symbols))
        extra_rows = conn.execute(
            f"""
            SELECT *
            FROM market_board_rows
            WHERE board = ? AND symbol IN ({placeholders})
            ORDER BY rank ASC
            """,
            (board, *extra_symbols),
        ).fetchall()
        merged.extend(extra_rows)
    payloads = [product_market_row_payload(row, include_tracking_analysis) for row in merged]
    missing_cap_symbols = [
        payload["symbol"]
        for payload in payloads
        if (not payload.get("marketCap") or payload.get("marketCap") == "--") and payload.get("symbol")
    ]
    if missing_cap_symbols:
        placeholders = ",".join(["?"] * len(missing_cap_symbols))
        symbol_rows = conn.execute(
            f"""
            SELECT symbol, market_cap_label, market_cap_value
            FROM symbols
            WHERE symbol IN ({placeholders})
            """,
            missing_cap_symbols,
        ).fetchall()
        cap_map = {row["symbol"]: row for row in symbol_rows}
        for payload in payloads:
            cap_row = cap_map.get(payload["symbol"])
            if not cap_row:
                continue
            if cap_row["market_cap_label"] and cap_row["market_cap_label"] != "--":
                payload["marketCap"] = cap_row["market_cap_label"]
            if cap_row["market_cap_value"] is not None:
                payload["marketCapValue"] = cap_row["market_cap_value"]
    return payloads


def product_bootstrap_payload(
    conn: sqlite3.Connection,
    board_limit: int = 500,
    symbols: list[str] | None = None,
    include_tracking_analysis: bool = False,
) -> dict[str, Any]:
    meta = product_dataset_meta(conn)
    core_raw = product_raw_payload(conn, "core-signals")
    strength_raw = product_raw_payload(conn, "strength-scanner")
    strength_review_raw = product_raw_payload(conn, "strength-review")
    market_temperature_raw = product_raw_payload(conn, "market-temperature")
    sector_flow_raw = product_raw_payload(conn, "sector-flow")
    generated_at = meta.get("generatedAt")

    ytd_rows = product_market_board_payload(
        conn, "ytd", board_limit, symbols, include_tracking_analysis
    )
    ytd = {
        "updatedAt": generated_at,
        "rows": ytd_rows,
    }

    boards: dict[str, Any] = {}
    for board in ["day", "week", "month", "volume"]:
        boards[board] = {
            "rows": product_market_board_payload(
                conn, board, board_limit, symbols, include_tracking_analysis
            ),
        }
    movers = {
        "updatedAt": generated_at,
        "boards": boards,
    }
    return {
        "meta": meta,
        "ytd": ytd,
        "movers": movers,
        "core": core_raw,
        "strength": strength_raw,
        "strengthReview": strength_review_raw,
        "marketTemperature": market_temperature_raw,
        "sectorFlow": sector_flow_raw,
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


def product_strength_page_payload(conn: sqlite3.Connection, params: dict[str, list[str]]) -> dict[str, Any]:
    limit = int_param(params, "limit", 20, maximum=100)
    offset = int_param(params, "offset", 0, minimum=0, maximum=100000)
    bucket = str(params.get("bucket", ["watch"])[0] or "watch").strip().lower()
    if bucket not in {"all", "watch", "hot", "neutral", "avoid"}:
        bucket = "watch"
    query = str(params.get("q", [""])[0] or params.get("query", [""])[0]).strip().upper()
    sector = str(params.get("sector", [""])[0]).strip()
    heat = str(params.get("heat", ["all"])[0] or "all").strip().lower()
    if heat not in {"all", "normal", "rising", "hot"}:
        heat = "all"
    sort_key = str(params.get("sort", ["score"])[0] or "score").strip()
    order_by = {
        "score": "score DESC",
        "return20d": "return_20d_pct DESC",
        "relative": "relative_spy_pct DESC",
        "crowding": "crowding_score DESC",
    }.get(sort_key, "score DESC")
    if sort_key not in {"score", "return20d", "relative", "crowding"}:
        sort_key = "score"

    where = []
    values: list[Any] = []
    if bucket != "all":
        where.append("bucket = ?")
        values.append(bucket)
    if query:
        like = f"%{query}%"
        where.append("(symbol LIKE ? OR UPPER(COALESCE(company, '')) LIKE ?)")
        values.extend([like, like])
    if sector and sector.lower() != "all":
        where.append("sector = ?")
        values.append(sector)
    if heat == "normal":
        where.append("COALESCE(crowding_score, 0) < 55")
    elif heat == "rising":
        where.append("COALESCE(crowding_score, 0) >= 55 AND COALESCE(crowding_score, 0) < 72")
    elif heat == "hot":
        where.append("COALESCE(crowding_score, 0) >= 72")
    where_sql = "WHERE " + " AND ".join(where) if where else ""

    total = conn.execute(f"SELECT COUNT(*) AS count FROM strength_rows {where_sql}", values).fetchone()["count"]
    page_rows = conn.execute(
        f"""
        SELECT payload_json
        FROM strength_rows
        {where_sql}
        ORDER BY {order_by}, symbol ASC
        LIMIT ? OFFSET ?
        """,
        (*values, limit, offset),
    ).fetchall()
    counts = {"all": 0, "watch": 0, "hot": 0, "neutral": 0, "avoid": 0}
    for row in conn.execute("SELECT bucket, COUNT(*) AS count FROM strength_rows GROUP BY bucket").fetchall():
        if row["bucket"] in counts:
            counts[row["bucket"]] = row["count"]
        counts["all"] += row["count"]
    sectors = [
        row["sector"]
        for row in conn.execute(
            """
            SELECT DISTINCT sector
            FROM strength_rows
            WHERE COALESCE(sector, '') NOT IN ('', '--', '未分类', '板块待补')
            ORDER BY sector ASC
            """
        ).fetchall()
    ]
    summary_payload = product_raw_payload(conn, "strength-scanner") or {}
    return {
        "asOf": summary_payload.get("asOf"),
        "summary": summary_payload.get("summary") or {},
        "themes": summary_payload.get("themes") or {},
        "counts": counts,
        "sectors": sectors,
        "rows": [parse_json_field(row["payload_json"], {}) for row in page_rows],
        "total": total,
        "limit": limit,
        "offset": offset,
        "bucket": bucket,
        "query": query,
        "sector": sector or "all",
        "heat": heat,
        "sort": sort_key,
    }


def product_sector_board_payload(conn: sqlite3.Connection, board: str, include_unknown: bool, limit: int, offset: int) -> dict[str, Any]:
    unknown_filter = "" if include_unknown else "AND sector NOT IN ('未分类', '板块待补', '--')"
    rows = conn.execute(
        f"""
        SELECT
          sector,
          COUNT(*) AS stock_count,
          SUM(CASE WHEN COALESCE(change_pct, 0) >= 0 THEN 1 ELSE 0 END) AS up_count,
          SUM(CASE WHEN COALESCE(change_pct, 0) < 0 THEN 1 ELSE 0 END) AS down_count,
          AVG(change_pct) AS avg_change_pct,
          SUM(COALESCE(dollar_volume, 0)) AS active_value,
          SUM(CASE WHEN COALESCE(change_pct, 0) >= 0 THEN COALESCE(dollar_volume, 0) ELSE -COALESCE(dollar_volume, 0) END) AS net_flow_proxy
        FROM market_board_rows
        WHERE board = ? {unknown_filter}
        GROUP BY sector
        ORDER BY net_flow_proxy DESC
        LIMIT ? OFFSET ?
        """,
        (board, limit, offset),
    ).fetchall()
    total = conn.execute(
        f"""
        SELECT COUNT(*) AS count FROM (
          SELECT sector
          FROM market_board_rows
          WHERE board = ? {unknown_filter}
          GROUP BY sector
        )
        """,
        (board,),
    ).fetchone()["count"]
    as_of = conn.execute("SELECT MAX(trade_date) AS as_of FROM market_board_rows WHERE board = ?", (board,)).fetchone()["as_of"]
    payload_rows = []
    for index, row in enumerate(rows, start=offset + 1):
        leaders = conn.execute(
            """
            SELECT symbol, company, change_pct, dollar_volume
            FROM market_board_rows
            WHERE board = ? AND sector = ?
            ORDER BY COALESCE(dollar_volume, 0) DESC
            LIMIT 4
            """,
            (board, row["sector"]),
        ).fetchall()
        payload_rows.append(
            {
                "asOf": as_of,
                "rank": index,
                "sector": row["sector"],
                "count": row["stock_count"],
                "upCount": row["up_count"],
                "downCount": row["down_count"],
                "breadthPct": round((row["up_count"] or 0) / max(1, row["stock_count"] or 0) * 100, 2),
                "avgChangePct": row["avg_change_pct"],
                "activeValue": row["active_value"],
                "netFlowProxy": row["net_flow_proxy"],
                "leaders": [
                    {"symbol": leader["symbol"], "name": leader["company"], "changePct": leader["change_pct"], "liquidity": leader["dollar_volume"]}
                    for leader in leaders
                ],
            }
        )
    return {"rows": payload_rows, "total": total, "limit": limit, "offset": offset, "asOf": as_of, "board": board}


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
    def clean_label(value):
        text = "" if value is None else str(value).strip()
        return None if text.lower() in {"", "null", "undefined"} else text

    return {
        "id": row["event_id"],
        "date": row["event_date"],
        "time": row["event_time"],
        "title": row["title"],
        "type": row["event_type"],
        "impact": row["impact"],
        "sourceName": row["source_name"],
        "actualValue": row["actual_value"],
        "actualLabel": clean_label(row["actual_label"]),
        "forecastValue": row["forecast_value"],
        "forecastLabel": clean_label(row["forecast_label"]),
        "previousValue": row["previous_value"],
        "previousLabel": clean_label(row["previous_label"]),
        "resultUpdatedAt": row["result_updated_at"],
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


def product_market_opinion_payload(row: sqlite3.Row) -> dict[str, Any]:
    payload = parse_json_field(row["payload_json"], {}) if "payload_json" in row.keys() else {}
    status = str(payload.get("status") or "published")
    if status not in MARKET_OPINION_STATUSES:
        status = "published"
    return {
        "id": row["item_id"],
        "section": row["section"],
        "sectionLabel": MARKET_OPINION_SECTIONS.get(row["section"], row["section_label"]),
        "title": row["title"],
        "tradeDate": row["trade_date"],
        "status": status,
        "featured": bool(payload.get("featured")),
        "summary": row["summary"],
        "symbols": parse_json_field(row["symbols_json"], []),
        "topics": parse_json_field(row["topics_json"], []),
        "highlights": parse_json_field(row["highlights_json"], []),
        "body": row["body"],
    }


def init_db() -> None:
    reset_register_rate_limits()
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
              password_changed_at TEXT,
              last_login_at TEXT,
              onboarding_seen_at TEXT
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

            CREATE TABLE IF NOT EXISTS user_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              actor_user_id INTEGER,
              actor_email TEXT,
              target_user_id INTEGER,
              target_email TEXT,
              action TEXT NOT NULL,
              before_json TEXT,
              after_json TEXT,
              created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_user_events_target ON user_events(target_user_id, id DESC);
            CREATE INDEX IF NOT EXISTS idx_user_events_actor ON user_events(actor_user_id, id DESC);

            CREATE TABLE IF NOT EXISTS analytics_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER,
              event_type TEXT NOT NULL,
              event_key TEXT NOT NULL,
              path TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_analytics_events_user_time ON analytics_events(user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_analytics_events_type_time ON analytics_events(event_type, created_at);

            CREATE TABLE IF NOT EXISTS password_reset_tokens (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              token_hash TEXT NOT NULL UNIQUE,
              expires_at TEXT NOT NULL,
              used_at TEXT,
              request_ip TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id, id DESC);

            CREATE TABLE IF NOT EXISTS course_series (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              slug TEXT NOT NULL UNIQUE,
              title TEXT NOT NULL,
              summary TEXT,
              intro TEXT,
              progress_status TEXT NOT NULL DEFAULT 'updating',
              original_price TEXT,
              discount_price TEXT,
              discount_label TEXT,
              cover_url TEXT,
              cover_card_url TEXT,
              sort_order INTEGER NOT NULL DEFAULT 1,
              status TEXT NOT NULL DEFAULT 'draft',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS course_lessons (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              series_id INTEGER NOT NULL,
              title TEXT NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 1,
              duration_label TEXT,
              cover_url TEXT,
              video_key TEXT NOT NULL,
              video_source_key TEXT,
              video_job_id TEXT,
              video_output_key TEXT,
              video_process_error TEXT,
              video_process_started_at TEXT,
              video_status TEXT NOT NULL DEFAULT 'ready',
              status TEXT NOT NULL DEFAULT 'published',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(series_id) REFERENCES course_series(id)
            );

            CREATE TABLE IF NOT EXISTS course_grants (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              series_id INTEGER NOT NULL,
              user_id INTEGER NOT NULL,
              granted_by_user_id INTEGER,
              expires_at TEXT,
              created_at TEXT NOT NULL,
              UNIQUE(series_id, user_id),
              FOREIGN KEY(series_id) REFERENCES course_series(id),
              FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_course_lessons_series ON course_lessons(series_id, sort_order DESC, id DESC);
            CREATE INDEX IF NOT EXISTS idx_course_grants_user ON course_grants(user_id, series_id);
            CREATE INDEX IF NOT EXISTS idx_course_grants_series ON course_grants(series_id, user_id);
            """
        )
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "created_by_user_id" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN created_by_user_id INTEGER")
        if "password_changed_at" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN password_changed_at TEXT")
        if "onboarding_seen_at" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN onboarding_seen_at TEXT")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by_user_id)")
        course_series_columns = {row["name"] for row in conn.execute("PRAGMA table_info(course_series)").fetchall()}
        if "sort_order" not in course_series_columns:
            conn.execute("ALTER TABLE course_series ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 1")
        if "intro" not in course_series_columns:
            conn.execute("ALTER TABLE course_series ADD COLUMN intro TEXT")
        if "progress_status" not in course_series_columns:
            conn.execute("ALTER TABLE course_series ADD COLUMN progress_status TEXT NOT NULL DEFAULT 'updating'")
        if "original_price" not in course_series_columns:
            conn.execute("ALTER TABLE course_series ADD COLUMN original_price TEXT")
        if "discount_price" not in course_series_columns:
            conn.execute("ALTER TABLE course_series ADD COLUMN discount_price TEXT")
        if "discount_label" not in course_series_columns:
            conn.execute("ALTER TABLE course_series ADD COLUMN discount_label TEXT")
        if "cover_card_url" not in course_series_columns:
            conn.execute("ALTER TABLE course_series ADD COLUMN cover_card_url TEXT")
        course_grant_columns = {row["name"] for row in conn.execute("PRAGMA table_info(course_grants)").fetchall()}
        if "expires_at" not in course_grant_columns:
            conn.execute("ALTER TABLE course_grants ADD COLUMN expires_at TEXT")
        course_lesson_columns = {row["name"] for row in conn.execute("PRAGMA table_info(course_lessons)").fetchall()}
        if "cover_url" not in course_lesson_columns:
            conn.execute("ALTER TABLE course_lessons ADD COLUMN cover_url TEXT")
        if "video_status" not in course_lesson_columns:
            conn.execute("ALTER TABLE course_lessons ADD COLUMN video_status TEXT NOT NULL DEFAULT 'ready'")
        for column in ["video_source_key", "video_job_id", "video_output_key", "video_process_error", "video_process_started_at"]:
            if column not in course_lesson_columns:
                conn.execute(f"ALTER TABLE course_lessons ADD COLUMN {column} TEXT")
        if SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD:
            existing = conn.execute("SELECT id FROM users WHERE email = ?", (SUPER_ADMIN_EMAIL,)).fetchone()
            if not existing:
                salt, password_hash = hash_password(SUPER_ADMIN_PASSWORD)
                timestamp = now_iso()
                conn.execute(
                    """
                    INSERT INTO users
                    (email, password_hash, salt, role, plan, subscription_expires_at, is_active, created_at, updated_at, password_changed_at)
                    VALUES (?, ?, ?, 'super_admin', 'paid', NULL, 1, ?, ?, ?)
                    """,
                    (SUPER_ADMIN_EMAIL, password_hash, salt, timestamp, timestamp, timestamp),
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


def public_uid(row: sqlite3.Row) -> str:
    digest = hashlib.sha256(f"dongbimao:{row['email']}".encode("utf-8")).hexdigest()[:10].upper()
    return f"DBM-{digest}"


def user_to_public(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "uid": public_uid(row),
        "email": row["email"],
        "role": row["role"],
        "plan": public_plan(row),
        "subscriptionExpiresAt": row["subscription_expires_at"],
        "onboardingSeenAt": row["onboarding_seen_at"] if "onboarding_seen_at" in row.keys() else None,
        "isSuperAdmin": row["role"] == "super_admin",
    }


def entitlements(row: sqlite3.Row | None) -> dict[str, bool]:
    if not row:
        return {"paid": False, "pro": False, "proPlus": False, "admin": False, "yearly": False}
    is_admin = row["role"] in {"admin", "super_admin"}
    paid = is_admin or current_paid_plan(row)
    yearly = is_admin or (current_paid_plan(row) and normalize_plan(row["plan"]) in {"paid", "yearly"})
    return {
        "paid": paid,
        "pro": paid,
        "proPlus": paid,
        "admin": is_admin,
        "yearly": yearly,
    }


def has_yearly_access(row: sqlite3.Row | None) -> bool:
    return bool(row and entitlements(row)["yearly"])


def find_user_by_id(user_id: int) -> sqlite3.Row | None:
    with db() as conn:
        return conn.execute("SELECT * FROM users WHERE id = ? AND is_active = 1", (user_id,)).fetchone()


def find_user_by_email(email: str) -> sqlite3.Row | None:
    with db() as conn:
        return conn.execute("SELECT * FROM users WHERE email = ? AND is_active = 1", (email,)).fetchone()


def register_public_user(email: str, password: str) -> sqlite3.Row:
    email = normalize_email(email)
    validate_email(email)
    validate_password(password)
    salt, password_hash = hash_password(password)
    timestamp = now_iso()
    try:
        with db() as conn:
            cursor = conn.execute(
                """
                INSERT INTO users
                (email, password_hash, salt, role, plan, subscription_expires_at, created_by_user_id, is_active, created_at, updated_at, password_changed_at, last_login_at)
                VALUES (?, ?, ?, 'user', 'free', NULL, NULL, 1, ?, ?, ?, ?)
                """,
                (email, password_hash, salt, timestamp, timestamp, timestamp, timestamp),
            )
            user = conn.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
            write_user_event(conn, action="self_register", actor=None, target_before=None, target_after=user)
    except sqlite3.IntegrityError as exc:
        raise ValueError("该邮箱已注册") from exc
    return user


def reset_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_password_reset_token(conn: sqlite3.Connection, user: sqlite3.Row, request_ip: str) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(seconds=PASSWORD_RESET_TTL_SECONDS)).isoformat()
    conn.execute("UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL", (now.isoformat(), user["id"]))
    conn.execute(
        """
        INSERT INTO password_reset_tokens
        (user_id, token_hash, expires_at, request_ip, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (user["id"], reset_token_hash(token), expires_at, request_ip, now.isoformat()),
    )
    return token


def password_reset_url(token: str) -> str:
    base = PUBLIC_SITE_URL.strip().rstrip("/") or "http://43.165.133.237"
    return f"{base}/?resetToken={quote(token)}"


def send_resend_email(to: str | list[str], subject: str, html: str) -> None:
    if not RESEND_API_KEY or not MAIL_FROM:
        print(f"email disabled: {subject}", flush=True)
        return
    payload = json_dumps({
        "from": MAIL_FROM,
        "to": to if isinstance(to, list) else [to],
        "subject": subject,
        "html": html,
    })
    request = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "dongbimao-mailer/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status >= 300:
            raise RuntimeError("邮件发送失败")


def send_password_reset_email(email: str, url: str) -> None:
    if not RESEND_API_KEY or not MAIL_FROM:
        print(f"password reset link for {email}: {url}", flush=True)
        return
    send_resend_email(
        email,
        "重置懂币猫账号密码",
        f"<p>点击下面链接重置密码，30 分钟内有效：</p><p><a href=\"{url}\">{url}</a></p>",
    )


def reset_password_with_token(token: str, password: str) -> None:
    validate_password(password)
    token_hash = reset_token_hash(str(token or "").strip())
    now = datetime.now(timezone.utc)
    with db() as conn:
        row = conn.execute(
            """
            SELECT t.*, u.email
            FROM password_reset_tokens t
            JOIN users u ON u.id = t.user_id
            WHERE t.token_hash = ? AND t.used_at IS NULL AND u.is_active = 1
            """,
            (token_hash,),
        ).fetchone()
        if not row or timestamp_epoch(row["expires_at"]) < int(now.timestamp()):
            raise ValueError("重置链接已失效")
        user = conn.execute("SELECT * FROM users WHERE id = ?", (row["user_id"],)).fetchone()
        salt, password_hash = hash_password(password)
        conn.execute(
            """
            UPDATE users
            SET password_hash = ?, salt = ?, password_changed_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (password_hash, salt, now.isoformat(), now.isoformat(), row["user_id"]),
        )
        conn.execute("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?", (now.isoformat(), row["id"]))
        fresh = conn.execute("SELECT * FROM users WHERE id = ?", (row["user_id"],)).fetchone()
        write_user_event(conn, action="reset_password", actor=None, target_before=user, target_after=fresh)


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


def public_plan(row: sqlite3.Row) -> str:
    if not current_paid_plan(row):
        return "free"
    plan = normalize_plan(row["plan"])
    return plan if plan in {"paid", "monthly", "yearly"} else "paid"


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
    if target and target["role"] == "super_admin":
        return False, "超级管理员不能被修改或停用"
    if admin["role"] == "admin" and target and target["role"] != "user":
        return False, "普通管理员不能管理管理员账号"
    if role in {"admin", "super_admin"} and admin["role"] != "super_admin":
        return False, "只有超级管理员可以设置管理员"
    return True, None


def admin_user_payload(row: sqlite3.Row) -> dict[str, Any]:
    is_regular_user = row["role"] == "user"
    has_paid_access = is_regular_user and current_paid_plan(row)
    plan = normalize_plan(row["plan"]) if is_regular_user else "free"
    return {
        "id": row["id"],
        "uid": public_uid(row),
        "email": row["email"],
        "role": row["role"],
        "plan": plan if plan in PLANS else "free",
        "hasPaidAccess": has_paid_access,
        "subscriptionExpiresAt": row["subscription_expires_at"] if is_regular_user else None,
        "subscriptionStatus": "active" if has_paid_access else "expired" if is_regular_user and is_paid_plan(row["plan"]) else "free",
        "isActive": bool(row["is_active"]),
        "createdAt": row["created_at"],
        "lastLoginAt": row["last_login_at"],
        "isSuperAdmin": row["role"] == "super_admin",
        "createdBy": {
            "id": row["created_by_user_id"],
            "email": row["created_by_email"] if "created_by_email" in row.keys() else None,
        },
    }


def user_audit_snapshot(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "email": row["email"],
        "role": row["role"],
        "plan": normalize_plan(row["plan"]),
        "subscriptionExpiresAt": row["subscription_expires_at"],
        "isActive": bool(row["is_active"]),
        "createdByUserId": row["created_by_user_id"] if "created_by_user_id" in row.keys() else None,
    }


def user_event_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "actor": {
            "id": row["actor_user_id"],
            "email": row["actor_email"],
        },
        "target": {
            "id": row["target_user_id"],
            "email": row["target_email"],
        },
        "action": row["action"],
        "before": parse_json_field(row["before_json"], None),
        "after": parse_json_field(row["after_json"], None),
        "createdAt": row["created_at"],
    }


def analytics_text(value: Any, max_length: int) -> str:
    return re.sub(r"[^a-zA-Z0-9_./#:-]+", "", str(value or ""))[:max_length]


def insert_analytics_event(
    conn: sqlite3.Connection,
    user: sqlite3.Row | None,
    event_type: str,
    event_key: str,
    path: str = "",
) -> None:
    if not user:
        return
    timestamp = now_iso()
    conn.execute(
        """
        INSERT INTO analytics_events (user_id, event_type, event_key, path, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            user["id"],
            analytics_text(event_type, 40),
            analytics_text(event_key, 80),
            analytics_text(path, 200),
            timestamp,
        ),
    )
    today = timestamp[:10]
    last_login = str(user["last_login_at"] or "")[:10]
    if last_login != today:
        conn.execute("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?", (timestamp, timestamp, user["id"]))


def write_analytics_event(conn: sqlite3.Connection, user: sqlite3.Row | None, payload: dict[str, Any]) -> None:
    event_type = analytics_text(payload.get("eventType"), 40)
    event_key = analytics_text(payload.get("eventKey"), 80)
    if event_type != "nav_click" or not event_key:
        raise ValueError("埋点参数不正确")
    insert_analytics_event(conn, user, event_type, event_key, str(payload.get("path") or ""))


def write_course_play_grant(user: sqlite3.Row, lesson_id: int) -> None:
    conn: sqlite3.Connection | None = None
    try:
        conn = sqlite3.connect(DB_PATH, timeout=0.05)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=50")
        conn.execute("PRAGMA foreign_keys=ON")
        with conn:
            insert_analytics_event(
                conn,
                user,
                "course_play_grant",
                str(lesson_id),
                "/api/courses/lessons/:id/play",
            )
    except Exception:
        print("course play analytics write failed")
    finally:
        if conn:
            conn.close()


def analytics_range_clause(
    params: dict[str, list[str]],
    *,
    prefix: str,
    column: str,
) -> tuple[str, list[str]]:
    range_key = f"{prefix}Range"
    selected = str(params.get(range_key, ["30"])[0]).strip()
    if selected in {"7", "30", "90"}:
        return f"datetime({column}) >= datetime('now', ?)", [f"-{selected} days"]
    if selected == "all":
        return "", []
    if selected == "custom":
        date_from = str(params.get(f"{prefix}DateFrom", [""])[0]).strip()
        date_to = str(params.get(f"{prefix}DateTo", [""])[0]).strip()
        try:
            start = date.fromisoformat(date_from).isoformat()
            end = date.fromisoformat(date_to).isoformat()
        except ValueError as exc:
            raise ValueError("请选择完整的日期范围") from exc
        if start > end:
            raise ValueError("开始日期不能晚于结束日期")
        return f"date(datetime({column}, '+8 hours')) BETWEEN ? AND ?", [start, end]
    return "datetime({}) >= datetime('now', '-30 days')".format(column), []


def admin_metrics_payload(conn: sqlite3.Connection, params: dict[str, list[str]] | None = None) -> dict[str, Any]:
    params = params or {}
    users = conn.execute(
        """
        WITH regular_users AS (
          SELECT *,
            CASE WHEN plan IN ('monthly', 'paid', 'yearly')
              AND (
                subscription_expires_at IS NULL OR TRIM(subscription_expires_at) = ''
                OR (LENGTH(TRIM(subscription_expires_at)) <= 10 AND date(subscription_expires_at) >= date('now', '+8 hours'))
                OR (LENGTH(TRIM(subscription_expires_at)) > 10 AND datetime(subscription_expires_at) >= datetime('now'))
              )
            THEN 1 ELSE 0 END AS paid_active
          FROM users
          WHERE role = 'user'
        )
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_users,
          SUM(CASE WHEN is_active = 1 AND paid_active = 1 AND plan IN ('monthly', 'paid') THEN 1 ELSE 0 END) AS monthly_paid,
          SUM(CASE WHEN is_active = 1 AND paid_active = 1 AND plan = 'yearly' THEN 1 ELSE 0 END) AS yearly_paid
        FROM regular_users
        """
    ).fetchone()
    active = conn.execute(
        """
        SELECT
          COUNT(DISTINCT CASE WHEN datetime(a.created_at) >= datetime('now', '-3 days') THEN a.user_id END) AS d3,
          COUNT(DISTINCT CASE WHEN datetime(a.created_at) >= datetime('now', '-7 days') THEN a.user_id END) AS d7,
          COUNT(DISTINCT CASE WHEN datetime(a.created_at) >= datetime('now', '-30 days') THEN a.user_id END) AS d30
        FROM analytics_events a
        JOIN users u ON u.id = a.user_id AND u.role = 'user' AND u.is_active = 1
        WHERE a.event_type = 'nav_click'
        """
    ).fetchone()
    nav_clause, nav_values = analytics_range_clause(params, prefix="nav", column="a.created_at")
    nav_where = "AND " + nav_clause if nav_clause else ""
    nav_rows = conn.execute(
        f"""
        SELECT a.event_key, COUNT(*) AS clicks, COUNT(DISTINCT a.user_id) AS users
        FROM analytics_events a
        JOIN users u ON u.id = a.user_id AND u.role = 'user'
        WHERE a.event_type = 'nav_click' {nav_where}
        GROUP BY a.event_key
        ORDER BY clicks DESC
        LIMIT 30
        """,
        nav_values,
    ).fetchall()
    retention_clause, retention_values = analytics_range_clause(params, prefix="retention", column="u.created_at")
    retention_where = "AND " + retention_clause if retention_clause else ""
    retention_rows = conn.execute(
        f"""
        SELECT
          date(datetime(u.created_at, '+8 hours')) AS cohortDay,
          COUNT(DISTINCT u.id) AS registered,
          COUNT(DISTINCT CASE WHEN datetime(a.created_at) < datetime(u.created_at, '+3 days') THEN u.id END) AS retained3d,
          COUNT(DISTINCT CASE WHEN datetime(a.created_at) < datetime(u.created_at, '+7 days') THEN u.id END) AS retained7d,
          COUNT(DISTINCT CASE WHEN datetime(a.created_at) < datetime(u.created_at, '+30 days') THEN u.id END) AS retained30d
        FROM users u
        LEFT JOIN analytics_events a ON a.user_id = u.id AND a.event_type = 'nav_click' AND datetime(a.created_at) > datetime(u.created_at)
        WHERE u.role = 'user' AND u.is_active = 1 {retention_where}
        GROUP BY cohortDay
        ORDER BY cohortDay DESC
        LIMIT 30
        """,
        retention_values,
    ).fetchall()
    return {
        "users": {
            "total": users["total"] or 0,
            "active": users["active_users"] or 0,
            "monthlyPaid": users["monthly_paid"] or 0,
            "yearlyPaid": users["yearly_paid"] or 0,
        },
        "active": {"d3": active["d3"] or 0, "d7": active["d7"] or 0, "d30": active["d30"] or 0},
        "navClicks": [{"page": row["event_key"], "clicks": row["clicks"], "users": row["users"] or 0} for row in nav_rows],
        "retention": [
            {
                "cohortDay": row["cohortDay"],
                "registered": row["registered"],
                "retained3d": row["retained3d"],
                "retained7d": row["retained7d"],
                "retained30d": row["retained30d"],
            }
            for row in retention_rows
        ],
    }


def write_user_event(
    conn: sqlite3.Connection,
    *,
    action: str,
    actor: sqlite3.Row | None,
    target_before: sqlite3.Row | None,
    target_after: sqlite3.Row | None,
) -> None:
    target = target_after or target_before
    conn.execute(
        """
        INSERT INTO user_events
        (actor_user_id, actor_email, target_user_id, target_email, action, before_json, after_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            actor["id"] if actor else None,
            actor["email"] if actor else None,
            target["id"] if target else None,
            target["email"] if target else None,
            action,
            db_json(user_audit_snapshot(target_before)) if target_before else None,
            db_json(user_audit_snapshot(target_after)) if target_after else None,
            now_iso(),
        ),
    )


def course_slug(title: Any) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", str(title or "").strip().lower()).strip("-")
    if base:
        return base[:80]
    digest = hashlib.sha1(str(title or now_iso()).encode("utf-8")).hexdigest()[:10]
    return f"course-{digest}"


def unique_course_slug(conn: sqlite3.Connection, title: str) -> str:
    base = course_slug(title)
    slug = base
    index = 2
    while conn.execute("SELECT 1 FROM course_series WHERE slug = ?", (slug,)).fetchone():
        slug = f"{base}-{index}"
        index += 1
    return slug


def course_series_payload(row: sqlite3.Row, lessons: list[dict[str, Any]] | None = None, grant_count: int = 0) -> dict[str, Any]:
    payload = {
        "id": row["id"],
        "slug": row["slug"],
        "title": row["title"],
        "summary": row["summary"] or "",
        "intro": (row["intro"] if "intro" in row.keys() else "") or row["summary"] or "",
        "progressStatus": (row["progress_status"] if "progress_status" in row.keys() else "") or "updating",
        "originalPrice": (row["original_price"] if "original_price" in row.keys() else "") or "",
        "discountPrice": (row["discount_price"] if "discount_price" in row.keys() else "") or "",
        "discountLabel": (row["discount_label"] if "discount_label" in row.keys() else "") or "",
        "coverUrl": signed_course_image_url(row["cover_url"] or ""),
        "coverCardUrl": signed_course_image_url((row["cover_card_url"] if "cover_card_url" in row.keys() else "") or ""),
        "sortOrder": row["sort_order"],
        "status": row["status"],
        "lessonCount": row["lesson_count"] if "lesson_count" in row.keys() else len(lessons or []),
        "grantCount": row["grant_count"] if "grant_count" in row.keys() else grant_count,
        "expiringCount": row["expiring_count"] if "expiring_count" in row.keys() else 0,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "lessons": lessons or [],
    }
    if "unlocked" in row.keys():
        payload["unlocked"] = bool(row["unlocked"])
    if "grant_expires_at" in row.keys():
        payload["grantExpiresAt"] = row["grant_expires_at"]
    return payload


def course_video_status(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return "ready"
    return raw if raw in COURSE_VIDEO_STATUSES else "failed"


def course_lesson_payload(row: sqlite3.Row, include_key: bool = False) -> dict[str, Any]:
    video_status = course_video_status(row["video_status"] if "video_status" in row.keys() else "")
    payload = {
        "id": row["id"],
        "seriesId": row["series_id"],
        "title": row["title"],
        "sortOrder": row["sort_order"],
        "durationLabel": row["duration_label"] or "",
        "coverUrl": signed_course_image_url(row["cover_url"] or ""),
        "videoStatus": video_status,
        "videoProcessError": (row["video_process_error"] if "video_process_error" in row.keys() else "") or "",
        "videoAvailable": bool(str(row["video_key"] or "").strip()),
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }
    if include_key:
        payload["videoKey"] = row["video_key"]
    return payload


def course_grant_payload(row: sqlite3.Row) -> dict[str, Any]:
    expires_at = row["expires_at"] if "expires_at" in row.keys() else None
    active = not expires_at or subscription_is_active(expires_at)
    return {
        "id": row["id"],
        "seriesId": row["series_id"],
        "user": {
            "id": row["user_id"],
            "uid": public_uid(row),
            "email": row["email"],
            "plan": public_plan(row),
        },
        "expiresAt": expires_at,
        "active": active,
        "createdAt": row["created_at"],
    }


def course_has_access(conn: sqlite3.Connection, user: sqlite3.Row, series_id: int) -> bool:
    if user["role"] in {"admin", "super_admin"}:
        return True
    return bool(conn.execute(
        """
        SELECT 1
        FROM course_grants
        WHERE series_id = ? AND user_id = ?
          AND (expires_at IS NULL OR expires_at = '' OR date(expires_at) >= date('now'))
        """,
        (series_id, user["id"]),
    ).fetchone())


def cos_object_url(video_key: str) -> tuple[str, str, str]:
    key = str(video_key or "").strip().lstrip("/")
    if not key:
        raise ValueError("视频 COS Key 不能为空")
    if COURSE_COS_DOMAIN:
        base = COURSE_COS_DOMAIN
    elif COURSE_COS_BUCKET and COURSE_COS_REGION:
        base = f"https://{COURSE_COS_BUCKET}.cos.{COURSE_COS_REGION}.myqcloud.com"
    else:
        raise RuntimeError("COS 未配置")
    path = "/" + quote(key, safe="/-_.~")
    return f"{base}{path}", urlparse(base).netloc, path


def course_video_key(value: str) -> str:
    raw = str(value or "").strip()
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"}:
        return raw
    if COURSE_COS_DOMAIN:
        expected_host = urlparse(COURSE_COS_DOMAIN).netloc
    elif COURSE_COS_BUCKET and COURSE_COS_REGION:
        expected_host = f"{COURSE_COS_BUCKET}.cos.{COURSE_COS_REGION}.myqcloud.com"
    else:
        expected_host = ""
    if parsed.netloc == expected_host:
        return unquote(parsed.path.lstrip("/"))
    return raw


def signed_course_image_url(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    key = course_video_key(raw)
    if not key or not key.startswith("course-image/"):
        return raw
    try:
        stable_now = int(time.time() // COURSE_IMAGE_SIGN_TTL * COURSE_IMAGE_SIGN_TTL)
        return signed_course_cos_url(key, method="get", now=stable_now, ttl=COURSE_IMAGE_SIGN_TTL)
    except Exception:
        try:
            return cos_object_url(key)[0]
        except Exception:
            return raw


def qcloud_authorization(
    method: str,
    host: str,
    path: str,
    *,
    params: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
    now: int | None = None,
    ttl: int = 600,
) -> str:
    if not COURSE_COS_SECRET_ID or not COURSE_COS_SECRET_KEY:
        raise RuntimeError("COS 未配置")
    sign_headers = {"host": host, **{str(key).lower(): str(value) for key, value in (headers or {}).items()}}
    encoded_headers = {
        quote(key, safe="-_.~").lower(): quote(value, safe="-_.~")
        for key, value in sign_headers.items()
    }
    encoded_params = {
        quote(str(key), safe="-_.~").lower(): quote(str(value), safe="-_.~")
        for key, value in (params or {}).items()
    }
    canonical_headers = "&".join(f"{key}={encoded_headers[key]}" for key in sorted(encoded_headers))
    canonical_params = "&".join(f"{key}={encoded_params[key]}" for key in sorted(encoded_params))
    http_string = f"{method.lower()}\n{path}\n{canonical_params}\n{canonical_headers}\n"
    start = int(now or time.time()) - 60
    key_time = f"{start};{start + max(60, ttl)}"
    string_to_sign = f"sha1\n{key_time}\n{hashlib.sha1(http_string.encode('utf-8')).hexdigest()}\n"
    sign_key = hmac.new(COURSE_COS_SECRET_KEY.encode("utf-8"), key_time.encode("utf-8"), hashlib.sha1).hexdigest()
    signature = hmac.new(sign_key.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha1).hexdigest()
    return "&".join([
        "q-sign-algorithm=sha1",
        f"q-ak={COURSE_COS_SECRET_ID}",
        f"q-sign-time={key_time}",
        f"q-key-time={key_time}",
        f"q-header-list={';'.join(sorted(encoded_headers))}",
        f"q-url-param-list={';'.join(sorted(encoded_params))}",
        f"q-signature={signature}",
    ])


def qcloud_xml_request(
    method: str,
    endpoint: str,
    path: str,
    *,
    params: dict[str, str] | None = None,
    body: bytes | None = None,
    timeout: int = 30,
) -> ET.Element:
    parsed = urlparse(endpoint)
    host = parsed.netloc
    signed_headers = {"content-type": "application/xml"} if body is not None else {}
    authorization = qcloud_authorization(method, host, path, params=params, headers=signed_headers)
    query = "&".join(
        f"{quote(str(key), safe='-_.~')}={quote(str(value), safe='-_.~')}"
        for key, value in sorted((params or {}).items())
    )
    url = f"{endpoint}{path}{'?' + query if query else ''}"
    request_headers = {"Authorization": authorization, "Host": host}
    if body is not None:
        request_headers["Content-Type"] = "application/xml"
    request = urllib.request.Request(url, data=body, method=method.upper(), headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"视频处理服务请求失败：HTTP {exc.code} {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("视频处理服务暂时不可用") from exc
    try:
        return ET.fromstring(raw)
    except ET.ParseError as exc:
        raise RuntimeError("视频处理服务返回内容不正确") from exc


def xml_request_body(payload: dict[str, Any]) -> bytes:
    root = ET.Element("Request")

    def append(parent: ET.Element, values: dict[str, Any]) -> None:
        for key, value in values.items():
            child = ET.SubElement(parent, key)
            if isinstance(value, dict):
                append(child, value)
            else:
                child.text = str(value)

    append(root, payload)
    return ET.tostring(root, encoding="utf-8", xml_declaration=False)


def xml_value(root: ET.Element, path: str, default: str = "") -> str:
    value = root.findtext(path)
    return str(value).strip() if value is not None else default


def course_media_info(video_key: str) -> dict[str, Any]:
    object_url, host, path = cos_object_url(video_key)
    root = qcloud_xml_request("GET", f"https://{host}", path, params={"ci-process": "videoinfo"})
    bitrate = float(xml_value(root, "./MediaInfo/Format/Bitrate", "0") or 0)
    size = int(float(xml_value(root, "./MediaInfo/Format/Size", "0") or 0))
    duration = float(xml_value(root, "./MediaInfo/Format/Duration", "0") or 0)
    if bitrate <= 0 and size > 0 and duration > 0:
        bitrate = size * 8 / duration / 1000
    return {
        "url": object_url,
        "size": size,
        "duration": duration,
        "bitrateKbps": bitrate,
        "format": xml_value(root, "./MediaInfo/Format/FormatName").lower(),
        "videoCodec": xml_value(root, "./MediaInfo/Stream/Video/CodecName").lower(),
        "audioCodec": xml_value(root, "./MediaInfo/Stream/Audio/CodecName").lower(),
        "width": int(float(xml_value(root, "./MediaInfo/Stream/Video/Width", "0") or 0)),
        "height": int(float(xml_value(root, "./MediaInfo/Stream/Video/Height", "0") or 0)),
    }


def course_media_requires_optimization(info: dict[str, Any]) -> bool:
    if not info.get("videoCodec") or float(info.get("duration") or 0) <= 0:
        raise ValueError("无法识别视频内容")
    return bool(
        float(info.get("bitrateKbps") or 0) > COURSE_VIDEO_OPTIMIZE_BITRATE_KBPS
        or int(info.get("width") or 0) > COURSE_VIDEO_MAX_WIDTH
        or str(info.get("videoCodec") or "").lower() != "h264"
        or (info.get("audioCodec") and str(info["audioCodec"]).lower() != "aac")
    )


def course_ci_endpoint() -> str:
    if not COURSE_COS_BUCKET or not COURSE_COS_REGION:
        raise RuntimeError("COS 未配置")
    return f"https://{COURSE_COS_BUCKET}.ci.{COURSE_COS_REGION}.myqcloud.com"


def create_course_transcode_job(lesson_id: int, source_key: str, source_width: int = COURSE_VIDEO_MAX_WIDTH) -> tuple[str, str]:
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    output_key = f"lesson/optimized/auto/{day}/lesson-{lesson_id}-{secrets.token_hex(6)}.mp4"
    target_width = max(2, min(int(source_width or COURSE_VIDEO_MAX_WIDTH), COURSE_VIDEO_MAX_WIDTH))
    target_width -= target_width % 2
    body = xml_request_body({
        "Tag": "Transcode",
        "Input": {"Object": source_key},
        "Operation": {
            "Transcode": {
                "Container": {"Format": "mp4"},
                "Video": {
                    "Codec": "H.264",
                    "Profile": "high",
                    "Bitrate": str(COURSE_VIDEO_TARGET_BITRATE_KBPS),
                    "Width": str(target_width),
                    "Fps": "30",
                    "Preset": "medium",
                },
                "Audio": {"Codec": "aac", "Samplerate": "44100", "Bitrate": "128", "Channels": "2"},
            },
            "Output": {"Region": COURSE_COS_REGION, "Bucket": COURSE_COS_BUCKET, "Object": output_key},
            "FreeTranscode": "true",
            "UserData": f"dongbimao-course-lesson-{lesson_id}",
        },
    })
    root = qcloud_xml_request("POST", course_ci_endpoint(), "/jobs", body=body)
    job_id = xml_value(root, "./JobsDetail/JobId")
    if not job_id:
        raise RuntimeError(xml_value(root, "./JobsDetail/Message", "视频转码任务创建失败"))
    return job_id, output_key


def course_transcode_job(job_id: str) -> dict[str, str]:
    root = qcloud_xml_request("GET", course_ci_endpoint(), f"/jobs/{quote(job_id, safe='-_.~')}")
    return {
        "state": xml_value(root, "./JobsDetail/State"),
        "code": xml_value(root, "./JobsDetail/Code"),
        "message": xml_value(root, "./JobsDetail/Message"),
    }


def course_video_failure(lesson_id: int, source_key: str, message: str) -> sqlite3.Row:
    with db() as conn:
        conn.execute(
            """
            UPDATE course_lessons
            SET video_status = 'failed', video_process_error = ?, updated_at = ?
            WHERE id = ? AND video_source_key = ?
            """,
            (str(message or "视频处理失败")[:240], now_iso(), lesson_id, source_key),
        )
        return conn.execute("SELECT * FROM course_lessons WHERE id = ?", (lesson_id,)).fetchone()


def process_course_video(payload: dict[str, Any]) -> dict[str, Any]:
    if not COURSE_VIDEO_AUTO_PROCESS_ENABLED:
        raise ValueError("视频自动处理尚未开启")
    source_key = course_video_key(str(payload.get("videoKey") or "").strip())
    if not source_key.startswith("lesson/"):
        raise ValueError("视频文件路径不正确")
    lesson_id = int(payload.get("id") or 0)
    timestamp = now_iso()
    with db() as conn:
        existing = conn.execute("SELECT * FROM course_lessons WHERE id = ?", (lesson_id,)).fetchone() if lesson_id > 0 else None
        if lesson_id > 0 and not existing:
            raise ValueError("视频不存在")
        title = str(payload.get("title") or (existing["title"] if existing else "")).strip()
        if not title:
            raise ValueError("视频标题不能为空")
        series_id = int(payload.get("seriesId") or (existing["series_id"] if existing else 0))
        if not conn.execute("SELECT 1 FROM course_series WHERE id = ?", (series_id,)).fetchone():
            raise ValueError("交易实战课程不存在")
        status = str(payload.get("status") or (existing["status"] if existing else "published")).strip()
        if status not in COURSE_STATUSES:
            raise ValueError("视频状态不正确")
        cover_url = course_video_key(str(payload.get("coverUrl") or (existing["cover_url"] if existing else "")).strip())
        if payload.get("sortOrder") not in {None, ""}:
            try:
                sort_order = max(1, int(payload.get("sortOrder") or 1))
            except (TypeError, ValueError):
                sort_order = 1
        elif existing:
            sort_order = int(existing["sort_order"] or 1)
        else:
            row = conn.execute("SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM course_lessons WHERE series_id = ?", (series_id,)).fetchone()
            sort_order = int(row["max_sort"] or 0) + 1
        if existing:
            conn.execute(
                """
                UPDATE course_lessons
                SET series_id = ?, title = ?, sort_order = ?, cover_url = ?, video_source_key = ?,
                    video_job_id = NULL, video_output_key = NULL, video_process_error = NULL,
                    video_process_started_at = ?, video_status = 'processing', status = ?, updated_at = ?
                WHERE id = ?
                """,
                (series_id, title, sort_order, cover_url, source_key, timestamp, status, timestamp, lesson_id),
            )
        else:
            cursor = conn.execute(
                """
                INSERT INTO course_lessons
                (series_id, title, sort_order, duration_label, cover_url, video_key, video_source_key,
                 video_process_started_at, video_status, status, created_at, updated_at)
                VALUES (?, ?, ?, '', ?, '', ?, ?, 'processing', ?, ?, ?)
                """,
                (series_id, title, sort_order, cover_url, source_key, timestamp, status, timestamp, timestamp),
            )
            lesson_id = int(cursor.lastrowid)

    try:
        source_info = course_media_info(source_key)
        if not course_media_requires_optimization(source_info):
            with db() as conn:
                conn.execute(
                    """
                    UPDATE course_lessons
                    SET video_key = ?, video_status = 'ready', video_job_id = NULL, video_output_key = NULL,
                        video_process_error = NULL, updated_at = ?
                    WHERE id = ? AND video_source_key = ?
                    """,
                    (source_key, now_iso(), lesson_id, source_key),
                )
                row = conn.execute("SELECT * FROM course_lessons WHERE id = ?", (lesson_id,)).fetchone()
        else:
            job_id, output_key = create_course_transcode_job(lesson_id, source_key, int(source_info.get("width") or COURSE_VIDEO_MAX_WIDTH))
            with db() as conn:
                conn.execute(
                    """
                    UPDATE course_lessons
                    SET video_job_id = ?, video_output_key = ?, updated_at = ?
                    WHERE id = ? AND video_source_key = ? AND video_status = 'processing'
                    """,
                    (job_id, output_key, now_iso(), lesson_id, source_key),
                )
                row = conn.execute("SELECT * FROM course_lessons WHERE id = ?", (lesson_id,)).fetchone()
    except Exception as exc:
        row = course_video_failure(lesson_id, source_key, str(exc))
    return course_lesson_payload(row, include_key=True)


def retry_course_video(lesson_id: int) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT * FROM course_lessons WHERE id = ?", (lesson_id,)).fetchone()
    if not row:
        raise ValueError("视频不存在")
    source_key = str(row["video_source_key"] or "").strip()
    if not source_key:
        raise ValueError("没有可重试的视频文件")
    return process_course_video({
        "id": lesson_id,
        "seriesId": row["series_id"],
        "title": row["title"],
        "sortOrder": row["sort_order"],
        "coverUrl": row["cover_url"],
        "videoKey": source_key,
        "status": row["status"],
    })


def validate_course_transcode(source: dict[str, Any], output: dict[str, Any]) -> None:
    source_size = int(source.get("size") or 0)
    output_size = int(output.get("size") or 0)
    source_duration = float(source.get("duration") or 0)
    output_duration = float(output.get("duration") or 0)
    if output_size <= 0 or source_size <= 0 or output_size >= source_size:
        raise ValueError("新视频未通过体积检查")
    if output_duration <= 0 or abs(output_duration - source_duration) > max(2.0, source_duration * 0.01):
        raise ValueError("新视频未通过时长检查")
    if course_media_requires_optimization(output):
        raise ValueError("新视频未达到播放规格")


def refresh_course_video_jobs(limit: int = 3) -> int:
    if not COURSE_VIDEO_AUTO_PROCESS_ENABLED:
        return 0
    with db() as conn:
        rows = conn.execute(
            """
            SELECT id, video_source_key, video_job_id, video_output_key, video_process_started_at
            FROM course_lessons
            WHERE video_status = 'processing' AND COALESCE(video_job_id, '') != ''
            ORDER BY video_process_started_at, id
            LIMIT ?
            """,
            (max(1, min(limit, 50)),),
        ).fetchall()
    updated = 0
    for row in rows:
        lesson_id = int(row["id"])
        source_key = str(row["video_source_key"] or "")
        job_id = str(row["video_job_id"] or "")
        output_key = str(row["video_output_key"] or "")
        started_at = timestamp_epoch(row["video_process_started_at"])
        if started_at and time.time() - started_at > max(300, COURSE_VIDEO_PROCESS_TIMEOUT_SECONDS):
            course_video_failure(lesson_id, source_key, "视频处理超时，请重试")
            updated += 1
            continue
        try:
            job = course_transcode_job(job_id)
        except Exception:
            continue
        state = job.get("state", "")
        if state == "Success":
            try:
                source_info = course_media_info(source_key)
                output_info = course_media_info(output_key)
                validate_course_transcode(source_info, output_info)
                with db() as conn:
                    cursor = conn.execute(
                        """
                        UPDATE course_lessons
                        SET video_key = video_output_key, video_status = 'ready', video_process_error = NULL, updated_at = ?
                        WHERE id = ? AND video_source_key = ? AND video_job_id = ? AND video_status = 'processing'
                        """,
                        (now_iso(), lesson_id, source_key, job_id),
                    )
                updated += cursor.rowcount
            except Exception as exc:
                course_video_failure(lesson_id, source_key, str(exc))
                updated += 1
        elif state in {"Failed", "Cancel"}:
            course_video_failure(lesson_id, source_key, job.get("message") or job.get("code") or "视频处理失败")
            updated += 1
    return updated


def signed_course_cos_url(key: str, *, method: str = "get", now: int | None = None, ttl: int | None = None) -> str:
    if not COURSE_COS_SECRET_ID or not COURSE_COS_SECRET_KEY:
        raise RuntimeError("COS 未配置")
    object_url, host, path = cos_object_url(key)
    start = int(now or time.time())
    end = start + max(60, ttl or COURSE_COS_SIGN_TTL)
    key_time = f"{start};{end}"
    header_list = "host"
    http_headers = f"host={quote(host, safe='-_.~')}"
    http_string = f"{method.lower()}\n{path}\n\n{http_headers}\n"
    string_to_sign = f"sha1\n{key_time}\n{hashlib.sha1(http_string.encode('utf-8')).hexdigest()}\n"
    sign_key = hmac.new(COURSE_COS_SECRET_KEY.encode("utf-8"), key_time.encode("utf-8"), hashlib.sha1).hexdigest()
    signature = hmac.new(sign_key.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha1).hexdigest()
    params = {
        "q-sign-algorithm": "sha1",
        "q-ak": COURSE_COS_SECRET_ID,
        "q-sign-time": key_time,
        "q-key-time": key_time,
        "q-header-list": header_list,
        "q-url-param-list": "",
        "q-signature": signature,
    }
    return f"{object_url}?{urlencode(params)}"


def course_video_uses_cdn(key: str) -> bool:
    clean_key = key.strip().lstrip("/")
    return COURSE_CDN_ENABLED and any(
        clean_key == allowed_key or (allowed_key.endswith("/") and clean_key.startswith(allowed_key))
        for allowed_key in COURSE_CDN_VIDEO_KEYS
    )


def validate_course_cdn_config() -> None:
    if not COURSE_CDN_ENABLED:
        return
    domain = urlparse(COURSE_CDN_DOMAIN)
    if domain.scheme != "https" or not domain.netloc or domain.path not in {"", "/"} or domain.query or domain.fragment:
        raise RuntimeError("课程 CDN 域名格式错误")
    if not re.fullmatch(r"[A-Za-z0-9]{6,32}", COURSE_CDN_AUTH_KEY):
        raise RuntimeError("课程 CDN 鉴权密钥格式错误")
    if not 60 <= COURSE_CDN_SIGN_TTL <= 630_720_000:
        raise RuntimeError("课程 CDN 鉴权有效期格式错误")
    if not COURSE_CDN_VIDEO_KEYS:
        raise RuntimeError("课程 CDN 视频白名单不能为空")


def signed_course_cdn_url(key: str, *, now: int | None = None, nonce: str | None = None) -> str:
    validate_course_cdn_config()
    clean_key = key.strip().lstrip("/")
    if not clean_key:
        raise ValueError("视频 CDN Key 不能为空")
    if not course_video_uses_cdn(clean_key):
        raise RuntimeError("视频不在 CDN 白名单")
    path = "/" + quote(clean_key, safe="/-_.~")
    timestamp = int(time.time() if now is None else now)
    random_value = nonce or secrets.token_hex(8)
    if not re.fullmatch(r"[A-Za-z0-9]{1,100}", random_value):
        raise ValueError("CDN 签名随机值格式错误")
    digest = hashlib.md5(
        f"{path}-{timestamp}-{random_value}-0-{COURSE_CDN_AUTH_KEY}".encode("utf-8")
    ).hexdigest()
    return f"{COURSE_CDN_DOMAIN}{path}?{urlencode({'sign': f'{timestamp}-{random_value}-0-{digest}'})}"


def signed_course_video_url(video_key: str, now: int | None = None) -> str:
    raw = course_video_key(str(video_key or "").strip())
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    if course_video_uses_cdn(raw):
        return signed_course_cdn_url(raw, now=now)
    return signed_course_cos_url(raw, method="get", now=now)


def signed_course_hls_segment_url(video_key: str) -> str:
    if course_video_uses_cdn(video_key) and COURSE_CDN_SIGN_TTL < COURSE_HLS_SIGN_TTL:
        raise RuntimeError("HLS CDN 鉴权有效期不能短于 HLS 播放有效期")
    return signed_course_video_url(video_key)


def course_video_is_hls(video_key: str) -> bool:
    raw = course_video_key(str(video_key or "").strip())
    return bool(raw and not urlparse(raw).scheme and raw.lower().endswith(".m3u8"))


def course_hls_playlist_url(lesson_id: int, video_key: str) -> str:
    return f"/api/courses/lessons/{lesson_id}/hls?{urlencode({'playlist': course_video_key(video_key)})}"


def fetch_course_cos_text(key: str) -> str:
    request = urllib.request.Request(
        signed_course_cos_url(key, method="get", ttl=120),
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read(2 * 1024 * 1024)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HLS 播放清单读取失败：HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("HLS 播放清单暂时不可用") from exc
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise RuntimeError("HLS 播放清单格式不正确") from exc


def resolve_course_hls_key(root_prefix: str, current_key: str, uri: str) -> str:
    parsed = urlparse(str(uri or "").strip())
    if parsed.scheme or parsed.netloc or parsed.path.startswith("/") or not parsed.path:
        raise ValueError("HLS 播放清单包含不安全地址")
    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(current_key), unquote(parsed.path)))
    if resolved == root_prefix or not resolved.startswith(root_prefix + "/"):
        raise ValueError("HLS 播放清单越过课程目录")
    return resolved


def validate_course_hls_playlist_key(master_key: str, requested_key: str) -> str:
    root_prefix = posixpath.dirname(course_video_key(master_key))
    clean_key = posixpath.normpath(course_video_key(requested_key))
    if not root_prefix or (clean_key != course_video_key(master_key) and not clean_key.startswith(root_prefix + "/")):
        raise ValueError("HLS 播放清单不属于当前课程")
    if not clean_key.lower().endswith(".m3u8"):
        raise ValueError("HLS 播放清单格式不正确")
    return clean_key


def render_course_hls_playlist(lesson_id: int, master_key: str, requested_key: str, content: str) -> str:
    root_prefix = posixpath.dirname(course_video_key(master_key))
    clean_key = validate_course_hls_playlist_key(master_key, requested_key)

    output: list[str] = []
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            if "URI=" in line:
                raise ValueError("HLS 播放清单包含未支持的内嵌地址")
            output.append(raw_line)
            continue
        target_key = resolve_course_hls_key(root_prefix, clean_key, line)
        if target_key.lower().endswith(".m3u8"):
            output.append(
                f"/api/courses/lessons/{lesson_id}/hls?{urlencode({'playlist': target_key})}"
            )
        else:
            output.append(signed_course_hls_segment_url(target_key))
    return "\n".join(output) + "\n"


def course_video_url_ttl(video_key: str) -> int:
    raw = course_video_key(str(video_key or "").strip())
    if course_video_is_hls(raw):
        return COURSE_HLS_SIGN_TTL
    return max(60, COURSE_CDN_SIGN_TTL if course_video_uses_cdn(raw) else COURSE_COS_SIGN_TTL)


def safe_course_video_filename(value: str) -> str:
    name = safe_upload_filename(value, fallback="lesson-video")
    return name or "lesson-video"


def course_video_object_key(name: str, content_type: str = "") -> str:
    mime = (content_type or "application/octet-stream").split(";", 1)[0].strip().lower() or "application/octet-stream"
    suffix = Path(name or "").suffix.lower()
    if not suffix:
        suffix = mimetypes.guess_extension(mime) or ".mp4"
    if not re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
        suffix = ".mp4"
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"lesson/{day}/{int(time.time())}-{secrets.token_hex(6)}-{safe_course_video_filename(name)}{suffix}"


def course_image_object_key(name: str, ext: str) -> str:
    suffix = ext if re.fullmatch(r"\.[a-z0-9]{1,8}", ext or "") else ".jpg"
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"course-image/{day}/{int(time.time())}-{secrets.token_hex(6)}-{safe_upload_filename(name, fallback='course-cover')}{suffix}"


def upload_course_image(name: str, mime: str, raw: bytes, ext: str) -> dict[str, str]:
    key = course_image_object_key(name, ext)
    upload_url = signed_course_cos_url(key, method="put", ttl=600)
    request = urllib.request.Request(
        upload_url,
        data=raw,
        method="PUT",
        headers={
            "Content-Type": mime,
            "Content-Length": str(len(raw)),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"COS 上传失败：HTTP {response.status}")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"COS 上传失败：HTTP {exc.code}") from exc
    return {"url": signed_course_image_url(key), "mime": mime, "name": Path(name or key).name}


def create_course_image_upload_ticket(payload: dict[str, Any]) -> dict[str, str | int]:
    name = str(payload.get("name") or "course-cover").strip()
    mime = str(payload.get("type") or "").split(";", 1)[0].strip().lower()
    size = int(payload.get("size") or 0)
    if mime == "image/jpg":
        mime = "image/jpeg"
    if mime not in ALLOWED_UPLOAD_MIMES:
        raise ValueError("只支持 PNG、JPG、WebP、GIF 图片")
    if size <= 0:
        raise ValueError("图片为空")
    if size > UPLOAD_MAX_BYTES:
        raise ValueError("图片太大，单张不能超过 8MB")
    key = course_image_object_key(name, ALLOWED_UPLOAD_MIMES[mime])
    return {
        "key": key,
        "url": signed_course_cos_url(key, method="get", ttl=COURSE_COS_SIGN_TTL),
        "uploadUrl": signed_course_cos_url(key, method="put", ttl=1800),
        "expiresIn": 1800,
    }


def create_course_video_upload_ticket(payload: dict[str, Any]) -> dict[str, str | int]:
    name = str(payload.get("name") or "lesson-video.mp4").strip()
    mime = str(payload.get("type") or "application/octet-stream").strip()
    size = int(payload.get("size") or 0)
    if size <= 0:
        raise ValueError("视频文件为空")
    if size > COURSE_VIDEO_UPLOAD_MAX_BYTES:
        raise ValueError("视频文件过大")
    if mime != "application/octet-stream" and not mime.startswith("video/"):
        raise ValueError("请选择视频文件")
    key = course_video_object_key(name, mime)
    return {
        "key": key,
        "url": cos_object_url(key)[0],
        "uploadUrl": signed_course_cos_url(key, method="put", ttl=3600),
        "expiresIn": 3600,
    }


def upload_course_video(name: str, content_type: str, raw: bytes) -> dict[str, str]:
    if not raw:
        raise ValueError("视频文件为空")
    if len(raw) > COURSE_VIDEO_UPLOAD_MAX_BYTES:
        raise ValueError("视频文件过大")
    mime = (content_type or "application/octet-stream").split(";", 1)[0].strip().lower() or "application/octet-stream"
    if mime != "application/octet-stream" and not mime.startswith("video/"):
        raise ValueError("请选择视频文件")
    key = course_video_object_key(name, mime)
    upload_url = signed_course_cos_url(key, method="put", ttl=600)
    request = urllib.request.Request(
        upload_url,
        data=raw,
        method="PUT",
        headers={
            "Content-Type": mime,
            "Content-Length": str(len(raw)),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"COS 上传失败：HTTP {response.status}")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"COS 上传失败：HTTP {exc.code}") from exc
    return {"key": key, "url": cos_object_url(key)[0], "name": Path(name or key).name}


def list_admin_courses() -> dict[str, Any]:
    try:
        refresh_course_video_jobs()
    except Exception:
        pass
    with db() as conn:
        series_rows = conn.execute(
            """
            SELECT s.*,
                   COUNT(DISTINCT l.id) AS lesson_count,
                   COUNT(DISTINCT CASE WHEN g.expires_at IS NULL OR g.expires_at = '' OR date(g.expires_at) >= date('now') THEN g.id END) AS grant_count,
                   COUNT(DISTINCT CASE WHEN g.expires_at IS NOT NULL AND g.expires_at != '' AND date(g.expires_at) >= date('now') AND date(g.expires_at) <= date('now', '+7 days') THEN g.id END) AS expiring_count
            FROM course_series s
            LEFT JOIN course_lessons l ON l.series_id = s.id
            LEFT JOIN course_grants g ON g.series_id = s.id
            GROUP BY s.id
            ORDER BY s.sort_order DESC, s.id DESC
            """
        ).fetchall()
        lessons = conn.execute("SELECT * FROM course_lessons ORDER BY series_id, sort_order DESC, id DESC").fetchall()
        grants = conn.execute(
            """
            SELECT g.*, u.email, u.role, u.plan, u.subscription_expires_at
            FROM course_grants g
            JOIN users u ON u.id = g.user_id
            ORDER BY g.id DESC
            """
        ).fetchall()
    lesson_map: dict[int, list[dict[str, Any]]] = {}
    for row in lessons:
        lesson_map.setdefault(row["series_id"], []).append(course_lesson_payload(row, include_key=True))
    return {
        "series": [course_series_payload(row, lesson_map.get(row["id"], [])) for row in series_rows],
        "grants": [course_grant_payload(row) for row in grants],
    }


def create_course_series(payload: dict[str, Any]) -> dict[str, Any]:
    series_id = int(payload.get("id") or 0)
    title = str(payload.get("title", "")).strip()
    if not title:
        raise ValueError("交易实战课程名称不能为空")
    status = str(payload.get("status") or "draft").strip()
    if status not in COURSE_STATUSES:
        raise ValueError("交易实战课程状态不正确")
    summary = str(payload.get("summary") or "").strip()
    intro = str(payload.get("intro") or "").strip()
    progress_status = str(payload.get("progressStatus") or "updating").strip()
    if progress_status not in COURSE_PROGRESS_STATUSES:
        raise ValueError("交易实战课程展示状态不正确")
    original_price = str(payload.get("originalPrice") or "").strip()
    discount_price = str(payload.get("discountPrice") or "").strip()
    discount_label = str(payload.get("discountLabel") or "").strip()
    cover_url = course_video_key(str(payload.get("coverUrl") or "").strip())
    cover_card_url = course_video_key(str(payload.get("coverCardUrl") or "").strip())
    timestamp = now_iso()
    with db() as conn:
        if series_id > 0:
            existing = conn.execute("SELECT * FROM course_series WHERE id = ?", (series_id,)).fetchone()
            if not existing:
                raise ValueError("交易实战课程不存在")
            if payload.get("sortOrder") not in {None, ""}:
                try:
                    sort_order = max(1, int(payload.get("sortOrder") or 1))
                except (TypeError, ValueError):
                    sort_order = 1
            else:
                sort_order = int(existing["sort_order"] or 1)
            conn.execute(
                """
                UPDATE course_series
                SET title = ?, summary = ?, intro = ?, progress_status = ?, original_price = ?, discount_price = ?, discount_label = ?, cover_url = ?, cover_card_url = ?, sort_order = ?, status = ?, updated_at = ?
                WHERE id = ?
                """,
                (title, summary, intro, progress_status, original_price, discount_price, discount_label, cover_url, cover_card_url, sort_order, status, timestamp, series_id),
            )
            row = conn.execute("SELECT * FROM course_series WHERE id = ?", (series_id,)).fetchone()
            return course_series_payload(row)

        slug = unique_course_slug(conn, title)
        if payload.get("sortOrder") not in {None, ""}:
            try:
                sort_order = max(1, int(payload.get("sortOrder") or 1))
            except (TypeError, ValueError):
                sort_order = 1
        else:
            row = conn.execute("SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM course_series").fetchone()
            sort_order = int(row["max_sort"] or 0) + 1
        cursor = conn.execute(
            """
            INSERT INTO course_series
            (slug, title, summary, intro, progress_status, original_price, discount_price, discount_label, cover_url, cover_card_url, sort_order, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (slug, title, summary, intro, progress_status, original_price, discount_price, discount_label, cover_url, cover_card_url, sort_order, status, timestamp, timestamp),
        )
        row = conn.execute("SELECT * FROM course_series WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return course_series_payload(row)


def create_course_lesson(payload: dict[str, Any]) -> dict[str, Any]:
    lesson_id = int(payload.get("id") or 0)
    title = str(payload.get("title") or "").strip()
    video_key = str(payload.get("videoKey") or "").strip()
    if not title or not video_key:
        raise ValueError("视频标题和 COS Key 必填")
    status = str(payload.get("status") or "published").strip()
    if status not in COURSE_STATUSES:
        raise ValueError("视频状态不正确")
    duration_label = str(payload.get("durationLabel") or "").strip()
    cover_url = course_video_key(str(payload.get("coverUrl") or "").strip())
    requested_video_status = str(payload.get("videoStatus") or "").strip()
    if requested_video_status and requested_video_status not in COURSE_VIDEO_STATUSES:
        raise ValueError("视频处理状态不正确")
    timestamp = now_iso()
    with db() as conn:
        existing = None
        if lesson_id > 0:
            existing = conn.execute("SELECT * FROM course_lessons WHERE id = ?", (lesson_id,)).fetchone()
            if not existing:
                raise ValueError("视频不存在")
        video_status = requested_video_status or (course_video_status(existing["video_status"]) if existing else "ready")
        series_id = int(payload.get("seriesId") or (existing["series_id"] if existing else 0))
        if series_id <= 0:
            raise ValueError("交易实战课程必填")
        if not conn.execute("SELECT 1 FROM course_series WHERE id = ?", (series_id,)).fetchone():
            raise ValueError("交易实战课程不存在")
        if payload.get("sortOrder") not in {None, ""}:
            try:
                sort_order = max(1, int(payload.get("sortOrder") or 1))
            except (TypeError, ValueError):
                sort_order = 1
        else:
            if existing:
                sort_order = int(existing["sort_order"] or 1)
            else:
                row = conn.execute("SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM course_lessons WHERE series_id = ?", (series_id,)).fetchone()
                sort_order = int(row["max_sort"] or 0) + 1
        if existing:
            conn.execute(
                """
                UPDATE course_lessons
                SET series_id = ?, title = ?, sort_order = ?, duration_label = ?, cover_url = ?, video_key = ?, video_status = ?, status = ?, updated_at = ?
                WHERE id = ?
                """,
                (series_id, title, sort_order, duration_label, cover_url, video_key, video_status, status, timestamp, lesson_id),
            )
            row = conn.execute("SELECT * FROM course_lessons WHERE id = ?", (lesson_id,)).fetchone()
            return course_lesson_payload(row, include_key=True)

        cursor = conn.execute(
            """
            INSERT INTO course_lessons
            (series_id, title, sort_order, duration_label, cover_url, video_key, video_status, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (series_id, title, sort_order, duration_label, cover_url, video_key, video_status, status, timestamp, timestamp),
        )
        row = conn.execute("SELECT * FROM course_lessons WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return course_lesson_payload(row, include_key=True)


def course_grant_target(conn: sqlite3.Connection, user_query: str) -> sqlite3.Row | None:
    target = conn.execute("SELECT * FROM users WHERE email = ? AND role = 'user'", (normalize_email(user_query),)).fetchone()
    if target or not user_query.upper().startswith("DBM-"):
        return target
    return next(
        (
            row for row in conn.execute("SELECT * FROM users WHERE role = 'user'").fetchall()
            if public_uid(row) == user_query.upper()
        ),
        None,
    )


def grant_course(payload: dict[str, Any], admin: sqlite3.Row) -> dict[str, Any]:
    series_id = int(payload.get("seriesId") or 0)
    user_query = str(payload.get("email") or payload.get("user") or "").strip()
    expires_at = normalize_expires(payload.get("expiresAt"))
    if series_id <= 0 or not user_query:
        raise ValueError("交易实战课程和用户必填")
    if not expires_at:
        raise ValueError("请选择交易实战课程授权到期时间")
    with db() as conn:
        series = conn.execute("SELECT * FROM course_series WHERE id = ?", (series_id,)).fetchone()
        target = course_grant_target(conn, user_query)
        if not series:
            raise ValueError("交易实战课程不存在")
        if not target:
            raise ValueError("用户不存在")
        timestamp = now_iso()
        conn.execute(
            """
            INSERT OR IGNORE INTO course_grants
            (series_id, user_id, granted_by_user_id, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (series_id, target["id"], admin["id"], expires_at, timestamp),
        )
        conn.execute(
            "UPDATE course_grants SET expires_at = ?, granted_by_user_id = ? WHERE series_id = ? AND user_id = ?",
            (expires_at, admin["id"], series_id, target["id"]),
        )
        fresh_target = conn.execute("SELECT * FROM users WHERE id = ?", (target["id"],)).fetchone()
        write_user_event(conn, action="grant_course", actor=admin, target_before=target, target_after=fresh_target)
        row = conn.execute(
            """
            SELECT g.*, u.email, u.role, u.plan, u.subscription_expires_at
            FROM course_grants g
            JOIN users u ON u.id = g.user_id
            WHERE g.series_id = ? AND g.user_id = ?
            """,
            (series_id, target["id"]),
        ).fetchone()
    return course_grant_payload(row)


def grant_all_courses(payload: dict[str, Any], admin: sqlite3.Row) -> dict[str, Any]:
    user_query = str(payload.get("email") or payload.get("user") or "").strip()
    expires_at = normalize_expires(payload.get("expiresAt"))
    scope = str(payload.get("scope") or "all").strip()
    if not user_query:
        raise ValueError("用户必填")
    if not expires_at:
        raise ValueError("请选择交易实战课程授权到期时间")
    with db() as conn:
        target = course_grant_target(conn, user_query)
        if not target:
            raise ValueError("用户不存在")
        if scope in {"us_stock", "intro"}:
            placeholders = ",".join("?" for _ in US_STOCK_COURSE_TITLES)
            series_rows = conn.execute(f"SELECT id FROM course_series WHERE title IN ({placeholders})", US_STOCK_COURSE_TITLES).fetchall()
        elif scope == "all":
            series_rows = conn.execute("SELECT id FROM course_series").fetchall()
        else:
            raise ValueError("课程范围不正确")
        if not series_rows:
            raise ValueError("未找到可授权的课程")
        timestamp = now_iso()
        for row in series_rows:
            conn.execute(
                """
                INSERT OR IGNORE INTO course_grants
                (series_id, user_id, granted_by_user_id, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (row["id"], target["id"], admin["id"], expires_at, timestamp),
            )
            conn.execute(
                "UPDATE course_grants SET expires_at = ?, granted_by_user_id = ? WHERE series_id = ? AND user_id = ?",
                (expires_at, admin["id"], row["id"], target["id"]),
            )
        fresh_target = conn.execute("SELECT * FROM users WHERE id = ?", (target["id"],)).fetchone()
        write_user_event(conn, action="grant_course", actor=admin, target_before=target, target_after=fresh_target)
    return {"ok": True, "count": len(series_rows)}


def delete_course_lesson(lesson_id: int) -> bool:
    if lesson_id <= 0:
        return False
    with db() as conn:
        cursor = conn.execute("DELETE FROM course_lessons WHERE id = ?", (lesson_id,))
    return cursor.rowcount > 0


def delete_course_series(series_id: int) -> bool:
    if series_id <= 0:
        return False
    with db() as conn:
        existing = conn.execute("SELECT 1 FROM course_series WHERE id = ?", (series_id,)).fetchone()
        if not existing:
            return False
        conn.execute("DELETE FROM course_grants WHERE series_id = ?", (series_id,))
        conn.execute("DELETE FROM course_lessons WHERE series_id = ?", (series_id,))
        conn.execute("DELETE FROM course_series WHERE id = ?", (series_id,))
    return True


def user_courses_payload(user: sqlite3.Row) -> dict[str, Any]:
    with db() as conn:
        if user["role"] in {"admin", "super_admin"}:
            series_rows = conn.execute(
                """
                SELECT s.*, COUNT(l.id) AS lesson_count, 0 AS grant_count, 1 AS unlocked
                FROM course_series s
                LEFT JOIN course_lessons l ON l.series_id = s.id AND l.status = 'published'
                  AND TRIM(COALESCE(l.video_key, '')) != ''
                  AND (COALESCE(NULLIF(TRIM(l.video_status), ''), 'ready') = 'ready' OR TRIM(COALESCE(l.video_source_key, '')) != '')
                WHERE s.status = 'published'
                GROUP BY s.id
                ORDER BY s.sort_order DESC, s.id DESC
                """
            ).fetchall()
        else:
            grant_rows = conn.execute(
                """
                SELECT series_id
                FROM course_grants
                WHERE user_id = ? AND (expires_at IS NULL OR expires_at = '' OR date(expires_at) >= date('now'))
                """,
                (user["id"],),
            ).fetchall()
            granted_ids = {int(row["series_id"]) for row in grant_rows}
            series_rows = conn.execute(
                """
                SELECT s.*,
                       COUNT(l.id) AS lesson_count,
                       COUNT(CASE WHEN g.expires_at IS NULL OR g.expires_at = '' OR date(g.expires_at) >= date('now') THEN g.id END) AS grant_count,
                       CASE WHEN COUNT(g.id) > 0 THEN 1 ELSE 0 END AS unlocked,
                       MAX(g.expires_at) AS grant_expires_at
                FROM course_series s
                LEFT JOIN course_grants g ON g.series_id = s.id AND g.user_id = ? AND (g.expires_at IS NULL OR g.expires_at = '' OR date(g.expires_at) >= date('now'))
                LEFT JOIN course_lessons l ON l.series_id = s.id AND l.status = 'published'
                  AND TRIM(COALESCE(l.video_key, '')) != ''
                  AND (COALESCE(NULLIF(TRIM(l.video_status), ''), 'ready') = 'ready' OR TRIM(COALESCE(l.video_source_key, '')) != '')
                WHERE s.status = 'published'
                GROUP BY s.id
                ORDER BY s.sort_order DESC, s.id DESC
                """,
                (user["id"],),
            ).fetchall()
        series_ids = [row["id"] for row in series_rows]
        lesson_map: dict[int, list[dict[str, Any]]] = {}
        unlocked_ids = set(series_ids) if user["role"] in {"admin", "super_admin"} else granted_ids
        if series_ids:
            lesson_series_ids = [series_id for series_id in series_ids if series_id in unlocked_ids]
        else:
            lesson_series_ids = []
        if lesson_series_ids:
            placeholders = ",".join("?" for _ in lesson_series_ids)
            rows = conn.execute(
                f"""
                SELECT *
                FROM course_lessons
                WHERE status = 'published' AND TRIM(COALESCE(video_key, '')) != ''
                  AND (COALESCE(NULLIF(TRIM(video_status), ''), 'ready') = 'ready' OR TRIM(COALESCE(video_source_key, '')) != '')
                  AND series_id IN ({placeholders})
                ORDER BY series_id, sort_order DESC, id DESC
                """,
                lesson_series_ids,
            ).fetchall()
            for row in rows:
                lesson_map.setdefault(row["series_id"], []).append(course_lesson_payload(row))
    return {"series": [course_series_payload(row, lesson_map.get(row["id"], [])) for row in series_rows]}


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

    def read_body(self, max_bytes: int) -> bytes:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return b""
        if length > max_bytes:
            raise ValueError("文件过大")
        return self.rfile.read(length)

    def client_ip(self) -> str:
        forwarded = str(self.headers.get("X-Forwarded-For", "")).split(",", 1)[0].strip()
        real_ip = str(self.headers.get("X-Real-IP", "")).strip()
        return forwarded or real_ip or str(self.client_address[0] if self.client_address else "")

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

    def send_content(self, body: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_static(self, request_path: str) -> None:
        parsed = urlparse(request_path)
        raw_path = unquote(parsed.path)
        if raw_path.startswith("/data/") and raw_path.endswith(".json"):
            self.send_error(HTTPStatus.NOT_FOUND, "Static JSON datasets are not public")
            return
        if raw_path == "/admin" or raw_path.startswith("/admin/"):
            relative = raw_path.lstrip("/")
            candidate = (STATIC_ROOT / relative).resolve()
            if not str(candidate).startswith(str(STATIC_ROOT)):
                self.send_error(HTTPStatus.NOT_FOUND, "File not found")
                return
            if candidate.is_dir() or not candidate.is_file():
                candidate = (STATIC_ROOT / "admin" / "index.html").resolve()
            if not candidate.is_file():
                self.send_error(HTTPStatus.NOT_FOUND, "Admin app not found")
                return
            content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
            body = candidate.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", f"{content_type}; charset=utf-8" if content_type.startswith("text/") or content_type == "application/javascript" else content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache" if candidate.name == "index.html" else "public, max-age=60")
            self.end_headers()
            self.wfile.write(body)
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

    def send_upload(self, request_path: str) -> None:
        parsed = urlparse(request_path)
        raw_path = unquote(parsed.path)
        if raw_path in {"/api/upload", "/upload"}:
            relative = unquote(parse_qs(parsed.query).get("path", [""])[0]).lstrip("/")
        elif raw_path.startswith("/api/uploads/"):
            relative = raw_path.removeprefix("/api/uploads/").lstrip("/")
        elif raw_path.startswith("/uploads/"):
            relative = raw_path.removeprefix("/uploads/").lstrip("/")
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return
        try:
            candidate = ensure_upload_child(upload_root() / relative)
        except ValueError:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return
        if not candidate.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if content_type not in ALLOWED_UPLOAD_MIMES:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return
        body = candidate.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.end_headers()
        self.wfile.write(body)

    def send_api_data(self, request_path: str) -> None:
        parsed = urlparse(request_path)
        parts = [part for part in unquote(parsed.path).split("/") if part]
        name = "manifest" if len(parts) <= 2 else parts[2]
        aliases = {"data": "site-data-index", "manifest": "site-data-index", "status": "health"}
        name = aliases.get(name, name)
        if not name.replace("-", "").replace("_", "").isalnum():
            self.send_json({"error": "数据集名称不正确"}, HTTPStatus.BAD_REQUEST)
            return
        if not self.require_dataset_access(name):
            return
        try:
            with product_db() as conn:
                if name == "health":
                    self.send_json({"ok": True, **product_dataset_meta(conn)})
                    return
                payload = product_raw_payload(conn, name)
        except Exception as exc:
            self.send_json({"error": f"product.db 不可用：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        if payload is None:
            self.send_json({"error": "数据集不存在", "dataset": name}, HTTPStatus.NOT_FOUND)
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

                if len(parts) >= 3 and parts[2] == "coverage":
                    self.send_json(product_coverage_payload(conn))
                    return

                if len(parts) >= 3 and parts[2] == "strength":
                    if not self.require_dataset_access("strength-scanner"):
                        return
                    self.send_json(product_strength_page_payload(conn, params))
                    return

                if len(parts) >= 3 and parts[2] == "bootstrap":
                    board_limit = int_param(params, "limit", 500, maximum=500)
                    symbols = market_opinion_list(params.get("symbols", [""])[0], upper=True)
                    user = self.current_user()
                    can_view_paid_data = bool(user and entitlements(user)["paid"])
                    payload = product_bootstrap_payload(
                        conn, board_limit, symbols, can_view_paid_data
                    )
                    if not user:
                        payload["marketTemperature"] = None
                    if not can_view_paid_data:
                        payload["strength"] = None
                        payload["strengthReview"] = None
                    self.send_json(payload)
                    return

                if len(parts) >= 4 and parts[2] == "raw":
                    name = parts[3]
                    if not re.fullmatch(r"[a-z0-9-]+", name):
                        self.send_json({"error": "数据集名称不正确"}, HTTPStatus.BAD_REQUEST)
                        return
                    if not self.require_dataset_access(name):
                        return
                    payload = product_raw_payload(conn, name)
                    if payload is None:
                        self.send_json({"error": "数据集不存在", "dataset": name}, HTTPStatus.NOT_FOUND)
                        return
                    self.send_json(payload)
                    return

                if len(parts) >= 3 and parts[2] == "symbols":
                    if len(parts) >= 4 and parts[3] == "meta":
                        self.send_product_symbol_meta(conn)
                        return
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

                if len(parts) >= 3 and parts[2] == "opinions":
                    self.send_product_opinions(conn, params)
                    return

                self.send_json({"error": "产品数据接口不存在"}, HTTPStatus.NOT_FOUND)
        except FileNotFoundError:
            self.send_json({"error": "产品数据库不存在，请先运行 scripts/build_product_db.py", "code": "product_db_missing"}, HTTPStatus.SERVICE_UNAVAILABLE)
        except sqlite3.Error as exc:
            self.send_json({"error": f"产品数据库读取失败：{exc}", "code": "product_db_error"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def send_product_symbol_search(self, conn: sqlite3.Connection, params: dict[str, list[str]]) -> None:
        limit = int_param(params, "limit", 50, maximum=500)
        offset = int_param(params, "offset", 0, minimum=0, maximum=100000)
        query = str(params.get("query", [""])[0] or params.get("q", [""])[0]).strip().upper()
        sector = str(params.get("sector", [""])[0]).strip()
        cap = str(params.get("cap", [""])[0]).strip().lower()
        preset = str(params.get("preset", [""])[0]).strip().lower()
        user = self.current_user()
        can_view_strength = bool(user and entitlements(user)["paid"])
        if preset == "strength" and not can_view_strength:
            self.send_json({"error": "月度或年度会员可查看", "code": "membership_required"}, HTTPStatus.FORBIDDEN)
            return
        sort_key = str(params.get("sort", ["dollarVolume"])[0] or "dollarVolume").strip()
        sort_dir = str(params.get("dir", ["desc"])[0] or "desc").strip().lower()
        if sort_dir not in {"asc", "desc"}:
            sort_dir = "desc"
        where = []
        values: list[Any] = []
        if query:
            like = f"%{query}%"
            where.append("(s.symbol LIKE ? OR UPPER(COALESCE(s.company, '')) LIKE ? OR UPPER(COALESCE(s.chinese_name, '')) LIKE ?)")
            values.extend([like, like, like])
        if sector and sector.lower() != "all":
            where.append("s.sector = ?")
            values.append(sector)
        if cap == "large":
            where.append("COALESCE(s.market_cap_value, 0) >= ?")
            values.append(10_000_000_000)
        elif cap == "mid":
            where.append("COALESCE(s.market_cap_value, 0) >= ? AND COALESCE(s.market_cap_value, 0) < ?")
            values.extend([1_000_000_000, 10_000_000_000])
        elif cap == "small":
            where.append("COALESCE(s.market_cap_value, 0) > 0 AND COALESCE(s.market_cap_value, 0) < ?")
            values.append(1_000_000_000)
        elif cap == "unknown":
            where.append("COALESCE(s.market_cap_value, 0) <= 0")
        if preset == "liquid":
            where.append("COALESCE(s.latest_dollar_volume, 0) >= ?")
            values.append(5_000_000)
        elif preset == "event":
            where.append("EXISTS (SELECT 1 FROM stock_event_rows ev WHERE ev.symbol = s.symbol)")
        elif preset == "strength":
            where.append("EXISTS (SELECT 1 FROM strength_rows st WHERE st.symbol = s.symbol)")
        elif preset == "etf":
            where.append("UPPER(COALESCE(s.sector, '')) LIKE ?")
            values.append("%ETF%")
        elif preset == "watchlist":
            symbols = [
                str(item).strip().upper()
                for item in params.get("watchlist", [""])[0].split(",")
                if str(item).strip()
            ]
            if symbols:
                placeholders = ",".join("?" for _ in symbols)
                where.append(f"s.symbol IN ({placeholders})")
                values.extend(symbols)
            else:
                where.append("0")
        where_sql = "WHERE " + " AND ".join(where) if where else ""
        order_sql = product_stock_library_order(sort_key, sort_dir)
        total = conn.execute(
            f"SELECT COUNT(*) AS count FROM symbols s {where_sql}",
            values,
        ).fetchone()["count"]
        rows = conn.execute(
            f"""
            SELECT
              s.*,
              day.change_pct AS day_change,
              week.change_pct AS week_change,
              month.change_pct AS month_change,
              ytd.change_pct AS ytd_change,
              day.price AS day_price,
              (
                SELECT ev.event_label
                FROM stock_event_rows ev
                WHERE ev.symbol = s.symbol
                ORDER BY ev.event_date DESC, ev.rank ASC
                LIMIT 1
              ) AS event_label,
              (
                SELECT ev.event_date
                FROM stock_event_rows ev
                WHERE ev.symbol = s.symbol
                ORDER BY ev.event_date DESC, ev.rank ASC
                LIMIT 1
              ) AS event_date,
              EXISTS (SELECT 1 FROM stock_event_rows ev WHERE ev.symbol = s.symbol) AS has_event,
              (
                SELECT eq.user_angle
                FROM earnings_quality_rows eq
                WHERE eq.symbol = s.symbol
                ORDER BY CASE eq.board WHEN 'quality' THEN 1 WHEN 'confluence' THEN 2 ELSE 99 END
                LIMIT 1
              ) AS quality_label,
              (
                SELECT COALESCE(eq.quality_score, eq.score, eq.confluence_score)
                FROM earnings_quality_rows eq
                WHERE eq.symbol = s.symbol
                ORDER BY CASE eq.board WHEN 'quality' THEN 1 WHEN 'confluence' THEN 2 ELSE 99 END
                LIMIT 1
              ) AS quality_score,
              strength.label AS strength_label,
              strength.score AS strength_score
            FROM symbols s
            LEFT JOIN market_board_rows day ON day.symbol = s.symbol AND day.board = 'day'
            LEFT JOIN market_board_rows week ON week.symbol = s.symbol AND week.board = 'week'
            LEFT JOIN market_board_rows month ON month.symbol = s.symbol AND month.board = 'month'
            LEFT JOIN market_board_rows ytd ON ytd.symbol = s.symbol AND ytd.board = 'ytd'
            LEFT JOIN market_board_rows volume ON volume.symbol = s.symbol AND volume.board = 'volume'
            LEFT JOIN strength_rows strength ON strength.symbol = s.symbol
            {where_sql}
            ORDER BY
              CASE WHEN s.symbol = ? THEN 0 WHEN s.symbol LIKE ? THEN 1 ELSE 2 END,
              {order_sql}
            LIMIT ?
            OFFSET ?
            """,
            (*values, query, f"{query}%", limit, offset),
        ).fetchall()
        payload_rows = [product_stock_library_payload(row) for row in rows]
        if not can_view_strength:
            for payload in payload_rows:
                payload.pop("strengthLabel", None)
                payload.pop("strengthScore", None)
        self.send_json(
            {
                "rows": payload_rows,
                "total": total,
                "limit": limit,
                "offset": offset,
                "sort": sort_key,
                "dir": sort_dir,
            }
        )

    def send_product_symbol_meta(self, conn: sqlite3.Connection) -> None:
        sectors = conn.execute(
            """
            SELECT sector, COUNT(*) AS count
            FROM symbols
            WHERE COALESCE(sector, '') NOT IN ('', '--', '未分类', '板块待补')
            GROUP BY sector
            ORDER BY count DESC, sector ASC
            """
        ).fetchall()
        total = conn.execute("SELECT COUNT(*) AS count FROM symbols").fetchone()["count"]
        self.send_json(
            {
                "total": total,
                "sectors": [{"sector": row["sector"], "count": row["count"]} for row in sectors],
            }
        )

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
        user = self.current_user()
        can_view_strength = bool(user and entitlements(user)["paid"])
        strength = conn.execute("SELECT * FROM strength_rows WHERE symbol = ?", (target,)).fetchone() if can_view_strength else None
        self.send_json(
            {
                "profile": product_symbol_payload(profile),
                "marketRows": [
                    product_market_row_payload(row, can_view_strength) for row in market_rows
                ],
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
        offset = int_param(params, "offset", 0, minimum=0, maximum=100000)
        sector = str(params.get("sector", [""])[0]).strip()
        where = ["board = ?"]
        values: list[Any] = [board]
        if sector:
            where.append("sector = ?")
            values.append(sector)
        total = conn.execute(
            f"""
            SELECT COUNT(*) AS count
            FROM market_board_rows
            WHERE {" AND ".join(where)}
            """,
            values,
        ).fetchone()["count"]
        rows = conn.execute(
            f"""
            SELECT *
            FROM market_board_rows
            WHERE {" AND ".join(where)}
            ORDER BY rank ASC
            LIMIT ? OFFSET ?
            """,
            (*values, limit, offset),
        ).fetchall()
        user = self.current_user()
        can_view_paid_data = bool(user and entitlements(user)["paid"])
        self.send_json(
            {
                "board": board,
                "rows": [
                    product_market_row_payload(row, can_view_paid_data) for row in rows
                ],
                "total": total,
                "limit": limit,
                "offset": offset,
            }
        )

    def send_product_sectors(self, conn: sqlite3.Connection, params: dict[str, list[str]]) -> None:
        limit = int_param(params, "limit", 20, maximum=100)
        offset = int_param(params, "offset", 0, minimum=0, maximum=100000)
        include_unknown = str(params.get("includeUnknown", ["false"])[0]).lower() in {"1", "true", "yes"}
        board = str(params.get("board", [""])[0] or "").strip()
        if board:
            if board not in {"day", "week", "month", "ytd"}:
                self.send_json({"error": "榜单不存在", "board": board}, HTTPStatus.BAD_REQUEST)
                return
            self.send_json(product_sector_board_payload(conn, board, include_unknown, limit, offset))
            return
        where_sql = "" if include_unknown else "WHERE sector NOT IN ('未分类', '板块待补', '--')"
        total = conn.execute(
            f"""
            SELECT COUNT(*) AS count
            FROM sector_flow_rows
            {where_sql}
            """
        ).fetchone()["count"]
        rows = conn.execute(
            f"""
            SELECT *
            FROM sector_flow_rows
            {where_sql}
            ORDER BY COALESCE(net_flow_proxy, 0) DESC, rank ASC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        ).fetchall()
        self.send_json({"rows": [product_sector_payload(row) for row in rows], "total": total, "limit": limit, "offset": offset})

    def send_product_calendar(self, conn: sqlite3.Connection, params: dict[str, list[str]]) -> None:
        limit = int_param(params, "limit", 50, maximum=200)
        offset = int_param(params, "offset", 0, minimum=0, maximum=100000)
        impact = str(params.get("impact", [""])[0]).strip()
        event_type = str(params.get("type", [""])[0]).strip()
        query = str(params.get("q", [""])[0]).strip().lower()
        window_days = int_param(params, "windowDays", 0, minimum=0, maximum=3650)
        results_only = str(params.get("resultsOnly", ["false"])[0]).lower() in {"1", "true", "yes"}
        where = []
        values: list[Any] = []
        if impact:
            where.append("impact = ?")
            values.append(impact)
        if event_type:
            where.append("event_type = ?")
            values.append(event_type)
        if window_days:
            today = datetime.now().strftime("%Y-%m-%d")
            end = (datetime.now() + timedelta(days=window_days)).strftime("%Y-%m-%d")
            where.append("event_date >= ?")
            where.append("event_date <= ?")
            values.extend([today, end])
        if results_only:
            where.append("(actual_label IS NOT NULL AND actual_label != '' OR actual_value IS NOT NULL)")
        if query:
            like = f"%{query}%"
            where.append(
                """
                (lower(title) LIKE ?
                 OR lower(summary) LIKE ?
                 OR lower(related_assets_json) LIKE ?
                 OR lower(source_name) LIKE ?)
                """
            )
            values.extend([like, like, like, like])
        where_sql = "WHERE " + " AND ".join(where) if where else ""
        total = conn.execute(
            f"""
            SELECT COUNT(*) AS count
            FROM calendar_events
            {where_sql}
            """,
            values,
        ).fetchone()["count"]
        rows = conn.execute(
            f"""
            SELECT *
            FROM calendar_events
            {where_sql}
            ORDER BY {"event_date DESC, event_time DESC, title ASC" if results_only else "event_date ASC, CASE WHEN event_time IS NULL OR event_time = '' THEN 1 ELSE 0 END, event_time ASC, CASE WHEN event_type = 'macro' THEN 0 ELSE 1 END, title ASC"}
            LIMIT ? OFFSET ?
            """,
            (*values, limit, offset),
        ).fetchall()
        self.send_json({"rows": [product_calendar_payload(row) for row in rows], "total": total, "limit": limit, "offset": offset})

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

    def send_product_opinions(self, conn: sqlite3.Connection, params: dict[str, list[str]]) -> None:
        limit = int_param(params, "limit", 50, maximum=200)
        offset = int_param(params, "offset", 0, minimum=0, maximum=10000)
        section = str(params.get("section", [""])[0]).strip()
        payload = query_market_opinions(include_drafts=False, section=section, limit=limit, offset=offset)
        if not entitlements(self.current_user())["paid"]:
            payload["rows"] = [
                {**item, "body": "", "highlights": []}
                for item in payload["rows"]
            ]
        self.send_json(payload)

    def current_user(self) -> sqlite3.Row | None:
        cookie = SimpleCookie(self.headers.get("Cookie"))
        morsel = cookie.get("mg_session")
        if not morsel:
            return None
        payload = verify_session(morsel.value)
        if not payload:
            return None
        user = find_user_by_id(int(payload["uid"]))
        if user and timestamp_epoch(user["password_changed_at"]) > int(payload.get("iat", 0)):
            return None
        return user

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

    def require_dataset_access(self, name: str) -> bool:
        if name not in REGISTERED_DATASETS and name not in PAID_DATASETS:
            return True
        user = self.current_user()
        if not user:
            self.send_json({"error": "请先登录", "code": "unauthenticated"}, HTTPStatus.UNAUTHORIZED)
            return False
        if name in PAID_DATASETS and not entitlements(user)["paid"]:
            self.send_json({"error": "月度或年度会员可查看", "code": "membership_required"}, HTTPStatus.FORBIDDEN)
            return False
        return True

    def course_lesson_for_playback(self, user: sqlite3.Row, lesson_id: int) -> sqlite3.Row | None:
        with db() as conn:
            lesson = conn.execute(
                """
                SELECT l.*, s.status AS series_status
                FROM course_lessons l
                JOIN course_series s ON s.id = l.series_id
                WHERE l.id = ?
                """,
                (lesson_id,),
            ).fetchone()
            if (
                not lesson
                or lesson["status"] != "published"
                or lesson["series_status"] != "published"
                or not str(lesson["video_key"] or "").strip()
                or (
                    course_video_status(lesson["video_status"] if "video_status" in lesson.keys() else "") != "ready"
                    and not str(lesson["video_source_key"] or "").strip()
                )
            ):
                self.send_json({"error": "视频不存在"}, HTTPStatus.NOT_FOUND)
                return None
            if not course_has_access(conn, user, int(lesson["series_id"])):
                self.send_json({"error": "没有交易实战课程权限", "code": "course_forbidden"}, HTTPStatus.FORBIDDEN)
                return None
        return lesson

    def do_GET(self) -> None:
        if self.path == "/api/health":
            self.send_json({"ok": True, "time": now_iso()})
            return

        if self.path.startswith("/api/upload") or self.path.startswith("/upload") or self.path.startswith("/api/uploads/") or self.path.startswith("/uploads/"):
            self.send_upload(self.path)
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
            if not has_yearly_access(user):
                self.send_json({"error": "持仓参考需要年度会员权限", "code": "yearly_required"}, HTTPStatus.FORBIDDEN)
                return
            self.send_json({"records": TRADE_RECORDS})
            return

        if self.path == "/api/open-portfolio":
            user = self.require_user()
            if not user:
                return
            if not has_yearly_access(user):
                self.send_json({"error": "持仓参考需要年度会员权限", "code": "yearly_required"}, HTTPStatus.FORBIDDEN)
                return
            try:
                with product_db_write() as conn:
                    self.send_json(open_portfolio.payload(conn))
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                self.send_json({"error": f"读取失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if self.path == "/api/courses":
            user = self.require_user()
            if not user:
                return
            self.send_json(user_courses_payload(user))
            return

        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/courses/lessons/") and parsed.path.endswith("/hls"):
            user = self.require_user()
            if not user:
                return
            try:
                lesson_id = int(parsed.path.removesuffix("/hls").removeprefix("/api/courses/lessons/"))
            except ValueError:
                self.send_json({"error": "视频不存在"}, HTTPStatus.NOT_FOUND)
                return
            lesson = self.course_lesson_for_playback(user, lesson_id)
            if not lesson:
                return
            master_key = str(lesson["video_key"] or "").strip()
            if not course_video_is_hls(master_key):
                self.send_json({"error": "HLS 视频不存在"}, HTTPStatus.NOT_FOUND)
                return
            requested_key = str(parse_qs(parsed.query).get("playlist", [master_key])[0]).strip()
            try:
                clean_key = validate_course_hls_playlist_key(master_key, requested_key)
                content = fetch_course_cos_text(clean_key)
                playlist = render_course_hls_playlist(lesson_id, master_key, clean_key, content)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception:
                self.send_json({"error": "播放清单暂时不可用"}, HTTPStatus.BAD_GATEWAY)
                return
            self.send_content(playlist.encode("utf-8"), "application/vnd.apple.mpegurl; charset=utf-8")
            return

        if parsed.path.startswith("/api/courses/lessons/") and parsed.path.endswith("/play"):
            user = self.require_user()
            if not user:
                return
            try:
                lesson_id = int(parsed.path.removesuffix("/play").removeprefix("/api/courses/lessons/"))
            except ValueError:
                self.send_json({"error": "视频不存在"}, HTTPStatus.NOT_FOUND)
                return
            lesson = self.course_lesson_for_playback(user, lesson_id)
            if not lesson:
                return
            try:
                is_hls = course_video_is_hls(lesson["video_key"])
                play_url, play_ttl = observed_course_play_url(
                    int(user["id"]),
                    lesson_id,
                    str(lesson["video_key"]),
                    self.client_ip(),
                    str(self.headers.get("User-Agent", "")),
                )
            except Exception as exc:
                self.send_json({"error": f"播放地址不可用：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            write_course_play_grant(user, lesson_id)
            self.send_json({"url": play_url, "expiresIn": play_ttl, "type": "hls" if is_hls else "file"})
            return

        if parsed.path == "/api/tools/funding-arbitrage":
            user = self.require_admin()
            if not user:
                return
            try:
                raw_params = {key: values[0] for key, values in parse_qs(parsed.query).items()}
                self.send_json(funding_scanner.scan(raw_params))
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                self.send_json({"error": f"扫描失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if parsed.path == "/api/admin/open-portfolio":
            user = self.require_admin()
            if not user:
                return
            try:
                with product_db_write() as conn:
                    self.send_json(open_portfolio.payload(conn))
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                self.send_json({"error": f"读取失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
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
            regular_users = [item for item in users if item["role"] == "user"]
            performance_map: dict[str, dict[str, Any]] = {}
            for item in regular_users:
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
                        "total": len(regular_users),
                        "active": sum(1 for item in regular_users if item["isActive"]),
                        "paid": sum(1 for item in regular_users if item["hasPaidAccess"]),
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

        if parsed.path == "/api/admin/metrics":
            user = self.require_admin()
            if not user:
                return
            params = parse_qs(parsed.query)
            with db() as conn:
                try:
                    self.send_json(admin_metrics_payload(conn, params))
                except ValueError as exc:
                    self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        if parsed.path == "/api/admin/user-events":
            user = self.require_admin()
            if not user:
                return
            params = parse_qs(parsed.query)
            target_id = int_param(params, "userId", 0, minimum=0, maximum=10_000_000)
            limit = int_param(params, "limit", 80, maximum=300)
            values: list[Any] = []
            where = []
            with db() as conn:
                if target_id:
                    where.append("e.target_user_id = ?")
                    values.append(target_id)
                where_sql = "WHERE " + " AND ".join(where) if where else ""
                rows = conn.execute(
                    f"""
                    SELECT e.*
                    FROM user_events e
                    LEFT JOIN users target ON target.id = e.target_user_id
                    {where_sql}
                    ORDER BY e.id DESC
                    LIMIT ?
                    """,
                    (*values, limit),
                ).fetchall()
            self.send_json({"rows": [user_event_payload(row) for row in rows]})
            return

        if parsed.path == "/api/admin/opinions":
            admin = self.require_admin()
            if not admin:
                return
            params = parse_qs(parsed.query)
            section = str(params.get("section", [""])[0]).strip()
            status = str(params.get("status", [""])[0]).strip()
            date_from = str(params.get("dateFrom", [""])[0]).strip()
            date_to = str(params.get("dateTo", [""])[0]).strip()
            query = str(params.get("q", [""])[0]).strip()
            sort = str(params.get("sort", ["latest"])[0]).strip()
            limit = int_param(params, "limit", 50, maximum=200)
            offset = int_param(params, "offset", 0, minimum=0, maximum=100000)
            try:
                payload = query_market_opinions(
                    include_drafts=True,
                    section=section,
                    limit=limit,
                    offset=offset,
                    status=status,
                    date_from=date_from,
                    date_to=date_to,
                    query=query,
                    sort=sort,
                )
            except Exception as exc:
                self.send_json({"error": f"读取失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            self.send_json(payload)
            return

        if parsed.path == "/api/admin/courses":
            admin = self.require_admin()
            if not admin:
                return
            self.send_json(list_admin_courses())
            return

        if self.path.startswith("/api/"):
            self.send_json({"error": "接口不存在"}, HTTPStatus.NOT_FOUND)
            return

        self.send_static(self.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if self.path == "/api/auth/login":
            try:
                payload = self.read_json()
            except Exception:
                self.send_json({"error": "请求格式错误"}, HTTPStatus.BAD_REQUEST)
                return
            email = normalize_email(payload.get("email", ""))
            password = str(payload.get("password", ""))
            admin_only = bool(payload.get("adminOnly"))
            if email and not EMAIL_PATTERN.fullmatch(email) and email != SUPER_ADMIN_EMAIL:
                self.send_json({"error": "账号或密码不正确"}, HTTPStatus.UNAUTHORIZED)
                return
            retry_after = login_failure_retry_after(self.client_ip(), email)
            if retry_after:
                self.send_json(
                    {"error": "登录过于频繁，请稍后再试", "code": "rate_limited", "retryAfter": retry_after},
                    HTTPStatus.TOO_MANY_REQUESTS,
                )
                return
            user = find_user_by_email(email) if email else None
            if not user or not verify_password(password, user["salt"], user["password_hash"]):
                record_login_failure(self.client_ip(), email)
                self.send_json({"error": "账号或密码不正确"}, HTTPStatus.UNAUTHORIZED)
                return
            if admin_only and user["role"] not in {"admin", "super_admin"}:
                self.send_json({"error": "只有管理员可以登录后台", "code": "admin_required"}, HTTPStatus.FORBIDDEN)
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

        if self.path == "/api/auth/register":
            try:
                payload = self.read_json()
            except Exception:
                self.send_json({"error": "请求格式错误"}, HTTPStatus.BAD_REQUEST)
                return
            email = normalize_email(payload.get("email", ""))
            allowed, retry_after = register_rate_check(self.client_ip(), email)
            if not allowed:
                self.send_json(
                    {"error": "注册过于频繁，请稍后再试", "code": "rate_limited", "retryAfter": retry_after},
                    HTTPStatus.TOO_MANY_REQUESTS,
                )
                return
            try:
                user = register_public_user(email, str(payload.get("password", "")))
            except ValueError as exc:
                status = HTTPStatus.CONFLICT if "已注册" in str(exc) else HTTPStatus.BAD_REQUEST
                self.send_json({"error": str(exc)}, status)
                return
            token = sign_session(int(user["id"]))
            cookie = f"mg_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_TTL}"
            self.send_json(
                {
                    "authenticated": True,
                    "user": user_to_public(user),
                    "entitlements": entitlements(user),
                },
                cookies=[cookie],
                status=HTTPStatus.CREATED,
            )
            return

        if self.path == "/api/auth/forgot-password":
            try:
                payload = self.read_json()
            except Exception:
                self.send_json({"error": "请求格式错误"}, HTTPStatus.BAD_REQUEST)
                return
            email = normalize_email(payload.get("email", ""))
            try:
                validate_email(email)
            except ValueError:
                self.send_json({"error": "邮箱格式不正确"}, HTTPStatus.BAD_REQUEST)
                return
            allowed, retry_after = password_reset_rate_check(self.client_ip(), email)
            if not allowed:
                self.send_json(
                    {"error": "操作过于频繁，请稍后再试", "code": "rate_limited", "retryAfter": retry_after},
                    HTTPStatus.TOO_MANY_REQUESTS,
                )
                return
            user = find_user_by_email(email)
            if user:
                try:
                    with db() as conn:
                        token = create_password_reset_token(conn, user, self.client_ip())
                    send_password_reset_email(email, password_reset_url(token))
                except Exception as exc:
                    print(f"password reset mail failed for {email}: {exc}", flush=True)
            self.send_json({"ok": True, "message": "如果邮箱存在，我们会发送重置链接。"})
            return

        if self.path == "/api/auth/reset-password":
            try:
                payload = self.read_json()
            except Exception:
                self.send_json({"error": "请求格式错误"}, HTTPStatus.BAD_REQUEST)
                return
            try:
                reset_password_with_token(str(payload.get("token", "")), str(payload.get("password", "")))
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            self.send_json({"ok": True})
            return

        if self.path == "/api/auth/onboarding-seen":
            user = self.require_user()
            if not user:
                return
            timestamp = now_iso()
            with db() as conn:
                conn.execute(
                    "UPDATE users SET onboarding_seen_at = ?, updated_at = ? WHERE id = ?",
                    (timestamp, timestamp, user["id"]),
                )
            fresh_user = find_user_by_id(int(user["id"]))
            self.send_json(
                {
                    "authenticated": True,
                    "user": user_to_public(fresh_user),
                    "entitlements": entitlements(fresh_user),
                }
            )
            return

        if self.path == "/api/auth/logout":
            self.send_json(
                {"ok": True},
                cookies=["mg_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"],
            )
            return

        if self.path == "/api/analytics/event":
            try:
                payload = self.read_json()
                with db() as conn:
                    write_analytics_event(conn, self.current_user(), payload)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception:
                self.send_json({"error": "埋点失败"}, HTTPStatus.BAD_REQUEST)
                return
            self.send_json({"ok": True}, HTTPStatus.CREATED)
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
            if role != "user":
                plan = "free"
                subscription_expires_at = None
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
                write_user_event(conn, action="update_user", actor=admin, target_before=target, target_after=fresh)
            self.send_json({"ok": True, "user": admin_user_payload(fresh)})
            return

        if self.path == "/api/admin/users/create":
            self.send_json({"error": "后台不创建用户，请用户自行注册"}, HTTPStatus.NOT_FOUND)
            return

        if self.path == "/api/admin/users/reset-password":
            admin = self.require_admin()
            if not admin:
                return
            if admin["role"] != "super_admin":
                self.send_json({"error": "只有超级管理员可以重置密码"}, HTTPStatus.FORBIDDEN)
                return
            payload = self.read_json()
            user_id = int(payload.get("userId", 0))
            password = str(payload.get("password", ""))
            try:
                validate_password(password)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            with db() as conn:
                target = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                if not target:
                    self.send_json({"error": "用户不存在"}, HTTPStatus.NOT_FOUND)
                    return
                if target["role"] == "super_admin":
                    self.send_json({"error": "超级管理员密码不能在这里重置"}, HTTPStatus.FORBIDDEN)
                    return
                salt, password_hash = hash_password(password)
                timestamp = now_iso()
                conn.execute(
                    """
                    UPDATE users
                    SET password_hash = ?, salt = ?, password_changed_at = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (password_hash, salt, timestamp, timestamp, user_id),
                )
                fresh = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                write_user_event(conn, action="reset_password", actor=admin, target_before=target, target_after=fresh)
            self.send_json({"ok": True, "user": admin_user_payload(fresh)})
            return

        if self.path == "/api/admin/opinions":
            admin = self.require_admin()
            if not admin:
                return
            try:
                item = save_market_opinion(self.read_json())
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception as exc:
                self.send_json({"error": f"保存失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            self.send_json({"ok": True, "item": item}, HTTPStatus.CREATED)
            return

        if self.path == "/api/admin/open-portfolio/trades":
            admin = self.require_admin()
            if not admin:
                return
            try:
                with product_db_write() as conn:
                    result = open_portfolio.add_trade(conn, self.read_json(), now_iso().replace("T", " ")[:19])
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception as exc:
                self.send_json({"error": f"保存失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            self.send_json({"ok": True, **result}, HTTPStatus.CREATED)
            return

        if parsed.path.startswith("/api/admin/open-portfolio/trades/") and parsed.path.endswith("/note"):
            admin = self.require_admin()
            if not admin:
                return
            try:
                trade_id = int(unquote(parsed.path.removeprefix("/api/admin/open-portfolio/trades/").removesuffix("/note")))
                with product_db_write() as conn:
                    updated = open_portfolio.update_trade_note(conn, trade_id, str(self.read_json().get("note", "")))
                    result = open_portfolio.payload(conn)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception as exc:
                self.send_json({"error": f"保存失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            if not updated:
                self.send_json({"error": "交易记录不存在"}, HTTPStatus.NOT_FOUND)
                return
            self.send_json({"ok": True, **result})
            return

        if self.path == "/api/admin/uploads":
            admin = self.require_admin()
            if not admin:
                return
            try:
                image = save_upload_image(self.read_json())
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception as exc:
                self.send_json({"error": f"上传失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            self.send_json({"ok": True, "image": image}, HTTPStatus.CREATED)
            return

        if parsed.path == "/api/admin/courses/video-upload":
            admin = self.require_admin()
            if not admin:
                return
            try:
                name = parse_qs(parsed.query).get("name", ["lesson-video"])[0]
                video = upload_course_video(name, str(self.headers.get("Content-Type", "")), self.read_body(COURSE_VIDEO_UPLOAD_MAX_BYTES))
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception as exc:
                self.send_json({"error": f"上传失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            self.send_json({"ok": True, "video": video}, HTTPStatus.CREATED)
            return

        if parsed.path == "/api/admin/courses/video-upload-url":
            admin = self.require_admin()
            if not admin:
                return
            try:
                video = create_course_video_upload_ticket(self.read_json())
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception as exc:
                self.send_json({"error": f"上传准备失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            self.send_json({"ok": True, "video": video}, HTTPStatus.CREATED)
            return

        if parsed.path == "/api/admin/courses/image-upload-url":
            admin = self.require_admin()
            if not admin:
                return
            try:
                image = create_course_image_upload_ticket(self.read_json())
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception as exc:
                self.send_json({"error": f"上传准备失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            self.send_json({"ok": True, "image": image}, HTTPStatus.CREATED)
            return

        if parsed.path == "/api/admin/courses/video-process":
            admin = self.require_admin()
            if not admin:
                return
            try:
                item = process_course_video(self.read_json())
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception as exc:
                self.send_json({"error": f"视频处理启动失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            self.send_json({"ok": item["videoStatus"] != "failed", "lesson": item}, HTTPStatus.CREATED)
            return

        if parsed.path.startswith("/api/admin/courses/lessons/") and parsed.path.endswith("/retry"):
            admin = self.require_admin()
            if not admin:
                return
            try:
                lesson_id = int(unquote(parsed.path.removeprefix("/api/admin/courses/lessons/").removesuffix("/retry")))
                item = retry_course_video(lesson_id)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception as exc:
                self.send_json({"error": f"重试失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            self.send_json({"ok": item["videoStatus"] != "failed", "lesson": item}, HTTPStatus.CREATED)
            return

        if self.path == "/api/admin/courses":
            admin = self.require_admin()
            if not admin:
                return
            try:
                item = create_course_series(self.read_json())
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception as exc:
                self.send_json({"error": f"保存失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            self.send_json({"ok": True, "series": item}, HTTPStatus.CREATED)
            return

        if self.path == "/api/admin/courses/lessons":
            admin = self.require_admin()
            if not admin:
                return
            try:
                item = create_course_lesson(self.read_json())
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception as exc:
                self.send_json({"error": f"保存失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            self.send_json({"ok": True, "lesson": item}, HTTPStatus.CREATED)
            return

        if self.path == "/api/admin/courses/grants":
            admin = self.require_admin()
            if not admin:
                return
            try:
                item = grant_course(self.read_json(), admin)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception as exc:
                self.send_json({"error": f"授权失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            self.send_json({"ok": True, "grant": item}, HTTPStatus.CREATED)
            return

        if self.path == "/api/admin/courses/grants/all":
            admin = self.require_admin()
            if not admin:
                return
            try:
                result = grant_all_courses(self.read_json(), admin)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception as exc:
                self.send_json({"error": f"授权失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            self.send_json(result, HTTPStatus.CREATED)
            return

        self.send_json({"error": "接口不存在"}, HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/admin/open-portfolio/trades/"):
            admin = self.require_admin()
            if not admin:
                return
            try:
                trade_id = int(unquote(parsed.path.removeprefix("/api/admin/open-portfolio/trades/")))
                with product_db_write() as conn:
                    deleted = open_portfolio.delete_trade(conn, trade_id)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception as exc:
                self.send_json({"error": f"删除失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            if not deleted:
                self.send_json({"error": "交易记录不存在"}, HTTPStatus.NOT_FOUND)
                return
            self.send_json({"ok": True})
            return

        if parsed.path.startswith("/api/admin/opinions/"):
            admin = self.require_admin()
            if not admin:
                return
            item_id = unquote(parsed.path.removeprefix("/api/admin/opinions/"))
            try:
                deleted = delete_market_opinion(item_id)
            except Exception as exc:
                self.send_json({"error": f"删除失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            if not deleted:
                self.send_json({"error": "内容不存在"}, HTTPStatus.NOT_FOUND)
                return
            self.send_json({"ok": True})
            return

        if parsed.path.startswith("/api/admin/users/"):
            admin = self.require_admin()
            if not admin:
                return
            if admin["role"] != "super_admin":
                self.send_json({"error": "只有超级管理员可以删除用户"}, HTTPStatus.FORBIDDEN)
                return
            try:
                user_id = int(unquote(parsed.path.removeprefix("/api/admin/users/")))
            except ValueError:
                self.send_json({"error": "用户不存在"}, HTTPStatus.NOT_FOUND)
                return
            with db() as conn:
                target = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                if not target:
                    self.send_json({"error": "用户不存在"}, HTTPStatus.NOT_FOUND)
                    return
                if target["role"] == "super_admin":
                    self.send_json({"error": "超级管理员不能删除"}, HTTPStatus.FORBIDDEN)
                    return
                write_user_event(conn, action="delete_user", actor=admin, target_before=target, target_after=None)
                conn.execute("DELETE FROM course_grants WHERE user_id = ? OR granted_by_user_id = ?", (user_id, user_id))
                conn.execute("DELETE FROM password_reset_tokens WHERE user_id = ?", (user_id,))
                conn.execute("DELETE FROM analytics_events WHERE user_id = ?", (user_id,))
                conn.execute("UPDATE users SET created_by_user_id = NULL WHERE created_by_user_id = ?", (user_id,))
                conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
            self.send_json({"ok": True})
            return

        if parsed.path.startswith("/api/admin/courses/grants/"):
            admin = self.require_admin()
            if not admin:
                return
            try:
                grant_id = int(unquote(parsed.path.removeprefix("/api/admin/courses/grants/")))
            except ValueError:
                self.send_json({"error": "授权不存在"}, HTTPStatus.NOT_FOUND)
                return
            with db() as conn:
                target = conn.execute(
                    """
                    SELECT u.*
                    FROM course_grants g
                    JOIN users u ON u.id = g.user_id
                    WHERE g.id = ?
                    """,
                    (grant_id,),
                ).fetchone()
                if not target:
                    self.send_json({"error": "授权不存在"}, HTTPStatus.NOT_FOUND)
                    return
                cursor = conn.execute("DELETE FROM course_grants WHERE id = ?", (grant_id,))
                write_user_event(conn, action="revoke_course", actor=admin, target_before=target, target_after=target)
            if cursor.rowcount <= 0:
                self.send_json({"error": "授权不存在"}, HTTPStatus.NOT_FOUND)
                return
            self.send_json({"ok": True})
            return

        if parsed.path.startswith("/api/admin/courses/lessons/"):
            admin = self.require_admin()
            if not admin:
                return
            try:
                lesson_id = int(unquote(parsed.path.removeprefix("/api/admin/courses/lessons/")))
            except ValueError:
                self.send_json({"error": "视频不存在"}, HTTPStatus.NOT_FOUND)
                return
            if not delete_course_lesson(lesson_id):
                self.send_json({"error": "视频不存在"}, HTTPStatus.NOT_FOUND)
                return
            self.send_json({"ok": True})
            return

        if parsed.path.startswith("/api/admin/courses/"):
            admin = self.require_admin()
            if not admin:
                return
            try:
                series_id = int(unquote(parsed.path.removeprefix("/api/admin/courses/")))
            except ValueError:
                self.send_json({"error": "交易实战课程不存在"}, HTTPStatus.NOT_FOUND)
                return
            if not delete_course_series(series_id):
                self.send_json({"error": "交易实战课程不存在"}, HTTPStatus.NOT_FOUND)
                return
            self.send_json({"ok": True})
            return

        self.send_json({"error": "接口不存在"}, HTTPStatus.NOT_FOUND)


def main() -> None:
    validate_course_cdn_config()
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"auth api listening on http://{HOST}:{PORT}, db={DB_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    main()

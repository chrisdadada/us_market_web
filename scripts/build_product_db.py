#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sqlite3
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
TMP_DIR = ROOT / ".tmp"
DEFAULT_OUTPUT = DATA_DIR / "product.db"
SCHEMA_VERSION = 2
KNOWN_SECTORS = {
    "ETF",
    "科技",
    "通信",
    "能源",
    "金融",
    "消费",
    "工业",
    "材料",
    "医疗",
    "生物医药",
    "地产",
    "公用事业",
}
UNKNOWN_SECTORS = {"", "--", "未分类", "板块待补", "None", "null", "nan"}
PRODUCT_DATA_PAYLOADS: dict[str, dict[str, Any]] | None = None


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def existing_product_db() -> Path | None:
    path = Path(os.environ.get("PRODUCT_DB") or DEFAULT_OUTPUT)
    return path if path.exists() else None


def load_existing_dataset_payload(name: str) -> tuple[dict[str, Any], Path]:
    path = existing_product_db()
    if not path:
        return {}, Path(f"db:{name}:missing")
    try:
        with sqlite3.connect(path) as conn:
            row = conn.execute("SELECT payload_json FROM datasets WHERE name = ?", (name,)).fetchone()
    except sqlite3.Error as exc:
        print(f"WARN: existing DB dataset read skipped for {name}: {exc}")
        return {}, Path(f"db:{name}:error")
    if not row:
        return {}, Path(f"db:{name}:missing")
    return parse_json_text(row[0], {}), Path(f"db:{path.name}:{name}")


def load_product_data_payload(name: str) -> tuple[dict[str, Any], Path]:
    global PRODUCT_DATA_PAYLOADS
    if PRODUCT_DATA_PAYLOADS is None:
        try:
            sys.path.insert(0, str(ROOT / "scripts"))
            from build_product_data import (
                build_event_opportunities,
                build_events_calendar,
                build_market_temperature,
                build_validation_center,
            )

            events = build_event_opportunities()
            PRODUCT_DATA_PAYLOADS = {
                "market-temperature": build_market_temperature(),
                "events-calendar": build_events_calendar(),
                "event-opportunities": events,
                "validation-center": build_validation_center(events),
            }
        except Exception as exc:
            print(f"WARN: product data direct import skipped: {exc}")
            PRODUCT_DATA_PAYLOADS = {}
    if name in PRODUCT_DATA_PAYLOADS:
        return PRODUCT_DATA_PAYLOADS[name], Path(f"direct:{name}")
    return load_existing_dataset_payload(name)


def load_raw_payload(name: str) -> tuple[dict[str, Any], Path]:
    if name == "site-data-index":
        return load_site_data_index_payload()
    if name == "validation-center":
        return load_product_data_payload(name)
    if name == "strength-review":
        return load_strength_review_payload()
    if name == "crypto-etf-flows":
        return load_crypto_etf_flows_payload()
    if name == "bottom-strategy":
        baseline, baseline_path = load_existing_dataset_payload(name)
        if not baseline:
            baseline_path = ROOT / "server" / "bottom_strategy.json"
            baseline = parse_json_text(baseline_path.read_text(encoding="utf-8"), {})
        data_root = Path(os.environ.get("MARKET_DATA_ROOT", "/Volumes/Extreme SSD/market-data-lab/data"))
        if not data_root.exists():
            return baseline, baseline_path
        try:
            sys.path.insert(0, str(ROOT / "scripts"))
            from build_bottom_strategy import build_market_data_payload

            return build_market_data_payload(data_root, baseline), Path("direct:bottom-strategy")
        except Exception as exc:
            from build_bottom_strategy import stale_payload

            print(f"WARN: bottom strategy refresh skipped: {exc}")
            return stale_payload(baseline, os.environ.get("TRACKING_ASOF"), str(exc)), baseline_path
    try:
        sys.path.insert(0, str(ROOT / "scripts"))
        if name == "macro-series":
            from build_macro_series import DEFAULT_DATA_ROOT, build_payload, resolve_fred_dir

            fred_dir = resolve_fred_dir(Path(os.environ.get("MARKET_DATA_ROOT", DEFAULT_DATA_ROOT)))
            return build_payload(fred_dir), Path("direct:macro-series")
        if name == "index-valuation":
            from build_index_valuation import (
                DEFAULT_QQQ_FACT_SHEET_URL,
                DEFAULT_QQQ_HOLDINGS_URL,
                DEFAULT_SPY_FACT_SHEET_URL,
                DEFAULT_SPY_HOLDINGS_URL,
                DEFAULT_MARKET_DATA_ROOT,
                build_payload,
            )

            market_root = Path(os.environ.get("MARKET_DATA_ROOT", DEFAULT_MARKET_DATA_ROOT))
            previous_payload, _ = load_existing_dataset_payload(name)
            return build_payload(
                market_root,
                DEFAULT_QQQ_HOLDINGS_URL,
                DEFAULT_QQQ_FACT_SHEET_URL,
                DEFAULT_SPY_HOLDINGS_URL,
                DEFAULT_SPY_FACT_SHEET_URL,
                previous_payload=previous_payload,
            ), Path("direct:index-valuation")
        if name == "core-signals":
            from build_core_signals import DEFAULT_DATA_ROOT, build_signals

            data_root = Path(os.environ.get("MARKET_DATA_ROOT", DEFAULT_DATA_ROOT))
            return build_signals(data_root), Path("direct:core-signals")
    except Exception as exc:
        print(f"WARN: {name} direct import skipped: {exc}")
    return load_existing_dataset_payload(name)


def date_value(value: Any):
    text = text_value(value)
    if not text:
        return None
    return datetime.fromisoformat(text[:10]).date()


def load_options_flow_payload() -> tuple[dict[str, Any], Path]:
    try:
        data_root = os.environ.get("MARKET_DATA_ROOT")
        if data_root and not os.environ.get("DATA_ROOT"):
            os.environ["DATA_ROOT"] = data_root
        sys.path.insert(0, str(ROOT / "market-data-lab" / "scripts"))
        from build_options_flow_product import build_payload, load_env, read_option_aggs

        load_env()
        start = date_value(os.environ.get("OPTIONS_START_DATE") or os.environ.get("START_DATE"))
        end = date_value(os.environ.get("OPTIONS_END_DATE") or os.environ.get("TRACKING_ASOF"))
        df = read_option_aggs(start, end)
        if df.empty:
            raise ValueError("no options aggregates found")
        return build_payload(df), Path("direct:options-flow-snapshot")
    except Exception as exc:
        print(f"WARN: options flow direct import skipped: {exc}")
    payload, path = load_existing_dataset_payload("options-flow-snapshot")
    if payload:
        return payload, path
    return {"asOf": "", "meta": {}, "summary": {}, "timeline": [], "bullish": [], "bearish": [], "boards": {}}, Path("db:options-flow-snapshot:missing")


def load_earnings_quality_payload() -> tuple[dict[str, Any], Path]:
    return load_existing_dataset_payload("earnings-quality")


def load_site_data_index_payload() -> tuple[dict[str, Any], Path]:
    return load_existing_dataset_payload("site-data-index")


def load_strength_review_payload() -> tuple[dict[str, Any], Path]:
    return load_existing_dataset_payload("strength-review")


def load_crypto_etf_flows_payload() -> tuple[dict[str, Any], Path]:
    cache_path = DATA_DIR / "crypto-etf-flows.json"
    try:
        sys.path.insert(0, str(ROOT / "scripts"))
        from build_crypto_etf_flows import fetch_payload

        payload = fetch_payload()
        return payload, Path("direct:crypto-etf-flows")
    except Exception as exc:
        print(f"WARN: crypto-etf-flows direct import skipped: {exc}")
    payload, path = load_existing_dataset_payload("crypto-etf-flows")
    if payload.get("assets"):
        return payload, path
    try:
        cached = parse_json_text(cache_path.read_text(encoding="utf-8"), {})
    except OSError:
        cached = {}
    if cached.get("assets"):
        return cached, cache_path
    raise RuntimeError("crypto-etf-flows has no valid live, database, or cached payload")


def json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def parse_json_text(value: Any, fallback: Any) -> Any:
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def scalar(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json_text(value)
    return value


def text_value(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def normalize_datetime_text(value: Any) -> str | None:
    text = text_value(value)
    if not text:
        return None
    text = text.replace("T", " ")
    if len(text) == 10 and text[4] == "-" and text[7] == "-":
        return f"{text} 00:00:00"
    if len(text) == 16 and text[4] == "-" and text[7] == "-" and text[10] == " ":
        return f"{text}:00"
    return text[:19]


def symbol_value(value: Any) -> str | None:
    text = text_value(value)
    return text.upper() if text else None


def normalize_sector(value: Any) -> str | None:
    text = text_value(value)
    if not text or text in UNKNOWN_SECTORS:
        return None
    if text in KNOWN_SECTORS:
        return text
    parts = text.replace("/", " ").split()
    for part in reversed(parts):
        if part in KNOWN_SECTORS:
            return part
    return text


def float_value(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    text = str(value).strip().replace(",", "").replace("$", "").replace("+", "")
    if not text or text in {"--", "None", "null", "nan"}:
        return None
    multiplier = 1.0
    suffix = text[-1:].upper()
    if suffix in {"K", "M", "B", "T"}:
        text = text[:-1]
        multiplier = {"K": 1_000.0, "M": 1_000_000.0, "B": 1_000_000_000.0, "T": 1_000_000_000_000.0}[suffix]
    try:
        number = float(text)
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return number * multiplier


def percent_value(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    text = str(value).strip().replace("%", "").replace("+", "")
    return float_value(text)


def ratio_value(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    text = str(value).strip().replace("x", "").replace("X", "")
    return float_value(text)


def payload_hash(path: Path) -> str:
    if not path.exists():
        return ""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def table_count(conn: sqlite3.Connection, table: str) -> int:
    return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;

        CREATE TABLE product_db_info (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE datasets (
          name TEXT PRIMARY KEY,
          source_path TEXT NOT NULL,
          as_of TEXT,
          generated_at TEXT,
          row_count INTEGER NOT NULL DEFAULT 0,
          content_sha256 TEXT,
          payload_json TEXT NOT NULL
        );

        CREATE TABLE symbols (
          symbol TEXT PRIMARY KEY,
          company TEXT,
          chinese_name TEXT,
          sector TEXT,
          market_cap_label TEXT,
          market_cap_value REAL,
          latest_price REAL,
          latest_dollar_volume REAL,
          latest_volume_ratio REAL,
          latest_source TEXT,
          updated_at TEXT,
          sources_json TEXT NOT NULL DEFAULT '[]',
          payload_json TEXT NOT NULL
        );

        CREATE TABLE market_board_rows (
          board TEXT NOT NULL,
          rank INTEGER,
          symbol TEXT NOT NULL,
          trade_date TEXT,
          company TEXT,
          chinese_name TEXT,
          sector TEXT,
          risk TEXT,
          action_note TEXT,
          price REAL,
          change_pct REAL,
          volume_label TEXT,
          dollar_volume REAL,
          volume_ratio REAL,
          market_cap_label TEXT,
          market_cap_value REAL,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (board, symbol)
        );

        CREATE TABLE sector_flow_rows (
          as_of TEXT,
          rank INTEGER,
          sector TEXT NOT NULL,
          status TEXT,
          stock_count INTEGER,
          up_count INTEGER,
          down_count INTEGER,
          breadth_pct REAL,
          avg_change_pct REAL,
          active_value REAL,
          net_flow_proxy REAL,
          inflow_proxy REAL,
          outflow_proxy REAL,
          leaders_json TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (as_of, sector)
        );

        CREATE TABLE sector_overrides (
          symbol TEXT PRIMARY KEY,
          sector TEXT NOT NULL,
          updated_at TEXT
        );

        CREATE TABLE stock_event_rows (
          board TEXT NOT NULL,
          rank INTEGER,
          symbol TEXT NOT NULL,
          company_name TEXT,
          event_date TEXT,
          event_type TEXT,
          event_label TEXT,
          reason TEXT,
          risk TEXT,
          close REAL,
          signal_score REAL,
          return_20d_pct REAL,
          fwd_5d_pct REAL,
          fwd_20d_pct REAL,
          fwd_60d_pct REAL,
          liquidity_label TEXT,
          price_target_upside_pct REAL,
          short_interest REAL,
          days_to_cover REAL,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (board, symbol, rank)
        );

        CREATE TABLE calendar_events (
          event_id TEXT PRIMARY KEY,
          event_date TEXT,
          event_time TEXT,
          title TEXT NOT NULL,
          event_type TEXT,
          impact TEXT,
          source_name TEXT,
          actual_value REAL,
          actual_label TEXT,
          forecast_value REAL,
          forecast_label TEXT,
          previous_value REAL,
          previous_label TEXT,
          result_updated_at TEXT,
          related_modules_json TEXT NOT NULL,
          related_assets_json TEXT NOT NULL,
          summary TEXT,
          payload_json TEXT NOT NULL
        );

        CREATE TABLE earnings_quality_rows (
          board TEXT NOT NULL,
          rank INTEGER,
          symbol TEXT NOT NULL,
          company_name TEXT,
          score REAL,
          quality_score REAL,
          confluence_score REAL,
          user_angle TEXT,
          user_reason TEXT,
          user_risk TEXT,
          return_20d_pct REAL,
          close REAL,
          dollar_volume_20d REAL,
          latest_earnings_date TEXT,
          latest_guidance_date TEXT,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (board, symbol)
        );

        CREATE TABLE strength_rows (
          rank INTEGER,
          bucket TEXT,
          symbol TEXT PRIMARY KEY,
          company TEXT,
          exchange TEXT,
          sector TEXT,
          price REAL,
          score REAL,
          label TEXT,
          action TEXT,
          primary_factor TEXT,
          liquidity_label TEXT,
          market_cap_label TEXT,
          market_cap_value REAL,
          return_20d_pct REAL,
          relative_spy_pct REAL,
          crowding_score REAL,
          volume_ratio REAL,
          periods_json TEXT NOT NULL,
          relative_json TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );

        CREATE TABLE market_temperature_indicators (
          indicator_key TEXT PRIMARY KEY,
          as_of TEXT,
          name TEXT,
          category TEXT,
          impact TEXT,
          value_label TEXT,
          previous_label TEXT,
          change_label TEXT,
          status TEXT,
          level TEXT,
          payload_json TEXT NOT NULL
        );

        CREATE TABLE options_flow_rows (
          board TEXT NOT NULL,
          rank INTEGER NOT NULL,
          ticker TEXT NOT NULL,
          premium REAL,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (board, rank, ticker)
        );

        CREATE TABLE market_opinion_items (
          item_id TEXT PRIMARY KEY,
          section TEXT NOT NULL,
          section_label TEXT,
          title TEXT NOT NULL,
          trade_date TEXT,
          summary TEXT,
          symbols_json TEXT NOT NULL,
          topics_json TEXT NOT NULL,
          highlights_json TEXT NOT NULL,
          body TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );

        CREATE TABLE raw_payloads (
          name TEXT PRIMARY KEY,
          source_path TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );

        CREATE INDEX idx_symbols_sector ON symbols(sector);
        CREATE INDEX idx_market_board_symbol ON market_board_rows(symbol);
        CREATE INDEX idx_market_board_sector ON market_board_rows(board, sector);
        CREATE INDEX idx_stock_event_symbol ON stock_event_rows(symbol);
        CREATE INDEX idx_stock_event_type ON stock_event_rows(event_type);
        CREATE INDEX idx_calendar_events_date ON calendar_events(event_date);
        CREATE INDEX idx_earnings_quality_symbol ON earnings_quality_rows(symbol);
        CREATE INDEX idx_strength_sector ON strength_rows(sector);
        CREATE INDEX idx_strength_bucket_score ON strength_rows(bucket, score DESC);
        CREATE INDEX idx_market_opinion_section ON market_opinion_items(section, trade_date);
        """
    )


def record_dataset(conn: sqlite3.Connection, name: str, path: Path, payload: dict[str, Any], row_count: int) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO datasets
        (name, source_path, as_of, generated_at, row_count, content_sha256, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            name,
            str(path.relative_to(ROOT)) if path.exists() else str(path),
            text_value(payload.get("asOf") or payload.get("updatedAt")),
            text_value(payload.get("generatedAt")),
            row_count,
            payload_hash(path),
            json_text(payload),
        ),
    )
    conn.execute(
        "INSERT OR REPLACE INTO raw_payloads (name, source_path, payload_json) VALUES (?, ?, ?)",
        (name, str(path.relative_to(ROOT)) if path.exists() else str(path), json_text(payload)),
    )


def upsert_symbol(conn: sqlite3.Connection, row: dict[str, Any], source: str) -> None:
    symbol = symbol_value(row.get("symbol") or row.get("ticker"))
    if not symbol:
        return
    existing = conn.execute("SELECT * FROM symbols WHERE symbol = ?", (symbol,)).fetchone()
    sources: list[str] = []
    if existing:
        try:
            sources = json.loads(existing["sources_json"] or "[]")
        except json.JSONDecodeError:
            sources = []
    if source not in sources:
        sources.append(source)
    market_cap_label = text_value(row.get("marketCap") or row.get("market_cap"))
    sector = normalize_sector(row.get("sector") or row.get("sectorProxy"))
    latest_price = float_value(row.get("price") or row.get("close"))
    latest_dollar_volume = float_value(row.get("dollarVolume") or row.get("dollar_volume") or row.get("dollarVolume20d"))
    payload = dict(row)
    if existing:
        conn.execute(
            """
            UPDATE symbols
            SET company = COALESCE(?, company),
                chinese_name = COALESCE(?, chinese_name),
                sector = COALESCE(NULLIF(?, ''), sector),
                market_cap_label = COALESCE(?, market_cap_label),
                market_cap_value = COALESCE(?, market_cap_value),
                latest_price = COALESCE(?, latest_price),
                latest_dollar_volume = COALESCE(?, latest_dollar_volume),
                latest_volume_ratio = COALESCE(?, latest_volume_ratio),
                latest_source = ?,
                updated_at = ?,
                sources_json = ?,
                payload_json = ?
            WHERE symbol = ?
            """,
            (
                text_value(row.get("company") or row.get("companyName") or row.get("name")),
                text_value(row.get("chineseName")),
                sector,
                market_cap_label,
                float_value(market_cap_label),
                latest_price,
                latest_dollar_volume,
                ratio_value(row.get("volumeRatio")),
                source,
                now_iso(),
                json_text(sources),
                json_text(payload),
                symbol,
            ),
        )
        return
    conn.execute(
        """
        INSERT INTO symbols
        (symbol, company, chinese_name, sector, market_cap_label, market_cap_value,
         latest_price, latest_dollar_volume, latest_volume_ratio, latest_source,
         updated_at, sources_json, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            symbol,
            text_value(row.get("company") or row.get("companyName") or row.get("name")),
            text_value(row.get("chineseName")),
            sector,
            market_cap_label,
            float_value(market_cap_label),
            latest_price,
            latest_dollar_volume,
            ratio_value(row.get("volumeRatio")),
            source,
            now_iso(),
            json_text(sources),
            json_text(payload),
        ),
    )


def load_market_board_payloads() -> tuple[dict[str, Any], dict[str, Any], Path, Path]:
    data_root = Path(os.environ.get("MARKET_DATA_ROOT", "/Volumes/Extreme SSD/market-data-lab/data"))
    if data_root.exists():
        try:
            sys.path.insert(0, str(ROOT / "scripts"))
            from build_market_boards import build_payloads, latest_trade_date

            as_of = os.environ.get("TRACKING_ASOF") or latest_trade_date(data_root)
            ytd, movers = build_payloads(data_root, as_of, 5000, 3000.0, 5_000_000)
            return ytd, movers, Path("direct:market-boards/ytd"), Path("direct:market-boards/movers")
        except Exception as exc:
            print(f"WARN: market boards direct import skipped: {exc}")
    ytd, ytd_path = load_existing_dataset_payload("ytd-gainers")
    movers, movers_path = load_existing_dataset_payload("market-movers")
    return ytd, movers, ytd_path, movers_path


def import_market_boards(conn: sqlite3.Connection) -> int:
    count = 0
    ytd, movers, ytd_path, movers_path = load_market_board_payloads()
    record_dataset(conn, "ytd-gainers", ytd_path, ytd, len(ytd.get("rows") or []))
    for row in ytd.get("rows") or []:
        import_market_row(conn, "ytd", ytd.get("updatedAt"), row, "ytd-gainers")
        count += 1

    board_count = 0
    for board, board_payload in (movers.get("boards") or {}).items():
        rows = board_payload.get("rows") if isinstance(board_payload, dict) else []
        for row in rows or []:
            import_market_row(conn, str(board), movers.get("updatedAt"), row, "market-movers")
            board_count += 1
    record_dataset(conn, "market-movers", movers_path, movers, board_count)
    return count + board_count


def import_tracking_pool(conn: sqlite3.Connection) -> int:
    source_path = Path("direct:tracking-pool")
    payload: dict[str, Any] = {}
    try:
        sys.path.insert(0, str(ROOT / "scripts"))
        from build_tracking_pool import DEFAULT_DATA_ROOT, DEFAULT_SYMBOLS, build_rows, latest_trade_date, now_iso

        data_root = Path(os.environ.get("MARKET_DATA_ROOT", DEFAULT_DATA_ROOT))
        if data_root.exists():
            as_of = os.environ.get("TRACKING_ASOF") or latest_trade_date(data_root)
            rows, missing = build_rows(data_root, as_of, DEFAULT_SYMBOLS)
            payload = {
                "generatedAt": now_iso(),
                "asOf": as_of,
                "source": "local Polygon split-adjusted daily bars for the curated tracking pool",
                "symbols": DEFAULT_SYMBOLS,
                "rows": rows,
                "missing": missing,
            }
    except Exception as exc:
        print(f"WARN: tracking pool direct import skipped: {exc}")
    rows = payload.get("rows") or []
    missing = payload.get("missing") or []
    as_of = payload.get("asOf")
    count = 0
    for row in rows:
        base = {
            **row,
            "marketCap": row.get("marketCap") or "--",
            "dollarVolume": row.get("dollarVolume"),
            "volumeRatio": row.get("volumeRatio"),
        }
        upsert_symbol(conn, base, "tracking-pool")
        board_map = {
            "day": row.get("change1d"),
            "week": row.get("change5d"),
            "month": row.get("change20d"),
            "ytd": row.get("changeYtd"),
            "volume": row.get("change1d"),
        }
        for board, change in board_map.items():
            board_row = {
                **base,
                "rank": 9000 + int(row.get("rank") or 0),
                "change": change,
                "changeYtd": change,
                "actionNote": "跟踪池标的，按趋势、成交额和事件节奏复盘。",
            }
            if board != "day":
                board_row.pop("keyLevels", None)
                board_row.pop("priceHistory", None)
            import_market_row(conn, board, as_of, board_row, "tracking-pool")
            count += 1
    for row in missing:
        symbol = symbol_value(row.get("symbol"))
        if symbol:
            upsert_symbol(
                conn,
                {
                    "symbol": symbol,
                    "company": row.get("company") or symbol,
                    "chineseName": symbol,
                    "sector": "跟踪池",
                    "trackingStatus": "missing",
                },
                "tracking-pool",
            )
    record_dataset(conn, "tracking-pool", source_path, payload, len(rows))
    return count


def import_market_row(conn: sqlite3.Connection, board: str, trade_date: Any, row: dict[str, Any], source: str) -> None:
    symbol = symbol_value(row.get("symbol"))
    if not symbol:
        return
    upsert_symbol(conn, row, source)
    change = row.get("changeYtd") if board == "ytd" else row.get("change")
    conn.execute(
        """
        INSERT OR REPLACE INTO market_board_rows
        (board, rank, symbol, trade_date, company, chinese_name, sector, risk, action_note,
         price, change_pct, volume_label, dollar_volume, volume_ratio, market_cap_label,
         market_cap_value, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            board,
            row.get("rank"),
            symbol,
            text_value(trade_date),
            text_value(row.get("company")),
            text_value(row.get("chineseName")),
            normalize_sector(row.get("sector")),
            text_value(row.get("risk")),
            text_value(row.get("actionNote")),
            float_value(row.get("price")),
            percent_value(change),
            text_value(row.get("volume")),
            float_value(row.get("dollarVolume")),
            ratio_value(row.get("volumeRatio")),
            text_value(row.get("marketCap")),
            float_value(row.get("marketCap")),
            json_text(row),
        ),
    )


def load_sector_flow_payload() -> tuple[dict[str, Any], Path]:
    data_root = Path(os.environ.get("MARKET_DATA_ROOT", "/Volumes/Extreme SSD/market-data-lab/data"))
    if data_root.exists():
        try:
            sys.path.insert(0, str(ROOT / "scripts"))
            from build_sector_flow import build_sector_flow

            return build_sector_flow(data_root, 24), Path("direct:sector-flow")
        except Exception as exc:
            print(f"WARN: sector flow direct import skipped: {exc}")
    return load_existing_dataset_payload("sector-flow")


def import_sector_flow(conn: sqlite3.Connection) -> int:
    payload, path = load_sector_flow_payload()
    rows = payload.get("rows") or []
    record_dataset(conn, "sector-flow", path, payload, len(rows))
    for row in rows:
        conn.execute(
            """
            INSERT OR REPLACE INTO sector_flow_rows
            (as_of, rank, sector, status, stock_count, up_count, down_count, breadth_pct,
             avg_change_pct, active_value, net_flow_proxy, inflow_proxy, outflow_proxy,
             leaders_json, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.get("asOf"),
                row.get("rank"),
                normalize_sector(row.get("sector")) or text_value(row.get("sector")) or "",
                text_value(row.get("status")),
                row.get("count"),
                row.get("upCount"),
                row.get("downCount"),
                percent_value(row.get("breadthPct")),
                percent_value(row.get("avgChange")),
                float_value(row.get("activeValue")),
                float_value(row.get("netFlowProxy")),
                float_value(row.get("inflowProxy")),
                float_value(row.get("outflowProxy")),
                json_text(row.get("leaders") or []),
                json_text(row),
            ),
        )
    return len(rows)


def import_stock_events(conn: sqlite3.Connection) -> int:
    payload, path = load_product_data_payload("event-opportunities")
    count = 0
    for board, board_payload in (payload.get("boards") or {}).items():
        rows = board_payload.get("rows") if isinstance(board_payload, dict) else []
        for row in rows or []:
            symbol = symbol_value(row.get("ticker") or row.get("symbol"))
            if not symbol:
                continue
            upsert_symbol(conn, {"symbol": symbol, **row}, "event-opportunities")
            conn.execute(
                """
                INSERT OR REPLACE INTO stock_event_rows
                (board, rank, symbol, company_name, event_date, event_type, event_label,
                 reason, risk, close, signal_score, return_20d_pct, fwd_5d_pct,
                 fwd_20d_pct, fwd_60d_pct, liquidity_label, price_target_upside_pct,
                 short_interest, days_to_cover, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(board),
                    row.get("rank"),
                    symbol,
                    text_value(row.get("companyName") or row.get("name")),
                    text_value(row.get("eventDate")),
                    text_value(row.get("eventType")),
                    text_value(row.get("eventLabel")),
                    text_value(row.get("reason")),
                    text_value(row.get("risk")),
                    float_value(row.get("close")),
                    float_value(row.get("signalScore")),
                    percent_value(row.get("return20dPct")),
                    percent_value(row.get("fwd5dPct")),
                    percent_value(row.get("fwd20dPct")),
                    percent_value(row.get("fwd60dPct")),
                    text_value(row.get("liquidity")),
                    percent_value(row.get("priceTargetUpsidePct")),
                    float_value(row.get("shortInterest")),
                    float_value(row.get("daysToCover")),
                    json_text(row),
                ),
            )
            count += 1
    record_dataset(conn, "event-opportunities", path, payload, count)
    return count


def import_calendar(conn: sqlite3.Connection) -> int:
    payload, path = load_product_data_payload("events-calendar")
    events = payload.get("events") or []
    for row in events:
        basis = json_text([row.get("date"), row.get("time"), row.get("title"), row.get("sourceName")])
        event_id = hashlib.sha1(basis.encode("utf-8")).hexdigest()
        conn.execute(
            """
            INSERT OR REPLACE INTO calendar_events
            (event_id, event_date, event_time, title, event_type, impact, source_name,
             actual_value, actual_label, forecast_value, forecast_label, previous_value,
             previous_label, result_updated_at, related_modules_json, related_assets_json,
             summary, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                text_value(row.get("date")),
                text_value(row.get("time")),
                text_value(row.get("title")) or "",
                text_value(row.get("type")),
                text_value(row.get("impact")),
                text_value(row.get("sourceName")),
                float_value(row.get("actualValue")),
                text_value(row.get("actualLabel")),
                float_value(row.get("forecastValue")),
                text_value(row.get("forecastLabel")),
                float_value(row.get("previousValue")),
                text_value(row.get("previousLabel")),
                normalize_datetime_text(row.get("resultUpdatedAt")),
                json_text(row.get("relatedModules") or []),
                json_text(row.get("relatedAssets") or []),
                text_value(row.get("summary")),
                json_text(row),
            ),
        )
    record_dataset(conn, "events-calendar", path, payload, len(events))
    return len(events)


def import_earnings_quality(conn: sqlite3.Connection) -> int:
    payload, path = load_earnings_quality_payload()
    count = 0
    for board, board_payload in (payload.get("boards") or {}).items():
        rows = board_payload.get("rows") if isinstance(board_payload, dict) else []
        for row in rows or []:
            symbol = symbol_value(row.get("ticker") or row.get("symbol"))
            if not symbol:
                continue
            upsert_symbol(conn, {"symbol": symbol, **row}, "earnings-quality")
            conn.execute(
                """
                INSERT OR REPLACE INTO earnings_quality_rows
                (board, rank, symbol, company_name, score, quality_score, confluence_score,
                 user_angle, user_reason, user_risk, return_20d_pct, close,
                 dollar_volume_20d, latest_earnings_date, latest_guidance_date, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(board),
                    row.get("rank"),
                    symbol,
                    text_value(row.get("companyName") or row.get("name")),
                    float_value(row.get("score")),
                    float_value(row.get("qualityScore")),
                    float_value(row.get("confluenceScore")),
                    text_value(row.get("userAngle")),
                    text_value(row.get("userReason")),
                    text_value(row.get("userRisk")),
                    percent_value(row.get("return20dPct")),
                    float_value(row.get("close")),
                    float_value(row.get("dollarVolume20d")),
                    text_value(row.get("latestEarningsDate")),
                    text_value(row.get("latestGuidanceDate")),
                    json_text(row),
                ),
            )
            count += 1
    record_dataset(conn, "earnings-quality", path, payload, count)
    return count


def import_strength(conn: sqlite3.Connection) -> int:
    data_root = Path(os.environ.get("MARKET_DATA_ROOT", "/Volumes/Extreme SSD/market-data-lab/data"))
    path = Path("db:strength-scanner:missing")
    payload: dict[str, Any] = {}
    if data_root.exists():
        try:
            sys.path.insert(0, str(ROOT / "scripts"))
            from build_strength_scanner import build_scanner

            payload = build_scanner(data_root, 5_000_000, 40, include_all_rows=True)
            path = Path("direct:strength-scanner")
        except Exception as exc:
            print(f"WARN: strength scanner direct import skipped: {exc}")
    if not payload:
        payload, path = load_existing_dataset_payload("strength-scanner")
    rows = payload.pop("_allRows", None) or payload.get("rows") or []
    known_symbols = {
        row["symbol"]
        for row in conn.execute("SELECT symbol FROM symbols").fetchall()
    }
    for row in rows:
        symbol = symbol_value(row.get("symbol"))
        if not symbol:
            continue
        if symbol not in known_symbols:
            upsert_symbol(conn, row, "strength-scanner")
            known_symbols.add(symbol)
        conn.execute(
            """
            INSERT OR REPLACE INTO strength_rows
            (rank, bucket, symbol, company, exchange, sector, price, score, label,
             action, primary_factor, liquidity_label, market_cap_label, market_cap_value,
             return_20d_pct, relative_spy_pct, crowding_score, volume_ratio,
             periods_json, relative_json, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row.get("rank"),
                text_value(row.get("bucket")),
                symbol,
                text_value(row.get("name")),
                text_value(row.get("exchange")),
                normalize_sector(row.get("sectorProxy")),
                float_value(row.get("price")),
                float_value(row.get("score")),
                text_value(row.get("label")),
                text_value(row.get("action")),
                text_value(row.get("primaryFactor")),
                text_value(row.get("liquidity")),
                text_value(row.get("marketCap")),
                float_value(row.get("marketCap")),
                percent_value((row.get("periods") or {}).get("20d")),
                percent_value((row.get("relative") or {}).get("spy")),
                float_value((row.get("crowding") or {}).get("score")),
                ratio_value((row.get("crowding") or {}).get("volumeRatio")),
                json_text(row.get("periods") or {}),
                json_text(row.get("relative") or {}),
                json_text(row),
            ),
        )
    record_dataset(conn, "strength-scanner", path, payload, len(rows))
    return len(rows)


def import_market_temperature(conn: sqlite3.Connection) -> int:
    payload, path = load_product_data_payload("market-temperature")
    rows = payload.get("indicators") or []
    for row in rows:
        key = text_value(row.get("key") or row.get("name"))
        if not key:
            continue
        conn.execute(
            """
            INSERT OR REPLACE INTO market_temperature_indicators
            (indicator_key, as_of, name, category, impact, value_label, previous_label,
             change_label, status, level, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                key,
                text_value(row.get("asOf") or payload.get("asOf")),
                text_value(row.get("name")),
                text_value(row.get("category")),
                text_value(row.get("impact")),
                text_value(row.get("value")),
                text_value(row.get("previous")),
                text_value(row.get("change")),
                text_value(row.get("status")),
                text_value(row.get("level")),
                json_text(row),
            ),
        )
    record_dataset(conn, "market-temperature", path, payload, len(rows))
    return len(rows)


def import_options_flow(conn: sqlite3.Connection) -> int:
    payload, path = load_options_flow_payload()
    count = 0
    for board, rows in (payload.get("boards") or {}).items():
        if not isinstance(rows, list):
            continue
        for rank, row in enumerate(rows, start=1):
            ticker = symbol_value(row.get("ticker") or row.get("symbol"))
            if not ticker:
                continue
            conn.execute(
                """
                INSERT OR REPLACE INTO options_flow_rows
                (board, rank, ticker, premium, payload_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (str(board), rank, ticker, float_value(row.get("premium")), json_text(row)),
            )
            count += 1
    record_dataset(conn, "options-flow-snapshot", path, payload, count)
    return count


def import_market_opinion(conn: sqlite3.Connection, existing_db: Path | None = None) -> int:
    path = Path("direct:market-opinion-db")
    rows: list[dict[str, Any]] = []
    source_db = existing_db if existing_db and existing_db.exists() and existing_db.stat().st_size > 0 else existing_product_db()
    if source_db and source_db.exists() and source_db.stat().st_size > 0:
        try:
            with sqlite3.connect(f"file:{source_db}?mode=ro", uri=True) as source:
                source.row_factory = sqlite3.Row
                rows = [
                    parse_json_text(row["payload_json"], {})
                    for row in source.execute(
                        """
                        SELECT payload_json
                        FROM market_opinion_items
                        ORDER BY COALESCE(trade_date, '') DESC, item_id DESC
                        """
                    )
                ]
        except sqlite3.Error as exc:
            print(f"WARN: market opinion DB import skipped: {exc}")
    payload = {"generatedAt": now_iso(), "items": rows}
    count = 0
    for row in rows:
        item_id = text_value(row.get("id"))
        section = text_value(row.get("section"))
        title = text_value(row.get("title"))
        if not item_id or not section or not title:
            continue
        trade_date = normalize_datetime_text(row.get("tradeDate"))
        normalized_row = {**row, "tradeDate": trade_date, "featured": bool(row.get("featured"))}
        conn.execute(
            """
            INSERT OR REPLACE INTO market_opinion_items
            (item_id, section, section_label, title, trade_date, summary,
             symbols_json, topics_json, highlights_json, body, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item_id,
                section,
                text_value(row.get("sectionLabel")),
                title,
                trade_date,
                text_value(row.get("summary")),
                json_text(row.get("symbols") or []),
                json_text(row.get("topics") or []),
                json_text(row.get("highlights") or []),
                text_value(row.get("body")) or "",
                json_text(normalized_row),
            ),
        )
        count += 1
    record_dataset(conn, "market-opinion-content", path, payload, count)
    return count


def import_sector_overrides(conn: sqlite3.Connection) -> int:
    from sector_overrides import load_sector_overrides

    overrides = load_sector_overrides()
    now = now_iso()
    for symbol, sector in overrides.items():
        conn.execute(
            "INSERT OR REPLACE INTO sector_overrides (symbol, sector, updated_at) VALUES (?, ?, ?)",
            (symbol_value(symbol), normalize_sector(sector) or sector, now),
        )
    return len(overrides)


def import_raw_only(conn: sqlite3.Connection, names: Iterable[str]) -> None:
    for name in names:
        payload, path = load_raw_payload(name)
        record_dataset(conn, name, path, payload, 0)


def build_database(output: Path) -> dict[str, int]:
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix=f".{output.name}.", suffix=".tmp", dir=output.parent, delete=False) as handle:
        temp_path = Path(handle.name)
    try:
        if temp_path.exists():
            temp_path.unlink()
        conn = sqlite3.connect(temp_path)
        conn.row_factory = sqlite3.Row
        try:
            create_schema(conn)
            import_counts = {
                "sector_overrides": import_sector_overrides(conn),
                "market_board_rows": import_market_boards(conn),
                "tracking_pool_rows": import_tracking_pool(conn),
                "sector_flow_rows": import_sector_flow(conn),
                "stock_event_rows": import_stock_events(conn),
                "calendar_events": import_calendar(conn),
                "earnings_quality_rows": import_earnings_quality(conn),
                "strength_rows": import_strength(conn),
                "market_temperature_indicators": import_market_temperature(conn),
                "options_flow_rows": import_options_flow(conn),
                "market_opinion_items": import_market_opinion(conn, output if output.exists() else None),
            }
            import_raw_only(conn, ["site-data-index", "validation-center", "core-signals", "macro-series", "index-valuation", "strength-review", "crypto-etf-flows", "bottom-strategy"])
            conn.execute("INSERT OR REPLACE INTO product_db_info (key, value) VALUES ('schema_version', ?)", (str(SCHEMA_VERSION),))
            conn.execute("INSERT OR REPLACE INTO product_db_info (key, value) VALUES ('generated_at', ?)", (now_iso(),))
            conn.execute("INSERT OR REPLACE INTO product_db_info (key, value) VALUES ('source_data_dir', ?)", (str(DATA_DIR),))
            table_counts = {
                name: table_count(conn, name)
                for name in [
                    "symbols",
                    "sector_overrides",
                    "market_board_rows",
                    "sector_flow_rows",
                    "stock_event_rows",
                    "calendar_events",
                    "earnings_quality_rows",
                    "strength_rows",
                    "market_temperature_indicators",
                    "options_flow_rows",
                    "market_opinion_items",
                ]
            }
            conn.execute("INSERT OR REPLACE INTO product_db_info (key, value) VALUES ('table_counts', ?)", (json_text(table_counts),))
            conn.execute("INSERT OR REPLACE INTO product_db_info (key, value) VALUES ('import_counts', ?)", (json_text(import_counts),))
            conn.commit()
            conn.execute("PRAGMA optimize")
        finally:
            conn.close()
        os.replace(temp_path, output)
        with sqlite3.connect(output) as verify:
            verify_counts = {name: table_count(verify, name) for name in [
                "symbols",
                "sector_overrides",
                "market_board_rows",
                "sector_flow_rows",
                "stock_event_rows",
                "calendar_events",
                "earnings_quality_rows",
                "strength_rows",
                "market_temperature_indicators",
                "options_flow_rows",
                "market_opinion_items",
            ]}
        return verify_counts
    finally:
        if temp_path.exists():
            temp_path.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the Dongbimao product SQLite database.")
    parser.add_argument("--output", type=Path, default=Path(os.environ.get("PRODUCT_DB", DEFAULT_OUTPUT)))
    args = parser.parse_args()
    counts = build_database(args.output)
    print(f"Product DB built: {args.output}")
    for table, count in counts.items():
        print(f"  {table}: {count}")


if __name__ == "__main__":
    main()

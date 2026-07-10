#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-root@43.165.133.237}"
PY="${PYTHON_BIN:-/opt/anaconda3/envs/quant/bin/python}"
BUILD_DB="${BUILD_DB:-.local/product-prod.db}"
REMOTE_DB="/tmp/dongbimao-product-new.db"

cd "$(dirname "$0")/.."
mkdir -p "$(dirname "${BUILD_DB}")"

if [ "${ALLOW_OPEN_PORTFOLIO_DATA_DEPLOY:-0}" != "1" ]; then
  echo "ERROR: prod product DB deployment requires explicit approval for Open holding data" >&2
  exit 1
fi

if [ "${SKIP_PRODUCT_DB_BUILD:-0}" != "1" ]; then
  "${PY}" scripts/build_product_db.py --output "${BUILD_DB}"
  "${PY}" scripts/update_macro_calendar_results.py --db "${BUILD_DB}"
else
  test -f "${BUILD_DB}"
fi

rsync --partial "${BUILD_DB}" "${SERVER}:${REMOTE_DB}"

ssh "${SERVER}" 'set -e
prod="/opt/dongbimao-prod/data/product.db"
next="/tmp/dongbimao-product-new.db"
backup="/opt/dongbimao-prod/data/product.db.bak.$(date +%Y%m%d%H%M%S)"
test -f "$next"
mkdir -p /opt/dongbimao-prod/data
if [ -f "$prod" ]; then
  cp "$prod" "$backup"
  python3 - <<'"'"'PY'"'"'
import sqlite3

next_db = "/tmp/dongbimao-product-new.db"
old_db = "/opt/dongbimao-prod/data/product.db"
with sqlite3.connect(next_db) as conn:
    conn.execute("ATTACH DATABASE ? AS old", (old_db,))
    try:
        conn.execute("DELETE FROM main.market_opinion_items")
        conn.execute("""
            INSERT INTO main.market_opinion_items
            (item_id, section, section_label, title, trade_date, summary,
             symbols_json, topics_json, highlights_json, body, payload_json)
            SELECT item_id, section, section_label, title, trade_date, summary,
                   symbols_json, topics_json, highlights_json, body, payload_json
            FROM old.market_opinion_items
        """)
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS main.open_portfolio_trades (
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
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS main.open_portfolio_symbol_rules (
              symbol TEXT PRIMARY KEY,
              asset_type TEXT NOT NULL,
              quantity_step TEXT NOT NULL,
              min_quantity TEXT,
              source TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
        """)
        conn.execute("DELETE FROM main.open_portfolio_trades")
        conn.execute("DELETE FROM main.open_portfolio_symbol_rules")
        open_trade_count = conn.execute("SELECT COUNT(*) FROM old.open_portfolio_trades").fetchone()[0]
        open_rule_count = conn.execute("SELECT COUNT(*) FROM old.open_portfolio_symbol_rules").fetchone()[0]
        conn.execute("""
            INSERT INTO main.open_portfolio_trades
            (id, trade_time, symbol, side, price, position_pct, trade_amount, trade_quantity, note, created_at)
            SELECT id, trade_time, symbol, side, price, position_pct, trade_amount, trade_quantity, note, created_at
            FROM old.open_portfolio_trades
        """)
        conn.execute("""
            INSERT INTO main.open_portfolio_symbol_rules
            (symbol, asset_type, quantity_step, min_quantity, source, updated_at)
            SELECT symbol, asset_type, quantity_step, min_quantity, source, updated_at
            FROM old.open_portfolio_symbol_rules
        """)
        copied_trade_count = conn.execute("SELECT COUNT(*) FROM main.open_portfolio_trades").fetchone()[0]
        copied_rule_count = conn.execute("SELECT COUNT(*) FROM main.open_portfolio_symbol_rules").fetchone()[0]
        if copied_trade_count != open_trade_count or copied_rule_count != open_rule_count:
            raise RuntimeError("open portfolio preservation count mismatch")
    except sqlite3.OperationalError as exc:
        raise RuntimeError("open portfolio preservation failed") from exc
    conn.commit()
    conn.execute("DETACH DATABASE old")
PY
fi
mv "$next" "$prod"
systemctl restart ytd-gainers-auth
systemctl is-active ytd-gainers-auth >/dev/null
'

echo "Prod data deployed without using dev DB."

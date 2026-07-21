#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-root@43.165.133.237}"
PY="${PYTHON_BIN:-/opt/anaconda3/envs/quant/bin/python}"
BUILD_DB="${BUILD_DB:-.local/product-dev.db}"
REMOTE_DB="/tmp/dongbimao-dev-product-new.db"

cd "$(dirname "$0")/.."
mkdir -p "$(dirname "${BUILD_DB}")"

if [ "${SKIP_PRODUCT_DB_BUILD:-0}" != "1" ]; then
  "${PY}" scripts/build_product_db.py --output "${BUILD_DB}"
  "${PY}" scripts/update_macro_calendar_results.py --db "${BUILD_DB}"
else
  test -f "${BUILD_DB}"
fi

"${PY}" - "${BUILD_DB}" <<'PY'
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as conn:
    result = conn.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        raise SystemExit(f"Incoming product DB integrity check failed: {result}")
PY

rsync --partial "${BUILD_DB}" "${SERVER}:${REMOTE_DB}"

ssh "${SERVER}" 'set -e
dev="/opt/dongbimao-dev/data/product.db"
next="/tmp/dongbimao-dev-product-new.db"
backup="/opt/dongbimao-dev/data/product.db.bak.$(date +%Y%m%d%H%M%S)"
test -f "$next"
mkdir -p /opt/dongbimao-dev/data
if [ -f "$dev" ]; then
  cp "$dev" "$backup"
  python3 - <<'"'"'PY'"'"'
import sqlite3

next_db = "/tmp/dongbimao-dev-product-new.db"
old_db = "/opt/dongbimao-dev/data/product.db"


def table_exists(conn, schema, name):
    return conn.execute(
        f"SELECT 1 FROM {schema}.sqlite_master WHERE type = 'table' AND name = ?",
        (name,),
    ).fetchone() is not None


with sqlite3.connect(next_db) as conn:
    conn.execute("ATTACH DATABASE ? AS old", (old_db,))

    if table_exists(conn, "old", "market_opinion_items"):
        if not table_exists(conn, "main", "market_opinion_items"):
            raise RuntimeError("incoming DB is missing market_opinion_items")
        expected = conn.execute("SELECT COUNT(*) FROM old.market_opinion_items").fetchone()[0]
        conn.execute("DELETE FROM main.market_opinion_items")
        conn.execute("""
            INSERT INTO main.market_opinion_items
            (item_id, section, section_label, title, trade_date, summary,
             symbols_json, topics_json, highlights_json, body, payload_json)
            SELECT item_id, section, section_label, title, trade_date, summary,
                   symbols_json, topics_json, highlights_json, body, payload_json
            FROM old.market_opinion_items
        """)
        copied = conn.execute("SELECT COUNT(*) FROM main.market_opinion_items").fetchone()[0]
        if copied != expected:
            raise RuntimeError("market opinion preservation count mismatch")

    open_tables = ["open_portfolio_trades", "open_portfolio_symbol_rules"]
    existing_open_tables = [name for name in open_tables if table_exists(conn, "old", name)]
    if existing_open_tables and len(existing_open_tables) != len(open_tables):
        raise RuntimeError("dev open portfolio tables are incomplete")
    if existing_open_tables:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS main.open_portfolio_trades (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              trade_time TEXT NOT NULL,
              symbol TEXT NOT NULL,
              side TEXT NOT NULL CHECK (side IN ("buy", "sell")),
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
        expected_trades = conn.execute("SELECT COUNT(*) FROM old.open_portfolio_trades").fetchone()[0]
        expected_rules = conn.execute("SELECT COUNT(*) FROM old.open_portfolio_symbol_rules").fetchone()[0]
        conn.execute("DELETE FROM main.open_portfolio_trades")
        conn.execute("DELETE FROM main.open_portfolio_symbol_rules")
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
        copied_trades = conn.execute("SELECT COUNT(*) FROM main.open_portfolio_trades").fetchone()[0]
        copied_rules = conn.execute("SELECT COUNT(*) FROM main.open_portfolio_symbol_rules").fetchone()[0]
        if copied_trades != expected_trades or copied_rules != expected_rules:
            raise RuntimeError("open portfolio preservation count mismatch")

    result = conn.execute("PRAGMA main.integrity_check").fetchone()[0]
    if result != "ok":
        raise RuntimeError(f"merged dev product DB integrity check failed: {result}")
    conn.commit()
    conn.execute("DETACH DATABASE old")
PY
fi
mv "$next" "$dev"
systemctl restart ytd-gainers-auth-dev
systemctl is-active ytd-gainers-auth-dev >/dev/null
python3 - <<'"'"'PY'"'"'
import sqlite3

with sqlite3.connect("/opt/dongbimao-dev/data/product.db") as conn:
    for name in ("market_opinion_items", "open_portfolio_trades", "open_portfolio_symbol_rules"):
        try:
            count = conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
        except sqlite3.OperationalError:
            count = 0
        print(f"{name}={count}")
    for name in ("macro-series", "market-temperature", "strength-scanner"):
        row = conn.execute("SELECT as_of FROM datasets WHERE name = ?", (name,)).fetchone()
        print(f"{name}={row[0] if row else '--'}")
PY
'

echo "Dev data deployed with runtime tables preserved."

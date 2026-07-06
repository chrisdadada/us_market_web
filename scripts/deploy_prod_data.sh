#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-root@43.165.133.237}"
PY="${PYTHON_BIN:-/opt/anaconda3/envs/quant/bin/python}"
BUILD_DB="${BUILD_DB:-.local/product-prod.db}"
REMOTE_DB="/tmp/dongbimao-product-new.db"

cd "$(dirname "$0")/.."
mkdir -p "$(dirname "${BUILD_DB}")"

"${PY}" scripts/build_product_db.py --output "${BUILD_DB}"
"${PY}" scripts/update_macro_calendar_results.py --db "${BUILD_DB}"

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
    conn.commit()
    conn.execute("DETACH DATABASE old")
PY
fi
mv "$next" "$prod"
systemctl restart ytd-gainers-auth
systemctl is-active ytd-gainers-auth >/dev/null
'

echo "Prod data deployed without using dev DB."

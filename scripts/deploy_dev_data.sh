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
"${PY}" scripts/check_product_coverage.py --db "${BUILD_DB}" >/dev/null

rsync --partial "${BUILD_DB}" "${SERVER}:${REMOTE_DB}"

ssh "${SERVER}" 'set -e
dev="/opt/dongbimao-dev/data/product.db"
next="/tmp/dongbimao-dev-product-new.db"
backup="/opt/dongbimao-dev/data/product.db.bak.$(date +%Y%m%d%H%M%S)"
test -f "$next"
mkdir -p /opt/dongbimao-dev/data
if [ -f "$dev" ]; then
  cp "$dev" "$backup"
  python3 /opt/dongbimao-dev/scripts/preserve_product_runtime_tables.py merge --incoming "$next" --existing "$dev"
fi
mv "$next" "$dev"
if [ -f "$backup" ]; then
  python3 /opt/dongbimao-dev/scripts/preserve_product_runtime_tables.py verify --before "$backup" --after "$dev"
fi
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
        value = row[0] if row else "--"
        print(f"{name}={value}")
PY
'

echo "Dev data deployed with runtime tables preserved."

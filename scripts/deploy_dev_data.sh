#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-root@43.165.133.237}"
PY="${PYTHON_BIN:-/opt/anaconda3/envs/quant/bin/python}"
BUILD_DB="${BUILD_DB:-.local/product-dev.db}"

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

db_sha="$("${PY}" - "${BUILD_DB}" <<'PY'
import hashlib
import sys

digest = hashlib.sha256()
with open(sys.argv[1], "rb") as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b""):
        digest.update(chunk)
print(digest.hexdigest())
PY
)"
REMOTE_DB="/tmp/dongbimao-dev-product-${db_sha}.db"
rsync --partial --compress "${BUILD_DB}" "${SERVER}:${REMOTE_DB}"

ssh "${SERVER}" bash -s -- "${REMOTE_DB}" <<'REMOTE'
set -euo pipefail

next="$1"
exec 9>/var/lock/dongbimao-dev-deploy.lock
if ! flock -n 9; then
  echo "Another dev deployment is running." >&2
  exit 1
fi
dev="/opt/dongbimao-dev/data/product.db"
backup="/opt/dongbimao-dev/data/product.db.bak.$(date +%Y%m%d%H%M%S)"
trap 'rm -f "${next}"' EXIT
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
REMOTE

echo "Dev data deployed with runtime tables preserved."

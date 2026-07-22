#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-root@43.165.133.237}"
PY="${PYTHON_BIN:-/opt/anaconda3/envs/quant/bin/python}"
BUILD_DB="${BUILD_DB:-.local/product-prod.db}"
REMOTE_DB="/tmp/dongbimao-product-new.db"
REMOTE_PRESERVER="/tmp/dongbimao-preserve-product-runtime.py"

cd "$(dirname "$0")/.."
mkdir -p "$(dirname "${BUILD_DB}")"

if [ "${ALLOW_OPEN_PORTFOLIO_DATA_DEPLOY:-0}" != "1" ] \
  && [ "${ALLOW_VALIDATED_AUTOMATION_PROD_DATA_DEPLOY:-0}" != "1" ]; then
  echo "ERROR: prod product DB deployment requires explicit approval for Open holding data" >&2
  exit 1
fi

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
rsync --partial scripts/preserve_product_runtime_tables.py "${SERVER}:${REMOTE_PRESERVER}"

ssh "${SERVER}" 'set -e
prod="/opt/dongbimao-prod/data/product.db"
next="/tmp/dongbimao-product-new.db"
preserver="/tmp/dongbimao-preserve-product-runtime.py"
backup="/opt/dongbimao-prod/data/product.db.bak.$(date +%Y%m%d%H%M%S)"
test -f "$next"
test -f "$preserver"
mkdir -p /opt/dongbimao-prod/data
if [ -f "$prod" ]; then
  cp "$prod" "$backup"
  python3 "$preserver" merge --incoming "$next" --existing "$prod"
fi
mv "$next" "$prod"
restore_prod() {
  if [ -f "$backup" ]; then
    cp "$backup" "$prod"
    systemctl restart ytd-gainers-auth || true
  fi
}
if [ -f "$backup" ] && ! python3 "$preserver" verify --before "$backup" --after "$prod"; then
  restore_prod
  echo "ERROR: protected production data changed; restored previous product DB" >&2
  exit 1
fi
if ! systemctl restart ytd-gainers-auth || ! systemctl is-active ytd-gainers-auth >/dev/null; then
  restore_prod
  echo "ERROR: production service failed after data deploy; restored previous product DB" >&2
  exit 1
fi
'

echo "Prod data deployed without using dev DB."

#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/Users/linlifu/Documents/New project"
LAB="${ROOT}/market-data-lab"
PY="${PYTHON_BIN:-/opt/anaconda3/envs/quant/bin/python}"
DATA_ROOT="${DATA_ROOT:-/Volumes/Extreme SSD/market-data-lab/data}"
LOG_DIR="${ROOT}/logs/automation"
LOCK_DIR="${ROOT}/.automated_refresh.lock"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-${HOME}/.dongbimao/refresh.env}"

mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/options-refresh-$(date +%Y%m%d-%H%M%S).log"
exec >>"${LOG_FILE}" 2>&1

if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  echo "Another refresh is already running: ${LOCK_DIR}"
  exit 0
fi
cleanup() {
  rmdir "${LOCK_DIR}" 2>/dev/null || true
}
trap cleanup EXIT

if [[ -f "${LOCAL_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${LOCAL_ENV_FILE}"
  set +a
fi

if [[ ! -d "${DATA_ROOT}" ]]; then
  echo "External data root is not mounted: ${DATA_ROOT}"
  exit 2
fi

if [[ ! -x "${PY}" ]]; then
  echo "Python not found or not executable: ${PY}"
  exit 2
fi

OPTIONS_PHASE="${OPTIONS_PHASE:-core_etf}"
OPTIONS_MAX_DAYS="${OPTIONS_MAX_DAYS:-1}"
OPTIONS_MIN_ROWS_DONE="${OPTIONS_MIN_ROWS_DONE:-18}"
OPTIONS_DEPLOY_AFTER_REFRESH="${OPTIONS_DEPLOY_AFTER_REFRESH:-1}"
OPTIONS_PROMOTE_PROD_AFTER_DEPLOY="${OPTIONS_PROMOTE_PROD_AFTER_DEPLOY:-0}"
if [[ "${OPTIONS_PROMOTE_PROD_AFTER_DEPLOY}" == "1" ]]; then
  echo "Production code promotion is manual only. Use prepare_prod_release.sh and promote_prod.sh."
  exit 2
fi

OPTIONS_END_DATE="${OPTIONS_END_DATE:-$("${PY}" - <<'PY'
import sqlite3
import os
from pathlib import Path

path = Path(os.environ.get("PRODUCT_DB") or os.environ.get("APP_PRODUCT_DB") or "data/product.db")
if not path.exists():
    print("")
else:
    conn = sqlite3.connect(path)
    row = conn.execute(
        "SELECT COALESCE(as_of, generated_at, '') FROM datasets WHERE name = ?",
        ("site-data-index",),
    ).fetchone()
    conn.close()
    print(row[0] if row else "")
PY
)}"
OPTIONS_START_DATE="${OPTIONS_START_DATE:-$("${PY}" - "${OPTIONS_END_DATE}" <<'PY'
from datetime import date, datetime, timedelta
import sys

end = datetime.fromisoformat(sys.argv[1]).date() if sys.argv[1] else date.today()
print((end - timedelta(days=30)).isoformat())
PY
)}"

echo "=== options refresh started $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "ROOT=${ROOT}"
echo "LAB=${LAB}"
echo "DATA_ROOT=${DATA_ROOT}"
echo "OPTIONS_PHASE=${OPTIONS_PHASE}"
echo "OPTIONS_START_DATE=${OPTIONS_START_DATE}"
echo "OPTIONS_END_DATE=${OPTIONS_END_DATE}"
echo "OPTIONS_MAX_DAYS=${OPTIONS_MAX_DAYS}"
echo "OPTIONS_MIN_ROWS_DONE=${OPTIONS_MIN_ROWS_DONE}"
echo "OPTIONS_DEPLOY_AFTER_REFRESH=${OPTIONS_DEPLOY_AFTER_REFRESH}"
echo "OPTIONS_PROMOTE_PROD_AFTER_DEPLOY=${OPTIONS_PROMOTE_PROD_AFTER_DEPLOY}"
echo "LOG_FILE=${LOG_FILE}"

run_lab() {
  local label="$1"
  shift
  echo
  echo "--- ${label} ---"
  (cd "${LAB}" && "$@")
}

run_root() {
  local label="$1"
  shift
  echo
  echo "--- ${label} ---"
  (cd "${ROOT}" && "$@")
}

run_lab "refresh options flow daily aggregates" \
  "${PY}" scripts/run_options_backfill_plan.py \
  --phase "${OPTIONS_PHASE}" \
  --start "${OPTIONS_START_DATE}" \
  --end "${OPTIONS_END_DATE}" \
  --max-days "${OPTIONS_MAX_DAYS}" \
  --min-rows-done "${OPTIONS_MIN_ROWS_DONE}" \
  --save-every 5 \
  --rate-limit-sleep 70 \
  --max-retries 8

run_root "build product database" \
  env TRACKING_ASOF="${OPTIONS_END_DATE}" OPTIONS_START_DATE="${OPTIONS_START_DATE}" OPTIONS_END_DATE="${OPTIONS_END_DATE}" MARKET_DATA_ROOT="${DATA_ROOT}" PYTHON_BIN="${PY}" \
  bash scripts/update_product_data.sh

run_root "release gate" \
  "${PY}" -m unittest tests.test_release_gate -v

if [[ "${OPTIONS_DEPLOY_AFTER_REFRESH}" == "1" ]]; then
  run_root "deploy product DB to dev" \
    env SKIP_PRODUCT_DB_BUILD=1 BUILD_DB="${ROOT}/data/product.db" bash scripts/deploy_dev_data.sh

fi

echo
echo "=== options refresh finished $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "Log: ${LOG_FILE}"

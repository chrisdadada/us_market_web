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

OPTIONS_END_DATE="${OPTIONS_END_DATE:-$("${PY}" - <<'PY'
import json
from pathlib import Path

path = Path("/Users/linlifu/Documents/New project/data/site-data-index.json")
payload = json.loads(path.read_text())
print(payload.get("asOf") or payload.get("updatedAt") or "")
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

run_lab "build options flow product JSON" \
  "${PY}" scripts/build_options_flow_product.py \
  --start "${OPTIONS_START_DATE}" \
  --end "${OPTIONS_END_DATE}" \
  --output "${ROOT}/data/options-flow-snapshot.json"

CACHE_VERSION="$(date +%Y%m%d)-options1"
run_root "refresh app data cache version" \
  sed -i '' -E "s/v=[0-9]{8}-[A-Za-z0-9_-]+/v=${CACHE_VERSION}/g" app.js index.html

run_root "validate JSON files" \
  bash -lc 'find data -type f -name "*.json" -print0 | xargs -0 -n1 jq empty'

run_root "release gate" \
  "${PY}" -m unittest tests.test_release_gate -v

run_root "build deploy package" \
  tar -czf ytd-gainers-site.tar.gz \
  index.html styles.css app.js data server scripts mockups TESTING.md

if [[ "${OPTIONS_DEPLOY_AFTER_REFRESH}" == "1" ]]; then
  run_root "deploy latest build to dev" \
    bash scripts/deploy_dev.sh

  if [[ "${OPTIONS_PROMOTE_PROD_AFTER_DEPLOY}" == "1" ]]; then
    run_root "promote latest build to production" \
      bash scripts/promote_prod.sh
  fi
fi

echo
echo "=== options refresh finished $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "Log: ${LOG_FILE}"

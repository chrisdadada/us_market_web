#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/Users/linlifu/Documents/New project"
LAB="${ROOT}/market-data-lab"
PY="${PYTHON_BIN:-/opt/anaconda3/envs/quant/bin/python}"
DATA_ROOT="${DATA_ROOT:-/Volumes/Extreme SSD/market-data-lab/data}"
LOG_DIR="${ROOT}/logs/automation"
LOCK_DIR="${ROOT}/.automated_refresh.lock"

mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/refresh-$(date +%Y%m%d-%H%M%S).log"
# Some restricted environments block process substitution (/dev/fd), so use
# direct file redirection for portability.
exec >>"${LOG_FILE}" 2>&1

if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  echo "Another refresh is already running: ${LOCK_DIR}"
  exit 0
fi
cleanup() {
  rmdir "${LOCK_DIR}" 2>/dev/null || true
}
trap cleanup EXIT

if [[ ! -d "${DATA_ROOT}" ]]; then
  echo "External data root is not mounted: ${DATA_ROOT}"
  exit 2
fi

if [[ ! -x "${PY}" ]]; then
  echo "Python not found or not executable: ${PY}"
  exit 2
fi

SKIP_IF_SUCCESSFUL_TODAY="${SKIP_IF_SUCCESSFUL_TODAY:-1}"
DAYS_BACK="${DAYS_BACK:-10}"
DOWNLOAD_WORKERS="${DOWNLOAD_WORKERS:-4}"
PROCESS_WORKERS="${PROCESS_WORKERS:-4}"
RUN_REFERENCE="${RUN_REFERENCE:-1}"
RUN_RESTRICTED_EVENTS="${RUN_RESTRICTED_EVENTS:-1}"
RUN_OPTIONS_FLOW="${RUN_OPTIONS_FLOW:-1}"
OPTIONS_PHASE="${OPTIONS_PHASE:-core_etf}"
OPTIONS_MAX_DAYS="${OPTIONS_MAX_DAYS:-1}"
OPTIONS_MIN_ROWS_DONE="${OPTIONS_MIN_ROWS_DONE:-18}"
DEPLOY_AFTER_REFRESH="${DEPLOY_AFTER_REFRESH:-1}"
PROMOTE_PROD_AFTER_DEPLOY="${PROMOTE_PROD_AFTER_DEPLOY:-1}"

has_successful_log_today() {
  local today current_log candidate
  today="$(date +%Y%m%d)"
  current_log="$(cd "$(dirname "${LOG_FILE}")" && pwd)/$(basename "${LOG_FILE}")"

  shopt -s nullglob
  for candidate in "${LOG_DIR}/refresh-${today}-"*.log; do
    candidate="$(cd "$(dirname "${candidate}")" && pwd)/$(basename "${candidate}")"
    [[ "${candidate}" == "${current_log}" ]] && continue

    if grep -q -- "Data update complete" "${candidate}" \
      && grep -q -- "--- validate JSON files ---" "${candidate}" \
      && grep -q -- "--- release gate ---" "${candidate}" \
      && grep -q -- "OK" "${candidate}" \
      && grep -q -- "--- build deploy package ---" "${candidate}" \
      && grep -q -- "Dev deployed:" "${candidate}" \
      && grep -q -- "Prod promoted:" "${candidate}" \
      && grep -q -- "=== automated refresh finished" "${candidate}"; then
      echo "${candidate}"
      return 0
    fi
  done
  return 1
}

if [[ "${SKIP_IF_SUCCESSFUL_TODAY}" == "1" ]]; then
  if successful_log="$(has_successful_log_today)"; then
    echo "A successful refresh already completed today: ${successful_log}"
    echo "Set SKIP_IF_SUCCESSFUL_TODAY=0 to force another full refresh."
    echo "=== automated refresh skipped duplicate $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
    exit 0
  fi
fi

END_DATE="${END_DATE:-$("${PY}" - <<'PY'
from datetime import date
print(date.today().isoformat())
PY
)}"
START_DATE="${START_DATE:-$("${PY}" - "${DAYS_BACK}" <<'PY'
from datetime import date, timedelta
import sys
print((date.today() - timedelta(days=int(sys.argv[1]))).isoformat())
PY
)}"
YEAR_START="${YEAR_START:-${END_DATE:0:4}-01-01}"

echo "=== automated refresh started $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "ROOT=${ROOT}"
echo "LAB=${LAB}"
echo "DATA_ROOT=${DATA_ROOT}"
echo "START_DATE=${START_DATE}"
echo "END_DATE=${END_DATE}"
echo "YEAR_START=${YEAR_START}"
echo "DEPLOY_AFTER_REFRESH=${DEPLOY_AFTER_REFRESH}"
echo "PROMOTE_PROD_AFTER_DEPLOY=${PROMOTE_PROD_AFTER_DEPLOY}"
echo "SKIP_IF_SUCCESSFUL_TODAY=${SKIP_IF_SUCCESSFUL_TODAY}"
echo "RUN_OPTIONS_FLOW=${RUN_OPTIONS_FLOW}"
echo "OPTIONS_PHASE=${OPTIONS_PHASE}"
echo "OPTIONS_MAX_DAYS=${OPTIONS_MAX_DAYS}"
echo "LOG_FILE=${LOG_FILE}"

run_lab() {
  local label="$1"
  shift
  echo
  echo "--- ${label} ---"
  (cd "${LAB}" && "$@")
}

try_lab() {
  local label="$1"
  shift
  echo
  echo "--- ${label} ---"
  if ! (cd "${LAB}" && "$@"); then
    echo "WARN: optional step failed: ${label}"
  fi
}

run_root() {
  local label="$1"
  shift
  echo
  echo "--- ${label} ---"
  (cd "${ROOT}" && "$@")
}

run_lab "download stock minute flatfiles" \
  "${PY}" scripts/download_polygon_flatfiles.py download \
  --start "${START_DATE}" --end "${END_DATE}" \
  --prefix us_stocks_sip/minute_aggs_v1 \
  --workers "${DOWNLOAD_WORKERS}"

run_lab "download stock daily flatfiles" \
  "${PY}" scripts/download_polygon_flatfiles.py download \
  --start "${START_DATE}" --end "${END_DATE}" \
  --prefix us_stocks_sip/day_aggs_v1 \
  --workers "${DOWNLOAD_WORKERS}"

run_lab "convert daily bars" \
  "${PY}" scripts/process_polygon_bars.py convert-1d \
  --start "${START_DATE}" --end "${END_DATE}" \
  --workers "${PROCESS_WORKERS}"

run_lab "convert minute bars" \
  "${PY}" scripts/process_polygon_bars.py convert-1m \
  --start "${START_DATE}" --end "${END_DATE}" \
  --workers "${PROCESS_WORKERS}"

run_lab "build RTH minute bars" \
  "${PY}" scripts/process_polygon_bars.py build-rth \
  --start "${START_DATE}" --end "${END_DATE}" \
  --workers "${PROCESS_WORKERS}"

run_lab "aggregate RTH bars" \
  "${PY}" scripts/process_polygon_bars.py aggregate \
  --start "${START_DATE}" --end "${END_DATE}" \
  --timeframes 5m 15m 30m 60m 240m \
  --workers "${PROCESS_WORKERS}"

if [[ "${RUN_REFERENCE}" == "1" ]]; then
  run_lab "refresh Polygon reference data" \
    "${PY}" scripts/download_polygon_reference.py \
    --datasets ticker_types,tickers,corporate_actions \
    --start "${YEAR_START}" --end "${END_DATE}" \
    --pause 0.05
fi

run_lab "refresh FRED macro data" \
  "${PY}" scripts/download_fred.py \
  --end "${END_DATE}"

try_lab "refresh available Polygon fundamentals" \
  "${PY}" scripts/download_polygon_fundamentals.py \
  --datasets short_volume,financials \
  --start "${START_DATE}" --end "${END_DATE}" \
  --chunk day \
  --pause 0.03

if [[ "${RUN_RESTRICTED_EVENTS}" == "1" ]]; then
  try_lab "refresh restricted event feeds if subscription allows" \
    "${PY}" scripts/download_polygon_fundamentals.py \
    --datasets earnings,guidance,analyst_insights \
    --start "${START_DATE}" --end "${END_DATE}" \
    --chunk day \
    --pause 0.03
fi

run_lab "build current-year tradable universe" \
  "${PY}" scripts/build_polygon_universe.py \
  --start "${YEAR_START}" --end "${END_DATE}" \
  --warmup-days 60

run_lab "build current-year split-adjusted daily" \
  "${PY}" scripts/build_polygon_adjustments.py \
  --start "${YEAR_START}" --end "${END_DATE}"

ASOF="$("${PY}" - <<'PY'
from pathlib import Path
import pandas as pd
path = Path("/Volumes/Extreme SSD/market-data-lab/data/features/polygon/universe/daily_universe_counts.parquet")
df = pd.read_parquet(path, columns=["trade_date"])
print(str(df["trade_date"].max()))
PY
)"
echo "Resolved product ASOF=${ASOF}"

run_lab "build analyst product report" \
  "${PY}" scripts/build_analyst_product.py \
  --asof "${ASOF}" \
  --recent-days 30 \
  --stats-start 2024-01-01 \
  --stats-end "${ASOF}"

run_lab "build earnings quality momentum" \
  "${PY}" scripts/build_earnings_quality_momentum.py \
  --asof "${ASOF}" \
  --lookback-days 45

run_lab "build monetizable signal features" \
  "${PY}" scripts/build_monetizable_signals.py \
  --start 2024-01-01 \
  --end "${ASOF}" \
  --stats-start 2024-01-01 \
  --stats-end "${ASOF}"

run_root "rebuild product JSON" \
  bash scripts/update_product_data.sh

if [[ "${RUN_OPTIONS_FLOW}" == "1" ]]; then
  OPTIONS_START_DATE="${OPTIONS_START_DATE:-${START_DATE}}"
  OPTIONS_END_DATE="${OPTIONS_END_DATE:-${ASOF}}"
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
fi

CACHE_VERSION="$(date +%Y%m%d)-product1"
run_root "refresh app data cache version" \
  sed -i '' -E "s/v=[0-9]{8}-(product|options)[0-9]+/v=${CACHE_VERSION}/g" app.js index.html

run_root "validate JSON files" \
  bash -lc 'find data -type f -name "*.json" -print0 | xargs -0 -n1 jq empty'

run_root "release gate" \
  "${PY}" -m unittest tests.test_release_gate -v

run_root "build deploy package" \
  tar -czf ytd-gainers-site.tar.gz \
  index.html styles.css app.js data server scripts mockups TESTING.md

if [[ "${DEPLOY_AFTER_REFRESH}" == "1" ]]; then
  run_root "deploy latest build to dev" \
    bash scripts/deploy_dev.sh

  if [[ "${PROMOTE_PROD_AFTER_DEPLOY}" == "1" ]]; then
    run_root "promote latest build to production" \
      bash scripts/promote_prod.sh
  fi
fi

echo
echo "=== automated refresh finished $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "Log: ${LOG_FILE}"

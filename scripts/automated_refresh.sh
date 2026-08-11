#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${AUTOMATION_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)}"
LAB="${ROOT}/market-data-lab"
PY="${PYTHON_BIN:-/opt/anaconda3/envs/quant/bin/python}"
DATA_ROOT="${DATA_ROOT:-/Volumes/Extreme SSD/market-data-lab/data}"
LOG_DIR="${ROOT}/logs/automation"
LOCK_DIR="${ROOT}/.automated_refresh.lock"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-${HOME}/.dongbimao/refresh.env}"

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

if [[ -f "${LOCAL_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${LOCAL_ENV_FILE}"
  set +a
fi

# shellcheck source=scripts/refresh_workspace_guard.sh
source "${ROOT}/scripts/refresh_workspace_guard.sh"
require_refresh_workspace "${ROOT}" "${REQUIRED_REFRESH_BRANCH:-codex/automation-refresh}"

if [[ ! -d "${DATA_ROOT}" ]]; then
  echo "External data root is not mounted: ${DATA_ROOT}"
  exit 2
fi

if [[ ! -x "${PY}" ]]; then
  echo "Python not found or not executable: ${PY}"
  exit 2
fi

SKIP_IF_SUCCESSFUL_TODAY="${SKIP_IF_SUCCESSFUL_TODAY:-1}"
END_DATE_OVERRIDE="${END_DATE:-}"
DAYS_BACK="${DAYS_BACK:-10}"
DOWNLOAD_WORKERS="${DOWNLOAD_WORKERS:-4}"
PROCESS_WORKERS="${PROCESS_WORKERS:-4}"
RUN_REFERENCE="${RUN_REFERENCE:-1}"
REFERENCE_ATTEMPTS="${REFERENCE_ATTEMPTS:-3}"
REFERENCE_RETRY_SLEEP_SECONDS="${REFERENCE_RETRY_SLEEP_SECONDS:-600}"
RUN_RESTRICTED_EVENTS="${RUN_RESTRICTED_EVENTS:-1}"
EVENTS_FUTURE_DAYS="${EVENTS_FUTURE_DAYS:-90}"
RUN_MINUTE_BARS="${RUN_MINUTE_BARS:-0}"
RUN_OPTIONS_FLOW="${RUN_OPTIONS_FLOW:-1}"
OPTIONS_PHASE="${OPTIONS_PHASE:-core_etf}"
OPTIONS_MAX_DAYS="${OPTIONS_MAX_DAYS:-1}"
OPTIONS_MIN_ROWS_DONE="${OPTIONS_MIN_ROWS_DONE:-18}"
DEPLOY_AFTER_REFRESH="${DEPLOY_AFTER_REFRESH:-1}"
DEPLOY_PROD_DATA_AFTER_REFRESH="${DEPLOY_PROD_DATA_AFTER_REFRESH:-1}"
PROMOTE_PROD_AFTER_DEPLOY="${PROMOTE_PROD_AFTER_DEPLOY:-0}"
if [[ "${PROMOTE_PROD_AFTER_DEPLOY}" == "1" ]]; then
  echo "Production code promotion is manual only. Use prepare_prod_release.sh and promote_prod.sh."
  exit 2
fi
if [[ -z "${REQUIRE_FRESH_ASOF:-}" ]]; then
  if [[ -n "${END_DATE_OVERRIDE}" ]]; then
    REQUIRE_FRESH_ASOF=0
  else
    REQUIRE_FRESH_ASOF=1
  fi
fi

has_successful_log_today() {
  local today current_log candidate
  today="$(date +%Y%m%d)"
  current_log="$(cd "$(dirname "${LOG_FILE}")" && pwd)/$(basename "${LOG_FILE}")"

  shopt -s nullglob
  for candidate in "${LOG_DIR}/refresh-${today}-"*.log; do
    candidate="$(cd "$(dirname "${candidate}")" && pwd)/$(basename "${candidate}")"
    [[ "${candidate}" == "${current_log}" ]] && continue

    if grep -q -- "Product DB update complete" "${candidate}" \
      && grep -q -- "--- build product DB ---" "${candidate}" \
      && grep -q -- "--- release gate ---" "${candidate}" \
      && grep -q -- "OK" "${candidate}" \
      && grep -q -- "Dev data deployed with runtime tables preserved." "${candidate}" \
      && grep -q -- "=== automated refresh finished" "${candidate}"; then
      if [[ "${DEPLOY_PROD_DATA_AFTER_REFRESH}" == "1" ]] \
        && ! grep -q -- "Prod data deployed without using dev DB." "${candidate}"; then
        continue
      fi
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
echo "DEPLOY_PROD_DATA_AFTER_REFRESH=${DEPLOY_PROD_DATA_AFTER_REFRESH}"
echo "PROMOTE_PROD_AFTER_DEPLOY=${PROMOTE_PROD_AFTER_DEPLOY}"
echo "SKIP_IF_SUCCESSFUL_TODAY=${SKIP_IF_SUCCESSFUL_TODAY}"
echo "REQUIRE_FRESH_ASOF=${REQUIRE_FRESH_ASOF}"
echo "RUN_OPTIONS_FLOW=${RUN_OPTIONS_FLOW}"
echo "RUN_MINUTE_BARS=${RUN_MINUTE_BARS}"
echo "REFERENCE_ATTEMPTS=${REFERENCE_ATTEMPTS}"
echo "REFERENCE_RETRY_SLEEP_SECONDS=${REFERENCE_RETRY_SLEEP_SECONDS}"
echo "EVENTS_FUTURE_DAYS=${EVENTS_FUTURE_DAYS}"
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

run_lab_retry() {
  local label="$1"
  local attempts="$2"
  local sleep_seconds="$3"
  local attempt=1
  shift 3

  while true; do
    if run_lab "${label} (attempt ${attempt}/${attempts})" "$@"; then
      return 0
    fi
    if (( attempt >= attempts )); then
      echo "ERROR: ${label} failed after ${attempts} attempts"
      return 1
    fi
    echo "WARN: ${label} failed; retrying in ${sleep_seconds}s"
    sleep "${sleep_seconds}"
    attempt=$((attempt + 1))
  done
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

run_lab "download stock daily flatfiles" \
  "${PY}" scripts/download_polygon_flatfiles.py download \
  --start "${START_DATE}" --end "${END_DATE}" \
  --prefix us_stocks_sip/day_aggs_v1 \
  --workers "${DOWNLOAD_WORKERS}"

run_lab "convert daily bars" \
  "${PY}" scripts/process_polygon_bars.py convert-1d \
  --start "${START_DATE}" --end "${END_DATE}" \
  --workers "${PROCESS_WORKERS}"

if [[ "${RUN_MINUTE_BARS}" == "1" ]]; then
  run_lab "download stock minute flatfiles" \
    "${PY}" scripts/download_polygon_flatfiles.py download \
    --start "${START_DATE}" --end "${END_DATE}" \
    --prefix us_stocks_sip/minute_aggs_v1 \
    --workers "${DOWNLOAD_WORKERS}"

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
fi

if [[ "${RUN_REFERENCE}" == "1" ]]; then
  run_lab_retry "refresh Polygon reference data" "${REFERENCE_ATTEMPTS}" "${REFERENCE_RETRY_SLEEP_SECONDS}" \
    "${PY}" scripts/download_polygon_reference.py \
    --datasets ticker_types,tickers,corporate_actions \
    --start "${YEAR_START}" --end "${END_DATE}" \
    --pause 0.05
fi

run_lab "refresh FRED macro data" \
  "${PY}" scripts/download_fred.py \
  --end "${END_DATE}"

run_root "refresh DXY data" \
  "${PY}" scripts/download_dxy.py \
  --end "${END_DATE}"

try_lab "refresh available Polygon fundamentals" \
  "${PY}" scripts/download_polygon_fundamentals.py \
  --datasets short_volume,financials \
  --start "${START_DATE}" --end "${END_DATE}" \
  --chunk day \
  --pause 0.03

if [[ "${RUN_RESTRICTED_EVENTS}" == "1" ]]; then
  EVENTS_END_DATE="${EVENTS_END_DATE:-$("${PY}" - "${END_DATE}" "${EVENTS_FUTURE_DAYS}" <<'PY'
from datetime import date, datetime, timedelta
import sys
base = datetime.fromisoformat(sys.argv[1]).date()
print((base + timedelta(days=int(sys.argv[2]))).isoformat())
PY
)}"
  try_lab "refresh restricted event feeds if subscription allows" \
    "${PY}" scripts/download_polygon_fundamentals.py \
    --datasets earnings,guidance,analyst_insights \
    --start "${START_DATE}" --end "${EVENTS_END_DATE}" \
    --chunk day \
    --pause 0.03
fi

EVENTS_END_DATE="${EVENTS_END_DATE:-$("${PY}" - "${END_DATE}" "${EVENTS_FUTURE_DAYS}" <<'PY'
from datetime import datetime, timedelta
import sys
base = datetime.fromisoformat(sys.argv[1]).date()
print((base + timedelta(days=int(sys.argv[2]))).isoformat())
PY
)}"

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

if [[ "${REQUIRE_FRESH_ASOF}" == "1" ]]; then
  EXPECTED_ASOF="${EXPECTED_ASOF:-$("${PY}" <<'PY'
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pandas_market_calendars as mcal

now = datetime.now(ZoneInfo("America/New_York"))
cutoff = now.replace(hour=17, minute=30, second=0, microsecond=0)
end = now.date() if now >= cutoff else (now - timedelta(days=1)).date()
start = end - timedelta(days=14)
schedule = mcal.get_calendar("NYSE").schedule(start_date=start, end_date=end)
if schedule.empty:
    raise SystemExit("no NYSE trading day in expected ASOF window")
print(schedule.index[-1].date().isoformat())
PY
)}"
  echo "Expected product ASOF=${EXPECTED_ASOF}"
  if [[ "${ASOF}" < "${EXPECTED_ASOF}" ]]; then
    echo "ERROR: product ASOF ${ASOF} is older than expected ${EXPECTED_ASOF}; refusing to deploy stale data."
    echo "This usually means the latest Polygon flatfiles are not available yet. The later scheduled run will retry."
    exit 3
  fi
fi

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

if [[ "${RUN_OPTIONS_FLOW}" == "1" ]]; then
  OPTIONS_START_DATE="${OPTIONS_START_DATE:-${START_DATE}}"
  OPTIONS_END_DATE="${OPTIONS_END_DATE:-${ASOF}}"
  try_lab "refresh options flow daily aggregates" \
    "${PY}" scripts/run_options_backfill_plan.py \
    --phase "${OPTIONS_PHASE}" \
    --start "${OPTIONS_START_DATE}" \
    --end "${OPTIONS_END_DATE}" \
    --max-days "${OPTIONS_MAX_DAYS}" \
    --min-rows-done "${OPTIONS_MIN_ROWS_DONE}" \
    --save-every 5 \
    --rate-limit-sleep 70 \
    --max-retries 8

fi

run_root "build product DB" \
  env TRACKING_ASOF="${ASOF}" MARKET_DATA_ROOT="${DATA_ROOT}" OPTIONS_START_DATE="${OPTIONS_START_DATE:-${START_DATE}}" OPTIONS_END_DATE="${OPTIONS_END_DATE:-${ASOF}}" PYTHON_BIN="${PY}" bash scripts/update_product_data.sh

run_root "verify product DB schema" \
  verify_product_db_schema "${ROOT}/data/product.db" "${PY}"

run_root "release gate" \
  env RELEASE_TEST_PRODUCT_DB="${ROOT}/data/product.db" bash scripts/run_release_gate.sh

if [[ "${DEPLOY_AFTER_REFRESH}" == "1" ]]; then
  run_root "deploy product DB to dev" \
    env SKIP_PRODUCT_DB_BUILD=1 BUILD_DB="${ROOT}/data/product.db" bash scripts/deploy_dev_data.sh

  if [[ "${DEPLOY_PROD_DATA_AFTER_REFRESH}" == "1" ]]; then
    run_root "deploy product DB to production" \
      env ALLOW_VALIDATED_AUTOMATION_PROD_DATA_DEPLOY=1 SKIP_PRODUCT_DB_BUILD=1 BUILD_DB="${ROOT}/data/product.db" bash scripts/deploy_prod_data.sh
  fi
fi

echo
echo "=== automated refresh finished $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "Log: ${LOG_FILE}"

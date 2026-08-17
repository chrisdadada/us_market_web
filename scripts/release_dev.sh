#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PY="${PYTHON_BIN:-/opt/anaconda3/envs/quant/bin/python}"
INCLUDE_PRODUCT_DATA="${INCLUDE_PRODUCT_DATA:-0}"
BUILD_DB="${BUILD_DB:-${ROOT}/.local/product-dev-release.db}"

cd "${ROOT}"

if [[ "$(git branch --show-current)" != "codex/dev-integration" ]]; then
  echo "Dev release must run from codex/dev-integration." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Dev release requires a clean committed worktree." >&2
  exit 1
fi
if [[ ! -x "${PY}" ]]; then
  echo "Python not found or not executable: ${PY}" >&2
  exit 1
fi

commit="$(git rev-parse HEAD)"
test_db="${RELEASE_TEST_PRODUCT_DB:-${ROOT}/data/product.db}"
marker="$(mktemp)"
trap 'rm -f "${marker}"' EXIT

if [[ "${INCLUDE_PRODUCT_DATA}" == "1" ]]; then
  mkdir -p "$(dirname "${BUILD_DB}")"
  rm -f "${BUILD_DB}"
  echo "[1/4] Build product data once"
  "${PY}" scripts/build_product_db.py --output "${BUILD_DB}"
  "${PY}" scripts/update_macro_calendar_results.py --db "${BUILD_DB}"
  "${PY}" scripts/check_product_coverage.py --db "${BUILD_DB}"
  "${PY}" scripts/check_macro_indicator_freshness.py --db "${BUILD_DB}"
  test_db="${BUILD_DB}"
else
  echo "[1/4] Reuse product data snapshot"
fi

if [[ ! -r "${test_db}" ]]; then
  echo "Product DB snapshot is not readable: ${test_db}" >&2
  exit 1
fi

echo "[2/4] Run checks and release gate once"
npm run check
RELEASE_TEST_PRODUCT_DB="${test_db}" bash scripts/run_release_gate.sh
printf '%s\n' "${commit}" > "${marker}"

echo "[3/4] Deploy dev code"
DEV_VERIFIED_MARKER="${marker}" bash scripts/deploy_dev.sh

if [[ "${INCLUDE_PRODUCT_DATA}" == "1" ]]; then
  echo "[4/4] Deploy the verified product data snapshot"
  SKIP_PRODUCT_DB_BUILD=1 BUILD_DB="${test_db}" bash scripts/deploy_dev_data.sh
else
  echo "[4/4] Product data unchanged"
fi

curl -fsS https://dev.dongbimao.org/api/product/health >/dev/null
echo "Dev release complete: https://dev.dongbimao.org/ (${commit})"

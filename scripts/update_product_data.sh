#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-${HOME}/.dongbimao/refresh.env}"
if [[ -f "${LOCAL_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${LOCAL_ENV_FILE}"
  set +a
fi

if [[ -z "${PYTHON_BIN:-}" ]]; then
  PYTHON_BIN="python3"
  if command -v conda >/dev/null 2>&1 && conda env list | awk '{print $1}' | grep -qx "quant"; then
    PYTHON_BIN="conda run -n quant python"
  fi
fi

echo "Updating product data with: ${PYTHON_BIN}"
${PYTHON_BIN} scripts/build_product_db.py
${PYTHON_BIN} scripts/update_macro_calendar_results.py
${PYTHON_BIN} scripts/check_product_coverage.py
${PYTHON_BIN} scripts/check_macro_indicator_freshness.py

if find data -maxdepth 1 -type f \( -name '*.json' -o -name '*.json.tmp' \) | grep -q .; then
  echo "ERROR: product data refresh must not write data/*.json; product data belongs in data/product.db." >&2
  exit 1
fi

echo "Product DB update complete. Review data/product.db before deployment."

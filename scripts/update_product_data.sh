#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON_BIN="python3"
if command -v conda >/dev/null 2>&1 && conda env list | awk '{print $1}' | grep -qx "quant"; then
  PYTHON_BIN="conda run -n quant python"
fi

echo "Updating product data with: ${PYTHON_BIN}"
${PYTHON_BIN} scripts/build_product_db.py
${PYTHON_BIN} scripts/update_macro_calendar_results.py
${PYTHON_BIN} scripts/check_product_coverage.py

echo "Product DB update complete. Review data/product.db before deployment."

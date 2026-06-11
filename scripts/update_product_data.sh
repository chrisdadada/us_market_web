#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON_BIN="python3"
if command -v conda >/dev/null 2>&1 && conda env list | awk '{print $1}' | grep -qx "quant"; then
  PYTHON_BIN="conda run -n quant python"
fi

echo "Updating product data with: ${PYTHON_BIN}"
${PYTHON_BIN} scripts/build_market_boards.py
${PYTHON_BIN} scripts/build_macro_series.py
${PYTHON_BIN} scripts/build_index_valuation.py
${PYTHON_BIN} scripts/update_strength_board.py
${PYTHON_BIN} scripts/build_sector_flow.py
${PYTHON_BIN} scripts/build_product_data.py
${PYTHON_BIN} scripts/build_core_signals.py
${PYTHON_BIN} scripts/data_agent.py
${PYTHON_BIN} scripts/build_product_db.py
${PYTHON_BIN} scripts/check_product_coverage.py

echo "Data update complete. Review data/*.json before deployment."

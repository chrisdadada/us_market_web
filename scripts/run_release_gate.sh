#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
release_test_db="${RELEASE_TEST_PRODUCT_DB:-}"

if [ -z "$release_test_db" ] || [ ! -r "$release_test_db" ]; then
  echo "RELEASE_TEST_PRODUCT_DB must point to a readable product DB snapshot." >&2
  exit 1
fi

python3 -m unittest \
  tests.test_release_gate \
  tests.test_refresh_workspace_guard \
  tests.test_product_coverage \
  tests.test_macro_calendar_results \
  tests.test_crypto_etf_flows \
  tests.test_retail_sentiment \
  tests.test_open_portfolio \
  tests.test_course_media_audit \
  tests.test_media_delivery_audit \
  tests.test_media_cost_report \
  tests.test_preserve_product_runtime_tables \
  tests.test_prod_code_deploy \
  tests.test_prod_release_validator \
  -v
PRODUCT_DB="$release_test_db" npm run test:next
PRODUCT_DB="$release_test_db" npm run test:next:permissions

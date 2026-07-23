#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
python3 -m unittest \
  tests.test_release_gate \
  tests.test_open_portfolio \
  tests.test_course_media_audit \
  tests.test_media_delivery_audit \
  tests.test_preserve_product_runtime_tables \
  tests.test_prod_code_deploy \
  -v
npm run test:routes
npm run test:next:permissions

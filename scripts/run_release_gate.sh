#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
python3 -m unittest tests.test_release_gate tests.test_open_portfolio tests.test_course_media_audit -v
npm run test:routes

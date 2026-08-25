#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

echo "Partial dev deploys are disabled; running the cumulative verified release."
exec bash "${ROOT}/scripts/release_dev.sh"

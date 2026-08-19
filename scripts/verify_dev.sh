#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
EXPECTED_DEV_BRANCH="codex/dev-integration"
SCOPE="${1:-check}"
MARKER="${DEV_VERIFIED_MARKER:-${ROOT}/.local/dev-verified-commit}"

cd "${ROOT}"

if [ "$(git branch --show-current)" != "${EXPECTED_DEV_BRANCH}" ]; then
  echo "Dev verification must run from ${EXPECTED_DEV_BRANCH}." >&2
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Dev verification requires a clean committed worktree." >&2
  exit 1
fi

case "${SCOPE}" in
  check|dca|full) ;;
  *)
    echo "Usage: bash scripts/verify_dev.sh [check|dca|full]" >&2
    exit 1
    ;;
esac

started_at="$(date +%s)"
commit="$(git rev-parse HEAD)"

npm run check
if [ "${SCOPE}" = "dca" ]; then
  npm run test:dca
elif [ "${SCOPE}" = "full" ]; then
  npm run test:next
  npm run test:next:permissions
fi

mkdir -p "$(dirname "${MARKER}")"
printf '%s\n' "${commit}" > "${MARKER}"
echo "Dev verification passed (${SCOPE}, $(( $(date +%s) - started_at ))s): ${commit}"

#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-root@43.165.133.237}"
target_commit="${1:-}"

cd "$(dirname "$0")/.."

if [ "${MANUAL_PROD_APPROVAL:-0}" != "1" ] || [ "${ALLOW_PROD_CODE_ROLLBACK:-0}" != "1" ]; then
  echo "Production rollback requires current manual approval." >&2
  exit 1
fi
if [ -z "$target_commit" ] || [ "${PROD_APPROVED_COMMIT:-}" != "$target_commit" ]; then
  echo "Usage: PROD_APPROVED_COMMIT=<commit> $0 <commit>" >&2
  exit 1
fi
if ! [[ "$target_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Rollback commit must be a full Git commit." >&2
  exit 1
fi

current_commit="$(ssh "$SERVER" "sed -n 's/^commit=//p' /opt/dongbimao-prod/RELEASE")"
if [ "$current_commit" = "$target_commit" ]; then
  echo "Production is already running $target_commit." >&2
  exit 1
fi

release_dir="${RELEASE_ARTIFACT_DIR:-$PWD/.release-artifacts}"
archive="$release_dir/dongbimao-prod-${target_commit}.tar.gz"
checksum="$archive.sha256"
mkdir -p "$release_dir"

scp "$SERVER:/opt/dongbimao-prod/releases/$(basename "$archive")" "$archive"
scp "$SERVER:/opt/dongbimao-prod/releases/$(basename "$checksum")" "$checksum"

PROD_RELEASE_MODE=rollback \
PROD_APPROVED_COMMIT="$target_commit" \
bash scripts/promote_prod.sh

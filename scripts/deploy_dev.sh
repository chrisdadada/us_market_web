#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-root@43.165.133.237}"
PY="${PYTHON_BIN:-/opt/anaconda3/envs/quant/bin/python}"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-${HOME}/.dongbimao/refresh.env}"
EXPECTED_DEV_BRANCH="codex/dev-integration"
DEV_VERIFIED_MARKER="${DEV_VERIFIED_MARKER:-.local/dev-verified-commit}"

cd "$(dirname "$0")/.."

current_branch="$(git branch --show-current)"
if [ "${current_branch}" != "${EXPECTED_DEV_BRANCH}" ]; then
  echo "Dev code deploy must run from ${EXPECTED_DEV_BRANCH}; current branch: ${current_branch:-detached}." >&2
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Dev code deploy requires a clean committed worktree." >&2
  exit 1
fi

release_commit="$(git rev-parse HEAD)"
ARCHIVE="dongbimao-dev-code-${release_commit}.tar.gz"
REMOTE_ARCHIVE="/tmp/${ARCHIVE}"
trap 'rm -f "${ARCHIVE}"' EXIT
previous_dev_commit="$(ssh "${SERVER}" 'cat /opt/dongbimao-dev/main-web/dist/.release-commit 2>/dev/null || true')"
if [ -n "${previous_dev_commit}" ]; then
  if ! [[ "${previous_dev_commit}" =~ ^[0-9a-f]{40}$ ]] || ! git cat-file -e "${previous_dev_commit}^{commit}" 2>/dev/null; then
    echo "Cannot verify the currently deployed dev commit: ${previous_dev_commit}" >&2
    exit 1
  fi
  if ! git merge-base --is-ancestor "${previous_dev_commit}" "${release_commit}"; then
    echo "Dev release is not cumulative: current dev ${previous_dev_commit} is not contained in ${release_commit}." >&2
    exit 1
  fi
fi

if [ -f "${LOCAL_ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${LOCAL_ENV_FILE}"
  set +a
fi

if [ "${BUILD_PRODUCT_DB:-0}" = "1" ] && [ "${SKIP_PRODUCT_DB_BUILD:-0}" != "1" ]; then
  "${PY}" scripts/build_product_db.py
  "${PY}" scripts/update_macro_calendar_results.py
fi

ensure_web_dependencies() {
  local workspace="$1"
  if [ ! -x "${workspace}/node_modules/.bin/tsc" ] || ! npm --prefix "${workspace}" ls --depth=0 >/dev/null 2>&1; then
    npm --prefix "${workspace}" ci
  fi
}

ensure_web_dependencies admin-web
ensure_web_dependencies main-web
if [ -r "${DEV_VERIFIED_MARKER}" ] \
  && [ "$(cat "${DEV_VERIFIED_MARKER}")" = "${release_commit}" ]; then
  echo "Reusing checks already passed for ${release_commit}."
else
  npm run check
  mkdir -p "$(dirname "${DEV_VERIFIED_MARKER}")"
  printf '%s\n' "${release_commit}" > "${DEV_VERIFIED_MARKER}"
fi

release_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s\n' "${release_commit}" > main-web/dist/.release-commit
printf '{"commit":"%s","deployedAt":"%s"}\n' "${release_commit}" "${release_time}" > main-web/dist/release.json

COPYFILE_DISABLE=1 tar \
  --no-xattrs \
  --exclude='.git' \
  --exclude='.local' \
  --exclude='screenshots' \
  --exclude='market-data-lab' \
  --exclude='notes' \
  --exclude='tests' \
  --exclude='ytd-gainers-site.tar.gz' \
  --exclude='dongbimao-site.tar.gz' \
  --exclude='__pycache__' \
  -czf "${ARCHIVE}" \
  index.html admin.html styles.css app.js assets server scripts admin-web/dist main-web/dist

rsync --partial "${ARCHIVE}" "${SERVER}:${REMOTE_ARCHIVE}"

previous_token="${previous_dev_commit:-__none__}"
ssh "${SERVER}" bash -s -- "${REMOTE_ARCHIVE}" "${previous_token}" "${release_commit}" <<'REMOTE'
set -Eeuo pipefail

archive="$1"
expected_previous="$2"
release_commit="$3"
dev_root="/opt/dongbimao-dev"
dev_web="/var/www/dongbimao-dev"
backup_root="/opt/dongbimao-dev-backups"

if [ "${expected_previous}" = "__none__" ]; then
  expected_previous=""
fi

exec 9>/var/lock/dongbimao-dev-deploy.lock
if ! flock -n 9; then
  echo "Another dev deployment is running." >&2
  exit 1
fi

actual_previous="$(cat "${dev_root}/main-web/dist/.release-commit" 2>/dev/null || true)"
if [ "${actual_previous}" != "${expected_previous}" ]; then
  echo "Dev changed after preflight; rerun from the new baseline." >&2
  exit 1
fi

next_root="$(mktemp -d /opt/.dongbimao-dev.next.XXXXXX)"
next_web="$(mktemp -d /var/www/.dongbimao-dev.next.XXXXXX)"
old_root=""
old_web=""
root_swapped=0
web_swapped=0

finish() {
  rc=$?
  trap - EXIT
  rollback_failed=0

  if [ "${rc}" -ne 0 ]; then
    if [ "${web_swapped}" -eq 1 ]; then
      rm -rf "${dev_web}"
      if mv "${old_web}" "${dev_web}"; then
        web_swapped=0
      else
        rollback_failed=1
      fi
    fi
    if [ "${root_swapped}" -eq 1 ]; then
      rm -rf "${dev_root}"
      if mv "${old_root}" "${dev_root}"; then
        root_swapped=0
      else
        rollback_failed=1
      fi
    fi
    if [ "${rollback_failed}" -eq 0 ]; then
      systemctl restart ytd-gainers-auth-dev 2>/dev/null || true
    fi
  fi

  rm -rf "${next_root}" "${next_web}" "${archive}"
  if [ "${rollback_failed}" -eq 1 ]; then
    echo "Dev rollback failed; previous release directories were retained." >&2
    exit 2
  fi
  [ -z "${old_root}" ] || [ ! -d "${old_root}" ] || rm -rf "${old_root}"
  [ -z "${old_web}" ] || [ ! -d "${old_web}" ] || rm -rf "${old_web}"
  exit "${rc}"
}
trap finish EXIT

test -d "${dev_root}"
test -d "${dev_web}"
tar -xzf "${archive}" -C "${next_root}"
test -f "${next_root}/main-web/dist/index.html"
test -f "${next_root}/admin-web/dist/index.html"
test "$(cat "${next_root}/main-web/dist/.release-commit")" = "${release_commit}"

rm -rf "${next_root}/data" "${next_root}/.local"
if [ -d "${dev_root}/data" ]; then
  cp -a "${dev_root}/data" "${next_root}/data"
fi
if [ -d "${dev_root}/.local" ]; then
  cp -a "${dev_root}/.local" "${next_root}/.local"
fi
product_sha=""
if [ -f "${dev_root}/data/product.db" ]; then
  product_sha="$(sha256sum "${dev_root}/data/product.db" | cut -d ' ' -f 1)"
fi

cp -a "${next_root}/main-web/dist/." "${next_web}/"
mkdir -p "${next_web}/assets" "${next_web}/admin" "${next_web}/next" "${next_web}/legacy"
cp -a "${dev_web}/assets/." "${next_web}/assets/" 2>/dev/null || true
cp -a "${next_root}/assets/." "${next_web}/assets/"
cp -a "${next_root}/admin-web/dist/." "${next_web}/admin/"
cp -a "${next_root}/main-web/dist/." "${next_web}/next/"
cp -a "${next_root}/index.html" "${next_root}/admin.html" "${next_root}/styles.css" \
  "${next_root}/app.js" "${next_web}/legacy/"
cp -a "${next_root}/assets" "${next_web}/legacy/"

mkdir -p "${backup_root}"
backup_dir="${backup_root}/$(date +%Y%m%d%H%M%S)-${actual_previous:-untracked}"
mkdir "${backup_dir}"
tar --exclude='./data' --exclude='./.local' -C "${dev_root}" -czf "${backup_dir}/code.tar.gz" .
tar -C "${dev_web}" -czf "${backup_dir}/web.tar.gz" .

nginx -t
old_root="/opt/.dongbimao-dev.previous.$(date +%s)"
old_web="/var/www/.dongbimao-dev.previous.$(date +%s)"
mv "${dev_root}" "${old_root}"
root_swapped=1
mv "${next_root}" "${dev_root}"
mv "${dev_web}" "${old_web}"
web_swapped=1
mv "${next_web}" "${dev_web}"

if [ -n "${product_sha}" ]; then
  test "${product_sha}" = "$(sha256sum "${dev_root}/data/product.db" | cut -d ' ' -f 1)"
fi
systemctl restart ytd-gainers-auth-dev
systemctl is-active ytd-gainers-auth-dev >/dev/null
curl --fail --silent --show-error --max-time 15 "https://dev.dongbimao.org/release.json?v=${release_commit}" \
  | grep -q "\"commit\":\"${release_commit}\""
curl --fail --silent --show-error --max-time 15 https://dev.dongbimao.org/api/product/health >/dev/null

rm -rf "${old_root}" "${old_web}"
old_root=""
old_web=""
root_swapped=0
web_swapped=0

python3 - "${backup_root}" <<'PY'
from pathlib import Path
import shutil
import sys

backups = sorted(
    (path for path in Path(sys.argv[1]).iterdir() if path.is_dir()),
    key=lambda path: path.stat().st_mtime,
    reverse=True,
)
for path in backups[3:]:
    shutil.rmtree(path)
PY
REMOTE

public_release="$(curl -fsS "https://dev.dongbimao.org/release.json?v=${release_commit}")"
if [[ "${public_release}" != *"\"commit\":\"${release_commit}\""* ]]; then
  echo "Dev release verification failed: public commit does not match ${release_commit}." >&2
  exit 1
fi

echo "Dev deployed: https://dev.dongbimao.org/ (${release_commit})"

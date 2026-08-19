#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-root@43.165.133.237}"
ARCHIVE="dongbimao-site.tar.gz"
REMOTE_ARCHIVE="/tmp/${ARCHIVE}"
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

ssh "${SERVER}" 'set -e
rm -f /tmp/dongbimao-dev-product.db
if [ -f /opt/dongbimao-dev/data/product.db ]; then
  cp /opt/dongbimao-dev/data/product.db /tmp/dongbimao-dev-product.db
fi
rm -rf /opt/dongbimao-dev/*
tar -xzf /tmp/dongbimao-site.tar.gz -C /opt/dongbimao-dev
if [ -f /tmp/dongbimao-dev-product.db ]; then
  mkdir -p /opt/dongbimao-dev/data
  cp /tmp/dongbimao-dev-product.db /opt/dongbimao-dev/data/product.db
fi
rm -rf /tmp/dongbimao-web-assets /tmp/dongbimao-admin-assets
mkdir -p /tmp/dongbimao-web-assets /tmp/dongbimao-admin-assets
if [ -d /var/www/dongbimao-dev/assets ]; then
  cp -a /var/www/dongbimao-dev/assets/. /tmp/dongbimao-web-assets/
fi
if [ -d /var/www/dongbimao-dev/admin/assets ]; then
  cp -a /var/www/dongbimao-dev/admin/assets/. /tmp/dongbimao-admin-assets/
fi
rm -rf /var/www/dongbimao-dev/*
cp -a /opt/dongbimao-dev/main-web/dist/. /var/www/dongbimao-dev/
mkdir -p /var/www/dongbimao-dev/assets
cp -a /tmp/dongbimao-web-assets/. /var/www/dongbimao-dev/assets/ 2>/dev/null || true
cp -a /opt/dongbimao-dev/assets/. /var/www/dongbimao-dev/assets/
rm -rf /var/www/dongbimao-dev/admin
cp -a /opt/dongbimao-dev/admin-web/dist /var/www/dongbimao-dev/admin
mkdir -p /var/www/dongbimao-dev/admin/assets
cp -a /tmp/dongbimao-admin-assets/. /var/www/dongbimao-dev/admin/assets/ 2>/dev/null || true
rm -rf /var/www/dongbimao-dev/next
cp -a /opt/dongbimao-dev/main-web/dist /var/www/dongbimao-dev/next
rm -rf /var/www/dongbimao-dev/legacy
mkdir -p /var/www/dongbimao-dev/legacy
cp -a /opt/dongbimao-dev/index.html /opt/dongbimao-dev/admin.html /opt/dongbimao-dev/styles.css /opt/dongbimao-dev/app.js /opt/dongbimao-dev/assets /var/www/dongbimao-dev/legacy/
systemctl restart ytd-gainers-auth-dev 2>/dev/null || true
'

public_release="$(curl -fsS "https://dev.dongbimao.org/release.json?v=${release_commit}")"
if [[ "${public_release}" != *"\"commit\":\"${release_commit}\""* ]]; then
  echo "Dev release verification failed: public commit does not match ${release_commit}." >&2
  exit 1
fi

echo "Dev deployed: https://dev.dongbimao.org/ (${release_commit})"

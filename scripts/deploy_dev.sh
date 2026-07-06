#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-root@43.165.133.237}"
ARCHIVE="dongbimao-site.tar.gz"
REMOTE_ARCHIVE="/tmp/${ARCHIVE}"
PY="${PYTHON_BIN:-/opt/anaconda3/envs/quant/bin/python}"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-${HOME}/.dongbimao/refresh.env}"

cd "$(dirname "$0")/.."

if [ -f "${LOCAL_ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${LOCAL_ENV_FILE}"
  set +a
fi

if [ "${SKIP_PRODUCT_DB_BUILD:-0}" != "1" ]; then
  "${PY}" scripts/build_product_db.py
  "${PY}" scripts/update_macro_calendar_results.py
fi
npm --prefix admin-web install
npm --prefix admin-web run build
npm --prefix main-web install
npm --prefix main-web run build

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
  index.html admin.html styles.css app.js assets data/product.db server scripts admin-web/dist main-web/dist

rsync --partial "${ARCHIVE}" "${SERVER}:${REMOTE_ARCHIVE}"

ssh "${SERVER}" 'set -e
rm -rf /opt/dongbimao-dev/*
tar -xzf /tmp/dongbimao-site.tar.gz -C /opt/dongbimao-dev
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

echo "Dev deployed: https://dev.dongbimao.org/"

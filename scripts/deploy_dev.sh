#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-root@43.165.133.237}"
ARCHIVE="dongbimao-site.tar.gz"
REMOTE_ARCHIVE="/tmp/${ARCHIVE}"

cd "$(dirname "$0")/.."

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
  index.html styles.css app.js data server scripts mockups

scp "${ARCHIVE}" "${SERVER}:${REMOTE_ARCHIVE}"

ssh "${SERVER}" 'set -e
rm -rf /opt/dongbimao-dev/*
tar -xzf /tmp/dongbimao-site.tar.gz -C /opt/dongbimao-dev
rm -rf /var/www/dongbimao-dev/*
cp -a /opt/dongbimao-dev/index.html /opt/dongbimao-dev/styles.css /opt/dongbimao-dev/app.js /opt/dongbimao-dev/data /opt/dongbimao-dev/mockups /var/www/dongbimao-dev/
systemctl restart ytd-gainers-auth
nginx -t
systemctl reload nginx
systemctl is-active ytd-gainers-auth >/dev/null
'

echo "Dev deployed: http://dev.dongbimao.com/"

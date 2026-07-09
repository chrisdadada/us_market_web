#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-root@43.165.133.237}"
ARCHIVE="dongbimao-admin-dev.tar.gz"
REMOTE_ARCHIVE="/tmp/${ARCHIVE}"

cd "$(dirname "$0")/.."

npm --prefix admin-web install
npm --prefix admin-web run build

COPYFILE_DISABLE=1 tar -czf "${ARCHIVE}" admin-web/dist
rsync --partial "${ARCHIVE}" "${SERVER}:${REMOTE_ARCHIVE}"

ssh "${SERVER}" 'set -e
rm -rf /opt/dongbimao-dev/admin-web/dist /var/www/dongbimao-dev/admin
mkdir -p /opt/dongbimao-dev/admin-web
tar -xzf /tmp/dongbimao-admin-dev.tar.gz -C /opt/dongbimao-dev
cp -a /opt/dongbimao-dev/admin-web/dist /var/www/dongbimao-dev/admin
'

echo "Dev admin deployed: https://dev.dongbimao.org/admin/"

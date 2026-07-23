#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-root@43.165.133.237}"
ARCHIVE="dongbimao-main-dev.tar.gz"
REMOTE_ARCHIVE="/tmp/${ARCHIVE}"

cd "$(dirname "$0")/.."

npm --prefix main-web install
npm --prefix main-web run build

COPYFILE_DISABLE=1 tar -czf "${ARCHIVE}" main-web/dist assets/dongbimao-logo.jpg assets/dongbimao-logo.png
rsync --partial "${ARCHIVE}" "${SERVER}:${REMOTE_ARCHIVE}"

ssh "${SERVER}" 'set -e
rm -rf /opt/dongbimao-dev/main-web/dist /var/www/dongbimao-dev/next
mkdir -p /opt/dongbimao-dev/main-web
tar -xzf /tmp/dongbimao-main-dev.tar.gz -C /opt/dongbimao-dev
find /var/www/dongbimao-dev -mindepth 1 -maxdepth 1 ! -name admin ! -name legacy -exec rm -rf {} +
cp -a /opt/dongbimao-dev/main-web/dist/. /var/www/dongbimao-dev/
cp -a /opt/dongbimao-dev/assets/dongbimao-logo.jpg /opt/dongbimao-dev/assets/dongbimao-logo.png /var/www/dongbimao-dev/assets/
cp -a /opt/dongbimao-dev/main-web/dist /var/www/dongbimao-dev/next
'

echo "Dev main deployed: https://dev.dongbimao.org/"

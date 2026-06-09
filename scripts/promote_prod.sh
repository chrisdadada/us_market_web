#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-root@43.165.133.237}"

ssh "${SERVER}" 'set -e
if [ ! -f /var/www/dongbimao-dev/index.html ]; then
  echo "dev build not found" >&2
  exit 1
fi
rm -rf /opt/dongbimao-prod/* /var/www/dongbimao-prod/*
cp -a /opt/dongbimao-dev/. /opt/dongbimao-prod/
cp -a /var/www/dongbimao-dev/. /var/www/dongbimao-prod/
nginx -t
systemctl reload nginx
'

echo "Prod promoted: http://www.dongbimao.com/"

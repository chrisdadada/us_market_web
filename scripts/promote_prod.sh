#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-root@43.165.133.237}"

ssh "${SERVER}" 'set -e
if [ ! -f /var/www/dongbimao-dev/index.html ]; then
  echo "dev build not found" >&2
  exit 1
fi
if [ -f /opt/dongbimao-prod/data/product.db ]; then
  cp /opt/dongbimao-prod/data/product.db /tmp/dongbimao-product-prev.db
else
  rm -f /tmp/dongbimao-product-prev.db
fi
rm -rf /opt/dongbimao-prod/* /var/www/dongbimao-prod/*
cp -a /opt/dongbimao-dev/. /opt/dongbimao-prod/
cp -a /var/www/dongbimao-dev/. /var/www/dongbimao-prod/
rm -rf /var/www/dongbimao-prod/data
if [ -f /tmp/dongbimao-product-prev.db ]; then
  rm -rf /opt/dongbimao-prod/data
  mkdir -p /opt/dongbimao-prod/data
  cp /tmp/dongbimao-product-prev.db /opt/dongbimao-prod/data/product.db
fi
systemctl restart ytd-gainers-auth
nginx -t
systemctl reload nginx
systemctl is-active ytd-gainers-auth >/dev/null
'

echo "Prod promoted: https://www.dongbimao.org/"

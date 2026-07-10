#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-root@43.165.133.237}"

ssh "${SERVER}" 'set -euo pipefail
dev_root=/opt/dongbimao-dev
prod_root=/opt/dongbimao-prod
dev_web=/var/www/dongbimao-dev
prod_web=/var/www/dongbimao-prod
prod_db="$prod_root/data/product.db"

if [ ! -f "$dev_web/index.html" ]; then
  echo "dev build not found" >&2
  exit 1
fi
if [ ! -f "$prod_db" ]; then
  echo "prod product.db not found" >&2
  exit 1
fi

before_hash=$(sha256sum "$prod_db" | awk "{print \$1}")

# Production runtime data is never part of a code promotion.
rsync -a --exclude="/data/" --exclude="/data/***" "$dev_root/" "$prod_root/"
rsync -a "$dev_web/" "$prod_web/"

after_sync_hash=$(sha256sum "$prod_db" | awk "{print \$1}")
if [ "$before_hash" != "$after_sync_hash" ]; then
  echo "ERROR: prod product.db changed during code promotion" >&2
  exit 1
fi

systemctl restart ytd-gainers-auth
nginx -t
systemctl reload nginx
systemctl is-active ytd-gainers-auth >/dev/null

after_restart_hash=$(sha256sum "$prod_db" | awk "{print \$1}")
if [ "$before_hash" != "$after_restart_hash" ]; then
  echo "ERROR: prod product.db changed during service restart" >&2
  exit 1
fi
'

echo "Prod promoted: https://www.dongbimao.org/"

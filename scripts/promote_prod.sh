#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-root@43.165.133.237}"
ARCHIVE="dongbimao-prod-code.tar.gz"
REMOTE_ARCHIVE="/tmp/${ARCHIVE}"

cd "$(dirname "$0")/.."

if [ "${MANUAL_PROD_APPROVAL:-0}" != "1" ] || [ "${ALLOW_PROD_CODE_DEPLOY:-0}" != "1" ]; then
  echo "Production code deploy requires current manual approval." >&2
  exit 1
fi

if [ "$(git branch --show-current)" != "master" ]; then
  echo "Production code must be deployed from master." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Production code deploy requires a clean worktree." >&2
  exit 1
fi

COMMIT="$(git rev-parse HEAD)"
if [ "${PROD_APPROVED_COMMIT:-}" != "${COMMIT}" ]; then
  echo "PROD_APPROVED_COMMIT must equal the current commit: ${COMMIT}" >&2
  exit 1
fi

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "${STAGE_DIR}" "${ARCHIVE}"' EXIT

npm run check
bash scripts/run_release_gate.sh

mkdir -p "${STAGE_DIR}/release/static-assets" "${STAGE_DIR}/release/server"
cp -a main-web/dist "${STAGE_DIR}/release/main-web-dist"
cp -a admin-web/dist "${STAGE_DIR}/release/admin-web-dist"
cp -a assets/dongbimao-logo.jpg assets/dongbimao-logo.png "${STAGE_DIR}/release/static-assets/"
cp -a scripts/preserve_product_runtime_tables.py "${STAGE_DIR}/release/"
find server -maxdepth 1 -type f -name '*.py' -exec cp -a {} "${STAGE_DIR}/release/server/" \;
(cd "${STAGE_DIR}/release/server" && find . -type f -name '*.py' -print0 | sort -z | xargs -0 sha256sum) \
  > "${STAGE_DIR}/release/server.sha256"
printf 'commit=%s\nbuilt_at=%s\n' "${COMMIT}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "${STAGE_DIR}/release/RELEASE"

COPYFILE_DISABLE=1 tar -C "${STAGE_DIR}" -czf "${ARCHIVE}" release
rsync --partial "${ARCHIVE}" "${SERVER}:${REMOTE_ARCHIVE}"

ssh "${SERVER}" bash -s -- "${REMOTE_ARCHIVE}" "${COMMIT}" <<'REMOTE'
set -euo pipefail

archive="$1"
expected_commit="$2"
prod_root=/opt/dongbimao-prod
prod_web=/var/www/dongbimao-prod
prod_db="$prod_root/data/product.db"

exec 9>/var/lock/dongbimao-prod-deploy.lock
if ! flock -n 9; then
  echo "ERROR: another production deployment is running" >&2
  exit 1
fi

release_dir="$(mktemp -d /tmp/dongbimao-prod-release.XXXXXX)"
next_web="$(mktemp -d /var/www/.dongbimao-prod.next.XXXXXX)"
next_main="$(mktemp -d "$prod_root/main-web/.dist.next.XXXXXX")"
next_admin="$(mktemp -d "$prod_root/admin-web/.dist.next.XXXXXX")"
next_server="$(mktemp -d "$prod_root/.server.next.XXXXXX")"
old_web=""
web_swapped=0
main_swapped=0
admin_swapped=0
server_swapped=0

exchange_dirs() {
  python3 - "$1" "$2" <<'PY'
import ctypes
import os
import sys

libc = ctypes.CDLL(None, use_errno=True)
result = libc.renameat2(-100, os.fsencode(sys.argv[1]), -100, os.fsencode(sys.argv[2]), 2)
if result != 0:
    error = ctypes.get_errno()
    raise OSError(error, os.strerror(error))
PY
}

check_index_assets() {
  python3 - "$prod_web" <<'PY'
from html.parser import HTMLParser
from pathlib import Path
import sys

root = Path(sys.argv[1])

class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        for key in ("src", "href"):
            value = values.get(key, "")
            if value.startswith("/"):
                self.paths.append(value.split("?", 1)[0].lstrip("/"))

for index in (root / "index.html", root / "admin" / "index.html"):
    parser = Assets()
    parser.feed(index.read_text(encoding="utf-8"))
    missing = [path for path in parser.paths if not (root / path).is_file()]
    if missing:
        raise SystemExit(f"{index}: missing referenced assets: {missing}")
PY
}

finish() {
  rc=$?
  trap - EXIT
  rollback_failed=0
  if [ "$rc" -ne 0 ]; then
    if [ "$web_swapped" -eq 1 ] || [ "$main_swapped" -eq 1 ] || [ "$admin_swapped" -eq 1 ] || [ "$server_swapped" -eq 1 ]; then
      echo "Deployment failed; restoring previous release." >&2
    fi
    if [ "$admin_swapped" -eq 1 ] && ! exchange_dirs "$prod_root/admin-web/dist" "$next_admin"; then
      rollback_failed=1
    fi
    if [ "$main_swapped" -eq 1 ] && ! exchange_dirs "$prod_root/main-web/dist" "$next_main"; then
      rollback_failed=1
    fi
    if [ "$web_swapped" -eq 1 ] && ! exchange_dirs "$prod_web" "$old_web"; then
      rollback_failed=1
    fi
    if [ "$server_swapped" -eq 1 ]; then
      if ! exchange_dirs "$prod_root/server" "$next_server"; then
        rollback_failed=1
      elif ! systemctl restart ytd-gainers-auth || ! systemctl is-active ytd-gainers-auth >/dev/null; then
        rollback_failed=1
      fi
    fi
    if [ "$rollback_failed" -eq 1 ]; then
      echo "CRITICAL: rollback failed; release directories were retained for recovery" >&2
      rm -rf "$release_dir" "$archive"
      exit 2
    fi
  fi
  rm -rf "$release_dir" "$next_web" "$next_main" "$next_admin" "$next_server" "$archive"
  exit "$rc"
}
trap finish EXIT

test -f "$prod_db"
test -f /var/lib/ytd-gainers/app.db
test -d "$prod_web"
tar -xzf "$archive" -C "$release_dir"
source_root="$release_dir/release"

test -f "$source_root/main-web-dist/index.html"
test -f "$source_root/admin-web-dist/index.html"
test -f "$source_root/server/auth_api.py"
test -f "$source_root/preserve_product_runtime_tables.py"
grep -qx "commit=$expected_commit" "$source_root/RELEASE"

before_fingerprint="$(python3 "$source_root/preserve_product_runtime_tables.py" fingerprint --db "$prod_db")"

rsync -a "$source_root/server/" "$next_server/"
chown -R root:root "$next_server"
find "$next_server" -type d -exec chmod 755 {} +
find "$next_server" -type f -name '*.py' -exec chmod 644 {} +
(cd "$next_server" && sha256sum -c "$source_root/server.sha256")
python3 -m py_compile "$next_server"/*.py

cp -a "$prod_web/." "$next_web/"
chmod --reference="$prod_web" "$next_web"
rm -f "$next_web/index.html"
find "$next_web/assets" -maxdepth 1 -type f -name 'index-*' -delete
rsync -a "$source_root/main-web-dist/" "$next_web/"
cp -a "$source_root/static-assets/." "$next_web/assets/"

rm -rf "$next_web/admin" "$next_web/next"
mkdir -p "$next_web/admin" "$next_web/next"
rsync -a "$source_root/admin-web-dist/" "$next_web/admin/"
rsync -a "$source_root/main-web-dist/" "$next_web/next/"
rsync -a "$source_root/main-web-dist/" "$next_main/"
rsync -a "$source_root/admin-web-dist/" "$next_admin/"
chmod --reference="$prod_root/main-web/dist" "$next_main"
chmod --reference="$prod_root/admin-web/dist" "$next_admin"

check_root="$prod_web"
prod_web="$next_web"
check_index_assets
prod_web="$check_root"

nginx -t

exchange_dirs "$prod_root/server" "$next_server"
server_swapped=1
systemctl restart ytd-gainers-auth
systemctl is-active ytd-gainers-auth >/dev/null
curl --fail --silent --show-error --max-time 15 https://www.dongbimao.org/api/health >/dev/null
curl --fail --silent --show-error --max-time 15 https://www.dongbimao.org/api/auth/status >/dev/null

old_web="$next_web"
exchange_dirs "$prod_web" "$old_web"
web_swapped=1

check_index_assets
curl --fail --silent --show-error --max-time 15 "https://www.dongbimao.org/?release=$expected_commit" >/dev/null
curl --fail --silent --show-error --max-time 15 "https://admin.dongbimao.org/?release=$expected_commit" >/dev/null
curl --fail --silent --show-error --max-time 15 https://www.dongbimao.org/api/health >/dev/null
curl --fail --silent --show-error --max-time 15 https://www.dongbimao.org/api/auth/status >/dev/null
curl --fail --silent --show-error --max-time 15 https://www.dongbimao.org/api/product/health >/dev/null

after_fingerprint="$(python3 "$source_root/preserve_product_runtime_tables.py" fingerprint --db "$prod_db")"
if [ "$before_fingerprint" != "$after_fingerprint" ]; then
  echo "ERROR: product.db changed during code deployment" >&2
  exit 1
fi

exchange_dirs "$prod_root/main-web/dist" "$next_main"
main_swapped=1
exchange_dirs "$prod_root/admin-web/dist" "$next_admin"
admin_swapped=1
cp -a "$source_root/RELEASE" "$prod_root/RELEASE.next"
mv "$prod_root/RELEASE.next" "$prod_root/RELEASE"

web_swapped=0
main_swapped=0
admin_swapped=0
server_swapped=0
if ! rm -rf "$old_web" "$next_main" "$next_admin" "$next_server"; then
  echo "WARNING: deployed successfully, but old release cleanup needs attention" >&2
fi
REMOTE

echo "Prod code deployed from ${COMMIT}: https://www.dongbimao.org/"

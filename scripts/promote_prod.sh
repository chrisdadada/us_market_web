#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-root@43.165.133.237}"
mode="${PROD_RELEASE_MODE:-promote}"

cd "$(dirname "$0")/.."

if [ "$mode" = "promote" ]; then
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
  commit="$(git rev-parse HEAD)"
elif [ "$mode" = "rollback" ]; then
  if [ "${MANUAL_PROD_APPROVAL:-0}" != "1" ] || [ "${ALLOW_PROD_CODE_ROLLBACK:-0}" != "1" ]; then
    echo "Production rollback requires current manual approval." >&2
    exit 1
  fi
  commit="${PROD_APPROVED_COMMIT:-}"
else
  echo "Unsupported production release mode: $mode" >&2
  exit 1
fi

if ! [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || [ "${PROD_APPROVED_COMMIT:-}" != "$commit" ]; then
  echo "PROD_APPROVED_COMMIT must equal the full approved commit: $commit" >&2
  exit 1
fi

release_dir="${RELEASE_ARTIFACT_DIR:-$PWD/.release-artifacts}"
archive="$release_dir/dongbimao-prod-${commit}.tar.gz"
checksum="$archive.sha256"
test -f "$archive"
test -f "$checksum"
(cd "$release_dir" && sha256sum -c "$(basename "$checksum")")
python3 scripts/validate_prod_release.py "$archive" "$commit"

remote_archive="/tmp/$(basename "$archive")"
remote_checksum="/tmp/$(basename "$checksum")"
started_at="$SECONDS"

echo "[1/2] Upload verified release"
rsync --partial "$archive" "$checksum" "${SERVER}:/tmp/"

echo "[2/2] Switch production release"
ssh "${SERVER}" bash -s -- "$remote_archive" "$remote_checksum" "$commit" "$mode" <<'REMOTE'
set -euo pipefail

archive="$1"
checksum="$2"
expected_commit="$3"
release_mode="$4"
prod_root=/opt/dongbimao-prod
prod_web=/var/www/dongbimao-prod
prod_db="$prod_root/data/product.db"
release_store="$prod_root/releases"
started_at="$SECONDS"

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
old_web="$next_web"
web_swapped=0
main_swapped=0
admin_swapped=0
server_swapped=0
main_changed=1
admin_changed=1
static_changed=1
server_changed=1

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

component_matches() {
  local root="$1"
  local manifest="$2"
  test -d "$root" && (cd "$root" && sha256sum -c "$manifest" >/dev/null 2>&1)
}

write_manifest() {
  local root="$1"
  local output="$2"
  (cd "$root" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$output"
}

wait_for_url() {
  local url="$1"
  local attempt
  for attempt in $(seq 1 15); do
    if curl --fail --silent --max-time 3 "$url" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "ERROR: service did not become ready: $url" >&2
  return 1
}

snapshot_current_release() {
  local current_commit baseline_dir baseline_archive baseline_checksum
  current_commit="$(sed -n 's/^commit=//p' "$prod_root/RELEASE")"
  if ! [[ "$current_commit" =~ ^[0-9a-f]{40}$ ]]; then
    echo "ERROR: current production release commit is invalid" >&2
    return 1
  fi

  baseline_archive="$release_store/dongbimao-prod-${current_commit}.tar.gz"
  baseline_checksum="$baseline_archive.sha256"
  if [ -f "$baseline_archive" ] && [ -f "$baseline_checksum" ]; then
    (cd "$release_store" && sha256sum -c "$(basename "$baseline_checksum")")
    return
  fi

  baseline_dir="$(mktemp -d "$release_dir/baseline.XXXXXX")"
  mkdir -p "$baseline_dir/release/server" "$baseline_dir/release/static-assets"
  cp -a "$prod_root/main-web/dist" "$baseline_dir/release/main-web-dist"
  cp -a "$prod_root/admin-web/dist" "$baseline_dir/release/admin-web-dist"
  find "$prod_root/server" -maxdepth 1 -type f -name '*.py' \
    -exec cp -a {} "$baseline_dir/release/server/" \;
  cp -a "$prod_web/assets/dongbimao-logo.jpg" "$prod_web/assets/dongbimao-logo.png" \
    "$baseline_dir/release/static-assets/"
  cp -a "$source_root/preserve_product_runtime_tables.py" "$baseline_dir/release/"

  write_manifest "$baseline_dir/release/main-web-dist" "$baseline_dir/release/main-web.sha256"
  write_manifest "$baseline_dir/release/admin-web-dist" "$baseline_dir/release/admin-web.sha256"
  write_manifest "$baseline_dir/release/static-assets" "$baseline_dir/release/static-assets.sha256"
  write_manifest "$baseline_dir/release/server" "$baseline_dir/release/server.sha256"
  grep -v '^checks=' "$prod_root/RELEASE" > "$baseline_dir/release/RELEASE"
  printf 'checks=passed\n' >> "$baseline_dir/release/RELEASE"

  tar -C "$baseline_dir" -czf "$release_dir/baseline.tar.gz" release
  install -m 0644 "$release_dir/baseline.tar.gz" "$baseline_archive"
  (cd "$release_store" && sha256sum "$(basename "$baseline_archive")" > "$(basename "$baseline_checksum")")
  echo "Current production baseline retained: $current_commit"
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
      rm -rf "$release_dir" "$archive" "$checksum"
      exit 2
    fi
  fi
  rm -rf "$release_dir" "$next_web" "$next_main" "$next_admin" "$next_server" "$archive" "$checksum"
  exit "$rc"
}
trap finish EXIT

test -f "$prod_db"
test -f /var/lib/ytd-gainers/app.db
test -d "$prod_web"
(cd "$(dirname "$archive")" && sha256sum -c "$(basename "$checksum")")
tar -xzf "$archive" -C "$release_dir"
source_root="$release_dir/release"

test -f "$source_root/main-web-dist/index.html"
test -f "$source_root/admin-web-dist/index.html"
test -f "$source_root/server/auth_api.py"
test -f "$source_root/preserve_product_runtime_tables.py"
test -f "$source_root/main-web.sha256"
test -f "$source_root/admin-web.sha256"
test -f "$source_root/static-assets.sha256"
test -f "$source_root/server.sha256"
grep -qx "commit=$expected_commit" "$source_root/RELEASE"
grep -qx "checks=passed" "$source_root/RELEASE"

mkdir -p "$release_store"
snapshot_current_release

if component_matches "$prod_root/main-web/dist" "$source_root/main-web.sha256"; then
  main_changed=0
fi
if component_matches "$prod_root/admin-web/dist" "$source_root/admin-web.sha256"; then
  admin_changed=0
fi
if component_matches "$prod_web/assets" "$source_root/static-assets.sha256"; then
  static_changed=0
fi
if component_matches "$prod_root/server" "$source_root/server.sha256"; then
  server_changed=0
fi
web_changed=$((main_changed || admin_changed || static_changed))
echo "Components: main=$main_changed admin=$admin_changed static=$static_changed server=$server_changed"

before_fingerprint="$(python3 "$source_root/preserve_product_runtime_tables.py" fingerprint --db "$prod_db")"

if [ "$server_changed" -eq 1 ]; then
  rsync -a "$source_root/server/" "$next_server/"
  chown -R root:root "$next_server"
  find "$next_server" -type d -exec chmod 755 {} +
  find "$next_server" -type f -name '*.py' -exec chmod 644 {} +
  (cd "$next_server" && sha256sum -c "$source_root/server.sha256")
  python3 -m py_compile "$next_server"/*.py
fi

if [ "$web_changed" -eq 1 ]; then
  cp -a "$prod_web/." "$next_web/"
  chmod --reference="$prod_web" "$next_web"
  if [ "$main_changed" -eq 1 ]; then
    rm -f "$next_web/index.html"
    find "$next_web/assets" -maxdepth 1 -type f -name 'index-*' -delete
    rsync -a "$source_root/main-web-dist/" "$next_web/"
    rm -rf "$next_web/next"
    mkdir -p "$next_web/next"
    rsync -a "$source_root/main-web-dist/" "$next_web/next/"
    rsync -a "$source_root/main-web-dist/" "$next_main/"
    chmod --reference="$prod_root/main-web/dist" "$next_main"
  fi
  if [ "$admin_changed" -eq 1 ]; then
    rm -rf "$next_web/admin"
    mkdir -p "$next_web/admin"
    rsync -a "$source_root/admin-web-dist/" "$next_web/admin/"
    rsync -a "$source_root/admin-web-dist/" "$next_admin/"
    chmod --reference="$prod_root/admin-web/dist" "$next_admin"
  fi
  if [ "$static_changed" -eq 1 ]; then
    rsync -a "$source_root/static-assets/" "$next_web/assets/"
  fi

  check_root="$prod_web"
  prod_web="$next_web"
  check_index_assets
  prod_web="$check_root"
  nginx -t
fi

if [ "$server_changed" -eq 1 ]; then
  exchange_dirs "$prod_root/server" "$next_server"
  server_swapped=1
  systemctl restart ytd-gainers-auth
  systemctl is-active ytd-gainers-auth >/dev/null
  wait_for_url https://www.dongbimao.org/api/health
  wait_for_url https://www.dongbimao.org/api/auth/status
fi

if [ "$web_changed" -eq 1 ]; then
  exchange_dirs "$prod_web" "$old_web"
  web_swapped=1
fi

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

install -m 0644 "$archive" "$release_store/$(basename "$archive")"
install -m 0644 "$checksum" "$release_store/$(basename "$checksum")"
python3 - "$release_store" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
archives = sorted(root.glob("dongbimao-prod-*.tar.gz"), key=lambda path: path.stat().st_mtime, reverse=True)
for archive in archives[3:]:
    archive.unlink()
    archive.with_name(archive.name + ".sha256").unlink(missing_ok=True)
PY

if [ "$main_changed" -eq 1 ]; then
  exchange_dirs "$prod_root/main-web/dist" "$next_main"
  main_swapped=1
fi
if [ "$admin_changed" -eq 1 ]; then
  exchange_dirs "$prod_root/admin-web/dist" "$next_admin"
  admin_swapped=1
fi
cp -a "$source_root/RELEASE" "$prod_root/RELEASE.next"
mv "$prod_root/RELEASE.next" "$prod_root/RELEASE"

web_swapped=0
main_swapped=0
admin_swapped=0
server_swapped=0
if ! rm -rf "$old_web" "$next_main" "$next_admin" "$next_server"; then
  echo "WARNING: deployed successfully, but old release cleanup needs attention" >&2
fi
echo "Production ${release_mode} completed in $((SECONDS - started_at))s"
REMOTE

echo "Production ${mode} completed in $((SECONDS - started_at))s"
echo "Commit: ${commit}"
echo "Site: https://www.dongbimao.org/"

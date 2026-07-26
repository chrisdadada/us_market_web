#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Release preparation requires a clean worktree." >&2
  exit 1
fi

commit="$(git rev-parse HEAD)"
release_dir="${RELEASE_ARTIFACT_DIR:-$PWD/.release-artifacts}"
archive="$release_dir/dongbimao-prod-${commit}.tar.gz"
checksum="$archive.sha256"

mkdir -p "$release_dir"

if [ -e "$archive" ] || [ -e "$checksum" ]; then
  if [ -f "$archive" ] && [ -f "$checksum" ] \
    && (cd "$release_dir" && sha256sum -c "$(basename "$checksum")") \
    && python3 scripts/validate_prod_release.py "$archive" "$commit"; then
    echo "Verified release already exists: $archive"
    exit 0
  fi
  echo "Existing release files are incomplete or invalid: $archive" >&2
  exit 1
fi

stage_dir="$(mktemp -d)"
trap 'rm -rf "$stage_dir"' EXIT
started_at="$SECONDS"

echo "[1/3] Build and static checks"
npm run check

echo "[2/3] Complete release gate"
bash scripts/run_release_gate.sh

echo "[3/3] Build immutable release"
mkdir -p "$stage_dir/release/static-assets" "$stage_dir/release/server"
cp -a main-web/dist "$stage_dir/release/main-web-dist"
cp -a admin-web/dist "$stage_dir/release/admin-web-dist"
cp -a assets/dongbimao-logo.jpg assets/dongbimao-logo.png "$stage_dir/release/static-assets/"
cp -a scripts/preserve_product_runtime_tables.py "$stage_dir/release/"
find server -maxdepth 1 -type f -name '*.py' -exec cp -a {} "$stage_dir/release/server/" \;

write_manifest() {
  local root="$1"
  local output="$2"
  (cd "$root" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$output"
}

write_manifest "$stage_dir/release/main-web-dist" "$stage_dir/release/main-web.sha256"
write_manifest "$stage_dir/release/admin-web-dist" "$stage_dir/release/admin-web.sha256"
write_manifest "$stage_dir/release/static-assets" "$stage_dir/release/static-assets.sha256"
write_manifest "$stage_dir/release/server" "$stage_dir/release/server.sha256"

printf 'commit=%s\nbuilt_at=%s\nchecks=passed\n' \
  "$commit" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$stage_dir/release/RELEASE"

COPYFILE_DISABLE=1 tar -C "$stage_dir" -czf "$stage_dir/release.tar.gz" release
python3 scripts/validate_prod_release.py "$stage_dir/release.tar.gz" "$commit"
mv "$stage_dir/release.tar.gz" "$archive"
(cd "$release_dir" && sha256sum "$(basename "$archive")" > "$(basename "$checksum")")

echo "Release prepared in $((SECONDS - started_at))s"
echo "Artifact: $archive"
echo "Commit: $commit"

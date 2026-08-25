#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SERVER="${SERVER:-root@43.165.133.237}"
EXPECTED_DEV_BRANCH="codex/dev-integration"

cd "${ROOT}"

if [[ "$(git branch --show-current)" != "${EXPECTED_DEV_BRANCH}" ]]; then
  echo "Fast dev release must run from ${EXPECTED_DEV_BRANCH}." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Fast dev release requires a clean committed worktree." >&2
  exit 1
fi

commit="$(git rev-parse HEAD)"
previous_dev_commit="$(ssh "${SERVER}" 'cat /opt/dongbimao-dev/main-web/dist/.release-commit 2>/dev/null || true')"
if ! [[ "${previous_dev_commit}" =~ ^[0-9a-f]{40}$ ]] \
  || ! git cat-file -e "${previous_dev_commit}^{commit}" 2>/dev/null \
  || ! git merge-base --is-ancestor "${previous_dev_commit}" "${commit}"; then
  echo "Cannot establish a cumulative dev baseline; use ./scripts/release_dev.sh." >&2
  exit 1
fi

changed_files=()
while IFS= read -r file; do
  changed_files+=("${file}")
done < <(git diff --name-only "${previous_dev_commit}..${commit}")
if [[ "${#changed_files[@]}" -eq 0 ]]; then
  echo "No changes to release." >&2
  exit 1
fi

unsafe_files=()
for file in "${changed_files[@]}"; do
  case "${file}" in
    main-web/src/*.tsx|main-web/src/*.css|main-web/index.html|assets/*) ;;
    *) unsafe_files+=("${file}") ;;
  esac
done
if [[ "${#unsafe_files[@]}" -gt 0 ]]; then
  printf 'Fast dev release accepts frontend-only changes. Use ./scripts/release_dev.sh because these files changed:\n' >&2
  printf '  %s\n' "${unsafe_files[@]}" >&2
  exit 1
fi

echo "[1/3] Build and check frontend"
npm run check

scope="frontend"
for file in "${changed_files[@]}"; do
  case "${file}" in
    main-web/src/RollingToolPage.tsx|main-web/src/rollingTool.css) ;;
    *) scope="frontend"; break ;;
  esac
  scope="rolling"
done
if [[ "${scope}" != "rolling" ]]; then
  scope="dca"
  for file in "${changed_files[@]}"; do
    case "${file}" in
      main-web/src/DcaStrategyPages.tsx|main-web/src/dcaStrategy.css) ;;
      *) scope="frontend"; break ;;
    esac
  done
fi

echo "[2/3] Run ${scope} browser regression"
if [[ "${scope}" == "rolling" ]]; then
  npm run test:rolling:permissions
elif [[ "${scope}" == "dca" ]]; then
  npm run test:dca
else
  npm run test:next
  npm run test:next:permissions
fi

marker="$(mktemp)"
trap 'rm -f "${marker}"' EXIT
printf '%s\n' "${commit}" > "${marker}"

echo "[3/3] Deploy dev code; product data unchanged"
DEV_VERIFIED_MARKER="${marker}" bash scripts/deploy_dev.sh
curl -fsS https://dev.dongbimao.org/api/product/health >/dev/null
echo "Fast dev release complete: https://dev.dongbimao.org/ (${commit})"

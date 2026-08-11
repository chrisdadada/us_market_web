#!/usr/bin/env bash

require_refresh_workspace() {
  local root="$1"
  local expected_branch="$2"
  local actual_root actual_branch dirty

  actual_root="$(git -C "${root}" rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -z "${actual_root}" || "$(cd "${actual_root}" && pwd -P)" != "$(cd "${root}" && pwd -P)" ]]; then
    echo "ERROR: refresh root is not the expected Git worktree: ${root}"
    return 2
  fi

  actual_branch="$(git -C "${root}" branch --show-current)"
  if [[ "${actual_branch}" != "${expected_branch}" ]]; then
    echo "ERROR: refresh requires branch ${expected_branch}; current branch is ${actual_branch:-detached}."
    return 2
  fi

  dirty="$(git -C "${root}" status --porcelain --untracked-files=no)"
  if [[ -n "${dirty}" ]]; then
    echo "ERROR: refresh worktree has uncommitted tracked changes."
    echo "${dirty}"
    return 2
  fi

  if ! grep -Eq '^SCHEMA_VERSION[[:space:]]*=[[:space:]]*2[[:space:]]*$' "${root}/scripts/build_product_db.py"; then
    echo "ERROR: refresh code does not declare product schema version 2."
    return 2
  fi
}

verify_product_db_schema() {
  local db_path="$1"
  local python_bin="$2"

  "${python_bin}" - "${db_path}" <<'PY'
import sqlite3
import sys
from pathlib import Path

path = Path(sys.argv[1])
if not path.is_file():
    raise SystemExit(f"Product DB not found: {path}")

with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    row = conn.execute(
        "SELECT value FROM product_db_info WHERE key = 'schema_version'"
    ).fetchone()

if integrity != "ok":
    raise SystemExit(f"Product DB integrity check failed: {integrity}")

version = str(row[0]) if row else ""
if version != "2":
    raise SystemExit(f"Product DB schema must be 2, got {version or 'missing'}")

print(f"Product DB schema verified: {version}")
PY
}

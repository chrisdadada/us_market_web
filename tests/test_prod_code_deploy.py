from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PREPARE = (ROOT / "scripts" / "prepare_prod_release.sh").read_text(encoding="utf-8")
PROMOTE = (ROOT / "scripts" / "promote_prod.sh").read_text(encoding="utf-8")
ROLLBACK = (ROOT / "scripts" / "rollback_prod.sh").read_text(encoding="utf-8")
DATA_SCRIPT = (ROOT / "scripts" / "deploy_prod_data.sh").read_text(encoding="utf-8")
AUTOMATED_REFRESH = (ROOT / "scripts" / "automated_refresh.sh").read_text(encoding="utf-8")
OPTIONS_REFRESH = (ROOT / "scripts" / "options_refresh.sh").read_text(encoding="utf-8")
REFRESH_GUARD = (ROOT / "scripts" / "refresh_workspace_guard.sh").read_text(encoding="utf-8")


class ProdCodeDeployScriptTests(unittest.TestCase):
    def test_prepare_runs_checks_once_and_builds_commit_artifact(self) -> None:
        self.assertIn("npm run check", PREPARE)
        self.assertIn("bash scripts/run_release_gate.sh", PREPARE)
        self.assertIn("dongbimao-prod-${commit}.tar.gz", PREPARE)
        self.assertIn("checks=passed", PREPARE)
        self.assertIn("validate_prod_release.py", PREPARE)
        self.assertNotIn("ssh ", PREPARE)
        self.assertNotIn("rsync ", PREPARE)

    def test_promote_requires_commit_specific_manual_approval(self) -> None:
        self.assertIn("MANUAL_PROD_APPROVAL", PROMOTE)
        self.assertIn("ALLOW_PROD_CODE_DEPLOY", PROMOTE)
        self.assertIn("PROD_APPROVED_COMMIT", PROMOTE)
        self.assertIn("git branch --show-current", PROMOTE)
        self.assertIn("git status --porcelain", PROMOTE)

    def test_promote_reuses_verified_artifact_without_rebuilding(self) -> None:
        self.assertIn("sha256sum -c", PROMOTE)
        self.assertIn("validate_prod_release.py", PROMOTE)
        self.assertNotIn("npm run check", PROMOTE)
        self.assertNotIn("scripts/run_release_gate.sh", PROMOTE)
        self.assertNotIn("vite build", PROMOTE)

    def test_components_are_checked_and_only_changed_code_is_swapped(self) -> None:
        self.assertIn("component_matches", PROMOTE)
        self.assertIn("main_changed", PROMOTE)
        self.assertIn("admin_changed", PROMOTE)
        self.assertIn("static_changed", PROMOTE)
        self.assertIn("server_changed", PROMOTE)
        self.assertIn('if [ "$server_changed" -eq 1 ]', PROMOTE)
        self.assertIn('if [ "$web_changed" -eq 1 ]', PROMOTE)

    def test_uses_shared_lock_and_atomic_directory_exchange(self) -> None:
        lock = "dongbimao-prod-deploy.lock"
        self.assertIn(lock, PROMOTE)
        self.assertIn(lock, DATA_SCRIPT)
        self.assertIn("renameat2", PROMOTE)
        self.assertIn('exchange_dirs "$prod_web" "$old_web"', PROMOTE)
        self.assertIn('exchange_dirs "$prod_root/server" "$next_server"', PROMOTE)

    def test_verifies_apis_and_product_db_without_packaging_data(self) -> None:
        self.assertIn("check_index_assets", PROMOTE)
        self.assertIn("/api/auth/status", PROMOTE)
        self.assertIn("/api/product/health", PROMOTE)
        self.assertGreaterEqual(PROMOTE.count("fingerprint --db"), 2)
        self.assertNotIn('rsync -a "$source_root/data', PROMOTE)
        self.assertNotIn("app.db", PREPARE)
        self.assertNotIn("product.db", PREPARE)

    def test_failed_release_rolls_back_backend_and_frontends(self) -> None:
        self.assertIn("CRITICAL: rollback failed", PROMOTE)
        self.assertIn('if [ "$server_swapped" -eq 1 ]', PROMOTE)
        self.assertIn("systemctl restart ytd-gainers-auth", PROMOTE)
        self.assertIn("exit 2", PROMOTE)

    def test_recent_release_artifacts_are_retained_for_rollback(self) -> None:
        self.assertIn('release_store="$prod_root/releases"', PROMOTE)
        self.assertIn("snapshot_current_release", PROMOTE)
        self.assertIn("Current production baseline retained", PROMOTE)
        self.assertIn("archives[3:]", PROMOTE)
        self.assertIn("ALLOW_PROD_CODE_ROLLBACK", ROLLBACK)
        self.assertIn("PROD_APPROVED_COMMIT", ROLLBACK)
        self.assertIn("/opt/dongbimao-prod/releases/", ROLLBACK)

    def test_automated_data_jobs_cannot_promote_prod_code(self) -> None:
        self.assertNotIn("bash scripts/promote_prod.sh", AUTOMATED_REFRESH)
        self.assertNotIn("bash scripts/promote_prod.sh", OPTIONS_REFRESH)
        self.assertIn("Production code promotion is manual only", AUTOMATED_REFRESH)
        self.assertIn("Production code promotion is manual only", OPTIONS_REFRESH)

    def test_automated_data_jobs_do_not_deploy_site_code(self) -> None:
        for script in (AUTOMATED_REFRESH, OPTIONS_REFRESH):
            self.assertNotIn("bash scripts/deploy_dev.sh", script)
            self.assertIn("bash scripts/deploy_dev_data.sh", script)
            self.assertNotIn("refresh app data cache version", script)

    def test_automated_data_jobs_require_verified_refresh_workspace(self) -> None:
        hardcoded_root = 'ROOT="/Users/linlifu/Documents/New project"'
        for script in (AUTOMATED_REFRESH, OPTIONS_REFRESH):
            self.assertNotIn(hardcoded_root, script)
            self.assertIn("refresh_workspace_guard.sh", script)
            self.assertIn("codex/automation-refresh", script)
            self.assertIn("require_product_db_baseline", script)
            self.assertIn("verify_product_db_schema", script)
            self.assertIn("npm run check", script)
            self.assertIn("RELEASE_TEST_PRODUCT_DB", script)
            self.assertIn("bash scripts/run_release_gate.sh", script)

        self.assertIn("branch --show-current", REFRESH_GUARD)
        self.assertIn("--untracked-files=no", REFRESH_GUARD)
        self.assertIn("Product DB baseline is incomplete", REFRESH_GUARD)
        self.assertIn("product schema version 2", REFRESH_GUARD)


if __name__ == "__main__":
    unittest.main()

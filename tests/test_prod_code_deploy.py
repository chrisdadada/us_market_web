from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / "scripts" / "promote_prod.sh").read_text(encoding="utf-8")
DATA_SCRIPT = (ROOT / "scripts" / "deploy_prod_data.sh").read_text(encoding="utf-8")


class ProdCodeDeployScriptTests(unittest.TestCase):
    def test_requires_commit_specific_manual_approval(self) -> None:
        self.assertIn("MANUAL_PROD_APPROVAL", SCRIPT)
        self.assertIn("ALLOW_PROD_CODE_DEPLOY", SCRIPT)
        self.assertIn("PROD_APPROVED_COMMIT", SCRIPT)
        self.assertIn("git branch --show-current", SCRIPT)
        self.assertIn("git status --porcelain", SCRIPT)

    def test_runs_complete_release_gate(self) -> None:
        self.assertIn("npm run check", SCRIPT)
        self.assertIn("bash scripts/run_release_gate.sh", SCRIPT)

    def test_deploys_frontends_only_when_backend_matches(self) -> None:
        self.assertIn("server.sha256", SCRIPT)
        self.assertIn('sha256sum -c "$source_root/server.sha256"', SCRIPT)
        self.assertNotIn("systemctl restart ytd-gainers-auth", SCRIPT)
        self.assertNotIn('rsync -a --delete "$source_root/server/', SCRIPT)

    def test_uses_shared_lock_and_atomic_web_exchange(self) -> None:
        lock = "dongbimao-prod-deploy.lock"
        self.assertIn(lock, SCRIPT)
        self.assertIn(lock, DATA_SCRIPT)
        self.assertIn("renameat2", SCRIPT)
        self.assertIn('exchange_dirs "$prod_web" "$old_web"', SCRIPT)
        self.assertIn('cp -a "$prod_web/." "$next_web/"', SCRIPT)
        self.assertIn('chmod --reference="$prod_web" "$next_web"', SCRIPT)

    def test_verifies_static_assets_apis_and_product_db(self) -> None:
        self.assertIn("check_index_assets", SCRIPT)
        self.assertIn("/api/auth/status", SCRIPT)
        self.assertIn("/api/product/health", SCRIPT)
        self.assertGreaterEqual(SCRIPT.count("fingerprint --db"), 2)
        self.assertNotIn('rsync -a "$source_root/data', SCRIPT)

    def test_rollback_failure_is_not_suppressed(self) -> None:
        self.assertIn("CRITICAL: rollback failed", SCRIPT)
        self.assertNotIn("restore_code || true", SCRIPT)
        self.assertIn("exit 2", SCRIPT)


if __name__ == "__main__":
    unittest.main()

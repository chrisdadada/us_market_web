from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
DEPLOY = (ROOT / "scripts" / "deploy_dev.sh").read_text(encoding="utf-8")
DATA_DEPLOY = (ROOT / "scripts" / "deploy_dev_data.sh").read_text(encoding="utf-8")
RELEASE = (ROOT / "scripts" / "release_dev.sh").read_text(encoding="utf-8")
FAST_RELEASE = (ROOT / "scripts" / "release_dev_fast.sh").read_text(encoding="utf-8")
VERIFY = (ROOT / "scripts" / "verify_dev.sh").read_text(encoding="utf-8")
MAIN_DEPLOY = (ROOT / "scripts" / "deploy_dev_main.sh").read_text(encoding="utf-8")
ADMIN_DEPLOY = (ROOT / "scripts" / "deploy_dev_admin.sh").read_text(encoding="utf-8")


class DevCodeDeployTest(unittest.TestCase):
    def test_requires_the_canonical_dev_branch(self) -> None:
        self.assertIn('EXPECTED_DEV_BRANCH="codex/dev-integration"', DEPLOY)
        self.assertIn('git branch --show-current', DEPLOY)

    def test_requires_committed_code(self) -> None:
        self.assertIn('git status --porcelain --untracked-files=no', DEPLOY)
        self.assertIn('clean committed worktree', DEPLOY)

    def test_requires_a_cumulative_dev_release(self) -> None:
        self.assertIn('main-web/dist/.release-commit', DEPLOY)
        self.assertIn('git merge-base --is-ancestor', DEPLOY)
        self.assertIn('Dev release is not cumulative', DEPLOY)

    def test_records_and_verifies_the_public_commit(self) -> None:
        self.assertIn('main-web/dist/release.json', DEPLOY)
        self.assertIn('https://dev.dongbimao.org/release.json', DEPLOY)
        self.assertIn('public commit does not match', DEPLOY)

    def test_runs_the_release_check_before_packaging(self) -> None:
        self.assertIn('npm run check', DEPLOY)

    def test_reuses_checks_only_for_the_exact_verified_commit(self) -> None:
        self.assertIn('DEV_VERIFIED_MARKER', DEPLOY)
        self.assertIn('= "${release_commit}"', DEPLOY)
        self.assertIn('.local/dev-verified-commit', DEPLOY)

    def test_targeted_dev_verification_records_the_exact_commit(self) -> None:
        self.assertIn('npm run check', VERIFY)
        self.assertIn('npm run test:dca', VERIFY)
        self.assertIn('git rev-parse HEAD', VERIFY)
        self.assertIn('.local/dev-verified-commit', VERIFY)

    def test_one_shot_release_runs_checks_and_gate_once(self) -> None:
        self.assertEqual(RELEASE.count("npm run check"), 1)
        self.assertEqual(RELEASE.count("bash scripts/run_release_gate.sh"), 1)
        self.assertIn('DEV_VERIFIED_MARKER="${marker}" bash scripts/deploy_dev.sh', RELEASE)

    def test_fast_release_is_frontend_only_and_fail_closed(self) -> None:
        self.assertIn('main-web/src/*.tsx|main-web/src/*.css|main-web/index.html|assets/*', FAST_RELEASE)
        self.assertIn('unsafe_files+=("${file}")', FAST_RELEASE)
        self.assertIn('use ./scripts/release_dev.sh', FAST_RELEASE)
        self.assertNotIn('INCLUDE_PRODUCT_DATA', FAST_RELEASE)
        self.assertNotIn('build_product_db.py', FAST_RELEASE)

    def test_fast_release_keeps_checks_and_scoped_browser_regression(self) -> None:
        self.assertEqual(FAST_RELEASE.count("npm run check"), 1)
        self.assertIn('npm run test:rolling:permissions', FAST_RELEASE)
        self.assertIn('npm run test:dca', FAST_RELEASE)
        self.assertIn('npm run test:next', FAST_RELEASE)
        self.assertIn('npm run test:next:permissions', FAST_RELEASE)
        self.assertIn('DEV_VERIFIED_MARKER="${marker}" bash scripts/deploy_dev.sh', FAST_RELEASE)

    def test_one_shot_data_release_builds_and_enriches_before_gate(self) -> None:
        build = RELEASE.index('scripts/build_product_db.py')
        enrich = RELEASE.index('scripts/update_macro_calendar_results.py')
        gate = RELEASE.index('bash scripts/run_release_gate.sh')
        deploy = RELEASE.index('bash scripts/deploy_dev_data.sh')
        self.assertLess(build, enrich)
        self.assertLess(enrich, gate)
        self.assertLess(gate, deploy)
        self.assertIn('INCLUDE_PRODUCT_DATA', RELEASE)
        self.assertIn('SKIP_PRODUCT_DB_BUILD=1 BUILD_DB="${test_db}"', RELEASE)

    def test_reuses_installed_dependencies_when_current(self) -> None:
        self.assertIn('node_modules/.bin/tsc', DEPLOY)
        self.assertIn('npm --prefix "${workspace}" ls --depth=0', DEPLOY)
        self.assertIn('npm --prefix "${workspace}" ci', DEPLOY)

    def test_data_deploy_verifies_protected_table_fingerprints(self) -> None:
        self.assertIn('preserve_product_runtime_tables.py merge', DATA_DEPLOY)
        self.assertIn('preserve_product_runtime_tables.py verify', DATA_DEPLOY)
        self.assertIn("python3 - <<'PY'", DATA_DEPLOY)
        self.assertNotIn("<<'\"'\"'PY'\"'\"'", DATA_DEPLOY)

    def test_data_deploy_rejects_incomplete_product_coverage(self) -> None:
        self.assertIn('scripts/check_product_coverage.py --db "${BUILD_DB}"', DATA_DEPLOY)

    def test_partial_code_entrypoints_cannot_bypass_the_release(self) -> None:
        for script in (MAIN_DEPLOY, ADMIN_DEPLOY):
            self.assertIn('scripts/release_dev.sh', script)
            self.assertNotIn('rsync --partial', script)
            self.assertNotIn('rm -rf /opt/dongbimao-dev', script)

    def test_code_and_data_deployments_share_one_lock(self) -> None:
        lock = "dongbimao-dev-deploy.lock"
        self.assertIn(lock, DEPLOY)
        self.assertIn(lock, DATA_DEPLOY)
        self.assertIn('dongbimao-dev-product-${db_sha}.db', DATA_DEPLOY)

    def test_code_deploy_detects_races_and_rolls_back(self) -> None:
        self.assertIn('actual_previous', DEPLOY)
        self.assertIn('Dev changed after preflight', DEPLOY)
        self.assertIn('dongbimao-dev-backups', DEPLOY)
        self.assertIn('root_swapped', DEPLOY)
        self.assertIn('web_swapped', DEPLOY)
        self.assertIn('systemctl is-active ytd-gainers-auth-dev', DEPLOY)
        self.assertIn('service_ready=0', DEPLOY)
        self.assertIn('Dev API did not become ready after restart.', DEPLOY)

    def test_code_deploy_checks_public_cache_and_compression_before_cleanup(self) -> None:
        delivery_check = DEPLOY.index('scripts/check_web_delivery.py')
        cleanup = DEPLOY.index('rm -rf "${old_root}" "${old_web}"', delivery_check)
        self.assertLess(delivery_check, cleanup)
        self.assertIn('--release "${release_commit}"', DEPLOY)

    def test_code_deploy_preserves_runtime_data(self) -> None:
        self.assertIn('cp -a "${dev_root}/data" "${next_root}/data"', DEPLOY)
        self.assertIn('cp -a "${dev_root}/.local" "${next_root}/.local"', DEPLOY)
        self.assertGreaterEqual(DEPLOY.count('product_sha'), 2)

if __name__ == "__main__":
    unittest.main()

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
DEPLOY = (ROOT / "scripts" / "deploy_dev.sh").read_text(encoding="utf-8")
DATA_DEPLOY = (ROOT / "scripts" / "deploy_dev_data.sh").read_text(encoding="utf-8")


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

    def test_reuses_installed_dependencies_when_current(self) -> None:
        self.assertIn('node_modules/.bin/tsc', DEPLOY)
        self.assertIn('npm --prefix "${workspace}" ls --depth=0', DEPLOY)
        self.assertIn('npm --prefix "${workspace}" ci', DEPLOY)

    def test_data_deploy_verifies_protected_table_fingerprints(self) -> None:
        self.assertIn('preserve_product_runtime_tables.py merge', DATA_DEPLOY)
        self.assertIn('preserve_product_runtime_tables.py verify', DATA_DEPLOY)


if __name__ == "__main__":
    unittest.main()

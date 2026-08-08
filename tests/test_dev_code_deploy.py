from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
DEPLOY = (ROOT / "scripts" / "deploy_dev.sh").read_text(encoding="utf-8")


class DevCodeDeployTest(unittest.TestCase):
    def test_requires_the_canonical_dev_branch(self) -> None:
        self.assertIn('EXPECTED_DEV_BRANCH="codex/dev-integration"', DEPLOY)
        self.assertIn('git branch --show-current', DEPLOY)

    def test_requires_committed_code(self) -> None:
        self.assertIn('git status --porcelain --untracked-files=no', DEPLOY)
        self.assertIn('clean committed worktree', DEPLOY)

    def test_reuses_installed_dependencies_when_current(self) -> None:
        self.assertIn('node_modules/.bin/tsc', DEPLOY)
        self.assertIn('npm --prefix "${workspace}" ci', DEPLOY)


if __name__ == "__main__":
    unittest.main()

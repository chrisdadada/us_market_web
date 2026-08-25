import shlex
import subprocess
import tempfile
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "scripts" / "refresh_workspace_guard.sh"


def git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True)


class RefreshWorkspaceGuardTest(unittest.TestCase):
    def test_rejects_refresh_branch_behind_dev_integration(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            git(repo, "init", "-q")
            git(repo, "config", "user.email", "test@example.com")
            git(repo, "config", "user.name", "Test")
            git(repo, "checkout", "-q", "-b", "codex/dev-integration")
            scripts = repo / "scripts"
            scripts.mkdir()
            builder = scripts / "build_product_db.py"
            builder.write_text("SCHEMA_VERSION = 2\n", encoding="utf-8")
            git(repo, "add", ".")
            git(repo, "commit", "-qm", "baseline")
            git(repo, "branch", "codex/automation-refresh")
            builder.write_text("SCHEMA_VERSION = 2\n# current contract\n", encoding="utf-8")
            git(repo, "add", ".")
            git(repo, "commit", "-qm", "new contract")
            git(repo, "checkout", "-q", "codex/automation-refresh")

            command = (
                f"source {shlex.quote(str(GUARD))}; "
                f"require_refresh_workspace {shlex.quote(str(repo))} "
                "codex/automation-refresh codex/dev-integration"
            )
            result = subprocess.run(["bash", "-c", command], capture_output=True, text=True)

            self.assertEqual(result.returncode, 2)
            self.assertIn("is behind codex/dev-integration", result.stdout)


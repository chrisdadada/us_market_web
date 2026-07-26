import io
import tarfile
import tempfile
import unittest
from pathlib import Path

from scripts.validate_prod_release import REQUIRED_FILES, validate_archive


COMMIT = "a" * 40


class ProdReleaseValidatorTests(unittest.TestCase):
    def build_archive(self, extra_file: str | None = None, commit: str = COMMIT) -> Path:
        tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(tempdir.cleanup)
        path = Path(tempdir.name) / "release.tar.gz"
        files = {name: b"ok" for name in REQUIRED_FILES}
        files["release/RELEASE"] = f"commit={commit}\nchecks=passed\n".encode()
        if extra_file:
            files[extra_file] = b"blocked"

        with tarfile.open(path, "w:gz") as archive:
            for name, content in files.items():
                info = tarfile.TarInfo(name)
                info.size = len(content)
                archive.addfile(info, io.BytesIO(content))
        return path

    def test_accepts_complete_code_only_release(self) -> None:
        validate_archive(str(self.build_archive()), COMMIT)

    def test_rejects_database_files(self) -> None:
        with self.assertRaisesRegex(ValueError, "unexpected release member|database file"):
            validate_archive(str(self.build_archive("release/data/product.db")), COMMIT)

    def test_rejects_wrong_commit(self) -> None:
        with self.assertRaisesRegex(ValueError, "approved commit"):
            validate_archive(str(self.build_archive(commit="b" * 40)), COMMIT)

    def test_rejects_path_traversal(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsafe archive path"):
            validate_archive(str(self.build_archive("release/../outside.txt")), COMMIT)


if __name__ == "__main__":
    unittest.main()

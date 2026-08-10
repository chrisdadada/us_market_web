from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
MAIN_APP = (ROOT / "main-web/src/App.tsx").read_text(encoding="utf-8")
MAIN_ENTRY = (ROOT / "main-web/src/main.tsx").read_text(encoding="utf-8")
MAIN_HTML = (ROOT / "main-web/index.html").read_text(encoding="utf-8")
DEPLOY = (ROOT / "scripts/deploy_dev.sh").read_text(encoding="utf-8")

LEGACY_MIGRATION_ROUTES = {
    "/legacy/#options",
    "/legacy/#signals",
    "/legacy/#stock-events",
    "/legacy/#earnings",
}
LEGACY_FILES = ("index.html", "admin.html", "app.js", "styles.css")


class FrontendArchitectureTest(unittest.TestCase):
    def test_white_frontend_has_one_source_of_truth(self) -> None:
        self.assertIn('import "./styles.css"', MAIN_ENTRY)
        self.assertIn('import "./article.css"', MAIN_ENTRY)
        self.assertNotIn("/legacy/", MAIN_ENTRY)
        self.assertNotIn("app.js", MAIN_HTML)
        self.assertNotIn("styles.css", MAIN_HTML)

    def test_only_the_explicit_migration_list_can_open_legacy(self) -> None:
        references: dict[str, list[str]] = {}
        for path in (ROOT / "main-web/src").rglob("*"):
            if path.suffix not in {".ts", ".tsx", ".css"}:
                continue
            matches = re.findall(r'/legacy/[^"\'\s)]+', path.read_text(encoding="utf-8"))
            if matches:
                references[str(path.relative_to(ROOT))] = sorted(matches)
        self.assertEqual(references, {"main-web/src/App.tsx": sorted(LEGACY_MIGRATION_ROUTES)})

    def test_legacy_is_isolated_from_the_default_dev_site(self) -> None:
        self.assertIn("cp -a /opt/dongbimao-dev/main-web/dist/. /var/www/dongbimao-dev/", DEPLOY)
        self.assertIn("/var/www/dongbimao-dev/legacy", DEPLOY)
        self.assertNotIn("cp -a /opt/dongbimao-dev/index.html /var/www/dongbimao-dev/", DEPLOY)

    def test_legacy_files_must_disappear_when_the_migration_list_is_empty(self) -> None:
        if LEGACY_MIGRATION_ROUTES:
            for filename in LEGACY_FILES:
                self.assertTrue((ROOT / filename).is_file(), filename)
            return
        for filename in LEGACY_FILES:
            self.assertFalse((ROOT / filename).exists(), filename)
        self.assertNotIn("/legacy", DEPLOY)


if __name__ == "__main__":
    unittest.main()

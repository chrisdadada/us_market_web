import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts import audit_course_media


class CourseMediaAuditTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name).resolve()

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def create_db(self, *, modern: bool) -> Path:
        path = self.root / "app.db"
        conn = sqlite3.connect(path)
        card_column = ", cover_card_url TEXT" if modern else ""
        status_column = ", video_status TEXT" if modern else ""
        conn.execute(f"CREATE TABLE course_series (id INTEGER PRIMARY KEY, title TEXT, cover_url TEXT{card_column})")
        conn.execute(f"CREATE TABLE course_lessons (id INTEGER PRIMARY KEY, series_id INTEGER, title TEXT, cover_url TEXT, video_key TEXT{status_column})")
        if modern:
            conn.execute(
                "INSERT INTO course_series (id, title, cover_url, cover_card_url) VALUES (1, ?, ?, ?)",
                ("课程", "course-image/detail.png", "course-image/card.webp"),
            )
            conn.execute(
                "INSERT INTO course_lessons (id, series_id, title, cover_url, video_key, video_status) VALUES (1, 1, ?, ?, ?, ?)",
                ("第一节", "course-image/lesson.jpg", "lesson/first.mp4", "failed"),
            )
        else:
            conn.execute(
                "INSERT INTO course_series (id, title, cover_url) VALUES (1, ?, ?)",
                ("课程", "course-image/detail.png"),
            )
            conn.execute(
                "INSERT INTO course_lessons (id, series_id, title, cover_url, video_key) VALUES (1, 1, ?, ?, ?)",
                ("第一节", "course-image/lesson.jpg", "lesson/first.mov"),
            )
        conn.commit()
        conn.close()
        return path

    def allowed_roots(self) -> dict[str, Path]:
        return {"local": self.root, "dev": self.root}

    def test_legacy_schema_is_read_without_guessing_new_columns(self) -> None:
        path = self.create_db(modern=False)
        safe = audit_course_media.safe_db_path(str(path), "dev", self.allowed_roots())
        report = audit_course_media.audit_database(safe, "dev")

        self.assertEqual(report["summary"]["courses"], 1)
        self.assertEqual(report["summary"]["lessons"], 1)
        self.assertEqual(report["schema"]["seriesCoverCard"], "legacy-missing")
        self.assertEqual(report["schema"]["lessonVideoStatus"], "legacy-missing")
        self.assertEqual(report["summary"]["videos"]["formats"], {".mov": 1})
        self.assertEqual(report["summary"]["videoStatuses"], {"ready": 1})

    def test_modern_schema_reports_card_cover_and_failed_video(self) -> None:
        path = self.create_db(modern=True)
        safe = audit_course_media.safe_db_path(str(path), "local", self.allowed_roots())
        report = audit_course_media.audit_database(safe, "local")

        self.assertEqual(report["schema"]["seriesCoverCard"], "available")
        self.assertEqual(report["summary"]["seriesCardCovers"]["formats"], {".webp": 1})
        self.assertEqual(report["summary"]["videoStatuses"], {"failed": 1})
        self.assertEqual(report["objectMetadata"]["status"], "not-probed")

    def test_prod_paths_and_symlinks_are_rejected(self) -> None:
        path = self.create_db(modern=False)
        prod_root = self.root / "prod"
        prod_root.mkdir()
        prod_path = prod_root / "app.db"
        prod_path.write_bytes(path.read_bytes())
        with self.assertRaisesRegex(ValueError, "prod"):
            audit_course_media.safe_db_path(str(prod_path), "dev", {"dev": self.root})

        link = self.root / "linked.db"
        link.symlink_to(path)
        with self.assertRaisesRegex(ValueError, "符号链接"):
            audit_course_media.safe_db_path(str(link), "dev", self.allowed_roots())

    def test_existing_report_is_not_overwritten(self) -> None:
        output = self.root / "report.json"
        audit_course_media.write_report({"ok": True}, str(output), self.root)
        with self.assertRaises(FileExistsError):
            audit_course_media.write_report({"ok": False}, str(output), self.root)

        outside = self.root.parent / "outside-report.json"
        with self.assertRaisesRegex(ValueError, "media-audits"):
            audit_course_media.write_report({"ok": True}, str(outside), self.root)


if __name__ == "__main__":
    unittest.main()

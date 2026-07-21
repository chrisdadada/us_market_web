import io
import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts import optimize_dev_course_covers as covers

try:
    from PIL import Image
except ImportError:
    Image = None


class OptimizeDevCourseCoversTest(unittest.TestCase):
    def test_database_path_requires_the_exact_dev_whitelist(self):
        with tempfile.TemporaryDirectory() as directory:
            allowed = Path(directory) / "app.db"
            other = Path(directory) / "other.db"
            allowed.touch()
            other.touch()
            self.assertEqual(covers.safe_dev_db(str(allowed), allowed), allowed.resolve())
            with self.assertRaisesRegex(ValueError, "只允许"):
                covers.safe_dev_db(str(other), allowed)

    @unittest.skipUnless(Image, "Pillow is only required by the dev media migration")
    def test_render_webp_uses_expected_dimensions(self):
        source = io.BytesIO()
        Image.new("RGB", (1800, 900), "#2376d9").save(source, format="PNG")
        output = covers.render_webp(source.getvalue(), covers.CARD_SIZE, 78)
        covers.verify_webp(output, covers.CARD_SIZE)
        with Image.open(io.BytesIO(output)) as image:
            self.assertEqual(image.size, (640, 360))
            self.assertEqual(image.format, "WEBP")

    def test_variant_key_is_deterministic_and_rejects_unsafe_paths(self):
        self.assertEqual(
            covers.variant_key("course-image/20260701/cover.png", "card"),
            "course-image/20260701/optimized/cover-card.webp",
        )
        with self.assertRaisesRegex(ValueError, "路径"):
            covers.variant_key("../prod/cover.png", "card")

    def test_database_updates_are_atomic_and_backed_up(self):
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "app.db"
            backup_path = Path(directory) / "app.db.backup"
            conn = sqlite3.connect(db_path)
            conn.executescript(
                """
                CREATE TABLE course_series (id INTEGER PRIMARY KEY, cover_url TEXT, cover_card_url TEXT);
                CREATE TABLE course_lessons (id INTEGER PRIMARY KEY, cover_url TEXT);
                INSERT INTO course_series VALUES (1, 'course-image/series.png', '');
                INSERT INTO course_lessons VALUES (2, 'course-image/lesson.jpg');
                """
            )
            conn.commit()
            conn.close()

            covers.apply_database_updates(
                db_path,
                [{"id": 1, "cover": "course-image/series.png", "detailKey": "series-detail.webp", "cardKey": "series-card.webp"}],
                [{"id": 2, "cover": "course-image/lesson.jpg", "detailKey": "lesson-detail.webp"}],
                backup_path,
            )

            with sqlite3.connect(db_path) as current:
                self.assertEqual(current.execute("SELECT cover_url, cover_card_url FROM course_series").fetchone(), ("series-detail.webp", "series-card.webp"))
                self.assertEqual(current.execute("SELECT cover_url FROM course_lessons").fetchone()[0], "lesson-detail.webp")
            with sqlite3.connect(backup_path) as backup:
                self.assertEqual(backup.execute("SELECT cover_url, cover_card_url FROM course_series").fetchone(), ("course-image/series.png", ""))


if __name__ == "__main__":
    unittest.main()

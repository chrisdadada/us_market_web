import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from scripts.report_course_media_usage import build_report, safe_file


class CourseMediaUsageReportTest(unittest.TestCase):
    def setUp(self) -> None:
        self.conn = sqlite3.connect(":memory:")
        self.conn.execute(
            "CREATE TABLE analytics_events (id INTEGER PRIMARY KEY, user_id INTEGER, event_type TEXT, event_key TEXT, path TEXT, created_at TEXT)"
        )
        self.metadata = {
            "environment": "dev",
            "objectMetadata": {
                "videos": [
                    {"id": 11, "metadata": {"size": 1000, "duration": 60, "videoCodec": "h264"}},
                    {"id": 12, "metadata": {"size": 2000, "duration": 90, "videoCodec": "h264"}},
                ]
            },
        }

    def tearDown(self) -> None:
        self.conn.close()

    def test_aggregates_grants_without_claiming_delivery(self) -> None:
        self.conn.executemany(
            "INSERT INTO analytics_events (user_id, event_type, event_key, path, created_at) VALUES (?, ?, ?, '', ?)",
            [
                (1, "course_play_grant", "11", "2026-07-22T01:00:00+00:00"),
                (1, "course_play_grant", "11", "2026-07-22T02:00:00+00:00"),
                (2, "course_play_grant", "12", "2026-07-22T03:00:00+00:00"),
                (1, "course_video_url_ready", "11:lt1", "2026-07-22T02:00:01+00:00"),
                (1, "course_video_ready", "11:1to3", "2026-07-22T02:00:02+00:00"),
                (1, "course_video_buffer", "11", "2026-07-22T02:00:03+00:00"),
                (2, "nav_click", "courses", "2026-07-22T04:00:00+00:00"),
            ],
        )
        report = build_report(
            self.conn,
            self.metadata,
            datetime(2026, 7, 22, tzinfo=timezone.utc),
            datetime(2026, 7, 23, tzinfo=timezone.utc),
        )
        self.assertEqual(report["totals"], {"grants": 3, "uniqueUsers": 2, "lessonsGranted": 2})
        self.assertEqual(report["rows"][0]["grants"], 2)
        self.assertEqual(report["rows"][0]["assetSizeBytes"], 1000)
        self.assertNotIn("bytesDelivered", report["totals"])
        self.assertEqual(report["playbackHealth"]["urlReady"]["lt1"], 1)
        self.assertEqual(report["playbackHealth"]["videoReady"]["1to3"], 1)
        self.assertEqual(report["playbackHealth"]["bufferingReports"], 1)

    def test_missing_metadata_fails_closed(self) -> None:
        self.conn.execute(
            "INSERT INTO analytics_events (user_id, event_type, event_key, path, created_at) VALUES (1, 'course_play_grant', '99', '', '2026-07-22T01:00:00+00:00')"
        )
        with self.assertRaisesRegex(ValueError, "媒体报告缺少课时 99"):
            build_report(
                self.conn,
                self.metadata,
                datetime(2026, 7, 22, tzinfo=timezone.utc),
                datetime(2026, 7, 23, tzinfo=timezone.utc),
            )

    def test_rejects_symlinked_parent_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            real = root / "real"
            real.mkdir()
            database = real / "app.db"
            database.touch()
            alias = root / "alias"
            alias.symlink_to(real, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "路径不安全"):
                safe_file(str(alias / "app.db"), expected=database)

    def test_rejects_symlinked_expected_path_when_input_is_canonical(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            real = root / "real"
            real.mkdir()
            database = real / "app.db"
            database.touch()
            alias = root / "alias"
            alias.symlink_to(real, target_is_directory=True)
            with patch(
                "scripts.report_course_media_usage.has_symlink",
                side_effect=[False, True],
            ):
                with self.assertRaisesRegex(ValueError, "数据库路径不安全"):
                    safe_file(str(database), expected=alias / "app.db")

    def test_rejects_symlinked_root_when_input_is_canonical(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            real = root / "real"
            real.mkdir()
            report = real / "report.json"
            report.touch()
            alias = root / "alias"
            alias.symlink_to(real, target_is_directory=True)
            with patch(
                "scripts.report_course_media_usage.has_symlink",
                side_effect=[False, True],
            ):
                with self.assertRaisesRegex(ValueError, "报告目录不安全"):
                    safe_file(str(report), root=alias)


if __name__ == "__main__":
    unittest.main()

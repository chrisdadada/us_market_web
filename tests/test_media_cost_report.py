import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scripts.report_dev_media_costs import (
    build_report,
    latest_report,
    transcode_summary,
)


class MediaCostReportTest(unittest.TestCase):
    def setUp(self) -> None:
        self.conn = sqlite3.connect(":memory:")
        self.conn.executescript(
            """
            CREATE TABLE analytics_events (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                event_type TEXT,
                event_key TEXT,
                path TEXT,
                created_at TEXT
            );
            CREATE TABLE course_lessons (
                id INTEGER PRIMARY KEY,
                status TEXT,
                video_key TEXT,
                video_source_key TEXT
            );
            INSERT INTO course_lessons VALUES
                (11, 'published', 'lesson/11/master.m3u8', 'lesson/11.mp4'),
                (12, 'published', 'lesson/12/master.m3u8', 'lesson/12.mp4');
            INSERT INTO analytics_events
                (user_id, event_type, event_key, path, created_at)
            VALUES
                (7, 'course_play_grant', '11', '', '2026-07-22T01:00:00+00:00');
            """
        )
        self.metadata = {
            "environment": "dev",
            "generatedAt": "2026-07-22T00:00:00+00:00",
            "summary": {
                "courses": 1,
                "lessons": 2,
                "seriesCovers": {"present": 1},
                "seriesCardCovers": {"present": 1},
                "lessonCovers": {"present": 2},
            },
            "objectMetadata": {
                "status": "probed",
                "videos": [
                    {"id": 11, "metadata": {"size": 1000, "duration": 60, "videoCodec": "h264"}},
                    {"id": 12, "metadata": {"size": 2000, "duration": 90, "videoCodec": "h264"}},
                ],
            },
        }
        self.batch = {
            "environment": "dev",
            "freeTranscode": True,
            "pricing": {"asOf": "2026-06-05"},
            "items": [
                {
                    "lessonId": 11,
                    "activated": True,
                    "estimatedIdleCostCny": 0.42,
                    "variants": [
                        {"jobId": "a", "state": "Success"},
                        {"jobId": "b", "state": "Success"},
                        {"jobId": "c", "state": "Success"},
                    ],
                }
            ],
        }

    def tearDown(self) -> None:
        self.conn.close()

    def test_builds_honest_partial_report(self) -> None:
        report = build_report(
            self.conn,
            self.metadata,
            [("batch.json", self.batch)],
            datetime(2026, 7, 22, tzinfo=timezone.utc),
            datetime(2026, 7, 23, tzinfo=timezone.utc),
            "metadata.json",
        )
        self.assertTrue(report["ok"])
        self.assertEqual(report["status"], "partial")
        self.assertEqual(report["inventory"]["sourceVideos"]["bytes"], 3000)
        self.assertEqual(report["delivery"]["hlsLessons"], 2)
        self.assertEqual(report["transcoding"]["succeededJobs"], 3)
        self.assertEqual(report["transcoding"]["estimatedIdleCostCny"], 0.42)
        self.assertEqual(report["playAddressGrants"]["totals"]["grants"], 1)
        self.assertEqual(report["externalCosts"]["tencentBilling"]["status"], "not-connected")
        self.assertNotIn("bytesDelivered", report["playAddressGrants"]["totals"])

    def test_failed_transcode_is_a_real_failure(self) -> None:
        self.batch["items"][0]["variants"][0]["state"] = "Failed"
        report = build_report(
            self.conn,
            self.metadata,
            [("batch.json", self.batch)],
            datetime(2026, 7, 22, tzinfo=timezone.utc),
            datetime(2026, 7, 23, tzinfo=timezone.utc),
            "metadata.json",
        )
        self.assertFalse(report["ok"])
        self.assertEqual(report["status"], "failed")
        self.assertIn(
            "transcode-failed",
            {alert["code"] for alert in report["alerts"]},
        )

    def test_duplicate_lesson_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "重复或无效课时"):
            transcode_summary([
                ("one.json", self.batch),
                ("two.json", self.batch),
            ])

    def test_latest_report_uses_name_to_break_mtime_tie(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            first = root / "a.json"
            second = root / "b.json"
            first.write_text("{}", encoding="utf-8")
            second.write_text("{}", encoding="utf-8")
            timestamp = 1_700_000_000_000_000_000
            first.touch()
            second.touch()
            os.utime(first, ns=(timestamp, timestamp))
            os.utime(second, ns=(timestamp, timestamp))
            self.assertEqual(latest_report(root), second)


if __name__ == "__main__":
    unittest.main()

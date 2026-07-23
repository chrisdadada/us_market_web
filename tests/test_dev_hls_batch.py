import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import create_dev_hls_batch as batch  # noqa: E402


class DevHlsBatchTest(unittest.TestCase):
    def test_plan_skips_existing_hls_and_estimates_idle_cost(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            db_path = Path(folder) / "app-dev.db"
            with sqlite3.connect(db_path) as conn:
                conn.executescript(
                    """
                    CREATE TABLE course_lessons (
                        id INTEGER PRIMARY KEY,
                        title TEXT,
                        status TEXT,
                        video_key TEXT,
                        video_source_key TEXT
                    );
                    INSERT INTO course_lessons VALUES
                        (1, 'Ready', 'published', 'lesson/one.mp4', NULL),
                        (2, 'Done', 'published', 'lesson/two/master.m3u8', 'lesson/two.mp4');
                    """
                )
            batch.auth_api.COURSE_COS_BUCKET = "lesson-dev-1259765032"
            with mock.patch.object(
                batch.auth_api,
                "course_media_info",
                return_value={
                    "duration": 600,
                    "width": 1920,
                    "height": 1080,
                    "bitrateKbps": 2000,
                },
            ):
                payload = batch.build_plan(db_path, "lesson/hls/dev-batch/test", [])

        summary = batch.plan_summary(payload)
        self.assertTrue(payload["freeTranscode"])
        self.assertEqual(summary["lessons"], 1)
        self.assertEqual(summary["outputMinutes"], 30)
        self.assertEqual(summary["estimatedIdleCostCny"], 0.42)
        self.assertEqual(payload["skipped"], [{"lessonId": 2, "reason": "already-hls"}])

    def test_submit_resumes_only_missing_jobs(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder) / "batch.json"
            payload = {
                "items": [{
                    "sourceKey": "lesson/source.mp4",
                    "variants": [
                        {
                            "name": "720",
                            "outputKey": "lesson/output/720/index.hls.m3u8",
                            "width": 1280,
                            "height": 720,
                            "bitrate": 650,
                            "jobId": "existing-job",
                        },
                        {
                            "name": "480",
                            "outputKey": "lesson/output/480/index.hls.m3u8",
                            "width": 854,
                            "height": 480,
                            "bitrate": 350,
                        },
                    ],
                }],
            }
            with mock.patch.object(batch.pilot, "submit_variant", return_value="new-job") as submit:
                batch.submit(payload, state)

            submit.assert_called_once()
            saved = json.loads(state.read_text(encoding="utf-8"))
            self.assertEqual(saved["items"][0]["variants"][0]["jobId"], "existing-job")
            self.assertEqual(saved["items"][0]["variants"][1]["jobId"], "new-job")

if __name__ == "__main__":
    unittest.main()

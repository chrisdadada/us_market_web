import sys
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import create_dev_hls_pilot as pilot  # noqa: E402


class DevHlsPilotTest(unittest.TestCase):
    def test_job_uses_hls_segments_without_upscaling(self) -> None:
        pilot.auth_api.COURSE_COS_BUCKET = "lesson-dev-1259765032"
        pilot.auth_api.COURSE_COS_REGION = "ap-chengdu"
        root = ET.fromstring(
            pilot.build_hls_job_body(
                "lesson/source.mp4",
                "lesson/hls/pilot/720/index.m3u8",
                720,
                650,
            )
        )

        self.assertEqual(root.findtext("Tag"), "GeneratePlayList")
        self.assertEqual(root.findtext("Operation/Transcode/Container/Format"), "hls")
        self.assertEqual(root.findtext("Operation/Transcode/Container/ClipConfig/Duration"), "5")
        self.assertEqual(root.findtext("Operation/Transcode/Video/Height"), "720")
        self.assertEqual(root.findtext("Operation/Transcode/Video/Bitrate"), "650")
        self.assertEqual(root.findtext("Operation/Output/Bucket"), "lesson-dev-1259765032")
        self.assertEqual(root.findtext("Operation/Output/Object"), "lesson/hls/pilot/720/index.${ext}")

    def test_master_playlist_contains_three_ordered_renditions(self) -> None:
        content = pilot.master_playlist(list(pilot.VARIANTS))

        self.assertIn("RESOLUTION=1920x1080\n1080/index.m3u8", content)
        self.assertIn("RESOLUTION=1280x720\n720/index.m3u8", content)
        self.assertIn("RESOLUTION=854x480\n480/index.m3u8", content)


if __name__ == "__main__":
    unittest.main()

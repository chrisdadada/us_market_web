import io
import json
import tempfile
import unittest
from email.message import Message
from pathlib import Path

from scripts import audit_media_delivery as audit


class FakeResponse:
    def __init__(self, status: int, headers: dict[str, str]):
        self.status = status
        self.headers = Message()
        for name, value in headers.items():
            self.headers[name] = value
        self.body = io.BytesIO(b"x")

    def read(self, size: int = -1) -> bytes:
        return self.body.read(size)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class MediaDeliveryAuditTest(unittest.TestCase):
    def test_signed_url_is_redacted_and_cache_hit_is_detected(self):
        calls = 0

        def opener(_request, **_kwargs):
            nonlocal calls
            calls += 1
            return FakeResponse(
                206,
                {
                    "Content-Range": "bytes 0-0/1048576",
                    "Content-Length": "1",
                    "Accept-Ranges": "bytes",
                    "CF-Cache-Status": "MISS" if calls == 1 else "HIT",
                },
            )

        result = audit.probe_url(
            "https://media.example.com/video.mp4?q-signature=secret-token&q-ak=identifier",
            opener=opener,
        )

        self.assertEqual(result["url"], "https://media.example.com/video.mp4")
        self.assertNotIn("secret-token", json.dumps(result))
        self.assertTrue(result["signedQueryDetected"])
        self.assertTrue(result["rangeSupported"])
        self.assertTrue(result["cacheHitObserved"])
        self.assertTrue(result["cloudflareFree"]["withinSizeLimit"])
        self.assertIn("不得直接忽略查询参数", " ".join(result["issues"]))

    def test_large_video_is_rejected_for_cloudflare_free_cache(self):
        size = audit.CLOUDFLARE_FREE_MAX_BYTES + 1

        def opener(_request, **_kwargs):
            return FakeResponse(206, {"Content-Range": f"bytes 0-0/{size}", "Content-Length": "1"})

        result = audit.probe_url("https://media.example.com/large.mp4", opener=opener)

        self.assertFalse(result["cloudflareFree"]["withinSizeLimit"])
        self.assertIn("超过 Cloudflare Free 512 MB", " ".join(result["issues"]))

    def test_single_attempt_inventory_does_not_claim_cache_miss(self):
        def opener(_request, **_kwargs):
            return FakeResponse(206, {"Content-Range": "bytes 0-0/100", "Content-Length": "1"})

        result = audit.probe_url(
            "https://media.example.com/file.mp4",
            attempts_count=1,
            opener=opener,
        )

        self.assertEqual(len(result["attempts"]), 1)
        self.assertNotIn("连续请求未观察到", " ".join(result["issues"]))

    def test_report_cannot_escape_audit_directory_or_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "audits"
            output = root / "result.json"
            audit.write_report(str(output), {"ok": True}, root)
            self.assertTrue(output.exists())
            with self.assertRaises(FileExistsError):
                audit.write_report(str(output), {"ok": False}, root)
            with self.assertRaisesRegex(ValueError, "media-delivery-audits"):
                audit.write_report(str(Path(directory) / "outside.json"), {"ok": True}, root)

    def test_summary_counts_provider_limits_without_guessing_unknown_sizes(self):
        summary = audit.summarize([
            {
                "totalBytes": 10,
                "rangeSupported": True,
                "cacheHitObserved": True,
                "signedQueryDetected": False,
                "cloudflareFree": {"withinSizeLimit": True},
                "error": "",
            },
            {
                "totalBytes": audit.CLOUDFLARE_FREE_MAX_BYTES + 1,
                "rangeSupported": True,
                "cacheHitObserved": False,
                "signedQueryDetected": True,
                "cloudflareFree": {"withinSizeLimit": False},
                "error": "",
            },
            {
                "totalBytes": None,
                "rangeSupported": False,
                "cacheHitObserved": False,
                "signedQueryDetected": False,
                "cloudflareFree": {"withinSizeLimit": None},
                "error": "请求失败",
            },
        ])

        self.assertEqual(summary["targets"], 3)
        self.assertEqual(summary["cloudflareFreeWithinSizeLimit"], 1)
        self.assertEqual(summary["cloudflareFreeOverSizeLimit"], 1)
        self.assertEqual(summary["unknownSizes"], 1)
        self.assertEqual(summary["failed"], 1)

    def test_strict_requirements_fail_closed(self):
        target = {
            "error": "",
            "rangeSupported": True,
            "cacheHitObserved": False,
        }

        self.assertTrue(audit.meets_requirements(target, require_range=True))
        self.assertFalse(audit.meets_requirements(target, require_cache_hit=True))


if __name__ == "__main__":
    unittest.main()

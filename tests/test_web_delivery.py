from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import threading
import unittest


ROOT = Path(__file__).resolve().parents[1]


class DeliveryHandler(BaseHTTPRequestHandler):
    html_cache = "no-store"
    asset_cache = "public, max-age=14400"
    encoding = "br"

    def do_GET(self) -> None:
        body = b'<link rel="stylesheet" href="/assets/index-abcdefgh.css"><script src="/assets/index-abcdefgh.js"></script>'
        self.send_response(200)
        self.send_header("Cache-Control", self.html_cache)
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self) -> None:
        self.send_response(200)
        self.send_header("Cache-Control", self.asset_cache)
        if self.encoding:
            self.send_header("Content-Encoding", self.encoding)
        self.end_headers()

    def log_message(self, *_args) -> None:
        pass


class WebDeliveryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), DeliveryHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()

    def run_check(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["python3", "scripts/check_web_delivery.py", "--base-url", self.url],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )

    def tearDown(self) -> None:
        DeliveryHandler.html_cache = "no-store"
        DeliveryHandler.asset_cache = "public, max-age=14400"
        DeliveryHandler.encoding = "br"

    def test_accepts_no_store_cached_compressed_assets(self) -> None:
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("cache=14400s encoding=br", result.stdout)

    def test_rejects_cached_html(self) -> None:
        DeliveryHandler.html_cache = "public, max-age=3600"
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("HTML must use no-store", result.stderr)

    def test_rejects_uncompressed_assets(self) -> None:
        DeliveryHandler.encoding = ""
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Asset compression is missing", result.stderr)


if __name__ == "__main__":
    unittest.main()

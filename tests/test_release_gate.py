import http.cookiejar
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

import auth_api  # noqa: E402


class QuietHandler(auth_api.Handler):
    def log_message(self, fmt: str, *args) -> None:
        return None


class ApiClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def get(self, path: str) -> tuple[int, dict]:
        return self.request("GET", path)

    def post(self, path: str, payload: dict | None = None) -> tuple[int, dict]:
        return self.request("POST", path, payload or {})

    def request(self, method: str, path: str, payload: dict | None = None) -> tuple[int, dict]:
        data = None
        headers = {}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base_url + path, data=data, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=5) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8")
            return error.code, json.loads(body) if body else {}


class AuthApiReleaseGateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.httpd.shutdown()
        cls.thread.join(timeout=5)
        cls.httpd.server_close()

    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        auth_api.DB_PATH = Path(self.tempdir.name) / "app.db"
        auth_api.SESSION_SECRET = "release-gate-test-secret"
        auth_api.SESSION_TTL = 3600
        auth_api.SUPER_ADMIN_EMAIL = "admin@example.test"
        auth_api.SUPER_ADMIN_PASSWORD = "admin-password"
        auth_api.SIGNALS_API_TOKEN = "signals-token"
        auth_api.init_db()

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def client(self) -> ApiClient:
        return ApiClient(self.base_url)

    def login(self, email: str, password: str) -> ApiClient:
        client = self.client()
        status, payload = client.post("/api/auth/login", {"email": email, "password": password})
        self.assertEqual(status, 200, payload)
        self.assertTrue(payload["authenticated"])
        return client

    def create_user(
        self,
        admin: ApiClient,
        email: str,
        plan: str,
        password: str = "user-password",
        role: str = "user",
        expires_at: str = "",
    ) -> dict:
        status, payload = admin.post(
            "/api/admin/users/create",
            {
                "email": email,
                "password": password,
                "role": role,
                "plan": plan,
                "subscriptionExpiresAt": expires_at,
                "isActive": True,
            },
        )
        self.assertEqual(status, 201, payload)
        return payload["user"]

    def test_health_and_anonymous_user_are_limited(self) -> None:
        client = self.client()

        status, payload = client.get("/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])

        status, payload = client.get("/api/auth/status")
        self.assertEqual(status, 200)
        self.assertFalse(payload["authenticated"])
        self.assertFalse(payload["entitlements"]["paid"])

        status, payload = client.get("/api/pro/trade-records")
        self.assertEqual(status, 401)
        self.assertEqual(payload["code"], "unauthenticated")

    def test_static_frontend_shell_is_served(self) -> None:
        with urllib.request.urlopen(self.base_url + "/", timeout=5) as response:
            body = response.read().decode("utf-8")
        self.assertEqual(response.status, 200)
        self.assertIn("美股策略库", body)
        self.assertIn('data-page-link="earnings"', body)
        self.assertIn('data-page-link="options"', body)

        with urllib.request.urlopen(self.base_url + "/data/earnings-quality.json", timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
        self.assertEqual(response.status, 200)
        quality_rows = payload["boards"]["quality"]["rows"]
        self.assertGreaterEqual(payload["summary"]["coreCount"], 1)
        self.assertGreaterEqual(len(quality_rows), 1)
        row_tickers = {row["ticker"] for row in quality_rows if row.get("ticker")}
        self.assertIn(payload["summary"]["coreLeader"], row_tickers)

        with urllib.request.urlopen(self.base_url + "/data/options-flow-snapshot.json", timeout=5) as response:
            options_payload = json.loads(response.read().decode("utf-8"))
        self.assertEqual(response.status, 200)
        self.assertTrue(options_payload["asOf"])
        self.assertTrue(options_payload["meta"]["symbol"])
        self.assertGreaterEqual(len(options_payload["timeline"]), 1)
        self.assertGreaterEqual(len(options_payload["bullish"]), 1)
        self.assertGreaterEqual(len(options_payload["bearish"]), 1)
        self.assertEqual(options_payload["quality"]["directionality"], "unknown")

    def test_free_and_paid_users_receive_different_access(self) -> None:
        admin = self.login("admin@example.test", "admin-password")
        self.create_user(admin, "free@example.test", "free")
        self.create_user(admin, "paid@example.test", "paid")

        free = self.login("free@example.test", "user-password")
        status, payload = free.get("/api/auth/status")
        self.assertEqual(status, 200)
        self.assertEqual(payload["user"]["plan"], "free")
        self.assertFalse(payload["entitlements"]["paid"])
        status, payload = free.get("/api/pro/trade-records")
        self.assertEqual(status, 403)
        self.assertEqual(payload["code"], "upgrade_required")

        paid = self.login("paid@example.test", "user-password")
        status, payload = paid.get("/api/auth/status")
        self.assertEqual(status, 200)
        self.assertEqual(payload["user"]["plan"], "paid")
        self.assertTrue(payload["entitlements"]["paid"])
        status, payload = paid.get("/api/pro/trade-records")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(len(payload["records"]), 1)

    def test_expired_paid_user_is_blocked_from_paid_content(self) -> None:
        admin = self.login("admin@example.test", "admin-password")
        created = self.create_user(admin, "expired@example.test", "paid", expires_at="2000-01-01")
        self.assertEqual(created["plan"], "paid")
        self.assertEqual(created["subscriptionStatus"], "expired")
        self.assertFalse(created["hasPaidAccess"])

        expired = self.login("expired@example.test", "user-password")
        status, payload = expired.get("/api/auth/status")
        self.assertEqual(status, 200)
        self.assertEqual(payload["user"]["plan"], "free")
        self.assertFalse(payload["entitlements"]["paid"])

        status, payload = expired.get("/api/pro/trade-records")
        self.assertEqual(status, 403)
        self.assertEqual(payload["code"], "upgrade_required")

    def test_admin_user_creation_and_summary_track_paid_access(self) -> None:
        admin = self.login("admin@example.test", "admin-password")
        self.create_user(admin, "free@example.test", "free")
        self.create_user(admin, "paid@example.test", "paid")
        self.create_user(admin, "expired@example.test", "paid", expires_at="2000-01-01")

        status, payload = admin.get("/api/admin/users")
        self.assertEqual(status, 200)
        self.assertEqual(payload["summary"]["total"], 4)
        self.assertEqual(payload["summary"]["paid"], 2)

        users_by_email = {item["email"]: item for item in payload["users"]}
        self.assertFalse(users_by_email["free@example.test"]["hasPaidAccess"])
        self.assertTrue(users_by_email["paid@example.test"]["hasPaidAccess"])
        self.assertFalse(users_by_email["expired@example.test"]["hasPaidAccess"])


if __name__ == "__main__":
    unittest.main()

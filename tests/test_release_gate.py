import http.cookiejar
import json
import sqlite3
import subprocess
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
        auth_api.PRODUCT_DB_ENV = None
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
        self.assertIn("懂币猫", body)
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

    def test_market_data_expansion_shape_is_present(self) -> None:
        ytd = json.loads((ROOT / "data" / "ytd-gainers.json").read_text(encoding="utf-8"))
        movers = json.loads((ROOT / "data" / "market-movers.json").read_text(encoding="utf-8"))
        sector_flow = json.loads((ROOT / "data" / "sector-flow.json").read_text(encoding="utf-8"))

        self.assertGreaterEqual(ytd.get("universeCount", 0), 800)
        self.assertGreaterEqual(len(ytd.get("rows", [])), 800)
        self.assertGreaterEqual(movers.get("universeCount", 0), 800)
        for board in ("day", "week", "month", "volume"):
            self.assertIn(board, movers["boards"])
            self.assertGreaterEqual(len(movers["boards"][board].get("rows", [])), 800)

        sample = movers["boards"]["volume"]["rows"][0]
        for field in ("rank", "symbol", "company", "sector", "risk", "change", "volume", "volumeRatio", "marketCap"):
            self.assertIn(field, sample)

        self.assertGreaterEqual(sector_flow.get("universeCount", 0), 800)
        self.assertIn("tradable universe", sector_flow.get("source", ""))
        self.assertIn("fallbackReason", sector_flow)
        self.assertGreaterEqual(len(sector_flow.get("rows", [])), 8)

    def test_product_database_builder_shape_is_present(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            db_path = Path(tempdir) / "product.db"
            subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "build_product_db.py"), "--output", str(db_path)],
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertTrue(db_path.exists())
            with sqlite3.connect(db_path) as conn:
                counts = {
                    table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                    for table in (
                        "symbols",
                        "market_board_rows",
                        "sector_flow_rows",
                        "stock_event_rows",
                        "calendar_events",
                        "earnings_quality_rows",
                        "strength_rows",
                    )
                }
                self.assertGreaterEqual(counts["symbols"], 800)
                self.assertGreaterEqual(counts["market_board_rows"], 800)
                self.assertGreaterEqual(counts["sector_flow_rows"], 8)
                self.assertGreaterEqual(counts["stock_event_rows"], 100)
                self.assertGreaterEqual(counts["calendar_events"], 1)
                self.assertGreaterEqual(counts["earnings_quality_rows"], 100)
                self.assertGreaterEqual(counts["strength_rows"], 50)
                schema_version = conn.execute(
                    "SELECT value FROM product_db_info WHERE key = 'schema_version'"
                ).fetchone()
                self.assertIsNotNone(schema_version)
                sample = conn.execute(
                    """
                    SELECT symbol, sector, market_cap_value
                    FROM symbols
                    WHERE symbol = 'MU'
                    """
                ).fetchone()
                self.assertIsNotNone(sample)
                self.assertTrue(sample[0])

    def test_product_database_api_serves_core_workbench_data(self) -> None:
        db_path = Path(self.tempdir.name) / "product.db"
        subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "build_product_db.py"), "--output", str(db_path)],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        auth_api.PRODUCT_DB_ENV = str(db_path)
        client = self.client()

        status, payload = client.get("/api/product/health")
        self.assertEqual(status, 200, payload)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["schemaVersion"], "1")
        self.assertGreaterEqual(payload["counts"]["market_board_rows"], 800)

        status, payload = client.get("/api/product/symbols?query=MU&limit=5")
        self.assertEqual(status, 200, payload)
        self.assertGreaterEqual(len(payload["rows"]), 1)
        self.assertEqual(payload["rows"][0]["symbol"], "MU")

        status, payload = client.get("/api/product/symbols/MU")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["profile"]["symbol"], "MU")
        self.assertEqual(payload["profile"]["sector"], "科技")
        self.assertGreaterEqual(len(payload["marketRows"]), 1)
        self.assertIn("peers", payload)

        status, payload = client.get("/api/product/sectors?limit=5")
        self.assertEqual(status, 200, payload)
        self.assertGreaterEqual(len(payload["rows"]), 5)
        self.assertIn("netFlowProxy", payload["rows"][0])

        status, payload = client.get("/api/product/calendar")
        self.assertEqual(status, 200, payload)
        self.assertGreaterEqual(len(payload["rows"]), 1)
        self.assertIn("title", payload["rows"][0])

        status, payload = client.get("/api/product/market?board=day&limit=3")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["board"], "day")
        self.assertEqual(len(payload["rows"]), 3)

    def test_frontend_routes_keep_inactive_pages_hidden(self) -> None:
        styles = (ROOT / "styles.css").read_text(encoding="utf-8")
        app = (ROOT / "app.js").read_text(encoding="utf-8")

        self.assertIn(".page-view:not(.is-active)", styles)
        self.assertIn("display: none !important", styles)
        self.assertIn(".page-view.is-active.evidence-workspace", styles)
        self.assertNotIn("\n.evidence-workspace {\n  display: grid;", styles)
        self.assertIn("view.hidden = !active", app)

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

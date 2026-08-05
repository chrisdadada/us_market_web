import http.cookiejar
import base64
import json
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import date, timedelta
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch


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

    def delete(self, path: str) -> tuple[int, dict]:
        return self.request("DELETE", path)

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
        auth_api.UPLOAD_ROOT = Path(self.tempdir.name) / "uploads"
        auth_api.COURSE_COS_SECRET_ID = ""
        auth_api.COURSE_COS_SECRET_KEY = ""
        auth_api.COURSE_COS_BUCKET = ""
        auth_api.COURSE_COS_REGION = ""
        auth_api.COURSE_COS_DOMAIN = ""
        auth_api.COURSE_VIDEO_AUTO_PROCESS_ENABLED = False
        auth_api.COURSE_VIDEO_PROCESS_TIMEOUT_SECONDS = 21600
        auth_api.reset_course_play_observation()
        auth_api.init_db()

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def client(self) -> ApiClient:
        return ApiClient(self.base_url)

    def use_empty_product_db(self) -> Path:
        db_path = Path(self.tempdir.name) / "product.db"
        with sqlite3.connect(db_path) as conn:
            conn.execute(
                """
                CREATE TABLE market_opinion_items (
                  item_id TEXT PRIMARY KEY,
                  section TEXT NOT NULL,
                  section_label TEXT NOT NULL,
                  title TEXT NOT NULL,
                  trade_date TEXT NOT NULL,
                  summary TEXT,
                  symbols_json TEXT NOT NULL,
                  topics_json TEXT NOT NULL,
                  highlights_json TEXT NOT NULL,
                  body TEXT NOT NULL,
                  payload_json TEXT NOT NULL
                )
                """
            )
        auth_api.PRODUCT_DB_ENV = str(db_path)
        return db_path

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
        public = self.client()
        status, payload = public.post("/api/auth/register", {"email": email, "password": password})
        self.assertEqual(status, 201, payload)
        user = payload["user"]
        if role != "user" or plan != "free" or expires_at:
            status, payload = admin.post(
                "/api/admin/users/update-plan",
                {
                    "userId": user["id"],
                    "role": role,
                    "plan": plan,
                    "subscriptionExpiresAt": expires_at,
                    "isActive": True,
                },
            )
            self.assertEqual(status, 200, payload)
            user = payload["user"]
        return user

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

    def test_public_registration_creates_free_logged_in_user(self) -> None:
        client = self.client()
        status, payload = client.post(
            "/api/auth/register",
            {"email": "new-user@example.test", "password": "user-password"},
        )
        self.assertEqual(status, 201, payload)
        self.assertTrue(payload["authenticated"])
        self.assertEqual(payload["user"]["email"], "new-user@example.test")
        self.assertRegex(payload["user"]["uid"], r"^DBM-[A-F0-9]{10}$")
        self.assertNotEqual(payload["user"]["uid"], str(payload["user"]["id"]))
        self.assertEqual(payload["user"]["plan"], "free")
        self.assertFalse(payload["entitlements"]["paid"])

        status, payload = client.get("/api/auth/status")
        self.assertEqual(status, 200, payload)
        self.assertTrue(payload["authenticated"])
        self.assertEqual(payload["user"]["email"], "new-user@example.test")

        duplicate = self.client()
        status, payload = duplicate.post(
            "/api/auth/register",
            {"email": "new-user@example.test", "password": "user-password"},
        )
        self.assertEqual(status, 409, payload)

    def test_public_registration_validates_email_and_password(self) -> None:
        client = self.client()

        status, payload = client.post(
            "/api/auth/register",
            {"email": "bad-email", "password": "user-password"},
        )
        self.assertEqual(status, 400, payload)
        self.assertEqual(payload["error"], "邮箱格式不正确")

        status, payload = client.post(
            "/api/auth/register",
            {"email": "weak-password@example.test", "password": "short"},
        )
        self.assertEqual(status, 400, payload)
        self.assertEqual(payload["error"], "密码至少 8 位")

        status, payload = client.post(
            "/api/auth/register",
            {"email": "too-long-password@example.test", "password": "x" * 129},
        )
        self.assertEqual(status, 400, payload)
        self.assertEqual(payload["error"], "密码不能超过 128 位")

    def test_public_registration_is_rate_limited(self) -> None:
        old_ip_limit = auth_api.REGISTER_IP_LIMIT
        old_email_limit = auth_api.REGISTER_EMAIL_LIMIT
        old_email_window = auth_api.REGISTER_EMAIL_WINDOW_SECONDS
        try:
            auth_api.REGISTER_IP_LIMIT = 0
            auth_api.REGISTER_EMAIL_LIMIT = 2
            auth_api.REGISTER_EMAIL_WINDOW_SECONDS = 60
            auth_api.reset_register_rate_limits()

            first = self.client()
            status, payload = first.post(
                "/api/auth/register",
                {"email": "limited@example.test", "password": "user-password"},
            )
            self.assertEqual(status, 201, payload)

            duplicate = self.client()
            status, payload = duplicate.post(
                "/api/auth/register",
                {"email": "limited@example.test", "password": "user-password"},
            )
            self.assertEqual(status, 409, payload)

            blocked = self.client()
            status, payload = blocked.post(
                "/api/auth/register",
                {"email": "limited@example.test", "password": "user-password"},
            )
            self.assertEqual(status, 429, payload)
            self.assertEqual(payload["code"], "rate_limited")
            self.assertGreaterEqual(payload["retryAfter"], 1)
        finally:
            auth_api.REGISTER_IP_LIMIT = old_ip_limit
            auth_api.REGISTER_EMAIL_LIMIT = old_email_limit
            auth_api.REGISTER_EMAIL_WINDOW_SECONDS = old_email_window
            auth_api.reset_register_rate_limits()

    def test_login_failures_are_rate_limited(self) -> None:
        old_ip_limit = auth_api.LOGIN_FAIL_IP_LIMIT
        old_email_limit = auth_api.LOGIN_FAIL_EMAIL_LIMIT
        old_window = auth_api.LOGIN_FAIL_WINDOW_SECONDS
        try:
            auth_api.LOGIN_FAIL_IP_LIMIT = 0
            auth_api.LOGIN_FAIL_EMAIL_LIMIT = 2
            auth_api.LOGIN_FAIL_WINDOW_SECONDS = 60
            auth_api.reset_register_rate_limits()

            client = self.client()
            status, payload = client.post(
                "/api/auth/register",
                {"email": "login-limit@example.test", "password": "user-password"},
            )
            self.assertEqual(status, 201, payload)

            for _ in range(2):
                status, payload = self.client().post(
                    "/api/auth/login",
                    {"email": "login-limit@example.test", "password": "wrong-password"},
                )
                self.assertEqual(status, 401, payload)

            status, payload = self.client().post(
                "/api/auth/login",
                {"email": "login-limit@example.test", "password": "wrong-password"},
            )
            self.assertEqual(status, 429, payload)
            self.assertEqual(payload["code"], "rate_limited")
            self.assertGreaterEqual(payload["retryAfter"], 1)
        finally:
            auth_api.LOGIN_FAIL_IP_LIMIT = old_ip_limit
            auth_api.LOGIN_FAIL_EMAIL_LIMIT = old_email_limit
            auth_api.LOGIN_FAIL_WINDOW_SECONDS = old_window
            auth_api.reset_register_rate_limits()

    def test_static_frontend_shell_is_served(self) -> None:
        with urllib.request.urlopen(self.base_url + "/", timeout=5) as response:
            body = response.read().decode("utf-8")
        self.assertEqual(response.status, 200)
        self.assertIn("懂币猫", body)
        self.assertIn('data-page-link="earnings"', body)
        self.assertIn('data-page-link="options"', body)

        with self.assertRaises(urllib.error.HTTPError) as static_json:
            urllib.request.urlopen(self.base_url + "/data/earnings-quality.json", timeout=5)
        self.assertEqual(static_json.exception.code, 404)

    def test_legacy_api_data_reads_product_db_raw_payloads(self) -> None:
        db_path = Path(self.tempdir.name) / "product.db"
        with sqlite3.connect(db_path) as conn:
            conn.execute(
                """
                CREATE TABLE raw_payloads (
                  name TEXT PRIMARY KEY,
                  source_path TEXT NOT NULL,
                  payload_json TEXT NOT NULL
                )
                """
            )
            rows = [
                ("market-temperature", {"source": "product-db"}),
                ("macro-series", {"indicators": [{"key": "vix"}]}),
                ("strength-scanner", {"rows": [{"symbol": "MU"}]}),
                ("crypto-etf-flows", {"assets": {"BTC": {}, "ETH": {}}}),
            ]
            conn.executemany(
                "INSERT INTO raw_payloads (name, source_path, payload_json) VALUES (?, ?, ?)",
                [(name, "db-test", json.dumps(payload, ensure_ascii=False)) for name, payload in rows],
            )
        auth_api.PRODUCT_DB_ENV = str(db_path)

        anonymous = self.client()
        status, payload = anonymous.get("/api/data/market-temperature")
        self.assertEqual(status, 401, payload)
        self.assertEqual(payload["code"], "unauthenticated")

        free = self.client()
        status, payload = free.post(
            "/api/auth/register",
            {"email": "market-data-free@example.test", "password": "user-password"},
        )
        self.assertEqual(status, 201, payload)
        status, payload = free.get("/api/data/market-temperature")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["source"], "product-db")
        status, payload = free.get("/api/product/raw/macro-series")
        self.assertEqual(status, 200, payload)
        status, payload = free.get("/api/product/raw/strength-scanner")
        self.assertEqual(status, 403, payload)
        self.assertEqual(payload["code"], "membership_required")
        status, payload = free.get("/api/product/raw/crypto-etf-flows")
        self.assertEqual(status, 403, payload)
        self.assertEqual(payload["code"], "membership_required")

        admin = self.login("admin@example.test", "admin-password")
        expires_at = (date.today() + timedelta(days=30)).isoformat()
        self.create_user(admin, "market-data-monthly@example.test", "monthly", expires_at=expires_at)
        monthly = self.login("market-data-monthly@example.test", "user-password")
        status, payload = monthly.get("/api/product/raw/strength-scanner")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["rows"][0]["symbol"], "MU")
        status, payload = monthly.get("/api/product/raw/crypto-etf-flows")
        self.assertEqual(status, 200, payload)
        self.assertIn("BTC", payload["assets"])

    def test_product_calendar_supports_db_pagination_and_filters(self) -> None:
        db_path = Path(self.tempdir.name) / "product.db"
        today = date.today()
        events = [
            ("macro-cpi", today.isoformat(), "08:30", "CPI 数据", "macro", "high", "BLS", ["SPY"], "通胀"),
            ("earnings-a", (today + timedelta(days=1)).isoformat(), "06:00", "AAPL 财报", "earnings", "medium", "FMP", ["AAPL"], "财报"),
            ("earnings-b", (today + timedelta(days=2)).isoformat(), "07:00", "AMD 财报", "earnings", "low", "FMP", ["AMD"], "财报"),
        ]
        with sqlite3.connect(db_path) as conn:
            conn.execute(
                """
                CREATE TABLE calendar_events (
                  event_id TEXT PRIMARY KEY,
                  event_date TEXT,
                  event_time TEXT,
                  title TEXT NOT NULL,
                  event_type TEXT,
                  impact TEXT,
                  source_name TEXT,
                  actual_value REAL,
                  actual_label TEXT,
                  forecast_value REAL,
                  forecast_label TEXT,
                  previous_value REAL,
                  previous_label TEXT,
                  result_updated_at TEXT,
                  related_modules_json TEXT NOT NULL,
                  related_assets_json TEXT NOT NULL,
                  summary TEXT,
                  payload_json TEXT NOT NULL
                )
                """
            )
            for event in events:
                conn.execute(
                    """
                    INSERT INTO calendar_events
                    (event_id, event_date, event_time, title, event_type, impact, source_name,
                     related_modules_json, related_assets_json, summary, payload_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, '{}')
                    """,
                    (*event[:7], json.dumps(event[7], ensure_ascii=False), event[8]),
                )
        auth_api.PRODUCT_DB_ENV = str(db_path)

        status, payload = self.client().get("/api/product/calendar?limit=1&offset=1&windowDays=7")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["total"], 3)
        self.assertEqual(payload["limit"], 1)
        self.assertEqual(payload["offset"], 1)
        self.assertEqual(len(payload["rows"]), 1)

        status, payload = self.client().get("/api/product/calendar?type=earnings&impact=low&q=AMD&windowDays=7")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["rows"][0]["title"], "AMD 财报")

    def test_market_data_expansion_shape_is_present(self) -> None:
        with sqlite3.connect(ROOT / "data" / "product.db") as conn:
            for board in ("ytd", "day", "week", "month", "volume"):
                count = conn.execute(
                    "SELECT COUNT(*) FROM market_board_rows WHERE board = ?",
                    (board,),
                ).fetchone()[0]
                self.assertGreaterEqual(count, 800)

            sample = conn.execute(
                """
                SELECT rank, symbol, company, sector, risk, change_pct,
                       volume_label, volume_ratio, market_cap_value
                FROM market_board_rows
                WHERE board = 'volume'
                LIMIT 1
                """
            ).fetchone()
            self.assertIsNotNone(sample)
            for index in (0, 1, 2, 4, 5, 6, 7):
                self.assertIsNotNone(sample[index])

            sector_count = conn.execute("SELECT COUNT(*) FROM sector_flow_rows").fetchone()[0]
            self.assertGreaterEqual(sector_count, 8)

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
                earnings_payload = json.loads(
                    conn.execute(
                        "SELECT payload_json FROM datasets WHERE name = ?",
                        ("earnings-quality",),
                    ).fetchone()[0]
                )
                earnings_source_rows = {
                    (board, (row.get("ticker") or row.get("symbol") or "").strip().upper())
                    for board, board_payload in (earnings_payload.get("boards") or {}).items()
                    for row in ((board_payload or {}).get("rows") or [])
                    if (row.get("ticker") or row.get("symbol") or "").strip()
                }
                self.assertGreater(len(earnings_source_rows), 0)
                self.assertEqual(counts["earnings_quality_rows"], len(earnings_source_rows))
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
            coverage = subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "check_product_coverage.py"), "--db", str(db_path), "--json"],
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            coverage_payload = json.loads(coverage.stdout)
            self.assertTrue(coverage_payload["ok"])
            self.assertGreaterEqual(coverage_payload["symbols"]["total"], 800)

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

        status, payload = client.get("/api/product/coverage")
        self.assertEqual(status, 200, payload)
        self.assertTrue(payload["ok"])
        self.assertGreaterEqual(payload["symbols"]["total"], 800)
        self.assertIn("marketBoards", payload)
        self.assertIn("calendar", payload)
        self.assertIn("options", payload)

        status, payload = client.get("/api/product/symbols?query=MU&limit=5")
        self.assertEqual(status, 200, payload)
        self.assertGreaterEqual(len(payload["rows"]), 1)
        self.assertEqual(payload["rows"][0]["symbol"], "MU")
        self.assertNotIn("strengthScore", payload["rows"][0])

        status, payload = client.get("/api/product/symbols?preset=strength&limit=5")
        self.assertEqual(status, 403, payload)
        self.assertEqual(payload["code"], "membership_required")

        status, payload = client.get("/api/product/symbols?limit=3000")
        self.assertEqual(status, 200, payload)
        self.assertGreater(len(payload["rows"]), 100)

        status, payload = client.get("/api/product/symbols/MU")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["profile"]["symbol"], "MU")
        self.assertEqual(payload["profile"]["sector"], "科技")
        self.assertGreaterEqual(len(payload["marketRows"]), 1)
        self.assertIn("peers", payload)
        self.assertIsNone(payload["strength"])

        status, payload = client.get("/api/product/sectors?limit=5")
        self.assertEqual(status, 200, payload)
        self.assertGreaterEqual(len(payload["rows"]), 5)
        self.assertGreaterEqual(payload["total"], len(payload["rows"]))
        self.assertEqual(payload["limit"], 5)
        self.assertEqual(payload["offset"], 0)
        self.assertIn("netFlowProxy", payload["rows"][0])

        status, payload = client.get("/api/product/calendar")
        self.assertEqual(status, 200, payload)
        self.assertGreaterEqual(len(payload["rows"]), 1)
        self.assertIn("title", payload["rows"][0])

        status, payload = client.get("/api/product/market?board=day&limit=3")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["board"], "day")
        self.assertEqual(len(payload["rows"]), 3)
        self.assertGreaterEqual(payload["total"], 3)
        self.assertEqual(payload["limit"], 3)
        self.assertEqual(payload["offset"], 0)

        status, second_page = client.get("/api/product/market?board=day&limit=3&offset=3")
        self.assertEqual(status, 200, second_page)
        self.assertEqual(second_page["board"], "day")
        self.assertEqual(second_page["offset"], 3)
        self.assertEqual(len(second_page["rows"]), 3)
        self.assertNotEqual(payload["rows"][0]["symbol"], second_page["rows"][0]["symbol"])

        status, payload = client.get("/api/product/bootstrap")
        self.assertEqual(status, 200, payload)
        self.assertIn("ytd", payload)
        self.assertIn("movers", payload)
        self.assertIn("core", payload)
        self.assertGreater(len(payload["ytd"]["rows"]), 100)
        self.assertGreaterEqual(len(payload["movers"]["boards"]["day"]["rows"]), 3)
        self.assertIsNone(payload["marketTemperature"])
        self.assertIsNone(payload["strength"])

        status, payload = client.get("/api/product/raw/macro-series")
        self.assertEqual(status, 401, payload)

        status, payload = client.post(
            "/api/auth/register",
            {"email": "product-api-free@example.test", "password": "user-password"},
        )
        self.assertEqual(status, 201, payload)
        status, payload = client.get("/api/product/bootstrap")
        self.assertEqual(status, 200, payload)
        self.assertIsNotNone(payload["marketTemperature"])
        self.assertIsNone(payload["strength"])

        status, payload = client.get("/api/product/raw/macro-series")
        self.assertEqual(status, 200, payload)
        self.assertIn("indicators", payload)

        status, payload = client.get("/api/product/raw/strength-scanner")
        self.assertEqual(status, 403, payload)
        self.assertEqual(payload["code"], "membership_required")

        status, payload = client.get("/api/product/raw/earnings-quality")
        self.assertEqual(status, 200, payload)
        quality_rows = payload["boards"]["quality"]["rows"]
        self.assertGreaterEqual(payload["summary"]["coreCount"], 1)
        self.assertGreaterEqual(len(quality_rows), 1)
        row_tickers = {row["ticker"] for row in quality_rows if row.get("ticker")}
        self.assertIn(payload["summary"]["coreLeader"], row_tickers)

        status, payload = client.get("/api/product/raw/options-flow-snapshot")
        self.assertEqual(status, 200, payload)
        self.assertTrue(payload["asOf"])
        self.assertTrue(payload["meta"]["symbol"])
        self.assertGreaterEqual(len(payload["timeline"]), 1)
        self.assertGreaterEqual(len(payload["bullish"]), 1)
        self.assertGreaterEqual(len(payload["bearish"]), 1)
        self.assertEqual(payload["quality"]["directionality"], "unknown")

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
        self.assertEqual(payload["code"], "yearly_required")

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
        self.assertEqual(payload["code"], "yearly_required")

    def test_admin_user_creation_and_summary_track_paid_access(self) -> None:
        admin = self.login("admin@example.test", "admin-password")
        self.create_user(admin, "free@example.test", "free")
        self.create_user(admin, "paid@example.test", "paid")
        self.create_user(admin, "expired@example.test", "paid", expires_at="2000-01-01")

        status, payload = admin.get("/api/admin/users")
        self.assertEqual(status, 200)
        self.assertEqual(payload["summary"]["total"], 3)
        self.assertEqual(payload["summary"]["paid"], 1)
        self.assertEqual(payload["summary"]["admin"], 1)

        users_by_email = {item["email"]: item for item in payload["users"]}
        self.assertFalse(users_by_email["admin@example.test"]["hasPaidAccess"])
        self.assertRegex(users_by_email["paid@example.test"]["uid"], r"^DBM-[A-F0-9]{10}$")
        self.assertEqual(users_by_email["admin@example.test"]["plan"], "free")
        self.assertFalse(users_by_email["free@example.test"]["hasPaidAccess"])
        self.assertTrue(users_by_email["paid@example.test"]["hasPaidAccess"])
        self.assertFalse(users_by_email["expired@example.test"]["hasPaidAccess"])

    def test_admin_metrics_exclude_admin_activity(self) -> None:
        admin = self.login("admin@example.test", "admin-password")
        self.create_user(admin, "normal@example.test", "free")
        self.create_user(admin, "quiet@example.test", "free")
        user = self.login("normal@example.test", "user-password")
        self.login("quiet@example.test", "user-password")

        status, payload = admin.post("/api/analytics/event", {"eventType": "nav_click", "eventKey": "stocks", "path": "/?page=stocks"})
        self.assertEqual(status, 201, payload)
        status, payload = user.post("/api/analytics/event", {"eventType": "nav_click", "eventKey": "stocks", "path": "/?page=stocks"})
        self.assertEqual(status, 201, payload)

        status, payload = admin.get("/api/admin/metrics")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["users"]["total"], 2)
        self.assertEqual(payload["active"]["d3"], 1)
        self.assertEqual(payload["active"]["d7"], 1)
        self.assertEqual(payload["active"]["d30"], 1)
        self.assertEqual(payload["navClicks"], [{"page": "stocks", "clicks": 1, "users": 1}])

    def test_admin_metrics_retention_uses_beijing_day(self) -> None:
        admin = self.login("admin@example.test", "admin-password")
        user = self.create_user(admin, "beijing-day@example.test", "free")
        with sqlite3.connect(auth_api.DB_PATH) as conn:
            conn.execute("UPDATE users SET created_at = ? WHERE id = ?", ("2026-07-08T23:30:00+00:00", user["id"]))
            conn.execute(
                "INSERT INTO analytics_events (user_id, event_type, event_key, path, created_at) VALUES (?, 'nav_click', 'home', '/', ?)",
                (user["id"], "2026-07-08T23:45:00+00:00"),
            )

        status, payload = admin.get("/api/admin/metrics")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["retention"][0]["cohortDay"], "2026-07-09")
        self.assertEqual(payload["retention"][0]["registered"], 1)
        self.assertEqual(payload["retention"][0]["retained3d"], 1)

    def test_monthly_and_yearly_users_keep_paid_access(self) -> None:
        admin = self.login("admin@example.test", "admin-password")
        self.create_user(admin, "monthly@example.test", "monthly")
        self.create_user(admin, "yearly@example.test", "yearly")

        status, payload = admin.get("/api/admin/users")
        self.assertEqual(status, 200)
        users_by_email = {item["email"]: item for item in payload["users"]}
        self.assertEqual(users_by_email["monthly@example.test"]["plan"], "monthly")
        self.assertEqual(users_by_email["yearly@example.test"]["plan"], "yearly")
        self.assertTrue(users_by_email["monthly@example.test"]["hasPaidAccess"])
        self.assertTrue(users_by_email["yearly@example.test"]["hasPaidAccess"])

        monthly = self.login("monthly@example.test", "user-password")
        status, payload = monthly.get("/api/auth/status")
        self.assertEqual(status, 200)
        self.assertEqual(payload["user"]["plan"], "monthly")
        self.assertTrue(payload["entitlements"]["paid"])
        self.assertFalse(payload["entitlements"]["yearly"])
        status, payload = monthly.get("/api/pro/trade-records")
        self.assertEqual(status, 403)
        self.assertEqual(payload["code"], "yearly_required")

        yearly = self.login("yearly@example.test", "user-password")
        status, payload = yearly.get("/api/auth/status")
        self.assertEqual(status, 200)
        self.assertEqual(payload["user"]["plan"], "yearly")
        self.assertTrue(payload["entitlements"]["paid"])
        self.assertTrue(payload["entitlements"]["yearly"])
        status, payload = yearly.get("/api/pro/trade-records")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(len(payload["records"]), 1)

    def test_admins_can_manage_all_regular_users_and_events_are_recorded(self) -> None:
        super_admin = self.login("admin@example.test", "admin-password")
        manager = self.create_user(super_admin, "manager@example.test", "free", role="admin")
        owned = self.create_user(super_admin, "owned@example.test", "free")
        next_super = self.create_user(super_admin, "next-super@example.test", "free")

        public = self.client()
        status, payload = public.post(
            "/api/auth/register",
            {"email": "self-register@example.test", "password": "user-password"},
        )
        self.assertEqual(status, 201, payload)
        self_registered_id = payload["user"]["id"]

        manager_client = self.login("manager@example.test", "user-password")
        status, payload = manager_client.get("/api/admin/users")
        self.assertEqual(status, 200, payload)
        visible = {item["email"] for item in payload["users"]}
        self.assertIn("manager@example.test", visible)
        self.assertIn("owned@example.test", visible)
        self.assertIn("self-register@example.test", visible)

        public = self.client()
        status, payload = public.post(
            "/api/auth/register",
            {"email": "manager-owned@example.test", "password": "user-password"},
        )
        self.assertEqual(status, 201, payload)
        created_by_manager = payload["user"]
        status, payload = manager_client.post(
            "/api/admin/users/update-plan",
            {
                "userId": created_by_manager["id"],
                "role": "user",
                "plan": "yearly",
                "subscriptionExpiresAt": "2027-01-01",
                "isActive": True,
            },
        )
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["user"]["plan"], "yearly")

        status, payload = manager_client.get(f"/api/admin/user-events?userId={created_by_manager['id']}")
        self.assertEqual(status, 200, payload)
        actions = [item["action"] for item in payload["rows"]]
        self.assertIn("self_register", actions)
        self.assertIn("update_user", actions)
        update_event = next(item for item in payload["rows"] if item["action"] == "update_user")
        self.assertEqual(update_event["actor"]["email"], "manager@example.test")
        self.assertEqual(update_event["before"]["plan"], "free")
        self.assertEqual(update_event["after"]["plan"], "yearly")

        status, payload = manager_client.post(
            "/api/admin/users/update-plan",
            {
                "userId": self_registered_id,
                "role": "user",
                "plan": "monthly",
                "subscriptionExpiresAt": "",
                "isActive": True,
            },
        )
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["user"]["plan"], "monthly")

        status, payload = manager_client.post(
            "/api/admin/users/update-plan",
            {
                "userId": self_registered_id,
                "role": "super_admin",
                "plan": "free",
                "subscriptionExpiresAt": "",
                "isActive": True,
            },
        )
        self.assertEqual(status, 403, payload)

        status, payload = manager_client.post(
            "/api/admin/users/update-plan",
            {
                "userId": manager["id"],
                "role": "admin",
                "plan": "yearly",
                "subscriptionExpiresAt": "",
                "isActive": True,
            },
        )
        self.assertEqual(status, 403, payload)

        status, payload = super_admin.post(
            "/api/admin/users/update-plan",
            {
                "userId": owned["id"],
                "role": "admin",
                "plan": "yearly",
                "subscriptionExpiresAt": "2027-01-01",
                "isActive": True,
            },
        )
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["user"]["role"], "admin")
        self.assertEqual(payload["user"]["plan"], "free")
        self.assertFalse(payload["user"]["hasPaidAccess"])
        self.assertIsNone(payload["user"]["subscriptionExpiresAt"])

        status, payload = super_admin.post(
            "/api/admin/users/update-plan",
            {
                "userId": next_super["id"],
                "role": "super_admin",
                "plan": "yearly",
                "subscriptionExpiresAt": "2027-01-01",
                "isActive": True,
            },
        )
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["user"]["role"], "super_admin")
        self.assertEqual(payload["user"]["plan"], "free")
        self.assertFalse(payload["user"]["hasPaidAccess"])
        self.assertIsNone(payload["user"]["subscriptionExpiresAt"])

    def test_super_admin_account_cannot_be_edited(self) -> None:
        admin = self.login("admin@example.test", "admin-password")
        status, payload = admin.get("/api/admin/users")
        self.assertEqual(status, 200, payload)
        super_admin = next(item for item in payload["users"] if item["role"] == "super_admin")

        status, payload = admin.post(
            "/api/admin/users/update-plan",
            {
                "userId": super_admin["id"],
                "role": "super_admin",
                "plan": "monthly",
                "subscriptionExpiresAt": "2027-01-01",
                "isActive": False,
            },
        )
        self.assertEqual(status, 403, payload)
        self.assertIn("超级管理员", payload["error"])

    def test_regular_admin_cannot_reset_password(self) -> None:
        super_admin = self.login("admin@example.test", "admin-password")
        self.create_user(super_admin, "manager-reset@example.test", "free", role="admin")
        user = self.create_user(super_admin, "reset-denied@example.test", "free")
        manager = self.login("manager-reset@example.test", "user-password")

        status, payload = manager.post(
            "/api/admin/users/reset-password",
            {"userId": user["id"], "password": "new-password"},
        )
        self.assertEqual(status, 403, payload)

    def test_super_admin_can_reset_user_password(self) -> None:
        super_admin = self.login("admin@example.test", "admin-password")
        user = self.create_user(super_admin, "reset-ok@example.test", "free")

        status, payload = super_admin.post(
            "/api/admin/users/reset-password",
            {"userId": user["id"], "password": "new-password"},
        )
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["user"]["id"], user["id"])

        status, payload = self.client().post(
            "/api/auth/login",
            {"email": "reset-ok@example.test", "password": "new-password"},
        )
        self.assertEqual(status, 200, payload)

    def test_regular_admin_cannot_delete_user(self) -> None:
        super_admin = self.login("admin@example.test", "admin-password")
        self.create_user(super_admin, "manager-delete@example.test", "free", role="admin")
        user = self.create_user(super_admin, "delete-denied@example.test", "free")
        manager = self.login("manager-delete@example.test", "user-password")

        status, payload = manager.delete(f"/api/admin/users/{user['id']}")
        self.assertEqual(status, 403, payload)

    def test_super_admin_can_delete_user(self) -> None:
        super_admin = self.login("admin@example.test", "admin-password")
        user = self.create_user(super_admin, "delete-ok@example.test", "free")

        status, payload = super_admin.post(
            "/api/admin/courses",
            {"title": "删除测试课程", "summary": "课程简介", "coverUrl": "", "status": "published"},
        )
        self.assertEqual(status, 201, payload)
        series_id = payload["series"]["id"]
        status, payload = super_admin.post("/api/admin/courses/grants", {"seriesId": series_id, "user": user["email"], "expiresAt": "2027-01-01"})
        self.assertEqual(status, 201, payload)

        status, payload = super_admin.delete(f"/api/admin/users/{user['id']}")
        self.assertEqual(status, 200, payload)

        status, payload = self.client().post(
            "/api/auth/login",
            {"email": "delete-ok@example.test", "password": "user-password"},
        )
        self.assertEqual(status, 401, payload)
        status, payload = super_admin.get("/api/admin/users")
        self.assertEqual(status, 200, payload)
        self.assertFalse(any(item["email"] == "delete-ok@example.test" for item in payload["users"]))
        status, payload = super_admin.get("/api/admin/courses")
        self.assertEqual(status, 200, payload)
        self.assertFalse(any(item["userEmail"] == "delete-ok@example.test" for item in payload["grants"]))

    def test_course_grants_control_frontend_playback(self) -> None:
        admin = self.login("admin@example.test", "admin-password")
        user = self.create_user(admin, "course-user@example.test", "free")
        client = self.login("course-user@example.test", "user-password")

        status, payload = admin.post(
            "/api/admin/courses",
            {"title": "财报季交易框架", "summary": "课程简介", "coverUrl": "", "status": "published"},
        )
        self.assertEqual(status, 201, payload)
        series_id = payload["series"]["id"]
        self.assertEqual(payload["series"]["sortOrder"], 1)

        status, payload = admin.post(
            "/api/admin/courses",
            {"title": "第二套课程", "summary": "课程简介", "coverUrl": "", "status": "published"},
        )
        self.assertEqual(status, 201, payload)
        second_series_id = payload["series"]["id"]
        self.assertEqual(payload["series"]["sortOrder"], 2)

        status, payload = admin.post(
            "/api/admin/courses/lessons",
            {
                "seriesId": series_id,
                "title": "01 课程框架",
                "coverUrl": "https://cdn.example.test/lesson-cover.jpg",
                "videoKey": "https://example.test/video.mp4",
                "status": "published",
            },
        )
        self.assertEqual(status, 201, payload)
        lesson_id = payload["lesson"]["id"]
        self.assertEqual(payload["lesson"]["videoStatus"], "ready")
        with sqlite3.connect(auth_api.DB_PATH) as conn:
            conn.execute("UPDATE course_lessons SET video_status = '' WHERE id = ?", (lesson_id,))
        status, payload = client.get(f"/api/courses/lessons/{lesson_id}/play")
        self.assertEqual(status, 403, payload)

        status, payload = admin.post(
            "/api/admin/courses/lessons",
            {
                "seriesId": series_id,
                "title": "02 第二节",
                "videoKey": "https://example.test/video-2.mp4",
                "status": "published",
            },
        )
        self.assertEqual(status, 201, payload)
        self.assertEqual(payload["lesson"]["sortOrder"], 2)

        status, payload = admin.post(
            "/api/admin/courses",
            {
                "id": series_id,
                "title": "财报季交易框架更新",
                "summary": "课程简介更新",
                "coverUrl": "/uploads/courses/cover.png",
                "coverCardUrl": "/uploads/courses/cover-card.webp",
                "sortOrder": 9,
                "status": "published",
            },
        )
        self.assertEqual(status, 201, payload)
        self.assertEqual(payload["series"]["id"], series_id)
        self.assertEqual(payload["series"]["title"], "财报季交易框架更新")
        self.assertEqual(payload["series"]["coverCardUrl"], "/uploads/courses/cover-card.webp")
        self.assertEqual(payload["series"]["sortOrder"], 9)

        status, payload = admin.post(
            "/api/admin/courses/lessons",
            {
                "id": lesson_id,
                "seriesId": series_id,
                "title": "01 课程框架更新",
                "coverUrl": "https://cdn.example.test/lesson-cover-updated.jpg",
                "sortOrder": 9,
                "videoKey": "https://example.test/video-updated.mp4",
                "videoStatus": "ready",
                "status": "published",
            },
        )
        self.assertEqual(status, 201, payload)
        self.assertEqual(payload["lesson"]["id"], lesson_id)
        self.assertEqual(payload["lesson"]["sortOrder"], 9)
        self.assertEqual(payload["lesson"]["coverUrl"], "https://cdn.example.test/lesson-cover-updated.jpg")

        status, payload = client.get("/api/courses")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["series"][0]["title"], "财报季交易框架更新")
        self.assertFalse(payload["series"][0]["unlocked"])
        self.assertEqual(payload["series"][0]["lessonCount"], 2)
        self.assertEqual(payload["series"][0]["lessons"], [])

        status, payload = client.get(f"/api/courses/lessons/{lesson_id}/play")
        self.assertEqual(status, 403, payload)
        self.assertEqual(payload["code"], "course_forbidden")

        status, payload = admin.post("/api/admin/courses/grants", {"seriesId": series_id, "user": user["uid"]})
        self.assertEqual(status, 400, payload)

        status, payload = admin.post("/api/admin/courses/grants", {"seriesId": series_id, "user": user["uid"], "expiresAt": "2027-01-01"})
        self.assertEqual(status, 201, payload)
        grant_id = payload["grant"]["id"]

        status, payload = admin.post("/api/admin/courses/grants/all", {"user": user["uid"], "expiresAt": "2028-01-01"})
        self.assertEqual(status, 201, payload)
        self.assertEqual(payload["count"], 2)
        status, payload = admin.post("/api/admin/courses/grants/all", {"user": user["uid"], "expiresAt": "2029-01-01"})
        self.assertEqual(status, 201, payload)
        with sqlite3.connect(auth_api.DB_PATH) as conn:
            rows = conn.execute("SELECT series_id, expires_at FROM course_grants WHERE user_id = ? ORDER BY series_id", (user["id"],)).fetchall()
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row[1] == "2029-01-01" for row in rows))

        status, payload = admin.get(f"/api/admin/user-events?userId={user['id']}")
        self.assertEqual(status, 200, payload)
        self.assertIn("grant_course", [item["action"] for item in payload["rows"]])

        status, payload = client.get("/api/courses")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["series"][0]["title"], "财报季交易框架更新")
        self.assertTrue(payload["series"][0]["unlocked"])
        self.assertEqual(payload["series"][0]["grantExpiresAt"], "2029-01-01")
        self.assertEqual(payload["series"][0]["coverUrl"], "/uploads/courses/cover.png")
        self.assertEqual(payload["series"][0]["coverCardUrl"], "/uploads/courses/cover-card.webp")
        self.assertEqual(payload["series"][0]["lessons"][0]["title"], "01 课程框架更新")
        self.assertEqual(payload["series"][0]["lessons"][0]["coverUrl"], "https://cdn.example.test/lesson-cover-updated.jpg")
        self.assertEqual(payload["series"][0]["lessons"][0]["videoStatus"], "ready")

        status, payload = client.get(f"/api/courses/lessons/{lesson_id}/play")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["url"], "https://example.test/video-updated.mp4")

        status, payload = admin.post(
            "/api/admin/courses/lessons",
            {
                "id": lesson_id,
                "seriesId": series_id,
                "title": "01 课程框架更新",
                "coverUrl": "https://cdn.example.test/lesson-cover-updated.jpg",
                "sortOrder": 9,
                "videoKey": "https://example.test/video-updated.mp4",
                "videoStatus": "failed",
                "status": "published",
            },
        )
        self.assertEqual(status, 201, payload)
        self.assertEqual(payload["lesson"]["videoStatus"], "failed")
        status, payload = admin.post(
            "/api/admin/courses/lessons",
            {
                "id": lesson_id,
                "seriesId": series_id,
                "title": "01 课程框架更新",
                "coverUrl": "https://cdn.example.test/lesson-cover-updated.jpg",
                "sortOrder": 9,
                "videoKey": "https://example.test/video-updated.mp4",
                "status": "published",
            },
        )
        self.assertEqual(status, 201, payload)
        self.assertEqual(payload["lesson"]["videoStatus"], "failed")
        status, payload = client.get("/api/courses")
        self.assertEqual(status, 200, payload)
        self.assertNotIn(lesson_id, [lesson["id"] for lesson in payload["series"][0]["lessons"]])
        self.assertEqual(payload["series"][0]["lessonCount"], 1)
        status, payload = client.get(f"/api/courses/lessons/{lesson_id}/play")
        self.assertEqual(status, 404, payload)

        status, payload = admin.post(
            "/api/admin/courses/lessons",
            {
                "id": lesson_id,
                "seriesId": series_id,
                "title": "01 课程框架更新",
                "coverUrl": "https://cdn.example.test/lesson-cover-updated.jpg",
                "sortOrder": 9,
                "videoKey": "https://example.test/video-updated.mp4",
                "videoStatus": "ready",
                "status": "published",
            },
        )
        self.assertEqual(status, 201, payload)

        status, payload = admin.delete(f"/api/admin/courses/grants/{grant_id}")
        self.assertEqual(status, 200, payload)
        status, payload = admin.get(f"/api/admin/user-events?userId={user['id']}")
        self.assertEqual(status, 200, payload)
        self.assertIn("revoke_course", [item["action"] for item in payload["rows"]])
        status, payload = client.get(f"/api/courses/lessons/{lesson_id}/play")
        self.assertEqual(status, 403, payload)

        status, payload = admin.delete(f"/api/admin/courses/lessons/{lesson_id}")
        self.assertEqual(status, 200, payload)
        status, payload = client.get("/api/courses")
        self.assertEqual(status, 200, payload)
        self.assertFalse(payload["series"][0]["unlocked"])
        self.assertEqual(payload["series"][0]["lessons"], [])

        status, payload = admin.delete(f"/api/admin/courses/{series_id}")
        self.assertEqual(status, 200, payload)
        status, payload = admin.delete(f"/api/admin/courses/{second_series_id}")
        self.assertEqual(status, 200, payload)
        status, payload = client.get("/api/courses")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["series"], [])

    def test_us_stock_course_bulk_grant_only_grants_fixed_titles(self) -> None:
        admin = self.login("admin@example.test", "admin-password")
        user = self.create_user(admin, "us-stock-course-user@example.test", "free")
        for title in ["美股定投课程", "美股投资框架课", "滚仓实战系列课"]:
            status, payload = admin.post(
                "/api/admin/courses",
                {"title": title, "summary": "课程简介", "coverUrl": "", "status": "published"},
            )
            self.assertEqual(status, 201, payload)

        status, payload = admin.post("/api/admin/courses/grants/all", {"user": user["email"], "expiresAt": "2028-01-01", "scope": "us_stock"})
        self.assertEqual(status, 201, payload)
        self.assertEqual(payload["count"], 2)
        with sqlite3.connect(auth_api.DB_PATH) as conn:
            rows = conn.execute(
                """
                SELECT s.title, g.expires_at
                FROM course_grants g
                JOIN course_series s ON s.id = g.series_id
                WHERE g.user_id = ?
                ORDER BY s.title
                """,
                (user["id"],),
            ).fetchall()
        self.assertEqual([row[0] for row in rows], ["美股定投课程", "美股投资框架课"])
        self.assertTrue(all(row[1] == "2028-01-01" for row in rows))

    def test_admin_market_opinions_support_draft_edit_and_delete(self) -> None:
        self.use_empty_product_db()
        admin = self.login("admin@example.test", "admin-password")

        draft_payload = {
            "section": "weekly",
            "title": "草稿标题",
            "tradeDate": "2026-06-18",
            "summary": "公开摘要",
            "symbols": "SPY, QQQ",
            "topics": "FOMC",
            "highlights": "正文要点",
            "body": "",
            "status": "draft",
        }
        status, payload = admin.post("/api/admin/opinions", draft_payload)
        self.assertEqual(status, 201, payload)
        item_id = payload["item"]["id"]
        self.assertEqual(payload["item"]["status"], "draft")
        self.assertEqual(payload["item"]["tradeDate"], "2026-06-18 00:00:00")

        status, payload = admin.get("/api/admin/opinions")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["rows"][0]["id"], item_id)
        self.assertEqual(payload["rows"][0]["status"], "draft")

        public = self.client()
        status, payload = public.get("/api/product/opinions")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["rows"], [])

        published_payload = {**draft_payload, "id": item_id, "body": "正式正文", "status": "published"}
        status, payload = admin.post("/api/admin/opinions", published_payload)
        self.assertEqual(status, 201, payload)
        self.assertEqual(payload["item"]["id"], item_id)
        self.assertEqual(payload["item"]["status"], "published")

        status, payload = public.get("/api/product/opinions")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["rows"][0]["id"], item_id)
        self.assertEqual(payload["rows"][0]["tradeDate"], "2026-06-18 00:00:00")
        self.assertEqual(payload["rows"][0]["summary"], "公开摘要")
        self.assertEqual(payload["rows"][0]["body"], "")
        self.assertEqual(payload["rows"][0]["highlights"], [])

        self.create_user(admin, "free-opinions@example.test", "free")
        self.create_user(admin, "monthly-opinions@example.test", "monthly")
        self.create_user(admin, "yearly-opinions@example.test", "yearly")
        self.create_user(admin, "expired-opinions@example.test", "monthly", expires_at="2000-01-01")

        for email in ["free-opinions@example.test", "expired-opinions@example.test"]:
            status, payload = self.login(email, "user-password").get("/api/product/opinions")
            self.assertEqual(status, 200, payload)
            self.assertEqual(payload["rows"][0]["summary"], "公开摘要")
            self.assertEqual(payload["rows"][0]["body"], "")
            self.assertEqual(payload["rows"][0]["highlights"], [])

        paid_clients = [
            admin,
            self.login("monthly-opinions@example.test", "user-password"),
            self.login("yearly-opinions@example.test", "user-password"),
        ]
        for client in paid_clients:
            status, payload = client.get("/api/product/opinions")
            self.assertEqual(status, 200, payload)
            self.assertEqual(payload["rows"][0]["body"], "正式正文")
            self.assertEqual(payload["rows"][0]["highlights"], ["正文要点"])

        status, payload = admin.delete(f"/api/admin/opinions/{item_id}")
        self.assertEqual(status, 200, payload)
        status, payload = admin.get("/api/admin/opinions")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["rows"], [])

    def test_admin_market_opinions_are_paginated(self) -> None:
        self.use_empty_product_db()
        admin = self.login("admin@example.test", "admin-password")
        for index, section in enumerate(["weekly", "journal", "journal"], start=1):
            status, payload = admin.post(
                "/api/admin/opinions",
                {
                    "section": section,
                    "title": f"分页测试 {index}",
                    "tradeDate": f"2026-06-1{index}",
                    "summary": "",
                    "symbols": "",
                    "topics": "",
                    "highlights": "",
                    "body": "正文",
                    "status": "published",
                },
            )
            self.assertEqual(status, 201, payload)

        status, payload = admin.get("/api/admin/opinions?limit=2&offset=0")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["total"], 3)
        self.assertEqual(payload["limit"], 2)
        self.assertEqual(payload["offset"], 0)
        self.assertEqual(len(payload["rows"]), 2)
        self.assertEqual(payload["rows"][0]["title"], "分页测试 3")

        status, payload = admin.get("/api/admin/opinions?limit=2&offset=2")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["total"], 3)
        self.assertEqual(payload["offset"], 2)
        self.assertEqual(len(payload["rows"]), 1)

        status, payload = admin.get("/api/admin/opinions?section=journal&limit=10&offset=0")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["total"], 2)
        self.assertTrue(all(item["section"] == "journal" for item in payload["rows"]))

    def test_admin_market_opinion_image_upload_can_be_published(self) -> None:
        self.use_empty_product_db()
        admin = self.login("admin@example.test", "admin-password")
        tiny_gif = base64.b64encode(
            b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
        ).decode("ascii")

        status, payload = admin.post(
            "/api/admin/uploads",
            {"name": "chart.gif", "type": "image/gif", "data": f"data:image/gif;base64,{tiny_gif}"},
        )
        self.assertEqual(status, 201, payload)
        image_url = payload["image"]["url"]
        self.assertTrue(image_url.startswith("/api/upload?path=opinions/"))

        with urllib.request.urlopen(self.base_url + image_url, timeout=5) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers.get_content_type(), "image/gif")

        status, payload = admin.post(
            "/api/admin/opinions",
            {
                "section": "journal",
                "title": "带图交易日记",
                "tradeDate": "2026-06-18",
                "summary": "测试图片渲染",
                "symbols": "SPY",
                "topics": "FOMC",
                "highlights": "",
                "body": f"正文\n\n![chart]({image_url})",
                "status": "published",
            },
        )
        self.assertEqual(status, 201, payload)

        public = self.client()
        status, payload = public.get("/api/product/opinions")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["rows"][0]["body"], "")

        status, payload = admin.get("/api/product/opinions")
        self.assertEqual(status, 200, payload)
        self.assertIn(f"![chart]({image_url})", payload["rows"][0]["body"])

    def test_course_video_auto_processing_skips_low_bitrate_source(self) -> None:
        series = auth_api.create_course_series({"title": "自动处理测试课", "status": "published"})
        source_info = {
            "size": 1000,
            "duration": 60,
            "bitrateKbps": 1200,
            "videoCodec": "h264",
            "audioCodec": "aac",
            "width": 1280,
        }
        with (
            patch.object(auth_api, "COURSE_VIDEO_AUTO_PROCESS_ENABLED", True),
            patch.object(auth_api, "course_media_info", return_value=source_info),
            patch.object(auth_api, "create_course_transcode_job") as create_job,
        ):
            lesson = auth_api.process_course_video({
                "seriesId": series["id"],
                "title": "低码率视频",
                "videoKey": "lesson/low.mp4",
                "status": "published",
            })
        self.assertEqual(lesson["videoStatus"], "ready")
        self.assertEqual(lesson["videoKey"], "lesson/low.mp4")
        self.assertTrue(lesson["videoAvailable"])
        create_job.assert_not_called()

    def test_course_video_auto_processing_switches_only_after_validation(self) -> None:
        series = auth_api.create_course_series({"title": "自动转码测试课", "status": "published"})
        original = auth_api.create_course_lesson({
            "seriesId": series["id"],
            "title": "已有视频",
            "videoKey": "lesson/original.mp4",
            "status": "published",
        })
        source_info = {
            "size": 2000,
            "duration": 60,
            "bitrateKbps": 5000,
            "videoCodec": "h264",
            "audioCodec": "aac",
            "width": 1920,
        }
        output_info = {
            "size": 1000,
            "duration": 60,
            "bitrateKbps": 2300,
            "videoCodec": "h264",
            "audioCodec": "aac",
            "width": 1920,
        }
        with (
            patch.object(auth_api, "COURSE_VIDEO_AUTO_PROCESS_ENABLED", True),
            patch.object(auth_api, "course_media_info", return_value=source_info),
            patch.object(auth_api, "create_course_transcode_job", return_value=("job-1", "lesson/optimized.mp4")),
        ):
            processing = auth_api.process_course_video({
                "id": original["id"],
                "seriesId": series["id"],
                "title": "已有视频",
                "videoKey": "lesson/replacement.mp4",
                "status": "published",
            })
        self.assertEqual(processing["videoStatus"], "processing")
        self.assertEqual(processing["videoKey"], "lesson/original.mp4")
        self.assertTrue(processing["videoAvailable"])

        with (
            patch.object(auth_api, "COURSE_VIDEO_AUTO_PROCESS_ENABLED", True),
            patch.object(auth_api, "course_transcode_job", return_value={"state": "Success", "code": "", "message": ""}),
            patch.object(auth_api, "course_media_info", side_effect=lambda key: output_info if key.endswith("optimized.mp4") else source_info),
        ):
            self.assertEqual(auth_api.refresh_course_video_jobs(), 1)
        with sqlite3.connect(auth_api.DB_PATH) as conn:
            row = conn.execute("SELECT video_key, video_status FROM course_lessons WHERE id = ?", (original["id"],)).fetchone()
        self.assertEqual(row, ("lesson/optimized.mp4", "ready"))

        with (
            patch.object(auth_api, "COURSE_VIDEO_AUTO_PROCESS_ENABLED", True),
            patch.object(auth_api, "course_media_info", return_value=source_info),
            patch.object(auth_api, "create_course_transcode_job", return_value=("job-2", "lesson/failed.mp4")),
        ):
            auth_api.process_course_video({
                "id": original["id"],
                "seriesId": series["id"],
                "title": "已有视频",
                "videoKey": "lesson/next.mp4",
                "status": "published",
            })
        with (
            patch.object(auth_api, "COURSE_VIDEO_AUTO_PROCESS_ENABLED", True),
            patch.object(auth_api, "course_transcode_job", return_value={"state": "Failed", "code": "E1", "message": "转码失败"}),
        ):
            self.assertEqual(auth_api.refresh_course_video_jobs(), 1)
        with sqlite3.connect(auth_api.DB_PATH) as conn:
            row = conn.execute("SELECT video_key, video_status, video_process_error FROM course_lessons WHERE id = ?", (original["id"],)).fetchone()
        self.assertEqual(row, ("lesson/optimized.mp4", "failed", "转码失败"))

    def test_new_processing_course_video_is_not_exposed_before_ready(self) -> None:
        series = auth_api.create_course_series({"title": "待处理视频测试课", "status": "published"})
        source_info = {
            "size": 2000,
            "duration": 60,
            "bitrateKbps": 5000,
            "videoCodec": "h264",
            "audioCodec": "aac",
            "width": 1920,
        }
        with (
            patch.object(auth_api, "COURSE_VIDEO_AUTO_PROCESS_ENABLED", True),
            patch.object(auth_api, "course_media_info", return_value=source_info),
            patch.object(auth_api, "create_course_transcode_job", return_value=("job-new", "lesson/new-optimized.mp4")),
        ):
            lesson = auth_api.process_course_video({
                "seriesId": series["id"],
                "title": "新视频",
                "videoKey": "lesson/new.mp4",
                "status": "published",
            })
        self.assertEqual(lesson["videoStatus"], "processing")
        self.assertFalse(lesson["videoAvailable"])
        admin = auth_api.find_user_by_email("admin@example.test")
        payload = auth_api.user_courses_payload(admin)
        lesson_ids = [item["id"] for course in payload["series"] for item in course["lessons"]]
        self.assertNotIn(lesson["id"], lesson_ids)
        with sqlite3.connect(auth_api.DB_PATH) as conn:
            conn.execute("UPDATE course_lessons SET video_process_started_at = ? WHERE id = ?", ("2000-01-01T00:00:00+00:00", lesson["id"]))
        with (
            patch.object(auth_api, "COURSE_VIDEO_AUTO_PROCESS_ENABLED", True),
            patch.object(auth_api, "course_transcode_job") as query_job,
        ):
            self.assertEqual(auth_api.refresh_course_video_jobs(), 1)
        query_job.assert_not_called()
        with sqlite3.connect(auth_api.DB_PATH) as conn:
            row = conn.execute("SELECT video_key, video_status, video_process_error FROM course_lessons WHERE id = ?", (lesson["id"],)).fetchone()
        self.assertEqual(row, ("", "failed", "视频处理超时，请重试"))

    def test_course_cover_upload_puts_to_cos(self) -> None:
        auth_api.COURSE_COS_SECRET_ID = "secret-id"
        auth_api.COURSE_COS_SECRET_KEY = "secret-key"
        auth_api.COURSE_COS_BUCKET = "lesson-1259765032"
        auth_api.COURSE_COS_REGION = "ap-chengdu"
        admin = self.login("admin@example.test", "admin-password")
        tiny_gif = base64.b64encode(
            b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
        ).decode("ascii")
        calls = []

        class FakeResponse:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        original = urllib.request.urlopen

        def fake_urlopen(request, timeout=0):
            calls.append((request, timeout))
            return FakeResponse()

        try:
            urllib.request.urlopen = fake_urlopen
            status, payload = admin.post(
                "/api/admin/uploads",
                {"name": "cover.gif", "type": "image/gif", "scope": "courses", "data": f"data:image/gif;base64,{tiny_gif}"},
            )
        finally:
            urllib.request.urlopen = original

        self.assertEqual(status, 201, payload)
        self.assertIn("lesson-1259765032.cos.ap-chengdu.myqcloud.com/course-image/", payload["image"]["url"])
        self.assertIn("q-sign-algorithm=sha1", payload["image"]["url"])
        self.assertEqual(calls[0][0].get_method(), "PUT")

    def test_course_cover_upload_url_matches_video_flow(self) -> None:
        auth_api.COURSE_COS_SECRET_ID = "secret-id"
        auth_api.COURSE_COS_SECRET_KEY = "secret-key"
        auth_api.COURSE_COS_BUCKET = "lesson-1259765032"
        auth_api.COURSE_COS_REGION = "ap-chengdu"
        admin = self.login("admin@example.test", "admin-password")

        status, payload = admin.post(
            "/api/admin/courses/image-upload-url",
            {"name": "cover.webp", "type": "image/webp", "size": 1234},
        )

        self.assertEqual(status, 201, payload)
        self.assertIn("course-image/", payload["image"]["key"])
        self.assertIn("lesson-1259765032.cos.ap-chengdu.myqcloud.com/course-image/", payload["image"]["url"])
        self.assertIn("q-sign-algorithm=sha1", payload["image"]["url"])
        self.assertIn("q-sign-algorithm=sha1", payload["image"]["uploadUrl"])

    def test_course_cos_url_is_signed_as_bucket_object(self) -> None:
        auth_api.COURSE_COS_SECRET_ID = "secret-id"
        auth_api.COURSE_COS_SECRET_KEY = "secret-key"
        auth_api.COURSE_COS_BUCKET = "lesson-1259765032"
        auth_api.COURSE_COS_REGION = "ap-chengdu"
        auth_api.COURSE_COS_DOMAIN = ""
        url = auth_api.signed_course_video_url(
            "https://lesson-1259765032.cos.ap-chengdu.myqcloud.com/lesson/demo.mp4",
            now=1_700_000_000,
        )
        self.assertIn("q-sign-algorithm=sha1", url)
        self.assertIn("/lesson/demo.mp4?", url)

    def test_course_play_observation_reuses_recent_grant_without_blocking(self) -> None:
        auth_api.COURSE_PLAY_REUSE_SECONDS = 120
        auth_api.COURSE_COS_SIGN_TTL = 1800
        with (
            patch.object(auth_api.time, "time", side_effect=[1_700_000_000, 1_700_000_030]),
            patch.object(auth_api, "signed_course_video_url", side_effect=["https://video.example/first", "https://video.example/second"]) as signer,
            patch("builtins.print") as output,
        ):
            first = auth_api.observed_course_play_url(7, 11, "lesson/demo.mp4", "1.2.3.4", "Test Browser")
            second = auth_api.observed_course_play_url(7, 11, "lesson/demo.mp4", "5.6.7.8", "Test Browser")

        self.assertEqual(first, ("https://video.example/first", 1800))
        self.assertEqual(second, ("https://video.example/first", 1770))
        self.assertEqual(signer.call_count, 1)
        event = json.loads(output.call_args_list[-1].args[0].removeprefix("course_play_observation "))
        self.assertTrue(event["reused"])
        self.assertEqual(event["recentUserRequests"], 2)
        self.assertEqual(event["recentUserNewGrants"], 1)
        self.assertEqual(event["recentUserIps"], 2)

    def test_course_video_upload_puts_to_cos_and_returns_key(self) -> None:
        auth_api.COURSE_COS_SECRET_ID = "secret-id"
        auth_api.COURSE_COS_SECRET_KEY = "secret-key"
        auth_api.COURSE_COS_BUCKET = "lesson-1259765032"
        auth_api.COURSE_COS_REGION = "ap-chengdu"
        calls = []

        class FakeResponse:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        original = urllib.request.urlopen

        def fake_urlopen(request, timeout=0):
            calls.append((request, timeout))
            return FakeResponse()

        try:
            urllib.request.urlopen = fake_urlopen
            payload = auth_api.upload_course_video("lesson-01.mp4", "video/mp4", b"demo")
        finally:
            urllib.request.urlopen = original

        self.assertTrue(payload["key"].startswith("lesson/"))
        self.assertTrue(payload["key"].endswith(".mp4"))
        self.assertIn("lesson-1259765032.cos.ap-chengdu.myqcloud.com", payload["url"])
        self.assertEqual(calls[0][0].get_method(), "PUT")
        self.assertEqual(calls[0][0].data, b"demo")

    def test_course_video_upload_ticket_returns_direct_cos_put_url(self) -> None:
        auth_api.COURSE_COS_SECRET_ID = "secret-id"
        auth_api.COURSE_COS_SECRET_KEY = "secret-key"
        auth_api.COURSE_COS_BUCKET = "lesson-1259765032"
        auth_api.COURSE_COS_REGION = "ap-chengdu"

        payload = auth_api.create_course_video_upload_ticket({"name": "lesson-01.mp4", "type": "video/mp4", "size": 1024})

        self.assertTrue(payload["key"].startswith("lesson/"))
        self.assertIn("lesson-1259765032.cos.ap-chengdu.myqcloud.com", payload["uploadUrl"])
        self.assertIn("q-sign-algorithm=sha1", payload["uploadUrl"])
        self.assertEqual(payload["expiresIn"], 3600)


if __name__ == "__main__":
    unittest.main()

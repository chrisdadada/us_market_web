#!/usr/bin/env python3
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def request(base: str, path: str, payload: dict | None = None, cookie: str = "") -> tuple[int, dict, str]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie.split(";", 1)[0]
    req = urllib.request.Request(base + path, data=data, headers=headers, method="POST" if payload is not None else "GET")
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.status, json.loads(resp.read() or b"{}"), resp.headers.get("Set-Cookie", "")


def main() -> int:
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp:
        env = {
            **os.environ,
            "APP_HOST": "127.0.0.1",
            "APP_PORT": str(port),
            "APP_DB": os.path.join(tmp, "app.db"),
            "APP_UPLOAD_ROOT": os.path.join(tmp, "uploads"),
            "SESSION_SECRET": "test-secret",
            "SUPER_ADMIN_EMAIL": "admin@example.com",
            "SUPER_ADMIN_PASSWORD": "admin-password",
        }
        proc = subprocess.Popen([sys.executable, "server/auth_api.py"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        base = f"http://127.0.0.1:{port}"
        try:
            for _ in range(50):
                try:
                    urllib.request.urlopen(base + "/api/auth/status", timeout=1).close()
                    break
                except Exception:
                    time.sleep(0.1)
            else:
                raise AssertionError("server did not start")

            request(base, "/api/analytics/event", {"eventType": "nav_click", "eventKey": "market", "path": "/"})
            _, _, user_cookie = request(base, "/api/auth/register", {"email": "user@example.com", "password": "user-password"})
            request(base, "/api/analytics/event", {"eventType": "nav_click", "eventKey": "dashboard", "path": "/"}, user_cookie)
            _, _, admin_cookie = request(base, "/api/auth/login", {"email": "admin@example.com", "password": "admin-password"})
            _, metrics, _ = request(base, "/api/admin/metrics", cookie=admin_cookie)
            assert metrics["active"]["d3"] == 1, metrics
            assert len(metrics["navClicks"]) == 1, metrics
            assert metrics["navClicks"][0]["page"] == "dashboard", metrics
        finally:
            proc.terminate()
            proc.wait(timeout=5)
    print("analytics metrics ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

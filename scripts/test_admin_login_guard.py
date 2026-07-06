#!/usr/bin/env python3
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def post(base: str, path: str, payload: dict) -> tuple[int, dict, str]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(base + path, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read() or b"{}"), resp.headers.get("Set-Cookie", "")
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}"), exc.headers.get("Set-Cookie", "")


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

            status, _, _ = post(base, "/api/auth/register", {"email": "user@example.com", "password": "user-password"})
            assert status == 201, status
            status, payload, cookie = post(
                base,
                "/api/auth/login",
                {"email": "user@example.com", "password": "user-password", "adminOnly": True},
            )
            assert status == 403, payload
            assert "mg_session=" not in cookie, cookie
            status, payload, cookie = post(
                base,
                "/api/auth/login",
                {"email": "admin@example.com", "password": "admin-password", "adminOnly": True},
            )
            assert status == 200, payload
            assert "mg_session=" in cookie, cookie
        finally:
            proc.terminate()
            proc.wait(timeout=5)
    print("admin login guard ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

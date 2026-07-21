#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import sqlite3
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
DEV_DB = Path("/var/lib/ytd-gainers-dev/app.db")
DEV_MIGRATIONS = Path("/var/lib/ytd-gainers-dev/media-migrations")
CARD_SIZE = (640, 360)
DETAIL_SIZE = (1280, 720)


def safe_dev_db(path_value: str, allowed: Path = DEV_DB) -> Path:
    path = Path(path_value).expanduser()
    if path.is_symlink() or not path.exists() or not path.is_file():
        raise ValueError("dev 数据库不存在或路径不安全")
    resolved = path.resolve(strict=True)
    if resolved != allowed.resolve(strict=True):
        raise ValueError("只允许处理 dev 课程数据库")
    return resolved


def safe_dev_bucket(bucket: str) -> str:
    value = str(bucket or "").strip()
    if "dev" not in value.lower():
        raise ValueError("只允许写入独立 dev Bucket")
    return value


def variant_key(source: str, variant: str) -> str:
    path = PurePosixPath(source)
    if not source.startswith("course-image/") or not path.name or ".." in path.parts:
        raise ValueError("封面路径不正确")
    return str(path.parent / "optimized" / f"{path.stem}-{variant}.webp")


def pillow() -> tuple[Any, Any]:
    try:
        from PIL import Image, ImageOps
    except ImportError as exc:
        raise RuntimeError("运行封面迁移前需要安装 Pillow") from exc
    return Image, ImageOps


def render_webp(raw: bytes, size: tuple[int, int], quality: int) -> bytes:
    Image, ImageOps = pillow()
    with Image.open(io.BytesIO(raw)) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        fitted = ImageOps.fit(image, size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
        output = io.BytesIO()
        fitted.save(output, format="WEBP", quality=quality, method=6)
        return output.getvalue()


def verify_webp(raw: bytes, size: tuple[int, int]) -> None:
    Image, _ = pillow()
    with Image.open(io.BytesIO(raw)) as image:
        if image.format != "WEBP" or image.size != size:
            raise ValueError("WebP 尺寸或格式校验失败")
        image.verify()


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def load_rows(conn: sqlite3.Connection) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    series_columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(course_series)")}
    if "cover_card_url" not in series_columns:
        raise ValueError("dev 数据库尚未升级 cover_card_url")
    series = [
        {"id": int(row[0]), "cover": str(row[1] or ""), "card": str(row[2] or "")}
        for row in conn.execute("SELECT id, cover_url, cover_card_url FROM course_series ORDER BY id")
        if row[1] and not row[2]
    ]
    lessons = [
        {"id": int(row[0]), "cover": str(row[1] or "")}
        for row in conn.execute("SELECT id, cover_url FROM course_lessons ORDER BY id")
        if row[1] and "/optimized/" not in str(row[1])
    ]
    return series, lessons


def apply_database_updates(
    db_path: Path,
    series: list[dict[str, Any]],
    lessons: list[dict[str, Any]],
    backup_path: Path,
) -> None:
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    if backup_path.exists():
        raise ValueError("数据库备份已存在")
    source = sqlite3.connect(db_path)
    backup = sqlite3.connect(backup_path)
    try:
        source.backup(backup)
    finally:
        backup.close()
        source.close()

    conn = sqlite3.connect(db_path)
    try:
        conn.execute("BEGIN IMMEDIATE")
        for item in series:
            cursor = conn.execute(
                "UPDATE course_series SET cover_url = ?, cover_card_url = ? "
                "WHERE id = ? AND cover_url = ? AND COALESCE(cover_card_url, '') = ''",
                (item["detailKey"], item["cardKey"], item["id"], item["cover"]),
            )
            if cursor.rowcount != 1:
                raise ValueError(f"课程 {item['id']} 已变化，停止切换")
        for item in lessons:
            cursor = conn.execute(
                "UPDATE course_lessons SET cover_url = ? WHERE id = ? AND cover_url = ?",
                (item["detailKey"], item["id"], item["cover"]),
            )
            if cursor.rowcount != 1:
                raise ValueError(f"课时 {item['id']} 已变化，停止切换")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def request_bytes(url: str, *, method: str = "GET", data: bytes | None = None) -> bytes:
    headers = {}
    if data is not None:
        headers = {"Content-Type": "image/webp", "Content-Length": str(len(data))}
    request = urllib.request.Request(url, method=method, data=data, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"COS 请求失败：HTTP {response.status}")
        return response.read()


def upload_verified(
    key: str,
    raw: bytes,
    size: tuple[int, int],
    sign: Callable[[str, str], str],
) -> dict[str, Any]:
    try:
        existing = request_bytes(sign(key, "get"))
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise
    else:
        if sha256(existing) != sha256(raw):
            raise ValueError(f"目标对象已存在且内容不同：{key}")
        verify_webp(existing, size)
        return {"key": key, "bytes": len(existing), "sha256": sha256(existing), "reused": True}

    request_bytes(sign(key, "put"), method="PUT", data=raw)
    uploaded = request_bytes(sign(key, "get"))
    if sha256(uploaded) != sha256(raw):
        raise ValueError(f"上传回读不一致：{key}")
    verify_webp(uploaded, size)
    return {"key": key, "bytes": len(uploaded), "sha256": sha256(uploaded), "reused": False}


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="只处理独立 dev Bucket 中的历史课程封面")
    parser.add_argument("--db", default=str(DEV_DB))
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        db_path = safe_dev_db(args.db)
        conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
        conn.execute("PRAGMA query_only = ON")
        try:
            series, lessons = load_rows(conn)
        finally:
            conn.close()
        if not args.apply:
            print(json.dumps({"ok": True, "mode": "dry-run", "series": len(series), "lessons": len(lessons)}, ensure_ascii=False))
            return 0

        sys.path.insert(0, str(ROOT / "server"))
        import auth_api  # type: ignore

        bucket = safe_dev_bucket(auth_api.COURSE_COS_BUCKET)
        sign = lambda key, method: auth_api.signed_course_cos_url(key, method=method, ttl=600)
        output_series = []
        output_lessons = []
        for item in series:
            original = request_bytes(sign(item["cover"], "get"))
            detail = render_webp(original, DETAIL_SIZE, 82)
            card = render_webp(original, CARD_SIZE, 78)
            detail_key = variant_key(item["cover"], "detail")
            card_key = variant_key(item["cover"], "card")
            output_series.append(
                {
                    **item,
                    "detailKey": detail_key,
                    "cardKey": card_key,
                    "detail": upload_verified(detail_key, detail, DETAIL_SIZE, sign),
                    "cardOutput": upload_verified(card_key, card, CARD_SIZE, sign),
                    "sourceBytes": len(original),
                }
            )
        for item in lessons:
            original = request_bytes(sign(item["cover"], "get"))
            detail = render_webp(original, DETAIL_SIZE, 82)
            detail_key = variant_key(item["cover"], "detail")
            output_lessons.append(
                {
                    **item,
                    "detailKey": detail_key,
                    "detail": upload_verified(detail_key, detail, DETAIL_SIZE, sign),
                    "sourceBytes": len(original),
                }
            )

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_path = db_path.with_name(f"{db_path.name}.bak-media-{timestamp}")
        manifest_path = DEV_MIGRATIONS / f"course-covers-{timestamp}.json"
        manifest = {
            "status": "prepared",
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "environment": "dev",
            "bucket": bucket,
            "database": str(db_path),
            "backup": str(backup_path),
            "originalObjectsPreserved": True,
            "series": output_series,
            "lessons": output_lessons,
        }
        write_json(manifest_path, manifest)
        apply_database_updates(db_path, output_series, output_lessons, backup_path)
        manifest["status"] = "completed"
        manifest["completedAt"] = datetime.now(timezone.utc).isoformat()
        write_json(manifest_path, manifest)
        print(json.dumps({"ok": True, "series": len(output_series), "lessons": len(output_lessons), "manifest": str(manifest_path), "backup": str(backup_path)}, ensure_ascii=False))
        return 0
    except (OSError, sqlite3.Error, ValueError, RuntimeError, urllib.error.URLError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

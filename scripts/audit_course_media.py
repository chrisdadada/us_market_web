#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
ALLOWED_DB_ROOTS = {
    "local": ROOT / ".local",
    "dev": Path("/var/lib/ytd-gainers-dev"),
}


def inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def has_symlink(path: Path) -> bool:
    current = path
    while current != current.parent:
        if current.is_symlink():
            return True
        current = current.parent
    return current.is_symlink()


def safe_db_path(path_value: str, environment: str, allowed_roots: dict[str, Path] | None = None) -> Path:
    roots = allowed_roots or ALLOWED_DB_ROOTS
    if environment not in roots:
        raise ValueError("只允许盘点 local 或 dev 数据库")
    candidate = Path(path_value).expanduser()
    if not candidate.exists() or not candidate.is_file():
        raise ValueError("数据库文件不存在")
    if has_symlink(candidate):
        raise ValueError("拒绝通过符号链接读取数据库")
    resolved = candidate.resolve(strict=True)
    allowed_root = roots[environment].expanduser().resolve(strict=True)
    if not inside(resolved, allowed_root):
        raise ValueError(f"数据库不在 {environment} 白名单目录")
    if "dongbimao-prod" in resolved.parts or "prod" in resolved.parts:
        raise ValueError("拒绝读取 prod 数据库")
    return resolved


def table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?",
        ("table", table),
    ).fetchone()
    if not exists:
        raise ValueError(f"数据库缺少 {table} 表")
    return {str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")}


def extension(value: str) -> str:
    path = urlparse(value).path if value.startswith(("http://", "https://")) else value
    suffix = Path(path).suffix.lower()
    return suffix or "无扩展名"


def reference_kind(value: str, expected_prefix: str) -> str:
    if not value:
        return "missing"
    if value.startswith(expected_prefix):
        return "internal"
    if value.startswith(("http://", "https://")):
        return "external"
    return "unexpected"


def reference_summary(values: list[str], expected_prefix: str) -> dict[str, object]:
    present = [value for value in values if value]
    counts = Counter(present)
    return {
        "total": len(values),
        "present": len(present),
        "missing": len(values) - len(present),
        "unique": len(counts),
        "duplicates": sorted(value for value, count in counts.items() if count > 1),
        "formats": dict(sorted(Counter(extension(value) for value in present).items())),
        "kinds": dict(sorted(Counter(reference_kind(value, expected_prefix) for value in values).items())),
    }


def normalized_video_status(value: str) -> str:
    status = value.strip()
    if not status:
        return "ready"
    return status if status in {"processing", "ready", "failed"} else "failed"


def probe_lesson_videos(
    lessons: list[dict[str, object]],
    metadata_probe: Callable[[str], dict[str, Any]],
    requires_optimization: Callable[[dict[str, Any]], bool],
) -> dict[str, object]:
    fields = ("size", "duration", "bitrateKbps", "format", "videoCodec", "audioCodec", "width", "height")
    results = []
    for lesson in lessons:
        if lesson["videoStatus"] != "ready" or not lesson["video"]:
            continue
        try:
            metadata = metadata_probe(str(lesson["video"]))
            results.append({
                "id": lesson["id"],
                "video": lesson["video"],
                "metadata": {field: metadata.get(field) for field in fields},
                "requiresOptimization": bool(requires_optimization(metadata)),
            })
        except Exception as exc:
            results.append({
                "id": lesson["id"],
                "video": lesson["video"],
                "error": type(exc).__name__,
            })
    failed = sum("error" in item for item in results)
    return {
        "status": "probed" if not failed else "partial",
        "checked": len(results),
        "totalBytes": sum(int(item.get("metadata", {}).get("size") or 0) for item in results),
        "meetsSpec": sum(item.get("requiresOptimization") is False for item in results),
        "requiresOptimization": sum(item.get("requiresOptimization") is True for item in results),
        "failed": failed,
        "videos": results,
    }


def audit_database(
    path: Path,
    environment: str,
    metadata_probe: Callable[[str], dict[str, Any]] | None = None,
    requires_optimization: Callable[[dict[str, Any]], bool] | None = None,
) -> dict[str, object]:
    uri = f"file:{path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA query_only = ON")
        series_columns = table_columns(conn, "course_series")
        lesson_columns = table_columns(conn, "course_lessons")
        series_cover_card = "cover_card_url" in series_columns
        lesson_video_status = "video_status" in lesson_columns

        series_select = "id, title, cover_url"
        if series_cover_card:
            series_select += ", cover_card_url"
        lesson_select = "id, series_id, title, cover_url, video_key"
        if lesson_video_status:
            lesson_select += ", video_status"

        series_rows = conn.execute(f"SELECT {series_select} FROM course_series ORDER BY id").fetchall()
        lesson_rows = conn.execute(f"SELECT {lesson_select} FROM course_lessons ORDER BY id").fetchall()

        series = [
            {
                "id": int(row["id"]),
                "title": str(row["title"] or ""),
                "cover": str(row["cover_url"] or ""),
                "cardCover": str(row["cover_card_url"] or "") if series_cover_card else "",
            }
            for row in series_rows
        ]
        lessons = [
            {
                "id": int(row["id"]),
                "seriesId": int(row["series_id"]),
                "title": str(row["title"] or ""),
                "cover": str(row["cover_url"] or ""),
                "video": str(row["video_key"] or ""),
                "videoStatus": normalized_video_status(str(row["video_status"] or "")) if lesson_video_status else "ready",
            }
            for row in lesson_rows
        ]

        object_metadata: dict[str, object] = {
            "status": "not-probed",
            "reason": "dev 与 prod COS 边界尚未确认，禁止网络探测",
        }
        if metadata_probe:
            if environment != "dev" or not requires_optimization:
                raise ValueError("视频元数据只允许在 dev 使用完整判定器探测")
            object_metadata = probe_lesson_videos(lessons, metadata_probe, requires_optimization)

        return {
            "schemaVersion": 1,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "environment": environment,
            "database": {"path": str(path), "mode": "read-only"},
            "schema": {
                "seriesCoverCard": "available" if series_cover_card else "legacy-missing",
                "lessonVideoStatus": "available" if lesson_video_status else "legacy-missing",
            },
            "summary": {
                "courses": len(series),
                "lessons": len(lessons),
                "seriesCovers": reference_summary([item["cover"] for item in series], "course-image/"),
                "seriesCardCovers": reference_summary([item["cardCover"] for item in series], "course-image/"),
                "lessonCovers": reference_summary([item["cover"] for item in lessons], "course-image/"),
                "videos": reference_summary([item["video"] for item in lessons], "lesson/"),
                "videoStatuses": dict(sorted(Counter(item["videoStatus"] for item in lessons).items())),
            },
            "migrationCandidates": {
                "seriesWithoutCardCover": [item["id"] for item in series if item["cover"] and not item["cardCover"]],
                "lessonCovers": [item["id"] for item in lessons if item["cover"]],
                "videosNeedingMetadataProbe": [item["id"] for item in lessons if item["video"]],
            },
            "records": {"series": series, "lessons": lessons},
            "objectMetadata": object_metadata,
        }
    finally:
        conn.close()


def write_report(payload: dict[str, object], output_value: str, allowed_root: Path | None = None) -> Path:
    report_root = (allowed_root or (ROOT / ".local" / "media-audits")).expanduser().resolve()
    output = Path(output_value).expanduser().resolve()
    if not inside(output, report_root):
        raise ValueError("报告只能写入本项目 .local/media-audits")
    if has_symlink(output.parent):
        raise ValueError("拒绝通过符号链接写入报告")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    return output.resolve()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="只读盘点 local / dev 课程媒体引用")
    parser.add_argument("--environment", required=True, choices=sorted(ALLOWED_DB_ROOTS))
    parser.add_argument("--db", required=True)
    parser.add_argument("--probe-video-metadata", action="store_true", help="仅在 dev 读取 COS 媒体规格")
    parser.add_argument("--output")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        path = safe_db_path(args.db, args.environment)
        metadata_probe = None
        requires_optimization = None
        if args.probe_video_metadata:
            if args.environment != "dev":
                raise ValueError("视频元数据只允许在 dev 探测")
            sys.path.insert(0, str(ROOT / "server"))
            import auth_api

            metadata_probe = auth_api.course_media_info
            requires_optimization = auth_api.course_media_requires_optimization
        payload = audit_database(path, args.environment, metadata_probe, requires_optimization)
        if args.output:
            report = write_report(payload, args.output)
            print(json.dumps({"ok": True, "report": str(report)}, ensure_ascii=False))
        else:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    except (OSError, sqlite3.Error, ValueError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

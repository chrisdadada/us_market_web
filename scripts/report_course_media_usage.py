#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


DEV_DB = Path("/var/lib/ytd-gainers-dev/app.db")
DEV_AUDIT_ROOT = Path("/opt/dongbimao-dev/.local/media-audits")
EVENT_TYPE = "course_play_grant"
LATENCY_BUCKETS = ("lt1", "1to3", "3to8", "gte8")


def has_symlink(path: Path) -> bool:
    current = path
    while current != current.parent:
        if current.is_symlink():
            return True
        current = current.parent
    return current.is_symlink()


def utc_timestamp(value: str) -> datetime:
    text = value.strip()
    if len(text) == 10:
        text += "T00:00:00+00:00"
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def metadata_by_lesson(payload: dict[str, Any]) -> dict[int, dict[str, Any]]:
    if payload.get("environment") != "dev":
        raise ValueError("只允许读取 dev 媒体报告")
    videos = payload.get("objectMetadata", {}).get("videos")
    if not isinstance(videos, list):
        raise ValueError("媒体报告缺少视频元数据")
    result: dict[int, dict[str, Any]] = {}
    for item in videos:
        lesson_id = int(item.get("id") or 0)
        metadata = item.get("metadata")
        if lesson_id <= 0 or lesson_id in result or not isinstance(metadata, dict):
            raise ValueError("媒体报告包含重复或无效课时")
        result[lesson_id] = metadata
    return result


def build_report(
    conn: sqlite3.Connection,
    metadata_payload: dict[str, Any],
    start: datetime,
    end: datetime,
) -> dict[str, Any]:
    if start >= end:
        raise ValueError("统计开始时间必须早于结束时间")
    metadata = metadata_by_lesson(metadata_payload)
    rows = conn.execute(
        """
        SELECT event_key, user_id, created_at
        FROM analytics_events
        WHERE event_type = ? AND created_at >= ? AND created_at < ?
        ORDER BY created_at, id
        """,
        (EVENT_TYPE, start.isoformat(), end.isoformat()),
    ).fetchall()
    groups: dict[tuple[str, int], dict[str, Any]] = {}
    all_users: set[int] = set()
    all_lessons: set[int] = set()
    for event_key, user_id, created_at in rows:
        if not str(event_key).isdigit():
            raise ValueError("播放地址发放记录包含无效课时")
        lesson_id = int(event_key)
        if lesson_id not in metadata:
            raise ValueError(f"媒体报告缺少课时 {lesson_id}")
        day = utc_timestamp(str(created_at)).date().isoformat()
        group = groups.setdefault((day, lesson_id), {"grants": 0, "users": set()})
        group["grants"] += 1
        group["users"].add(int(user_id))
        all_users.add(int(user_id))
        all_lessons.add(lesson_id)

    output_rows = []
    for (day, lesson_id), group in sorted(groups.items()):
        video = metadata[lesson_id]
        output_rows.append({
            "date": day,
            "lessonId": lesson_id,
            "grants": group["grants"],
            "uniqueUsers": len(group["users"]),
            "assetSizeBytes": int(video.get("size") or 0),
            "assetDurationSeconds": float(video.get("duration") or 0),
            "assetCodec": str(video.get("videoCodec") or ""),
        })

    health_rows = conn.execute(
        """
        SELECT event_type, event_key
        FROM analytics_events
        WHERE event_type IN ('course_video_url_ready', 'course_video_ready', 'course_video_buffer')
          AND created_at >= ? AND created_at < ?
        ORDER BY created_at, id
        """,
        (start.isoformat(), end.isoformat()),
    ).fetchall()
    url_ready = {bucket: 0 for bucket in LATENCY_BUCKETS}
    video_ready = {bucket: 0 for bucket in LATENCY_BUCKETS}
    buffering_reports = 0
    for event_type, event_key in health_rows:
        if event_type == "course_video_buffer":
            if not str(event_key).isdigit() or int(event_key) not in metadata:
                raise ValueError("播放缓冲记录包含无效课时")
            buffering_reports += 1
            continue
        parts = str(event_key).split(":", 1)
        if len(parts) != 2 or not parts[0].isdigit() or int(parts[0]) not in metadata or parts[1] not in LATENCY_BUCKETS:
            raise ValueError("播放耗时记录格式无效")
        target = url_ready if event_type == "course_video_url_ready" else video_ready
        target[parts[1]] += 1

    return {
        "ok": True,
        "mode": "read-only",
        "environment": "dev",
        "meaning": "成功发放课程播放地址；不代表实际播放、观看时长或传输流量",
        "window": {"from": start.isoformat(), "to": end.isoformat(), "timezone": "UTC"},
        "totals": {
            "grants": len(rows),
            "uniqueUsers": len(all_users),
            "lessonsGranted": len(all_lessons),
        },
        "playbackHealth": {
            "urlReady": url_ready,
            "videoReady": video_ready,
            "bufferingReports": buffering_reports,
            "meaning": "按用户和课时去重后的耗时档位与缓冲报告；不记录播放进度或签名地址",
        },
        "rows": output_rows,
    }


def safe_file(path_value: str, expected: Path | None = None, root: Path | None = None) -> Path:
    path = Path(path_value).expanduser()
    if has_symlink(path) or not path.is_file():
        raise ValueError("文件不存在或路径不安全")
    resolved = path.resolve(strict=True)
    if expected:
        if has_symlink(expected) or not expected.is_file():
            raise ValueError("dev 课程数据库路径不安全")
        if resolved != expected.resolve(strict=True):
            raise ValueError("只允许读取 dev 课程数据库")
    if root:
        if has_symlink(root) or not root.is_dir():
            raise ValueError("dev 媒体报告目录不安全")
        resolved.relative_to(root.resolve(strict=True))
    return resolved


def parse_args() -> argparse.Namespace:
    now = datetime.now(timezone.utc)
    parser = argparse.ArgumentParser(description="汇总 dev 课程播放地址发放记录")
    parser.add_argument("--db", default=str(DEV_DB))
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--from", dest="start", default=(now - timedelta(days=30)).isoformat())
    parser.add_argument("--to", dest="end", default=now.isoformat())
    return parser.parse_args()


def main() -> int:
    try:
        args = parse_args()
        db_path = safe_file(args.db, expected=DEV_DB)
        metadata_path = safe_file(args.metadata, root=DEV_AUDIT_ROOT)
        with metadata_path.open(encoding="utf-8") as handle:
            metadata_payload = json.load(handle)
        conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
        try:
            conn.execute("PRAGMA query_only = ON")
            report = build_report(conn, metadata_payload, utc_timestamp(args.start), utc_timestamp(args.end))
        finally:
            conn.close()
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except (OSError, sqlite3.Error, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

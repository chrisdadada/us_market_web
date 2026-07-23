#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.report_course_media_usage import (
    DEV_AUDIT_ROOT,
    DEV_DB,
    build_report as build_usage_report,
    has_symlink,
    safe_file,
    utc_timestamp,
)


DEV_BATCH_ROOT = Path("/opt/dongbimao-dev/.local/hls-batches")


def safe_directory(path_value: str, expected: Path) -> Path:
    path = Path(path_value).expanduser()
    if has_symlink(path) or not path.is_dir():
        raise ValueError("目录不存在或路径不安全")
    resolved = path.resolve(strict=True)
    if has_symlink(expected) or not expected.is_dir():
        raise ValueError("dev 目录路径不安全")
    if resolved != expected.resolve(strict=True):
        raise ValueError("只允许读取 dev 媒体目录")
    return resolved


def report_files(root: Path) -> list[Path]:
    return sorted(
        (
            path
            for path in root.glob("*.json")
            if path.is_file()
            and not path.is_symlink()
            and not path.name.startswith("._")
            and not path.name.endswith((".partial.json", ".tmp.json"))
        ),
        key=lambda path: path.name,
    )


def latest_report(root: Path) -> Path:
    files = report_files(root)
    if not files:
        raise ValueError("没有可用的 dev 媒体报告")
    return max(files, key=lambda path: (path.stat().st_mtime_ns, path.name))


def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"{path.name} 不是有效报告")
    return payload


def inventory_summary(metadata: dict[str, Any]) -> dict[str, Any]:
    if metadata.get("environment") != "dev":
        raise ValueError("只允许读取 dev 媒体报告")
    object_metadata = metadata.get("objectMetadata")
    if not isinstance(object_metadata, dict):
        raise ValueError("媒体报告缺少对象元数据")
    videos = object_metadata.get("videos")
    if not isinstance(videos, list):
        raise ValueError("媒体报告缺少视频元数据")

    total_bytes = 0
    total_seconds = 0.0
    codecs: Counter[str] = Counter()
    for item in videos:
        video = item.get("metadata")
        if not isinstance(video, dict):
            raise ValueError("媒体报告包含无效视频元数据")
        total_bytes += int(video.get("size") or 0)
        total_seconds += float(video.get("duration") or 0)
        codec = str(video.get("videoCodec") or "unknown").lower()
        codecs[codec] += 1

    summary = metadata.get("summary")
    if not isinstance(summary, dict):
        raise ValueError("媒体报告缺少库存汇总")
    return {
        "measuredAt": metadata.get("generatedAt"),
        "objectStatus": object_metadata.get("status"),
        "courses": int(summary.get("courses") or 0),
        "lessons": int(summary.get("lessons") or 0),
        "sourceVideos": {
            "objects": len(videos),
            "bytes": total_bytes,
            "durationSeconds": round(total_seconds, 2),
            "videoCodecs": dict(sorted(codecs.items())),
        },
        "covers": {
            "seriesDetail": int(summary.get("seriesCovers", {}).get("present") or 0),
            "seriesCard": int(summary.get("seriesCardCovers", {}).get("present") or 0),
            "lessons": int(summary.get("lessonCovers", {}).get("present") or 0),
        },
    }


def transcode_summary(batches: list[tuple[str, dict[str, Any]]]) -> dict[str, Any]:
    states: Counter[str] = Counter()
    lesson_ids: set[int] = set()
    job_ids: set[str] = set()
    activated = 0
    estimated_cost = 0.0
    pricing_dates: set[str] = set()

    for filename, batch in batches:
        if batch.get("environment") != "dev" or batch.get("freeTranscode") is not True:
            raise ValueError(f"{filename} 不是受保护的 dev 闲时转码批次")
        pricing = batch.get("pricing")
        if isinstance(pricing, dict) and pricing.get("asOf"):
            pricing_dates.add(str(pricing["asOf"]))
        items = batch.get("items")
        if not isinstance(items, list):
            raise ValueError(f"{filename} 缺少转码任务")
        for item in items:
            lesson_id = int(item.get("lessonId") or 0)
            if lesson_id <= 0 or lesson_id in lesson_ids:
                raise ValueError("转码批次包含重复或无效课时")
            lesson_ids.add(lesson_id)
            activated += int(bool(item.get("activated")))
            cost = float(item.get("estimatedIdleCostCny") or 0)
            if cost < 0:
                raise ValueError("转码批次包含无效费用估算")
            estimated_cost += cost
            variants = item.get("variants")
            if not isinstance(variants, list) or not variants:
                raise ValueError(f"课时 {lesson_id} 缺少转码档位")
            for variant in variants:
                state = str(variant.get("state") or "Missing")
                states[state] += 1
                job_id = str(variant.get("jobId") or "")
                if job_id:
                    if job_id in job_ids:
                        raise ValueError("转码批次包含重复任务")
                    job_ids.add(job_id)

    failed = states["Failed"]
    succeeded = states["Success"]
    pending = sum(count for state, count in states.items() if state not in {"Success", "Failed"})
    return {
        "batchArtifacts": [filename for filename, _ in batches],
        "batches": len(batches),
        "lessons": len(lesson_ids),
        "activatedLessons": activated,
        "jobs": sum(states.values()),
        "jobStates": dict(sorted(states.items())),
        "succeededJobs": succeeded,
        "failedJobs": failed,
        "pendingJobs": pending,
        "estimatedIdleCostCny": round(estimated_cost, 2),
        "costMeaning": "历史闲时转码价目估算，不是腾讯云实际账单",
        "pricingAsOf": sorted(pricing_dates),
    }


def current_delivery(conn: sqlite3.Connection) -> dict[str, int]:
    rows = conn.execute(
        """
        SELECT video_key, video_source_key
        FROM course_lessons
        WHERE status = 'published' AND video_key IS NOT NULL
        """
    ).fetchall()
    hls = sum(str(video_key or "").lower().endswith(".m3u8") for video_key, _ in rows)
    sources = sum(bool(str(source_key or "").strip()) for _, source_key in rows)
    return {
        "publishedVideoLessons": len(rows),
        "hlsLessons": hls,
        "sourceFilesRetained": sources,
    }


def build_report(
    conn: sqlite3.Connection,
    metadata: dict[str, Any],
    batches: list[tuple[str, dict[str, Any]]],
    start: datetime,
    end: datetime,
    metadata_filename: str,
) -> dict[str, Any]:
    inventory = inventory_summary(metadata)
    transcoding = transcode_summary(batches)
    usage = build_usage_report(conn, metadata, start, end)
    delivery = current_delivery(conn)

    alerts: list[dict[str, str]] = []
    if inventory["objectStatus"] != "probed":
        alerts.append({
            "severity": "error",
            "code": "inventory-incomplete",
            "message": "视频库存规格未完整读取",
        })
    if transcoding["failedJobs"]:
        alerts.append({
            "severity": "error",
            "code": "transcode-failed",
            "message": f"{transcoding['failedJobs']} 个转码任务失败",
        })
    if transcoding["pendingJobs"]:
        alerts.append({
            "severity": "warning",
            "code": "transcode-pending",
            "message": f"{transcoding['pendingJobs']} 个转码任务未完成",
        })
    if delivery["hlsLessons"] != delivery["publishedVideoLessons"]:
        alerts.append({
            "severity": "warning",
            "code": "delivery-not-fully-hls",
            "message": "仍有已发布课程未使用 HLS",
        })
    alerts.append({
        "severity": "info",
        "code": "external-costs-not-connected",
        "message": "腾讯云实际账单和出网流量尚未接入",
    })

    has_error = any(alert["severity"] == "error" for alert in alerts)
    return {
        "ok": not has_error,
        "status": "partial" if not has_error else "failed",
        "mode": "read-only",
        "environment": "dev",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "evidence": {
            "metadataArtifact": metadata_filename,
            "batchArtifacts": transcoding.pop("batchArtifacts"),
        },
        "inventory": inventory,
        "delivery": delivery,
        "transcoding": transcoding,
        "playAddressGrants": {
            "meaning": usage["meaning"],
            "window": usage["window"],
            "totals": usage["totals"],
            "rows": usage["rows"],
        },
        "externalCosts": {
            "tencentBilling": {"status": "not-connected"},
            "networkEgress": {"status": "not-connected"},
        },
        "alerts": alerts,
    }


def parse_args() -> argparse.Namespace:
    now = datetime.now(timezone.utc)
    parser = argparse.ArgumentParser(description="汇总 dev 课程媒体库存、转码和播放地址发放证据")
    parser.add_argument("--db", default=str(DEV_DB))
    parser.add_argument("--metadata")
    parser.add_argument("--batch-root", default=str(DEV_BATCH_ROOT))
    parser.add_argument("--from", dest="start", default=(now - timedelta(days=1)).isoformat())
    parser.add_argument("--to", dest="end", default=now.isoformat())
    parser.add_argument(
        "--require-external-costs",
        action="store_true",
        help="腾讯账单与出网流量未接入时返回状态码 2",
    )
    return parser.parse_args()


def main() -> int:
    try:
        args = parse_args()
        db_path = safe_file(args.db, expected=DEV_DB)
        batch_root = safe_directory(args.batch_root, DEV_BATCH_ROOT)
        metadata_path = (
            safe_file(args.metadata, root=DEV_AUDIT_ROOT)
            if args.metadata
            else latest_report(safe_directory(str(DEV_AUDIT_ROOT), DEV_AUDIT_ROOT))
        )
        batches = [(path.name, load_json(path)) for path in report_files(batch_root)]
        if not batches:
            raise ValueError("没有可用的 dev HLS 批次")
        metadata = load_json(metadata_path)
        conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
        try:
            conn.execute("PRAGMA query_only = ON")
            report = build_report(
                conn,
                metadata,
                batches,
                utc_timestamp(args.start),
                utc_timestamp(args.end),
                metadata_path.name,
            )
        finally:
            conn.close()
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if not report["ok"]:
            return 1
        return 2 if args.require_external_costs else 0
    except (OSError, sqlite3.Error, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

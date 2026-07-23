#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fcntl
import json
import sqlite3
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
sys.path.insert(0, str(ROOT / "scripts"))

import auth_api  # noqa: E402
import create_dev_hls_pilot as pilot  # noqa: E402


IDLE_RATES_CNY_PER_MINUTE = {"1080": 0.024, "720": 0.012, "480": 0.006}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_lesson_ids(value: str) -> list[int]:
    if not value.strip():
        return []
    return sorted({int(item.strip()) for item in value.split(",") if item.strip()})


def save_state(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


@contextmanager
def state_lock(path: Path):
    lock_path = path.with_suffix(path.suffix + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("w") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError("已有 HLS 批处理正在运行") from exc
        yield


def lessons_for_plan(db_path: Path, lesson_ids: list[int]) -> list[sqlite3.Row]:
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM course_lessons WHERE status = ? AND video_key IS NOT NULL ORDER BY id",
            ("published",),
        ).fetchall()
    selected = [row for row in rows if not lesson_ids or int(row["id"]) in lesson_ids]
    found = {int(row["id"]) for row in selected}
    missing = sorted(set(lesson_ids) - found)
    if missing:
        raise RuntimeError(f"课程不存在或未发布：{','.join(map(str, missing))}")
    return selected


def build_plan(db_path: Path, output_root: str, lesson_ids: list[int]) -> dict:
    pilot.require_dev_scope(db_path)
    items = []
    skipped = []
    for lesson in lessons_for_plan(db_path, lesson_ids):
        lesson_id = int(lesson["id"])
        video_key = str(lesson["video_key"] or "").strip()
        if pilot.auth_api.course_video_is_hls(video_key):
            skipped.append({"lessonId": lesson_id, "reason": "already-hls"})
            continue
        source_key = str(lesson["video_source_key"] or video_key).strip()
        source = auth_api.course_media_info(source_key)
        duration = float(source["duration"] or 0)
        variants = pilot.variant_specs(
            int(source["width"] or 0),
            int(source["height"] or 0),
            float(source["bitrateKbps"] or 0),
        )
        if len(variants) < 2 or duration <= 0:
            raise RuntimeError(f"课程 {lesson_id} 不适合自适应码率处理")
        prefix = f"{output_root.strip().strip('/')}/lesson-{lesson_id}"
        for variant in variants:
            variant["outputKey"] = f"{prefix}/{variant['name']}/index.hls.m3u8"
        estimated_cost = sum(
            duration / 60 * IDLE_RATES_CNY_PER_MINUTE[str(variant["name"])]
            for variant in variants
        )
        items.append({
            "lessonId": lesson_id,
            "title": str(lesson["title"] or ""),
            "originalVideoKey": video_key,
            "sourceKey": source_key,
            "sourceDuration": duration,
            "sourceWidth": int(source["width"] or 0),
            "sourceHeight": int(source["height"] or 0),
            "sourceBitrateKbps": float(source["bitrateKbps"] or 0),
            "prefix": prefix,
            "masterKey": f"{prefix}/master.m3u8",
            "variants": variants,
            "estimatedIdleCostCny": round(estimated_cost, 2),
            "activated": False,
        })
    return {
        "schemaVersion": 1,
        "environment": "dev",
        "pricing": {
            "region": "mainland-china",
            "asOf": "2026-06-05",
            "currency": "CNY",
            "idleRatesPerOutputMinute": IDLE_RATES_CNY_PER_MINUTE,
        },
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
        "database": str(db_path),
        "outputRoot": output_root.strip().strip("/"),
        "freeTranscode": True,
        "items": items,
        "skipped": skipped,
    }


def plan_summary(payload: dict) -> dict:
    return {
        "lessons": len(payload["items"]),
        "skipped": payload["skipped"],
        "sourceMinutes": round(sum(item["sourceDuration"] for item in payload["items"]) / 60, 2),
        "outputMinutes": round(
            sum(item["sourceDuration"] * len(item["variants"]) for item in payload["items"]) / 60,
            2,
        ),
        "estimatedIdleCostCny": round(
            sum(item["estimatedIdleCostCny"] for item in payload["items"]),
            2,
        ),
        "freeTranscode": True,
        "items": [
            {
                "lessonId": item["lessonId"],
                "source": f"{item['sourceWidth']}x{item['sourceHeight']}",
                "minutes": round(item["sourceDuration"] / 60, 2),
                "variants": [
                    f"{variant['name']}:{variant['width']}x{variant['height']}@{variant['bitrate']}k"
                    for variant in item["variants"]
                ],
                "estimatedIdleCostCny": item["estimatedIdleCostCny"],
            }
            for item in payload["items"]
        ],
    }


def submit(payload: dict, state_path: Path) -> None:
    payload.setdefault("submittedAt", now_iso())
    save_state(state_path, payload)
    for item in payload["items"]:
        for variant in item["variants"]:
            if variant.get("jobId"):
                continue
            job_id = pilot.submit_variant(
                item["sourceKey"],
                variant["outputKey"],
                int(variant["width"]),
                int(variant["height"]),
                int(variant["bitrate"]),
            )
            variant["jobId"] = job_id
            variant["state"] = "Submitted"
            payload["updatedAt"] = now_iso()
            save_state(state_path, payload)


def lesson_row(db_path: Path, lesson_id: int) -> sqlite3.Row:
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM course_lessons WHERE id = ?", (lesson_id,)).fetchone()
    if not row:
        raise RuntimeError(f"课程 {lesson_id} 不存在")
    return row


def reconcile(payload: dict, state_path: Path, activate: bool) -> dict:
    db_path = Path(payload["database"])
    pilot.require_dev_scope(db_path)
    summary = {"pending": [], "failed": [], "ready": [], "activated": []}
    for item in payload["items"]:
        if item.get("activated"):
            summary["activated"].append(item["lessonId"])
            continue
        for variant in item["variants"]:
            if not variant.get("jobId"):
                raise RuntimeError(f"课程 {item['lessonId']} 状态不完整，请先续提任务")
            status = auth_api.course_transcode_job(str(variant["jobId"]))
            variant["state"] = status["state"]
            if status["state"] == "Failed":
                variant["error"] = f"{status['code']} {status['message']}".strip()
        failed = [variant for variant in item["variants"] if variant["state"] == "Failed"]
        pending = [
            variant for variant in item["variants"]
            if variant["state"] not in {"Success", "Failed"}
        ]
        if failed:
            summary["failed"].append(item["lessonId"])
            continue
        if pending:
            summary["pending"].append(item["lessonId"])
            continue
        checks = {
            str(variant["name"]): pilot.playlist_summary(
                str(variant["outputKey"]),
                float(item["sourceDuration"]),
            )
            for variant in item["variants"]
        }
        master = pilot.master_playlist(item["variants"])
        pilot.upload_master(item["masterKey"], master)
        if auth_api.fetch_course_cos_text(item["masterKey"]) != master:
            raise RuntimeError(f"课程 {item['lessonId']} 主清单上传后内容不一致")
        item["checks"] = checks
        item["readyAt"] = now_iso()
        summary["ready"].append(item["lessonId"])
        if activate:
            current = lesson_row(db_path, int(item["lessonId"]))
            current_key = str(current["video_key"] or "").strip()
            if current_key == item["masterKey"]:
                item["activated"] = True
            elif current_key != item["originalVideoKey"]:
                raise RuntimeError(f"课程 {item['lessonId']} 已被其他操作修改，停止切换")
            else:
                item["backup"] = str(pilot.activate_lesson(db_path, current, item["masterKey"]))
                item["activated"] = True
            item["activatedAt"] = now_iso()
            summary["activated"].append(item["lessonId"])
        payload["updatedAt"] = now_iso()
        save_state(state_path, payload)
    payload["updatedAt"] = now_iso()
    save_state(state_path, payload)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Plan and run resumable dev-only idle HLS batches.")
    parser.add_argument("--db", type=Path, default=auth_api.DB_PATH)
    parser.add_argument("--lesson-ids", default="")
    parser.add_argument("--output-root", default=f"lesson/hls/dev-batch/{datetime.now(timezone.utc):%Y%m%d}")
    parser.add_argument("--state", type=Path)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--plan", action="store_true")
    action.add_argument("--submit", action="store_true")
    action.add_argument("--reconcile", action="store_true")
    parser.add_argument("--activate", action="store_true")
    args = parser.parse_args()

    if args.activate and not args.reconcile:
        raise RuntimeError("--activate 只能与 --reconcile 一起使用")
    if (args.submit or args.reconcile) and not args.state:
        raise RuntimeError("提交和核对任务必须指定 --state")

    lesson_ids = parse_lesson_ids(args.lesson_ids)
    if args.plan:
        payload = build_plan(args.db, args.output_root, lesson_ids)
        print(json.dumps(plan_summary(payload), ensure_ascii=False, indent=2))
        return 0

    assert args.state is not None
    with state_lock(args.state):
        if args.submit:
            payload = (
                json.loads(args.state.read_text(encoding="utf-8"))
                if args.state.exists()
                else build_plan(args.db, args.output_root, lesson_ids)
            )
            if payload.get("environment") != "dev" or not payload.get("freeTranscode"):
                raise RuntimeError("批次状态不是受保护的 dev 闲时转码任务")
            submit(payload, args.state)
            print(json.dumps({
                "submitted": len(payload["items"]),
                "jobs": sum(len(item["variants"]) for item in payload["items"]),
                "state": str(args.state),
                **plan_summary(payload),
            }, ensure_ascii=False, indent=2))
            return 0

        payload = json.loads(args.state.read_text(encoding="utf-8"))
        if payload.get("environment") != "dev" or not payload.get("freeTranscode"):
            raise RuntimeError("批次状态不是受保护的 dev 闲时转码任务")
        print(json.dumps(reconcile(payload, args.state, args.activate), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

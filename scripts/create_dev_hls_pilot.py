#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

import auth_api  # noqa: E402


VARIANTS = (
    {"name": "1080", "width": 1920, "height": 1080, "bitrate": 900},
    {"name": "720", "width": 1280, "height": 720, "bitrate": 650},
    {"name": "480", "width": 854, "height": 480, "bitrate": 350},
)


def require_dev_scope(db_path: Path) -> None:
    if "-dev-" not in auth_api.COURSE_COS_BUCKET or "dev" not in str(db_path).lower():
        raise RuntimeError("仅允许在 dev COS 和 dev 数据库运行")


def build_hls_job_body(source_key: str, output_key: str, height: int, bitrate: int) -> bytes:
    return auth_api.xml_request_body({
        "Tag": "GeneratePlayList",
        "Input": {"Object": source_key},
        "Operation": {
            "Transcode": {
                "Container": {"Format": "hls", "ClipConfig": {"Duration": "5"}},
                "Video": {
                    "Codec": "H.264",
                    "Profile": "high",
                    "Bitrate": str(bitrate),
                    "Height": str(height),
                    "Fps": "30",
                    "Preset": "medium",
                },
                "Audio": {"Codec": "aac", "Samplerate": "44100", "Bitrate": "96", "Channels": "2"},
            },
            "Output": {
                "Region": auth_api.COURSE_COS_REGION,
                "Bucket": auth_api.COURSE_COS_BUCKET,
                "Object": output_key.replace(".m3u8", ".${ext}"),
            },
            "UserData": "dongbimao-dev-hls-pilot",
            "JobLevel": "0",
        },
    })


def submit_variant(source_key: str, output_key: str, height: int, bitrate: int) -> str:
    root = auth_api.qcloud_xml_request(
        "POST",
        auth_api.course_ci_endpoint(),
        "/jobs",
        body=build_hls_job_body(source_key, output_key, height, bitrate),
    )
    job_id = auth_api.xml_value(root, "./JobsDetail/JobId")
    if not job_id:
        raise RuntimeError(auth_api.xml_value(root, "./JobsDetail/Message", "HLS 任务创建失败"))
    return job_id


def wait_for_jobs(jobs: dict[str, str], timeout_seconds: int) -> None:
    deadline = time.monotonic() + timeout_seconds
    pending = dict(jobs)
    while pending:
        for name, job_id in list(pending.items()):
            status = auth_api.course_transcode_job(job_id)
            if status["state"] == "Success":
                del pending[name]
            elif status["state"] == "Failed":
                raise RuntimeError(f"{name} HLS 转码失败：{status['code']} {status['message']}".strip())
        if pending:
            if time.monotonic() >= deadline:
                raise TimeoutError("HLS 转码等待超时")
            time.sleep(10)


def playlist_summary(key: str, source_duration: float) -> dict[str, float | int]:
    content = auth_api.fetch_course_cos_text(key)
    if not content.lstrip().startswith("#EXTM3U"):
        raise RuntimeError(f"{key} 不是有效 HLS 播放清单")
    durations = []
    segment_count = 0
    first_segment = ""
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if line.startswith("#EXTINF:"):
            durations.append(float(line.removeprefix("#EXTINF:").split(",", 1)[0]))
        elif line and not line.startswith("#"):
            segment_count += 1
            first_segment = first_segment or line
    duration = sum(durations)
    if segment_count <= 0 or not first_segment:
        raise RuntimeError(f"{key} 没有视频分片")
    if abs(duration - source_duration) > max(6.0, source_duration * 0.01):
        raise RuntimeError(f"{key} 时长与源视频不一致")
    segment_key = auth_api.resolve_course_hls_key(
        str(Path(key).parent).replace("\\", "/"),
        key,
        first_segment,
    )
    request = urllib.request.Request(
        auth_api.signed_course_cos_url(segment_key, method="get", ttl=120),
        headers={"Range": "bytes=0-0"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.status not in {200, 206}:
            raise RuntimeError(f"{key} 分片不可读取")
        response.read(1)
    return {"duration": round(duration, 3), "segments": segment_count}


def upload_master(master_key: str, content: str) -> None:
    raw = content.encode("utf-8")
    request = urllib.request.Request(
        auth_api.signed_course_cos_url(master_key, method="put", ttl=600),
        data=raw,
        headers={"Content-Type": "application/vnd.apple.mpegurl", "Content-Length": str(len(raw))},
        method="PUT",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"HLS 主清单上传失败：HTTP {response.status}")


def master_playlist(variants: list[dict[str, int | str]]) -> str:
    lines = ["#EXTM3U", "#EXT-X-VERSION:3"]
    for variant in variants:
        width = int(variant["width"])
        height = int(variant["height"])
        bandwidth = (int(variant["bitrate"]) + 96) * 1000
        lines.extend([
            f"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},RESOLUTION={width}x{height}",
            f"{variant['name']}/index.m3u8",
        ])
    return "\n".join(lines) + "\n"


def activate_lesson(db_path: Path, lesson: sqlite3.Row, master_key: str) -> Path:
    backup_dir = Path("/root/dongbimao-backups")
    backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = backup_dir / f"dev-hls-lesson-{lesson['id']}-{stamp}.json"
    backup_path.write_text(json.dumps(dict(lesson), ensure_ascii=False, indent=2), encoding="utf-8")
    backup_path.chmod(0o600)
    source_key = str(lesson["video_source_key"] or lesson["video_key"]).strip()
    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute(
            """
            UPDATE course_lessons
            SET video_key = ?, video_source_key = ?, video_output_key = ?, video_status = 'ready',
                video_process_error = NULL, updated_at = ?
            WHERE id = ? AND video_key = ?
            """,
            (master_key, source_key, master_key, auth_api.now_iso(), lesson["id"], lesson["video_key"]),
        )
        if cursor.rowcount != 1:
            raise RuntimeError("课程记录已变化，停止启用 HLS")
    return backup_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Create one dev-only HLS playback pilot.")
    parser.add_argument("--db", type=Path, default=auth_api.DB_PATH)
    parser.add_argument("--lesson-id", type=int, required=True)
    parser.add_argument("--output-prefix", required=True)
    parser.add_argument("--activate", action="store_true")
    parser.add_argument("--timeout-seconds", type=int, default=7200)
    args = parser.parse_args()

    require_dev_scope(args.db)
    with sqlite3.connect(args.db) as conn:
        conn.row_factory = sqlite3.Row
        lesson = conn.execute("SELECT * FROM course_lessons WHERE id = ?", (args.lesson_id,)).fetchone()
    if not lesson:
        raise RuntimeError("课程视频不存在")
    source_key = str(lesson["video_source_key"] or lesson["video_key"]).strip()
    if not source_key or source_key.lower().endswith(".m3u8"):
        raise RuntimeError("课程没有可用的原始 MP4")
    source = auth_api.course_media_info(source_key)
    source_width = int(source["width"] or 0)
    source_height = int(source["height"] or 0)
    source_bitrate = float(source["bitrateKbps"] or 0)
    if source_width <= 0 or source_height <= 0 or source_bitrate <= 0:
        raise RuntimeError("源视频规格不可用")

    prefix = args.output_prefix.strip().strip("/")
    variants = [
        item for item in VARIANTS
        if (
            int(item["width"]) <= source_width
            and int(item["height"]) <= source_height
            and int(item["bitrate"]) < source_bitrate
        )
    ]
    if len(variants) < 2:
        raise RuntimeError("源视频不适合自适应码率试点")

    jobs = {}
    output_keys = {}
    for variant in variants:
        name = str(variant["name"])
        output_key = f"{prefix}/{name}/index.m3u8"
        jobs[name] = submit_variant(
            source_key,
            output_key,
            int(variant["height"]),
            int(variant["bitrate"]),
        )
        output_keys[name] = output_key
    wait_for_jobs(jobs, args.timeout_seconds)

    checks = {
        name: playlist_summary(output_keys[name], float(source["duration"] or 0))
        for name in output_keys
    }
    master_key = f"{prefix}/master.m3u8"
    master = master_playlist(variants)
    upload_master(master_key, master)
    if auth_api.fetch_course_cos_text(master_key) != master:
        raise RuntimeError("HLS 主清单上传后内容不一致")

    backup_path = activate_lesson(args.db, lesson, master_key) if args.activate else None
    print(json.dumps({
        "lessonId": args.lesson_id,
        "sourceKey": source_key,
        "masterKey": master_key,
        "variants": checks,
        "activated": bool(backup_path),
        "backup": str(backup_path) if backup_path else "",
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

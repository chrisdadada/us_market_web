#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qsl, urlsplit, urlunsplit


ROOT = Path(__file__).resolve().parents[1]
REPORT_ROOT = ROOT / ".local" / "media-delivery-audits"
CLOUDFLARE_FREE_MAX_BYTES = 512 * 1024 * 1024
SIGNED_QUERY_NAMES = {
    "q-sign-algorithm",
    "q-ak",
    "q-sign-time",
    "q-key-time",
    "q-signature",
    "x-amz-algorithm",
    "x-amz-credential",
    "x-amz-date",
    "x-amz-expires",
    "x-amz-signature",
}


def public_url(value: str) -> str:
    parsed = urlsplit(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("媒体地址必须是完整的 HTTP(S) URL")
    if parsed.username or parsed.password:
        raise ValueError("媒体地址不能包含账号信息")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))


def has_signed_query(value: str) -> bool:
    names = {name.lower() for name, _ in parse_qsl(urlsplit(value).query, keep_blank_values=True)}
    return bool(names & SIGNED_QUERY_NAMES)


def total_bytes(status: int, headers: dict[str, str]) -> int | None:
    content_range = headers.get("content-range", "")
    match = re.fullmatch(r"bytes\s+\d+-\d+/(\d+|\*)", content_range, flags=re.IGNORECASE)
    if match and match.group(1) != "*":
        return int(match.group(1))
    content_length = headers.get("content-length", "")
    if status == 200 and content_length.isdigit():
        return int(content_length)
    return None


def selected_headers(headers: Any) -> dict[str, str]:
    allowed = {
        "accept-ranges",
        "age",
        "cache-control",
        "cf-cache-status",
        "content-length",
        "content-range",
        "content-type",
        "server",
        "via",
        "x-cache",
        "x-cache-lookup",
    }
    return {
        str(name).lower(): str(value)
        for name, value in headers.items()
        if str(name).lower() in allowed
    }


def range_request(
    url: str,
    *,
    timeout: int,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> dict[str, Any]:
    started_at = time.monotonic()
    request = urllib.request.Request(
        url,
        headers={"Range": "bytes=0-0", "User-Agent": "dongbimao-media-audit/1.0"},
    )
    with opener(request, timeout=timeout) as response:
        response.read(1)
        headers = selected_headers(response.headers)
        status = int(response.status)
        return {
            "status": status,
            "headers": headers,
            "totalBytes": total_bytes(status, headers),
            "rangeSupported": status == 206 and headers.get("content-range", "").lower().startswith("bytes "),
            "elapsedMs": round((time.monotonic() - started_at) * 1000, 1),
        }


def cache_hit(attempt: dict[str, Any]) -> bool:
    headers = attempt.get("headers", {})
    cf_status = str(headers.get("cf-cache-status", "")).upper()
    vendor_status = " ".join(
        str(headers.get(name, "")).upper() for name in ("x-cache", "x-cache-lookup")
    )
    return cf_status == "HIT" or "HIT" in vendor_status


def probe_url(
    url: str,
    *,
    private: bool = True,
    timeout: int = 20,
    attempts_count: int = 2,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> dict[str, Any]:
    display_url = public_url(url)
    signed = has_signed_query(url)
    attempts: list[dict[str, Any]] = []
    error = ""
    for _ in range(max(1, min(attempts_count, 2))):
        try:
            attempts.append(range_request(url, timeout=timeout, opener=opener))
        except urllib.error.HTTPError as exc:
            error = f"HTTP {exc.code}"
            break
        except (OSError, urllib.error.URLError, ValueError):
            error = "请求失败"
            break

    size = next((item["totalBytes"] for item in attempts if item.get("totalBytes") is not None), None)
    range_supported = bool(attempts) and all(bool(item.get("rangeSupported")) for item in attempts)
    hit_observed = any(cache_hit(item) for item in attempts[1:])
    issues: list[str] = []
    if error:
        issues.append("媒体请求失败")
    if attempts and not range_supported:
        issues.append("未确认分段读取，视频拖动和回源成本存在风险")
    if size is None:
        issues.append("未取得完整文件大小，无法判断 Cloudflare Free 缓存资格")
    elif size > CLOUDFLARE_FREE_MAX_BYTES:
        issues.append("文件超过 Cloudflare Free 512 MB 缓存上限")
    if private and signed:
        issues.append("检测到短期签名；不得直接忽略查询参数，必须先鉴权再复用缓存")
    if attempts_count > 1 and len(attempts) == 2 and not hit_observed:
        issues.append("连续请求未观察到 CDN 缓存命中")

    return {
        "url": display_url,
        "private": private,
        "signedQueryDetected": signed,
        "queryStored": False,
        "totalBytes": size,
        "rangeSupported": range_supported,
        "cacheHitObserved": hit_observed,
        "cloudflareFree": {
            "maxCacheableBytes": CLOUDFLARE_FREE_MAX_BYTES,
            "withinSizeLimit": None if size is None else size <= CLOUDFLARE_FREE_MAX_BYTES,
        },
        "attempts": attempts,
        "issues": issues,
        "error": error,
    }


def write_report(path_value: str, payload: dict[str, Any], report_root: Path = REPORT_ROOT) -> Path:
    root = report_root.expanduser().resolve()
    path = Path(path_value).expanduser().resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValueError("报告只能写入 .local/media-delivery-audits") from exc
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    return path


def summarize(targets: list[dict[str, Any]]) -> dict[str, Any]:
    sizes = [int(item["totalBytes"]) for item in targets if item.get("totalBytes") is not None]
    first_attempt_ms = [
        float(item["attempts"][0]["elapsedMs"])
        for item in targets
        if item.get("attempts") and item["attempts"][0].get("elapsedMs") is not None
    ]
    return {
        "targets": len(targets),
        "totalBytes": sum(sizes),
        "rangeSupported": sum(bool(item.get("rangeSupported")) for item in targets),
        "cacheHitsObserved": sum(bool(item.get("cacheHitObserved")) for item in targets),
        "signedUrls": sum(bool(item.get("signedQueryDetected")) for item in targets),
        "cloudflareFreeWithinSizeLimit": sum(
            item["cloudflareFree"].get("withinSizeLimit") is True for item in targets
        ),
        "cloudflareFreeOverSizeLimit": sum(
            item["cloudflareFree"].get("withinSizeLimit") is False for item in targets
        ),
        "unknownSizes": len(targets) - len(sizes),
        "failed": sum(bool(item.get("error")) for item in targets),
        "firstAttemptSamples": len(first_attempt_ms),
        "medianFirstAttemptMs": round(statistics.median(first_attempt_ms), 1) if first_attempt_ms else None,
        "slowestFirstAttemptMs": round(max(first_attempt_ms), 1) if first_attempt_ms else None,
    }


def meets_requirements(
    target: dict[str, Any],
    *,
    require_range: bool = False,
    require_cache_hit: bool = False,
) -> bool:
    return bool(
        not target.get("error")
        and (not require_range or target.get("rangeSupported"))
        and (not require_cache_hit or target.get("cacheHitObserved"))
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="只读检查媒体 Range、缓存命中和 Cloudflare Free 适配性")
    parser.add_argument("--url", action="append", default=[], help="媒体 URL；签名 URL 建议通过 --stdin 传入")
    parser.add_argument("--stdin", action="store_true", help="从标准输入逐行读取 URL，避免签名出现在进程参数中")
    parser.add_argument("--public", action="store_true", help="标记为公开静态资源；默认按私有课程媒体检查")
    parser.add_argument("--attempts", type=int, choices=(1, 2), default=2, help="每个地址请求次数；清点大小时可设为 1")
    parser.add_argument("--summary-only", action="store_true", help="只输出汇总和超过 Cloudflare Free 上限的对象")
    parser.add_argument("--require-range", action="store_true", help="缺少 Range 时以失败退出")
    parser.add_argument("--require-cache-hit", action="store_true", help="第二次请求未命中缓存时以失败退出")
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--output")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    urls = list(args.url)
    if args.stdin:
        urls.extend(line.strip() for line in sys.stdin if line.strip())
    if not urls:
        print(json.dumps({"ok": False, "error": "至少提供一个媒体 URL"}, ensure_ascii=False))
        return 2
    if args.require_cache_hit and args.attempts != 2:
        print(json.dumps({"ok": False, "error": "检查缓存命中必须请求两次"}, ensure_ascii=False))
        return 2
    targets = [
        probe_url(
            url,
            private=not args.public,
            timeout=max(1, args.timeout),
            attempts_count=args.attempts,
        )
        for url in urls
    ]
    payload = {
        "ok": True,
        "mode": "read-only",
        "summary": summarize(targets),
        "cloudflareFreeOverSizeLimit": [
            {"url": item["url"], "totalBytes": item["totalBytes"]}
            for item in targets
            if item["cloudflareFree"].get("withinSizeLimit") is False
        ],
        "requirements": {
            "range": args.require_range,
            "cacheHit": args.require_cache_hit,
        },
    }
    if not args.summary_only:
        payload["targets"] = targets
    payload["ok"] = all(
        meets_requirements(
            item,
            require_range=args.require_range,
            require_cache_hit=args.require_cache_hit,
        )
        for item in targets
    )
    try:
        if args.output:
            report = write_report(args.output, payload)
            print(json.dumps({"ok": payload["ok"], "report": str(report)}, ensure_ascii=False))
        else:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0 if payload["ok"] else 1
    except (OSError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

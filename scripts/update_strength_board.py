#!/usr/bin/env python3
"""Run the full daily refresh for the strength board."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from build_strength_scanner import DEFAULT_DATA_ROOT, build_scanner
from review_strength_snapshots import build_review


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--scanner-output", type=Path, default=None)
    parser.add_argument("--review-output", type=Path, default=None)
    parser.add_argument("--snapshot-dir", type=Path, default=None)
    parser.add_argument("--status-output", type=Path, default=None)
    parser.add_argument("--min-adv", type=float, default=5_000_000)
    parser.add_argument("--limit", type=int, default=40)
    parser.add_argument("--horizons", default="1,3,5,20")
    args = parser.parse_args()

    horizons = [int(item.strip()) for item in args.horizons.split(",") if item.strip()]
    scanner = build_scanner(
        data_root=args.data_root,
        output=args.scanner_output,
        snapshot_dir=args.snapshot_dir,
        min_adv=args.min_adv,
        limit=args.limit,
    )
    review = build_review(args.data_root, args.snapshot_dir, horizons) if args.snapshot_dir is not None else {
        "summary": "",
        "horizons": [],
        "labels": [],
        "buckets": [],
    }
    if args.review_output is not None:
        args.review_output.parent.mkdir(parents=True, exist_ok=True)
        args.review_output.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    status = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "asOf": scanner["asOf"],
        "ok": True,
        "scannerOutput": str(args.scanner_output) if args.scanner_output else None,
        "reviewOutput": str(args.review_output) if args.review_output else None,
        "snapshotDir": str(args.snapshot_dir) if args.snapshot_dir else None,
        "summary": f"已刷新 {scanner['universe']['total']} 只股票，并更新历史验证。",
    }
    if args.status_output is not None:
        args.status_output.parent.mkdir(parents=True, exist_ok=True)
        args.status_output.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(status["summary"])


if __name__ == "__main__":
    main()

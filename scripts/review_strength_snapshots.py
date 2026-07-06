#!/usr/bin/env python3
"""Review saved strength snapshots against later market performance."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd


DEFAULT_DATA_ROOT = Path("/Volumes/Extreme SSD/market-data-lab/data")


def now_utc() -> str:
    return datetime.now(UTC).isoformat()


def fmt_pct(value: float | None, digits: int = 1) -> str:
    if value is None or pd.isna(value):
        return "--"
    sign = "+" if value >= 0 else ""
    return f"{sign}{value:.{digits}f}%"


def year_files(root: Path, start_year: int, end_year: int) -> list[Path]:
    files = []
    for year in range(start_year, end_year + 1):
        path = root / f"daily_split_adjusted_{year}.parquet"
        if path.exists():
            files.append(path)
    return files


def load_close_panel(data_root: Path, start_year: int, end_year: int) -> pd.DataFrame:
    root = data_root / "processed" / "polygon" / "stocks_split_adjusted" / "1d"
    files = year_files(root, start_year, end_year)
    if not files:
        raise FileNotFoundError(f"No daily adjusted files found in {root}")
    frames = [
        pd.read_parquet(path, columns=["symbol", "trade_date", "adj_close"])
        for path in files
    ]
    daily = pd.concat(frames, ignore_index=True)
    daily["trade_date"] = daily["trade_date"].astype(str)
    return daily.pivot(index="trade_date", columns="symbol", values="adj_close").ffill()


def load_snapshots(snapshot_dir: Path) -> list[dict]:
    snapshots = []
    for path in sorted(snapshot_dir.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if payload.get("asOf") and payload.get("rows"):
            snapshots.append(payload)
    return snapshots


def horizon_date(dates: list[str], start_date: str, horizon: int) -> str | None:
    try:
        index = dates.index(start_date)
    except ValueError:
        return None
    target = index + horizon
    if target >= len(dates):
        return None
    return dates[target]


def summarize(group: pd.DataFrame, name: str, horizon: int) -> dict:
    return {
        "name": name,
        "horizon": f"T+{horizon}",
        "count": int(len(group)),
        "hitRate": fmt_pct(float((group["excess"] > 0).mean() * 100), 0),
        "avgReturn": fmt_pct(float(group["futureReturn"].mean())),
        "vsSpy": fmt_pct(float(group["excess"].mean())),
    }


def build_review(data_root: Path, snapshot_dir: Path, horizons: list[int]) -> dict:
    snapshots = load_snapshots(snapshot_dir)
    if not snapshots:
        return {
            "generatedAt": now_utc(),
            "summary": "还没有可验证的历史记录。",
            "horizons": [],
            "labels": [],
            "buckets": [],
        }

    years = [int(item["asOf"][:4]) for item in snapshots]
    current_year = datetime.now().year
    close = load_close_panel(data_root, min(years), current_year)
    dates = list(close.index)
    rows = []

    for snapshot in snapshots:
        start_date = snapshot["asOf"]
        if start_date not in close.index or "SPY" not in close.columns:
            continue
        start_prices = close.loc[start_date]
        spy_start = start_prices.get("SPY")
        if pd.isna(spy_start) or not spy_start:
            continue

        for horizon in horizons:
            end_date = horizon_date(dates, start_date, horizon)
            if not end_date:
                continue
            end_prices = close.loc[end_date]
            spy_end = end_prices.get("SPY")
            if pd.isna(spy_end) or not spy_end:
                continue
            spy_return = (float(spy_end) / float(spy_start) - 1) * 100

            for item in snapshot.get("rows", []):
                symbol = item.get("symbol")
                if symbol not in close.columns:
                    continue
                start_price = start_prices.get(symbol)
                end_price = end_prices.get(symbol)
                if pd.isna(start_price) or pd.isna(end_price) or not start_price:
                    continue
                future_return = (float(end_price) / float(start_price) - 1) * 100
                rows.append(
                    {
                        "snapshotDate": start_date,
                        "endDate": end_date,
                        "horizon": horizon,
                        "symbol": symbol,
                        "bucket": item.get("bucket", "watchlist"),
                        "label": item.get("label", "未分类"),
                        "reason": item.get("primaryFactor", "综合表现"),
                        "futureReturn": future_return,
                        "spyReturn": spy_return,
                        "excess": future_return - spy_return,
                    }
                )

    if not rows:
        return {
            "generatedAt": now_utc(),
            "summary": "已经有记录，但还没走完验证周期。",
            "horizons": [],
            "labels": [],
            "buckets": [],
        }

    df = pd.DataFrame(rows)
    horizon_rows = [
        summarize(group, "全部清单", horizon)
        for horizon, group in df.groupby("horizon")
    ]
    label_rows = [
        summarize(group, label, int(group["horizon"].iloc[0]))
        for (label, _horizon), group in df.groupby(["label", "horizon"])
        if len(group) >= 3
    ]
    bucket_names = {
        "strongest": "优先研究",
        "weakest": "风险回避",
        "watchlist": "等回踩",
    }
    bucket_rows = [
        summarize(group, bucket_names.get(bucket, bucket), int(group["horizon"].iloc[0]))
        for (bucket, _horizon), group in df.groupby(["bucket", "horizon"])
        if len(group) >= 3
    ]
    label_rows = sorted(label_rows, key=lambda item: (item["horizon"], item["vsSpy"]), reverse=True)
    bucket_rows = sorted(bucket_rows, key=lambda item: (item["horizon"], item["vsSpy"]), reverse=True)

    return {
        "generatedAt": now_utc(),
        "summary": f"已验证 {len(df)} 条历史记录，重点看后续是否强于 SPY。",
        "horizons": horizon_rows,
        "labels": label_rows,
        "buckets": bucket_rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--snapshot-dir", type=Path, default=Path(".tmp/strength-snapshots"))
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--horizons", default="1,3,5,20")
    args = parser.parse_args()

    horizons = [int(item.strip()) for item in args.horizons.split(",") if item.strip()]
    payload = build_review(args.data_root, args.snapshot_dir, horizons)
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {args.output}: {payload['summary']}")
    else:
        print(payload["summary"])


if __name__ == "__main__":
    main()

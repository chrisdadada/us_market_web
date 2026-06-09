from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from time import sleep
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import pandas as pd
import requests

from common import data_path, env, load_env, parse_date, write_parquet


BASE_URL = "https://api.polygon.io"
RAW_ROOT = ("raw", "polygon_rest")


DATASETS = {
    "short_interest": {
        "path": "/stocks/v1/short-interest",
        "date_field": "settlement_date",
        "sort": "settlement_date",
    },
    "short_volume": {
        "path": "/stocks/v1/short-volume",
        "date_field": "date",
        "sort": "date",
    },
    "earnings": {
        "path": "/benzinga/v1/earnings",
        "date_field": "date",
        "sort": "date",
    },
    "analyst_insights": {
        "path": "/benzinga/v1/analyst-insights",
        "date_field": "date",
        "sort": "date",
    },
    "guidance": {
        "path": "/benzinga/v1/guidance",
        "date_field": "date",
        "sort": "date",
    },
    "polygon_news": {
        "path": "/v2/reference/news",
        "date_field": "published_utc",
        "sort": "published_utc",
        "max_limit": 1000,
    },
    "benzinga_news": {
        "path": "/benzinga/v2/news",
        "date_field": "published",
        "sort": "published",
        "max_limit": 100,
    },
    "financials": {
        "path": "/vX/reference/financials",
        "date_field": "filing_date",
        "sort": "filing_date",
        "max_limit": 100,
    },
}


def with_api_key(url: str, api_key: str) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.setdefault("apiKey", api_key)
    return urlunparse(parsed._replace(query=urlencode(query)))


def get_json(session: requests.Session, url: str, params: dict, api_key: str) -> dict:
    response = session.get(with_api_key(url, api_key), params=params, timeout=90)
    if response.status_code != 200:
        raise RuntimeError(f"{url}: {response.status_code} {response.text[:500]}")
    data = response.json()
    if data.get("status") in {"ERROR", "NOT_AUTHORIZED"}:
        raise RuntimeError(f"{url}: {data}")
    return data


def paginate(
    session: requests.Session,
    path: str,
    params: dict,
    api_key: str,
    pause: float,
    progress_label: str,
) -> pd.DataFrame:
    url = f"{BASE_URL}{path}"
    rows: list[dict] = []
    pages = 0
    request_ids: list[str] = []

    while url:
        data = get_json(session, url, params, api_key)
        pages += 1
        if data.get("request_id"):
            request_ids.append(data["request_id"])
        results = data.get("results") or []
        if isinstance(results, dict):
            results = [results]
        rows.extend(results)

        if pages % 10 == 0:
            print(f"{progress_label} pages={pages:,} rows={len(rows):,}", flush=True)

        next_url = data.get("next_url")
        url = with_api_key(next_url, api_key) if next_url else ""
        params = {}
        if pause:
            sleep(pause)

    df = pd.DataFrame(rows)
    if not df.empty:
        df["downloaded_at_utc"] = datetime.now(timezone.utc).isoformat()
        df["polygon_request_ids"] = ",".join(request_ids[:25])
    return df


def year_ranges(start: date, end: date) -> list[tuple[date, date]]:
    ranges: list[tuple[date, date]] = []
    current = date(start.year, 1, 1)
    while current <= end:
        chunk_start = max(start, current)
        chunk_end = min(end, date(current.year, 12, 31))
        ranges.append((chunk_start, chunk_end))
        current = date(current.year + 1, 1, 1)
    return ranges


def month_ranges(start: date, end: date) -> list[tuple[date, date]]:
    ranges: list[tuple[date, date]] = []
    current = date(start.year, start.month, 1)
    while current <= end:
        if current.month == 12:
            next_month = date(current.year + 1, 1, 1)
        else:
            next_month = date(current.year, current.month + 1, 1)
        ranges.append((max(start, current), min(end, next_month - timedelta(days=1))))
        current = next_month
    return ranges


def chunk_ranges(start: date, end: date, chunk: str) -> list[tuple[date, date]]:
    if chunk == "year":
        return year_ranges(start, end)
    if chunk == "month":
        return month_ranges(start, end)
    if chunk == "day":
        ranges: list[tuple[date, date]] = []
        current = start
        while current <= end:
            ranges.append((current, current))
            current += timedelta(days=1)
        return ranges
    raise ValueError(f"Unsupported chunk: {chunk}")


def out_path(dataset: str, chunk_start: date, chunk_end: date) -> Path:
    return data_path(*RAW_ROOT, dataset, f"{dataset}_{chunk_start:%Y%m%d}_{chunk_end:%Y%m%d}.parquet")


def write_empty_marker(path: Path) -> None:
    marker = path.with_suffix(".empty")
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(datetime.now(timezone.utc).isoformat() + "\n")


def download_dataset(
    session: requests.Session,
    api_key: str,
    dataset: str,
    start: date,
    end: date,
    pause: float,
    overwrite: bool,
    limit: int,
    chunk: str,
) -> list[Path]:
    spec = DATASETS[dataset]
    saved: list[Path] = []
    date_field = spec["date_field"]

    for chunk_start, chunk_end in chunk_ranges(start, end, chunk):
        path = out_path(dataset, chunk_start, chunk_end)
        marker = path.with_suffix(".empty")
        if not overwrite and (path.exists() or marker.exists()):
            print(f"skip {dataset} {chunk_start}..{chunk_end}", flush=True)
            continue

        request_limit = min(limit, int(spec.get("max_limit", limit)))
        params = {
            "limit": request_limit,
            "sort": spec["sort"],
            "order": "asc",
            f"{date_field}.gte": chunk_start.isoformat(),
            f"{date_field}.lte": chunk_end.isoformat(),
        }
        label = f"{dataset} {chunk_start}..{chunk_end}"
        print(label, flush=True)
        df = paginate(session, spec["path"], params, api_key, pause, label)
        if df.empty:
            print(f"empty {label}", flush=True)
            write_empty_marker(path)
            continue

        df["source"] = "polygon"
        df["endpoint"] = spec["path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        write_parquet(df, path)
        print(f"saved {path} rows={len(df):,}", flush=True)
        saved.append(path)

    return saved


def summarize_dataset(dataset: str) -> dict:
    folder = data_path(*RAW_ROOT, dataset)
    files = sorted(file for file in folder.glob("*.parquet") if not file.name.startswith("._"))
    if not files:
        return {"dataset": dataset, "files": 0, "rows": 0}

    rows = 0
    min_date = None
    max_date = None
    date_field = DATASETS[dataset]["date_field"]
    for file in files:
        df = pd.read_parquet(file, columns=[date_field])
        rows += len(df)
        if len(df):
            lo = str(df[date_field].min())
            hi = str(df[date_field].max())
            min_date = lo if min_date is None else min(min_date, lo)
            max_date = hi if max_date is None else max(max_date, hi)
    return {"dataset": dataset, "files": len(files), "rows": rows, "min_date": min_date, "max_date": max_date}


def write_report(datasets: list[str]) -> Path:
    summaries = [summarize_dataset(dataset) for dataset in datasets]
    report = data_path("reports", "polygon_fundamentals_inventory.md")
    report.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Polygon Fundamentals Inventory",
        "",
        f"Generated at UTC: {datetime.now(timezone.utc).isoformat()}",
        "",
        "| dataset | files | rows | min_date | max_date |",
        "|---|---:|---:|---|---|",
    ]
    for row in summaries:
        lines.append(
            f"| {row['dataset']} | {row.get('files', 0):,} | {row.get('rows', 0):,} | "
            f"{row.get('min_date', '') or ''} | {row.get('max_date', '') or ''} |"
        )
    report.write_text("\n".join(lines) + "\n")
    print(report, flush=True)
    return report


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--datasets",
        default="short_interest,short_volume,earnings,financials",
        help=(
            "Comma-separated: short_interest,short_volume,earnings,"
            "analyst_insights,guidance,polygon_news,benzinga_news,financials"
        ),
    )
    parser.add_argument("--start", default="2016-01-01")
    parser.add_argument("--end", default="")
    parser.add_argument("--pause", type=float, default=0.03)
    parser.add_argument("--limit", type=int, default=50000)
    parser.add_argument("--chunk", choices=["day", "month", "year"], default="month")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--report-only", action="store_true")
    args = parser.parse_args()

    api_key = env("POLYGON_API_KEY", required=True)
    start = parse_date(args.start, date(2016, 1, 1))
    end = parse_date(args.end, date.today())
    datasets = [item.strip() for item in args.datasets.split(",") if item.strip()]
    unknown = sorted(set(datasets) - set(DATASETS))
    if unknown:
        raise SystemExit(f"Unknown datasets: {', '.join(unknown)}")

    if not args.report_only:
        session = requests.Session()
        for dataset in datasets:
            download_dataset(
                session,
                api_key,
                dataset,
                start,
                end,
                args.pause,
                args.overwrite,
                args.limit,
                args.chunk,
            )

    write_report(datasets)


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import pandas as pd
import requests

from common import ROOT, data_path, env, load_env, parse_date, public_url, read_symbols


BASE_URL = "https://api.polygon.io"
OUT_DIR = ("raw", "polygon_rest", "corporate_actions_full")

KEY_SPLIT_CHECKS = [
    ("AAPL", "2020-08-31", 4.0),
    ("TSLA", "2020-08-31", 5.0),
    ("NVDA", "2021-07-20", 4.0),
    ("GE", "2021-08-02", 0.125),
    ("AMZN", "2022-06-06", 20.0),
    ("GOOG", "2022-07-18", 20.0),
    ("GOOGL", "2022-07-18", 20.0),
    ("TTD", "2021-06-17", 10.0),
    ("CSGP", "2021-06-28", 10.0),
    ("CSX", "2021-06-29", 3.0),
    ("ISRG", "2021-10-05", 3.0),
    ("BKNG", "2026-04-06", 25.0),
    ("CVNA", "2026-05-08", 5.0),
]


class EndpointError(RuntimeError):
    def __init__(self, endpoint: str, status_code: int, message: str) -> None:
        super().__init__(f"{endpoint}: HTTP {status_code}: {message}")
        self.endpoint = endpoint
        self.status_code = status_code
        self.message = message


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def output_dir() -> Path:
    return data_path(*OUT_DIR)


def with_api_key(url: str, api_key: str) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.setdefault("apiKey", api_key)
    return urlunparse(parsed._replace(query=urlencode(query)))


def atomic_write_parquet(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    df.to_parquet(tmp, index=False)
    tmp.replace(path)


def atomic_write_text(text: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def request_json(
    session: requests.Session,
    url: str,
    params: dict[str, Any],
    api_key: str,
    endpoint: str,
    pause: float,
    max_429_waits: int,
) -> dict[str, Any]:
    waits = 0
    network_waits = 0
    while True:
        try:
            response = session.get(with_api_key(url, api_key), params=params, timeout=90)
        except requests.RequestException as exc:
            network_waits += 1
            if network_waits > max_429_waits:
                raise EndpointError(endpoint, 0, f"network error after retries: {exc.__class__.__name__}")
            wait = max(2.0, pause)
            print(f"network error {endpoint}; sleep {wait:.1f}s", flush=True)
            time.sleep(wait)
            continue
        if response.status_code == 429:
            waits += 1
            if waits > max_429_waits:
                raise EndpointError(endpoint, 429, "rate limited repeatedly; stopped to avoid hammering API")
            wait = float(response.headers.get("Retry-After") or max(2.0, pause))
            print(f"rate limited {endpoint}; sleep {wait:.1f}s", flush=True)
            time.sleep(wait)
            continue
        if not response.ok:
            try:
                payload = response.json()
                message = payload.get("error") or payload.get("message") or response.text[:300]
            except Exception:
                message = response.text[:300]
            raise EndpointError(endpoint, response.status_code, message)
        payload = response.json()
        if payload.get("status") in {"ERROR", "NOT_AUTHORIZED"}:
            raise EndpointError(endpoint, response.status_code, str(payload)[:500])
        return payload


def paginate(
    session: requests.Session,
    api_key: str,
    endpoint: str,
    params: dict[str, Any],
    pause: float,
    progress_label: str,
    max_429_waits: int,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    url = f"{BASE_URL}{endpoint}"
    rows: list[dict[str, Any]] = []
    request_ids: list[str] = []
    pages = 0
    fetch_started_at = utc_now()
    last_public_url = public_url(url)

    while url:
        payload = request_json(session, url, params, api_key, endpoint, pause, max_429_waits)
        pages += 1
        if payload.get("request_id"):
            request_ids.append(str(payload["request_id"]))
        results = payload.get("results") or []
        if isinstance(results, dict):
            results = [results]
        rows.extend(results)
        if pages % 25 == 0:
            print(f"{progress_label} pages={pages:,} rows={len(rows):,}", flush=True)
        next_url = payload.get("next_url")
        url = with_api_key(next_url, api_key) if next_url else ""
        last_public_url = public_url(url) if url else last_public_url
        params = {}
        if pause:
            time.sleep(pause)

    fetch_finished_at = utc_now()
    df = pd.DataFrame(rows)
    if not df.empty:
        df["source"] = "polygon"
        df["source_endpoint"] = endpoint
        df["fetch_started_at"] = fetch_started_at
        df["fetch_finished_at"] = fetch_finished_at
        df["downloaded_at_utc"] = fetch_finished_at
    meta = {
        "source_endpoint": endpoint,
        "pages": pages,
        "row_count": len(df),
        "fetch_started_at": fetch_started_at,
        "fetch_finished_at": fetch_finished_at,
        "request_ids_sample": request_ids[:25],
        "last_public_url": last_public_url,
    }
    return df, meta


def year_ranges(start: date, end: date) -> list[tuple[date, date]]:
    ranges: list[tuple[date, date]] = []
    current = date(start.year, 1, 1)
    while current <= end:
        ranges.append((max(start, current), min(end, date(current.year, 12, 31))))
        current = date(current.year + 1, 1, 1)
    return ranges


def chunk_path(dataset: str, chunk_name: str) -> Path:
    return output_dir() / "_chunks" / dataset / f"{chunk_name}.parquet"


def endpoint_error_record(dataset: str, error: EndpointError) -> dict[str, Any]:
    return {
        "dataset": dataset,
        "source_endpoint": error.endpoint,
        "http_status": error.status_code,
        "error_summary": error.message[:500],
        "recorded_at": utc_now(),
    }


def summarize_frame(df: pd.DataFrame, date_columns: list[str], symbol_columns: list[str]) -> dict[str, Any]:
    min_date = None
    max_date = None
    for column in date_columns:
        if column in df.columns:
            series = pd.to_datetime(df[column], errors="coerce", utc=True)
            if series.notna().any():
                lo = series.min().date().isoformat()
                hi = series.max().date().isoformat()
                min_date = lo if min_date is None else min(min_date, lo)
                max_date = hi if max_date is None else max(max_date, hi)
    unique_symbols = None
    symbol_column = None
    for column in symbol_columns:
        if column in df.columns:
            unique_symbols = int(df[column].dropna().astype(str).str.upper().nunique())
            symbol_column = column
            break
    return {
        "row_count": int(len(df)),
        "min_date": min_date,
        "max_date": max_date,
        "unique_symbol_count": unique_symbols,
        "symbol_column": symbol_column,
    }


def combine_chunks(
    dataset: str,
    final_name: str,
    date_columns: list[str],
    symbol_columns: list[str],
    dedupe_columns: list[str] | None,
) -> tuple[Path | None, dict[str, Any]]:
    folder = output_dir() / "_chunks" / dataset
    files = sorted(path for path in folder.glob("*.parquet") if not path.name.startswith("._"))
    frames = []
    for file in files:
        df = pd.read_parquet(file)
        if not df.empty:
            frames.append(df)
    final = output_dir() / final_name
    if frames:
        combined = pd.concat(frames, ignore_index=True, sort=False)
        if dedupe_columns and all(column in combined.columns for column in dedupe_columns):
            combined = combined.drop_duplicates(subset=dedupe_columns, keep="last")
        combined = combined.reindex(sorted(combined.columns), axis=1)
        atomic_write_parquet(combined, final)
        summary = summarize_frame(combined, date_columns, symbol_columns)
    else:
        combined = pd.DataFrame()
        summary = summarize_frame(combined, date_columns, symbol_columns)
    summary.update(
        {
            "path": str(final) if frames else None,
            "chunk_file_count": len(files),
            "output_file": final_name,
        }
    )
    return (final if frames else None), summary


def fetch_dated_dataset(
    session: requests.Session,
    api_key: str,
    dataset: str,
    endpoint: str,
    date_field: str,
    start: date,
    end: date,
    pause: float,
    overwrite_chunks: bool,
    max_429_waits: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    metas: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    for chunk_start, chunk_end in year_ranges(start, end):
        name = f"{dataset}_{chunk_start.year}"
        out = chunk_path(dataset, name)
        if out.exists() and not overwrite_chunks:
            print(f"skip {dataset} {chunk_start}..{chunk_end}", flush=True)
            metas.append({"dataset": dataset, "chunk": name, "path": str(out), "status": "cached"})
            continue
        params = {
            "limit": 1000,
            "sort": date_field,
            "order": "asc",
            f"{date_field}.gte": chunk_start.isoformat(),
            f"{date_field}.lte": chunk_end.isoformat(),
        }
        label = f"{dataset} {chunk_start}..{chunk_end}"
        print(label, flush=True)
        try:
            df, meta = paginate(session, api_key, endpoint, params, pause, label, max_429_waits)
        except EndpointError as exc:
            errors.append(endpoint_error_record(dataset, exc))
            break
        if not df.empty:
            atomic_write_parquet(df, out)
        else:
            out.parent.mkdir(parents=True, exist_ok=True)
            atomic_write_parquet(pd.DataFrame({"empty_chunk": [True], "source_endpoint": [endpoint]}).iloc[0:0], out)
        meta.update({"dataset": dataset, "chunk": name, "path": str(out), "status": "fetched"})
        metas.append(meta)
        print(f"saved {out} rows={len(df):,}", flush=True)
    return metas, errors


def fetch_tickers(
    session: requests.Session,
    api_key: str,
    active: bool,
    pause: float,
    overwrite_chunks: bool,
    max_429_waits: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    dataset = "tickers_active" if active else "tickers_inactive"
    out = chunk_path(dataset, dataset)
    if out.exists() and not overwrite_chunks:
        return [{"dataset": dataset, "path": str(out), "status": "cached"}], []
    params = {
        "market": "stocks",
        "active": str(active).lower(),
        "limit": 1000,
        "sort": "ticker",
        "order": "asc",
    }
    print(dataset, flush=True)
    try:
        df, meta = paginate(session, api_key, "/v3/reference/tickers", params, pause, dataset, max_429_waits)
    except EndpointError as exc:
        return [], [endpoint_error_record(dataset, exc)]
    atomic_write_parquet(df, out)
    meta.update({"dataset": dataset, "path": str(out), "status": "fetched"})
    print(f"saved {out} rows={len(df):,}", flush=True)
    return [meta], []


def read_universe_symbols() -> set[str]:
    symbols: set[str] = set()
    folder = data_path("features", "polygon", "universe", "daily_tradable_universe_by_year")
    for path in sorted(folder.glob("universe_*.parquet")):
        if path.name.startswith("._"):
            continue
        try:
            df = pd.read_parquet(path, columns=["symbol"])
        except Exception:
            continue
        symbols.update(df["symbol"].dropna().astype(str).str.upper().unique())
    return symbols


def build_event_symbols(symbols_file: Path, splits_path: Path | None, limit: int | None) -> list[str]:
    symbols: set[str] = set()
    if symbols_file.exists():
        symbols.update(read_symbols(symbols_file))
    symbols.update(symbol for symbol, _, _ in KEY_SPLIT_CHECKS)
    symbols.update(read_universe_symbols())
    if splits_path and splits_path.exists():
        splits = pd.read_parquet(splits_path, columns=["ticker"])
        symbols.update(splits["ticker"].dropna().astype(str).str.upper().unique())
    cleaned = sorted(symbol for symbol in symbols if symbol and not symbol.startswith("."))
    return cleaned[:limit] if limit else cleaned


def event_chunk_name(index: int, symbols: list[str]) -> str:
    return f"ticker_events_{index:05d}_{symbols[0]}_{symbols[-1]}".replace("/", "_")


def fetch_ticker_events(
    session: requests.Session,
    api_key: str,
    symbols: list[str],
    pause: float,
    batch_size: int,
    workers: int,
    overwrite_chunks: bool,
    max_429_waits: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    dataset = "ticker_events"
    metas: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    for start_idx in range(0, len(symbols), batch_size):
        batch = symbols[start_idx : start_idx + batch_size]
        chunk = event_chunk_name(start_idx // batch_size, batch)
        out = chunk_path(dataset, chunk)
        if out.exists() and not overwrite_chunks:
            print(f"skip ticker_events batch={start_idx // batch_size + 1}", flush=True)
            metas.append({"dataset": dataset, "chunk": chunk, "path": str(out), "status": "cached"})
            continue
        rows: list[dict[str, Any]] = []
        no_event_count = 0
        symbol_error_count = 0
        fetch_started_at = utc_now()
        endpoint = "/vX/reference/tickers/{ticker}/events"
        print(f"ticker_events batch={start_idx // batch_size + 1} symbols={len(batch)}", flush=True)

        def fetch_symbol(symbol: str) -> tuple[str, list[dict[str, Any]], EndpointError | None, bool]:
            local_session = requests.Session()
            url = f"{BASE_URL}/vX/reference/tickers/{symbol}/events"
            try:
                payload = request_json(
                    local_session,
                    url,
                    {"types": "ticker_change"},
                    api_key,
                    endpoint,
                    pause,
                    max_429_waits,
                )
            except EndpointError as exc:
                if exc.status_code == 404 and "No events found" in exc.message:
                    return symbol, [], None, True
                return symbol, [], exc, False
            result = payload.get("results") or {}
            events = result.get("events") or []
            symbol_rows: list[dict[str, Any]] = []
            for event in events:
                row = {
                    "ticker_query": symbol,
                    "result_name": result.get("name"),
                    "result_cik": result.get("cik"),
                    "result_composite_figi": result.get("composite_figi"),
                    "event_raw_json": json.dumps(event, ensure_ascii=False, sort_keys=True),
                    "result_raw_json": json.dumps(result, ensure_ascii=False, sort_keys=True),
                    "source": "polygon",
                    "source_endpoint": endpoint,
                    "fetch_started_at": fetch_started_at,
                    "fetch_finished_at": utc_now(),
                    "downloaded_at_utc": utc_now(),
                }
                row.update(event)
                symbol_rows.append(row)
            return symbol, symbol_rows, None, False

        with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
            futures = {executor.submit(fetch_symbol, symbol): symbol for symbol in batch}
            stop_for_auth = False
            for future in as_completed(futures):
                symbol, symbol_rows, error, no_events = future.result()
                if no_events:
                    no_event_count += 1
                    continue
                if error:
                    symbol_error_count += 1
                    errors.append({**endpoint_error_record(dataset, error), "ticker": symbol})
                    if error.status_code in {401, 402, 403}:
                        stop_for_auth = True
                    continue
                rows.extend(symbol_rows)
            if stop_for_auth:
                print("ticker_events stopped because endpoint is unauthorized", flush=True)
        df = pd.DataFrame(rows)
        atomic_write_parquet(df, out)
        metas.append(
            {
                "dataset": dataset,
                "chunk": chunk,
                "path": str(out),
                "row_count": len(df),
                "symbol_count": len(batch),
                "no_event_symbol_count": no_event_count,
                "symbol_error_count": symbol_error_count,
                "fetch_started_at": fetch_started_at,
                "fetch_finished_at": utc_now(),
                "status": "fetched",
            }
        )
        print(f"saved {out} rows={len(df):,}", flush=True)
        if errors and errors[-1].get("http_status") in {401, 402, 403}:
            break
    return metas, errors


def probe_optional_endpoint(
    session: requests.Session,
    api_key: str,
    endpoint: str,
    params: dict[str, Any],
    pause: float,
) -> dict[str, Any]:
    try:
        payload = request_json(session, f"{BASE_URL}{endpoint}", params, api_key, endpoint, pause, 1)
    except EndpointError as exc:
        return endpoint_error_record("optional_metadata", exc)
    results = payload.get("results") or []
    if isinstance(results, dict):
        count = 1
    else:
        count = len(results)
    return {
        "dataset": "optional_metadata",
        "source_endpoint": endpoint,
        "http_status": 200,
        "row_count_sample": count,
        "status": payload.get("status"),
        "recorded_at": utc_now(),
    }


def split_check_results(splits_path: Path | None) -> list[dict[str, Any]]:
    if not splits_path or not splits_path.exists():
        return [
            {"ticker": ticker, "execution_date": day, "expected_ratio": ratio, "hit": False}
            for ticker, day, ratio in KEY_SPLIT_CHECKS
        ]
    splits = pd.read_parquet(splits_path)
    if "ticker" not in splits.columns or "execution_date" not in splits.columns:
        return []
    splits["execution_date_str"] = pd.to_datetime(splits["execution_date"], errors="coerce").dt.date.astype(str)
    results = []
    for ticker, day, expected_ratio in KEY_SPLIT_CHECKS:
        subset = splits[(splits["ticker"].astype(str).str.upper() == ticker) & (splits["execution_date_str"] == day)]
        ratio_hit = False
        observed = []
        for _, row in subset.iterrows():
            split_from = float(row.get("split_from")) if pd.notna(row.get("split_from")) else None
            split_to = float(row.get("split_to")) if pd.notna(row.get("split_to")) else None
            if split_from and split_to:
                ratio = split_to / split_from
                observed.append(ratio)
                ratio_hit = ratio_hit or abs(ratio - expected_ratio) < 1e-9
        results.append(
            {
                "ticker": ticker,
                "execution_date": day,
                "expected_ratio": expected_ratio,
                "observed_ratios": observed,
                "hit": bool(len(subset) and ratio_hit),
            }
        )
    return results


def write_manifest_report(
    manifest: dict[str, Any],
    output_summaries: dict[str, Any],
    split_checks: list[dict[str, Any]],
    errors: list[dict[str, Any]],
    optional_metadata: list[dict[str, Any]],
) -> None:
    manifest.update(
        {
            "outputs": output_summaries,
            "key_split_checks": split_checks,
            "endpoint_errors": errors,
            "optional_metadata_probes": optional_metadata,
            "finished_at_utc": utc_now(),
        }
    )
    atomic_write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        output_dir() / "corporate_actions_fetch_manifest.json",
    )

    lines = [
        "# Polygon Corporate Actions Full Fetch Report",
        "",
        f"- generated_at_utc: {manifest['finished_at_utc']}",
        f"- date_range: {manifest['start']}..{manifest['end']}",
        "",
        "## Output Tables",
        "",
        "| table | rows | date range | symbols | file |",
        "| --- | ---: | --- | ---: | --- |",
    ]
    for table, summary in output_summaries.items():
        lines.append(
            "| {table} | {rows:,} | {lo}..{hi} | {symbols} | `{file}` |".format(
                table=table,
                rows=int(summary.get("row_count") or 0),
                lo=summary.get("min_date") or "",
                hi=summary.get("max_date") or "",
                symbols=summary.get("unique_symbol_count") if summary.get("unique_symbol_count") is not None else "",
                file=summary.get("path") or "",
            )
        )
    lines.extend(["", "## Key Split Checks", "", "| ticker | date | expected | observed | hit |", "| --- | --- | ---: | --- | --- |"])
    for check in split_checks:
        lines.append(
            f"| {check['ticker']} | {check['execution_date']} | {check['expected_ratio']} | {check.get('observed_ratios', [])} | {check['hit']} |"
        )
    lines.extend(["", "## Endpoint Errors / Missing Permissions", ""])
    if errors:
        for error in errors:
            lines.append(
                f"- {error.get('dataset')} {error.get('source_endpoint')} HTTP {error.get('http_status')}: {error.get('error_summary')}"
            )
    else:
        lines.append("- none")
    lines.extend(["", "## Optional Metadata Probes", ""])
    for item in optional_metadata:
        if item.get("http_status") == 200:
            lines.append(f"- {item.get('source_endpoint')}: HTTP 200 sample_rows={item.get('row_count_sample')}")
        else:
            lines.append(
                f"- {item.get('source_endpoint')}: HTTP {item.get('http_status')} {item.get('error_summary')}"
            )
    lines.extend(
        [
            "",
            "## Adjustment Readiness",
            "",
            "- split adjustment factors: ready if all key split checks are true.",
            "- total-return / dividend adjustment factors: ready; ordinary and special dividend rows are preserved in dividends output.",
        ]
    )
    atomic_write_text("\n".join(lines) + "\n", output_dir() / "corporate_actions_fetch_report.md")


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2016-01-01")
    parser.add_argument("--end", default=date.today().isoformat())
    parser.add_argument("--pause", type=float, default=0.05)
    parser.add_argument("--event-batch-size", type=int, default=500)
    parser.add_argument("--event-workers", type=int, default=8)
    parser.add_argument("--event-symbol-limit", type=int)
    parser.add_argument("--symbols", type=Path, default=ROOT / "config" / "symbols_core.txt")
    parser.add_argument("--overwrite-chunks", action="store_true")
    parser.add_argument("--skip-events", action="store_true")
    parser.add_argument("--max-429-waits", type=int, default=30)
    args = parser.parse_args()

    start = parse_date(args.start)
    end = parse_date(args.end)
    if not start or not end:
        raise SystemExit("Both --start and --end are required.")

    api_key = env("POLYGON_API_KEY", required=True)
    output_dir().mkdir(parents=True, exist_ok=True)
    manifest: dict[str, Any] = {
        "started_at_utc": utc_now(),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "data_root": str(data_path()),
        "note": "API keys intentionally omitted.",
        "chunks": [],
    }
    errors: list[dict[str, Any]] = []
    session = requests.Session()

    for dataset, endpoint, date_field in [
        ("splits", "/v3/reference/splits", "execution_date"),
        ("dividends", "/v3/reference/dividends", "ex_dividend_date"),
        ("ipos", "/vX/reference/ipos", "listing_date"),
    ]:
        metas, endpoint_errors = fetch_dated_dataset(
            session,
            api_key,
            dataset,
            endpoint,
            date_field,
            start,
            end,
            args.pause,
            args.overwrite_chunks,
            args.max_429_waits,
        )
        manifest["chunks"].extend(metas)
        errors.extend(endpoint_errors)

    for active in [True, False]:
        metas, endpoint_errors = fetch_tickers(
            session, api_key, active, args.pause, args.overwrite_chunks, args.max_429_waits
        )
        manifest["chunks"].extend(metas)
        errors.extend(endpoint_errors)

    output_summaries: dict[str, Any] = {}
    splits_path, output_summaries["splits_full_2016_present"] = combine_chunks(
        "splits",
        "splits_full_2016_present.parquet",
        ["execution_date"],
        ["ticker"],
        ["id"] if (output_dir() / "_chunks" / "splits").exists() else None,
    )
    dividends_path, output_summaries["dividends_full_2016_present"] = combine_chunks(
        "dividends",
        "dividends_full_2016_present.parquet",
        ["ex_dividend_date"],
        ["ticker"],
        ["id"] if (output_dir() / "_chunks" / "dividends").exists() else None,
    )
    active_path, output_summaries["tickers_active_full"] = combine_chunks(
        "tickers_active",
        "tickers_active_full.parquet",
        ["list_date", "delisted_utc", "last_updated_utc"],
        ["ticker"],
        ["ticker"],
    )
    inactive_path, output_summaries["tickers_inactive_full"] = combine_chunks(
        "tickers_inactive",
        "tickers_inactive_full.parquet",
        ["list_date", "delisted_utc", "last_updated_utc"],
        ["ticker"],
        ["ticker"],
    )
    ipos_path, output_summaries["ipos_full_2016_present"] = combine_chunks(
        "ipos",
        "ipos_full_2016_present.parquet",
        ["listing_date"],
        ["ticker"],
        None,
    )

    if not args.skip_events:
        symbols = build_event_symbols(args.symbols, splits_path, args.event_symbol_limit)
        manifest["ticker_events_symbol_count"] = len(symbols)
        metas, endpoint_errors = fetch_ticker_events(
            session,
            api_key,
            symbols,
            args.pause,
            args.event_batch_size,
            args.event_workers,
            args.overwrite_chunks,
            args.max_429_waits,
        )
        manifest["chunks"].extend(metas)
        errors.extend(endpoint_errors)
        _, output_summaries["ticker_events_full"] = combine_chunks(
            "ticker_events",
            "ticker_events_full.parquet",
            ["date", "filing_date"],
            ["ticker_query", "ticker"],
            None,
        )
    else:
        output_summaries["ticker_events_full"] = {"row_count": 0, "path": None}

    ticker_details_path = output_dir() / "ticker_details_full.parquet"
    if ticker_details_path.exists():
        details = pd.read_parquet(ticker_details_path)
        details_summary = summarize_frame(details, ["list_date"], ["ticker_query", "ticker"])
        details_summary.update(
            {
                "path": str(ticker_details_path),
                "output_file": "ticker_details_full.parquet",
                "source_endpoint": "/v3/reference/tickers/{ticker}",
                "detail_ok_count": int((details.get("detail_status") == "ok").sum())
                if "detail_status" in details.columns
                else None,
                "list_date_non_null": int(details.get("list_date", pd.Series(dtype=object)).notna().sum()),
            }
        )
        output_summaries["ticker_details_full"] = details_summary

    optional_metadata = [
        probe_optional_endpoint(
            session,
            api_key,
            "/vX/reference/delistings",
            {"limit": 10, "sort": "delisted_utc", "order": "desc"},
            args.pause,
        ),
    ]

    split_checks = split_check_results(splits_path)
    write_manifest_report(manifest, output_summaries, split_checks, errors, optional_metadata)
    print(output_dir() / "corporate_actions_fetch_report.md", flush=True)


if __name__ == "__main__":
    main()

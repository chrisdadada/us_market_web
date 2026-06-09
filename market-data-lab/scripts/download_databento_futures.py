from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import databento as db
import pandas as pd

from common import data_path, env, load_env, parse_date, write_parquet


DATASET = "GLBX.MDP3"
PRODUCTS = ("ES", "NQ", "GC", "SI")
SCHEMAS = ("ohlcv-1m", "ohlcv-1h", "ohlcv-1d")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def year_chunks(start: date, end: date) -> list[tuple[date, date]]:
    return [(max(start, date(year, 1, 1)), min(end, date(year, 12, 31))) for year in range(start.year, end.year + 1)]


def continuous_symbol(product: str, rule: str, expiry_index: int) -> str:
    return f"{product}.{rule}.{expiry_index}"


def raw_symbol(product: str) -> str:
    return f"{product}.FUT"


def normalize_ohlcv(df: pd.DataFrame, symbol: str, schema: str, dataset: str) -> pd.DataFrame:
    if df.empty:
        return df
    out = df.reset_index()
    rename = {
        "ts_event": "timestamp_utc",
        "open": "open",
        "high": "high",
        "low": "low",
        "close": "close",
        "volume": "volume",
        "symbol": "symbol",
    }
    out = out.rename(columns={k: v for k, v in rename.items() if k in out.columns})
    if "timestamp_utc" not in out.columns:
        for candidate in ["ts_recv", "index"]:
            if candidate in out.columns:
                out = out.rename(columns={candidate: "timestamp_utc"})
                break
    out["timestamp_utc"] = pd.to_datetime(out["timestamp_utc"], utc=True)
    out["timestamp_ct"] = out["timestamp_utc"].dt.tz_convert("America/Chicago")
    out["trade_date"] = out["timestamp_ct"].dt.date
    if "symbol" not in out.columns:
        out["symbol"] = symbol
    out["query_symbol"] = symbol
    out["dataset"] = dataset
    out["schema"] = schema
    out["source"] = "databento"
    out["downloaded_at_utc"] = utc_now()
    for column in ["open", "high", "low", "close", "volume"]:
        if column not in out.columns:
            out[column] = pd.NA
    columns = [
        "symbol",
        "query_symbol",
        "timestamp_utc",
        "timestamp_ct",
        "trade_date",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "dataset",
        "schema",
        "source",
        "downloaded_at_utc",
    ]
    return out[columns].sort_values("timestamp_utc").drop_duplicates(subset=["query_symbol", "timestamp_utc"])


def estimate_cost(
    client: db.Historical,
    symbols: list[str],
    schema: str,
    stype_in: str,
    start: date,
    end: date,
) -> list[dict[str, Any]]:
    rows = []
    for chunk_start, chunk_end in year_chunks(start, end):
        cost = client.metadata.get_cost(
            dataset=DATASET,
            symbols=symbols,
            schema=schema,
            stype_in=stype_in,
            start=chunk_start.isoformat(),
            end=chunk_end.isoformat(),
        )
        rows.append(
            {
                "dataset": DATASET,
                "schema": schema,
                "stype_in": stype_in,
                "symbols": symbols,
                "start": chunk_start.isoformat(),
                "end": chunk_end.isoformat(),
                "estimated_cost_usd": float(cost),
            }
        )
    return rows


def download_chunk(
    client: db.Historical,
    symbol: str,
    schema: str,
    stype_in: str,
    chunk_start: date,
    chunk_end: date,
    overwrite: bool,
) -> dict[str, Any]:
    safe_symbol = symbol.replace(".", "_")
    raw_dir = data_path("raw", "databento", "futures", stype_in, schema, safe_symbol)
    parquet_dir = data_path("processed", "databento", "futures", stype_in, schema, safe_symbol)
    dbn_path = raw_dir / f"{safe_symbol}_{schema}_{chunk_start.year}.dbn.zst"
    parquet_path = parquet_dir / f"{safe_symbol}_{schema}_{chunk_start.year}.parquet"
    if parquet_path.exists() and parquet_path.stat().st_size > 0 and not overwrite:
        df = pd.read_parquet(parquet_path)
        return {
            "symbol": symbol,
            "schema": schema,
            "stype_in": stype_in,
            "start": chunk_start.isoformat(),
            "end": chunk_end.isoformat(),
            "rows": int(len(df)),
            "first": str(df["timestamp_utc"].min()) if not df.empty else None,
            "last": str(df["timestamp_utc"].max()) if not df.empty else None,
            "dbn_path": str(dbn_path),
            "parquet_path": str(parquet_path),
            "resumed": True,
        }
    raw_dir.mkdir(parents=True, exist_ok=True)
    store = client.timeseries.get_range(
        dataset=DATASET,
        symbols=[symbol],
        schema=schema,
        stype_in=stype_in,
        stype_out="raw_symbol",
        start=chunk_start.isoformat(),
        end=chunk_end.isoformat(),
        path=dbn_path,
    )
    df = normalize_ohlcv(store.to_df(price_type="float", pretty_ts=True, map_symbols=True), symbol, schema, DATASET)
    if not df.empty:
        write_parquet(df, parquet_path)
    return {
        "symbol": symbol,
        "schema": schema,
        "stype_in": stype_in,
        "start": chunk_start.isoformat(),
        "end": chunk_end.isoformat(),
        "rows": int(len(df)),
        "first": str(df["timestamp_utc"].min()) if not df.empty else None,
        "last": str(df["timestamp_utc"].max()) if not df.empty else None,
        "dbn_path": str(dbn_path),
        "parquet_path": str(parquet_path),
        "resumed": False,
    }


def write_manifest(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_report(path: Path, manifest: dict[str, Any]) -> None:
    lines = [
        "# Databento Futures Download Report",
        "",
        f"- generated_at_utc: {manifest['generated_at_utc']}",
        f"- dataset: `{manifest['dataset']}`",
        f"- stype_in: `{manifest['stype_in']}`",
        f"- schema: `{manifest['schema']}`",
        f"- start/end: {manifest['start']}..{manifest['end']}",
        "",
        "## Outputs",
        "",
        "| symbol | year | rows | first | last | resumed | parquet |",
        "| --- | ---: | ---: | --- | --- | --- | --- |",
    ]
    for item in manifest.get("downloads", []):
        lines.append(
            f"| {item['symbol']} | {item['start'][:4]} | {item['rows']:,} | {item['first']} | {item['last']} | {item['resumed']} | `{item['parquet_path']}` |"
        )
    if manifest.get("estimates"):
        lines.extend(["", "## Cost Estimates", "", "| start | end | estimated USD |", "| --- | --- | ---: |"])
        for item in manifest["estimates"]:
            lines.append(f"| {item['start']} | {item['end']} | {item['estimated_cost_usd']:.4f} |")
        lines.append(f"\n- total_estimated_cost_usd: {manifest.get('total_estimated_cost_usd', 0.0):.4f}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser(description="Estimate or download Databento CME futures OHLCV data.")
    parser.add_argument("--products", default="ES,NQ,GC,SI")
    parser.add_argument("--start", default="2016-01-01")
    parser.add_argument("--end", default=date.today().isoformat())
    parser.add_argument("--schema", default="ohlcv-1m", choices=SCHEMAS)
    parser.add_argument("--mode", default="continuous", choices=["continuous", "parent"])
    parser.add_argument("--continuous-rule", default="v", help="Databento continuous rule, e.g. v for volume-based front month.")
    parser.add_argument("--expiry-index", type=int, default=0)
    parser.add_argument("--estimate-only", action="store_true")
    parser.add_argument("--max-estimated-cost", type=float, default=0.0, help="Abort downloads if estimate exceeds this USD amount. 0 disables.")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    api_key = env("DATABENTO_API_KEY", required=True)
    start = parse_date(args.start)
    end = parse_date(args.end)
    if not start or not end:
        raise SystemExit("Both --start and --end are required.")
    products = [item.strip().upper() for item in args.products.split(",") if item.strip()]
    unknown = sorted(set(products) - set(PRODUCTS))
    if unknown:
        raise SystemExit(f"Unsupported products for this script: {unknown}")

    if args.mode == "continuous":
        symbols = [continuous_symbol(product, args.continuous_rule, args.expiry_index) for product in products]
        stype_in = "continuous"
    else:
        symbols = [raw_symbol(product) for product in products]
        stype_in = "parent"

    client = db.Historical(api_key)
    estimates = estimate_cost(client, symbols, args.schema, stype_in, start, end)
    total_cost = sum(item["estimated_cost_usd"] for item in estimates)
    manifest: dict[str, Any] = {
        "generated_at_utc": utc_now(),
        "dataset": DATASET,
        "schema": args.schema,
        "stype_in": stype_in,
        "symbols": symbols,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "estimates": estimates,
        "total_estimated_cost_usd": total_cost,
        "downloads": [],
    }
    manifest_path = data_path("reports", "databento_futures_download_manifest.json")
    report_path = data_path("reports", "databento_futures_download_report.md")
    if args.estimate_only:
        write_manifest(manifest_path, manifest)
        write_report(report_path, manifest)
        print(f"estimated_cost_usd={total_cost:.4f}", flush=True)
        print(report_path, flush=True)
        return
    if args.max_estimated_cost and total_cost > args.max_estimated_cost:
        write_manifest(manifest_path, manifest)
        write_report(report_path, manifest)
        raise SystemExit(f"Estimated cost ${total_cost:.4f} exceeds --max-estimated-cost ${args.max_estimated_cost:.4f}.")

    downloads = []
    for symbol in symbols:
        for chunk_start, chunk_end in year_chunks(start, end):
            print(f"download {symbol} {args.schema} {chunk_start}..{chunk_end}", flush=True)
            item = download_chunk(client, symbol, args.schema, stype_in, chunk_start, chunk_end, args.overwrite)
            print(f"saved rows={item['rows']:,} {item['parquet_path']}", flush=True)
            downloads.append(item)
            manifest["downloads"] = downloads
            write_manifest(manifest_path, manifest)
            write_report(report_path, manifest)
    write_manifest(manifest_path, manifest)
    write_report(report_path, manifest)
    print(report_path, flush=True)


if __name__ == "__main__":
    main()

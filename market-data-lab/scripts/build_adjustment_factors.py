from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import polars as pl
import pyarrow as pa
import pyarrow.parquet as pq


DATA_ROOT = Path("/Volumes/Extreme SSD/market-data-lab/data")
CORPORATE_ACTIONS_DIR = DATA_ROOT / "raw" / "polygon_rest" / "corporate_actions_full"
UNIVERSE_DIR = DATA_ROOT / "features" / "polygon" / "universe" / "daily_tradable_universe_by_year"
OUTPUT_DIR = DATA_ROOT / "features" / "polygon" / "adjustments"

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


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def atomic_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def clean_symbol(value: Any) -> str:
    return str(value).strip().upper()


def load_split_events(start: date, end: date) -> tuple[pd.DataFrame, dict[str, Any]]:
    path = CORPORATE_ACTIONS_DIR / "splits_full_2016_present.parquet"
    splits = pd.read_parquet(path)
    splits["symbol"] = splits["ticker"].map(clean_symbol)
    splits["execution_date"] = pd.to_datetime(splits["execution_date"], errors="coerce").dt.date
    splits["split_from"] = pd.to_numeric(splits["split_from"], errors="coerce")
    splits["split_to"] = pd.to_numeric(splits["split_to"], errors="coerce")
    splits = splits[
        splits["symbol"].notna()
        & splits["execution_date"].notna()
        & (splits["execution_date"] >= start)
        & (splits["execution_date"] <= end)
    ].copy()

    invalid = splits[
        splits["split_from"].isna()
        | splits["split_to"].isna()
        | (splits["split_from"] <= 0)
        | (splits["split_to"] <= 0)
    ].copy()

    valid = splits.drop(index=invalid.index).copy()
    valid["price_event_factor"] = valid["split_from"] / valid["split_to"]
    valid["volume_event_factor"] = valid["split_to"] / valid["split_from"]
    valid["split_ratio"] = valid["split_to"] / valid["split_from"]
    valid["source_split_id"] = valid["id"].astype(str)

    duplicate_id_count = int(valid["id"].duplicated().sum()) if "id" in valid.columns else 0
    duplicate_symbol_date_count = int(valid.duplicated(subset=["symbol", "execution_date"]).sum())

    grouped_rows: list[dict[str, Any]] = []
    for (symbol, execution_date), group in valid.groupby(["symbol", "execution_date"], sort=True):
        price_factor = float(group["price_event_factor"].prod())
        volume_factor = float(group["volume_event_factor"].prod())
        split_ratio = float(group["split_ratio"].prod())
        if split_ratio > 1:
            direction = "split"
        elif split_ratio < 1:
            direction = "reverse"
        else:
            direction = "neutral"
        grouped_rows.append(
            {
                "symbol": symbol,
                "execution_date": execution_date,
                "price_event_factor": price_factor,
                "volume_event_factor": volume_factor,
                "split_ratio": split_ratio,
                "split_direction": direction,
                "source_split_id": ";".join(group["source_split_id"].dropna().astype(str)),
                "raw_event_count": int(len(group)),
            }
        )

    events = pd.DataFrame(grouped_rows)
    stats = {
        "source_path": str(path),
        "raw_split_rows": int(len(splits)),
        "valid_split_rows": int(len(valid)),
        "invalid_split_rows": int(len(invalid)),
        "duplicate_split_id_count": duplicate_id_count,
        "duplicate_symbol_date_count": duplicate_symbol_date_count,
        "aggregated_split_events": int(len(events)),
        "split_symbol_count": int(events["symbol"].nunique()) if not events.empty else 0,
    }
    return events, stats


def build_breakpoints(events: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    if events.empty:
        return pd.DataFrame(
            columns=["symbol", "effective_date", "price_adjustment_factor_to_latest", "volume_adjustment_factor_to_latest"]
        )

    for symbol, group in events.sort_values(["symbol", "execution_date"]).groupby("symbol", sort=False):
        group = group.sort_values("execution_date")
        total_price = float(group["price_event_factor"].prod())
        total_volume = float(group["volume_event_factor"].prod())
        rows.append(
            {
                "symbol": symbol,
                "effective_date": date(1900, 1, 1),
                "price_adjustment_factor_to_latest": total_price,
                "volume_adjustment_factor_to_latest": total_volume,
            }
        )
        future_price = total_price
        future_volume = total_volume
        for _, event in group.iterrows():
            future_price = future_price / float(event["price_event_factor"])
            future_volume = future_volume / float(event["volume_event_factor"])
            rows.append(
                {
                    "symbol": symbol,
                    "effective_date": event["execution_date"],
                    "price_adjustment_factor_to_latest": future_price,
                    "volume_adjustment_factor_to_latest": future_volume,
                }
            )
    return pd.DataFrame(rows)


def universe_paths(start: date, end: date) -> list[Path]:
    paths: list[Path] = []
    for year in range(start.year, end.year + 1):
        path = UNIVERSE_DIR / f"universe_{year}.parquet"
        if path.exists():
            paths.append(path)
    return paths


def write_piece(
    universe_path: Path,
    breakpoints: pl.DataFrame,
    events: pl.DataFrame,
    start: date,
    end: date,
    generated_at: str,
    tmp_dir: Path,
) -> dict[str, Any]:
    year = int(universe_path.stem.split("_")[-1])
    piece_path = tmp_dir / f"adjustment_factors_{year}.parquet"
    lf = (
        pl.scan_parquet(str(universe_path))
        .select(
            pl.col("symbol").cast(pl.Utf8).str.to_uppercase().alias("symbol"),
            pl.col("trade_date").cast(pl.Date).alias("trade_date"),
        )
        .filter((pl.col("trade_date") >= start) & (pl.col("trade_date") <= end))
        .unique()
        .sort(["symbol", "trade_date"])
    )
    base = lf.collect()
    if base.is_empty():
        return {
            "year": year,
            "path": str(piece_path),
            "row_count": 0,
            "symbol_count": 0,
            "trade_date_count": 0,
            "min_trade_date": None,
            "max_trade_date": None,
        }

    adjusted = (
        base.join_asof(
            breakpoints,
            left_on="trade_date",
            right_on="effective_date",
            by="symbol",
            strategy="backward",
        )
        .with_columns(
            [
                pl.col("price_adjustment_factor_to_latest").fill_null(1.0),
                pl.col("volume_adjustment_factor_to_latest").fill_null(1.0),
            ]
        )
        .join(
            events,
            left_on=["symbol", "trade_date"],
            right_on=["symbol", "execution_date"],
            how="left",
        )
        .with_columns(
            [
                pl.col("split_ratio").cast(pl.Float64),
                pl.col("split_direction").cast(pl.Utf8),
                pl.col("source_split_id").cast(pl.Utf8),
                pl.col("source_split_id").is_not_null().alias("has_split"),
                pl.lit(generated_at).alias("generated_at"),
                pl.lit("polygon_splits").alias("data_source"),
            ]
        )
        .select(
            [
                "symbol",
                "trade_date",
                "price_adjustment_factor_to_latest",
                "volume_adjustment_factor_to_latest",
                "has_split",
                "split_ratio",
                "split_direction",
                "source_split_id",
                "generated_at",
                "data_source",
            ]
        )
        .sort(["trade_date", "symbol"])
    )
    tmp_dir.mkdir(parents=True, exist_ok=True)
    adjusted.write_parquet(piece_path, compression="zstd", statistics=True)
    return {
        "year": year,
        "path": str(piece_path),
        "row_count": int(adjusted.height),
        "symbol_count": int(adjusted["symbol"].n_unique()),
        "trade_date_count": int(adjusted["trade_date"].n_unique()),
        "min_trade_date": str(adjusted["trade_date"].min()),
        "max_trade_date": str(adjusted["trade_date"].max()),
    }


def combine_pieces(piece_paths: list[Path], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = output_path.with_name(f".{output_path.name}.tmp")
    writer = None
    try:
        for path in piece_paths:
            parquet = pq.ParquetFile(path)
            for batch in parquet.iter_batches(batch_size=250_000):
                table = pa.Table.from_batches([batch])
                if writer is None:
                    writer = pq.ParquetWriter(tmp, table.schema, compression="zstd")
                writer.write_table(table)
    finally:
        if writer is not None:
            writer.close()
    tmp.replace(output_path)


def validate_key_splits(output_path: Path, events: pd.DataFrame) -> list[dict[str, Any]]:
    lf = pl.scan_parquet(str(output_path)).select(
        "symbol",
        "trade_date",
        "price_adjustment_factor_to_latest",
        "volume_adjustment_factor_to_latest",
        "has_split",
        "split_ratio",
        "split_direction",
        "source_split_id",
    )
    results: list[dict[str, Any]] = []
    for symbol, day_str, expected_ratio in KEY_SPLIT_CHECKS:
        day = datetime.strptime(day_str, "%Y-%m-%d").date()
        symbol_lf = lf.filter(pl.col("symbol") == symbol)
        prev = (
            symbol_lf.filter(pl.col("trade_date") < day)
            .sort("trade_date", descending=True)
            .limit(1)
            .collect()
        )
        on_or_after = (
            symbol_lf.filter(pl.col("trade_date") >= day)
            .sort("trade_date")
            .limit(1)
            .collect()
        )
        event_rows = events[(events["symbol"] == symbol) & (events["execution_date"] == day)]
        expected_price_jump = None
        expected_volume_jump = None
        if not event_rows.empty:
            expected_price_jump = float(event_rows["price_event_factor"].iloc[0])
            expected_volume_jump = float(event_rows["volume_event_factor"].iloc[0])

        if prev.is_empty() or on_or_after.is_empty() or expected_price_jump is None:
            results.append(
                {
                    "symbol": symbol,
                    "execution_date": day_str,
                    "expected_split_ratio": expected_ratio,
                    "status": "missing_factor_row",
                    "ok": False,
                }
            )
            continue
        prev_row = prev.to_dicts()[0]
        after_row = on_or_after.to_dicts()[0]
        observed_price_jump = (
            prev_row["price_adjustment_factor_to_latest"] / after_row["price_adjustment_factor_to_latest"]
        )
        observed_volume_jump = (
            prev_row["volume_adjustment_factor_to_latest"] / after_row["volume_adjustment_factor_to_latest"]
        )
        has_split_on_effective = bool(after_row["has_split"]) if str(after_row["trade_date"]) == day_str else False
        split_ratio_on_effective = after_row["split_ratio"] if str(after_row["trade_date"]) == day_str else None
        price_ok = bool(np.isclose(observed_price_jump, expected_price_jump, rtol=1e-10, atol=1e-12))
        volume_ok = bool(np.isclose(observed_volume_jump, expected_volume_jump, rtol=1e-10, atol=1e-12))
        split_marker_ok = bool(
            str(after_row["trade_date"]) == day_str
            and has_split_on_effective
            and split_ratio_on_effective is not None
            and np.isclose(float(split_ratio_on_effective), expected_ratio, rtol=1e-10, atol=1e-12)
        )
        results.append(
            {
                "symbol": symbol,
                "execution_date": day_str,
                "previous_trade_date": str(prev_row["trade_date"]),
                "effective_or_next_trade_date": str(after_row["trade_date"]),
                "expected_split_ratio": expected_ratio,
                "expected_price_factor_step": expected_price_jump,
                "observed_price_factor_step": observed_price_jump,
                "expected_volume_factor_step": expected_volume_jump,
                "observed_volume_factor_step": observed_volume_jump,
                "has_split_on_effective_date": has_split_on_effective,
                "split_ratio_on_effective_date": split_ratio_on_effective,
                "split_direction": after_row["split_direction"] if str(after_row["trade_date"]) == day_str else None,
                "source_split_id": after_row["source_split_id"] if str(after_row["trade_date"]) == day_str else None,
                "price_step_ok": price_ok,
                "volume_step_ok": volume_ok,
                "split_marker_ok": split_marker_ok,
                "ok": bool(price_ok and volume_ok and split_marker_ok),
            }
        )
    return results


def write_outputs(
    output_path: Path,
    manifest_path: Path,
    report_path: Path,
    manifest: dict[str, Any],
    validation: list[dict[str, Any]],
) -> None:
    manifest["key_split_validation"] = validation
    manifest["key_split_validation_all_ok"] = all(item.get("ok") for item in validation)
    manifest["finished_at"] = utc_now()
    atomic_text(manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n")

    lines = [
        "# Polygon Split Adjustment Factors Report",
        "",
        f"- generated_at: {manifest['finished_at']}",
        f"- output: `{output_path}`",
        f"- data_source: polygon_splits",
        f"- skeleton_source: `{manifest['skeleton_source']}`",
        "",
        "## Coverage",
        "",
        f"- symbols: {manifest['output']['symbol_count']:,}",
        f"- trade_dates: {manifest['output']['trade_date_count']:,}",
        f"- rows: {manifest['output']['row_count']:,}",
        f"- trade_date_range: {manifest['output']['min_trade_date']}..{manifest['output']['max_trade_date']}",
        f"- requested_range: {manifest['requested_start']}..{manifest['requested_end']}",
        "",
        "## Split Inputs",
        "",
        f"- raw_split_rows: {manifest['split_input']['raw_split_rows']:,}",
        f"- valid_split_rows: {manifest['split_input']['valid_split_rows']:,}",
        f"- aggregated_split_events: {manifest['split_input']['aggregated_split_events']:,}",
        f"- duplicate_split_id_count: {manifest['split_input']['duplicate_split_id_count']:,}",
        f"- duplicate_symbol_date_count: {manifest['split_input']['duplicate_symbol_date_count']:,}",
        f"- invalid_split_rows: {manifest['split_input']['invalid_split_rows']:,}",
        "",
        "## Missing Dates",
        "",
    ]
    missing = manifest.get("missing_date_notes") or []
    if missing:
        lines.extend(f"- {item}" for item in missing)
    else:
        lines.append("- none")

    lines.extend(
        [
            "",
            "## Key Split Validation",
            "",
            "| symbol | effective_date | prev_trade_date | factor_date | expected split | observed price step | observed volume step | marker | ok |",
            "| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |",
        ]
    )
    for item in validation:
        lines.append(
            "| {symbol} | {date} | {prev} | {after} | {expected} | {price} | {volume} | {marker} | {ok} |".format(
                symbol=item["symbol"],
                date=item["execution_date"],
                prev=item.get("previous_trade_date", ""),
                after=item.get("effective_or_next_trade_date", ""),
                expected=item.get("expected_split_ratio", ""),
                price=item.get("observed_price_factor_step", ""),
                volume=item.get("observed_volume_factor_step", ""),
                marker=item.get("split_marker_ok", ""),
                ok=item.get("ok", False),
            )
        )
    lines.extend(
        [
            "",
            "## Readiness",
            "",
            "- 1m/60m/240m/1d split-adjusted bars: ready to rebuild from this factor table.",
            "- Total-return dividend-adjusted bars: not built in this stage by design.",
        ]
    )
    atomic_text(report_path, "\n".join(lines) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2016-01-01")
    parser.add_argument("--end", default=date.today().isoformat())
    args = parser.parse_args()

    start = datetime.strptime(args.start, "%Y-%m-%d").date()
    end = datetime.strptime(args.end, "%Y-%m-%d").date()
    generated_at = utc_now()
    output_path = OUTPUT_DIR / "adjustment_factors_by_symbol_date.parquet"
    manifest_path = OUTPUT_DIR / "adjustment_factors_manifest.json"
    report_path = OUTPUT_DIR / "adjustment_factors_report.md"
    tmp_dir = OUTPUT_DIR / "_adjustment_factors_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    split_events_pd, split_stats = load_split_events(start, end)
    breakpoints_pd = build_breakpoints(split_events_pd)
    breakpoints = (
        pl.from_pandas(breakpoints_pd)
        .with_columns(
            [
                pl.col("symbol").cast(pl.Utf8),
                pl.col("effective_date").cast(pl.Date),
                pl.col("price_adjustment_factor_to_latest").cast(pl.Float64),
                pl.col("volume_adjustment_factor_to_latest").cast(pl.Float64),
            ]
        )
        .sort(["symbol", "effective_date"])
    )
    events = (
        pl.from_pandas(split_events_pd)
        .select(
            [
                pl.col("symbol").cast(pl.Utf8),
                pl.col("execution_date").cast(pl.Date),
                pl.col("split_ratio").cast(pl.Float64),
                pl.col("split_direction").cast(pl.Utf8),
                pl.col("source_split_id").cast(pl.Utf8),
            ]
        )
        .sort(["symbol", "execution_date"])
    )

    piece_summaries: list[dict[str, Any]] = []
    paths = universe_paths(start, end)
    for path in paths:
        summary = write_piece(path, breakpoints, events, start, end, generated_at, tmp_dir)
        piece_summaries.append(summary)
        print(f"{path.name} rows={summary['row_count']:,}", flush=True)

    piece_paths = [Path(item["path"]) for item in piece_summaries if item["row_count"]]
    combine_pieces(piece_paths, output_path)

    lf = pl.scan_parquet(str(output_path)).select("symbol", "trade_date")
    output_summary = lf.select(
        pl.len().alias("row_count"),
        pl.n_unique("symbol").alias("symbol_count"),
        pl.n_unique("trade_date").alias("trade_date_count"),
        pl.min("trade_date").alias("min_trade_date"),
        pl.max("trade_date").alias("max_trade_date"),
    ).collect().to_dicts()[0]
    output_summary = {
        "row_count": int(output_summary["row_count"]),
        "symbol_count": int(output_summary["symbol_count"]),
        "trade_date_count": int(output_summary["trade_date_count"]),
        "min_trade_date": str(output_summary["min_trade_date"]),
        "max_trade_date": str(output_summary["max_trade_date"]),
        "path": str(output_path),
    }

    missing_date_notes = []
    if output_summary["min_trade_date"] > args.start:
        missing_date_notes.append(
            f"Requested start {args.start}, but local universe/raw bar skeleton starts at {output_summary['min_trade_date']}."
        )
    if output_summary["max_trade_date"] < args.end:
        missing_date_notes.append(
            f"Requested end {args.end}, but latest local universe/raw bar skeleton ends at {output_summary['max_trade_date']}."
        )

    validation = validate_key_splits(output_path, split_events_pd)
    manifest = {
        "generated_at": generated_at,
        "requested_start": args.start,
        "requested_end": args.end,
        "input_dir": str(CORPORATE_ACTIONS_DIR),
        "skeleton_source": str(UNIVERSE_DIR),
        "output": output_summary,
        "yearly_pieces": piece_summaries,
        "split_input": split_stats,
        "missing_date_notes": missing_date_notes,
        "dividend_adjusted": False,
        "method": "split-only cumulative factors to latest; event applies only to trade_date < execution_date",
    }
    write_outputs(output_path, manifest_path, report_path, manifest, validation)
    print(output_path, flush=True)
    print(report_path, flush=True)


if __name__ == "__main__":
    main()

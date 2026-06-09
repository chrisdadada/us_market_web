from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import polars as pl


DATA_ROOT = Path("/Volumes/Extreme SSD/market-data-lab/data")
FACTOR_PATH = DATA_ROOT / "features" / "polygon" / "adjustments" / "adjustment_factors_by_symbol_date.parquet"
UNIVERSE_2021 = DATA_ROOT / "features" / "polygon" / "universe" / "daily_tradable_universe_by_year" / "universe_2021.parquet"
OUTPUT_ROOTS = {
    "1m": DATA_ROOT / "processed" / "polygon" / "stocks_split_adjusted_rth" / "1m" / "pilot_2020_2022",
    "60m": DATA_ROOT / "processed" / "polygon" / "stocks_split_adjusted_rth" / "60m" / "pilot_2020_2022",
    "240m": DATA_ROOT / "processed" / "polygon" / "stocks_split_adjusted_rth" / "240m" / "pilot_2020_2022",
    "1d": DATA_ROOT / "processed" / "polygon" / "stocks_split_adjusted" / "1d" / "pilot_2020_2022",
}
INPUT_ROOTS = {
    "1m": DATA_ROOT / "processed" / "polygon" / "stocks_rth" / "1m",
    "60m": DATA_ROOT / "processed" / "polygon" / "stocks_rth" / "60m",
    "240m": DATA_ROOT / "processed" / "polygon" / "stocks_rth" / "240m",
    "1d": DATA_ROOT / "processed" / "polygon" / "stocks" / "1d",
}

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


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)


def atomic_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def input_paths(timeframe: str, years: list[int]) -> list[Path]:
    root = INPUT_ROOTS[timeframe]
    paths: list[Path] = []
    for year in years:
        paths.extend(path for path in (root / str(year)).glob("*/*.parquet") if not path.name.startswith("._"))
    return sorted(paths)


def output_path_for(input_path: Path, timeframe: str) -> Path:
    # Input paths are <root>/<year>/<month>/<YYYY-MM-DD>.parquet.
    year = input_path.parent.parent.name
    month = input_path.parent.name
    return OUTPUT_ROOTS[timeframe] / year / month / input_path.name


def build_pilot_symbols(years: list[int], top_n: int) -> tuple[list[str], dict[str, Any]]:
    top50 = (
        pl.scan_parquet(str(UNIVERSE_2021))
        .select(
            pl.col("symbol").cast(pl.Utf8).str.to_uppercase().alias("symbol"),
            pl.col("dollar_volume").cast(pl.Float64),
        )
        .group_by("symbol")
        .agg(pl.col("dollar_volume").median().alias("median_dollar_volume_2021"))
        .sort("median_dollar_volume_2021", descending=True)
        .limit(top_n)
        .collect()
    )
    top_symbols = set(top50["symbol"].to_list())
    split_symbols = set(
        pl.scan_parquet(str(FACTOR_PATH))
        .filter(pl.col("trade_date").dt.year().is_in(years) & pl.col("has_split"))
        .select(pl.col("symbol").cast(pl.Utf8).str.to_uppercase())
        .unique()
        .collect()["symbol"]
        .to_list()
    )
    key_symbols = {symbol for symbol, _, _ in KEY_SPLIT_CHECKS}
    symbols = sorted(top_symbols | split_symbols | key_symbols)
    return symbols, {
        "top_n": top_n,
        "top50_symbol_count": len(top_symbols),
        "split_event_symbol_count": len(split_symbols),
        "key_symbol_count": len(key_symbols),
        "pilot_symbol_count": len(symbols),
        "top50_symbols": sorted(top_symbols),
        "split_event_symbols_sample": sorted(split_symbols)[:100],
    }


def load_factors(symbols: list[str], years: list[int]) -> pl.DataFrame:
    start = date(min(years), 1, 1)
    end = date(max(years), 12, 31)
    return (
        pl.scan_parquet(str(FACTOR_PATH))
        .filter(pl.col("symbol").is_in(symbols) & (pl.col("trade_date") >= start) & (pl.col("trade_date") <= end))
        .select(
            [
                pl.col("symbol").cast(pl.Utf8),
                pl.col("trade_date").cast(pl.Date),
                pl.col("price_adjustment_factor_to_latest").cast(pl.Float64),
                pl.col("volume_adjustment_factor_to_latest").cast(pl.Float64),
                pl.col("has_split").cast(pl.Boolean),
                pl.col("split_ratio").cast(pl.Float64),
                pl.col("split_direction").cast(pl.Utf8),
                pl.col("source_split_id").cast(pl.Utf8),
            ]
        )
        .collect()
    )


def build_adjusted_frame(path: Path, symbols: list[str], factors: pl.DataFrame, generated_at: str) -> tuple[pl.DataFrame, dict[str, Any]]:
    base = (
        pl.scan_parquet(str(path))
        .filter(pl.col("symbol").cast(pl.Utf8).str.to_uppercase().is_in(symbols))
        .with_columns(
            [
                pl.col("symbol").cast(pl.Utf8).str.to_uppercase().alias("symbol"),
                pl.col("trade_date").cast(pl.Date).alias("trade_date"),
            ]
        )
        .collect()
    )
    if base.is_empty():
        return base, {
            "row_count": 0,
            "symbol_counts": {},
            "missing_factor_rows": 0,
            "illegal_ohlc_rows": 0,
        }

    joined = base.join(factors, on=["symbol", "trade_date"], how="left")
    missing_factor_rows = int(joined["price_adjustment_factor_to_latest"].is_null().sum())
    joined = joined.with_columns(
        [
            pl.col("price_adjustment_factor_to_latest").fill_null(1.0),
            pl.col("volume_adjustment_factor_to_latest").fill_null(1.0),
            pl.col("has_split").fill_null(False),
        ]
    )

    price_cols = [column for column in ["open", "high", "low", "close", "vwap"] if column in joined.columns]
    volume_cols = [column for column in ["volume"] if column in joined.columns]
    exprs: list[pl.Expr] = []
    for column in price_cols:
        exprs.append(pl.col(column).alias(f"raw_{column}"))
        exprs.append((pl.col(column) * pl.col("price_adjustment_factor_to_latest")).alias(column))
    for column in volume_cols:
        exprs.append(pl.col(column).alias(f"raw_{column}"))
        exprs.append((pl.col(column) * pl.col("volume_adjustment_factor_to_latest")).alias(column))
    adjusted = joined.with_columns(exprs).with_columns(
        [
            pl.lit(generated_at).alias("split_adjusted_generated_at"),
            pl.lit("polygon_splits").alias("adjustment_data_source"),
        ]
    )

    if all(column in adjusted.columns for column in ["open", "high", "low", "close"]):
        illegal = adjusted.filter(
            (pl.col("high") < pl.max_horizontal(["open", "close", "low"]))
            | (pl.col("low") > pl.min_horizontal(["open", "close", "high"]))
            | (pl.col("open") <= 0)
            | (pl.col("high") <= 0)
            | (pl.col("low") <= 0)
            | (pl.col("close") <= 0)
        )
        illegal_ohlc_rows = int(illegal.height)
    else:
        illegal_ohlc_rows = 0

    symbol_counts = adjusted.group_by("symbol").len().to_pandas()
    return adjusted, {
        "row_count": int(adjusted.height),
        "symbol_counts": dict(zip(symbol_counts["symbol"], symbol_counts["len"])),
        "missing_factor_rows": missing_factor_rows,
        "illegal_ohlc_rows": illegal_ohlc_rows,
    }


def process_timeframe(timeframe: str, years: list[int], symbols: list[str], factors: pl.DataFrame, generated_at: str) -> dict[str, Any]:
    paths = input_paths(timeframe, years)
    summary = {
        "timeframe": timeframe,
        "input_file_count": len(paths),
        "output_file_count": 0,
        "row_count": 0,
        "missing_factor_rows": 0,
        "illegal_ohlc_rows": 0,
        "year_symbol_counts": defaultdict(lambda: defaultdict(int)),
        "year_counts": defaultdict(int),
        "output_root": str(OUTPUT_ROOTS[timeframe]),
        "empty_input_files": 0,
    }
    for index, path in enumerate(paths, start=1):
        adjusted, stats = build_adjusted_frame(path, symbols, factors, generated_at)
        if adjusted.is_empty():
            summary["empty_input_files"] += 1
            continue
        out = output_path_for(path, timeframe)
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_name(f".{out.name}.tmp")
        adjusted.write_parquet(tmp, compression="zstd", statistics=True)
        tmp.replace(out)
        year = int(path.parent.parent.name)
        summary["output_file_count"] += 1
        summary["row_count"] += stats["row_count"]
        summary["missing_factor_rows"] += stats["missing_factor_rows"]
        summary["illegal_ohlc_rows"] += stats["illegal_ohlc_rows"]
        summary["year_counts"][year] += stats["row_count"]
        for symbol, count in stats["symbol_counts"].items():
            summary["year_symbol_counts"][year][symbol] += int(count)
        if index % 50 == 0:
            print(f"{timeframe} files={index}/{len(paths)} rows={summary['row_count']:,}", flush=True)

    row_count_records = []
    for year, symbol_counts in summary["year_symbol_counts"].items():
        for symbol, count in symbol_counts.items():
            row_count_records.append({"timeframe": timeframe, "year": year, "symbol": symbol, "row_count": count})
    row_counts_path = OUTPUT_ROOTS[timeframe] / "_pilot_row_counts_by_year_symbol.parquet"
    if row_count_records:
        pl.from_dicts(row_count_records).write_parquet(row_counts_path, compression="zstd", statistics=True)
    summary["row_counts_path"] = str(row_counts_path) if row_count_records else None
    summary["year_counts"] = {str(k): int(v) for k, v in sorted(summary["year_counts"].items())}
    summary["year_symbol_counts"] = "written_to_row_counts_path"
    return summary


def read_symbol_day(timeframe: str, day: date, symbol: str, last: bool) -> dict[str, Any] | None:
    path = OUTPUT_ROOTS[timeframe] / f"{day.year}" / f"{day.month:02d}" / f"{day.isoformat()}.parquet"
    if not path.exists():
        return None
    df = (
        pl.scan_parquet(str(path))
        .filter(pl.col("symbol") == symbol)
        .collect()
    )
    if df.is_empty():
        return None
    sort_cols = [column for column in ["timestamp_utc", "timestamp_et"] if column in df.columns]
    if sort_cols:
        df = df.sort(sort_cols[0], descending=last)
    return df.row(0, named=True)


def previous_output_day(timeframe: str, day: date, symbol: str) -> date | None:
    year_dir = OUTPUT_ROOTS[timeframe] / str(day.year)
    candidates = []
    if year_dir.exists():
        for path in year_dir.glob("*/*.parquet"):
            if path.name.startswith("._"):
                continue
            try:
                candidate = datetime.strptime(path.stem, "%Y-%m-%d").date()
            except ValueError:
                continue
            if candidate < day:
                candidates.append(candidate)
    for candidate in sorted(candidates, reverse=True):
        if read_symbol_day(timeframe, candidate, symbol, last=True) is not None:
            return candidate
    return None


def validate_splits(timeframes: list[str]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    pilot_start = date(2020, 1, 1)
    pilot_end = date(2022, 12, 31)
    for timeframe in timeframes:
        for symbol, day_str, expected_ratio in KEY_SPLIT_CHECKS:
            day = datetime.strptime(day_str, "%Y-%m-%d").date()
            if day < pilot_start or day > pilot_end:
                results.append(
                    {
                        "timeframe": timeframe,
                        "symbol": symbol,
                        "execution_date": day_str,
                        "status": "out_of_pilot_year_range",
                        "ok": None,
                    }
                )
                continue
            prev_day = previous_output_day(timeframe, day, symbol)
            prev_row = read_symbol_day(timeframe, prev_day, symbol, last=True) if prev_day else None
            event_row = read_symbol_day(timeframe, day, symbol, last=False)
            if not prev_row or not event_row:
                results.append(
                    {
                        "timeframe": timeframe,
                        "symbol": symbol,
                        "execution_date": day_str,
                        "status": "missing_output_row",
                        "previous_trade_date": str(prev_day) if prev_day else None,
                        "ok": False,
                    }
                )
                continue
            raw_gap = event_row.get("raw_open") / prev_row.get("raw_close") - 1 if prev_row.get("raw_close") else None
            adjusted_gap = event_row.get("open") / prev_row.get("close") - 1 if prev_row.get("close") else None
            observed_price_step = (
                prev_row.get("price_adjustment_factor_to_latest") / event_row.get("price_adjustment_factor_to_latest")
                if event_row.get("price_adjustment_factor_to_latest")
                else None
            )
            observed_volume_step = (
                prev_row.get("volume_adjustment_factor_to_latest") / event_row.get("volume_adjustment_factor_to_latest")
                if event_row.get("volume_adjustment_factor_to_latest")
                else None
            )
            expected_price_step = 1.0 / expected_ratio
            expected_volume_step = expected_ratio
            ok = (
                observed_price_step is not None
                and abs(observed_price_step - expected_price_step) < 1e-9
                and observed_volume_step is not None
                and abs(observed_volume_step - expected_volume_step) < 1e-9
                and bool(event_row.get("has_split"))
            )
            results.append(
                {
                    "timeframe": timeframe,
                    "symbol": symbol,
                    "execution_date": day_str,
                    "previous_trade_date": str(prev_day),
                    "raw_close_prev": prev_row.get("raw_close"),
                    "raw_open_event": event_row.get("raw_open"),
                    "adjusted_close_prev": prev_row.get("close"),
                    "adjusted_open_event": event_row.get("open"),
                    "raw_gap_close_to_open": raw_gap,
                    "adjusted_gap_close_to_open": adjusted_gap,
                    "expected_price_factor_step": expected_price_step,
                    "observed_price_factor_step": observed_price_step,
                    "expected_volume_factor_step": expected_volume_step,
                    "observed_volume_factor_step": observed_volume_step,
                    "has_split": bool(event_row.get("has_split")),
                    "split_ratio": event_row.get("split_ratio"),
                    "split_direction": event_row.get("split_direction"),
                    "ok": bool(ok),
                }
            )
    return results


def write_report(path: Path, manifest: dict[str, Any]) -> None:
    lines = [
        "# Split-Adjusted Bars Pilot Report",
        "",
        f"- generated_at: {manifest['generated_at']}",
        f"- years: {manifest['years']}",
        f"- symbols: {manifest['symbols']['pilot_symbol_count']}",
        f"- factors: `{manifest['factor_path']}`",
        "- dividend_total_return_adjusted: false",
        "- raw fields: raw_open/raw_high/raw_low/raw_close/raw_volume are preserved; raw_vwap is preserved only when input vwap exists.",
        "",
        "## Outputs",
        "",
        "| timeframe | rows | files | missing factor rows | illegal OHLC rows | output root |",
        "| --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for timeframe, summary in manifest["timeframes"].items():
        lines.append(
            f"| {timeframe} | {summary['row_count']:,} | {summary['output_file_count']:,} | {summary['missing_factor_rows']:,} | {summary['illegal_ohlc_rows']:,} | `{summary['output_root']}` |"
        )
    lines.extend(["", "## Rows By Year", "", "| timeframe | 2020 | 2021 | 2022 |", "| --- | ---: | ---: | ---: |"])
    for timeframe, summary in manifest["timeframes"].items():
        yc = summary["year_counts"]
        lines.append(f"| {timeframe} | {yc.get('2020', 0):,} | {yc.get('2021', 0):,} | {yc.get('2022', 0):,} |")
    lines.extend(["", "Detailed per timeframe/year/symbol row counts are written to each `_pilot_row_counts_by_year_symbol.parquet` file.", ""])
    lines.extend(["## Key Split Continuity Checks", "", "| tf | symbol | date | prev | raw gap | adjusted gap | price step | volume step | status | ok |", "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |"])
    for item in manifest["key_split_validation"]:
        lines.append(
            "| {tf} | {symbol} | {date} | {prev} | {raw_gap} | {adj_gap} | {price_step} | {volume_step} | {status} | {ok} |".format(
                tf=item["timeframe"],
                symbol=item["symbol"],
                date=item["execution_date"],
                prev=item.get("previous_trade_date", ""),
                raw_gap=item.get("raw_gap_close_to_open", ""),
                adj_gap=item.get("adjusted_gap_close_to_open", ""),
                price_step=item.get("observed_price_factor_step", ""),
                volume_step=item.get("observed_volume_factor_step", ""),
                status=item.get("status", "checked"),
                ok=item.get("ok"),
            )
        )
    lines.extend(
        [
            "",
            "## Readiness",
            "",
            f"- missing factor rows: {manifest['totals']['missing_factor_rows']:,}",
            f"- illegal OHLC rows: {manifest['totals']['illegal_ohlc_rows']:,}",
            "- full rebuild readiness: ready if downstream accepts pilot subdirectory layout and current missing/illegal counts remain zero.",
        ]
    )
    atomic_text(path, "\n".join(lines) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", default="2020,2021,2022")
    parser.add_argument("--timeframes", default="1d,240m,60m,1m")
    parser.add_argument("--top-n", type=int, default=50)
    args = parser.parse_args()

    years = [int(item.strip()) for item in args.years.split(",") if item.strip()]
    timeframes = [item.strip() for item in args.timeframes.split(",") if item.strip()]
    generated_at = utc_now()
    symbols, symbol_meta = build_pilot_symbols(years, args.top_n)
    factors = load_factors(symbols, years)
    manifest: dict[str, Any] = {
        "generated_at": generated_at,
        "years": years,
        "timeframes_requested": timeframes,
        "factor_path": str(FACTOR_PATH),
        "symbols": symbol_meta,
        "timeframes": {},
        "dividend_total_return_adjusted": False,
    }
    totals = {"row_count": 0, "missing_factor_rows": 0, "illegal_ohlc_rows": 0}
    for timeframe in timeframes:
        print(f"process {timeframe}", flush=True)
        summary = process_timeframe(timeframe, years, symbols, factors, generated_at)
        manifest["timeframes"][timeframe] = summary
        totals["row_count"] += summary["row_count"]
        totals["missing_factor_rows"] += summary["missing_factor_rows"]
        totals["illegal_ohlc_rows"] += summary["illegal_ohlc_rows"]
    manifest["totals"] = totals
    manifest["key_split_validation"] = validate_splits(timeframes)
    manifest_path = DATA_ROOT / "processed" / "polygon" / "split_adjusted_bars_pilot_manifest.json"
    report_path = DATA_ROOT / "processed" / "polygon" / "split_adjusted_bars_pilot_report.md"
    atomic_json(manifest_path, manifest)
    write_report(report_path, manifest)
    print(report_path, flush=True)


if __name__ == "__main__":
    main()

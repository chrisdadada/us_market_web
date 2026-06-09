from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import polars as pl


DATA_ROOT = Path("/Volumes/Extreme SSD/market-data-lab/data")
FACTOR_PATH = DATA_ROOT / "features" / "polygon" / "adjustments" / "adjustment_factors_by_symbol_date.parquet"
INPUT_ROOTS = {
    "1m": DATA_ROOT / "processed" / "polygon" / "stocks_rth" / "1m",
    "60m": DATA_ROOT / "processed" / "polygon" / "stocks_rth" / "60m",
    "240m": DATA_ROOT / "processed" / "polygon" / "stocks_rth" / "240m",
    "1d": DATA_ROOT / "processed" / "polygon" / "stocks" / "1d",
}
OUTPUT_ROOTS = {
    "1m": DATA_ROOT / "processed" / "polygon" / "stocks_split_adjusted_rth" / "1m" / "split_only_v1_2016_2026",
    "60m": DATA_ROOT / "processed" / "polygon" / "stocks_split_adjusted_rth" / "60m" / "split_only_v1_2016_2026",
    "240m": DATA_ROOT / "processed" / "polygon" / "stocks_split_adjusted_rth" / "240m" / "split_only_v1_2016_2026",
    "1d": DATA_ROOT / "processed" / "polygon" / "stocks_split_adjusted" / "1d" / "split_only_v1_2016_2026",
}
MANIFEST_PATH = DATA_ROOT / "processed" / "polygon" / "split_adjusted_bars_split_only_v1_manifest.json"
REPORT_PATH = DATA_ROOT / "processed" / "polygon" / "split_adjusted_bars_split_only_v1_report.md"
START_DATE = date(2016, 5, 11)
END_DATE = date(2026, 5, 20)

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


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    atomic_text(path, json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n")


def parse_day(path: Path) -> date:
    return datetime.strptime(path.stem, "%Y-%m-%d").date()


def input_paths(timeframe: str, year: int) -> list[Path]:
    root = INPUT_ROOTS[timeframe] / str(year)
    if not root.exists():
        return []
    paths = []
    for path in root.glob("*/*.parquet"):
        if path.name.startswith("._"):
            continue
        trade_day = parse_day(path)
        if START_DATE <= trade_day <= END_DATE:
            paths.append(path)
    return sorted(paths)


def output_path_for(input_path: Path, timeframe: str) -> Path:
    year = input_path.parent.parent.name
    month = input_path.parent.name
    return OUTPUT_ROOTS[timeframe] / year / month / input_path.name


def load_year_factors(year: int) -> tuple[dict[date, pl.DataFrame], pl.DataFrame]:
    start = date(year, 1, 1)
    end = date(year, 12, 31)
    df = (
        pl.scan_parquet(str(FACTOR_PATH))
        .filter((pl.col("trade_date") >= start) & (pl.col("trade_date") <= end))
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
    return {part["trade_date"][0]: part for part in df.partition_by("trade_date", maintain_order=False)}, df


def output_stats(path: Path) -> dict[str, Any]:
    frame = pl.scan_parquet(str(path))
    schema_names = frame.collect_schema().names()
    stats = frame.select(
        [
            pl.len().alias("rows"),
            pl.n_unique("symbol").alias("symbols"),
            pl.min("trade_date").alias("min_trade_date"),
            pl.max("trade_date").alias("max_trade_date"),
            pl.sum("factor_missing").alias("missing_factor_count") if "factor_missing" in schema_names else pl.lit(0).alias("missing_factor_count"),
            pl.sum("factor_fallback_used").alias("factor_fallback_count") if "factor_fallback_used" in schema_names else pl.lit(0).alias("factor_fallback_count"),
        ]
    ).collect().to_dicts()[0]
    illegal = 0
    if {"open", "high", "low", "close"}.issubset(set(schema_names)):
        illegal = (
            frame.filter(
                (pl.col("high") < pl.max_horizontal(["open", "close", "low"]))
                | (pl.col("low") > pl.min_horizontal(["open", "close", "high"]))
                | (pl.col("open") <= 0)
                | (pl.col("high") <= 0)
                | (pl.col("low") <= 0)
                | (pl.col("close") <= 0)
            )
            .select(pl.len())
            .collect()
            .item()
        )
    return {
        "rows": int(stats["rows"]),
        "symbols": int(stats["symbols"]),
        "symbol_counts": (
            frame.group_by("symbol")
            .agg(pl.len().alias("row_count"))
            .collect()
            .to_dicts()
        ),
        "min_trade_date": str(stats["min_trade_date"]),
        "max_trade_date": str(stats["max_trade_date"]),
        "missing_factor_count": int(stats["missing_factor_count"] or 0),
        "factor_fallback_count": int(stats["factor_fallback_count"] or 0),
        "illegal_ohlc_count": int(illegal),
    }


def nearest_factor_fallback(factor_history: pl.DataFrame, trade_day: date, symbols: list[str]) -> pl.DataFrame:
    if factor_history.is_empty() or not symbols:
        return factor_history.head(0).drop("trade_date")
    prev = (
        factor_history.filter((pl.col("symbol").is_in(symbols)) & (pl.col("trade_date") <= trade_day))
        .sort(["symbol", "trade_date"])
        .group_by("symbol")
        .last()
    )
    filled = set(prev["symbol"].to_list()) if not prev.is_empty() else set()
    remaining = [symbol for symbol in symbols if symbol not in filled]
    if remaining:
        nxt = (
            factor_history.filter((pl.col("symbol").is_in(remaining)) & (pl.col("trade_date") >= trade_day))
            .sort(["symbol", "trade_date"])
            .group_by("symbol")
            .first()
        )
        prev = pl.concat([prev, nxt], how="vertical") if not nxt.is_empty() else prev
    return prev.drop("trade_date") if "trade_date" in prev.columns else prev


def exact_factors_for_raw_dates(raw: pl.DataFrame, factors_by_day: dict[date, pl.DataFrame]) -> pl.DataFrame | None:
    parts = []
    for trade_day in raw["trade_date"].unique().to_list():
        factor_day = factors_by_day.get(trade_day)
        if factor_day is not None:
            parts.append(factor_day)
    if not parts:
        return None
    return pl.concat(parts, how="vertical")


def adjust_file(input_path: Path, output_path: Path, factors_by_day: dict[date, pl.DataFrame], factor_history: pl.DataFrame, generated_at: str) -> dict[str, Any]:
    raw = (
        pl.scan_parquet(str(input_path))
        .with_columns(
            [
                pl.col("symbol").cast(pl.Utf8).str.to_uppercase().alias("symbol"),
                pl.col("trade_date").cast(pl.Date).alias("trade_date"),
            ]
        )
        .collect()
    )
    if raw.is_empty():
        return {"rows": 0, "symbols": 0, "missing_factor_count": 0, "illegal_ohlc_count": 0}

    exact_factors = exact_factors_for_raw_dates(raw, factors_by_day)
    if exact_factors is None:
        joined = raw.with_columns(
            [
                pl.lit(None, dtype=pl.Float64).alias("price_adjustment_factor_to_latest"),
                pl.lit(None, dtype=pl.Float64).alias("volume_adjustment_factor_to_latest"),
                pl.lit(None, dtype=pl.Boolean).alias("has_split"),
                pl.lit(None, dtype=pl.Float64).alias("split_ratio"),
                pl.lit(None, dtype=pl.Utf8).alias("split_direction"),
                pl.lit(None, dtype=pl.Utf8).alias("source_split_id"),
            ]
        )
    else:
        joined = raw.join(exact_factors, on=["symbol", "trade_date"], how="left")

    joined = joined.with_columns(
        [
            pl.col("price_adjustment_factor_to_latest").is_null().alias("factor_missing"),
            pl.lit(False).alias("factor_fallback_used"),
        ]
    )
    exact_missing_symbols = joined.filter(pl.col("factor_missing")).get_column("symbol").unique().to_list()
    if exact_missing_symbols:
        fallback = nearest_factor_fallback(factor_history, parse_day(input_path), exact_missing_symbols)
        if not fallback.is_empty():
            joined = joined.join(fallback, on="symbol", how="left", suffix="_fallback")
            for column in [
                "price_adjustment_factor_to_latest",
                "volume_adjustment_factor_to_latest",
                "has_split",
                "split_ratio",
                "split_direction",
                "source_split_id",
            ]:
                joined = joined.with_columns(pl.coalesce([pl.col(column), pl.col(f"{column}_fallback")]).alias(column)).drop(f"{column}_fallback")
            joined = joined.with_columns(
                (pl.col("factor_missing") & pl.col("price_adjustment_factor_to_latest").is_not_null()).alias("factor_fallback_used")
            )
    joined = joined.with_columns(
        pl.col("price_adjustment_factor_to_latest").is_null().alias("factor_missing")
    )
    missing_factor_count = int(joined["factor_missing"].sum())
    factor_fallback_count = int(joined["factor_fallback_used"].sum())
    joined = joined.with_columns(
        [
            pl.col("price_adjustment_factor_to_latest").fill_null(1.0),
            pl.col("volume_adjustment_factor_to_latest").fill_null(1.0),
            pl.col("has_split").fill_null(False),
        ]
    )

    joined_for_output = joined.drop("factor_fallback_used")
    price_cols = [column for column in ["open", "high", "low", "close", "vwap"] if column in joined_for_output.columns]
    exprs: list[pl.Expr] = []
    for column in price_cols:
        exprs.append(pl.col(column).alias(f"raw_{column}"))
        exprs.append((pl.col(column) * pl.col("price_adjustment_factor_to_latest")).alias(column))
    if "volume" in joined_for_output.columns:
        exprs.append(pl.col("volume").alias("raw_volume"))
        exprs.append((pl.col("volume") * pl.col("volume_adjustment_factor_to_latest")).alias("volume"))
    adjusted = joined_for_output.with_columns(exprs).with_columns(
        [
            pl.lit(generated_at).alias("split_adjusted_generated_at"),
            pl.lit("polygon_splits").alias("adjustment_data_source"),
        ]
    )

    if {"open", "high", "low", "close"}.issubset(set(adjusted.columns)):
        illegal_ohlc_count = int(
            adjusted.filter(
                (pl.col("high") < pl.max_horizontal(["open", "close", "low"]))
                | (pl.col("low") > pl.min_horizontal(["open", "close", "high"]))
                | (pl.col("open") <= 0)
                | (pl.col("high") <= 0)
                | (pl.col("low") <= 0)
                | (pl.col("close") <= 0)
            ).height
        )
    else:
        illegal_ohlc_count = 0

    symbol_counts = adjusted.group_by("symbol").agg(pl.len().alias("row_count")).to_dicts()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = output_path.with_name(f".{output_path.name}.tmp")
    adjusted.write_parquet(tmp, compression="zstd", statistics=True)
    tmp.replace(output_path)
    return {
        "rows": int(adjusted.height),
        "symbols": int(adjusted["symbol"].n_unique()),
        "symbol_counts": symbol_counts,
        "missing_factor_count": missing_factor_count,
        "factor_fallback_count": factor_fallback_count,
        "illegal_ohlc_count": illegal_ohlc_count,
        "min_trade_date": str(adjusted["trade_date"].min()),
        "max_trade_date": str(adjusted["trade_date"].max()),
    }


def process_year(timeframe: str, year: int, generated_at: str) -> dict[str, Any]:
    paths = input_paths(timeframe, year)
    factors_by_day, factor_history = load_year_factors(year)
    summary = {
        "timeframe": timeframe,
        "year": year,
        "input_files": len(paths),
        "output_files": 0,
        "rows": 0,
        "symbols": set(),
        "missing_factor_count": 0,
        "factor_fallback_count": 0,
        "illegal_ohlc_count": 0,
        "min_trade_date": None,
        "max_trade_date": None,
        "resumed_files": 0,
    }
    row_counts: list[dict[str, Any]] = []
    for index, path in enumerate(paths, start=1):
        out = output_path_for(path, timeframe)
        if out.exists():
            stats = output_stats(out)
            summary["resumed_files"] += 1
        else:
            trade_day = parse_day(path)
            stats = adjust_file(path, out, factors_by_day, factor_history, generated_at)
        if stats["rows"] == 0:
            continue
        summary["output_files"] += 1
        summary["rows"] += stats["rows"]
        summary["missing_factor_count"] += stats["missing_factor_count"]
        summary["factor_fallback_count"] += stats.get("factor_fallback_count", 0)
        summary["illegal_ohlc_count"] += stats["illegal_ohlc_count"]
        summary["min_trade_date"] = (
            stats["min_trade_date"]
            if summary["min_trade_date"] is None
            else min(summary["min_trade_date"], stats["min_trade_date"])
        )
        summary["max_trade_date"] = (
            stats["max_trade_date"]
            if summary["max_trade_date"] is None
            else max(summary["max_trade_date"], stats["max_trade_date"])
        )
        # Per-symbol row counts are collected from the in-memory adjusted frame for newly
        # written files, and from existing output only when resuming.
        for record in stats.get("symbol_counts", []):
            symbol = record["symbol"]
            row_counts.append(
                {
                    "symbol": symbol,
                    "row_count": int(record["row_count"]),
                    "timeframe": timeframe,
                    "year": year,
                }
            )
            summary["symbols"].add(symbol)
        if index % 25 == 0:
            print(
                f"{timeframe} {year} files={index}/{len(paths)} rows={summary['rows']:,} resumed={summary['resumed_files']:,}",
                flush=True,
            )

    row_counts_path = OUTPUT_ROOTS[timeframe] / str(year) / f"_row_counts_{timeframe}_{year}.parquet"
    if row_counts:
        row_counts_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = row_counts_path.with_name(f".{row_counts_path.name}.tmp")
        pl.from_dicts(row_counts).write_parquet(tmp, compression="zstd", statistics=True)
        tmp.replace(row_counts_path)
    summary["symbols"] = len(summary["symbols"])
    summary["row_counts_path"] = str(row_counts_path) if row_counts else None
    year_manifest = OUTPUT_ROOTS[timeframe] / str(year) / f"_manifest_{timeframe}_{year}.json"
    atomic_json(year_manifest, summary)
    summary["year_manifest_path"] = str(year_manifest)
    return summary


def read_symbol_day(timeframe: str, day: date, symbol: str, last: bool) -> dict[str, Any] | None:
    path = OUTPUT_ROOTS[timeframe] / str(day.year) / f"{day.month:02d}" / f"{day.isoformat()}.parquet"
    if not path.exists():
        return None
    df = pl.scan_parquet(str(path)).filter(pl.col("symbol") == symbol).collect()
    if df.is_empty():
        return None
    sort_column = "timestamp_utc" if "timestamp_utc" in df.columns else "timestamp_et" if "timestamp_et" in df.columns else None
    if sort_column:
        df = df.sort(sort_column, descending=last)
    return df.row(0, named=True)


def previous_output_day(timeframe: str, day: date, symbol: str) -> date | None:
    year_root = OUTPUT_ROOTS[timeframe] / str(day.year)
    candidates: list[date] = []
    if not year_root.exists():
        return None
    for path in year_root.glob("*/*.parquet"):
        if path.name.startswith("._") or path.name.startswith("_"):
            continue
        try:
            candidate = datetime.strptime(path.stem, "%Y-%m-%d").date()
        except ValueError:
            continue
        if candidate < day:
            candidates.append(candidate)
    for candidate in sorted(candidates, reverse=True):
        if read_symbol_day(timeframe, candidate, symbol, last=True):
            return candidate
    return None


def validate_splits(timeframes: list[str]) -> list[dict[str, Any]]:
    results = []
    for timeframe in timeframes:
        for symbol, day_str, ratio in KEY_SPLIT_CHECKS:
            day = datetime.strptime(day_str, "%Y-%m-%d").date()
            prev_day = previous_output_day(timeframe, day, symbol)
            prev_row = read_symbol_day(timeframe, prev_day, symbol, last=True) if prev_day else None
            event_row = read_symbol_day(timeframe, day, symbol, last=False)
            if not prev_row or not event_row:
                results.append(
                    {
                        "timeframe": timeframe,
                        "symbol": symbol,
                        "execution_date": day_str,
                        "previous_trade_date": str(prev_day) if prev_day else None,
                        "status": "missing_output_row",
                        "ok": False,
                    }
                )
                continue
            expected_price_step = 1.0 / ratio
            expected_volume_step = ratio
            observed_price_step = prev_row["price_adjustment_factor_to_latest"] / event_row["price_adjustment_factor_to_latest"]
            observed_volume_step = prev_row["volume_adjustment_factor_to_latest"] / event_row["volume_adjustment_factor_to_latest"]
            raw_gap = event_row["raw_open"] / prev_row["raw_close"] - 1 if prev_row.get("raw_close") else None
            adjusted_gap = event_row["open"] / prev_row["close"] - 1 if prev_row.get("close") else None
            ok = (
                abs(observed_price_step - expected_price_step) < 1e-9
                and abs(observed_volume_step - expected_volume_step) < 1e-9
                and bool(event_row["has_split"])
            )
            results.append(
                {
                    "timeframe": timeframe,
                    "symbol": symbol,
                    "execution_date": day_str,
                    "previous_trade_date": str(prev_day),
                    "raw_gap_close_to_open": raw_gap,
                    "adjusted_gap_close_to_open": adjusted_gap,
                    "expected_price_factor_step": expected_price_step,
                    "observed_price_factor_step": observed_price_step,
                    "expected_volume_factor_step": expected_volume_step,
                    "observed_volume_factor_step": observed_volume_step,
                    "has_split": bool(event_row["has_split"]),
                    "split_ratio": event_row["split_ratio"],
                    "split_direction": event_row["split_direction"],
                    "status": "checked",
                    "ok": bool(ok),
                }
            )
    return results


def write_report(manifest: dict[str, Any]) -> None:
    lines = [
        "# Split-Only Adjusted Bars Full Rebuild Report",
        "",
        f"- generated_at: {manifest['finished_at']}",
        f"- factor_path: `{manifest['factor_path']}`",
        f"- date_range: {manifest['date_range']['start']}..{manifest['date_range']['end']}",
        "- dividend_total_return_adjusted: false",
        "- raw fields preserved: raw_open/raw_high/raw_low/raw_close/raw_volume; raw_vwap when input has vwap.",
        "",
        "## Output Roots",
        "",
    ]
    for timeframe, root in OUTPUT_ROOTS.items():
        lines.append(f"- {timeframe}: `{root}`")
    lines.extend(
        [
            "",
            "## Timeframe / Year Summary",
            "",
            "| timeframe | year | files | rows | symbols | missing factors | factor fallback | illegal OHLC | min date | max date | resumed files |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |",
        ]
    )
    for item in manifest["year_summaries"]:
        lines.append(
            f"| {item['timeframe']} | {item['year']} | {item['output_files']:,} | {item['rows']:,} | {item['symbols']:,} | {item['missing_factor_count']:,} | {item.get('factor_fallback_count', 0):,} | {item['illegal_ohlc_count']:,} | {item['min_trade_date']} | {item['max_trade_date']} | {item['resumed_files']:,} |"
        )
    lines.extend(
        [
            "",
            "## Totals",
            "",
            f"- rows: {manifest['totals']['rows']:,}",
            f"- files: {manifest['totals']['files']:,}",
            f"- missing_factor_count: {manifest['totals']['missing_factor_count']:,}",
            f"- factor_fallback_count: {manifest['totals'].get('factor_fallback_count', 0):,}",
            f"- illegal_ohlc_count: {manifest['totals']['illegal_ohlc_count']:,}",
            "",
            "## Key Split Continuity Checks",
            "",
            "| tf | symbol | date | prev | raw gap | adjusted gap | price step | volume step | status | ok |",
            "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |",
        ]
    )
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
                status=item.get("status", ""),
                ok=item.get("ok"),
            )
        )
    lines.extend(
        [
            "",
            "## Readiness",
            "",
            "- Full rebuild is ready for downstream adjusted-bar research if missing_factor_count and illegal_ohlc_count stay at zero.",
            "- Strategies were not run.",
        ]
    )
    atomic_text(REPORT_PATH, "\n".join(lines) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", default="2016,2017,2018,2019,2020,2021,2022,2023,2024,2025,2026")
    parser.add_argument("--timeframes", default="1d,240m,60m,1m")
    args = parser.parse_args()
    years = [int(item) for item in args.years.split(",") if item.strip()]
    timeframes = [item.strip() for item in args.timeframes.split(",") if item.strip()]
    generated_at = utc_now()

    manifest: dict[str, Any] = {
        "started_at": generated_at,
        "factor_path": str(FACTOR_PATH),
        "date_range": {"start": "2016-05-11", "end": "2026-05-20"},
        "timeframes": timeframes,
        "years": years,
        "output_roots": {key: str(value) for key, value in OUTPUT_ROOTS.items()},
        "year_summaries": [],
        "dividend_total_return_adjusted": False,
        "rules": {
            "prices": "open/high/low/close/vwap multiplied by price_adjustment_factor_to_latest",
            "volume": "volume multiplied by volume_adjustment_factor_to_latest",
            "transactions": "not adjusted",
        },
    }
    totals = {"rows": 0, "files": 0, "missing_factor_count": 0, "factor_fallback_count": 0, "illegal_ohlc_count": 0}
    for timeframe in timeframes:
        for year in years:
            print(f"process {timeframe} {year}", flush=True)
            summary = process_year(timeframe, year, generated_at)
            manifest["year_summaries"].append(summary)
            totals["rows"] += summary["rows"]
            totals["files"] += summary["output_files"]
            totals["missing_factor_count"] += summary["missing_factor_count"]
            totals["factor_fallback_count"] += summary.get("factor_fallback_count", 0)
            totals["illegal_ohlc_count"] += summary["illegal_ohlc_count"]
            atomic_json(MANIFEST_PATH, {**manifest, "totals": totals, "finished_at": utc_now()})
    manifest["totals"] = totals
    manifest["key_split_validation"] = validate_splits(timeframes)
    manifest["key_split_validation_all_ok"] = all(item.get("ok") for item in manifest["key_split_validation"])
    manifest["finished_at"] = utc_now()
    atomic_json(MANIFEST_PATH, manifest)
    write_report(manifest)
    print(REPORT_PATH, flush=True)


if __name__ == "__main__":
    main()

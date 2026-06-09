from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta
from pathlib import Path

import polars as pl

from common import data_path, load_env, parse_date


EXCHANGES = ["XNYS", "XNAS", "ARCX", "XASE"]
TYPES = ["CS", "ADRC"]


def parse_file_date(path: Path) -> date:
    return datetime.strptime(path.name.removesuffix(".parquet"), "%Y-%m-%d").date()


def parquet_paths(root: Path, start: date, end: date) -> list[str]:
    paths = []
    for path in root.glob("*/*/*.parquet"):
        if path.name.startswith("._"):
            continue
        day = parse_file_date(path)
        if start <= day <= end:
            paths.append(str(path))
    return sorted(paths)


def load_ticker_meta(rest_root: Path) -> pl.DataFrame:
    active = pl.read_parquet(rest_root / "tickers_active.parquet")
    inactive = pl.read_parquet(rest_root / "tickers_inactive.parquet")
    columns = [
        "ticker",
        "name",
        "primary_exchange",
        "type",
        "active",
        "currency_name",
        "cik",
        "composite_figi",
        "share_class_figi",
        "delisted_utc",
    ]
    frames = []
    for df in [active, inactive]:
        for column in columns:
            if column not in df.columns:
                df = df.with_columns(pl.lit(None, dtype=pl.String).alias(column))
        frames.append(
            df.select(
                [
                    pl.col(column).cast(pl.Boolean if column == "active" else pl.String, strict=False)
                    for column in columns
                ]
            )
        )
    return (
        pl.concat(frames, how="vertical")
        .with_columns(
            [
                pl.col("ticker").alias("symbol"),
                pl.col("delisted_utc")
                .str.strptime(pl.Datetime(time_zone="UTC"), strict=False)
                .dt.date()
                .alias("delisted_date"),
            ]
        )
        .unique("symbol", keep="first")
    )


def build_universe(start: date, end: date, output_start: date, output_end: date) -> pl.DataFrame:
    load_env()
    daily_root = data_path("processed", "polygon", "stocks", "1d")
    rest_root = data_path("raw", "polygon_rest")
    meta = load_ticker_meta(rest_root)
    paths = parquet_paths(daily_root, start, end)
    if not paths:
        raise SystemExit(f"No daily parquet files found in {daily_root} for {start}..{end}")

    daily = (
        pl.scan_parquet(paths)
        .select(["symbol", "trade_date", "open", "high", "low", "close", "volume", "transactions"])
        .with_columns(
            [
                (pl.col("close") * pl.col("volume")).alias("dollar_volume"),
                ((pl.col("high") - pl.col("low")) / pl.col("close")).alias("intraday_range_pct"),
            ]
        )
        .sort(["symbol", "trade_date"])
        .with_columns(
            [
                pl.col("dollar_volume")
                .rolling_median(window_size=20, min_samples=10)
                .over("symbol")
                .alias("median_dollar_volume_20d"),
                pl.col("volume")
                .rolling_median(window_size=20, min_samples=10)
                .over("symbol")
                .alias("median_volume_20d"),
                pl.col("close").shift(20).over("symbol").alias("close_20d_ago"),
            ]
        )
        .with_columns(((pl.col("close") / pl.col("close_20d_ago")) - 1).alias("return_20d"))
        .collect(engine="streaming")
    )

    out = daily.join(meta, on="symbol", how="left").with_columns(
        [
            pl.col("type").is_in(TYPES).fill_null(False).alias("is_common_or_adr"),
            pl.col("primary_exchange").is_in(EXCHANGES).fill_null(False).alias("is_major_exchange"),
            (pl.col("currency_name") == "usd").fill_null(False).alias("is_usd"),
            ((pl.col("delisted_date").is_null()) | (pl.col("trade_date") <= pl.col("delisted_date")))
            .fill_null(True)
            .alias("not_after_delist"),
            (pl.col("close") >= 1).alias("price_ge_1"),
            (pl.col("median_dollar_volume_20d") >= 1_000_000).fill_null(False).alias("adv20_ge_1m"),
            (pl.col("median_volume_20d") >= 100_000).fill_null(False).alias("vol20_ge_100k"),
        ]
    )
    out = out.with_columns(
        (
            pl.col("is_common_or_adr")
            & pl.col("is_major_exchange")
            & pl.col("is_usd")
            & pl.col("not_after_delist")
            & pl.col("price_ge_1")
            & pl.col("adv20_ge_1m")
            & pl.col("vol20_ge_100k")
        ).alias("tradable_core")
    )
    return out.filter((pl.col("trade_date") >= output_start) & (pl.col("trade_date") <= output_end)).sort(
        ["trade_date", "symbol"]
    )


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2016-05-11")
    parser.add_argument("--end", default=datetime.now().date().isoformat())
    parser.add_argument("--warmup-days", type=int, default=60)
    args = parser.parse_args()

    start = parse_date(args.start)
    end = parse_date(args.end)
    if not start or not end:
        raise SystemExit("Both --start and --end are required")

    universe_root = data_path("features", "polygon", "universe", "daily_tradable_universe_by_year")
    counts_frames = []
    for year in range(start.year, end.year + 1):
        output_start = max(start, date(year, 1, 1))
        output_end = min(end, date(year, 12, 31))
        scan_start = output_start - timedelta(days=args.warmup_days)
        out = build_universe(scan_start, output_end, output_start, output_end)

        output = universe_root / f"universe_{year}.parquet"
        output.parent.mkdir(parents=True, exist_ok=True)
        tmp = output.with_suffix(".parquet.tmp")
        out.write_parquet(tmp, compression="zstd", statistics=True)
        tmp.replace(output)
        print(f"{output} rows={out.height:,}", flush=True)

        counts_frames.append(
            out.group_by("trade_date")
            .agg(
                [
                    pl.len().alias("symbols_total"),
                    pl.col("tradable_core").sum().alias("tradable_core"),
                    pl.col("is_common_or_adr").sum().alias("common_or_adr"),
                    pl.col("adv20_ge_1m").sum().alias("adv20_ge_1m"),
                ]
            )
            .sort("trade_date")
        )

    summary = pl.concat(counts_frames).sort("trade_date")
    summary_out = data_path("features", "polygon", "universe", "daily_universe_counts.parquet")
    summary_out.parent.mkdir(parents=True, exist_ok=True)
    summary.write_parquet(summary_out, compression="zstd", statistics=True)
    print(summary_out)
    print(summary.tail(1))


if __name__ == "__main__":
    main()

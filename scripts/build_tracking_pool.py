#!/usr/bin/env python3
from __future__ import annotations

import argparse
import math
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = Path("/Volumes/Extreme SSD/market-data-lab/data")
DEFAULT_SYMBOLS = [
    "AAPL",
    "AMD",
    "ARM",
    "ASML",
    "AVGO",
    "AXTI",
    "SOXL",
    "DRAM",
    "GOOG",
    "HOOD",
    "IBM",
    "INTC",
    "LITE",
    "MRVL",
    "MU",
    "NOK",
    "NVDA",
    "SPCX",
    "QQQ",
    "RKLB",
    "SNDK",
    "SPX",
    "SPY",
    "STX",
    "DELL",
    "AMAT",
    "TSM",
    "WDC",
    "000660",
    "005930",
]
SECTOR_BY_TYPE = {
    "ETF": "ETF",
    "INDEX": "指数",
}


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def clean_number(value: Any, digits: int = 2) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return round(number, digits)


def compact_money(value: Any) -> str:
    number = clean_number(value, 2)
    if number is None:
        return "--"
    absolute = abs(number)
    if absolute >= 1_000_000_000:
        return f"${number / 1_000_000_000:.1f}B"
    if absolute >= 1_000_000:
        return f"${number / 1_000_000:.1f}M"
    if absolute >= 1_000:
        return f"${number / 1_000:.1f}K"
    return f"${number:.0f}"


def compact_market_cap(value: Any) -> str:
    number = clean_number(value, 2)
    if number is None:
        return "--"
    absolute = abs(number)
    if absolute >= 1_000_000_000:
        return f"{number / 1_000_000_000:.2f}B"
    if absolute >= 1_000_000:
        return f"{number / 1_000_000:.2f}M"
    if absolute >= 1_000:
        return f"{number / 1_000:.2f}K"
    return f"{number:.0f}"


def latest_trade_date(data_root: Path) -> str:
    universe_dir = data_root / "features" / "polygon" / "universe" / "daily_tradable_universe_by_year"
    files = sorted(universe_dir.glob("universe_*.parquet"))
    if not files:
        raise FileNotFoundError(f"No universe files found in {universe_dir}")
    latest = pd.concat((pd.read_parquet(path, columns=["trade_date"]) for path in files[-2:]), ignore_index=True)
    return str(latest["trade_date"].max())


def load_universe(data_root: Path, as_of: str) -> pd.DataFrame:
    year = int(as_of[:4])
    path = data_root / "features" / "polygon" / "universe" / "daily_tradable_universe_by_year" / f"universe_{year}.parquet"
    columns = [
        "symbol",
        "trade_date",
        "close",
        "dollar_volume",
        "median_dollar_volume_20d",
        "name",
        "type",
        "tradable_core",
        "is_common_or_adr",
    ]
    frame = pd.read_parquet(path, columns=columns)
    frame["trade_date"] = frame["trade_date"].astype(str)
    return frame[frame["trade_date"] == as_of].copy()


def load_daily(data_root: Path, as_of: str) -> pd.DataFrame:
    year = int(as_of[:4])
    root = data_root / "processed" / "polygon" / "stocks_split_adjusted" / "1d"
    paths = [root / f"daily_split_adjusted_{year - 1}.parquet", root / f"daily_split_adjusted_{year}.parquet"]
    existing = [path for path in paths if path.exists()]
    if not existing:
        raise FileNotFoundError(f"No adjusted daily parquet files found in {root}")
    columns = ["symbol", "trade_date", "adj_close", "adj_volume"]
    frame = pd.concat((pd.read_parquet(path, columns=columns) for path in existing), ignore_index=True)
    frame["trade_date"] = frame["trade_date"].astype(str)
    return frame[frame["trade_date"] <= as_of].dropna(subset=["symbol", "trade_date", "adj_close"])


def series_return(series: pd.Series, offset: int) -> float | None:
    clean = series.dropna()
    if len(clean) <= offset:
        return None
    previous = clean.iloc[-1 - offset]
    latest = clean.iloc[-1]
    if not previous:
        return None
    return clean_number((latest / previous - 1) * 100, 2)


def ytd_return(series: pd.Series, as_of: str) -> float | None:
    clean = series.dropna()
    year_values = clean[clean.index.astype(str).str.startswith(as_of[:4])]
    if len(year_values) < 2:
        return None
    first = year_values.iloc[0]
    latest = year_values.iloc[-1]
    if not first:
        return None
    return clean_number((latest / first - 1) * 100, 2)


def build_rows(data_root: Path, as_of: str, symbols: list[str]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    universe = load_universe(data_root, as_of)
    daily = load_daily(data_root, as_of)
    wanted = [symbol.upper() for symbol in symbols]
    daily = daily[daily["symbol"].isin(wanted)].copy()
    universe_map = universe[universe["symbol"].isin(wanted)].set_index("symbol").to_dict("index")
    close = daily.pivot(index="trade_date", columns="symbol", values="adj_close").ffill()
    volume = daily.pivot(index="trade_date", columns="symbol", values="adj_volume").fillna(0)

    rows: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    for symbol in wanted:
        if symbol not in close.columns:
            missing.append({"symbol": symbol, "company": symbol, "reason": "本地行情未覆盖"})
            continue
        prices = close[symbol]
        latest_price = clean_number(prices.dropna().iloc[-1], 3) if prices.dropna().size else None
        latest_volume = clean_number(volume[symbol].dropna().iloc[-1], 0) if symbol in volume else None
        meta = universe_map.get(symbol, {})
        asset_type = str(meta.get("type") or "").upper()
        tradable_core = bool(meta.get("tradable_core"))
        is_common_or_adr = bool(meta.get("is_common_or_adr"))
        if not (asset_type == "ETF" or (asset_type in {"CS", "ADRC", "ADR"} and tradable_core and is_common_or_adr)):
            missing.append({"symbol": symbol, "company": meta.get("name") or symbol, "reason": "本地行情低置信度"})
            continue
        dollar_volume = clean_number(meta.get("dollar_volume") or ((latest_price or 0) * (latest_volume or 0)), 0)
        median_dollar_volume = clean_number(meta.get("median_dollar_volume_20d"), 0)
        volume_ratio = clean_number(dollar_volume / median_dollar_volume, 2) if dollar_volume and median_dollar_volume and median_dollar_volume >= 1_000_000 else None
        sector = SECTOR_BY_TYPE.get(asset_type) or ""
        rows.append(
            {
                "symbol": symbol,
                "company": meta.get("name") or symbol,
                "chineseName": symbol,
                "sector": sector,
                "assetType": asset_type or "TRACKING",
                "price": latest_price,
                "change1d": series_return(prices, 1),
                "change5d": series_return(prices, 5),
                "change20d": series_return(prices, 21),
                "changeYtd": ytd_return(prices, as_of),
                "dollarVolume": dollar_volume,
                "volume": f"{latest_volume:,.0f}" if latest_volume is not None else "--",
                "volumeRatio": f"{volume_ratio}x" if volume_ratio is not None else "--",
                "marketCap": compact_market_cap(meta.get("market_cap")),
            }
        )
    rows.sort(key=lambda row: row["change20d"] if row["change20d"] is not None else -999999, reverse=True)
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return rows, missing


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the manually curated strong-stock tracking pool snapshot.")
    parser.add_argument("--data-root", type=Path, default=Path(os.environ.get("MARKET_DATA_ROOT", DEFAULT_DATA_ROOT)))
    parser.add_argument("--asof", default="")
    parser.add_argument("--symbols", nargs="*", default=DEFAULT_SYMBOLS)
    args = parser.parse_args()

    as_of = args.asof or latest_trade_date(args.data_root)
    rows, missing = build_rows(args.data_root, as_of, args.symbols)
    print(f"built {len(rows)} tracking rows for {as_of}")
    if missing:
        print("missing:", ", ".join(row["symbol"] for row in missing))


if __name__ == "__main__":
    main()

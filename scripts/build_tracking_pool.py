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
KEY_LEVEL_MIN_BARS = 90
KEY_LEVEL_HISTORY_BARS = 180
KEY_LEVEL_LOOKBACK_BARS = 120
KEY_LEVEL_PIVOT_SIDE_BARS = 3
KEY_LEVEL_BREAKOUT_CONFIRM_BARS = 2
KEY_LEVEL_RETEST_WINDOW_BARS = 20


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
    columns = ["symbol", "trade_date", "adj_high", "adj_low", "adj_close", "adj_volume"]
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


def _level_strength(touches: int, converting: bool = False) -> tuple[str, str]:
    if converting:
        return "converting", "转换中"
    if touches >= 3:
        return "strong", "强"
    if touches >= 2:
        return "medium", "中"
    return "weak", "弱"


def _level_payload(
    cluster: dict[str, Any], atr: float, role: str, converted: bool = False
) -> dict[str, Any]:
    center = float(cluster["center"])
    points = cluster["points"]
    point_types = {point["type"] for point in points}
    converting = not converted and (
        (role == "support" and point_types == {"high"})
        or (role == "resistance" and point_types == {"low"})
    )
    strength, strength_text = _level_strength(len(points), converting)
    if converting:
        basis = "原阻力突破后，等待回踩确认" if role == "support" else "原支撑跌破后，等待反抽确认"
    else:
        basis = f"近{KEY_LEVEL_LOOKBACK_BARS}日出现 {len(points)} 次确认"
    half_width = atr * 0.25
    return {
        "center": clean_number(center, 2),
        "lower": clean_number(center - half_width, 2),
        "upper": clean_number(center + half_width, 2),
        "strength": strength,
        "strengthText": strength_text,
        "touches": len(points),
        "basis": basis,
        "lastConfirmedAt": max(point["date"] for point in points),
        "sourceTypes": sorted(point_types),
    }


def _breakout_confirmation(
    cluster: dict[str, Any], bars: pd.DataFrame, atr: float
) -> dict[str, Any] | None:
    if {point["type"] for point in cluster["points"]} != {"high"}:
        return None

    level = _level_payload(cluster, atr, "resistance")
    lower = float(level["lower"])
    upper = float(level["upper"])
    last_pivot_date = max(point["date"] for point in cluster["points"])
    positions = bars.index[bars["trade_date"].astype(str) > last_pivot_date]
    if positions.empty:
        return None

    status = ""
    breakout_at = ""
    breakout_confirmed_at = ""
    retest_at = ""
    failed_at = ""
    above_streak = 0
    below_streak = 0
    confirmed_position: int | None = None

    for position in positions:
        row = bars.loc[position]
        close = float(row["adj_close"])
        date = str(row["trade_date"])

        if (
            status == "awaiting_retest"
            and confirmed_position is not None
            and position - confirmed_position > KEY_LEVEL_RETEST_WINDOW_BARS
        ):
            status = "expired"
            above_streak = 0

        if status == "expired":
            if close <= upper:
                status = ""
            continue

        if status in {"awaiting_retest", "confirmed_support"}:
            if close < lower:
                below_streak += 1
                if below_streak >= 2:
                    status = "breakout_failed"
                    failed_at = date
                    above_streak = 0
                continue
            below_streak = 0
            if (
                status == "awaiting_retest"
                and confirmed_position is not None
                and position > confirmed_position
                and position - confirmed_position <= KEY_LEVEL_RETEST_WINDOW_BARS
                and float(row["adj_low"]) <= upper
                and float(row["adj_high"]) >= lower
                and close > upper
            ):
                status = "confirmed_support"
                retest_at = date
            continue

        if close > upper:
            if above_streak == 0:
                breakout_at = date
                breakout_confirmed_at = ""
                retest_at = ""
                failed_at = ""
            above_streak += 1
            status = "breakout_watch"
            if above_streak >= KEY_LEVEL_BREAKOUT_CONFIRM_BARS:
                status = "awaiting_retest"
                breakout_confirmed_at = date
                confirmed_position = int(position)
                below_streak = 0
        else:
            above_streak = 0
            if status == "breakout_watch":
                status = ""

    if not status or status == "expired":
        return None
    event_at = failed_at or retest_at or breakout_confirmed_at or breakout_at
    return {
        "status": status,
        "level": level,
        "eventAt": event_at or None,
        "breakoutAt": breakout_at or None,
        "confirmedAt": breakout_confirmed_at or None,
        "retestAt": retest_at or None,
        "failedAt": failed_at or None,
    }


def _position_payload(
    current: float,
    support: dict[str, Any] | None,
    resistance: dict[str, Any] | None,
    atr: float,
) -> tuple[str, str, float | None, float | None]:
    support_distance = (
        max(0.0, (current - float(support["upper"])) / current * 100) if support else None
    )
    resistance_distance = (
        max(0.0, (float(resistance["lower"]) - current) / current * 100) if resistance else None
    )
    if support and float(support["lower"]) <= current <= float(support["upper"]):
        return "at_support", "进入支撑区", 0.0, resistance_distance
    if resistance and float(resistance["lower"]) <= current <= float(resistance["upper"]):
        return "at_resistance", "进入阻力区", support_distance, 0.0

    candidates: list[tuple[float, str, str]] = []
    if support and current >= float(support["upper"]):
        candidates.append((current - float(support["upper"]), "near_support", "接近支撑"))
    if resistance and current <= float(resistance["lower"]):
        candidates.append((float(resistance["lower"]) - current, "near_resistance", "接近阻力"))
    if candidates:
        gap, key, label = min(candidates, key=lambda item: item[0])
        if gap <= atr * 1.25:
            return key, label, support_distance, resistance_distance
    if support and not resistance:
        return "above_resistance", "突破前高", support_distance, None
    if resistance and not support:
        return "below_support", "跌破支撑", None, resistance_distance
    return "middle", "区间中部", support_distance, resistance_distance


def build_key_levels(bars: pd.DataFrame, as_of: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    bars = (
        bars.dropna(subset=["trade_date", "adj_high", "adj_low", "adj_close"])
        .sort_values("trade_date")
        .tail(KEY_LEVEL_HISTORY_BARS)
        .reset_index(drop=True)
    )
    history = [
        {"date": str(row.trade_date), "close": clean_number(row.adj_close, 3)}
        for row in bars.tail(60).itertuples()
        if clean_number(row.adj_close, 3) is not None
    ]
    if len(bars) < KEY_LEVEL_MIN_BARS:
        return {
            "status": "insufficient",
            "asOf": as_of,
            "availableBars": len(bars),
            "requiredBars": KEY_LEVEL_MIN_BARS,
        }, history

    previous_close = bars["adj_close"].shift(1)
    true_range = pd.concat(
        [
            bars["adj_high"] - bars["adj_low"],
            (bars["adj_high"] - previous_close).abs(),
            (bars["adj_low"] - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr = float(true_range.ewm(alpha=1 / 14, adjust=False).mean().iloc[-1])
    current = float(bars["adj_close"].iloc[-1])
    window = KEY_LEVEL_PIVOT_SIDE_BARS * 2 + 1
    pivot_high = bars["adj_high"].eq(bars["adj_high"].rolling(window, center=True).max())
    pivot_low = bars["adj_low"].eq(bars["adj_low"].rolling(window, center=True).min())
    confirmed = bars.iloc[:-KEY_LEVEL_PIVOT_SIDE_BARS].tail(KEY_LEVEL_LOOKBACK_BARS)
    points: list[dict[str, Any]] = []
    for index, row in confirmed.iterrows():
        if bool(pivot_high.iloc[index]):
            points.append({"date": str(row["trade_date"]), "price": float(row["adj_high"]), "type": "high"})
        if bool(pivot_low.iloc[index]):
            points.append({"date": str(row["trade_date"]), "price": float(row["adj_low"]), "type": "low"})

    clusters: list[dict[str, Any]] = []
    tolerance = atr * 0.75
    for point in sorted(points, key=lambda item: item["price"]):
        if not clusters or abs(point["price"] - clusters[-1]["center"]) > tolerance:
            clusters.append({"center": point["price"], "points": [point]})
            continue
        clusters[-1]["points"].append(point)
        clusters[-1]["center"] = sum(item["price"] for item in clusters[-1]["points"]) / len(
            clusters[-1]["points"]
        )

    confirmations = [
        confirmation
        for cluster in clusters
        if (confirmation := _breakout_confirmation(cluster, bars, atr)) is not None
    ]
    confirmed_centers = {
        float(item["level"]["center"])
        for item in confirmations
        if item["status"] == "confirmed_support"
    }
    below = [cluster for cluster in clusters if cluster["center"] < current]
    above = [cluster for cluster in clusters if cluster["center"] > current]
    support_clusters = [
        cluster
        for cluster in below
        if {point["type"] for point in cluster["points"]} != {"high"}
        or round(float(cluster["center"]), 2) in confirmed_centers
    ]
    support_cluster = max(support_clusters, key=lambda item: item["center"]) if support_clusters else None
    resistance_cluster = min(above, key=lambda item: item["center"]) if above else None
    secondary_cluster = sorted(support_clusters, key=lambda item: item["center"])[-2] if len(support_clusters) > 1 else None
    support = (
        _level_payload(
            support_cluster,
            atr,
            "support",
            round(float(support_cluster["center"]), 2) in confirmed_centers,
        )
        if support_cluster
        else None
    )
    resistance = _level_payload(resistance_cluster, atr, "resistance") if resistance_cluster else None
    secondary_support = (
        _level_payload(
            secondary_cluster,
            atr,
            "support",
            round(float(secondary_cluster["center"]), 2) in confirmed_centers,
        )
        if secondary_cluster
        else None
    )
    relevant_confirmations = []
    for confirmation in confirmations:
        level = confirmation["level"]
        level_center = float(level["center"])
        status = confirmation["status"]
        if status in {"breakout_watch", "awaiting_retest"}:
            if not support or level_center >= float(support["center"]):
                relevant_confirmations.append(confirmation)
        elif status == "confirmed_support":
            if support and abs(level_center - float(support["center"])) < 0.01:
                relevant_confirmations.append(confirmation)
        elif status == "breakout_failed":
            if resistance and abs(level_center - float(resistance["center"])) < 0.01:
                relevant_confirmations.append(confirmation)
    breakout_confirmation = (
        max(relevant_confirmations, key=lambda item: str(item.get("eventAt") or ""))
        if relevant_confirmations
        else None
    )
    position, position_text, support_distance, resistance_distance = _position_payload(
        current, support, resistance, atr
    )
    ma20 = float(bars["adj_close"].tail(20).mean())
    ma60 = float(bars["adj_close"].tail(60).mean())
    if current > ma20 > ma60:
        trend, trend_text = "strong", "偏强"
    elif current < ma20 < ma60:
        trend, trend_text = "weak", "偏弱"
    else:
        trend, trend_text = "mixed", "震荡"
    return {
        "status": "ready",
        "asOf": as_of,
        "availableBars": len(bars),
        "lookbackBars": KEY_LEVEL_LOOKBACK_BARS,
        "currentPrice": clean_number(current, 3),
        "support": support,
        "secondarySupport": secondary_support,
        "resistance": resistance,
        "breakoutConfirmation": breakout_confirmation,
        "position": position,
        "positionText": position_text,
        "supportDistancePct": clean_number(support_distance, 1),
        "resistanceDistancePct": clean_number(resistance_distance, 1),
        "atr14": clean_number(atr, 2),
        "atrPct": clean_number(atr / current * 100, 2),
        "ma20": clean_number(ma20, 2),
        "ma60": clean_number(ma60, 2),
        "trend": trend,
        "trendText": trend_text,
    }, history


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
        symbol_bars = daily[daily["symbol"] == symbol][
            ["trade_date", "adj_high", "adj_low", "adj_close", "adj_volume"]
        ]
        key_levels, price_history = build_key_levels(symbol_bars, as_of)
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
                "keyLevels": key_levels,
                "priceHistory": price_history,
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

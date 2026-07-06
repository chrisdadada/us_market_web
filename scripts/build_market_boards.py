#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = Path("/Volumes/Extreme SSD/market-data-lab/data")
DEFAULT_YTD_OUTPUT = ROOT / ".tmp" / "ytd-gainers.json"
DEFAULT_MOVERS_OUTPUT = ROOT / ".tmp" / "market-movers.json"


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


def compact_number(value: Any) -> str:
    number = clean_number(value, 0)
    if number is None:
        return "--"
    return f"{number:,.0f}"


def compact_money(value: Any) -> str:
    number = clean_number(value, 2)
    if number is None:
        return "--"
    abs_value = abs(number)
    if abs_value >= 1_000_000_000:
        return f"{number / 1_000_000_000:.2f}B"
    if abs_value >= 1_000_000:
        return f"{number / 1_000_000:.2f}M"
    if abs_value >= 1_000:
        return f"{number / 1_000:.2f}K"
    return f"{number:.0f}"


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def existing_name_map(*paths: Path) -> dict[str, dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in paths:
        payload = read_json(path)
        if isinstance(payload.get("rows"), list):
            rows.extend(payload["rows"])
        boards = payload.get("boards")
        if isinstance(boards, dict):
            for board in boards.values():
                if isinstance(board, dict) and isinstance(board.get("rows"), list):
                    rows.extend(board["rows"])
    return {str(row.get("symbol", "")).upper(): row for row in rows if row.get("symbol")}


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
        "volume",
        "dollar_volume",
        "median_dollar_volume_20d",
        "name",
        "type",
        "primary_exchange",
        "is_common_or_adr",
        "tradable_core",
    ]
    df = pd.read_parquet(path, columns=columns)
    df["trade_date"] = df["trade_date"].astype(str)
    latest = df[df["trade_date"] == as_of].copy()
    if latest.empty:
        raise ValueError(f"No universe rows for {as_of}")
    return latest


def load_daily(data_root: Path, as_of: str) -> pd.DataFrame:
    year = int(as_of[:4])
    root = data_root / "processed" / "polygon" / "stocks_split_adjusted" / "1d"
    paths = [root / f"daily_split_adjusted_{year - 1}.parquet", root / f"daily_split_adjusted_{year}.parquet"]
    existing = [path for path in paths if path.exists()]
    if not existing:
        raise FileNotFoundError(f"No adjusted daily parquet files found in {root}")
    columns = ["symbol", "trade_date", "adj_close", "adj_volume"]
    daily = pd.concat((pd.read_parquet(path, columns=columns) for path in existing), ignore_index=True)
    daily["trade_date"] = daily["trade_date"].astype(str)
    daily = daily[daily["trade_date"] <= as_of].dropna(subset=["symbol", "trade_date", "adj_close"])
    return daily.sort_values(["symbol", "trade_date"]).reset_index(drop=True)


def infer_sector(name: str, ticker_type: str) -> str:
    text = f"{name} {ticker_type}".lower()
    if ticker_type == "ETF":
        return "ETF"
    if any(token in text for token in ["biotech", "therapeutics", "pharma", "medicine", "health", "bio", "bioscience", "medical", "surgical", "novo", "sanofi", "astrazeneca", "novartis", "gsk", "gh research"]):
        return "生物医药"
    if any(token in text for token in ["semiconductor", "chip", "micro", "technology", "software", "data", "ai", "cyber", "security", "cloud", "quantum", "digital", "systems", "electronics", "computer", "cerebras", "asml", "kla", "globalfoundries", "circuit", "optical", "photonics", "mobile", "socket", "arm holdings", "himax", "nebius", "poet", "nova ltd", "ituran", "silicom"]):
        return "科技"
    if any(token in text for token in ["telecom", "telekom", "communications", "telefonica", "telus", "vodafone", "nokia", "ericsson", "telesat", "millicom", "cellular"]):
        return "通信"
    if any(token in text for token in ["energy", "oil", "gas", "uranium", "solar", "lpg", "sasol", "enerflex", "petrobras", "ecopetrol", "equinor", "geopark", "ypf", "vivopower", "toyo"]):
        return "能源"
    if any(token in text for token in ["bank", "financial", "capital", "insurance", "credit", "lending", "santander", "bradesco", "itau", "ubs", "hsbc", "barclays", "broker", "fintech"]):
        return "金融"
    if any(token in text for token in ["retail", "consumer", "restaurant", "food", "beverage", "apparel", "brands", "home", "travel", "hotel", "auto", "motor", "vehicle", "tesla", "toyota", "honda", "nio", "xpeng", "li auto"]):
        return "消费"
    if any(token in text for token in ["industrial", "manufacturing", "construction", "machinery", "aerospace", "aviation", "transport", "logistics", "rail", "truck", "space", "rocket", "shipping", "tanker", "switchgear", "switchboard", "office machines", "navigation", "guidance", "frontline", "cmb.tech", "vestis"]):
        return "工业"
    if any(token in text for token in ["gold", "silver", "copper", "mining", "materials", "steel", "aluminum", "lithium", "tenaris", "alcoa", "almonty", "corning", "glass"]):
        return "材料"
    return "未分类"


def infer_sector_from_sic(text: str) -> str | None:
    lower = str(text or "").lower()
    if not lower or lower == "nan":
        return None
    if any(token in lower for token in ["semiconductor", "computer", "software", "technology", "data", "electronic", "communications", "printed circuit", "optical instruments", "measuring & controlling", "office machines"]):
        return "科技"
    if any(token in lower for token in ["medical", "health", "hospital", "pharma", "biotech", "therapeutic", "surgical", "laboratory", "biological", "diagnostic", "dental", "ophthalmic", "x-ray"]):
        return "医疗"
    if any(token in lower for token in ["real estate", "reit"]):
        return "地产"
    if any(token in lower for token in ["bank", "financial", "insurance", "credit", "investment", "asset management", "brokers", "dealers"]):
        return "金融"
    if any(token in lower for token in ["retail", "consumer", "restaurant", "food", "beverage", "hotel", "apparel", "services", "garments", "footwear", "furniture", "appliances", "sporting", "soft drinks", "cosmetics", "cigarettes", "confectionery", "publishing"]):
        return "消费"
    if any(token in lower for token in ["oil", "gas", "energy", "mining", "coal", "solar", "petroleum"]):
        return "能源"
    if any(token in lower for token in ["utility", "electric", "water supply"]):
        return "公用事业"
    if any(token in lower for token in ["chemical", "metal", "paper", "material", "aluminum", "steel", "gold", "silver", "ores", "cement", "lumber", "wood", "glass", "rubber", "plastics"]):
        return "材料"
    if any(token in lower for token in ["transport", "machinery", "manufacturing", "construction", "aerospace", "industrial", "motor vehicle", "aircraft", "missiles", "space vehicles", "truck", "trucking", "railroad", "ship", "boat", "builders", "contractors", "homes", "pumps", "engines", "turbines", "bearings", "meters", "hardware", "equipment", "generators", "ordnance", "air-cond", "heatg", "refrig", "switchgear", "switchboard", "navigation", "guidance"]):
        return "工业"
    if any(token in lower for token in ["broadcasting", "television", "radio", "media", "telephone", "telegraph", "telecom"]):
        return "通信"
    return None


def load_sector_map(data_root: Path) -> dict[str, str]:
    from sector_overrides import load_sector_overrides

    overrides = load_sector_overrides()
    path = data_root / "raw" / "polygon_rest" / "corporate_actions_full" / "ticker_details_full.parquet"
    if not path.exists():
        return overrides
    columns = ["ticker", "name", "sic_description", "type"]
    details = pd.read_parquet(path, columns=columns)
    out: dict[str, str] = {}
    for row in details.itertuples(index=False):
        symbol = str(row.ticker).upper()
        sector = infer_sector_from_sic(row.sic_description) or infer_sector(str(row.name or ""), str(row.type or ""))
        if sector and sector != "未分类":
            out[symbol] = sector
    out.update(overrides)
    return out


def risk_for(row: pd.Series, change: float) -> str:
    price = float(row.get("price") or 0)
    adv = float(row.get("median_dollar_volume_20d") or 0)
    name = str(row.get("company") or "")
    if price < 1:
        return "低价股"
    if abs(change) >= 100 or adv < 5_000_000:
        return "小盘高波动"
    if any(token in name.lower() for token in ["biotech", "therapeutics", "pharma"]):
        return "临床事件驱动"
    if abs(change) >= 30:
        return "趋势剧震"
    return "趋势观察"


def action_for(risk: str, change: float) -> str:
    if "低价" in risk:
        return "低价股先看是否一日游，连续缩量反弹要谨慎。"
    if "临床" in risk:
        return "医药异动先核对临床或监管消息，落地后容易剧震。"
    if abs(change) >= 100:
        return "涨跌幅极端，先看是否有并股、融资、财报或公告催化。"
    if change < -20:
        return "大幅回撤先看是否破趋势线，不要只因跌多就提高优先级。"
    if change > 20:
        return "强势股先看成交额能否延续，回踩不破更有复盘价值。"
    return "先观察成交额和价格是否能延续，再决定是否加入重点复盘。"


def load_market_caps(data_root: Path, prices: pd.Series) -> dict[str, float]:
    path = data_root / "raw" / "polygon_rest" / "corporate_actions_full" / "ticker_details_full.parquet"
    if not path.exists():
        return {}
    columns = ["ticker", "market_cap", "weighted_shares_outstanding", "share_class_shares_outstanding"]
    details = pd.read_parquet(path, columns=columns)
    details["ticker"] = details["ticker"].astype(str).str.upper()
    caps: dict[str, float] = {}
    for row in details.itertuples(index=False):
        symbol = str(row.ticker).upper()
        cap = clean_number(row.market_cap, 0)
        if cap is None:
            shares = clean_number(row.weighted_shares_outstanding, 0) or clean_number(row.share_class_shares_outstanding, 0)
            price = clean_number(prices.get(symbol), 4)
            if shares and price:
                cap = shares * price
        if cap and cap > 0:
            caps[symbol] = float(cap)
    return caps


def build_rows(
    frame: pd.DataFrame,
    change_col: str,
    old_map: dict[str, dict[str, Any]],
    market_caps: dict[str, float],
    sector_map: dict[str, str],
    limit: int,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for rank, row in enumerate(frame.head(limit).itertuples(index=False), start=1):
        item = pd.Series(row._asdict())
        symbol = str(item["symbol"])
        previous = old_map.get(symbol, {})
        company = str(item.get("company") or previous.get("company") or symbol)
        change = float(item[change_col])
        previous_sector = previous.get("sector")
        sector = sector_map.get(symbol) or (previous_sector if previous_sector and previous_sector != "未分类" else "") or infer_sector(company, str(item.get("type") or ""))
        risk = previous.get("risk") or risk_for(item, change)
        out.append(
            {
                "rank": rank,
                "symbol": symbol,
                "company": company,
                "chineseName": previous.get("chineseName") or symbol,
                "sector": sector,
                "risk": risk,
                "actionNote": previous.get("actionNote") or action_for(risk, change),
                "change": clean_number(change, 2),
                "price": clean_number(item.get("price"), 3),
                "volume": compact_number(item.get("volume")),
                "dollarVolume": clean_number(item.get("dollarVolume"), 0),
                "volumeRatio": f"{clean_number(item.get('volumeRatio'), 2)}x" if clean_number(item.get("volumeRatio"), 2) is not None else previous.get("volumeRatio") or "--",
                "marketCap": compact_money(market_caps.get(symbol)) if market_caps.get(symbol) else previous.get("marketCap") or "--",
            }
        )
    return out


def build_payloads(data_root: Path, as_of: str, limit: int, max_ytd_return: float, min_dollar_volume: float) -> tuple[dict[str, Any], dict[str, Any]]:
    ytd_output = DEFAULT_YTD_OUTPUT
    movers_output = DEFAULT_MOVERS_OUTPUT
    old_map = existing_name_map(ytd_output, movers_output)

    universe = load_universe(data_root, as_of)
    daily = load_daily(data_root, as_of)
    symbols = set(
        universe[
            universe["tradable_core"].fillna(False)
            & universe["is_common_or_adr"].fillna(False)
            & (universe["close"].fillna(0) >= 1)
        ]["symbol"]
    )
    daily = daily[daily["symbol"].isin(symbols)]

    close = daily.pivot(index="trade_date", columns="symbol", values="adj_close").ffill()
    volume = daily.pivot(index="trade_date", columns="symbol", values="adj_volume").fillna(0)
    current = close.iloc[-1]
    latest_volume = volume.iloc[-1]
    year_panel = close.loc[[idx for idx in close.index if str(idx).startswith(as_of[:4])]]

    work = pd.DataFrame({"symbol": current.index, "price": current, "volume": latest_volume})
    work["return1d"] = (current / close.shift(1).iloc[-1] - 1) * 100
    work["return5d"] = (current / close.shift(5).iloc[-1] - 1) * 100
    work["return21d"] = (current / close.shift(21).iloc[-1] - 1) * 100
    first_year_price = year_panel.apply(lambda col: col.dropna().iloc[0] if col.dropna().size else None)
    work["firstYearPrice"] = work["symbol"].map(first_year_price)
    work["returnYtd"] = (year_panel.iloc[-1] / first_year_price - 1) * 100
    meta = universe.set_index("symbol")
    work["company"] = work["symbol"].map(meta["name"]).fillna(work["symbol"])
    work["type"] = work["symbol"].map(meta["type"]).fillna("")
    work["median_dollar_volume_20d"] = work["symbol"].map(meta["median_dollar_volume_20d"]).fillna(0)
    work["dollarVolume"] = work["symbol"].map(meta["dollar_volume"]).fillna(work["price"] * work["volume"])
    work["volumeRatio"] = work["dollarVolume"] / work["median_dollar_volume_20d"].replace(0, pd.NA)
    work = work.dropna(subset=["price", "return1d", "return5d", "returnYtd"])
    work = work[work["median_dollar_volume_20d"].fillna(0) >= min_dollar_volume]
    universe_count = int(work["symbol"].nunique())
    market_caps = load_market_caps(data_root, work.set_index("symbol")["price"])
    sector_map = load_sector_map(data_root)

    ytd_work = work[
        (work["firstYearPrice"].fillna(0) >= 1)
        & (work["returnYtd"].abs() <= max_ytd_return)
        & (work["median_dollar_volume_20d"].fillna(0) >= 1_000_000)
    ].copy()
    ytd_rows = build_rows(
        ytd_work.sort_values("returnYtd", ascending=False).rename(columns={"returnYtd": "changeYtd"}),
        "changeYtd",
        old_map,
        market_caps,
        sector_map,
        limit,
    )
    for row in ytd_rows:
        row["changeYtd"] = row.pop("change")

    day_rows = build_rows(
        work.assign(abs_return=work["return1d"].abs()).sort_values("abs_return", ascending=False),
        "return1d",
        old_map,
        market_caps,
        sector_map,
        limit,
    )
    week_rows = build_rows(
        work.assign(abs_return=work["return5d"].abs()).sort_values("abs_return", ascending=False),
        "return5d",
        old_map,
        market_caps,
        sector_map,
        limit,
    )
    month_rows = build_rows(
        work.dropna(subset=["return21d"]).assign(abs_return=work["return21d"].abs()).sort_values("abs_return", ascending=False),
        "return21d",
        old_map,
        market_caps,
        sector_map,
        limit,
    )
    volume_rows = build_rows(
        work.dropna(subset=["volumeRatio"]).sort_values(["volumeRatio", "dollarVolume"], ascending=False),
        "return1d",
        old_map,
        market_caps,
        sector_map,
        limit,
    )

    ytd = {
        "updatedAt": as_of,
        "generatedAt": now_iso(),
        "source": "Polygon split-adjusted daily bars + latest tradable universe",
        "universeCount": universe_count,
        "rows": ytd_rows,
    }
    movers = {
        "updatedAt": as_of,
        "generatedAt": now_iso(),
        "source": "Polygon split-adjusted daily bars + latest tradable universe",
        "universeCount": universe_count,
        "boards": {
            "day": {
                "title": "24h 涨跌幅榜",
                "periodLabel": "24h",
                "referenceLabel": "前收估算价",
                "rows": day_rows,
            },
            "week": {
                "title": "近一周涨跌幅榜",
                "periodLabel": "1周",
                "referenceLabel": "周初估算价",
                "rows": week_rows,
            },
            "month": {
                "title": "近一月涨跌幅榜",
                "periodLabel": "近一月",
                "referenceLabel": "月初估算价",
                "rows": month_rows,
            },
            "volume": {
                "title": "成交额异动榜",
                "periodLabel": "24h",
                "referenceLabel": "成交额",
                "volumeLabel": "成交额倍数",
                "multipleLabel": "成交额倍数",
                "referenceMode": "volume",
                "multipleMode": "volumeRatio",
                "rows": volume_rows,
            },
        },
    }
    return ytd, movers


def main() -> None:
    parser = argparse.ArgumentParser(description="Build visible market board JSON from local adjusted daily bars.")
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--asof", default="")
    parser.add_argument("--limit", type=int, default=5000)
    parser.add_argument("--min-dollar-volume", type=float, default=5_000_000)
    parser.add_argument("--max-ytd-return", type=float, default=3000.0)
    parser.add_argument("--ytd-output", type=Path, default=DEFAULT_YTD_OUTPUT)
    parser.add_argument("--movers-output", type=Path, default=DEFAULT_MOVERS_OUTPUT)
    args = parser.parse_args()

    as_of = args.asof or latest_trade_date(args.data_root)
    ytd, movers = build_payloads(args.data_root, as_of, args.limit, args.max_ytd_return, args.min_dollar_volume)
    write_json(args.ytd_output, ytd)
    write_json(args.movers_output, movers)
    print(json.dumps({
        "asOf": as_of,
        "universeCount": ytd.get("universeCount"),
        "ytdRows": len(ytd["rows"]),
        "dayRows": len(movers["boards"]["day"]["rows"]),
        "weekRows": len(movers["boards"]["week"]["rows"]),
        "monthRows": len(movers["boards"]["month"]["rows"]),
        "volumeRows": len(movers["boards"]["volume"]["rows"]),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()

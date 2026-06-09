#!/usr/bin/env python3
"""Build sector-level fund-flow proxy data for the product front end."""

from __future__ import annotations

import argparse
import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = Path("/Volumes/Extreme SSD/market-data-lab/data")
DEFAULT_INPUT = ROOT / "data" / "strength-scanner.json"
DEFAULT_OUTPUT = ROOT / "data" / "sector-flow.json"


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def clean_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def parse_pct(value: Any) -> float:
    number = clean_number(str(value or "").replace("%", "").replace("+", "").replace(",", ""))
    return number if number is not None else 0.0


def parse_money(value: Any) -> float:
    text = str(value or "").strip().replace("$", "").replace(",", "")
    if not text or text == "--":
        return 0.0
    multiplier = 1.0
    suffix = text[-1:].upper()
    if suffix == "B":
        multiplier = 1_000_000_000
        text = text[:-1]
    elif suffix == "M":
        multiplier = 1_000_000
        text = text[:-1]
    elif suffix == "K":
        multiplier = 1_000
        text = text[:-1]
    number = clean_number(text)
    return float(number or 0) * multiplier


def money_label(value: float, with_sign: bool = False) -> str:
    sign = ""
    number = float(value or 0)
    if with_sign and number > 0:
        sign = "+"
    abs_value = abs(number)
    if abs_value >= 1_000_000_000:
        return f"{sign}${number / 1_000_000_000:.2f}B"
    if abs_value >= 1_000_000:
        return f"{sign}${number / 1_000_000:.1f}M"
    if abs_value >= 1_000:
        return f"{sign}${number / 1_000:.1f}K"
    return f"{sign}${number:.0f}"


def infer_sector_from_text(text: str) -> str | None:
    lower = text.lower()
    if any(token in lower for token in ["semiconductor", "computer", "software", "technology", "data", "electronic"]):
        return "科技"
    if any(token in lower for token in ["medical", "health", "hospital", "pharma", "biotech", "therapeutic", "surgical"]):
        return "医疗"
    if any(token in lower for token in ["real estate", "reit"]):
        return "地产"
    if any(token in lower for token in ["bank", "financial", "insurance", "credit", "investment", "asset management"]):
        return "金融"
    if any(token in lower for token in ["retail", "consumer", "restaurant", "food", "beverage", "hotel", "apparel"]):
        return "消费"
    if any(token in lower for token in ["oil", "gas", "energy", "mining", "coal", "solar"]):
        return "能源"
    if any(token in lower for token in ["utility", "electric", "water supply"]):
        return "公用事业"
    if any(token in lower for token in ["chemical", "metal", "paper", "material"]):
        return "材料"
    if any(token in lower for token in ["transport", "machinery", "manufacturing", "construction", "aerospace", "industrial"]):
        return "工业"
    return None


def load_sector_map(data_root: Path) -> dict[str, str]:
    path = data_root / "raw" / "polygon_rest" / "corporate_actions_full" / "ticker_details_full.parquet"
    if not path.exists():
        return {}
    import pandas as pd

    frame = pd.read_parquet(path, columns=["ticker", "name", "sic_description"])
    out: dict[str, str] = {}
    for row in frame.itertuples(index=False):
        sector = infer_sector_from_text(f"{row.name or ''} {row.sic_description or ''}")
        if sector:
            out[str(row.ticker).upper()] = sector
    return out


def sector_name(row: dict[str, Any], sector_map: dict[str, str]) -> str:
    symbol = str(row.get("symbol") or "").upper()
    if sector_map.get(symbol):
        return sector_map[symbol]
    raw = str(row.get("sectorProxy") or row.get("sector") or "未分类").strip()
    parts = raw.split(maxsplit=1)
    if parts and parts[0].startswith("XL"):
        return parts[1] if len(parts) > 1 else raw
    return raw


def load_rows(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def build_sector_flow(input_path: Path, output_path: Path, data_root: Path, limit: int) -> dict[str, Any]:
    payload = load_rows(input_path)
    rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
    groups: dict[str, dict[str, Any]] = {}
    seen_symbols: set[str] = set()
    sector_map = load_sector_map(data_root)
    for row in rows:
        symbol = str(row.get("symbol") or "").upper()
        if not symbol or symbol in seen_symbols:
            continue
        seen_symbols.add(symbol)
        sector = sector_name(row, sector_map)
        change = parse_pct((row.get("periods") or {}).get("1d"))
        liquidity = parse_money(row.get("liquidity"))
        signed_flow = liquidity * (1 if change > 0 else -1 if change < 0 else 0)
        current = groups.setdefault(
            sector,
            {
                "sector": sector,
                "count": 0,
                "upCount": 0,
                "downCount": 0,
                "totalChange": 0.0,
                "activeValue": 0.0,
                "inflowProxy": 0.0,
                "outflowProxy": 0.0,
                "netFlowProxy": 0.0,
                "leaders": [],
            },
        )
        current["count"] += 1
        current["upCount"] += 1 if change > 0 else 0
        current["downCount"] += 1 if change < 0 else 0
        current["totalChange"] += change
        current["activeValue"] += liquidity
        current["inflowProxy"] += max(0.0, signed_flow)
        current["outflowProxy"] += abs(min(0.0, signed_flow))
        current["netFlowProxy"] += signed_flow
        current["leaders"].append(
            {
                "symbol": symbol,
                "name": row.get("name") or symbol,
                "change": round(change, 2),
                "liquidity": money_label(liquidity),
                "marketCap": row.get("marketCap") or "--",
                "score": row.get("score"),
            }
        )

    sector_rows = []
    for item in groups.values():
        count = max(1, int(item["count"]))
        breadth = item["upCount"] / count * 100
        net = float(item["netFlowProxy"])
        if net > 0 and breadth >= 55:
            status = "流入领先"
        elif net < 0 and breadth <= 45:
            status = "流出压力"
        else:
            status = "活跃分歧"
        leaders = sorted(item["leaders"], key=lambda row: parse_money(row["liquidity"]), reverse=True)[:5]
        sector_rows.append(
            {
                "sector": item["sector"],
                "status": status,
                "count": int(item["count"]),
                "upCount": int(item["upCount"]),
                "downCount": int(item["downCount"]),
                "breadthPct": round(breadth, 1),
                "avgChange": round(item["totalChange"] / count, 2),
                "activeValue": round(float(item["activeValue"]), 2),
                "activeValueLabel": money_label(float(item["activeValue"])),
                "inflowProxy": round(float(item["inflowProxy"]), 2),
                "inflowProxyLabel": money_label(float(item["inflowProxy"])),
                "outflowProxy": round(float(item["outflowProxy"]), 2),
                "outflowProxyLabel": money_label(float(item["outflowProxy"])),
                "netFlowProxy": round(net, 2),
                "netFlowLabel": money_label(net, with_sign=True),
                "leaders": leaders,
            }
        )
    sector_rows.sort(key=lambda item: (item["netFlowProxy"], item["activeValue"]), reverse=True)
    sector_rows = sector_rows[:limit]
    for rank, item in enumerate(sector_rows, start=1):
        item["rank"] = rank

    positive = [item for item in sector_rows if item["netFlowProxy"] > 0]
    negative = [item for item in sector_rows if item["netFlowProxy"] < 0]
    top = sector_rows[0] if sector_rows else None
    result = {
        "asOf": payload.get("asOf") or "",
        "generatedAt": now_iso(),
        "source": "strength-scanner liquidity + one-day price direction",
        "method": "按板块聚合成交额/流动性与涨跌方向，生成资金流向代理；不等同于逐笔主买主卖或真实资金净流入。",
        "summary": {
            "leaderSector": top["sector"] if top else "--",
            "leaderNetFlow": top["netFlowLabel"] if top else "--",
            "positiveSectors": len(positive),
            "negativeSectors": len(negative),
            "activeSector": max(sector_rows, key=lambda item: item["activeValue"])["sector"] if sector_rows else "--",
            "avgBreadthPct": round(sum(item["breadthPct"] for item in sector_rows) / max(1, len(sector_rows)), 1),
        },
        "rows": sector_rows,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Build sector fund-flow proxy JSON.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--limit", type=int, default=24)
    args = parser.parse_args()
    payload = build_sector_flow(args.input, args.output, args.data_root, args.limit)
    print(json.dumps({"asOf": payload["asOf"], "rows": len(payload["rows"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()

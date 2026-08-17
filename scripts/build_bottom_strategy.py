#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "server" / "bottom_strategy.json"
HORIZONS = (10, 30, 60, 180)


def number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def enabled(value: Any) -> bool:
    parsed = number(value)
    return bool(parsed and parsed != 0)


def trading_date(value: Any) -> str:
    timestamp = number(value)
    if timestamp is None:
        return ""
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).date().isoformat()


def rounded(value: float | None) -> float | None:
    return round(value, 2) if value is not None and math.isfinite(value) else None


def load_rows(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    for row in rows:
        row["date"] = trading_date(row.get("time"))
    return [row for row in rows if row["date"]]


def signal_indices(rows: list[dict[str, Any]]) -> list[int]:
    signals: list[int] = []
    for index, row in enumerate(rows):
        if not (enabled(row.get("核心预警")) or enabled(row.get("极端恶化"))):
            continue
        if signals and index - signals[-1] <= 3:
            continue
        signals.append(index)
    return signals


def signal_record(rows: list[dict[str, Any]], signal_index: int) -> dict[str, Any] | None:
    entry_index = signal_index + 1
    if entry_index >= len(rows):
        return None
    entry = number(rows[entry_index].get("open"))
    if entry is None or entry <= 0:
        return None

    performance: dict[str, dict[str, float | None]] = {}
    for horizon in HORIZONS:
        final_index = min(entry_index + horizon, len(rows) - 1)
        highs = [number(row.get("high")) for row in rows[entry_index : final_index + 1]]
        valid_highs = [value for value in highs if value is not None]
        final_close = number(rows[final_index].get("close"))
        complete = entry_index + horizon < len(rows)
        performance[str(horizon)] = {
            "maxPct": rounded((max(valid_highs) / entry - 1) * 100) if valid_highs else None,
            "endPct": rounded((final_close / entry - 1) * 100) if complete and final_close is not None else None,
        }

    return {
        "signalDate": rows[signal_index]["date"],
        "entryDate": rows[entry_index]["date"],
        "entryPrice": rounded(entry),
        "status": "complete" if performance["180"]["endPct"] is not None else "observing",
        "performance": performance,
    }


def current_status(rows: list[dict[str, Any]], symbol: str) -> dict[str, Any]:
    latest = rows[-1]
    breadth = number(latest.get("市场宽度"))
    rsi6 = number(latest.get("RSI(6)"))
    action = enabled(latest.get("核心预警")) or enabled(latest.get("极端恶化"))
    observation_limit = 32 if symbol == "QQQ" else 30
    near = breadth is not None and rsi6 is not None and breadth <= observation_limit and rsi6 <= 25

    if action:
        key, title, message, position = "action", "抄底信号已出现", "进入底部区域，可以开始分批", 2
    elif near:
        key, title, message, position = "near", "市场正在接近低位", "先观察，等待信号确认", 1
    else:
        key, title, message, position = "normal", "当前尚未出现抄底信号", "等信号出现，再开始分批", 0
    return {
        "key": key,
        "title": title,
        "message": message,
        "position": position,
        "breadth": rounded(breadth),
        "rsi6": rounded(rsi6),
    }


def sampled_prices(rows: list[dict[str, Any]], signal_dates: set[str]) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        if index % 5 and row["date"] not in signal_dates and index != len(rows) - 1:
            continue
        close = number(row.get("close"))
        if close is not None:
            points.append({"date": row["date"], "value": rounded(close)})
    return points


def build_market(path: Path, symbol: str, name: str) -> dict[str, Any]:
    rows = load_rows(path)
    if not rows:
        raise ValueError(f"{symbol} CSV 没有可用数据")
    records = [signal_record(rows, index) for index in signal_indices(rows)]
    records = [record for record in records if record is not None]
    completed = [record for record in records if record["status"] == "complete"]
    recent = completed[-5:]
    if not recent:
        raise ValueError(f"{symbol} 没有完整的 180 日信号")

    stage_medians = {
        str(horizon): rounded(median(record["performance"][str(horizon)]["maxPct"] for record in recent))
        for horizon in HORIZONS
    }
    end_results = [record["performance"]["180"]["endPct"] for record in recent]
    return {
        "symbol": symbol,
        "name": name,
        "asOf": rows[-1]["date"],
        "status": current_status(rows, symbol),
        "summary": {
            "recentCount": len(recent),
            "recentPositiveCount": sum(1 for value in end_results if value is not None and value > 0),
            "end180MedianPct": rounded(median(end_results)),
            "bestEnd180Pct": rounded(max(end_results)),
            "stageMaxMedianPct": stage_medians,
            "totalSignals": len(records),
            "completedSignals": len(completed),
        },
        "recentRecords": list(reversed(recent)),
        "records": list(reversed(records)),
        "priceSeries": sampled_prices(rows, {record["signalDate"] for record in records}),
    }


def build_payload(qqq: Path, spy: Path) -> dict[str, Any]:
    markets = {
        "QQQ": build_market(qqq, "QQQ", "纳指 100"),
        "SPY": build_market(spy, "SPY", "标普 500"),
    }
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "method": {
            "signal": "日线收盘确认",
            "entry": "信号次日开盘",
            "horizons": list(HORIZONS),
            "costsIncluded": False,
        },
        "markets": markets,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="生成抄底策略前台只读数据")
    parser.add_argument("--qqq", type=Path, required=True, help="QQQ TradingView 日线 CSV")
    parser.add_argument("--spy", type=Path, required=True, help="SPY TradingView 日线 CSV")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    payload = build_payload(args.qqq, args.spy)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Bottom strategy data written: {args.output}")


if __name__ == "__main__":
    main()

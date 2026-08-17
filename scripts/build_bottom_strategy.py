#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import csv
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "server" / "bottom_strategy.json"
DEFAULT_DATA_ROOT = Path(os.environ.get("MARKET_DATA_ROOT", "/Volumes/Extreme SSD/market-data-lab/data"))
HORIZONS = (10, 30, 60, 180)
PATH_DAYS = (0, 10, 20, 30, 45, 60, 90, 120, 150, 180)


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


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def rsi(values: list[float], period: int = 6) -> list[float | None]:
    result: list[float | None] = [None] * len(values)
    if len(values) <= period:
        return result
    changes = [values[index] - values[index - 1] for index in range(1, len(values))]
    gains = [max(change, 0.0) for change in changes]
    losses = [max(-change, 0.0) for change in changes]
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    result[period] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
    for index in range(period + 1, len(values)):
        avg_gain = (avg_gain * (period - 1) + gains[index - 1]) / period
        avg_loss = (avg_loss * (period - 1) + losses[index - 1]) / period
        result[index] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
    return result


def adjusted_history(data_root: Path, symbols: set[str], start_year: int) -> Any:
    try:
        import pandas as pd
        import pyarrow.parquet as parquet
    except ImportError as exc:  # pragma: no cover - automation uses the quant environment
        raise RuntimeError("自动策略构建需要 pandas 和 pyarrow") from exc

    daily_root = data_root / "processed" / "polygon" / "stocks_split_adjusted" / "1d"
    frames = []
    current_year = datetime.now(timezone.utc).year
    for year in range(start_year, current_year + 1):
        path = daily_root / f"daily_split_adjusted_{year}.parquet"
        if not path.exists():
            continue
        frame = parquet.read_table(
            path,
            columns=["symbol", "trade_date", "adj_open", "adj_high", "adj_low", "adj_close"],
        ).to_pandas()
        frames.append(frame[frame["symbol"].isin(symbols)])
    if not frames:
        raise FileNotFoundError(f"没有可用的 Polygon 调整后日线：{daily_root}")
    result = pd.concat(frames, ignore_index=True)
    result["trade_date"] = pd.to_datetime(result["trade_date"]).dt.date
    return result.sort_values(["symbol", "trade_date"]).reset_index(drop=True)


def official_holdings() -> dict[str, set[str]]:
    try:
        from scripts.build_index_valuation import (
            DEFAULT_QQQ_HOLDINGS_URL,
            DEFAULT_SPY_HOLDINGS_URL,
            fetch_qqq_holdings,
            fetch_spy_holdings,
        )
    except ModuleNotFoundError:
        from build_index_valuation import (
            DEFAULT_QQQ_HOLDINGS_URL,
            DEFAULT_SPY_HOLDINGS_URL,
            fetch_qqq_holdings,
            fetch_spy_holdings,
        )

    payloads = {
        "QQQ": fetch_qqq_holdings(DEFAULT_QQQ_HOLDINGS_URL),
        "SPY": fetch_spy_holdings(DEFAULT_SPY_HOLDINGS_URL),
    }
    holdings: dict[str, set[str]] = {}
    for symbol, payload in payloads.items():
        holdings[symbol] = {
            str(item.get("ticker") or "").strip().upper()
            for item in payload.get("commonHoldings") or []
            if str(item.get("ticker") or "").strip()
        }
        minimum = 90 if symbol == "QQQ" else 450
        if len(holdings[symbol]) < minimum:
            raise ValueError(f"{symbol} 官方持仓数量异常：{len(holdings[symbol])}")
    return holdings


def breadth_by_date(history: Any, symbols: set[str]) -> dict[str, tuple[float, int]]:
    frame = history[history["symbol"].isin(symbols)].copy()
    frame["sma50"] = frame.groupby("symbol")["adj_close"].transform(
        lambda values: values.rolling(50, min_periods=50).mean()
    )
    frame = frame.dropna(subset=["sma50"])
    frame["above"] = frame["adj_close"] > frame["sma50"]
    grouped = frame.groupby("trade_date").agg(count=("symbol", "size"), above=("above", "sum"))
    minimum = max(1, math.floor(len(symbols) * 0.9))
    return {
        str(trade_date): (float(row["above"]) / float(row["count"]) * 100.0, int(row["count"]))
        for trade_date, row in grouped.iterrows()
        if int(row["count"]) >= minimum
    }


def market_price_rows(history: Any, symbol: str) -> list[dict[str, Any]]:
    frame = history[history["symbol"] == symbol]
    return [
        {
            "date": str(row.trade_date),
            "open": float(row.adj_open),
            "high": float(row.adj_high),
            "low": float(row.adj_low),
            "close": float(row.adj_close),
        }
        for row in frame.itertuples(index=False)
    ]


def fresh_record(rows: list[dict[str, Any]], signal_date: str) -> dict[str, Any] | None:
    signal_index = next((index for index, row in enumerate(rows) if row["date"] == signal_date), None)
    if signal_index is None or signal_index + 1 >= len(rows):
        return None
    entry_index = signal_index + 1
    entry = rows[entry_index]["open"]
    performance: dict[str, dict[str, float | None]] = {}
    for horizon in HORIZONS:
        final_index = min(entry_index + horizon, len(rows) - 1)
        performance[str(horizon)] = {
            "maxPct": rounded((max(row["high"] for row in rows[entry_index : final_index + 1]) / entry - 1) * 100),
            "endPct": rounded((rows[final_index]["close"] / entry - 1) * 100)
            if entry_index + horizon < len(rows)
            else None,
        }
    return {
        "signalDate": signal_date,
        "entryDate": rows[entry_index]["date"],
        "entryPrice": rounded(entry),
        "status": "complete" if performance["180"]["endPct"] is not None else "observing",
        "performance": performance,
    }


def refresh_record(rows: list[dict[str, Any]], record: dict[str, Any]) -> dict[str, Any]:
    if record.get("status") == "complete":
        return copy.deepcopy(record)
    entry_index = next((index for index, row in enumerate(rows) if row["date"] == record.get("entryDate")), None)
    entry = number(record.get("entryPrice"))
    if entry_index is None or entry is None or entry <= 0:
        return copy.deepcopy(record)
    updated = copy.deepcopy(record)
    for horizon in HORIZONS:
        final_index = min(entry_index + horizon, len(rows) - 1)
        values = rows[entry_index : final_index + 1]
        current = updated["performance"].setdefault(str(horizon), {})
        calculated_max = rounded((max(row["high"] for row in values) / entry - 1) * 100)
        current["maxPct"] = rounded(max(number(current.get("maxPct")) or -math.inf, calculated_max or -math.inf))
        if current.get("endPct") is None and entry_index + horizon < len(rows):
            current["endPct"] = rounded((rows[entry_index + horizon]["close"] / entry - 1) * 100)
    updated["status"] = "complete" if updated["performance"]["180"].get("endPct") is not None else "observing"
    return updated


def median_path(rows: list[dict[str, Any]], records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    indexes = {row["date"]: index for index, row in enumerate(rows)}
    points: list[dict[str, Any]] = []
    for day in PATH_DAYS:
        if day == 0:
            points.append({"day": 0, "pct": 0.0})
            continue
        values: list[float] = []
        for record in records:
            entry_index = indexes.get(str(record.get("entryDate") or ""))
            entry = number(record.get("entryPrice"))
            if entry_index is None or entry is None or entry <= 0 or entry_index + day >= len(rows):
                continue
            values.append((rows[entry_index + day]["close"] / entry - 1) * 100)
        if values:
            points.append({"day": day, "pct": rounded(median(values))})
    return points


def update_machine(
    dates: list[str],
    values: dict[str, tuple[float, float]],
    symbol: str,
    initial: dict[str, Any],
) -> tuple[dict[str, Any], list[str], dict[str, dict[str, Any]]]:
    state = {
        "armed": bool(initial.get("armed")),
        "armedElapsed": int(initial.get("armedElapsed") or 0),
        "recoveryCandidate": bool(initial.get("recoveryCandidate")),
        "extremeActive": bool(initial.get("extremeActive")),
        "extremeReleaseStreak": int(initial.get("extremeReleaseStreak") or 0),
        "cooldownElapsed": initial.get("cooldownElapsed"),
        "previousWarning": bool(initial.get("previousWarning")),
        "recentRsi": list(initial.get("recentRsi") or []),
    }
    signals: list[str] = []
    daily: dict[str, dict[str, Any]] = {}
    for trade_date in dates:
        breadth, rsi6 = values[trade_date]
        state["recentRsi"] = (state["recentRsi"] + [rsi6])[-10:]
        warning = breadth <= 20 and rsi6 <= 20
        warning_start = warning and not state["previousWarning"]
        extreme = symbol == "QQQ" and breadth <= 5 and min(state["recentRsi"]) <= 20
        cooldown_finished = state["cooldownElapsed"] is None or int(state["cooldownElapsed"]) > 20
        warning_event = warning_start and not state["armed"] and cooldown_finished
        if warning_event:
            state["armed"] = True
            state["armedElapsed"] = 0
            state["recoveryCandidate"] = False

        extreme_event = extreme and not state["extremeActive"]
        if extreme_event:
            state["extremeActive"] = True
            state["extremeReleaseStreak"] = 0
            state["armed"] = True
            state["armedElapsed"] = 0
            state["recoveryCandidate"] = False
            warning_event = False

        if state["extremeActive"]:
            state["extremeReleaseStreak"] = state["extremeReleaseStreak"] + 1 if breadth >= 20 else 0
            if state["extremeReleaseStreak"] >= 2:
                state["extremeActive"] = False
                state["extremeReleaseStreak"] = 0

        if state["armed"] and not (warning_event or extreme_event):
            state["armedElapsed"] += 1
            if state["armedElapsed"] > 30:
                state["armed"] = False
                state["recoveryCandidate"] = False
            elif state["recoveryCandidate"]:
                if breadth >= 30:
                    state["armed"] = False
                    state["recoveryCandidate"] = False
                    state["cooldownElapsed"] = 0
                else:
                    state["recoveryCandidate"] = False
            elif breadth >= 30:
                state["recoveryCandidate"] = True

        if state["cooldownElapsed"] is not None:
            state["cooldownElapsed"] = int(state["cooldownElapsed"]) + 1
        state["previousWarning"] = warning
        event = warning_event or extreme_event
        if event:
            signals.append(trade_date)
        daily[trade_date] = {
            "breadth": rounded(breadth),
            "rsi6": rounded(rsi6),
            "signal": event,
        }
    return state, signals, daily


def summarize_market(market: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    records = market.get("records") or []
    completed = [record for record in records if record.get("status") == "complete"]
    recent = completed[:5]
    end_results = [number(record["performance"]["180"].get("endPct")) for record in recent]
    end_results = [value for value in end_results if value is not None]
    stage_medians = {
        str(horizon): rounded(
            median(
                number(record["performance"][str(horizon)].get("maxPct"))
                for record in recent
                if number(record["performance"][str(horizon)].get("maxPct")) is not None
            )
        )
        for horizon in HORIZONS
    }
    market["recentRecords"] = recent
    market["summary"] = {
        "recentCount": len(recent),
        "recentPositiveCount": sum(1 for value in end_results if value > 0),
        "end180MedianPct": rounded(median(end_results)) if end_results else None,
        "bestEnd180Pct": rounded(max(end_results)) if end_results else None,
        "stageMaxMedianPct": stage_medians,
        "totalSignals": len(records),
        "completedSignals": len(completed),
        "completedPositiveCount": sum(
            1 for record in completed if number(record["performance"]["180"].get("endPct")) is not None and record["performance"]["180"]["endPct"] > 0
        ),
        "completedNegativeCount": sum(
            1 for record in completed if number(record["performance"]["180"].get("endPct")) is not None and record["performance"]["180"]["endPct"] < 0
        ),
    }
    market["medianPath"] = median_path(rows, recent)
    latest = records[0] if records else None
    if latest:
        entry_index = next((index for index, row in enumerate(rows) if row["date"] == latest.get("entryDate")), None)
        observed = len(rows) - entry_index if entry_index is not None else 0
        completed_horizon = max((h for h in HORIZONS if latest["performance"][str(h)].get("endPct") is not None), default=None)
        market["lastSignal"] = {
            "signalDate": latest.get("signalDate"),
            "tradingDaysObserved": observed,
            "completedHorizon": completed_horizon,
            "completedEndPct": latest["performance"][str(completed_horizon)].get("endPct") if completed_horizon else None,
        }
    return market


def build_market_data_payload(data_root: Path, baseline: dict[str, Any]) -> dict[str, Any]:
    if not baseline.get("markets"):
        raise ValueError("抄底策略基线数据缺失")
    payload = copy.deepcopy(baseline)
    baseline_year = min(int(item.get("asOf", "2026")[:4]) for item in payload["markets"].values())
    holdings = official_holdings()
    all_symbols = set().union(*holdings.values(), {"QQQ", "SPY"})
    history = adjusted_history(data_root, all_symbols, max(2020, baseline_year - 1))
    price_history = adjusted_history(data_root, {"QQQ", "SPY"}, 2021)

    expected_dates: list[str] = []
    for symbol, market in payload["markets"].items():
        rows = market_price_rows(price_history, symbol)
        if not rows:
            raise ValueError(f"{symbol} 行情缺失")
        expected_dates.append(rows[-1]["date"])
        baseline_as_of = str(market.get("asOf") or "")
        new_rows = [row for row in rows if row["date"] > baseline_as_of]
        closes = [row["close"] for row in rows]
        rsi_values = rsi(closes)
        rsi_by_date = {row["date"]: value for row, value in zip(rows, rsi_values) if value is not None}
        breadth = breadth_by_date(history, holdings[symbol])
        value_by_date = {
            row["date"]: (breadth[row["date"]][0], float(rsi_by_date[row["date"]]))
            for row in new_rows
            if row["date"] in breadth and row["date"] in rsi_by_date
        }
        if new_rows and len(value_by_date) != len(new_rows):
            missing = [row["date"] for row in new_rows if row["date"] not in value_by_date]
            raise ValueError(f"{symbol} 自动策略指标缺失：{','.join(missing[:3])}")

        initial = market.get("machineState") or {
            "previousWarning": bool(
                number(market.get("status", {}).get("breadth")) is not None
                and number(market.get("status", {}).get("rsi6")) is not None
                and market["status"]["breadth"] <= 20
                and market["status"]["rsi6"] <= 20
            ),
            "recentRsi": [number(market.get("status", {}).get("rsi6"))]
            if number(market.get("status", {}).get("rsi6")) is not None
            else [],
        }
        machine, signal_dates, daily = update_machine(sorted(value_by_date), value_by_date, symbol, initial)
        existing_dates = {str(record.get("signalDate")) for record in market.get("records") or []}
        for signal_date in signal_dates:
            if signal_date in existing_dates:
                continue
            record = fresh_record(rows, signal_date)
            if record:
                market.setdefault("records", []).insert(0, record)
                existing_dates.add(signal_date)

        market["records"] = [refresh_record(rows, record) for record in market.get("records") or []]
        market["asOf"] = rows[-1]["date"]
        latest_breadth = breadth[rows[-1]["date"]][0]
        latest_rsi = rsi_by_date[rows[-1]["date"]]
        latest_signal = bool(daily.get(rows[-1]["date"], {}).get("signal"))
        near_limit = 32 if symbol == "QQQ" else 30
        if latest_signal or machine.get("armed"):
            key, title, message, position = "action", "抄底信号已出现", "底部通常是一段区域，可以开始分批定投。", 2
        elif latest_breadth <= near_limit and latest_rsi <= 25:
            key, title, message, position = "near", "市场正在接近低位", "先观察，等待日线收盘确认。", 1
        else:
            key, title, message, position = "normal", "当前尚未出现抄底信号", "信号出现后，再开始分批定投。", 0
        market["status"] = {
            "key": key,
            "title": title,
            "message": message,
            "position": position,
            "breadth": rounded(latest_breadth),
            "rsi6": rounded(latest_rsi),
        }
        market["machineState"] = machine
        market["dailyStates"] = [
            *[item for item in market.get("dailyStates") or [] if str(item.get("date")) <= baseline_as_of],
            *[{"date": trade_date, **item} for trade_date, item in daily.items()],
        ][-260:]
        market["priceSeries"] = sampled_prices(
            [{"date": row["date"], "close": row["close"]} for row in rows],
            {record["signalDate"] for record in market.get("records") or []},
        )
        summarize_market(market, rows)

    expected = min(expected_dates)
    payload["generatedAt"] = now_iso()
    payload["asOf"] = expected
    payload["freshness"] = {"status": "current", "expectedAsOf": expected, "asOf": expected}
    payload["method"] = {
        **payload.get("method", {}),
        "signal": "日线收盘确认",
        "entry": "信号次日开盘",
        "breadth": "官方指数持仓中站上50日均线的股票比例",
    }
    return payload


def stale_payload(baseline: dict[str, Any], expected_as_of: str | None, reason: str) -> dict[str, Any]:
    payload = copy.deepcopy(baseline)
    current_as_of = min((str(item.get("asOf") or "") for item in payload.get("markets", {}).values()), default="")
    payload["generatedAt"] = now_iso()
    payload["asOf"] = current_as_of
    payload["freshness"] = {
        "status": "stale",
        "expectedAsOf": expected_as_of,
        "asOf": current_as_of,
        "reason": reason[:240],
    }
    return payload


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

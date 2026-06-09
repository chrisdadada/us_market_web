#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DEFAULT_ENV = ROOT / ".local" / "dingtalk_trade_brief.env"
PROFILE_PATH = ROOT / ".local" / "trading_profile.json"
JOURNAL_PATH = ROOT / ".local" / "trade_journal.csv"
DEFAULT_PROFILE = {
    "accountSizeUsd": 0,
    "riskPerTradePct": 0.5,
    "maxPositionPct": 12,
    "maxNewPlansAggressive": 3,
    "maxNewPlansSelective": 2,
    "maxNewPlansDefensive": 0,
}


def load_env(path: Path = DEFAULT_ENV) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, value = text.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def read_json(name: str, fallback: Any) -> Any:
    path = DATA_DIR / name
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def load_profile() -> dict[str, Any]:
    if not PROFILE_PATH.exists():
        return DEFAULT_PROFILE.copy()
    try:
        profile = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return DEFAULT_PROFILE.copy()
    return {**DEFAULT_PROFILE, **profile}


def load_journal() -> list[dict[str, str]]:
    if not JOURNAL_PATH.exists():
        return []
    with JOURNAL_PATH.open("r", encoding="utf-8-sig", newline="") as handle:
        return [dict(row) for row in csv.DictReader(handle)]


def pct_number(value: Any) -> float:
    text = str(value or "").replace("%", "").replace("+", "").replace(",", "").strip()
    try:
        return float(text)
    except ValueError:
        return 0.0


def number_value(value: Any) -> float:
    text = str(value or "").replace("$", "").replace(",", "").replace("x", "").strip()
    try:
        return float(text)
    except ValueError:
        return 0.0


def money_value(value: Any) -> float:
    text = str(value or "").replace("$", "").replace(",", "").strip()
    if text.startswith("(") and text.endswith(")"):
        text = "-" + text[1:-1]
    try:
        return float(text)
    except ValueError:
        return 0.0


def risk_budget_number(value: Any) -> int:
    return int(round(pct_number(value)))


def first_rows(rows: list[dict[str, Any]], count: int = 5) -> list[dict[str, Any]]:
    return [row for row in rows if row.get("symbol") or row.get("ticker")][:count]


def symbol_of(row: dict[str, Any]) -> str:
    return str(row.get("symbol") or row.get("ticker") or "--").upper()


def compact_text(value: Any, limit: int = 88) -> str:
    text = " ".join(str(value or "").replace("\n", " ").split())
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "..."


def data_age_days(value: Any) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        date_value = datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        try:
            date_value = datetime.strptime(text[:10], "%Y-%m-%d").date()
        except ValueError:
            return None
    return (datetime.now().date() - date_value).days


def market_plan_label(score: int, profile: dict[str, Any]) -> tuple[str, str, str, int]:
    if score >= 70:
        max_plans = int(profile.get("maxNewPlansAggressive") or 3)
        return "进攻观察", "正常找机会，但只做计划内交易", f"单笔风险 {profile.get('riskPerTradePct')}%，最多 {max_plans} 个新计划", max_plans
    if score >= 45:
        max_plans = int(profile.get("maxNewPlansSelective") or 2)
        return "选择性交易", "只看最强、最清楚的机会", f"单笔风险减半，最多 {max_plans} 个新计划", max_plans
    max_plans = int(profile.get("maxNewPlansDefensive") or 0)
    return "防守优先", "不急着新开仓，先管理已有仓位", "不主动开新计划，只复盘持仓和自选", max_plans


def market_template(temp_status: dict[str, Any], overall: dict[str, Any], temp_score: int) -> tuple[str, str]:
    status_key = str(temp_status.get("key") or "").lower()
    label = str(temp_status.get("label") or overall.get("label") or "未知")
    if status_key in {"offensive", "active"} or temp_score >= 60:
        return "进攻模板", f"当前是**{label}**环境，允许挑最强的机会，但仍只做计划内交易。"
    if status_key in {"balanced", "neutral", "selective"} or 40 <= temp_score < 60:
        return "平衡模板", f"当前是**{label}**环境，重点看确认，不追涨，不扩张候选池。"
    return "防守模板", f"当前是**{label}**环境，先保住已有仓位，减少新开仓，等待结构修复。"


def market_action_rule(temp_status: dict[str, Any], temp_score: int) -> str:
    status_key = str(temp_status.get("key") or "").lower()
    if status_key in {"offensive", "active"} or temp_score >= 60:
        return "只加强者，优先做回踩确认和突破确认，禁追过热标的。"
    if status_key in {"balanced", "neutral", "selective"} or 40 <= temp_score < 60:
        return "只做最明确的确认位，计划数减半，注意仓位节奏。"
    return "不主动扩张候选池，先降低频率，主要做防守和复盘。"


def risk_budget_text(profile: dict[str, Any]) -> str:
    account_size = number_value(profile.get("accountSizeUsd"))
    risk_pct = number_value(profile.get("riskPerTradePct"))
    max_position_pct = number_value(profile.get("maxPositionPct"))
    if account_size > 0 and risk_pct > 0:
        risk_usd = account_size * risk_pct / 100
        max_position = account_size * max_position_pct / 100
        return f"账户 ${account_size:,.0f}：单笔最大亏损约 ${risk_usd:,.0f}，单票仓位上限约 ${max_position:,.0f}"
    return f"未配置账户规模：先按单笔最大亏损 {risk_pct:g}%、单票仓位不超过 {max_position_pct:g}% 执行"


def is_hot_strength(row: dict[str, Any]) -> bool:
    label = str(row.get("label") or "")
    periods = row.get("periods") or {}
    crowding = row.get("crowding") or {}
    return (
        "热" in label
        or number_value(crowding.get("score")) >= 85
        or number_value(crowding.get("volumeRatio")) >= 3
        or pct_number(periods.get("20d")) >= 70
        or pct_number(periods.get("5d")) >= 30
    )


def strength_plan_candidates(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for row in rows:
        if row.get("bucket") != "strongest":
            continue
        if number_value(row.get("price")) < 5:
            continue
        if is_hot_strength(row):
            continue
        if number_value(row.get("score")) < 80:
            continue
        result.append(row)
    return result


def hot_waitlist(rows: list[dict[str, Any]], count: int = 5) -> list[dict[str, Any]]:
    result = []
    for row in rows:
        if row.get("bucket") != "strongest":
            continue
        if is_hot_strength(row):
            result.append(row)
    return result[:count]


def event_plan_candidates(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for row in rows:
        price = number_value(row.get("close") or row.get("price"))
        if price and price < 5:
            continue
        if pct_number(row.get("return20dPct")) >= 45:
            continue
        result.append(row)
    return result[:4]


def dedupe_candidates(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen = set()
    output = []
    for row in rows:
        symbol = symbol_of(row)
        if not symbol or symbol == "--" or symbol in seen:
            continue
        seen.add(symbol)
        output.append(row)
    return output


def format_strength_row(row: dict[str, Any]) -> str:
    periods = row.get("periods") or {}
    rel = row.get("relative") or {}
    return (
        f"- **{symbol_of(row)}** {row.get('name', '')}：分数 {row.get('score', '--')}，"
        f"20日 {periods.get('20d', '--')}，相对 QQQ {rel.get('qqq', '--')}，"
        f"{row.get('action', '等待价格确认')}"
    )


def format_plan_candidate(row: dict[str, Any], source: str) -> str:
    periods = row.get("periods") or {}
    rel = row.get("relative") or {}
    if source == "强弱":
        evidence = f"强弱 {row.get('score', '--')}，20日 {periods.get('20d', '--')}，相对 QQQ {rel.get('qqq', '--')}"
        trigger = "只在回踩不破前低、或放量突破后再写买入区"
    elif source == "财报":
        evidence = f"质量分 {row.get('score', '--')}，20日 {row.get('return20dPct', '--')}%，目标上行 {row.get('avgPriceTargetUpsidePct', '--')}%"
        trigger = "先核对财报/指引是否仍成立，再看价格承接"
    else:
        evidence = f"事件分 {row.get('signalScore', row.get('score', '--'))}，20日 {row.get('return20dPct', '--')}%，目标上行 {row.get('priceTargetUpsidePct', '--')}%"
        trigger = "先读催化原因，再等待价格确认"
    return f"- **{symbol_of(row)}**（{source}）：{evidence}。下一步：{trigger}。"


def trade_card(row: dict[str, Any]) -> str:
    price = number_value(row.get("price") or row.get("close"))
    breakout = row.get("breakout") or {}
    rel = row.get("relative") or {}
    crowding = row.get("crowding") or {}
    crowd_score = number_value(crowding.get("score"))
    volume_ratio = number_value(crowding.get("volumeRatio"))
    if price <= 0:
        return f"- **{symbol_of(row)}**：缺少有效价格，先只观察。"
    if number_value(breakout.get("score")) >= 95 or str(row.get("label") or "").find("突破") >= 0:
        entry_low = price * 0.99
        entry_high = price * 1.01
        stop = price * (0.955 if volume_ratio < 2 else 0.965)
        target = price * (1.08 if pct_number(rel.get("qqq")) < 35 else 1.06)
        invalid = "跌回前高下方并且收盘无法重新站上"
    else:
        entry_low = price * 0.975
        entry_high = price * 0.99
        stop = price * 0.94
        target = price * 1.07
        invalid = "回踩失败、连续两日弱于 QQQ"
    if crowd_score >= 80 or volume_ratio >= 3:
        target = price * 1.06
        stop = price * 0.97
        invalid = "放量后无法延续，或再次冲高失败"
    if pct_number(rel.get("qqq")) >= 35 or pct_number(rel.get("spy")) >= 40:
        stop = max(stop, price * 0.975)
        target = max(target, price * 1.07)
    return (
        f"- **{symbol_of(row)}**："
        f"买入区 {entry_low:.2f}-{entry_high:.2f}，"
        f"止损 {stop:.2f}，"
        f"第一目标 {target:.2f}，"
        f"失效条件：{invalid}。"
    )


def trade_card_reason(row: dict[str, Any]) -> str:
    source = row.get("_source", "观察")
    relative = row.get("relative") or {}
    periods = row.get("periods") or {}
    crowding = row.get("crowding") or {}
    breakout = row.get("breakout") or {}
    parts = []
    if source == "强弱":
        parts.append(
            f"相对 QQQ {relative.get('qqq', '--')}，20日 {periods.get('20d', '--')}，突破分 {breakout.get('score', '--')}"
        )
    elif source == "财报":
        parts.append(
            f"质量分 {row.get('score', '--')}，20日 {row.get('return20dPct', '--')}%，目标上行 {row.get('avgPriceTargetUpsidePct', '--')}%"
        )
    else:
        parts.append(
            f"事件分 {row.get('signalScore', row.get('score', '--'))}，20日 {row.get('return20dPct', '--')}%，目标上行 {row.get('priceTargetUpsidePct', '--')}%"
        )
    if crowding:
        parts.append(f"拥挤度 {crowding.get('score', '--')}，量比 {crowding.get('volumeRatio', '--')}")
    return f"- **{symbol_of(row)}**：{'；'.join(parts)}。"


def trade_card_heading(row: dict[str, Any], index: int) -> str:
    source = row.get("_source", "观察")
    priority = row.get("_priority")
    if isinstance(priority, (int, float)):
        return f"  {index}. **{symbol_of(row)}**（{source}｜优先级 {priority:.1f}）"
    return f"  {index}. **{symbol_of(row)}**（{source}）"


def candidate_summary_reason(row: dict[str, Any]) -> str:
    source = row.get("_source", "观察")
    relative = row.get("relative") or {}
    periods = row.get("periods") or {}
    crowding = row.get("crowding") or {}
    breakout = row.get("breakout") or {}
    if source == "强弱":
        return (
            f"强弱 {row.get('score', '--')}，20日 {periods.get('20d', '--')}，"
            f"相对 QQQ {relative.get('qqq', '--')}，突破分 {breakout.get('score', '--')}"
        )
    if source == "财报":
        return (
            f"质量分 {row.get('score', '--')}，20日 {row.get('return20dPct', '--')}%，"
            f"目标上行 {row.get('avgPriceTargetUpsidePct', '--')}%"
        )
    return (
        f"事件分 {row.get('signalScore', row.get('score', '--'))}，20日 {row.get('return20dPct', '--')}%，"
        f"目标上行 {row.get('priceTargetUpsidePct', '--')}%"
    )


def format_priority_item(row: dict[str, Any], index: int) -> str:
    reason = candidate_summary_reason(row)
    status = row.get("_status", "保留")
    return f"{index}. **{symbol_of(row)}**（{row.get('_source', '观察')}｜{status}）- {reason}"


def format_event_row(row: dict[str, Any]) -> str:
    reason = compact_text(row.get("reason") or row.get("nextStep") or row.get("risk") or "先核对催化和价格承接")
    return (
        f"- **{symbol_of(row)}**：{row.get('eventLabel') or row.get('userAngle') or row.get('reason') or '研究线索'}；"
        f"分数 {row.get('score', row.get('totalScore', '--'))}；"
        f"{reason}"
    )


def format_mover_row(row: dict[str, Any]) -> str:
    change = row.get("change")
    if change is None:
        change = row.get("changeYtd")
    change_text = f"{change:+.2f}%" if isinstance(change, (int, float)) else str(change or "--")
    return f"- **{symbol_of(row)}**：{change_text}，{row.get('actionNote') or row.get('risk') or '先确认异动原因'}"


def pct_text(value: Any, digits: int = 1) -> str:
    num = number_value(value)
    if num == 0 and str(value).strip() not in {"0", "0.0", "0.00"}:
        return str(value or "--")
    return f"{num:.{digits}f}%"


def signal_label(signal: str) -> str:
    mapping = {
        "analyst_positive": "分析师正面",
        "analyst_negative": "分析师负面",
        "earnings_beat": "财报超预期",
        "earnings_miss": "财报不及预期",
        "guidance_up": "指引上修",
        "guidance_down": "指引下修",
        "short_pressure_up": "空头压力上升",
    }
    return mapping.get(signal, signal)


def signal_effectiveness_lines(validation: dict[str, Any]) -> list[str]:
    summary = validation.get("summary") or {}
    best_signals = summary.get("bestSignals") or []
    event_stats = validation.get("eventTypeStats") or []
    lines = []
    if summary:
        lines.append(f"- 结论：**{summary.get('verdict', '--')}**。{summary.get('conclusion', '')}")
    if best_signals:
        lines.append("- 历史上更值得继续保留的信号：")
        for row in best_signals[:3]:
            lines.append(
                f"  - {signal_label(str(row.get('signal') or '--'))} / {row.get('horizon', '--')}："
                f"样本 {row.get('count', '--')}，均值 {pct_text(row.get('meanPct'))}，"
                f"胜率 {pct_text(row.get('winRatePct'))}"
            )
    if event_stats:
        strongest = []
        for key in ("earnings_beat", "guidance_up", "analyst_positive"):
            matches = [row for row in event_stats if row.get("signal") == key and row.get("horizon") == "20d"]
            if matches:
                strongest.append(matches[0])
        if strongest:
            lines.append("- 20日维度的事件有效性参考：")
            for row in strongest:
                lines.append(
                    f"  - {signal_label(str(row.get('signal') or '--'))}："
                    f"均值 {pct_text(row.get('meanPct'))}，中位数 {pct_text(row.get('medianPct'))}，"
                    f"胜率 {pct_text(row.get('winRatePct'))}"
                )
    return lines


def execution_score(profile: dict[str, Any], journal: list[dict[str, str]]) -> tuple[str, list[str]]:
    if not journal:
        return "--", ["暂无真实交易记录，无法给出执行分。"]
    recent = journal[-8:]
    closed = [row for row in recent if row.get("pnl") not in (None, "")]
    pnl_values = [money_value(row.get("pnl")) for row in closed]
    plan_rows = [row for row in recent if str(row.get("followed_plan", "")).strip()]
    adherence = (
        sum(1 for row in plan_rows if str(row.get("followed_plan", "")).strip().lower() in {"y", "yes", "true", "1", "是", "按计划"})
        / len(plan_rows)
        if plan_rows
        else 0.0
    )
    loss_count = sum(1 for value in pnl_values if value < 0)
    largest_loss = abs(min(pnl_values)) if pnl_values else 0.0
    score = 100
    score -= int((1 - adherence) * 35)
    score -= min(20, loss_count * 8)
    if largest_loss >= 1000:
        score -= 10
    if largest_loss >= 2000:
        score -= 10
    score = max(0, min(100, score))
    notes = [
        f"按计划比例 {round(adherence * 100)}%",
        f"近 8 笔亏损 {loss_count} 笔",
        f"最大单笔亏损 ${largest_loss:,.0f}" if largest_loss else "暂无已平仓亏损数据",
    ]
    return f"{score}/100", notes


def rule_update_lines(validation: dict[str, Any], journal: list[dict[str, str]]) -> list[str]:
    lines: list[str] = []
    summary = validation.get("summary") or {}
    verdict = str(summary.get("verdict") or "")
    conclusion = str(summary.get("conclusion") or "")
    if verdict:
        lines.append(f"- 规则底座：{verdict}。{conclusion}")
    event_stats = validation.get("eventTypeStats") or []
    event20 = {str(row.get("signal")): row for row in event_stats if row.get("horizon") == "20d"}
    if event20.get("earnings_beat"):
        row = event20["earnings_beat"]
        lines.append(
            f"- 财报超预期 20日均值 {pct_text(row.get('meanPct'))}、胜率 {pct_text(row.get('winRatePct'))}，"
            f"可继续作为高优先级观察线索。"
        )
    if event20.get("guidance_up"):
        row = event20["guidance_up"]
        lines.append(
            f"- 指引上修 20日均值 {pct_text(row.get('meanPct'))}、胜率 {pct_text(row.get('winRatePct'))}，"
            f"比单看分析师观点更值得重视。"
        )
    if event20.get("analyst_positive"):
        row = event20["analyst_positive"]
        lines.append(
            f"- 分析师正面 20日均值 {pct_text(row.get('meanPct'))}、胜率 {pct_text(row.get('winRatePct'))}，"
            f"只能当辅助，不适合单独当买点。"
        )
    score, notes = execution_score(load_profile(), journal)
    if journal:
        lines.append(f"- 执行评分：**{score}**，{"；".join(notes)}。")
    return lines


def event_outcome_row(row: dict[str, Any]) -> str:
    fwd5 = row.get("fwd5dPct")
    fwd20 = row.get("fwd20dPct")
    fwd60 = row.get("fwd60dPct")
    forward = []
    if fwd5 is not None:
        forward.append(f"5d {pct_text(fwd5)}")
    if fwd20 is not None:
        forward.append(f"20d {pct_text(fwd20)}")
    if fwd60 is not None:
        forward.append(f"60d {pct_text(fwd60)}")
    forward_text = "，".join(forward) if forward else "暂无后验收益"
    return (
        f"- **{row.get('ticker', '--')}** {row.get('companyName', '')}："
        f"事件 {row.get('eventLabel', '事件')}，信号分 {row.get('signalScore', '--')}，"
        f"后验 {forward_text}。"
    )


def best_and_worst_events(events: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows = []
    for board in (events.get("boards") or {}).values():
        rows.extend(board.get("rows") or [])
    rows = [row for row in rows if row.get("fwd20dPct") is not None]
    winners = sorted(rows, key=lambda r: number_value(r.get("fwd20dPct")), reverse=True)[:3]
    losers = sorted(rows, key=lambda r: number_value(r.get("fwd20dPct")))[:3]
    return winners, losers


def weekly_pattern_lines(movers: dict[str, Any], validation: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    week_rows = ((movers.get("boards") or {}).get("week") or {}).get("rows") or []
    if week_rows:
        lines.append("- 本周异动里最值得追踪的方向：")
        for row in first_rows(week_rows, 4):
            lines.append(
                f"  - **{symbol_of(row)}**：{row.get('change', '--'):+.2f}% ，{row.get('actionNote') or row.get('risk') or '先确认原因'}"
                if isinstance(row.get("change"), (int, float))
                else f"  - **{symbol_of(row)}**：{row.get('change', '--')}，{row.get('actionNote') or row.get('risk') or '先确认原因'}"
            )
    best_signals = (validation.get("summary") or {}).get("bestSignals") or []
    if best_signals:
        lines.append("- 周期上更稳的信号依然集中在：")
        for row in best_signals[:2]:
            lines.append(
                f"  - {signal_label(str(row.get('signal') or '--'))} / {row.get('horizon', '--')}："
                f"均值 {pct_text(row.get('meanPct'))}，胜率 {pct_text(row.get('winRatePct'))}"
            )
    return lines


def simulated_trade_lines(
    plan_candidates: list[dict[str, Any]],
    event_rows: list[dict[str, Any]],
    earning_rows: list[dict[str, Any]],
) -> list[str]:
    if not event_rows and not earning_rows and not plan_candidates:
        return []
    rows: list[dict[str, Any]] = []
    for row in event_rows:
        if row.get("fwd20dPct") is None:
            continue
        copy = dict(row)
        copy["_kind"] = "事件样本"
        rows.append(copy)
    for row in earning_rows:
        if row.get("return20dPct") is None:
            continue
        copy = dict(row)
        copy["_kind"] = "财报样本"
        rows.append(copy)
    if not rows:
        # Fall back to the best observable candidates even if no forward return is available.
        for row in plan_candidates[:3]:
            copy = dict(row)
            copy["_kind"] = "计划候选"
            rows.append(copy)
    rows = sorted(rows, key=lambda r: number_value(r.get("fwd20dPct") if r.get("fwd20dPct") is not None else r.get("return20dPct")), reverse=True)
    winners = rows[:3]
    losers = sorted(rows, key=lambda r: number_value(r.get("fwd20dPct") if r.get("fwd20dPct") is not None else r.get("return20dPct")))[:3]
    by_kind: dict[str, list[float]] = {}
    for row in rows:
        kind = str(row.get("_kind") or "样本")
        ret = row.get("fwd20dPct") if row.get("fwd20dPct") is not None else row.get("return20dPct")
        by_kind.setdefault(kind, []).append(number_value(ret))
    lines = ["- 这版是纸面模拟，不是真实成交，但能看出规则方向是否站得住。"]
    if by_kind:
        lines.append("- 模拟分层结果：")
        for kind, values in by_kind.items():
            if not values:
                continue
            win_rate = sum(1 for value in values if value > 0) / len(values) * 100
            mean_ret = sum(values) / len(values)
            lines.append(f"  - {kind}：样本 {len(values)}，20日均值 {mean_ret:+.1f}%，胜率 {win_rate:.1f}%")
    if winners:
        best = winners[0]
        best_ret = best.get("fwd20dPct") if best.get("fwd20dPct") is not None else best.get("return20dPct")
        lines.append(
            f"- 模拟结论：最强样本是 **{best.get('ticker') or best.get('symbol') or '--'}**，"
            f"20日结果 {pct_text(best_ret)}，信号 {best.get('eventLabel') or best.get('userAngle') or best.get('label') or '--'}。"
        )
    if losers:
        worst = losers[0]
        worst_ret = worst.get("fwd20dPct") if worst.get("fwd20dPct") is not None else worst.get("return20dPct")
        lines.append(
            f"- 模拟风险：最差样本是 **{worst.get('ticker') or worst.get('symbol') or '--'}**，"
            f"20日结果 {pct_text(worst_ret)}，说明这类信号不能无脑追。"
        )
    return lines


def simulated_signal_summary(event_rows: list[dict[str, Any]], earning_rows: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    event_groups: dict[str, list[float]] = {}
    for row in event_rows:
        if row.get("fwd20dPct") is None:
            continue
        key = str(row.get("eventLabel") or row.get("eventType") or "事件")
        event_groups.setdefault(key, []).append(number_value(row.get("fwd20dPct")))
    earn_groups: dict[str, list[float]] = {}
    for row in earning_rows:
        if row.get("return20dPct") is None:
            continue
        key = str(row.get("userAngle") or "财报")
        earn_groups.setdefault(key, []).append(number_value(row.get("return20dPct")))
    if event_groups:
        lines.append("- 事件模拟分层：")
        for key, values in sorted(event_groups.items(), key=lambda item: sum(item[1]) / len(item[1]), reverse=True)[:3]:
            win_rate = sum(1 for value in values if value > 0) / len(values) * 100
            mean_ret = sum(values) / len(values)
            lines.append(f"  - {key}：样本 {len(values)}，20日均值 {mean_ret:+.1f}%，胜率 {win_rate:.1f}%")
    if earn_groups:
        lines.append("- 财报模拟分层：")
        for key, values in sorted(earn_groups.items(), key=lambda item: sum(item[1]) / len(item[1]), reverse=True)[:3]:
            win_rate = sum(1 for value in values if value > 0) / len(values) * 100
            mean_ret = sum(values) / len(values)
            lines.append(f"  - {key}：样本 {len(values)}，20日均值 {mean_ret:+.1f}%，胜率 {win_rate:.1f}%")
    if event_groups and earn_groups:
        best_event = max(event_groups.items(), key=lambda item: sum(item[1]) / len(item[1]))
        best_earn = max(earn_groups.items(), key=lambda item: sum(item[1]) / len(item[1]))
        lines.append(
            f"- 结论卡：事件里更强的是 **{best_event[0]}**，财报里更强的是 **{best_earn[0]}**。"
        )
    return lines


def journal_execution_issues(rows: list[dict[str, str]]) -> list[str]:
    if not rows:
        return []
    recent = rows[-8:]
    issues = []
    plan_rows = [row for row in recent if str(row.get("followed_plan", "")).strip()]
    if plan_rows:
        adherence = sum(
            1 for row in plan_rows if str(row.get("followed_plan", "")).strip().lower() in {"y", "yes", "true", "1", "是", "按计划"}
        ) / len(plan_rows)
    else:
        adherence = None
    closed = [row for row in recent if row.get("pnl") not in (None, "")]
    pnl_values = [money_value(row.get("pnl")) for row in closed]
    largest_loss = min(pnl_values) if pnl_values else 0.0
    if adherence is not None and adherence < 0.8:
        issues.append(f"按计划比例偏低（{round(adherence * 100)}%）")
    if sum(1 for value in pnl_values if value < 0) >= 2:
        issues.append("近期连续亏损偏多")
    if largest_loss < 0 and abs(largest_loss) >= 1000:
        issues.append(f"单笔最大亏损较大（${abs(largest_loss):,.0f}）")
    notes = [compact_text(row.get("notes", ""), 60).lower() for row in recent if row.get("notes")]
    if any("追" in note or "追高" in note for note in notes):
        issues.append("记录中出现追高迹象")
    if any("止损" in note or "stop" in note for note in notes):
        issues.append("记录中出现止损相关描述，需核对是否执行到位")
    if any("提前" in note or "premature" in note for note in notes):
        issues.append("记录中出现提前入场迹象")
    if any("仓位" in note or "size" in note for note in notes):
        issues.append("记录中出现仓位管理相关提示")
    return list(dict.fromkeys(issues))


def plan_mode_from_history(base_mode: str, journal: list[dict[str, str]]) -> str:
    if not journal:
        return base_mode
    recent = journal[-8:]
    closed = [row for row in recent if row.get("pnl") not in (None, "")]
    pnl_values = [money_value(row.get("pnl")) for row in closed]
    plan_rows = [row for row in recent if str(row.get("followed_plan", "")).strip()]
    adherence = (
        sum(1 for row in plan_rows if str(row.get("followed_plan", "")).strip().lower() in {"y", "yes", "true", "1", "是", "按计划"})
        / len(plan_rows)
        if plan_rows
        else None
    )
    avg_pnl = sum(pnl_values) / len(pnl_values) if pnl_values else 0.0
    losses = sum(1 for value in pnl_values if value < 0)
    if losses >= 2 and (adherence is None or adherence < 0.8 or avg_pnl < 0):
        return "防守优先"
    if adherence is not None and adherence >= 0.9 and sum(1 for value in pnl_values if value > 0) >= 2 and avg_pnl >= 0:
        return "进攻观察"
    return base_mode


def exposure_adjustment(mode: str, journal: list[dict[str, str]]) -> str:
    if not journal:
        return "未接入真实交易记录，先按市场状态执行，不额外放大仓位。"
    recent = journal[-8:]
    closed = [row for row in recent if row.get("pnl") not in (None, "")]
    pnl_values = [money_value(row.get("pnl")) for row in closed]
    plan_rows = [row for row in recent if str(row.get("followed_plan", "")).strip()]
    adherence = (
        sum(1 for row in plan_rows if str(row.get("followed_plan", "")).strip().lower() in {"y", "yes", "true", "1", "是", "按计划"})
        / len(plan_rows)
        if plan_rows
        else None
    )
    avg_pnl = sum(pnl_values) / len(pnl_values) if pnl_values else 0.0
    if mode == "防守优先":
        return "明天只保留观察，不主动加计划；如果盘中出现机会，也只做最强、最明确的一笔。"
    if adherence is not None and adherence < 0.8:
        return "执行纪律偏弱，明天优先减少新计划数量，把重点放在按计划执行，而不是扩大候选池。"
    if sum(1 for value in pnl_values if value < 0) >= 2 or avg_pnl < 0:
        return "最近亏损偏多，明天把触发条件收紧到回踩确认或突破确认，不做提前预判。"
    return "执行质量尚可，明天按市场强弱保持选择性出手，但仍只做计划内交易。"


def select_next_day_plan(
    mode: str,
    max_plans: int,
    profile: dict[str, Any],
    strength_rows: list[dict[str, Any]],
    event_rows: list[dict[str, Any]],
    earning_rows: list[dict[str, Any]],
    journal: list[dict[str, str]],
) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    adjusted_mode = plan_mode_from_history(mode, journal)
    if adjusted_mode == "进攻观察":
        plan_cap = int(profile.get("maxNewPlansAggressive") or max_plans or 3)
    elif adjusted_mode == "防守优先":
        plan_cap = int(profile.get("maxNewPlansDefensive") or 0)
    else:
        plan_cap = int(profile.get("maxNewPlansSelective") or max_plans or 2)

    plan_strength = strength_plan_candidates(strength_rows)
    wait_strength = hot_waitlist(strength_rows)
    plan_events = event_plan_candidates(event_rows)
    plan_earnings = event_plan_candidates(earning_rows)
    plan_candidates = dedupe_candidates(
        [{**row, "_source": "强弱"} for row in plan_strength]
        + [{**row, "_source": "财报"} for row in plan_earnings]
        + [{**row, "_source": "事件"} for row in plan_events]
    )[:max(0, plan_cap)]
    if journal and plan_candidates:
        recent = journal[-8:]
        closed = [row for row in recent if row.get("pnl") not in (None, "")]
        pnl_values = [money_value(row.get("pnl")) for row in closed]
        plan_rows = [row for row in recent if str(row.get("followed_plan", "")).strip()]
        adherence = (
            sum(1 for row in plan_rows if str(row.get("followed_plan", "")).strip().lower() in {"y", "yes", "true", "1", "是", "按计划"})
            / len(plan_rows)
            if plan_rows
            else 0.0
        )
        avg_pnl = sum(pnl_values) / len(pnl_values) if pnl_values else 0.0
        penalty = max(0.0, -avg_pnl / 100.0) + (0.8 - adherence if adherence < 0.8 else 0.0)
        for row in plan_candidates:
            score = number_value(row.get("score") or row.get("signalScore") or row.get("totalScore"))
            relative = row.get("relative") or {}
            periods = row.get("periods") or {}
            crowding = row.get("crowding") or {}
            strength_bonus = max(
                pct_number(relative.get("qqq")),
                pct_number(relative.get("spy")),
                pct_number(periods.get("20d")),
                pct_number(periods.get("63d")) * 0.4,
            )
            heat_penalty = max(0.0, number_value(crowding.get("score")) / 12 + max(0.0, pct_number(periods.get("5d"))) / 6)
            row["_priority"] = score + strength_bonus - heat_penalty - penalty
        plan_candidates.sort(key=lambda item: item.get("_priority", 0), reverse=True)
    for row in plan_candidates:
        row["_status"] = "保留"
    wait_rows = []
    for row in wait_strength:
        wait_row = dict(row)
        wait_row["_source"] = "强弱"
        wait_row["_status"] = "禁追"
        wait_row["_priority"] = number_value(wait_row.get("score")) + pct_number((wait_row.get("relative") or {}).get("qqq")) * 0.5
        wait_rows.append(wait_row)
    combined_rows = sorted(plan_candidates + wait_rows, key=lambda item: item.get("_priority", 0), reverse=True)
    avoid_notes = []
    if adjusted_mode == "防守优先":
        avoid_notes.append("明日不主动扩张候选池，只保留最强的观察位")
    if wait_strength:
        avoid_notes.append("已经过热的强势股继续留在禁追名单，等回踩确认")
    if any(pct_number(row.get("return20dPct")) >= 45 for row in event_rows):
        avoid_notes.append("事件线索里有高热度标的，优先看价格承接再看催化")
    return adjusted_mode, plan_candidates, wait_strength[:5], combined_rows, avoid_notes


def execution_template(profile: dict[str, Any]) -> list[str]:
    return [
        f"- 账户风控：{risk_budget_text(profile)}。",
        "- 每个候选必须写四个价格：计划买入区、止损位、第一目标、失效条件。",
        "- 仓位公式：可亏金额 ÷ 每股风险 = 最大股数；超过单票仓位上限就砍到上限。",
        "- 禁止项：没有止损不下单；单日暴涨后不追市价；连续亏两笔停止新开仓。",
    ]


def journal_summary(rows: list[dict[str, str]], mode: str) -> list[str]:
    if not rows:
        return [
            "- 暂未接入你的真实交易记录。创建 `.local/trade_journal.csv` 后，盘后和周末会自动复盘你的执行质量。",
            "- 建议字段：date,symbol,side,plan,entry,stop,exit,pnl,followed_plan,notes",
        ]
    recent = rows[-20:] if mode == "weekly" else rows[-8:]
    closed = [row for row in recent if row.get("pnl") not in (None, "")]
    pnl_values = [money_value(row.get("pnl")) for row in closed]
    wins = sum(1 for value in pnl_values if value > 0)
    losses = sum(1 for value in pnl_values if value < 0)
    total_pnl = sum(pnl_values)
    plan_rows = [row for row in recent if str(row.get("followed_plan", "")).strip()]
    followed = sum(1 for row in plan_rows if str(row.get("followed_plan", "")).strip().lower() in {"y", "yes", "true", "1", "是", "按计划"})
    adherence = f"{round(followed / len(plan_rows) * 100)}%" if plan_rows else "--"
    largest_loss = min(pnl_values) if pnl_values else 0
    latest = recent[-3:]
    lines = [
        f"- 最近 {len(recent)} 条记录：已平仓 {len(closed)} 笔，胜 {wins} / 负 {losses}，合计 PnL ${total_pnl:,.0f}。",
        f"- 执行纪律：按计划比例 {adherence}；最大单笔亏损 ${largest_loss:,.0f}。",
    ]
    issues = journal_execution_issues(rows)
    if issues:
        lines.append("- 执行问题：" + "；".join(issues[:4]))
    if latest:
        lines.append(
            "- 最近交易："
            + "；".join(
                f"{row.get('symbol', '--')} {row.get('side', '')} PnL {row.get('pnl', '--')} {compact_text(row.get('notes', ''), 28)}"
                for row in latest
            )
        )
    if largest_loss < 0 and plan_rows and adherence not in {"--", "100%"}:
        lines.append("- 下一步：先修执行问题，再谈提高胜率；亏损交易重点看是否追高、无止损或仓位过大。")
    return lines


def weekly_review_summary(
    mode: str,
    plan_label: str,
    temp_score: int,
    template_label: str,
    template_action: str,
    max_plans: int,
    journal: list[dict[str, str]],
    stale_notes: list[str],
) -> list[str]:
    lines = ["### 8. 本周复盘结论"]
    lines.append(f"- 本周市场基调：**{plan_label}**，温度/风险预算 **{temp_score}**，核心不是扩张，而是筛选更干净的确认信号。")
    lines.append(f"- 周末模板：**{template_label}**，{template_action}")
    if journal:
        recent = journal[-8:]
        closed = [row for row in recent if row.get("pnl") not in (None, "")]
        pnl_values = [money_value(row.get("pnl")) for row in closed]
        plan_rows = [row for row in recent if str(row.get("followed_plan", "")).strip()]
        adherence = (
            sum(1 for row in plan_rows if str(row.get("followed_plan", "")).strip().lower() in {"y", "yes", "true", "1", "是", "按计划"})
            / len(plan_rows)
            if plan_rows
            else None
        )
        issues = journal_execution_issues(rows=journal)
        total_pnl = sum(pnl_values)
        wins = sum(1 for value in pnl_values if value > 0)
        losses = sum(1 for value in pnl_values if value < 0)
        lines.append(f"- 执行结果：最近 {len(recent)} 条里已平仓 {len(closed)} 笔，胜 {wins} / 负 {losses}，合计 PnL ${total_pnl:,.0f}。")
        if adherence is not None:
            lines.append(f"- 纪律结果：按计划比例 {round(adherence * 100)}%，说明这周更需要修正执行，而不只是挑选标的。")
        if issues:
            lines.append(f"- 主要问题：{'；'.join(issues[:3])}。")
    else:
        lines.append("- 执行结果：暂未接入真实交易日志，这份周末复盘只能评价市场和候选，不能评价你的执行质量。")
    if stale_notes:
        lines.append(f"- 数据可靠性：{'; '.join(stale_notes)}，自动结论权重需要下调，先人工核对再下判断。")
    lines.append("- 下周动作：只保留最强、最清楚的机会；所有候选都先写买入区、止损、目标和失效条件。")
    if mode == "weekly":
        lines.append(f"- 候选约束：最多 {max_plans} 个新计划，不把复盘变成名单扩容。")
    return lines


def build_brief(mode: str) -> str:
    profile = load_profile()
    journal = load_journal()
    core = read_json("core-signals.json", {})
    temp = read_json("market-temperature.json", {})
    strength = read_json("strength-scanner.json", {})
    movers = read_json("market-movers.json", {})
    events = read_json("event-opportunities.json", {})
    earnings = read_json("earnings-quality.json", {})
    validation = read_json("validation-center.json", {})

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    market = core.get("marketRegime") or {}
    overall = temp.get("overall") or {}
    temp_score = int(overall.get("score") or risk_budget_number(market.get("riskBudget")))
    plan_label, plan_action, risk_rule, max_plans = market_plan_label(temp_score, profile)
    template_label, template_action = market_template(temp.get("status") or {}, overall, temp_score)
    action_rule = market_action_rule(temp.get("status") or {}, temp_score)

    strength_rows = strength.get("rows") or []
    day_rows = ((movers.get("boards") or {}).get("day") or {}).get("rows") or []
    event_rows = []
    for board in (events.get("boards") or {}).values():
        event_rows.extend(board.get("rows") or [])
    earning_rows = ((earnings.get("boards") or {}).get("quality") or {}).get("rows") or []
    next_day_mode, plan_candidates, wait_strength, combined_rows, avoid_notes = select_next_day_plan(
        plan_label,
        max_plans,
        profile,
        strength_rows,
        event_rows,
        earning_rows,
        journal,
    )
    stale_notes = []
    for label, value in [("温度", temp.get("asOf")), ("强弱", strength.get("asOf")), ("事件", events.get("asOf")), ("财报", earnings.get("asOf"))]:
        age = data_age_days(value)
        if age is not None and age > 5:
            stale_notes.append(f"{label}数据 {age} 天未更新")

    if mode == "preopen":
        title = "美股盘前交易计划"
        task = "今天先决定仓位上限，再从强势股和研究线索里挑候选。"
    elif mode == "postclose":
        title = "美股收盘复盘"
        task = "复盘今天是否按计划交易，并更新明天观察名单。"
    else:
        title = "美股周末策略复盘"
        task = "检查本周最有效的数据来源、最该回避的风险，以及下周自选。"

    lines = [
        f"## {title}",
        f"> 生成时间：{now}，数据日期：温度 {temp.get('asOf', '--')} / 强弱 {strength.get('asOf', '--')}",
        "",
        "### 1. 今日结论",
        f"- 市场状态：**{overall.get('label') or market.get('label') or '--'}**，温度/风险预算 **{temp_score}**",
        f"- 操作模式：**{plan_label}**，{plan_action}",
        f"- 环境模板：**{template_label}**，{template_action}",
        f"- 模板动作：{action_rule}",
        f"- 仓位规则：{risk_rule}",
        f"- 风控参数：{risk_budget_text(profile)}",
        f"- 任务：{task}",
    ]
    if stale_notes:
        lines.append(f"- 数据提醒：**{'；'.join(stale_notes)}**，今天降低自动结论权重，优先手动核对。")

    lines.extend(["", "### 2. 可写交易计划"])
    if max_plans <= 0:
        lines.append("- 今日模式不建议主动开新计划，只做持仓复盘和观察。")
    elif plan_candidates:
        lines.extend(format_plan_candidate(row, row.get("_source", "观察")) for row in plan_candidates[:max_plans])
    else:
        lines.append("- 今天没有足够干净的候选。强势股多数偏热，宁可等下一次回踩确认。")

    lines.extend(["", "### 3. 倒推明日计划"])
    lines.append(f"- 明日模式：**{next_day_mode}**")
    lines.append(f"- 明日动作：{exposure_adjustment(next_day_mode, journal)}")
    if combined_rows:
        lines.append("- 明日优先级总榜：")
        for idx, row in enumerate(combined_rows[:max(1, len(combined_rows))], start=1):
            lines.append(format_priority_item(row, idx))
            if row.get("_status") == "保留":
                lines.append(f"  - {trade_card(row).lstrip('- ')}")
                lines.append(f"  - {trade_card_reason(row).lstrip('- ')}")
    if avoid_notes:
        lines.append("- 明日回避点：" + "；".join(dict.fromkeys(avoid_notes)))

    if wait_strength:
        lines.append("")
        lines.append("### 4. 等回踩 / 禁追")
        lines.extend(format_strength_row(row) for row in wait_strength[:5])

    if event_rows:
        lines.append("")
        lines.append("### 5. 催化核对")
        lines.extend(format_event_row(row) for row in first_rows(event_rows, 4))

    if day_rows:
        lines.append("")
        lines.append("### 6. 异动风险提醒")
        lines.extend(format_mover_row(row) for row in first_rows(day_rows, 4))

    if earning_rows:
        lines.append("")
        lines.append("### 7. 财报观察")
        lines.extend(format_event_row(row) for row in first_rows(earning_rows, 3))

    if mode == "weekly":
        lines.append("")
        lines.extend(weekly_review_summary(mode, plan_label, temp_score, template_label, template_action, max_plans, journal, stale_notes))

    if mode in {"postclose", "weekly"}:
        lines.append("")
        lines.append("### 9. 我的交易复盘")
        if journal:
            lines.extend(journal_summary(journal, mode))
        else:
            lines.extend(simulated_trade_lines(plan_candidates, event_rows, earning_rows))
            lines.extend(simulated_signal_summary(event_rows, earning_rows))

        lines.append("")
        lines.append("### 10. 信号有效性")
        signal_lines = signal_effectiveness_lines(validation)
        if signal_lines:
            lines.extend(signal_lines)
        else:
            lines.append("- 暂时没有足够的验证样本。")

        lines.append("")
        lines.append("### 11. 规则更新")
        rule_lines = rule_update_lines(validation, journal)
        if rule_lines:
            lines.extend(rule_lines)
        else:
            lines.append("- 暂无可更新规则。")

        winners, losers = best_and_worst_events(events)
        if winners or losers:
            lines.append("")
            lines.append("### 12. 事件后验对照")
            if winners:
                lines.append("- 兑现更好的事件：")
                lines.extend(event_outcome_row(row) for row in winners)
            if losers:
                lines.append("- 兑现更差的事件：")
                lines.extend(event_outcome_row(row) for row in losers)

    if mode == "weekly":
        lines.append("")
        lines.append("### 13. 周内模式")
        weekly_lines = weekly_pattern_lines(movers, validation)
        if weekly_lines:
            lines.extend(weekly_lines)
        else:
            lines.append("- 暂无周内样本。")

    lines.extend(["", "### 14. 下单前检查", *execution_template(profile)])
    return "\n".join(lines)


def dingtalk_url(webhook: str, secret: str) -> str:
    if not secret:
        return webhook
    timestamp = str(round(time.time() * 1000))
    raw = f"{timestamp}\n{secret}".encode("utf-8")
    sign = urllib.parse.quote_plus(base64.b64encode(hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).digest()))
    separator = "&" if "?" in webhook else "?"
    return f"{webhook}{separator}timestamp={timestamp}&sign={sign}"


def print_chat(markdown: str) -> None:
    print(markdown)


def send_dingtalk(markdown: str) -> None:
    webhook = os.environ.get("DINGTALK_WEBHOOK", "").strip()
    secret = os.environ.get("DINGTALK_SECRET", "").strip()
    if not webhook:
        raise RuntimeError("DINGTALK_WEBHOOK is not configured")
    title = markdown.splitlines()[0].replace("#", "").strip() or "交易简报"
    payload = {
        "msgtype": "markdown",
        "markdown": {"title": title, "text": markdown},
    }
    request = urllib.request.Request(
        dingtalk_url(webhook, secret),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        body = json.loads(response.read().decode("utf-8"))
    if body.get("errcode") != 0:
        raise RuntimeError(f"DingTalk push failed: {body}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a trading brief and optionally send it to DingTalk.")
    parser.add_argument("--mode", choices=["preopen", "postclose", "weekly"], default="preopen")
    parser.add_argument("--output", choices=["chat", "dingtalk"], default=os.environ.get("TRADE_BRIEF_OUTPUT", "chat"))
    parser.add_argument("--dry-run", action="store_true", help="Deprecated alias for --output chat.")
    args = parser.parse_args()
    load_env()
    markdown = build_brief(args.mode)
    if args.dry_run or args.output == "chat":
        print_chat(markdown)
    else:
        send_dingtalk(markdown)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

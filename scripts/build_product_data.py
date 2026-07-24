#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
EXTERNAL = Path("/Volumes/Extreme SSD/market-data-lab/data")
FRED_DIR = EXTERNAL / "raw" / "fred"
REPORTS = EXTERNAL / "reports"
DAILY_DIR = EXTERNAL / "processed" / "polygon" / "stocks_split_adjusted" / "1d"
EVENT_SIGNALS_PATH = EXTERNAL / "features" / "polygon" / "monetizable_signals" / "event_signals.parquet"
EARNINGS_DIR = EXTERNAL / "raw" / "polygon_rest" / "earnings"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if pd.isna(number):
        return None
    return number


def pct_value(value: Any) -> float | None:
    number = clean_number(value)
    if number is None:
        return None
    return round(number * 100, 2) if abs(number) <= 5 else round(number, 2)


def money_compact(value: Any) -> str | None:
    number = clean_number(value)
    if number is None:
        return None
    abs_value = abs(number)
    if abs_value >= 1_000_000_000:
        return f"${number / 1_000_000_000:.1f}B"
    if abs_value >= 1_000_000:
        return f"${number / 1_000_000:.1f}M"
    if abs_value >= 1_000:
        return f"${number / 1_000:.1f}K"
    return f"${number:.0f}"


def first_value(row: pd.Series, *columns: str) -> Any:
    for column in columns:
        if column in row and pd.notna(row[column]) and str(row[column]).strip():
            return row[column]
    return None


def read_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path)


def earnings_impact(importance: Any) -> str:
    number = clean_number(importance)
    if number is None:
        return "medium"
    if number >= 4:
        return "high"
    if number >= 2:
        return "medium"
    return "low"


def compact_revenue(value: Any) -> str:
    label = money_compact(value)
    return label or "--"


def normalize_manual_earnings_event(row: dict[str, Any], source_name: str) -> dict[str, Any] | None:
    ticker = str(row.get("symbol") or row.get("ticker") or "").upper().strip()
    event_date = str(row.get("date") or row.get("reportDate") or "").strip()
    if not ticker or not event_date:
        return None
    company = str(row.get("company") or row.get("companyName") or row.get("name") or ticker).strip()
    title = str(row.get("title") or f"{ticker} 财报").strip()
    summary = str(row.get("summary") or f"{company}：财报日期来自 {source_name}。").strip()
    return {
        "date": event_date[:10],
        "time": str(row.get("time") or "").strip(),
        "title": title,
        "type": "earnings",
        "impact": str(row.get("impact") or "medium"),
        "sourceName": str(row.get("sourceName") or source_name),
        "relatedModules": row.get("relatedModules") or ["美股重点财经前瞻", "股票库", "财报观察"],
        "relatedAssets": row.get("relatedAssets") or [ticker],
        "summary": summary,
    }


def build_manual_earnings_calendar_events(start: date, end: date, limit: int = 5000) -> list[dict[str, Any]]:
    try:
        from download_earnings_calendar import DEFAULT_WATCHLIST, build_calendar_payload

        payload = build_calendar_payload(
            start,
            end,
            watchlist=DEFAULT_WATCHLIST,
            timeout=int(os.environ.get("EARNINGS_CALENDAR_TIMEOUT", "30")),
            nasdaq_workers=int(os.environ.get("EARNINGS_CALENDAR_WORKERS", "8")),
            fmp_api_key=os.environ.get("FMP_API_KEY", ""),
            alpha_vantage_api_key=os.environ.get("ALPHA_VANTAGE_API_KEY") or os.environ.get("ALPHAVANTAGE_API_KEY", ""),
            finnhub_api_key=os.environ.get("FINNHUB_API_KEY", ""),
        )
    except Exception as exc:
        print(f"WARN: direct earnings calendar fetch skipped: {exc}")
        payload = {}
    events = payload.get("events")
    if not isinstance(events, list):
        return []
    source_name = str(payload.get("sourceName") or "manual earnings calendar")
    out: list[dict[str, Any]] = []
    for row in events:
        if not isinstance(row, dict):
            continue
        event = normalize_manual_earnings_event(row, source_name)
        if not event:
            continue
        try:
            event_date = date.fromisoformat(str(event["date"])[:10])
        except ValueError:
            continue
        if start <= event_date <= end:
            out.append(event)
    return sorted(out, key=lambda row: (row["date"], row.get("time") or "", row.get("title") or ""))[:limit]


def build_earnings_calendar_events(start: date, end: date, limit: int = 120) -> list[dict[str, Any]]:
    if not EARNINGS_DIR.exists():
        return []
    files = sorted(file for file in EARNINGS_DIR.glob("earnings_*.parquet") if not file.name.startswith("._"))
    if not files:
        return []
    columns = [
        "ticker",
        "company_name",
        "date",
        "time",
        "date_status",
        "importance",
        "estimated_eps",
        "estimated_revenue",
        "fiscal_period",
        "fiscal_year",
    ]
    frames: list[pd.DataFrame] = []
    for file in files:
        try:
            frame = pd.read_parquet(file, columns=columns)
        except Exception:
            continue
        if not frame.empty:
            frames.append(frame)
    if not frames:
        return []
    data = pd.concat(frames, ignore_index=True)
    data["ticker"] = data["ticker"].astype(str).str.upper().str.strip()
    data["date"] = pd.to_datetime(data["date"], errors="coerce")
    data = data.dropna(subset=["ticker", "date"])
    data = data[(data["date"].dt.date >= start) & (data["date"].dt.date <= end)]
    if data.empty:
        return []
    data["importance"] = pd.to_numeric(data["importance"], errors="coerce").fillna(0)
    data = data.sort_values(["date", "importance", "ticker"], ascending=[True, False, True])
    data = data.drop_duplicates(["ticker", "date"], keep="first").head(limit)
    events: list[dict[str, Any]] = []
    for row in data.itertuples(index=False):
        ticker = str(row.ticker).upper()
        company = str(row.company_name or ticker).strip()
        report_date = row.date.date().isoformat()
        period = " ".join(str(value) for value in [row.fiscal_period, row.fiscal_year] if pd.notna(value) and str(value).strip())
        eps = clean_number(row.estimated_eps)
        revenue = clean_number(row.estimated_revenue)
        status = str(row.date_status or "").strip()
        details = []
        if period:
            details.append(period)
        if eps is not None:
            details.append(f"预估 EPS {eps:.2f}")
        if revenue is not None:
            details.append(f"预估收入 {compact_revenue(revenue)}")
        summary = "；".join(details) or "财报日期来自本地 Polygon/Benzinga earnings 数据。"
        if status:
            summary = f"{summary}；状态 {status}。"
        events.append(
            {
                "date": report_date,
                "time": str(row.time or "").strip(),
                "title": f"{ticker} 财报",
                "type": "earnings",
                "impact": earnings_impact(row.importance),
                "sourceName": "Polygon/Benzinga",
                "relatedModules": ["美股重点财经前瞻", "股票库", "财报观察"],
                "relatedAssets": [ticker],
                "summary": f"{company}：{summary}",
            }
        )
    return events


def fetch_text(url: str, timeout: int = 20) -> str:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; dongbimao/1.0; +https://www.dongbimao.org)"},
    )
    return urllib.request.urlopen(request, timeout=timeout).read().decode("utf-8", "ignore")


def china_event_time(et_value: str) -> tuple[str, str] | None:
    match = re.search(r"(\d{8})T(\d{4})", et_value)
    if not match:
        return None
    raw = datetime.strptime("".join(match.groups()), "%Y%m%d%H%M").replace(tzinfo=ZoneInfo("America/New_York"))
    cn = raw.astimezone(ZoneInfo("Asia/Shanghai"))
    return cn.date().isoformat(), cn.strftime("%H:%M")


def build_bls_macro_events(start: date, end: date) -> list[dict[str, Any]]:
    try:
        text = fetch_text("https://www.bls.gov/schedule/news_release/bls.ics")
    except Exception:
        return []
    events: list[dict[str, Any]] = []
    for block in text.split("BEGIN:VEVENT"):
        summary = re.search(r"^SUMMARY:(.+)$", block, re.M)
        dtstart = re.search(r"^DTSTART[^:]*:(.+)$", block, re.M)
        if not summary or not dtstart:
            continue
        name = summary.group(1).strip()
        if name not in {"Employment Situation", "Consumer Price Index"}:
            continue
        converted = china_event_time(dtstart.group(1).strip())
        if not converted:
            continue
        event_date, event_time = converted
        day = date.fromisoformat(event_date)
        if not (start <= day <= end):
            continue
        title = "美国非农就业" if name == "Employment Situation" else "美国 CPI"
        summary_text = "就业数据会影响降息预期、小盘风险偏好和美元利率交易。" if name == "Employment Situation" else "通胀数据会影响降息预期、成长股估值和美债利率。"
        events.append(
            {
                "date": event_date,
                "time": event_time,
                "title": title,
                "type": "macro",
                "impact": "high",
                "sourceName": "BLS",
                "relatedModules": ["美股重点财经前瞻"],
                "relatedAssets": [],
                "summary": summary_text,
            }
        )
    return events


def build_fomc_macro_events(start: date, end: date) -> list[dict[str, Any]]:
    try:
        text = fetch_text("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm")
    except Exception:
        return []
    current_year = ""
    current_month = ""
    events: list[dict[str, Any]] = []
    month_numbers = {
        "January": 1,
        "February": 2,
        "March": 3,
        "April": 4,
        "May": 5,
        "June": 6,
        "July": 7,
        "August": 8,
        "September": 9,
        "October": 10,
        "November": 11,
        "December": 12,
    }
    for match in re.finditer(r"(\d{4}) FOMC Meetings|fomc-meeting__month[^>]*><strong>([^<]+)</strong>|fomc-meeting__date[^>]*>([^<]+)<", text):
        if match.group(1):
            current_year = match.group(1)
            current_month = ""
            continue
        if match.group(2):
            current_month = match.group(2).strip()
            continue
        if not current_year or not current_month or not match.group(3):
            continue
        raw_day = match.group(3).strip()
        days = [int(part) for part in re.findall(r"\d+", raw_day)]
        if not days or current_month not in month_numbers:
            continue
        meeting_day = date(int(current_year), month_numbers[current_month], days[-1])
        raw = datetime(meeting_day.year, meeting_day.month, meeting_day.day, 14, 0, tzinfo=ZoneInfo("America/New_York"))
        cn = raw.astimezone(ZoneInfo("Asia/Shanghai"))
        if not (start <= cn.date() <= end):
            continue
        events.append(
            {
                "date": cn.date().isoformat(),
                "time": cn.strftime("%H:%M"),
                "title": "FOMC 议息会议",
                "type": "macro",
                "impact": "high",
                "sourceName": "Federal Reserve",
                "relatedModules": ["美股重点财经前瞻"],
                "relatedAssets": [],
                "summary": "美联储利率决议会影响美债利率、成长股估值和美元流动性。",
            }
        )
    return events


def build_macro_calendar_events(start: date, end: date, limit: int = 200) -> list[dict[str, Any]]:
    seen: set[tuple[str, str, str]] = set()
    events: list[dict[str, Any]] = []
    for event in [*build_bls_macro_events(start, end), *build_fomc_macro_events(start, end)]:
        key = (str(event.get("date") or ""), str(event.get("time") or ""), str(event.get("title") or ""))
        if key not in seen:
            seen.add(key)
            events.append(event)
    return sorted(events, key=lambda row: (row["date"], row.get("time") or "", row.get("title") or ""))[:limit]


def build_events_calendar() -> dict[str, Any]:
    existing: dict[str, Any] = {}
    today = datetime.now(timezone.utc).date()
    horizon_end = today + timedelta(days=90)
    macro_start = today - timedelta(days=45)
    base_events = [
        event
        for event in existing.get("events", [])
        if str(event.get("type") or "").lower() != "earnings"
    ]
    macro_events = build_macro_calendar_events(macro_start, horizon_end)
    local_earnings_events = build_earnings_calendar_events(today, horizon_end)
    manual_earnings_events = build_manual_earnings_calendar_events(today, horizon_end)
    earnings_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for event in [*local_earnings_events, *manual_earnings_events]:
        assets = event.get("relatedAssets") if isinstance(event.get("relatedAssets"), list) else []
        symbol = str(assets[0] if assets else event.get("title") or "").upper()
        key = (str(event.get("date") or ""), symbol)
        if key[0] and key[1] and key not in earnings_by_key:
            earnings_by_key[key] = event
    earnings_events = sorted(
        earnings_by_key.values(),
        key=lambda row: (str(row.get("date") or ""), str(row.get("time") or ""), str(row.get("title") or "")),
    )
    events = sorted(
        [*base_events, *macro_events, *earnings_events],
        key=lambda row: (str(row.get("date") or ""), str(row.get("time") or ""), str(row.get("title") or "")),
    )
    return {
        "generatedAt": now_iso(),
        "asOf": today.isoformat(),
        "source": "official macro calendars + local Polygon/Benzinga/FMP/manual earnings snapshots",
        "events": events,
        "impactRules": existing.get("impactRules") or [],
        "coverage": {
            "earningsRows": len(earnings_events),
            "macroRows": len(macro_events),
            "localEarningsRows": len(local_earnings_events),
            "manualEarningsRows": len(manual_earnings_events),
            "earningsWindowStart": today.isoformat(),
            "earningsWindowEnd": horizon_end.isoformat(),
            "earningsSourceReady": bool(earnings_events),
        },
    }


def read_fred_series(series_id: str, *, percent_yoy: bool = False) -> dict[str, Any] | None:
    path = FRED_DIR / f"{series_id}.parquet"
    if not path.exists():
        return None
    try:
        frame = pd.read_parquet(path)
    except Exception:
        return None
    if frame.empty:
        return None
    frame = frame.reset_index()
    lowered = {str(col).lower(): col for col in frame.columns}
    date_column = (
        lowered.get("date")
        or lowered.get("observation_date")
        or lowered.get("timestamp")
        or lowered.get("index")
        or frame.columns[0]
    )
    value_column = lowered.get("value") or lowered.get(series_id.lower())
    value_candidates = [col for col in frame.columns if col != date_column]
    if not value_candidates:
        return None
    if value_column is None:
        numeric_candidates = [
            col
            for col in value_candidates
            if pd.to_numeric(frame[col], errors="coerce").notna().sum() > 0
        ]
        if not numeric_candidates:
            return None
        value_column = numeric_candidates[-1]
    frame = frame[[date_column, value_column]].copy()
    frame[date_column] = pd.to_datetime(frame[date_column], errors="coerce")
    frame[value_column] = pd.to_numeric(frame[value_column], errors="coerce")
    frame = frame.dropna().sort_values(date_column)
    if percent_yoy:
        frame[value_column] = frame[value_column].pct_change(12) * 100
        frame = frame.dropna()
    if frame.empty:
        return None
    latest = frame.iloc[-1]
    previous = frame.iloc[-2] if len(frame) > 1 else latest
    return {
        "asOf": latest[date_column].date().isoformat(),
        "value": round(float(latest[value_column]), 2),
        "previousDate": previous[date_column].date().isoformat(),
        "previous": round(float(previous[value_column]), 2),
        "change": round(float(latest[value_column] - previous[value_column]), 2),
    }


def risk_for_indicator(series_id: str, value: float | None, change: float | None) -> tuple[str, str, int, str]:
    value = value or 0
    change = change or 0
    if series_id == "VIXCLS":
        if value >= 28:
            return "watch", "高", 3, "波动率偏高，高热度线索和重波动标的都需要谨慎。"
        if value >= 18:
            return "neutral", "中", 1, "波动率不算低，高波动线索需要更多确认。"
        return "positive", "低", 0, "波动率较低，市场情绪相对稳定。"
    if series_id == "DGS10":
        if value >= 4.8 or change >= 0.15:
            return "watch", "高", 2, "长端利率偏高，成长股估值容易承压。"
        if value >= 4.2:
            return "neutral", "中", 1, "长端利率需要观察，但还不是极端压力。"
        return "positive", "低", 0, "长端利率压力相对温和。"
    if series_id == "DGS2":
        if value >= 4.8:
            return "watch", "高", 2, "短端利率偏高，市场对政策环境会更敏感。"
        if value >= 4.2:
            return "neutral", "中", 1, "短端利率仍需观察。"
        return "positive", "低", 0, "短端利率压力相对可控。"
    if series_id == "T10Y2Y":
        if value < -0.4:
            return "watch", "高", 2, "收益率曲线明显倒挂，经济预期偏谨慎。"
        if value < 0:
            return "neutral", "中", 1, "收益率曲线略有倒挂，需要观察。"
        return "positive", "低", 0, "收益率曲线没有明显倒挂压力。"
    if series_id == "CPIAUCSL":
        if value >= 3.2:
            return "watch", "高", 2, "通胀仍偏高，利率敏感资产要谨慎。"
        if value >= 2.5:
            return "neutral", "中", 1, "通胀仍需观察。"
        return "positive", "低", 0, "通胀压力相对温和。"
    if series_id == "DGS30":
        if value >= 5 or change >= 0.15:
            return "watch", "高", 2, "30年期利率偏高，长久期资产和高估值股票更容易承压。"
        if value >= 4.5:
            return "neutral", "中", 1, "长期利率仍在高位，需要观察估值压力。"
        return "positive", "低", 0, "长期利率压力相对温和。"
    if series_id == "DTWEXBGS":
        if value >= 120 or change >= 0.7:
            return "watch", "高", 2, "美元偏强，海外收入和大宗商品相关资产需要观察。"
        if value >= 116:
            return "neutral", "中", 1, "美元处在偏强区间，风险偏好需要观察。"
        return "positive", "低", 0, "美元压力相对温和。"
    if series_id in {"DCOILWTICO", "DCOILBRENTEU"}:
        if value >= 105 or change >= 3:
            return "watch", "高", 2, "油价偏高，通胀和成本压力可能回升。"
        if value >= 90:
            return "neutral", "中", 1, "油价处在偏高区间，能源和通胀线索需要观察。"
        return "positive", "低", 0, "油价压力相对温和。"
    if series_id == "UNRATE":
        if value >= 5:
            return "watch", "高", 2, "失业率偏高，经济压力可能上升。"
        if value >= 4.3:
            return "neutral", "中", 1, "就业数据需要观察。"
        return "positive", "低", 0, "就业数据仍较稳定。"
    if series_id == "BAMLH0A0HYM2":
        if value >= 4.5:
            return "watch", "高", 3, "信用利差走阔，风险资产容易承压。"
        if value >= 3.4:
            return "neutral", "中", 1, "信用风险需要观察。"
        return "positive", "低", 0, "信用市场暂时稳定。"
    return "neutral", "中", 1, "这个指标用于辅助判断市场风险偏好。"


def market_temperature_v2_score(
    risks: dict[str, float | int | None],
    trends: dict[str, bool | None],
) -> tuple[int, str] | None:
    def values(*keys: str) -> list[float]:
        return [
            number
            for key in keys
            if (number := clean_number(risks.get(key))) is not None
        ]

    def mean(*keys: str) -> float | None:
        available = values(*keys)
        return sum(available) / len(available) if available else None

    stress_values = values("VIXCLS", "BAMLH0A0HYM2")
    oil_values = values("DCOILWTICO", "DCOILBRENTEU")
    cpi = clean_number(risks.get("CPIAUCSL"))
    stress = max(stress_values) / 3 if stress_values else None
    rates = mean("DGS10", "DGS30", "DGS2")
    oil = max(oil_values) / 2 if oil_values else None
    inflation_values = [
        value
        for value in (
            cpi / 2 if cpi is not None else None,
            oil,
        )
        if value is not None
    ]
    growth = mean("T10Y2Y", "UNRATE")
    dollar = clean_number(risks.get("DTWEXBGS"))
    required_trends = ("spy_above_50", "spy_above_200", "qqq_above_50", "qqq_above_200")
    if (
        stress is None
        or rates is None
        or not inflation_values
        or growth is None
        or dollar is None
        or any(trends.get(key) is None for key in required_trends)
    ):
        return None

    macro_risk = (
        stress * 0.35
        + (rates / 2) * 0.20
        + (sum(inflation_values) / len(inflation_values)) * 0.15
        + (growth / 2) * 0.15
        + (dollar / 2) * 0.15
    )
    trend_penalty = sum(
        penalty
        for key, penalty in (
            ("spy_above_50", 12),
            ("spy_above_200", 15),
            ("qqq_above_50", 8),
            ("qqq_above_200", 10),
        )
        if not trends[key]
    )
    score = 100 - trend_penalty - macro_risk * 30
    if max(stress_values) >= 3 and not trends["spy_above_50"]:
        score = min(score, 49)
    score = round(max(0, min(100, score)))
    return score, "偏强" if score >= 70 else "中性" if score >= 50 else "防守"


def latest_benchmark_trends() -> dict[str, bool | None]:
    current_year = datetime.now(timezone.utc).year
    prices = load_daily_prices_range(current_year - 1, current_year, ["SPY", "QQQ"])
    unavailable: dict[str, bool | None] = {
        f"{symbol.lower()}_above_{window}": None
        for symbol in ("SPY", "QQQ")
        for window in (50, 200)
    }
    if not {"symbol", "trade_date", "adj_close"}.issubset(prices.columns):
        return unavailable
    trends: dict[str, bool | None] = {}
    latest_dates: set[date] = set()
    for symbol in ("SPY", "QQQ"):
        rows = prices.loc[prices["symbol"] == symbol, ["trade_date", "adj_close"]].copy()
        rows["trade_date"] = pd.to_datetime(rows["trade_date"], errors="coerce")
        rows["adj_close"] = pd.to_numeric(rows["adj_close"], errors="coerce")
        rows = rows.dropna().sort_values("trade_date")
        if len(rows) < 200:
            return unavailable
        closes = rows["adj_close"]
        latest_dates.add(rows["trade_date"].iloc[-1].date())
        for window in (50, 200):
            trends[f"{symbol.lower()}_above_{window}"] = bool(
                closes.iloc[-1] > closes.iloc[-window:].mean()
            )
    if len(latest_dates) != 1:
        return unavailable
    age_days = (datetime.now(timezone.utc).date() - latest_dates.pop()).days
    return trends if 0 <= age_days <= 7 else unavailable


def build_market_temperature() -> dict[str, Any]:
    configs = [
        ("VIXCLS", "VIX 波动率", "波动率", "%", False, "市场波动"),
        ("DGS10", "10Y 美债收益率", "利率", "%", False, "成长股估值"),
        ("DGS30", "30Y 美债收益率", "利率", "%", False, "长期利率压力"),
        ("DGS2", "2Y 美债收益率", "利率", "%", False, "政策预期"),
        ("T10Y2Y", "10Y-2Y 利差", "利差", "%", False, "经济预期"),
        ("FEDFUNDS", "联邦基金利率", "政策利率", "%", False, "政策利率"),
        ("CPIAUCSL", "CPI 同比", "通胀", "%", True, "降息预期"),
        ("DTWEXBGS", "美元指数", "美元", "", False, "全球资金偏好"),
        ("DCOILWTICO", "WTI 原油", "原油", "美元", False, "通胀与能源成本"),
        ("DCOILBRENTEU", "Brent 原油", "原油", "美元", False, "通胀与能源成本"),
        ("UNRATE", "失业率", "就业", "%", False, "经济压力"),
        ("BAMLH0A0HYM2", "高收益债利差", "信用", "%", False, "信用风险"),
    ]
    indicators: list[dict[str, Any]] = []
    risks: dict[str, int] = {}
    as_of_values: list[str] = []
    for series_id, name, category, unit, percent_yoy, impact in configs:
        item = read_fred_series(series_id, percent_yoy=percent_yoy)
        if not item:
            indicators.append({
                "key": series_id.lower(),
                "name": name,
                "category": category,
                "impact": impact,
                "value": "暂不可用",
                "previous": "--",
                "change": "--",
                "status": "neutral",
                "level": "待更新",
                "explain": "这个数据源暂时无法读取，先不纳入综合判断。",
            })
            continue
        status, level, risk_score, explain = risk_for_indicator(series_id, item["value"], item["change"])
        risks[series_id] = risk_score
        as_of_values.append(item["asOf"])
        value_label = f"{item['value']}{unit}" if unit != "美元" else f"${item['value']}"
        previous_label = f"{item['previous']}{unit}" if unit != "美元" else f"${item['previous']}"
        change_label = f"{item['change']:+.2f}{unit}" if unit != "美元" else f"{'+' if item['change'] >= 0 else '-'}${abs(item['change']):.2f}"
        indicators.append({
            "key": series_id.lower(),
            "name": name,
            "category": category,
            "impact": impact,
            "asOf": item["asOf"],
            "value": value_label,
            "previous": previous_label,
            "change": change_label,
            "status": status,
            "level": level,
            "explain": explain,
        })
    v2 = market_temperature_v2_score(risks, latest_benchmark_trends())
    if v2:
        score, label = v2
    else:
        score, label = None, "待更新"
    if label == "偏强":
        action = "优先观察强势股和机构共振线索"
    elif label == "中性":
        action = "保持观察，等价格确认"
    else:
        action = "等待市场价格更新" if label == "待更新" else "降低观察频率，少看高热度线索"
    return {
        "generatedAt": now_iso(),
        "asOf": max(as_of_values) if as_of_values else "",
        "overall": {
            "label": label,
            "score": score,
            "action": action,
            "summary": "当前宏观环境用于决定复盘强度，再从事件观察、强弱榜里挑具体股票。",
        },
        "indicators": indicators,
    }


def event_reason(row: pd.Series, label: str) -> str:
    insight = first_value(row, "insight", "latest_reason")
    ticker = first_value(row, "ticker") or "该股"
    if label == "分析师正面":
        firm = first_value(row, "firm", "latest_firm") or "机构"
        action = first_value(row, "rating_action") or "给出更积极观点"
        rating = first_value(row, "rating")
        target = clean_number(first_value(row, "price_target"))
        upside = pct_value(first_value(row, "price_target_upside"))
        parts = [f"{firm} 对 {ticker} 的观点转为更积极"]
        if rating:
            parts.append(f"评级为 {str(rating).upper()}")
        if target is not None:
            parts.append(f"目标价约 ${target:.2f}")
        if upside is not None:
            parts.append(f"相对当前价约有 {upside:.1f}% 空间")
        return "；".join(parts) + "。先看价格和成交额是否同步确认。"
    if isinstance(insight, str) and insight.strip() and insight.strip().lower() != "nan":
        text = insight.strip().replace("\n", " ")
        return text[:180] + ("..." if len(text) > 180 else "")
    if label == "指引上修":
        eps = pct_value(first_value(row, "eps_revision_pct"))
        rev = pct_value(first_value(row, "revenue_revision_pct"))
        parts = []
        if eps is not None:
            parts.append(f"每股收益预期上修约 {eps:.1f}%")
        if rev is not None:
            parts.append(f"收入预期上修约 {rev:.1f}%")
        return "；".join(parts) or "公司上调未来预期，说明经营层面对后续更有信心。"
    if label == "财报超预期":
        eps = pct_value(first_value(row, "eps_surprise_percent"))
        rev = pct_value(first_value(row, "revenue_surprise_percent"))
        parts = []
        if eps is not None:
            parts.append(f"每股收益超预期约 {eps:.1f}%")
        if rev is not None:
            parts.append(f"收入超预期约 {rev:.1f}%")
        return "；".join(parts) or "近期财报好于市场预期，适合观察后续是否延续。"
    days = first_value(row, "days_to_cover")
    short_change = pct_value(first_value(row, "short_interest_change_pct"))
    if days is not None:
        return f"空头回补天数约 {days} 天，若价格转强，波动可能放大。"
    if short_change is not None:
        return f"空头比例近期变化约 {short_change:.1f}%，需要同时观察成交额和价格强度。"
    return "空头压力较高，若价格继续走强，可能出现更大的波动。"


def event_risk(row: pd.Series, label: str) -> str:
    return20 = pct_value(first_value(row, "return_20d_x", "return_20d_y", "return_20d"))
    liquidity = clean_number(first_value(row, "median_dollar_volume_20d"))
    if label == "空头挤压":
        return "波动可能很大，需要更严格的价格和成交额确认，不能把挤压当成基本面改善。"
    if return20 is not None and return20 >= 60:
        return "短期涨幅很大，高热度风险偏高。"
    if liquidity is not None and liquidity < 5_000_000:
        return "流动性偏低，容易出现大幅波动。"
    return "仍需看估值、大盘环境和事件后的价格确认。"


def normalize_event_rows(frame: pd.DataFrame, label: str, event_type: str, limit: int = 100) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    rows: list[dict[str, Any]] = []
    frame = frame.dropna(subset=["ticker"]).head(limit)
    for index, row in frame.iterrows():
        ticker = str(first_value(row, "ticker") or "").strip().upper()
        if not ticker:
            continue
        rows.append({
            "rank": len(rows) + 1,
            "ticker": ticker,
            "companyName": first_value(row, "company_name", "name") or ticker,
            "eventDate": str(first_value(row, "event_date", "last_event_date", "trade_date_x", "trade_date") or "")[:10],
            "eventType": event_type,
            "eventLabel": label,
            "reason": event_reason(row, label),
            "risk": event_risk(row, label),
            "close": clean_number(first_value(row, "close", "adj_close")),
            "return20dPct": pct_value(first_value(row, "return_20d_x", "return_20d_y", "return_20d")),
            "fwd5dPct": pct_value(first_value(row, "fwd_5d")),
            "fwd20dPct": pct_value(first_value(row, "fwd_20d")),
            "fwd60dPct": pct_value(first_value(row, "fwd_60d")),
            "signalScore": clean_number(first_value(row, "signal_score", "analyst_heat_score")),
            "liquidity": money_compact(first_value(row, "median_dollar_volume_20d", "avg_daily_volume")),
            "priceTargetUpsidePct": pct_value(first_value(row, "price_target_upside", "avg_price_target_upside")),
            "shortInterest": clean_number(first_value(row, "short_interest")),
            "daysToCover": clean_number(first_value(row, "days_to_cover")),
        })
    return rows


def build_event_opportunities() -> dict[str, Any]:
    base = REPORTS / "monetizable_signals"
    board_specs = {
        "analyst_positive": ("analyst_positive_top.csv", "机构观点变化", "机构观点变化", "analyst_positive", "机构观点、评级或目标价更积极，先看价格是否同步确认。"),
        "guidance_up": ("guidance_up_top.csv", "预期改善观察", "预期改善", "guidance_up", "公司主动上调未来预期，说明经营层面对后续更有信心，但仍需价格和成交确认。"),
        "earnings_beat": ("earnings_beat_top.csv", "财报超预期观察", "财报超预期", "earnings_beat", "业绩好于市场预期后，观察资金是否继续确认。"),
        "short_squeeze": ("short_squeeze_candidates.csv", "空头压力变化", "空头压力变化", "short_squeeze", "空头压力较高且价格开始转强，波动会更大，确认条件要更严格。"),
    }
    boards: dict[str, Any] = {}
    as_of_candidates: list[str] = []
    for key, (filename, title, label, event_type, subtitle) in board_specs.items():
        rows = normalize_event_rows(read_csv(base / filename), label, event_type)
        as_of_candidates.extend([row["eventDate"] for row in rows if row.get("eventDate")])
        boards[key] = {"title": title, "subtitle": subtitle, "rows": rows}

    stats_frame = read_csv(base / "event_signal_forward_stats.csv")
    forward_stats: list[dict[str, Any]] = []
    if not stats_frame.empty:
        for _, row in stats_frame.iterrows():
            forward_stats.append({
                "eventFamily": first_value(row, "event_family"),
                "signal": first_value(row, "signal"),
                "horizon": first_value(row, "horizon"),
                "count": int(first_value(row, "count") or 0),
                "meanPct": pct_value(first_value(row, "mean")),
                "medianPct": pct_value(first_value(row, "median")),
                "winRatePct": pct_value(first_value(row, "win_rate")),
                "p25Pct": pct_value(first_value(row, "p25")),
                "p75Pct": pct_value(first_value(row, "p75")),
            })
    return {
        "generatedAt": now_iso(),
        "asOf": max(as_of_candidates) if as_of_candidates else "",
        "boards": boards,
        "forwardStats": forward_stats,
    }


def validation_stat(frame: pd.DataFrame, column: str) -> dict[str, Any] | None:
    if column not in frame:
        return None
    series = pd.to_numeric(frame[column], errors="coerce").dropna()
    if series.empty:
        return None
    return {
        "count": int(series.count()),
        "meanPct": round(float(series.mean() * 100), 2),
        "trimmedMeanPct": round(float(series.clip(series.quantile(0.05), series.quantile(0.95)).mean() * 100), 2),
        "medianPct": round(float(series.median() * 100), 2),
        "winRatePct": round(float((series > 0).mean() * 100), 2),
        "p25Pct": round(float(series.quantile(0.25) * 100), 2),
        "p75Pct": round(float(series.quantile(0.75) * 100), 2),
    }


def load_daily_prices(year: int, symbols: list[str]) -> pd.DataFrame:
    path = DAILY_DIR / f"daily_split_adjusted_{year}.parquet"
    if not path.exists():
        return pd.DataFrame()
    try:
        frame = pd.read_parquet(path, columns=["symbol", "trade_date", "adj_close"])
    except Exception:
        return pd.DataFrame()
    frame = frame[frame["symbol"].isin(symbols)].copy()
    if frame.empty:
        return frame
    frame["trade_date"] = pd.to_datetime(frame["trade_date"], errors="coerce")
    frame["adj_close"] = pd.to_numeric(frame["adj_close"], errors="coerce")
    return frame.dropna().sort_values(["symbol", "trade_date"])


def load_daily_prices_range(start_year: int, end_year: int, symbols: list[str]) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for year in range(start_year, end_year + 1):
        frame = load_daily_prices(year, symbols)
        if not frame.empty:
            frames.append(frame)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True).drop_duplicates(["symbol", "trade_date"]).sort_values(["symbol", "trade_date"])


def indexed_price_series(frame: pd.DataFrame, symbol: str) -> pd.DataFrame:
    data = frame[frame["symbol"] == symbol][["trade_date", "adj_close"]].copy()
    return data.dropna().sort_values("trade_date").reset_index(drop=True)


def forward_return_from_series(series: pd.DataFrame, event_date: Any, horizon: int) -> float | None:
    if series.empty:
        return None
    date = pd.to_datetime(event_date, errors="coerce")
    if pd.isna(date):
        return None
    starts = series.index[series["trade_date"] >= date].tolist()
    if not starts:
        return None
    start_index = starts[0]
    end_index = start_index + horizon
    if end_index >= len(series):
        return None
    start_price = clean_number(series.loc[start_index, "adj_close"])
    end_price = clean_number(series.loc[end_index, "adj_close"])
    if not start_price or end_price is None:
        return None
    return (end_price / start_price) - 1


def benchmark_return_lookup(series: pd.DataFrame, horizon: int) -> dict[pd.Timestamp, float]:
    if series.empty or len(series) <= horizon:
        return {}
    data = series.reset_index(drop=True)
    lookup: dict[pd.Timestamp, float] = {}
    for index in range(0, len(data) - horizon):
        start_price = clean_number(data.loc[index, "adj_close"])
        end_price = clean_number(data.loc[index + horizon, "adj_close"])
        if not start_price or end_price is None:
            continue
        lookup[pd.Timestamp(data.loc[index, "trade_date"]).normalize()] = (end_price / start_price) - 1
    return lookup


def add_benchmark_returns_by_date(frame: pd.DataFrame, benchmark_prices: pd.DataFrame) -> pd.DataFrame:
    if frame.empty or benchmark_prices.empty:
        return frame
    out = frame.copy()
    date_source = "trade_date" if "trade_date" in out else "event_date"
    out["_validation_trade_date"] = pd.to_datetime(out[date_source], errors="coerce").dt.normalize()
    spy = indexed_price_series(benchmark_prices, "SPY")
    qqq = indexed_price_series(benchmark_prices, "QQQ")
    for horizon, days in [("5d", 5), ("20d", 20), ("60d", 60)]:
        stock_col = f"fwd_{days}d"
        spy_lookup = benchmark_return_lookup(spy, days)
        qqq_lookup = benchmark_return_lookup(qqq, days)
        out[f"spy_{horizon}"] = out["_validation_trade_date"].map(spy_lookup)
        out[f"qqq_{horizon}"] = out["_validation_trade_date"].map(qqq_lookup)
        if stock_col in out:
            stock = pd.to_numeric(out[stock_col], errors="coerce")
            out[f"excess_spy_{horizon}"] = stock - pd.to_numeric(out[f"spy_{horizon}"], errors="coerce")
            out[f"excess_qqq_{horizon}"] = stock - pd.to_numeric(out[f"qqq_{horizon}"], errors="coerce")
    return out


def benchmark_enriched_frame(frame: pd.DataFrame, benchmark_prices: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return frame
    out = frame.copy()
    spy = indexed_price_series(benchmark_prices, "SPY")
    qqq = indexed_price_series(benchmark_prices, "QQQ")
    for horizon, days in [("5d", 5), ("20d", 20), ("60d", 60)]:
        stock_col = f"fwd_{days}d"
        out[f"spy_{horizon}"] = out["event_date"].map(lambda value: forward_return_from_series(spy, value, days))
        out[f"qqq_{horizon}"] = out["event_date"].map(lambda value: forward_return_from_series(qqq, value, days))
        if stock_col in out:
            stock = pd.to_numeric(out[stock_col], errors="coerce")
            out[f"excess_spy_{horizon}"] = stock - pd.to_numeric(out[f"spy_{horizon}"], errors="coerce")
            out[f"excess_qqq_{horizon}"] = stock - pd.to_numeric(out[f"qqq_{horizon}"], errors="coerce")
    return out


def excess_stat(frame: pd.DataFrame, excess_col: str) -> dict[str, Any] | None:
    if excess_col not in frame:
        return None
    series = pd.to_numeric(frame[excess_col], errors="coerce").dropna()
    if series.empty:
        return None
    return {
        "count": int(series.count()),
        "meanExcessPct": round(float(series.mean() * 100), 2),
        "medianExcessPct": round(float(series.median() * 100), 2),
        "beatRatePct": round(float((series > 0).mean() * 100), 2),
    }


def load_fred_lookup(series_id: str) -> pd.DataFrame:
    path = FRED_DIR / f"{series_id}.parquet"
    if not path.exists():
        return pd.DataFrame()
    try:
        frame = pd.read_parquet(path)
    except Exception:
        return pd.DataFrame()
    if frame.empty or "date" not in frame or "value" not in frame:
        return pd.DataFrame()
    frame = frame[["date", "value"]].copy()
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame["value"] = pd.to_numeric(frame["value"], errors="coerce")
    return frame.dropna().sort_values("date").reset_index(drop=True)


def value_on_or_before(frame: pd.DataFrame, event_date: Any) -> float | None:
    if frame.empty:
        return None
    date = pd.to_datetime(event_date, errors="coerce")
    if pd.isna(date):
        return None
    matches = frame[frame["date"] <= date]
    if matches.empty:
        return None
    return clean_number(matches.iloc[-1]["value"])


def market_regime_for_date(event_date: Any, fred: dict[str, pd.DataFrame]) -> str:
    vix = value_on_or_before(fred.get("VIXCLS", pd.DataFrame()), event_date)
    dgs10 = value_on_or_before(fred.get("DGS10", pd.DataFrame()), event_date)
    credit = value_on_or_before(fred.get("BAMLH0A0HYM2", pd.DataFrame()), event_date)
    risk = 0
    if vix is not None:
        risk += 2 if vix >= 22 else 1 if vix >= 18 else 0
    if dgs10 is not None:
        risk += 2 if dgs10 >= 4.8 else 1 if dgs10 >= 4.2 else 0
    if credit is not None:
        risk += 2 if credit >= 4.5 else 1 if credit >= 3.4 else 0
    if risk <= 1:
        return "偏强"
    if risk <= 3:
        return "中性"
    return "防守"


def load_historical_event_signals(signal_labels: dict[str, str]) -> pd.DataFrame:
    if not EVENT_SIGNALS_PATH.exists():
        return pd.DataFrame()
    columns = [
        "ticker",
        "event_date",
        "trade_date",
        "signal",
        "signal_score",
        "fwd_5d",
        "fwd_20d",
        "fwd_60d",
    ]
    try:
        frame = pd.read_parquet(EVENT_SIGNALS_PATH, columns=columns)
    except Exception:
        return pd.DataFrame()
    frame = frame[frame["signal"].isin(signal_labels)].copy()
    if frame.empty:
        return frame
    frame["event_date"] = pd.to_datetime(frame["event_date"], errors="coerce")
    frame["trade_date"] = pd.to_datetime(frame["trade_date"], errors="coerce")
    frame["signal_score"] = pd.to_numeric(frame["signal_score"], errors="coerce")
    for column in ["fwd_5d", "fwd_20d", "fwd_60d"]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame.dropna(subset=["ticker", "event_date", "trade_date", "signal"])
    return frame.drop_duplicates(["ticker", "event_date", "trade_date", "signal"]).reset_index(drop=True)


def historical_validation(signal_labels: dict[str, str], fred_lookup: dict[str, pd.DataFrame]) -> dict[str, Any]:
    frame = load_historical_event_signals(signal_labels)
    if frame.empty:
        return {
            "historicalBenchmarkStats": [],
            "historicalScoreStats": [],
            "historicalTemperatureStats": [],
            "rollingBaskets": [],
            "productDecisions": [],
        }

    min_year = int(frame["trade_date"].dt.year.min())
    max_year = int(frame["trade_date"].dt.year.max())
    benchmark_prices = load_daily_prices_range(min_year, max_year, ["SPY", "QQQ"])
    frame = add_benchmark_returns_by_date(frame, benchmark_prices)
    date_values = frame["_validation_trade_date"].dropna().drop_duplicates()
    regime_map = {date: market_regime_for_date(date, fred_lookup) for date in date_values}
    frame["market_regime"] = frame["_validation_trade_date"].map(regime_map)

    historical_benchmark_stats: list[dict[str, Any]] = []
    for signal, label in signal_labels.items():
        subset = frame[frame["signal"] == signal]
        if subset.empty:
            continue
        for horizon, stock_col in [("5d", "fwd_5d"), ("20d", "fwd_20d"), ("60d", "fwd_60d")]:
            base_stat = validation_stat(subset, stock_col)
            if not base_stat:
                continue
            spy_excess = excess_stat(subset, f"excess_spy_{horizon}")
            qqq_excess = excess_stat(subset, f"excess_qqq_{horizon}")
            historical_benchmark_stats.append({
                "signal": signal,
                "label": label,
                "horizon": horizon,
                **base_stat,
                "beatSpyRatePct": spy_excess.get("beatRatePct") if spy_excess else None,
                "meanExcessSpyPct": spy_excess.get("meanExcessPct") if spy_excess else None,
                "beatQqqRatePct": qqq_excess.get("beatRatePct") if qqq_excess else None,
                "meanExcessQqqPct": qqq_excess.get("meanExcessPct") if qqq_excess else None,
            })

    historical_score_stats: list[dict[str, Any]] = []
    for signal, label in signal_labels.items():
        subset = frame[(frame["signal"] == signal) & frame["signal_score"].notna()].copy()
        if len(subset) < 100:
            continue
        quantiles = subset["signal_score"].quantile([0.33, 0.67])
        low_cut = float(quantiles.loc[0.33])
        high_cut = float(quantiles.loc[0.67])
        groups = [
            ("high", "高分组", subset[subset["signal_score"] >= high_cut]),
            ("mid", "中分组", subset[(subset["signal_score"] < high_cut) & (subset["signal_score"] >= low_cut)]),
            ("low", "低分组", subset[subset["signal_score"] < low_cut]),
        ]
        for bucket, bucket_label, group in groups:
            stat = validation_stat(group, "fwd_20d")
            if not stat:
                continue
            spy_excess = excess_stat(group, "excess_spy_20d")
            historical_score_stats.append({
                "signal": signal,
                "label": label,
                "bucket": bucket,
                "bucketLabel": bucket_label,
                "avgScore": round(float(group["signal_score"].mean()), 2),
                **stat,
                "beatSpyRatePct": spy_excess.get("beatRatePct") if spy_excess else None,
                "meanExcessSpyPct": spy_excess.get("meanExcessPct") if spy_excess else None,
            })

    historical_temperature_stats: list[dict[str, Any]] = []
    for signal, label in signal_labels.items():
        signal_frame = frame[frame["signal"] == signal]
        if signal_frame.empty:
            continue
        for regime in ["偏强", "中性", "防守"]:
            subset = signal_frame[signal_frame["market_regime"] == regime]
            if len(subset) < 100:
                continue
            stat = validation_stat(subset, "fwd_20d")
            if not stat:
                continue
            spy_excess = excess_stat(subset, "excess_spy_20d")
            historical_temperature_stats.append({
                "signal": signal,
                "label": label,
                "regime": regime,
                "horizon": "20d",
                **stat,
                "beatSpyRatePct": spy_excess.get("beatRatePct") if spy_excess else None,
                "meanExcessSpyPct": spy_excess.get("meanExcessPct") if spy_excess else None,
            })

    rolling_baskets: list[dict[str, Any]] = []
    for signal, label in signal_labels.items():
        subset = frame[
            (frame["signal"] == signal)
            & frame["signal_score"].notna()
            & frame["fwd_20d"].notna()
        ].copy()
        if subset.empty:
            continue
        top = (
            subset.sort_values(["_validation_trade_date", "signal_score"], ascending=[True, False])
            .groupby("_validation_trade_date", group_keys=False)
            .head(10)
        )
        daily = (
            top.groupby("_validation_trade_date")
            .agg(
                fwd_20d=("fwd_20d", "mean"),
                excess_spy_20d=("excess_spy_20d", "mean"),
                picks=("ticker", "count"),
                avg_score=("signal_score", "mean"),
            )
            .reset_index()
        )
        if len(daily) < 20:
            continue
        base_stat = validation_stat(daily, "fwd_20d")
        spy_excess = excess_stat(daily, "excess_spy_20d")
        rolling_baskets.append({
            "signal": signal,
            "label": label,
            "horizon": "20d",
            "days": int(len(daily)),
            "avgPicks": round(float(daily["picks"].mean()), 1),
            "avgScore": round(float(daily["avg_score"].mean()), 2),
            **(base_stat or {}),
            "beatSpyRatePct": spy_excess.get("beatRatePct") if spy_excess else None,
            "meanExcessSpyPct": spy_excess.get("meanExcessPct") if spy_excess else None,
        })

    positive_signals = {"analyst_positive", "earnings_beat", "guidance_up", "squeeze_watch", "short_pressure_up"}
    twenty_day = [
        item
        for item in historical_benchmark_stats
        if item["horizon"] == "20d" and item["signal"] in positive_signals
    ]
    product_decisions: list[dict[str, Any]] = []
    for item in sorted(twenty_day, key=lambda row: (row.get("beatSpyRatePct") or 0, row.get("winRatePct") or 0), reverse=True):
        beat_spy = item.get("beatSpyRatePct") or 0
        win_rate = item.get("winRatePct") or 0
        median = item.get("medianPct") or 0
        if beat_spy >= 52 and win_rate >= 54 and median > 0:
            status = "重点观察"
            note = "历史样本同时满足正向占比、相对指数表现和中位数为正，适合放到前台重点解释。"
        elif beat_spy >= 49 and win_rate >= 51:
            status = "辅助参考"
            note = "有一定参考价值，但还需要叠加市场环境、流动性或价格确认。"
        else:
            status = "只作背景"
            note = "单独看没有稳定优势，前台不要包装成强结论。"
        product_decisions.append({
            "signal": item["signal"],
            "label": item["label"],
            "status": status,
            "note": note,
            "winRatePct": item.get("winRatePct"),
            "beatSpyRatePct": item.get("beatSpyRatePct"),
            "medianPct": item.get("medianPct"),
            "trimmedMeanPct": item.get("trimmedMeanPct"),
            "count": item.get("count"),
        })

    return {
        "historicalBenchmarkStats": historical_benchmark_stats,
        "historicalScoreStats": historical_score_stats,
        "historicalTemperatureStats": historical_temperature_stats,
        "rollingBaskets": sorted(rolling_baskets, key=lambda row: (row.get("beatSpyRatePct") or 0, row.get("winRatePct") or 0), reverse=True),
        "productDecisions": product_decisions,
        "historicalSample": {
            "rows": int(len(frame)),
            "start": frame["event_date"].min().date().isoformat(),
            "end": frame["event_date"].max().date().isoformat(),
            "symbols": int(frame["ticker"].nunique()),
        },
    }


def build_validation_center(events: dict[str, Any]) -> dict[str, Any]:
    signal_labels = {
        "analyst_positive": "分析师正面",
        "analyst_negative": "分析师负面",
        "guidance_up": "指引上修",
        "guidance_down": "指引下修",
        "earnings_beat": "财报超预期",
        "earnings_miss": "财报不及预期",
        "squeeze_watch": "空头挤压",
        "short_pressure_up": "空头压力上升",
    }
    event_type_stats: list[dict[str, Any]] = []
    for item in events.get("forwardStats", []):
        signal = item.get("signal")
        if signal not in signal_labels:
            continue
        event_type_stats.append({
            "signal": signal,
            "label": signal_labels[signal],
            "horizon": item.get("horizon"),
            "count": item.get("count"),
            "meanPct": item.get("meanPct"),
            "medianPct": item.get("medianPct"),
            "winRatePct": item.get("winRatePct"),
            "p25Pct": item.get("p25Pct"),
            "p75Pct": item.get("p75Pct"),
        })

    board_files = {
        "analyst_positive": "analyst_positive_top.csv",
        "guidance_up": "guidance_up_top.csv",
        "earnings_beat": "earnings_beat_top.csv",
        "short_squeeze": "short_squeeze_candidates.csv",
    }
    base = REPORTS / "monetizable_signals"
    benchmark_prices = load_daily_prices(2026, ["SPY", "QQQ"])
    fred_lookup = {
        "VIXCLS": load_fred_lookup("VIXCLS"),
        "DGS10": load_fred_lookup("DGS10"),
        "BAMLH0A0HYM2": load_fred_lookup("BAMLH0A0HYM2"),
    }
    history = historical_validation(signal_labels, fred_lookup)
    score_buckets: list[dict[str, Any]] = []
    current_tests: list[dict[str, Any]] = []
    benchmark_tests: list[dict[str, Any]] = []
    temperature_frames: list[pd.DataFrame] = []
    for key, filename in board_files.items():
        frame = read_csv(base / filename)
        if frame.empty or "signal_score" not in frame:
            continue
        frame = frame.copy()
        frame = benchmark_enriched_frame(frame, benchmark_prices)
        frame["market_regime"] = frame["event_date"].map(lambda value: market_regime_for_date(value, fred_lookup))
        temperature_frames.append(frame.assign(board=key))
        frame["signal_score"] = pd.to_numeric(frame["signal_score"], errors="coerce")
        frame = frame.dropna(subset=["signal_score"])
        if frame.empty:
            continue
        label = events.get("boards", {}).get(key, {}).get("title", signal_labels.get(key, key))
        quantiles = frame["signal_score"].quantile([0.33, 0.67])
        low_cut = float(quantiles.loc[0.33])
        high_cut = float(quantiles.loc[0.67])
        groups = [
            ("high", "高分组", frame[frame["signal_score"] >= high_cut]),
            ("mid", "中分组", frame[(frame["signal_score"] < high_cut) & (frame["signal_score"] >= low_cut)]),
            ("low", "低分组", frame[frame["signal_score"] < low_cut]),
        ]
        for bucket, bucket_label, subset in groups:
            stats = validation_stat(subset, "fwd_5d")
            if not stats:
                continue
            spy_excess = excess_stat(subset, "excess_spy_5d")
            qqq_excess = excess_stat(subset, "excess_qqq_5d")
            score_buckets.append({
                "board": key,
                "boardLabel": label,
                "bucket": bucket,
                "bucketLabel": bucket_label,
                "avgScore": round(float(subset["signal_score"].mean()), 2),
                "beatSpyRatePct": spy_excess.get("beatRatePct") if spy_excess else None,
                "meanExcessSpyPct": spy_excess.get("meanExcessPct") if spy_excess else None,
                "beatQqqRatePct": qqq_excess.get("beatRatePct") if qqq_excess else None,
                "meanExcessQqqPct": qqq_excess.get("meanExcessPct") if qqq_excess else None,
                **stats,
            })
        latest = frame.head(100)
        stat_5d = validation_stat(latest, "fwd_5d")
        stat_20d = validation_stat(latest, "fwd_20d")
        current_tests.append({
            "board": key,
            "boardLabel": label,
            "sampleCount": int(len(latest)),
            "fiveDay": stat_5d,
            "twentyDay": stat_20d,
        })
        for horizon in ["5d", "20d", "60d"]:
            spy_excess = excess_stat(latest, f"excess_spy_{horizon}")
            qqq_excess = excess_stat(latest, f"excess_qqq_{horizon}")
            if not spy_excess and not qqq_excess:
                continue
            benchmark_tests.append({
                "board": key,
                "boardLabel": label,
                "horizon": horizon,
                "spy": spy_excess,
                "qqq": qqq_excess,
            })

    temperature_stats: list[dict[str, Any]] = []
    if temperature_frames:
        temp_all = pd.concat(temperature_frames, ignore_index=True)
        for regime in ["偏强", "中性", "防守"]:
            subset = temp_all[temp_all["market_regime"] == regime]
            if subset.empty:
                continue
            for horizon, stock_col in [("5d", "fwd_5d"), ("20d", "fwd_20d")]:
                base_stat = validation_stat(subset, stock_col)
                spy_excess = excess_stat(subset, f"excess_spy_{horizon}")
                if not base_stat:
                    continue
                temperature_stats.append({
                    "regime": regime,
                    "horizon": horizon,
                    **base_stat,
                    "beatSpyRatePct": spy_excess.get("beatRatePct") if spy_excess else None,
                    "meanExcessSpyPct": spy_excess.get("meanExcessPct") if spy_excess else None,
                })

    best_20d = sorted(
        [item for item in event_type_stats if item.get("horizon") == "20d" and item.get("winRatePct") is not None],
        key=lambda item: (item.get("winRatePct") or 0, item.get("meanPct") or 0),
        reverse=True,
    )[:3]
    usable = [item for item in best_20d if (item.get("winRatePct") or 0) >= 53]
    verdict = "值得继续观察" if usable else "仅作背景参考"
    conclusion = (
        f"{usable[0]['label']} 20日正向占比约 {usable[0]['winRatePct']}%，可以作为前台重点观察方向，但仍要结合市场温度和风险过滤。"
        if usable
        else "目前事件数据没有形成足够强的单独优势，前台应表达为研究辅助，而不是明确结论。"
    )
    primary_decision = next(
        (item for item in history.get("productDecisions", []) if item.get("status") == "重点观察"),
        None,
    )
    if primary_decision:
        conclusion = (
            f"历史样本里，{primary_decision['label']} 20日相对 SPY 更强的占比约 {primary_decision['beatSpyRatePct']}%，"
            f"正向占比约 {primary_decision['winRatePct']}%，适合优先做成前台重点观察模块。"
        )
    return {
        "generatedAt": now_iso(),
        "asOf": events.get("asOf", ""),
        "summary": {
            "verdict": verdict,
            "conclusion": conclusion,
            "bestSignals": best_20d,
            "sampleNote": "已接入事件级历史样本、SPY/QQQ 对照、分数分层和市场温度分层。",
        },
        "eventTypeStats": event_type_stats,
        "scoreBuckets": score_buckets,
        "benchmarkTests": benchmark_tests,
        "temperatureStats": temperature_stats,
        **history,
        "currentTests": current_tests,
    }


def main() -> None:
    market = build_market_temperature()
    calendar = build_events_calendar()
    events = build_event_opportunities()
    validation = build_validation_center(events)
    total_events = sum(len(board["rows"]) for board in events["boards"].values())
    print(json.dumps({
        "marketIndicators": len(market["indicators"]),
        "calendarEvents": len(calendar["events"]),
        "earningsCalendarEvents": calendar["coverage"]["earningsRows"],
        "eventRows": total_events,
        "forwardStats": len(events["forwardStats"]),
        "validationStats": len(validation["eventTypeStats"]),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()

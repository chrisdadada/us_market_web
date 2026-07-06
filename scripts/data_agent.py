#!/usr/bin/env python3
"""Clean SSD market data into website JSON and API-ready payloads."""

from __future__ import annotations

import argparse
import json
import math
import subprocess
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import pandas as pd


DEFAULT_DATA_ROOT = Path("/Volumes/Extreme SSD/market-data-lab/data")
DEFAULT_SITE_DATA_DIR = Path("data")
DEFAULT_API_DATA_DIR = Path("data/api")
CONDA_PYTHON = Path("/opt/anaconda3/bin/conda")

FRED_SERIES = {
    "VIXCLS": {"name": "VIX 波动率", "unit": "%", "category": "vix"},
    "DGS10": {"name": "10Y 美债收益率", "unit": "%", "category": "rates"},
    "DGS2": {"name": "2Y 美债收益率", "unit": "%", "category": "rates"},
    "T10Y2Y": {"name": "10Y-2Y 利差", "unit": "%", "category": "curve"},
    "FEDFUNDS": {"name": "联邦基金利率", "unit": "%", "category": "rates"},
    "CPIAUCSL": {"name": "CPI 同比", "unit": "%", "category": "inflation"},
    "UNRATE": {"name": "失业率", "unit": "%", "category": "employment"},
    "BAMLH0A0HYM2": {"name": "高收益债利差", "unit": "%", "category": "credit"},
}


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def clean_text(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    text = " ".join(str(value).split())
    return text or None


def clean_number(value: Any, digits: int | None = None) -> float | int | None:
    if value is None or pd.isna(value):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    if digits is None:
        return number
    rounded = round(number, digits)
    return int(rounded) if digits == 0 else rounded


def clean_int(value: Any) -> int | None:
    number = clean_number(value, 0)
    return None if number is None else int(number)


def pct_points(value: Any, digits: int = 2) -> float | None:
    number = clean_number(value)
    if number is None:
        return None
    return round(number * 100, digits)


def read_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path)


def first_value(row: pd.Series, *names: str) -> Any:
    for name in names:
        if name in row.index and not pd.isna(row[name]):
            return row[name]
    return None


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_site_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def read_parquet_compatible(path: Path, columns: list[str] | None = None) -> pd.DataFrame:
    try:
        return pd.read_parquet(path, columns=columns)
    except Exception:
        if not CONDA_PYTHON.exists():
            raise
        code = (
            "import json, pandas as pd, sys; "
            "cols=json.loads(sys.argv[2]) if sys.argv[2] else None; "
            "df=pd.read_parquet(sys.argv[1], columns=cols); "
            "print(df.to_json(orient='records', date_format='iso'))"
        )
        result = subprocess.run(
            [str(CONDA_PYTHON), "run", "-n", "quant", "python", "-c", code, str(path), json.dumps(columns or []) if columns else ""],
            check=True,
            capture_output=True,
            text=True,
        )
        return pd.DataFrame(json.loads(result.stdout or "[]"))


def latest_trade_date(data_root: Path) -> str:
    universe_dir = data_root / "features" / "polygon" / "universe" / "daily_tradable_universe_by_year"
    files = sorted(path for path in universe_dir.glob("universe_*.parquet") if not path.name.startswith("._"))
    if not files:
        raise FileNotFoundError(f"No universe parquet files found in {universe_dir}")
    latest = files[-1]
    df = pd.read_parquet(latest, columns=["trade_date"])
    return str(df["trade_date"].max())


def load_latest_universe(data_root: Path, as_of: str) -> pd.DataFrame:
    year = int(as_of[:4])
    path = data_root / "features" / "polygon" / "universe" / "daily_tradable_universe_by_year" / f"universe_{year}.parquet"
    if not path.exists():
        raise FileNotFoundError(f"Missing universe file: {path}")
    columns = [
        "symbol",
        "trade_date",
        "name",
        "primary_exchange",
        "type",
        "close",
        "volume",
        "dollar_volume",
        "median_dollar_volume_20d",
        "median_volume_20d",
        "return_20d",
        "is_common_or_adr",
        "tradable_core",
    ]
    df = pd.read_parquet(path, columns=[col for col in columns if col])
    df["trade_date"] = df["trade_date"].astype(str)
    latest = df[df["trade_date"].eq(as_of)].copy()
    if latest.empty:
        latest_date = str(df["trade_date"].max())
        latest = df[df["trade_date"].eq(latest_date)].copy()
    latest["name"] = latest["name"].fillna(latest["symbol"])
    return latest


def load_adjusted_daily(data_root: Path, as_of: str) -> pd.DataFrame:
    year = int(as_of[:4])
    root = data_root / "processed" / "polygon" / "stocks_split_adjusted" / "1d"
    files = [
        root / f"daily_split_adjusted_{year - 1}.parquet",
        root / f"daily_split_adjusted_{year}.parquet",
    ]
    existing = [path for path in files if path.exists()]
    if not existing:
        raise FileNotFoundError(f"No adjusted daily parquet files found in {root}")
    columns = ["symbol", "trade_date", "adj_close", "adj_volume"]
    daily = pd.concat((pd.read_parquet(path, columns=columns) for path in existing), ignore_index=True)
    daily["trade_date"] = daily["trade_date"].astype(str)
    daily = daily[daily["trade_date"] <= as_of].dropna(subset=["symbol", "trade_date", "adj_close"])
    return daily.sort_values(["trade_date", "symbol"]).reset_index(drop=True)


def build_market_leaders(data_root: Path, as_of: str, limit: int) -> dict[str, Any]:
    universe = load_latest_universe(data_root, as_of)
    daily = load_adjusted_daily(data_root, as_of)
    tradable_symbols = set(
        universe[
            universe["tradable_core"].fillna(False)
            & universe["is_common_or_adr"].fillna(False)
            & (universe["close"].fillna(0) >= 1)
        ]["symbol"]
    )
    daily = daily[daily["symbol"].isin(tradable_symbols)]
    close = daily.pivot(index="trade_date", columns="symbol", values="adj_close").ffill()
    volume = daily.pivot(index="trade_date", columns="symbol", values="adj_volume").fillna(0)
    if close.empty:
        raise ValueError("No adjusted daily rows matched the latest tradable universe.")

    current = close.iloc[-1]
    dollar_latest = current * volume.iloc[-1]
    year_panel = close.loc[[idx for idx in close.index if str(idx).startswith(as_of[:4])]]
    meta = universe.set_index("symbol")

    def period_return(periods: int) -> pd.Series:
        if len(close) <= periods:
            return pd.Series(index=current.index, dtype=float)
        previous = close.shift(periods).iloc[-1]
        return (current / previous - 1) * 100

    work = pd.DataFrame(
        {
            "symbol": current.index,
            "price": current,
            "return1d": period_return(1),
            "return5d": period_return(5),
            "return20d": period_return(20),
            "returnYtd": (year_panel.iloc[-1] / year_panel.iloc[0] - 1) * 100 if not year_panel.empty else None,
            "dollarVolume": dollar_latest,
        }
    ).dropna(subset=["price", "return20d"])
    work["name"] = work["symbol"].map(meta["name"]).fillna(work["symbol"])
    work["exchange"] = work["symbol"].map(meta["primary_exchange"]).fillna("")
    work["medianDollarVolume20d"] = work["symbol"].map(meta["median_dollar_volume_20d"])

    def rows(df: pd.DataFrame) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for rank, row in enumerate(df.itertuples(index=False), start=1):
            out.append(
                {
                    "rank": rank,
                    "symbol": row.symbol,
                    "name": clean_text(row.name),
                    "exchange": clean_text(row.exchange),
                    "price": clean_number(row.price, 2),
                    "return1dPct": clean_number(row.return1d, 2),
                    "return5dPct": clean_number(row.return5d, 2),
                    "return20dPct": clean_number(row.return20d, 2),
                    "returnYtdPct": clean_number(row.returnYtd, 2),
                    "dollarVolume": clean_number(row.dollarVolume, 2),
                    "medianDollarVolume20d": clean_number(row.medianDollarVolume20d, 2),
                }
            )
        return out

    leaders = work.sort_values("return20d", ascending=False).head(limit)
    laggards = work.sort_values("return20d", ascending=True).head(limit)
    liquidity = work.sort_values("dollarVolume", ascending=False).head(limit)
    return {
        "generatedAt": now_iso(),
        "asOf": as_of,
        "source": "Polygon adjusted daily bars + latest tradable universe",
        "boards": {
            "twentyDayLeaders": {
                "title": "20日强势榜",
                "subtitle": "已过滤退市、低价和低流动性噪音。",
                "rows": rows(leaders),
            },
            "twentyDayLaggards": {
                "title": "20日弱势榜",
                "subtitle": "用于风险回避和反向观察。",
                "rows": rows(laggards),
            },
            "liquidity": {
                "title": "成交额活跃榜",
                "subtitle": "按最新交易日成交额排序。",
                "rows": rows(liquidity),
            },
        },
    }


def risk_label(score: int) -> str:
    if score >= 3:
        return "high"
    if score == 2:
        return "elevated"
    if score == 1:
        return "watch"
    return "low"


def risk_label_cn(score: int) -> str:
    if score >= 3:
        return "高风险"
    if score == 2:
        return "偏高"
    if score == 1:
        return "观察"
    return "正常"


def value_trend(change: float | None, reverse: bool = False) -> str:
    if change is None or abs(change) < 0.01:
        return "flat"
    rising = change > 0
    if reverse:
        rising = not rising
    return "improving" if not rising else "worsening"


def fred_values(data_root: Path, series_id: str) -> pd.DataFrame:
    path = data_root / "raw" / "fred" / f"{series_id}.parquet"
    if not path.exists():
        raise FileNotFoundError(f"Missing FRED series: {path}")
    df = read_parquet_compatible(path, columns=["series_id", "date", "value"])
    df = df.dropna(subset=["value"]).copy()
    df["date"] = df["date"].astype(str)
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df.dropna(subset=["value"]).sort_values("date")


def latest_pair(df: pd.DataFrame) -> tuple[pd.Series, pd.Series | None]:
    latest = df.iloc[-1]
    previous = df.iloc[-2] if len(df) >= 2 else None
    return latest, previous


def cpi_yoy_rows(df: pd.DataFrame) -> pd.DataFrame:
    work = df.copy()
    work["yoy"] = (work["value"] / work["value"].shift(12) - 1) * 100
    return work.dropna(subset=["yoy"]).rename(columns={"value": "index_value", "yoy": "value"})


def indicator_risk(series_id: str, value: float, change: float | None) -> tuple[int, str]:
    if series_id == "VIXCLS":
        score = 3 if value >= 30 else 2 if value >= 22 else 1 if value >= 16 else 0
        if change is not None and change >= 3:
            score = min(3, score + 1)
        note = "波动率很高，市场容易急涨急跌。" if score >= 3 else "波动率偏高，高热度线索要更克制。" if score == 2 else "波动率温和，但仍要控制观察节奏。" if score == 1 else "波动率较低，市场情绪相对平稳。"
        return score, note
    if series_id == "DGS10":
        score = 3 if value >= 5.0 else 2 if value >= 4.5 else 1 if value >= 4.0 else 0
        note = "长端利率压力很高，高估值成长股承压。" if score >= 3 else "长端利率偏高，成长股估值会被压制。" if score == 2 else "长端利率需要观察，但还不是极端压力。" if score == 1 else "长端利率压力相对可控。"
        return score, note
    if series_id == "DGS2":
        score = 3 if value >= 5.0 else 2 if value >= 4.5 else 1 if value >= 4.0 else 0
        note = "短端利率很高，现金和债券吸引力强。" if score >= 3 else "短端利率偏高，市场风险偏好会受影响。" if score == 2 else "短端利率仍有压力，但不算极端。" if score == 1 else "短端利率压力相对可控。"
        return score, note
    if series_id == "T10Y2Y":
        score = 3 if value <= -0.75 else 2 if value < -0.25 else 1 if value < 0 else 0
        note = "收益率曲线明显倒挂，经济预期偏谨慎。" if score >= 3 else "收益率曲线倒挂，说明市场仍担心后续增长。" if score == 2 else "利差接近倒挂，保持观察。" if score == 1 else "收益率曲线没有明显倒挂压力。"
        return score, note
    if series_id == "FEDFUNDS":
        score = 3 if value >= 5.25 else 2 if value >= 4.5 else 1 if value >= 4.0 else 0
        note = "政策利率很高，流动性环境偏紧。" if score >= 3 else "政策利率偏高，市场不容易全面扩张。" if score == 2 else "政策利率仍有约束。" if score == 1 else "政策利率压力相对下降。"
        return score, note
    if series_id == "CPIAUCSL":
        score = 3 if value >= 5.0 else 2 if value >= 4.0 else 1 if value >= 3.0 else 0
        if change is not None and change >= 0.3:
            score = min(3, score + 1)
        note = "通胀明显偏高，降息空间会被压缩。" if score >= 3 else "通胀仍偏高，利率敏感资产要谨慎。" if score == 2 else "通胀略高于舒适区，继续观察。" if score == 1 else "通胀压力相对温和。"
        return score, note
    if series_id == "UNRATE":
        score = 3 if value >= 5.5 else 2 if value >= 5.0 else 1 if value >= 4.5 else 0
        if change is not None and change >= 0.3:
            score = min(3, score + 1)
        note = "失业率明显上行，经济压力加大。" if score >= 3 else "就业开始变弱，需要降低周期股乐观度。" if score == 2 else "就业有走弱迹象，保持观察。" if score == 1 else "就业数据仍较稳定。"
        return score, note
    if series_id == "BAMLH0A0HYM2":
        score = 3 if value >= 7.0 else 2 if value >= 5.0 else 1 if value >= 4.0 else 0
        if change is not None and change >= 0.4:
            score = min(3, score + 1)
        note = "信用利差很高，市场在定价违约和融资压力。" if score >= 3 else "信用风险偏高，低质量股票要少碰。" if score == 2 else "信用利差略有压力，注意风险偏好变化。" if score == 1 else "信用市场暂时稳定。"
        return score, note
    return 0, "指标处于正常观察区间。"


def build_indicator(data_root: Path, series_id: str) -> dict[str, Any]:
    raw = fred_values(data_root, series_id)
    df = cpi_yoy_rows(raw) if series_id == "CPIAUCSL" else raw
    latest, previous = latest_pair(df)
    latest_value = float(latest["value"])
    previous_value = None if previous is None else float(previous["value"])
    change = None if previous_value is None else latest_value - previous_value
    score, explanation = indicator_risk(series_id, latest_value, change)
    config = FRED_SERIES[series_id]
    return {
        "id": series_id,
        "name": config["name"],
        "category": config["category"],
        "unit": config["unit"],
        "asOf": clean_text(latest["date"]),
        "latestValue": clean_number(latest_value, 2),
        "previousDate": None if previous is None else clean_text(previous["date"]),
        "previousValue": clean_number(previous_value, 2),
        "change": clean_number(change, 2),
        "riskLevel": risk_label(score),
        "riskLabel": risk_label_cn(score),
        "riskScore": score,
        "trend": value_trend(change),
        "explanation": explanation,
    }


def combine_risk(indicators: list[dict[str, Any]], categories: set[str]) -> float:
    scores = [item["riskScore"] for item in indicators if item["category"] in categories]
    return sum(scores) / len(scores) if scores else 0.0


def status_from_score(score: float) -> tuple[str, str]:
    if score >= 62:
        return "defensive", "防守"
    if score >= 38:
        return "neutral", "中性"
    return "offensive", "进攻"


def position_from_score(score: float) -> tuple[str, str]:
    if score >= 72:
        return "light", "轻仓"
    if score >= 55:
        return "conservative", "保守"
    if score >= 32:
        return "normal", "正常"
    return "active", "积极"


def build_plain_explanation(status: str, pressure: dict[str, dict[str, Any]]) -> str:
    hot = [item["label"] for item in pressure.values() if item["riskScore"] >= 2]
    if status == "defensive":
        reason = "、".join(hot[:3]) or "多项宏观风险"
        return f"现在更适合先保护本金，因为{reason}偏高。可以看强势股，但不要把短线大涨当成提高优先级的唯一理由。"
    if status == "neutral":
        reason = "、".join(hot[:2]) or "宏观信号没有完全同向"
        return f"现在不是全面进攻也不是完全防守，原因是{reason}仍要观察。普通投资者适合只挑基本面和价格都强的股票。"
    return "当前宏观压力相对可控，可以关注强势股和机构共振线索，但仍要避开没有流动性、只靠题材上涨的股票。"


def build_market_temperature(data_root: Path) -> dict[str, Any]:
    indicators = [build_indicator(data_root, series_id) for series_id in FRED_SERIES]
    pressure = {
        "vix": {"label": "VIX 风险温度", "riskScore": combine_risk(indicators, {"vix"})},
        "rates": {"label": "利率压力", "riskScore": combine_risk(indicators, {"rates", "curve"})},
        "credit": {"label": "信用风险", "riskScore": combine_risk(indicators, {"credit"})},
        "inflation": {"label": "通胀压力", "riskScore": combine_risk(indicators, {"inflation"})},
        "employment": {"label": "就业压力", "riskScore": combine_risk(indicators, {"employment"})},
    }
    for item in pressure.values():
        rounded = int(round(item["riskScore"]))
        item["riskLevel"] = risk_label(rounded)
        item["riskLabel"] = risk_label_cn(rounded)
    weighted_score = (
        pressure["vix"]["riskScore"] * 0.25
        + pressure["rates"]["riskScore"] * 0.25
        + pressure["credit"]["riskScore"] * 0.20
        + pressure["inflation"]["riskScore"] * 0.15
        + pressure["employment"]["riskScore"] * 0.15
    ) / 3 * 100
    status_key, status = status_from_score(weighted_score)
    position_key, position = position_from_score(weighted_score)
    return {
        "generatedAt": now_iso(),
        "source": "FRED parquet files on external SSD",
        "status": {
            "key": status_key,
            "label": status,
            "score": clean_number(weighted_score, 1),
            "positionKey": position_key,
            "positionAdvice": position,
            "plainExplanation": build_plain_explanation(status_key, pressure),
        },
        "pressure": pressure,
        "indicators": indicators,
    }


def quality_angle(value: Any) -> str:
    text = clean_text(value) or ""
    if "指引" in text and "财报" not in text:
        return "指引改善"
    if "分析师" in text:
        return "业绩 + 机构共振"
    if "财报" in text:
        return "财报后走强"
    return text or "财报线索"


def quality_reason(value: Any) -> str:
    text = clean_text(value) or ""
    return (
        text.replace("指引上修", "公司上调未来业绩预期")
        .replace("财报超预期", "实际财报好于市场预期")
        .replace("20日趋势向上", "近20个交易日股价上涨")
        .replace("分析师关注度高，近30日热度", "近30天分析师关注度高，热度")
    )


def quality_rows(df: pd.DataFrame, score_col: str, limit: int) -> list[dict[str, Any]]:
    if df.empty:
        return []
    rows: list[dict[str, Any]] = []
    for rank, (_, row) in enumerate(df.head(limit).iterrows(), start=1):
        rows.append(
            {
                "rank": rank,
                "ticker": clean_text(row.get("ticker")),
                "name": clean_text(row.get("name")),
                "companyName": clean_text(row.get("company_name")) or clean_text(row.get("name")),
                "score": clean_number(first_value(row, score_col, f"{score_col}.1"), 6),
                "qualityScore": clean_number(first_value(row, "earnings_quality_momentum_score", "earnings_quality_momentum_score.1"), 6),
                "confluenceScore": clean_number(first_value(row, "wall_street_confluence_score", "wall_street_confluence_score.1"), 6),
                "userAngle": quality_angle(row.get("user_angle")),
                "userReason": quality_reason(row.get("user_reason")),
                "userRisk": clean_text(row.get("user_risk")),
                "guidanceUpCount": clean_int(row.get("guidance_up_count")),
                "earningsBeatCount": clean_int(row.get("earnings_beat_count")),
                "guidanceDownCount": clean_int(row.get("guidance_down_count")),
                "earningsMissCount": clean_int(row.get("earnings_miss_count")),
                "epsRevisionPct": pct_points(row.get("max_eps_revision_pct")),
                "revenueRevisionPct": pct_points(row.get("max_revenue_revision_pct")),
                "epsSurprisePct": pct_points(row.get("max_eps_surprise_pct")),
                "revenueSurprisePct": pct_points(row.get("max_revenue_surprise_pct")),
                "return20dPct": pct_points(row.get("return_20d")),
                "analystHeatScore": clean_number(row.get("analyst_heat_score"), 6),
                "events30d": clean_int(row.get("events_30d")),
                "firms30d": clean_int(row.get("firms_30d")),
                "avgPriceTargetUpsidePct": pct_points(row.get("avg_price_target_upside")),
                "close": clean_number(row.get("close"), 2),
                "dollarVolume20d": clean_number(row.get("median_dollar_volume_20d"), 2),
                "latestEarningsDate": clean_text(row.get("latest_earnings_date")),
                "latestGuidanceDate": clean_text(row.get("latest_guidance_date")),
            }
        )
    return rows


def extend_unique_rows(primary: pd.DataFrame, fallback: pd.DataFrame, target: int) -> pd.DataFrame:
    if fallback.empty or len(primary) >= target:
        return primary
    seen = set(primary["ticker"].dropna().astype(str)) if "ticker" in primary else set()
    extra = fallback[~fallback["ticker"].astype(str).isin(seen)] if "ticker" in fallback else fallback
    return pd.concat([primary, extra.head(target - len(primary))], ignore_index=True)


def build_earnings_quality(data_root: Path, as_of: str, limit: int) -> dict[str, Any]:
    root = data_root / "reports" / "earnings_quality_momentum"
    quality = read_csv(root / "earnings_quality_momentum_core.csv")
    full = read_csv(root / "earnings_quality_momentum_full.csv")
    confluence = read_csv(root / "wall_street_confluence.csv")
    if not full.empty and "earnings_quality_momentum_score" in full:
        full = full.sort_values("earnings_quality_momentum_score", ascending=False)
    quality = extend_unique_rows(quality, full, min(limit, 120))
    quality_payload = quality_rows(quality, "earnings_quality_momentum_score", limit)
    confluence_payload = quality_rows(confluence, "wall_street_confluence_score", limit)
    return {
        "asOf": as_of,
        "generatedAt": date.today().isoformat(),
        "source": "Polygon fundamentals + processed daily bars",
        "summary": {
            "coreCount": len(quality_payload),
            "confluenceCount": len(confluence_payload),
            "coreLeader": quality_payload[0]["ticker"] if quality_payload else None,
            "confluenceLeader": confluence_payload[0]["ticker"] if confluence_payload else None,
            "coreDefinition": "财报、指引、价格动量同时改善的股票。",
            "confluenceDefinition": "财报质量改善，同时出现分析师热度或目标价空间。",
        },
        "boards": {
            "quality": {
                "title": "财报观察",
                "subtitle": "按财报质量、预期上修、近期走势和流动性排序。",
                "rows": quality_payload,
            },
            "confluence": {
                "title": "机构也在看",
                "subtitle": "在财报改善基础上叠加分析师热度和目标价空间。",
                "rows": confluence_payload,
            },
        },
    }


def analyst_rows(df: pd.DataFrame, limit: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for rank, (_, row) in enumerate(df.head(limit).iterrows(), start=1):
        rows.append(
            {
                "rank": rank,
                "ticker": clean_text(row.get("ticker")),
                "companyName": clean_text(row.get("company_name")) or clean_text(row.get("name")),
                "lastEventDate": clean_text(row.get("last_event_date") or row.get("event_date")),
                "firm": clean_text(row.get("latest_firm") or row.get("firm")),
                "ratingAction": clean_text(row.get("latest_rating_action") or row.get("rating_action")),
                "rating": clean_text(row.get("latest_rating") or row.get("rating")),
                "priceTarget": clean_number(row.get("latest_price_target") or row.get("price_target"), 2),
                "priceTargetUpsidePct": pct_points(row.get("avg_price_target_upside") or row.get("price_target_upside")),
                "heatScore": clean_number(row.get("analyst_heat_score") or row.get("signal_score"), 6),
                "events30d": clean_int(row.get("events_30d")),
                "firms30d": clean_int(row.get("firms_30d")),
                "return20dPct": pct_points(row.get("return_20d") or row.get("return_20d_y")),
                "close": clean_number(row.get("close"), 2),
                "dollarVolume20d": clean_number(row.get("median_dollar_volume_20d"), 2),
                "reason": clean_text(row.get("latest_reason") or row.get("reason_summary") or row.get("insight")),
            }
        )
    return rows


def build_analyst_heat(data_root: Path, limit: int) -> dict[str, Any]:
    root = data_root / "reports" / "analyst_product"
    heat = read_csv(root / "analyst_heat_30d_liquid.csv")
    upgrades = read_csv(root / "analyst_upgrades_liquid.csv")
    return {
        "generatedAt": now_iso(),
        "source": "Polygon Benzinga analyst feeds + latest tradable universe",
        "boards": {
            "heat": {
                "title": "分析师热度榜",
                "subtitle": "近30日机构覆盖、正面动作和目标价空间。",
                "rows": analyst_rows(heat, limit),
            },
            "upgrades": {
                "title": "评级上调榜",
                "subtitle": "近期评级上调且流动性达标的股票。",
                "rows": analyst_rows(upgrades, limit),
            },
        },
    }


def path_count(path: Path, pattern: str) -> int:
    if not path.exists():
        return 0
    return sum(1 for item in path.glob(pattern) if item.is_file() and not item.name.startswith("._"))


def build_health(data_root: Path, as_of: str) -> dict[str, Any]:
    universe = load_latest_universe(data_root, as_of)
    adjusted_path = data_root / "processed" / "polygon" / "stocks_split_adjusted" / "1d" / f"daily_split_adjusted_{as_of[:4]}.parquet"
    latest_daily_rows = 0
    if adjusted_path.exists():
        daily = pd.read_parquet(adjusted_path, columns=["trade_date"])
        latest_daily_rows = int((daily["trade_date"].astype(str) == as_of).sum())
    required = {
        "universe": data_root / "features" / "polygon" / "universe" / "daily_tradable_universe_by_year" / f"universe_{as_of[:4]}.parquet",
        "adjustedDaily": adjusted_path,
        "fredVix": data_root / "raw" / "fred" / "VIXCLS.parquet",
        "fredTenYear": data_root / "raw" / "fred" / "DGS10.parquet",
        "fredHighYieldSpread": data_root / "raw" / "fred" / "BAMLH0A0HYM2.parquet",
        "earningsQualityCore": data_root / "reports" / "earnings_quality_momentum" / "earnings_quality_momentum_core.csv",
        "wallStreetConfluence": data_root / "reports" / "earnings_quality_momentum" / "wall_street_confluence.csv",
        "analystHeat": data_root / "reports" / "analyst_product" / "analyst_heat_30d_liquid.csv",
    }
    missing = [name for name, path in required.items() if not path.exists()]
    warnings = []
    if missing:
        warnings.append(f"Missing required inputs: {', '.join(missing)}")
    if latest_daily_rows == 0:
        warnings.append(f"No adjusted daily rows found for {as_of}")
    return {
        "generatedAt": now_iso(),
        "ok": not missing and latest_daily_rows > 0,
        "asOf": as_of,
        "sourceRoot": str(data_root),
        "counts": {
            "latestUniverseRows": int(len(universe)),
            "tradableCoreRows": int(universe["tradable_core"].fillna(False).sum()),
            "commonOrAdrRows": int(universe["is_common_or_adr"].fillna(False).sum()),
            "latestAdjustedDailyRows": latest_daily_rows,
            "fredSeries": path_count(data_root / "raw" / "fred", "*.parquet"),
            "analystReportFiles": path_count(data_root / "reports" / "analyst_product", "*.csv"),
            "earningsReportFiles": path_count(data_root / "reports" / "earnings_quality_momentum", "*.csv"),
        },
        "warnings": warnings,
    }


def build_manifest(as_of: str, health: dict[str, Any]) -> dict[str, Any]:
    return {
        "generatedAt": now_iso(),
        "asOf": as_of,
        "ok": health["ok"],
        "endpoints": [
            {"name": "manifest", "static": "data/api/manifest.json", "api": "/api/data"},
            {"name": "health", "static": "data/api/health.json", "api": "/api/data/health"},
            {"name": "market-temperature", "static": "data/market-temperature.json", "api": "/api/data/market-temperature"},
            {"name": "market-leaders", "static": "data/api/market-leaders.json", "api": "/api/data/market-leaders"},
            {"name": "earnings-quality", "static": "data/earnings-quality.json", "api": "/api/data/earnings-quality"},
            {"name": "analyst-heat", "static": "data/api/analyst-heat.json", "api": "/api/data/analyst-heat"},
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--site-data-dir", type=Path, default=DEFAULT_SITE_DATA_DIR)
    parser.add_argument("--api-data-dir", type=Path, default=DEFAULT_API_DATA_DIR)
    parser.add_argument("--asof", default="")
    parser.add_argument("--limit", type=int, default=160)
    args = parser.parse_args()

    data_root = args.data_root.expanduser()
    as_of = args.asof or latest_trade_date(data_root)
    health = build_health(data_root, as_of)
    market_temperature = build_market_temperature(data_root)
    market_leaders = build_market_leaders(data_root, as_of, min(args.limit, 100))
    earnings_quality = build_earnings_quality(data_root, as_of, args.limit)
    analyst_heat = build_analyst_heat(data_root, min(args.limit, 100))
    sector_flow = read_site_json(args.site_data_dir / "sector-flow.json")
    manifest = build_manifest(as_of, health)
    agent = {
        "generatedAt": now_iso(),
        "asOf": as_of,
        "sourceRoot": str(data_root),
        "health": health,
        "manifest": manifest,
        "payloads": {
            "marketTemperature": market_temperature,
            "marketLeaders": market_leaders,
            "earningsQuality": earnings_quality,
            "analystHeat": analyst_heat,
            "sectorFlow": sector_flow,
        },
    }

    write_json(args.api_data_dir / "manifest.json", manifest)
    write_json(args.api_data_dir / "health.json", health)
    write_json(args.api_data_dir / "market-temperature.json", market_temperature)
    write_json(args.api_data_dir / "market-leaders.json", market_leaders)
    write_json(args.api_data_dir / "earnings-quality.json", earnings_quality)
    write_json(args.api_data_dir / "analyst-heat.json", analyst_heat)
    write_json(args.site_data_dir / "site-data-index.json", agent)
    write_json(args.site_data_dir / "market-temperature.json", market_temperature)
    write_json(args.site_data_dir / "earnings-quality.json", earnings_quality)
    print(f"Data Agent wrote JSON for {as_of}: {args.api_data_dir}")


if __name__ == "__main__":
    main()

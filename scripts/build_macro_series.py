#!/usr/bin/env python3
from __future__ import annotations

import argparse
import math
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DEFAULT_DATA_ROOT = Path("/Volumes/Extreme SSD/market-data-lab/data")
PREFERRED_FRED_DIR = Path("/Volumes/Extreme SSD/market-data-lab/data/raw/fred")


@dataclass(frozen=True)
class IndicatorConfig:
    source_id: str
    name: str
    category: str
    unit: str
    impact: str
    percent_yoy: bool = False


INDICATORS = [
    IndicatorConfig("VIXCLS", "VIX 波动率", "波动率", "%", "市场波动"),
    IndicatorConfig("DGS10", "10Y 美债收益率", "利率", "%", "成长股估值"),
    IndicatorConfig("DGS30", "30Y 美债收益率", "利率", "%", "长期利率压力"),
    IndicatorConfig("DTWEXBGS", "美元指数", "美元", "", "全球资金偏好"),
    IndicatorConfig("DCOILWTICO", "WTI 原油", "原油", "$", "通胀与能源成本"),
    IndicatorConfig("DCOILBRENTEU", "Brent 原油", "原油", "$", "通胀与能源成本"),
    IndicatorConfig("CPIAUCSL", "CPI 同比", "通胀", "%", "降息预期", True),
]


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


def resolve_fred_dir(data_root: Path | None = None, fred_dir: Path | None = None) -> Path:
    candidates = []
    if fred_dir is not None:
        candidates.append(fred_dir)
    env_fred = os.environ.get("FRED_DIR") or os.environ.get("FRED_RAW_DIR")
    if env_fred:
        candidates.append(Path(env_fred))
    candidates.append(PREFERRED_FRED_DIR)
    env_root = os.environ.get("MARKET_DATA_ROOT") or os.environ.get("DATA_ROOT")
    if env_root:
        candidates.append(Path(env_root) / "raw" / "fred")
    candidates.append((data_root or DEFAULT_DATA_ROOT) / "raw" / "fred")

    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"No FRED parquet directory found. Checked: {', '.join(str(path) for path in candidates)}")


def read_series(fred_dir: Path, config: IndicatorConfig) -> pd.DataFrame:
    path = fred_dir / f"{config.source_id}.parquet"
    if not path.exists():
        raise FileNotFoundError(str(path))
    frame = pd.read_parquet(path)
    lowered = {str(column).lower(): column for column in frame.columns}
    date_column = lowered.get("date") or lowered.get("observation_date") or frame.columns[0]
    value_column = lowered.get("value") or lowered.get(config.source_id.lower())
    if value_column is None:
        candidates = [column for column in frame.columns if column != date_column]
        numeric = [column for column in candidates if pd.to_numeric(frame[column], errors="coerce").notna().any()]
        if not numeric:
            raise ValueError(f"No numeric value column found in {path}")
        value_column = numeric[-1]

    out = frame[[date_column, value_column]].copy()
    out.columns = ["date", "value"]
    out["date"] = pd.to_datetime(out["date"], errors="coerce")
    out["value"] = pd.to_numeric(out["value"], errors="coerce")
    out = out.dropna().sort_values("date").drop_duplicates("date", keep="last").reset_index(drop=True)
    if config.percent_yoy:
        out["value"] = out["value"].pct_change(12) * 100
        out = out.dropna().reset_index(drop=True)
    if out.empty:
        raise ValueError(f"No usable observations found in {path}")
    return out


def percentile_rank(series: pd.Series, current: float) -> int | None:
    data = pd.to_numeric(series, errors="coerce").dropna()
    if data.empty:
        return None
    return int(round(float((data <= current).mean() * 100)))


def window_values(frame: pd.DataFrame, years: int) -> pd.Series:
    latest_date = frame["date"].max()
    start = latest_date - pd.DateOffset(years=years)
    values = frame.loc[frame["date"] >= start, "value"]
    return values if not values.empty else frame["value"]


def format_value(value: float | None, unit: str, signed: bool = False) -> str:
    if value is None:
        return "--"
    sign = "+" if signed and value >= 0 else ""
    if unit == "$":
        return f"{sign}${value:.2f}"
    if unit == "%":
        return f"{sign}{value:.2f}%"
    return f"{sign}{value:.2f}"


def risk_for(config: IndicatorConfig, value: float, change: float) -> tuple[str, str, str]:
    sid = config.source_id
    if sid == "VIXCLS":
        if value >= 28:
            return "watch", "高", "VIX 处在高波动区间，高波动线索需要更严格确认。"
        if value >= 18:
            return "neutral", "中", "VIX 不算低，市场可能仍有反复，适合边观察边控制节奏。"
        return "positive", "低", "VIX 处在较低区间，市场情绪相对稳定。"
    if sid == "DGS10":
        if value >= 4.8 or change >= 0.15:
            return "watch", "高", "10年期美债收益率偏高，成长股估值更容易承压。"
        if value >= 4.2:
            return "neutral", "中", "10年期美债收益率仍在偏高区间，估值压力需要观察。"
        return "positive", "低", "10年期美债收益率压力相对温和。"
    if sid == "DGS30":
        if value >= 5 or change >= 0.15:
            return "watch", "高", "30年期美债收益率偏高，长期资金成本和高估值资产需要谨慎。"
        if value >= 4.5:
            return "neutral", "中", "30年期美债收益率仍在高位，长久期资产需要观察。"
        return "positive", "低", "30年期美债收益率压力相对温和。"
    if sid == "DTWEXBGS":
        if value >= 120 or change >= 0.7:
            return "watch", "高", "美元偏强，海外收入、大宗商品和全球风险偏好都需要观察。"
        if value >= 116:
            return "neutral", "中", "美元处在偏强区间，可能压制部分风险资产。"
        return "positive", "低", "美元压力相对温和。"
    if sid in {"DCOILWTICO", "DCOILBRENTEU"}:
        if value >= 105 or change >= 3:
            return "watch", "高", "油价偏高，通胀和企业成本压力可能回升。"
        if value >= 90:
            return "neutral", "中", "油价处在偏高区间，能源和通胀线索需要观察。"
        return "positive", "低", "油价压力相对温和。"
    if sid == "CPIAUCSL":
        if value >= 3.2:
            return "watch", "高", "CPI 同比仍偏高，降息预期和利率敏感资产需要谨慎。"
        if value >= 2.5:
            return "neutral", "中", "CPI 同比仍需观察，通胀回落还不算彻底。"
        return "positive", "低", "CPI 同比压力相对温和。"
    return "neutral", "中", "这个指标用于辅助判断市场风险偏好。"


def build_indicator(fred_dir: Path, config: IndicatorConfig) -> dict[str, Any]:
    frame = read_series(fred_dir, config)
    latest = frame.iloc[-1]
    previous = frame.iloc[-2] if len(frame) > 1 else latest
    current = clean_number(latest["value"]) or 0.0
    previous_value = clean_number(previous["value"]) or current
    change = round(current - previous_value, 2)
    status, level, summary = risk_for(config, current, change)
    values_5y = window_values(frame, 5)
    points_frame = frame.loc[frame["date"] >= frame["date"].max() - pd.DateOffset(years=5)].copy()

    return {
        "key": config.source_id.lower(),
        "sourceId": config.source_id,
        "name": config.name,
        "category": config.category,
        "unit": config.unit,
        "impact": config.impact,
        "asOf": latest["date"].date().isoformat(),
        "current": current,
        "value": format_value(current, config.unit),
        "previous": format_value(previous_value, config.unit),
        "change": format_value(change, config.unit, signed=True),
        "status": status,
        "level": level,
        "summary": summary,
        "percentiles": {
            "oneYear": percentile_rank(window_values(frame, 1), current),
            "threeYear": percentile_rank(window_values(frame, 3), current),
            "fiveYear": percentile_rank(values_5y, current),
        },
        "bands": {
            "p30": clean_number(values_5y.quantile(0.30)),
            "median": clean_number(values_5y.quantile(0.50)),
            "p70": clean_number(values_5y.quantile(0.70)),
        },
        "points": [
            {"date": row.date.date().isoformat(), "value": clean_number(row.value)}
            for row in points_frame.itertuples(index=False)
            if clean_number(row.value) is not None
        ],
    }


def build_payload(fred_dir: Path) -> dict[str, Any]:
    indicators: list[dict[str, Any]] = []
    missing: list[dict[str, str]] = []
    for config in INDICATORS:
        try:
            indicators.append(build_indicator(fred_dir, config))
        except Exception as exc:
            missing.append({"sourceId": config.source_id, "reason": str(exc)})
    as_of = max((item["asOf"] for item in indicators), default="")
    return {
        "generatedAt": now_iso(),
        "asOf": as_of,
        "source": {
            "name": "FRED",
            "directory": str(fred_dir),
        },
        "indicators": indicators,
        "missing": missing,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build macro indicator history series payloads from local FRED parquet files.")
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--fred-dir", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    fred_dir = resolve_fred_dir(args.data_root, args.fred_dir)
    payload = build_payload(fred_dir)
    print(f"Built macro series as of {payload['asOf']} with {len(payload['indicators'])} indicators")


if __name__ == "__main__":
    main()

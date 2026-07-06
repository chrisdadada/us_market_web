#!/usr/bin/env python3
"""Build front-end strategy signal JSON from local market-data-lab parquet files."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd


DEFAULT_DATA_ROOT = Path("/Volumes/Extreme SSD/market-data-lab/data")
MAG7 = ["NVDA", "MSFT", "META", "AMZN", "GOOGL", "AAPL", "TSLA"]
CORE_SYMBOLS = sorted(set(["SPY", "QQQ", "IWM", "XLK", "HYG", *MAG7]))
CN_NAMES = {
    "AAPL": "苹果",
    "MSFT": "微软",
    "NVDA": "英伟达",
    "AMZN": "亚马逊",
    "META": "Meta",
    "GOOGL": "谷歌",
    "TSLA": "特斯拉",
}
TERM_EXPLAINS = {
    "SPY": "跟踪标普500指数的ETF，常用来代表美股大盘。",
    "QQQ": "跟踪纳斯达克100指数的ETF，科技股占比较高。",
    "IWM": "跟踪罗素2000小盘股指数的ETF，常用来看小盘股风险偏好。",
    "VIX": "也叫恐慌指数，数值越高，通常代表市场预期波动越大。",
    "10Y": "美国10年期国债收益率，利率上行通常会压制高估值成长股。",
    "HY Spread": "高收益债信用利差，利差扩大通常代表信用风险上升。",
}


@dataclass
class ReturnPack:
    day: float | None
    week: float | None
    month: float | None
    quarter: float | None
    half_year: float | None
    ytd: float | None


def pct(current: float, previous: float | None) -> float | None:
    if previous is None or pd.isna(previous) or previous == 0:
        return None
    return (current / previous - 1) * 100


def fmt_pct(value: float | None, digits: int = 1) -> str:
    if value is None or pd.isna(value):
        return "--"
    sign = "+" if value >= 0 else ""
    return f"{sign}{value:.{digits}f}%"


def latest_before(series: pd.Series, index: int, periods: int) -> float | None:
    target = index - periods
    if target < 0:
        return None
    return float(series.iloc[target])


def load_daily_prices(data_root: Path, symbols: list[str]) -> pd.DataFrame:
    modern_dir = data_root / "processed" / "polygon" / "stocks_rth" / "60m"
    legacy_dir = data_root / "processed" / "bars" / "60m"
    if modern_dir.exists():
        files = sorted(path for path in modern_dir.glob("*/*/*.parquet") if not path.name.startswith("._"))
        bars_dir = modern_dir
    else:
        files = sorted(path for path in legacy_dir.glob("*.parquet") if not path.name.startswith("._"))
        bars_dir = legacy_dir
    if not files:
        raise FileNotFoundError(f"No parquet files found in {bars_dir}")

    frames = []
    columns = ["symbol", "timestamp_et", "close", "volume"]
    for path in files:
        df = pd.read_parquet(path, columns=columns)
        df = df[df["symbol"].isin(symbols)]
        if df.empty:
            continue
        df["date"] = pd.to_datetime(df["timestamp_et"]).dt.date.astype(str)
        close = df.sort_values(["symbol", "timestamp_et"]).groupby(["date", "symbol"], as_index=False).tail(1)
        volume = df.groupby(["date", "symbol"], as_index=False)["volume"].sum()
        merged = close[["date", "symbol", "close"]].merge(volume, on=["date", "symbol"], how="left")
        frames.append(merged)

    if not frames:
        raise ValueError("No matching symbols found in processed bars.")

    daily = pd.concat(frames, ignore_index=True)
    daily = daily.sort_values(["date", "symbol"]).reset_index(drop=True)
    return daily


def load_fred(data_root: Path, series_id: str, as_of: str) -> tuple[float | None, str | None]:
    path = data_root / "raw" / "fred" / f"{series_id}.parquet"
    if not path.exists():
        return None, None
    df = pd.read_parquet(path)
    df = df.dropna(subset=["value"])
    df = df[df["date"] <= as_of]
    if df.empty:
        return None, None
    last = df.sort_values("date").iloc[-1]
    return float(last["value"]), str(last["date"])


def returns_for(series: pd.Series) -> ReturnPack:
    current = float(series.iloc[-1])
    index = len(series) - 1
    return ReturnPack(
        day=pct(current, latest_before(series, index, 1)),
        week=pct(current, latest_before(series, index, 5)),
        month=pct(current, latest_before(series, index, 21)),
        quarter=pct(current, latest_before(series, index, 63)),
        half_year=pct(current, latest_before(series, index, 126)),
        ytd=pct(current, float(series.iloc[0])),
    )


def status_for(symbol: str, series: pd.Series, qqq_rel_spy: float | None = None) -> tuple[str, str, str]:
    current = float(series.iloc[-1])
    ma50 = float(series.tail(50).mean())
    ma200 = float(series.tail(200).mean()) if len(series) >= 200 else float(series.mean())
    pack = returns_for(series)

    if symbol == "QQQ" and qqq_rel_spy is not None and qqq_rel_spy > 2 and current > ma50:
        return "positive", "强于 SPY", "科技股相对大盘更强，适合提高关注度。"
    if current > ma50 > ma200:
        return "positive", "趋势线之上", "价格站上中长期趋势线，风险偏好仍可接受。"
    if pack.month is not None and pack.month > 0:
        return "neutral", "修复中", "短期在回升，但还没有形成更强趋势。"
    return "watch", "偏弱观察", "趋势不够清晰，新增线索需要降低优先级。"


def build_signals(data_root: Path) -> dict:
    daily = load_daily_prices(data_root, CORE_SYMBOLS)
    latest_date = str(daily["date"].max())
    close_panel = daily.pivot(index="date", columns="symbol", values="close").dropna(how="all")
    close_panel = close_panel.ffill()

    spy = close_panel["SPY"].dropna()
    qqq = close_panel["QQQ"].dropna()
    iwm = close_panel["IWM"].dropna()
    qqq_63 = returns_for(qqq).quarter
    spy_63 = returns_for(spy).quarter
    qqq_rel_spy = None if qqq_63 is None or spy_63 is None else qqq_63 - spy_63

    vix_value, vix_date = load_fred(data_root, "VIXCLS", latest_date)
    dgs10_value, dgs10_date = load_fred(data_root, "DGS10", latest_date)
    hy_value, hy_date = load_fred(data_root, "BAMLH0A0HYM2", latest_date)

    spy_state = status_for("SPY", spy)
    qqq_state = status_for("QQQ", qqq, qqq_rel_spy)
    iwm_state = status_for("IWM", iwm)

    penalties = 0
    if spy_state[0] != "positive":
        penalties += 20
    if qqq_state[0] != "positive":
        penalties += 15
    if vix_value is not None and vix_value >= 22:
        penalties += 15
    elif vix_value is not None and vix_value >= 17:
        penalties += 8
    if dgs10_value is not None and dgs10_value >= 4.5:
        penalties += 8
    if hy_value is not None and hy_value >= 4.5:
        penalties += 15
    risk_budget = max(30, min(90, 85 - penalties))

    if risk_budget >= 75:
        regime = "偏强"
        action = "提高复盘优先级"
        regime_note = "大盘和科技主线较强，可优先跟踪强趋势资产。"
    elif risk_budget >= 55:
        regime = "偏强但谨慎"
        action = "只加强者"
        regime_note = "趋势仍有延续，新增观察集中在相对强势标的。"
    else:
        regime = "防守观察"
        action = "降低观察频率"
        regime_note = "风险信号增多，先控制波动和回撤。"

    signals = [
        {
            "term": "SPY",
            "bucket": spy_state[0],
            "label": spy_state[1],
            "note": spy_state[2],
            "tooltip": TERM_EXPLAINS["SPY"],
        },
        {
            "term": "QQQ",
            "bucket": qqq_state[0],
            "label": qqq_state[1],
            "note": qqq_state[2],
            "tooltip": TERM_EXPLAINS["QQQ"],
        },
        {
            "term": "IWM",
            "bucket": iwm_state[0],
            "label": iwm_state[1],
            "note": iwm_state[2],
            "tooltip": TERM_EXPLAINS["IWM"],
        },
        {
            "term": "VIX",
            "bucket": "positive" if vix_value is not None and vix_value < 17 else "neutral" if vix_value is not None and vix_value < 22 else "watch",
            "label": "--" if vix_value is None else f"{vix_value:.1f}",
            "note": "波动率处于可接受区间。" if vix_value is not None and vix_value < 17 else "波动率需要跟踪，高热度线索要降级。" if vix_value is not None and vix_value < 22 else "市场波动压力偏高，优先控制回撤。",
            "tooltip": TERM_EXPLAINS["VIX"],
            "asOf": vix_date,
        },
        {
            "term": "10Y",
            "bucket": "positive" if dgs10_value is not None and dgs10_value < 4.0 else "neutral" if dgs10_value is not None and dgs10_value < 4.5 else "watch",
            "label": "--" if dgs10_value is None else f"{dgs10_value:.2f}%",
            "note": "长端利率压力较低。" if dgs10_value is not None and dgs10_value < 4.0 else "利率仍会影响成长股估值。" if dgs10_value is not None and dgs10_value < 4.5 else "利率压力偏高，高估值股票要谨慎。",
            "tooltip": TERM_EXPLAINS["10Y"],
            "asOf": dgs10_date,
        },
        {
            "term": "HY Spread",
            "bucket": "positive" if hy_value is not None and hy_value < 3.8 else "neutral" if hy_value is not None and hy_value < 4.5 else "watch",
            "label": "--" if hy_value is None else f"{hy_value:.2f}%",
            "note": "信用市场稳定，暂不触发防守。" if hy_value is not None and hy_value < 3.8 else "信用风险略有升温。" if hy_value is not None and hy_value < 4.5 else "信用利差扩大，需要降低风险敞口。",
            "tooltip": TERM_EXPLAINS["HY Spread"],
            "asOf": hy_date,
        },
    ]

    mag7_rows = []
    for symbol in MAG7:
        series = close_panel[symbol].dropna()
        pack = returns_for(series)
        current = float(series.iloc[-1])
        ma50 = float(series.tail(50).mean())
        ma200 = float(series.tail(200).mean()) if len(series) >= 200 else float(series.mean())
        rel = None if pack.quarter is None or qqq_63 is None else pack.quarter - qqq_63
        score = 45
        if pack.quarter is not None:
            score += max(-20, min(25, pack.quarter * 1.2))
        if current > ma50:
            score += 14
        if current > ma200:
            score += 10
        if rel is not None:
            score += max(-12, min(12, rel * 0.8))
        score = int(max(1, min(99, round(score))))
        if score >= 82:
            status = "强趋势"
        elif score >= 70:
            status = "趋势延续"
        elif score >= 58:
            status = "中性偏强"
        elif score >= 46:
            status = "等待确认"
        else:
            status = "高波动"
        mag7_rows.append(
            {
                "symbol": symbol,
                "name": CN_NAMES[symbol],
                "score": score,
                "status": status,
                "monthReturn": fmt_pct(pack.month),
                "quarterReturn": fmt_pct(pack.quarter),
                "relativeQQQ": fmt_pct(rel),
            }
        )
    mag7_rows.sort(key=lambda row: row["score"], reverse=True)

    top3 = [row["symbol"] for row in mag7_rows[:3]]
    mid2 = [row["symbol"] for row in mag7_rows[3:5]]
    low2 = [row["symbol"] for row in mag7_rows[5:]]
    allocation = [
        {"label": "重点观察", "symbols": " / ".join(top3), "weight": "高"},
        {"label": "趋势观察", "symbols": " / ".join(mid2), "weight": "中"},
        {"label": "低频跟踪", "symbols": " / ".join(low2), "weight": "低"},
    ]

    # A simple public-facing strategy preview: risk-budget gated monthly rotation into top Mag7 names.
    strategy_returns = {}
    if all(symbol in close_panel for symbol in top3 + ["QQQ"]):
        selected_prices = close_panel[top3].dropna()
        portfolio_returns = selected_prices.pct_change().dropna().mean(axis=1)
        portfolio_series = (1 + portfolio_returns).cumprod()
        benchmark_prices = close_panel["QQQ"].dropna()
        benchmark_series = benchmark_prices / float(benchmark_prices.iloc[0])
        portfolio_pack = returns_for(portfolio_series)
        benchmark_pack = returns_for(benchmark_series)
        monthly = portfolio_series.groupby(pd.PeriodIndex(portfolio_series.index, freq="M")).agg(["first", "last"])
        monthly_returns = (monthly["last"] / monthly["first"] - 1) * 100
        last_month = float(monthly_returns.iloc[-2]) if len(monthly_returns) >= 2 else None
        max_drawdown = float((portfolio_series / portfolio_series.cummax() - 1).min() * 100)
        strategy_returns = {
            "month": fmt_pct(portfolio_pack.month),
            "lastMonth": fmt_pct(last_month),
            "quarter": fmt_pct(portfolio_pack.quarter),
            "halfYear": fmt_pct(portfolio_pack.half_year),
            "oneYear": fmt_pct(portfolio_pack.ytd),
            "benchmarkOneYear": fmt_pct(benchmark_pack.ytd),
            "maxDrawdown": fmt_pct(max_drawdown),
            "position": f"{risk_budget}%",
        }

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "asOf": latest_date,
        "marketRegime": {
            "label": regime,
            "riskBudget": f"{risk_budget}%",
            "action": action,
            "summary": regime_note,
        },
        "risk": {
            "signals": signals,
            "rules": [
                {"done": spy_state[0] == "positive", "title": "SPY / QQQ 趋势确认", "note": "两者均在趋势线上方，市场基础状态较稳。"},
                {"done": qqq_state[0] == "positive", "title": "QQQ 相对强弱确认", "note": "QQQ 强于 SPY 时，科技权重可高于市场基准。"},
                {"done": risk_budget >= 70, "title": "VIX 与利率压力监控", "note": "波动率或利率走高时，新增线索需要降低优先级。"},
                {"done": hy_value is not None and hy_value < 4.5, "title": "信用利差触发防守", "note": "信用快速恶化时，进入 ETF 防守或现金模式。"},
            ],
        },
        "mag7": {
            "leader": mag7_rows[0],
            "rows": mag7_rows,
            "allocation": allocation,
        },
        "strategy": strategy_returns,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    payload = build_signals(args.data_root)
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {args.output} as of {payload['asOf']}")
    else:
        print(f"Built core signals as of {payload['asOf']}")


if __name__ == "__main__":
    main()

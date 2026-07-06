#!/usr/bin/env python3
"""Build a cross-sectional relative-strength scanner JSON for the front end."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd


DEFAULT_DATA_ROOT = Path("/Volumes/Extreme SSD/market-data-lab/data")
SECTOR_ETFS = {
    "XLK": "科技",
    "XLC": "通信",
    "XLY": "可选消费",
    "XLF": "金融",
    "XLV": "医疗",
    "XLI": "工业",
    "XLE": "能源",
    "XLP": "必需消费",
    "XLU": "公用事业",
    "XLRE": "地产",
    "XLB": "材料",
    "SMH": "半导体",
    "IBB": "生物科技",
}
BENCHMARKS = ["SPY", "QQQ", *SECTOR_ETFS.keys()]


def fmt_pct(value: float | None, digits: int = 1) -> str:
    if value is None or pd.isna(value):
        return "--"
    sign = "+" if value >= 0 else ""
    return f"{sign}{value:.{digits}f}%"


def fmt_money(value: float | None) -> str:
    if value is None or pd.isna(value):
        return "--"
    if value >= 1_000_000_000:
        return f"${value / 1_000_000_000:.1f}B"
    if value >= 1_000_000:
        return f"${value / 1_000_000:.1f}M"
    return f"${value:,.0f}"


def fmt_market_cap(value: float | None) -> str:
    if value is None or pd.isna(value):
        return "--"
    if value >= 1_000_000_000:
        return f"{value / 1_000_000_000:.2f}B"
    if value >= 1_000_000:
        return f"{value / 1_000_000:.2f}M"
    return f"{value:,.0f}"


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
        cap = row.market_cap
        if cap is None or pd.isna(cap):
            shares = row.weighted_shares_outstanding
            if shares is None or pd.isna(shares):
                shares = row.share_class_shares_outstanding
            price = prices.get(symbol)
            if shares is not None and not pd.isna(shares) and price is not None and not pd.isna(price):
                cap = float(shares) * float(price)
        if cap is not None and not pd.isna(cap) and float(cap) > 0:
            caps[symbol] = float(cap)
    return caps


def percentile(series: pd.Series, higher_is_better: bool = True) -> pd.Series:
    ranks = series.rank(pct=True, method="average")
    if not higher_is_better:
        ranks = 1 - ranks
    return ranks.fillna(0.5) * 100


def year_files(root: Path, stem: str, years: list[int]) -> list[Path]:
    return [path for year in years if (path := root / f"{stem}_{year}.parquet").exists()]


def load_daily(data_root: Path, years: list[int]) -> pd.DataFrame:
    root = data_root / "processed" / "polygon" / "stocks_split_adjusted" / "1d"
    files = year_files(root, "daily_split_adjusted", years)
    if not files:
        raise FileNotFoundError(f"No daily adjusted parquet files found in {root}")
    columns = ["symbol", "trade_date", "adj_open", "adj_high", "adj_low", "adj_close", "adj_volume"]
    frames = [pd.read_parquet(path, columns=columns) for path in files]
    daily = pd.concat(frames, ignore_index=True)
    daily["trade_date"] = daily["trade_date"].astype(str)
    daily = daily.dropna(subset=["symbol", "trade_date", "adj_close"])
    return daily.sort_values(["trade_date", "symbol"]).reset_index(drop=True)


def load_latest_universe(data_root: Path, year: int, latest_date: str) -> pd.DataFrame:
    root = data_root / "features" / "polygon" / "universe" / "daily_tradable_universe_by_year"
    path = root / f"universe_{year}.parquet"
    if not path.exists():
        raise FileNotFoundError(f"Missing universe file: {path}")
    columns = [
        "symbol",
        "trade_date",
        "name",
        "primary_exchange",
        "type",
        "tradable_core",
        "median_dollar_volume_20d",
        "median_volume_20d",
        "close",
    ]
    universe = pd.read_parquet(path, columns=columns)
    universe["trade_date"] = universe["trade_date"].astype(str)
    latest = universe[universe["trade_date"] == latest_date].copy()
    if latest.empty:
        latest_date = str(universe["trade_date"].max())
        latest = universe[universe["trade_date"] == latest_date].copy()
    latest["name"] = latest["name"].fillna(latest["symbol"])
    return latest


def pct_change_from(panel: pd.DataFrame, periods: int) -> pd.Series:
    previous = panel.shift(periods).iloc[-1]
    current = panel.iloc[-1]
    return (current / previous - 1) * 100


def ytd_return(panel: pd.DataFrame) -> pd.Series:
    latest_year = str(panel.index[-1])[:4]
    year_panel = panel.loc[[idx for idx in panel.index if str(idx).startswith(latest_year)]]
    if year_panel.empty:
        return pd.Series(index=panel.columns, dtype=float)
    return (year_panel.iloc[-1] / year_panel.iloc[0] - 1) * 100


def build_review(snapshot_dir: Path, latest_date: str, close_panel: pd.DataFrame, spy: pd.Series) -> dict:
    reviews: list[dict] = []
    if not snapshot_dir.exists():
        return {
            "summary": "暂无足够历史记录，系统会从本次刷新开始跟踪这些判断后续是否有效。",
            "labels": [],
            "factors": [],
        }

    for path in sorted(snapshot_dir.glob("*.json")):
        try:
            snap = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        snap_date = snap.get("asOf")
        if not snap_date or snap_date >= latest_date or snap_date not in close_panel.index:
            continue
        current = close_panel.iloc[-1]
        base = close_panel.loc[snap_date]
        spy_current = float(spy.iloc[-1])
        spy_base = float(spy.loc[snap_date]) if snap_date in spy.index else None
        if not spy_base:
            continue
        spy_return = (spy_current / spy_base - 1) * 100
        for row in snap.get("rows", []):
            symbol = row.get("symbol")
            if symbol not in current.index or symbol not in base.index:
                continue
            base_price = base.get(symbol)
            current_price = current.get(symbol)
            if not base_price or pd.isna(base_price) or pd.isna(current_price):
                continue
            future_return = (float(current_price) / float(base_price) - 1) * 100
            reviews.append(
                {
                    "label": row.get("label", "未分类"),
                    "bucket": row.get("bucket", "watchlist"),
                    "factor": row.get("primaryFactor", "综合表现"),
                    "excess": future_return - spy_return,
                }
            )

    if not reviews:
        return {
            "summary": "历史记录还不够，继续刷新后会显示哪些标签相对大盘更强。",
            "labels": [],
            "factors": [],
        }

    review_df = pd.DataFrame(reviews)
    label_rows = []
    for label, group in review_df.groupby("label"):
        if len(group) < 3:
            continue
        label_rows.append(
            {
                "name": label,
                "sample": int(len(group)),
                "winRate": fmt_pct(float((group["excess"] > 0).mean() * 100), 0),
                "avgExcess": fmt_pct(float(group["excess"].mean())),
            }
        )
    factor_rows = []
    for factor, group in review_df.groupby("factor"):
        if len(group) < 3:
            continue
        factor_rows.append(
            {
                "name": factor,
                "sample": int(len(group)),
                "avgExcess": fmt_pct(float(group["excess"].mean())),
            }
        )
    label_rows = sorted(label_rows, key=lambda item: float(item["avgExcess"].replace("%", "").replace("+", "")), reverse=True)[:6]
    factor_rows = sorted(factor_rows, key=lambda item: float(item["avgExcess"].replace("%", "").replace("+", "")), reverse=True)[:5]
    return {
        "summary": f"已回看 {len(reviews)} 条历史记录，重点看它们后续是否强于 SPY。",
        "labels": label_rows,
        "factors": factor_rows,
    }


def label_for(row: pd.Series) -> tuple[str, str, str]:
    score = row["strength_score"]
    crowding = row["crowding_score"]
    breakout = row["breakout_score"]
    rel_spy = row["rel_spy_20d"]
    rel_qqq = row["rel_qqq_20d"]
    ret20 = row["ret_20d"]

    if score >= 78 and crowding >= 72:
        return "强但偏热", "成交额和短线涨幅都偏热，等分歧或回踩再跟。", "热度偏高"
    if score >= 76 and breakout >= 72 and rel_spy > 0 and rel_qqq > 0:
        return "突破型强股", "相对大盘和科技主线都更强，可放入强势候选池。", "接近新高"
    if score >= 68 and rel_spy > 0:
        return "明显强于主线", "趋势仍占优，优先观察低风险跟踪点。", "强于大盘"
    if score <= 24 and row["volume_ratio"] >= 1.25:
        return "弱势放量确认", "下跌伴随放量，适合做风险预警或弱势名单。", "弱势放量"
    if score <= 34:
        return "弱势风险预警", "相对收益持续落后，暂不做多头候选。", "相对弱势"
    if 54 <= score < 68 and breakout >= 60 and ret20 > 0:
        return "等回踩", "有趋势苗头但优势不够极端，等确认比直接提高优先级更好。", "突破观察"
    return "先观察，不单独触发", "还没有形成清晰优势，只保留监控。", "综合表现"


def build_theme_summary(work: pd.DataFrame) -> dict:
    theme_rows = []
    for theme, group in work.groupby("sector_proxy"):
        if len(group) < 8:
            continue
        leaders = group.sort_values("strength_score", ascending=False).head(3)
        strong_count = int((group["strength_score"] >= 68).sum())
        hot_count = int((group["crowding_score"] >= 72).sum())
        weak_count = int((group["strength_score"] <= 34).sum())
        rel_spy = float(group["rel_spy_20d"].median())
        ret20 = float(group["ret_20d"].median())
        if strong_count >= 8 and rel_spy > 0:
            status = "资金集中"
            action = "优先从龙头里找回踩后的确认线索。"
        elif hot_count >= max(4, strong_count // 2) and rel_spy > 0:
            status = "热度偏高"
            action = "主线很强，但高热度线索要放慢节奏。"
        elif weak_count >= 8 and rel_spy < 0:
            status = "整体落后"
            action = "暂时降低新增观察优先级。"
        else:
            status = "轮动观察"
            action = "有局部线索，还没形成一致主线。"
        theme_rows.append(
            {
                "name": str(theme),
                "status": status,
                "action": action,
                "symbols": " / ".join(leaders["symbol"].tolist()),
                "count": int(len(group)),
                "strongCount": strong_count,
                "hotCount": hot_count,
                "weakCount": weak_count,
                "vsMarket": fmt_pct(rel_spy),
                "return20d": fmt_pct(ret20),
                "leadership": float(strong_count * 2 + max(rel_spy, -20) - hot_count * 0.4 - weak_count * 0.8),
            }
        )
    theme_rows = sorted(theme_rows, key=lambda item: item["leadership"], reverse=True)
    risk_rows = sorted(theme_rows, key=lambda item: (item["weakCount"], -item["leadership"]), reverse=True)
    hot_rows = sorted(theme_rows, key=lambda item: (item["hotCount"], item["leadership"]), reverse=True)
    leader_rows = [item for item in theme_rows if item["status"] != "整体落后"]
    public_rows = [{k: v for k, v in item.items() if k != "leadership"} for item in (leader_rows or theme_rows)[:6]]
    return {
        "leaders": public_rows,
        "risk": [{k: v for k, v in item.items() if k != "leadership"} for item in risk_rows[:4]],
        "hot": [{k: v for k, v in item.items() if k != "leadership"} for item in hot_rows[:4]],
        "summary": "主题强弱按行业代理、领涨数量、相对大盘表现和高热度风险综合整理。",
    }


def build_on_board_map(rows: list[dict], snapshot_dir: Path | None, latest_date: str) -> dict[str, dict]:
    history: list[tuple[str, set[str]]] = []
    if snapshot_dir and snapshot_dir.exists():
        for path in sorted(snapshot_dir.glob("*.json")):
            try:
                snap = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            snap_date = snap.get("asOf")
            if not snap_date or snap_date >= latest_date:
                continue
            symbols = {item.get("symbol") for item in snap.get("rows", []) if item.get("symbol")}
            history.append((snap_date, symbols))

    current_symbols = {row["symbol"] for row in rows}
    result: dict[str, dict] = {}
    for symbol in current_symbols:
        seen_dates = [snap_date for snap_date, symbols in history if symbol in symbols]
        total_days = len(seen_dates) + 1
        streak = 1
        streak_dates: list[str] = []
        for snap_date, symbols in reversed(history):
            if symbol not in symbols:
                break
            streak += 1
            streak_dates.append(snap_date)
        stint_started = streak_dates[-1] if streak_dates else latest_date
        if total_days == 1:
            label = "今日新上榜"
        elif streak > 1:
            label = f"连续 {streak} 天"
        else:
            label = "今日回榜"
        result[symbol] = {
            "label": label,
            "days": streak,
            "streak": streak,
            "totalDays": total_days,
            "firstSeen": stint_started,
        }
    return result


def build_scanner(data_root: Path, output: Path | None, snapshot_dir: Path | None, min_adv: float, limit: int) -> dict:
    current_year = datetime.now().year
    years = [current_year - 1, current_year]
    daily = load_daily(data_root, years)
    latest_date = str(daily["trade_date"].max())
    latest_year = int(latest_date[:4])
    universe = load_latest_universe(data_root, latest_year, latest_date)

    close_panel = daily.pivot(index="trade_date", columns="symbol", values="adj_close").ffill()
    high_panel = daily.pivot(index="trade_date", columns="symbol", values="adj_high").ffill()
    low_panel = daily.pivot(index="trade_date", columns="symbol", values="adj_low").ffill()
    volume_panel = daily.pivot(index="trade_date", columns="symbol", values="adj_volume").fillna(0)

    available_benchmarks = [symbol for symbol in BENCHMARKS if symbol in close_panel.columns]
    missing = [symbol for symbol in ["SPY", "QQQ"] if symbol not in close_panel.columns]
    if missing:
        raise ValueError(f"Missing required benchmark symbols: {', '.join(missing)}")

    tradable = universe[
        (universe["tradable_core"].fillna(False))
        & (universe["close"] >= 5)
        & (universe["median_dollar_volume_20d"].fillna(0) >= min_adv)
    ].copy()
    candidate_symbols = [symbol for symbol in tradable["symbol"] if symbol in close_panel.columns]
    data_count = close_panel[candidate_symbols].notna().sum()
    candidate_symbols = [symbol for symbol in candidate_symbols if data_count.get(symbol, 0) >= 90]

    panel = close_panel[candidate_symbols + [symbol for symbol in available_benchmarks if symbol not in candidate_symbols]].ffill()
    returns = panel.pct_change()
    spy_returns = returns["SPY"]
    spy_var = float(spy_returns.tail(63).var())
    if spy_var:
        tail_returns = returns[candidate_symbols].tail(63)
        tail_spy = spy_returns.tail(63)
        covariance = tail_returns.sub(tail_returns.mean()).multiply(tail_spy - tail_spy.mean(), axis=0).sum() / (tail_returns.count() - 1)
        beta = covariance / spy_var
    else:
        beta = pd.Series(1, index=candidate_symbols)

    ret_1d = pct_change_from(close_panel[candidate_symbols], 1)
    ret_5d = pct_change_from(close_panel[candidate_symbols], 5)
    ret_20d = pct_change_from(close_panel[candidate_symbols], 20)
    ret_63d = pct_change_from(close_panel[candidate_symbols], 63)
    ret_ytd = ytd_return(close_panel[candidate_symbols])
    spy_ret_20 = float(pct_change_from(close_panel[["SPY"]], 20).iloc[0])
    qqq_ret_20 = float(pct_change_from(close_panel[["QQQ"]], 20).iloc[0])

    high_63 = high_panel[candidate_symbols].tail(63).max()
    low_63 = low_panel[candidate_symbols].tail(63).min()
    close_latest = close_panel[candidate_symbols].iloc[-1]
    market_caps = load_market_caps(data_root, close_latest)
    high_latest = high_panel[candidate_symbols].iloc[-1]
    low_latest = low_panel[candidate_symbols].iloc[-1]
    volume_latest = volume_panel[candidate_symbols].iloc[-1]
    dollar_latest = close_latest * volume_latest
    dollar_median = (close_panel[candidate_symbols] * volume_panel[candidate_symbols]).tail(20).median()
    volume_ratio = (dollar_latest / dollar_median.replace(0, np.nan)).clip(0, 9).fillna(1)
    day_close_position = ((close_latest - low_latest) / (high_latest - low_latest).replace(0, np.nan)).fillna(0.5)

    sector_returns = {}
    sector_labels = {}
    etf_returns = returns[[symbol for symbol in SECTOR_ETFS if symbol in returns.columns]].tail(63)
    stock_returns = returns[candidate_symbols].tail(63)
    for symbol in candidate_symbols:
        correlations = etf_returns.corrwith(stock_returns[symbol]).dropna()
        proxy = correlations.idxmax() if not correlations.empty else "SPY"
        sector_labels[symbol] = f"{proxy} {SECTOR_ETFS.get(proxy, '大盘')}"
        if proxy in close_panel.columns:
            sector_returns[symbol] = float(pct_change_from(close_panel[[proxy]], 20).iloc[0])
        else:
            sector_returns[symbol] = spy_ret_20
    sector_return_series = pd.Series(sector_returns)

    work = pd.DataFrame(
        {
            "symbol": candidate_symbols,
            "price": close_latest,
            "ret_1d": ret_1d,
            "ret_5d": ret_5d,
            "ret_20d": ret_20d,
            "ret_63d": ret_63d,
            "ret_ytd": ret_ytd,
            "beta": beta.reindex(candidate_symbols).fillna(1),
            "rel_spy_20d": ret_20d - spy_ret_20,
            "rel_qqq_20d": ret_20d - qqq_ret_20,
            "rel_sector_20d": ret_20d - sector_return_series.reindex(candidate_symbols),
            "high_63": high_63,
            "low_63": low_63,
            "volume_ratio": volume_ratio,
            "dollar_volume": dollar_latest,
            "day_close_position": day_close_position,
        }
    )
    work["residual_20d"] = work["ret_20d"] - work["beta"] * spy_ret_20
    work["distance_to_high"] = (work["price"] / work["high_63"] - 1) * 100
    work["range_position"] = ((work["price"] - work["low_63"]) / (work["high_63"] - work["low_63"]).replace(0, np.nan)).fillna(0.5)
    work["breakout_score"] = (
        62 * work["range_position"].clip(0, 1)
        + 18 * (work["distance_to_high"] >= -2).astype(int)
        + 12 * (work["volume_ratio"] >= 1.35).astype(int)
        + 8 * (work["day_close_position"] >= 0.6).astype(int)
    ).clip(0, 100)
    ma20_distance = (work["price"] / close_panel[candidate_symbols].tail(20).mean().reindex(work["symbol"]).to_numpy() - 1)
    ma20_distance_rank = percentile(pd.Series(ma20_distance, index=work.index))
    work["crowding_score"] = (
        28 * np.log1p(work["volume_ratio"]).clip(0, 2)
        + 22 * percentile(work["ret_5d"].abs()) / 100
        + 22 * ma20_distance_rank / 100
        + 28 * (work["ret_5d"] > 8).astype(int)
    ).clip(0, 100)
    work["liquidity_score"] = percentile(np.log10(work["dollar_volume"].clip(lower=1)))
    work["strength_score"] = (
        0.34 * percentile(work["residual_20d"])
        + 0.18 * percentile(work["rel_spy_20d"])
        + 0.12 * percentile(work["rel_qqq_20d"])
        + 0.11 * percentile(work["rel_sector_20d"])
        + 0.17 * work["breakout_score"]
        + 0.08 * work["liquidity_score"]
    ).round(0).clip(1, 99)
    work["sector_proxy"] = work["symbol"].map(sector_labels).fillna("SPY 大盘")
    meta = tradable.set_index("symbol")
    work["name"] = work["symbol"].map(meta["name"]).fillna(work["symbol"])
    work["exchange"] = work["symbol"].map(meta["primary_exchange"]).fillna("--")
    work["market_cap"] = work["symbol"].map(market_caps)
    work = work.dropna(subset=["strength_score", "ret_20d"]).copy()

    labels = work.apply(label_for, axis=1, result_type="expand")
    work["label"] = labels[0]
    work["action"] = labels[1]
    work["primaryFactor"] = labels[2]
    themes = build_theme_summary(work)

    strongest = work.sort_values("strength_score", ascending=False).head(limit).copy()
    weakest = work.sort_values("strength_score", ascending=True).head(limit).copy()
    watchlist = work[
        ((work["strength_score"].between(54, 76)) & (work["breakout_score"] >= 58))
        | ((work["strength_score"] >= 76) & (work["crowding_score"] >= 72))
    ].sort_values(["strength_score", "breakout_score"], ascending=False).head(limit).copy()

    def to_rows(df: pd.DataFrame, bucket: str) -> list[dict]:
        rows = []
        for rank, row in enumerate(df.itertuples(index=False), start=1):
            rows.append(
                {
                    "rank": rank,
                    "bucket": bucket,
                    "symbol": row.symbol,
                    "name": row.name,
                    "exchange": row.exchange,
                    "price": round(float(row.price), 2),
                    "score": int(row.strength_score),
                    "label": row.label,
                    "action": row.action,
                    "primaryFactor": row.primaryFactor,
                    "sectorProxy": row.sector_proxy,
                    "relative": {
                        "spy": fmt_pct(row.rel_spy_20d),
                        "qqq": fmt_pct(row.rel_qqq_20d),
                        "sector": fmt_pct(row.rel_sector_20d),
                    },
                    "periods": {
                        "1d": fmt_pct(row.ret_1d),
                        "5d": fmt_pct(row.ret_5d),
                        "20d": fmt_pct(row.ret_20d),
                        "63d": fmt_pct(row.ret_63d),
                    },
                    "breakout": {
                        "score": int(round(float(row.breakout_score))),
                        "distanceToHigh": fmt_pct(row.distance_to_high),
                    },
                    "crowding": {
                        "score": int(round(float(row.crowding_score))),
                        "volumeRatio": f"{float(row.volume_ratio):.1f}x",
                    },
                    "liquidity": fmt_money(row.dollar_volume),
                    "marketCap": fmt_market_cap(row.market_cap),
                }
            )
        return rows

    rows = to_rows(strongest, "strongest") + to_rows(weakest, "weakest") + to_rows(watchlist, "watchlist")
    on_board_map = build_on_board_map(rows, snapshot_dir, latest_date)
    for row in rows:
        row["onBoard"] = on_board_map.get(
            row["symbol"],
            {"label": "今日新上榜", "days": 1, "streak": 1, "firstSeen": latest_date},
        )
    snapshot_rows = [
        {
            "symbol": row["symbol"],
            "bucket": row["bucket"],
            "score": row["score"],
            "label": row["label"],
            "primaryFactor": row["primaryFactor"],
            "onBoard": row["onBoard"],
        }
        for row in rows
    ]

    review = (
        build_review(snapshot_dir, latest_date, close_panel, close_panel["SPY"])
        if snapshot_dir
        else {"summary": "", "labels": [], "factors": []}
    )
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "asOf": latest_date,
        "universe": {
            "total": int(len(work)),
            "filtered": int(len(universe)),
            "minAdv": fmt_money(min_adv),
            "rules": ["普通股/ADR", "主交易所", "价格 >= $5", f"20日成交额中位数 >= {fmt_money(min_adv)}", "至少90个交易日历史"],
        },
        "benchmarks": {
            "spy20d": fmt_pct(spy_ret_20),
            "qqq20d": fmt_pct(qqq_ret_20),
        },
        "summary": {
            "leader": strongest.iloc[0]["symbol"] if not strongest.empty else "--",
            "leaderScore": int(strongest.iloc[0]["strength_score"]) if not strongest.empty else None,
            "weakest": weakest.iloc[0]["symbol"] if not weakest.empty else "--",
            "weakestScore": int(weakest.iloc[0]["strength_score"]) if not weakest.empty else None,
            "medianScore": int(work["strength_score"].median()),
            "hotCrowdingCount": int((work["crowding_score"] >= 72).sum()),
        },
        "rows": rows,
        "themes": themes,
        "review": review,
        "method": [
            "先看“优先研究”前 10，只挑你熟悉、流动性好的股票继续研究。",
            "看到“强但偏热”，默认等回踩或分歧，不把它当成立刻行动信号。",
            "“风险回避”里的股票，除非有新的基本面变化，否则只做低频复盘。",
        ],
    }

    if output is not None:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if snapshot_dir is not None:
        snapshot_dir.mkdir(parents=True, exist_ok=True)
        snapshot_path = snapshot_dir / f"{latest_date}.json"
        snapshot_path.write_text(
            json.dumps({"asOf": latest_date, "generatedAt": payload["generatedAt"], "rows": snapshot_rows}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--snapshot-dir", type=Path, default=Path(".tmp/strength-snapshots"))
    parser.add_argument("--min-adv", type=float, default=5_000_000)
    parser.add_argument("--limit", type=int, default=40)
    args = parser.parse_args()

    payload = build_scanner(args.data_root, args.output, args.snapshot_dir, args.min_adv, args.limit)
    target = f"Wrote {args.output}" if args.output else "Built strength scanner"
    print(f"{target} as of {payload['asOf']} with {payload['universe']['total']} symbols")


if __name__ == "__main__":
    main()

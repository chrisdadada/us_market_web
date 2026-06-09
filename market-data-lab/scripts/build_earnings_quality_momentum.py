from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

from common import data_path, load_env, parse_date, write_parquet


def latest_universe(asof: date) -> pd.DataFrame:
    path = data_path("features", "polygon", "universe", "daily_tradable_universe_by_year", f"universe_{asof.year}.parquet")
    df = pd.read_parquet(path)
    df["trade_date"] = pd.to_datetime(df["trade_date"]).dt.date
    latest_date = max(day for day in df["trade_date"].unique() if day <= asof)
    cols = [
        "symbol",
        "trade_date",
        "name",
        "type",
        "close",
        "median_dollar_volume_20d",
        "median_volume_20d",
        "return_20d",
        "tradable_core",
        "is_common_or_adr",
    ]
    return df[df["trade_date"].eq(latest_date)][cols].rename(columns={"symbol": "ticker"})


def load_events(start: date, asof: date) -> pd.DataFrame:
    path = data_path("features", "polygon", "monetizable_signals", "event_signals.parquet")
    if not path.exists():
        raise SystemExit("Missing event_signals.parquet. Run build_monetizable_signals.py first.")
    df = pd.read_parquet(path)
    df["event_date"] = pd.to_datetime(df["event_date"]).dt.date
    return df[(df["event_date"] >= start) & (df["event_date"] <= asof)].copy()


def load_analyst_heat() -> pd.DataFrame:
    path = data_path("reports", "analyst_product", "analyst_heat_30d_liquid.csv")
    if not path.exists():
        return pd.DataFrame(columns=["ticker", "analyst_heat_score", "events_30d", "firms_30d", "avg_price_target_upside"])
    cols = ["ticker", "analyst_heat_score", "events_30d", "firms_30d", "avg_price_target_upside"]
    return pd.read_csv(path, usecols=lambda col: col in cols).drop_duplicates("ticker")


def summarize_quality(events: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for ticker, group in events.groupby("ticker", sort=False):
        earnings = group[group["event_family"].eq("earnings")]
        guidance = group[group["event_family"].eq("guidance")]
        analyst = group[group["event_family"].eq("analyst")]

        earnings_beat = earnings[earnings["signal"].eq("earnings_beat")]
        guidance_up = guidance[guidance["signal"].eq("guidance_up")]
        guidance_down = guidance[guidance["signal"].eq("guidance_down")]
        earnings_miss = earnings[earnings["signal"].eq("earnings_miss")]

        latest_group = group.sort_values("event_date")
        latest = latest_group.tail(1).iloc[0]
        latest_earnings = earnings.sort_values("event_date").tail(1)
        latest_guidance = guidance.sort_values("event_date").tail(1)

        eps_surprise = earnings_beat["eps_surprise_percent"].replace([np.inf, -np.inf], np.nan).max()
        revenue_surprise = earnings_beat["revenue_surprise_percent"].replace([np.inf, -np.inf], np.nan).max()
        eps_revision = guidance_up["eps_revision_pct"].replace([np.inf, -np.inf], np.nan).max()
        revenue_revision = guidance_up["revenue_revision_pct"].replace([np.inf, -np.inf], np.nan).max()

        rows.append(
            {
                "ticker": ticker,
                "company_name": latest.get("company_name"),
                "latest_event_date": latest.get("event_date"),
                "earnings_beat_count": len(earnings_beat),
                "earnings_miss_count": len(earnings_miss),
                "guidance_up_count": len(guidance_up),
                "guidance_down_count": len(guidance_down),
                "analyst_positive_count": int(analyst["signal"].eq("analyst_positive").sum()),
                "analyst_negative_count": int(analyst["signal"].eq("analyst_negative").sum()),
                "max_eps_surprise_pct": eps_surprise,
                "max_revenue_surprise_pct": revenue_surprise,
                "max_eps_revision_pct": eps_revision,
                "max_revenue_revision_pct": revenue_revision,
                "latest_earnings_date": latest_earnings["event_date"].iloc[0] if not latest_earnings.empty else pd.NA,
                "latest_guidance_date": latest_guidance["event_date"].iloc[0] if not latest_guidance.empty else pd.NA,
                "latest_earnings_score": latest_earnings["signal_score"].iloc[0] if not latest_earnings.empty else np.nan,
                "latest_guidance_score": latest_guidance["signal_score"].iloc[0] if not latest_guidance.empty else np.nan,
            }
        )
    return pd.DataFrame(rows)


def score_board(board: pd.DataFrame) -> pd.DataFrame:
    df = board.copy()
    df["earnings_quality_score"] = (
        1.4 * df["guidance_up_count"].fillna(0)
        - 1.2 * df["guidance_down_count"].fillna(0)
        + 1.0 * df["earnings_beat_count"].fillna(0)
        - 1.0 * df["earnings_miss_count"].fillna(0)
        + np.clip(df["max_eps_revision_pct"].fillna(0), -1, 1)
        + 0.5 * np.clip(df["max_revenue_revision_pct"].fillna(0), -1, 1)
        + 0.8 * np.clip(df["max_eps_surprise_pct"].fillna(0), -1, 1)
        + 0.4 * np.clip(df["max_revenue_surprise_pct"].fillna(0), -1, 1)
    )
    df["momentum_score"] = np.clip(df["return_20d"].fillna(0), -0.5, 0.5) * 3.0
    df["analyst_score"] = (
        0.15 * df["analyst_heat_score"].fillna(0)
        + 0.3 * df["analyst_positive_count"].fillna(0)
        - 0.5 * df["analyst_negative_count"].fillna(0)
    )
    df["liquidity_score"] = np.log10(df["median_dollar_volume_20d"].fillna(1).clip(lower=1)) / 10.0
    df["earnings_quality_momentum_score"] = (
        df["earnings_quality_score"]
        + df["momentum_score"]
        + df["liquidity_score"]
    )
    df["wall_street_confluence_score"] = (
        df["earnings_quality_momentum_score"]
        + df["analyst_score"]
        + df["liquidity_score"]
    )
    df["has_quality_catalyst"] = (df["guidance_up_count"] > 0) | (df["earnings_beat_count"] > 0)
    df["negative_catalyst_count"] = df["guidance_down_count"].fillna(0) + df["earnings_miss_count"].fillna(0)
    df["user_reason"] = df.apply(user_reason, axis=1)
    df["user_risk"] = df.apply(user_risk, axis=1)
    df["user_angle"] = df.apply(user_angle, axis=1)
    return df.sort_values("wall_street_confluence_score", ascending=False)


def pct_text(value: object) -> str:
    if pd.isna(value):
        return ""
    return f"{float(value):.1%}"


def user_reason(row: pd.Series) -> str:
    parts = []
    if row.get("guidance_up_count", 0) > 0:
        detail = pct_text(row.get("max_eps_revision_pct")) or pct_text(row.get("max_revenue_revision_pct"))
        parts.append(f"指引上修{f'，幅度约{detail}' if detail else ''}")
    if row.get("earnings_beat_count", 0) > 0:
        detail = pct_text(row.get("max_eps_surprise_pct")) or pct_text(row.get("max_revenue_surprise_pct"))
        parts.append(f"财报超预期{f'，幅度约{detail}' if detail else ''}")
    if row.get("return_20d", 0) > 0:
        parts.append(f"20日趋势向上 {float(row.get('return_20d', 0)):.1%}")
    if row.get("analyst_heat_score", 0) > 0:
        parts.append(f"分析师关注度高，近30日热度 {float(row.get('analyst_heat_score', 0)):.1f}")
    return "；".join(parts[:4])


def user_risk(row: pd.Series) -> str:
    risks = []
    if row.get("guidance_down_count", 0) > 0:
        risks.append("同时出现过指引下修")
    if row.get("earnings_miss_count", 0) > 0:
        risks.append("同时出现过财报不及预期")
    if row.get("return_20d", 0) > 0.5:
        risks.append("短期涨幅很大，追高风险")
    if row.get("analyst_negative_count", 0) > 0:
        risks.append("存在负面分析师动作")
    return "；".join(risks) if risks else "暂无明显负面事件，仍需看估值和大盘环境"


def user_angle(row: pd.Series) -> str:
    if row.get("guidance_up_count", 0) > 0 and row.get("earnings_beat_count", 0) > 0:
        return "财报后趋势跟踪"
    if row.get("guidance_up_count", 0) > 0:
        return "指引改善"
    if row.get("earnings_beat_count", 0) > 0 and row.get("analyst_heat_score", 0) > 5:
        return "财报超预期 + 华尔街关注"
    return "财报超预期"


def display_columns(df: pd.DataFrame, score_col: str) -> pd.DataFrame:
    cols = [
        "ticker",
        "name",
        "company_name",
        score_col,
        "earnings_quality_momentum_score",
        "wall_street_confluence_score",
        "user_angle",
        "user_reason",
        "user_risk",
        "guidance_up_count",
        "earnings_beat_count",
        "guidance_down_count",
        "earnings_miss_count",
        "max_eps_revision_pct",
        "max_revenue_revision_pct",
        "max_eps_surprise_pct",
        "max_revenue_surprise_pct",
        "return_20d",
        "analyst_heat_score",
        "events_30d",
        "firms_30d",
        "avg_price_target_upside",
        "close",
        "median_dollar_volume_20d",
        "latest_earnings_date",
        "latest_guidance_date",
    ]
    return df[[col for col in cols if col in df.columns]].copy()


def write_report(
    out_dir,
    quality_board: pd.DataFrame,
    confluence_board: pd.DataFrame,
    asof: date,
    lookback_days: int,
) -> None:
    report = out_dir / "earnings_quality_momentum_report.md"
    lines = [
        "# Earnings Quality Momentum Report",
        "",
        f"Generated at UTC: {datetime.now(timezone.utc).isoformat()}",
        f"As of: {asof}",
        f"Lookback days: {lookback_days}",
        "",
        "## Board Summary",
        "",
        f"- quality momentum candidates: {len(quality_board):,}",
        f"- wall street confluence candidates: {len(confluence_board):,}",
        "",
        "## 财报质量动量榜 Top 15",
        "",
        "| ticker | name | score | guidance_up | earnings_beat | return_20d | reason |",
        "|---|---|---:|---:|---:|---:|---|",
    ]
    for row in quality_board.head(15).itertuples(index=False):
        lines.append(
            f"| {row.ticker} | {str(row.name)[:40]} | {row.earnings_quality_momentum_score:.2f} | "
            f"{int(row.guidance_up_count)} | {int(row.earnings_beat_count)} | {row.return_20d:.2%} | "
            f"{str(row.user_reason)[:60]} |"
        )
    lines += [
        "",
        "## 华尔街共振榜 Top 15",
        "",
        "| ticker | name | score | analyst_heat | firms_30d | return_20d | reason |",
        "|---|---|---:|---:|---:|---:|---|",
    ]
    for row in confluence_board.head(15).itertuples(index=False):
        lines.append(
            f"| {row.ticker} | {str(row.name)[:40]} | {row.wall_street_confluence_score:.2f} | "
            f"{row.analyst_heat_score if pd.notna(row.analyst_heat_score) else 0:.2f} | "
            f"{int(row.firms_30d) if pd.notna(row.firms_30d) else 0} | {row.return_20d:.2%} | "
            f"{str(row.user_reason)[:60]} |"
        )
    lines += [
        "",
        "## Output Files",
        "",
        "- earnings_quality_momentum_core.csv",
        "- wall_street_confluence.csv",
        "- earnings_quality_momentum_full.csv",
        "- earnings_quality_momentum.parquet",
    ]
    report.write_text("\n".join(lines) + "\n")


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--asof", default="2026-05-11")
    parser.add_argument("--lookback-days", type=int, default=45)
    parser.add_argument("--min-dollar-volume", type=float, default=20_000_000)
    parser.add_argument("--min-price", type=float, default=5.0)
    args = parser.parse_args()

    asof = parse_date(args.asof, date.today())
    start = asof - timedelta(days=args.lookback_days)
    events = load_events(start, asof)
    quality = summarize_quality(events)
    universe = latest_universe(asof)
    analyst_heat = load_analyst_heat()
    board = quality.merge(universe, on="ticker", how="left").merge(analyst_heat, on="ticker", how="left")
    board = board[
        board["tradable_core"].fillna(False)
        & board["is_common_or_adr"].fillna(False)
    ].copy()
    board = score_board(board)
    board = board[board["has_quality_catalyst"].fillna(False)].copy()
    liquid_base = board[
        (board["median_dollar_volume_20d"] >= args.min_dollar_volume)
        & (board["close"] >= args.min_price)
        & (board["negative_catalyst_count"] <= 1)
    ].copy()
    quality_board = liquid_base.sort_values("earnings_quality_momentum_score", ascending=False)
    confluence_board = liquid_base[
        (liquid_base["analyst_heat_score"].fillna(0) > 0)
        | (liquid_base["analyst_positive_count"].fillna(0) > 0)
    ].sort_values("wall_street_confluence_score", ascending=False)

    out_dir = data_path("reports", "earnings_quality_momentum")
    out_dir.mkdir(parents=True, exist_ok=True)
    feature_dir = data_path("features", "polygon", "earnings_quality_momentum")
    feature_dir.mkdir(parents=True, exist_ok=True)
    write_parquet(board, feature_dir / "earnings_quality_momentum.parquet")
    board.to_csv(out_dir / "earnings_quality_momentum_full.csv", index=False)
    display_columns(quality_board, "earnings_quality_momentum_score").to_csv(
        out_dir / "earnings_quality_momentum_core.csv", index=False
    )
    display_columns(confluence_board, "wall_street_confluence_score").to_csv(
        out_dir / "wall_street_confluence.csv", index=False
    )
    # Backward-compatible aliases for earlier notebooks/reports.
    board.to_csv(out_dir / "earnings_quality_momentum.csv", index=False)
    display_columns(quality_board, "earnings_quality_momentum_score").to_csv(
        out_dir / "earnings_quality_momentum_liquid.csv", index=False
    )
    write_report(out_dir, quality_board, confluence_board, asof, args.lookback_days)
    print(out_dir / "earnings_quality_momentum_report.md", flush=True)


if __name__ == "__main__":
    main()

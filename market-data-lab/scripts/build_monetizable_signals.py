from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from common import data_path, load_env, parse_date, write_parquet


HORIZONS = [5, 20, 60]


def parquet_files(path: Path) -> list[Path]:
    return sorted(file for file in path.glob("*.parquet") if not file.name.startswith("._"))


def read_dataset(name: str) -> pd.DataFrame:
    folder = data_path("raw", "polygon_rest", name)
    files = parquet_files(folder)
    if not files:
        return pd.DataFrame()
    return pd.concat((pd.read_parquet(file) for file in files), ignore_index=True)


def year_files(root: Path, start: date, end: date) -> list[Path]:
    files: list[Path] = []
    for path in root.glob("*.parquet"):
        if path.name.startswith("._"):
            continue
        year = int(path.stem.rsplit("_", 1)[-1])
        if start.year <= year <= end.year:
            files.append(path)
    return sorted(files)


def load_daily(start: date, end: date) -> pd.DataFrame:
    root = data_path("processed", "polygon", "stocks_split_adjusted", "1d")
    files = year_files(root, start, end)
    daily = pd.concat(
        (
            pd.read_parquet(file, columns=["symbol", "trade_date", "adj_open", "adj_close", "adj_volume"])
            for file in files
        ),
        ignore_index=True,
    )
    daily["trade_date"] = pd.to_datetime(daily["trade_date"]).dt.date
    daily = daily[(daily["trade_date"] >= start) & (daily["trade_date"] <= end)].copy()
    daily = daily.sort_values(["symbol", "trade_date"])
    grouped = daily.groupby("symbol", sort=False)
    for horizon in HORIZONS:
        daily[f"fwd_{horizon}d"] = grouped["adj_close"].shift(-horizon) / daily["adj_close"] - 1.0
    daily["return_20d"] = grouped["adj_close"].pct_change(20)
    return daily


def load_latest_universe(asof: date) -> pd.DataFrame:
    root = data_path("features", "polygon", "universe", "daily_tradable_universe_by_year")
    file = root / f"universe_{asof.year}.parquet"
    df = pd.read_parquet(file)
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


def attach_forward_returns(events: pd.DataFrame, daily: pd.DataFrame) -> pd.DataFrame:
    if events.empty:
        return events
    events = events.copy()
    events["event_date"] = pd.to_datetime(events["event_date"])
    daily_cols = ["symbol", "trade_date", "adj_close", "return_20d"] + [f"fwd_{h}d" for h in HORIZONS]
    daily = daily[daily_cols].rename(columns={"symbol": "ticker"})
    daily["trade_date"] = pd.to_datetime(daily["trade_date"])

    frames = []
    price_groups = {ticker: group.sort_values("trade_date") for ticker, group in daily.groupby("ticker", sort=False)}
    for ticker, event_group in events.groupby("ticker", sort=False):
        price_group = price_groups.get(ticker)
        if price_group is None or price_group.empty:
            continue
        dates = price_group["trade_date"].to_numpy(dtype="datetime64[ns]")
        event_dates = event_group["event_date"].to_numpy(dtype="datetime64[ns]")
        idx = np.searchsorted(dates, event_dates, side="left")
        valid = idx < len(dates)
        if not valid.any():
            continue
        selected = price_group.iloc[idx[valid]].reset_index(drop=True)
        merged = event_group.loc[event_group.index[valid]].reset_index(drop=True).copy()
        merged["trade_date"] = selected["trade_date"].to_numpy()
        merged["adj_close"] = selected["adj_close"].to_numpy()
        merged["return_20d"] = selected["return_20d"].to_numpy()
        for horizon in HORIZONS:
            merged[f"fwd_{horizon}d"] = selected[f"fwd_{horizon}d"].to_numpy()
        frames.append(merged)
    return pd.concat(frames, ignore_index=True) if frames else events.iloc[0:0].copy()


def rating_value(rating: object) -> float:
    if pd.isna(rating):
        return 0.0
    text = str(rating).lower().strip()
    positive = ["strong buy", "buy", "outperform", "overweight", "market outperform", "sector outperform"]
    negative = ["sell", "underperform", "underweight", "market underperform", "sector underperform"]
    neutral = ["hold", "neutral", "equal-weight", "market perform", "sector perform"]
    if any(item == text for item in positive):
        return 1.0
    if any(item == text for item in negative):
        return -1.0
    if any(item == text for item in neutral):
        return 0.0
    return 0.0


def build_analyst_events(daily: pd.DataFrame) -> pd.DataFrame:
    df = read_dataset("analyst_insights")
    if df.empty:
        return df
    df["event_date"] = pd.to_datetime(df["date"]).dt.date
    df = df.drop_duplicates(subset=["benzinga_id"]).copy()
    df["rating_score"] = df["rating"].map(rating_value)
    action = df["rating_action"].astype(str).str.lower()
    df["action_score"] = np.select(
        [
            action.eq("upgrades"),
            action.eq("downgrades"),
            action.isin(["initiates_coverage_on", "reinstates"]),
            action.isin(["maintains", "reiterates", "assumes"]),
        ],
        [2.0, -2.0, df["rating_score"], 0.5 * df["rating_score"]],
        default=0.0,
    )
    events = attach_forward_returns(
        df[
            [
                "ticker",
                "event_date",
                "company_name",
                "firm",
                "rating_action",
                "rating",
                "price_target",
                "rating_score",
                "action_score",
                "insight",
                "last_updated",
                "benzinga_id",
            ]
        ].copy(),
        daily,
    )
    events["price_target_upside"] = events["price_target"] / events["adj_close"] - 1.0
    events["signal_score"] = (
        events["action_score"].fillna(0.0)
        + events["rating_score"].fillna(0.0)
        + np.clip(events["price_target_upside"].fillna(0.0), -1.0, 1.0)
    )
    events["event_family"] = "analyst"
    events["signal"] = np.where(events["signal_score"] >= 1.5, "analyst_positive", "")
    events.loc[events["signal_score"] <= -1.0, "signal"] = "analyst_negative"
    return events


def midpoint(df: pd.DataFrame, low: str, high: str, estimate: str) -> pd.Series:
    lo = pd.to_numeric(df.get(low), errors="coerce")
    hi = pd.to_numeric(df.get(high), errors="coerce")
    est = pd.to_numeric(df.get(estimate), errors="coerce")
    return ((lo + hi) / 2.0).fillna(est).fillna(lo).fillna(hi)


def pct_revision(current: pd.Series, previous: pd.Series) -> pd.Series:
    denom = previous.abs().replace(0, np.nan)
    return (current - previous) / denom


def build_guidance_events(daily: pd.DataFrame) -> pd.DataFrame:
    df = read_dataset("guidance")
    if df.empty:
        return df
    df["event_date"] = pd.to_datetime(df["date"]).dt.date
    df = df.sort_values("last_updated").drop_duplicates(subset=["benzinga_id"], keep="last").copy()
    df["eps_mid"] = midpoint(df, "min_eps_guidance", "max_eps_guidance", "estimated_eps_guidance")
    df["prev_eps_mid"] = midpoint(df, "previous_min_eps_guidance", "previous_max_eps_guidance", "estimated_eps_guidance")
    df["revenue_mid"] = midpoint(
        df, "min_revenue_guidance", "max_revenue_guidance", "estimated_revenue_guidance"
    )
    df["prev_revenue_mid"] = midpoint(
        df, "previous_min_revenue_guidance", "previous_max_revenue_guidance", "estimated_revenue_guidance"
    )
    df["eps_revision_pct"] = pct_revision(df["eps_mid"], df["prev_eps_mid"])
    df["revenue_revision_pct"] = pct_revision(df["revenue_mid"], df["prev_revenue_mid"])
    events = attach_forward_returns(
        df[
            [
                "ticker",
                "event_date",
                "company_name",
                "importance",
                "fiscal_period",
                "fiscal_year",
                "release_type",
                "positioning",
                "eps_mid",
                "prev_eps_mid",
                "eps_revision_pct",
                "revenue_mid",
                "prev_revenue_mid",
                "revenue_revision_pct",
                "last_updated",
                "benzinga_id",
            ]
        ].copy(),
        daily,
    )
    events["signal_score"] = (
        np.clip(events["eps_revision_pct"].fillna(0.0), -1.0, 1.0)
        + 0.5 * np.clip(events["revenue_revision_pct"].fillna(0.0), -1.0, 1.0)
        + 0.1 * events["importance"].fillna(0.0)
    )
    events["event_family"] = "guidance"
    events["signal"] = ""
    events.loc[(events["eps_revision_pct"] >= 0.05) | (events["revenue_revision_pct"] >= 0.03), "signal"] = "guidance_up"
    events.loc[(events["eps_revision_pct"] <= -0.05) | (events["revenue_revision_pct"] <= -0.03), "signal"] = "guidance_down"
    return events


def build_earnings_events(daily: pd.DataFrame) -> pd.DataFrame:
    df = read_dataset("earnings")
    if df.empty:
        return df
    df["event_date"] = pd.to_datetime(df["date"]).dt.date
    df = df.sort_values("last_updated").drop_duplicates(subset=["benzinga_id"], keep="last").copy()
    events = attach_forward_returns(
        df[
            [
                "ticker",
                "event_date",
                "company_name",
                "importance",
                "date_status",
                "fiscal_period",
                "fiscal_year",
                "actual_eps",
                "estimated_eps",
                "eps_surprise_percent",
                "actual_revenue",
                "estimated_revenue",
                "revenue_surprise_percent",
                "last_updated",
                "benzinga_id",
            ]
        ].copy(),
        daily,
    )
    events["signal_score"] = (
        np.clip(events["eps_surprise_percent"].fillna(0.0), -1.0, 1.0)
        + 0.5 * np.clip(events["revenue_surprise_percent"].fillna(0.0), -1.0, 1.0)
        + 0.1 * events["importance"].fillna(0.0)
    )
    events["event_family"] = "earnings"
    events["signal"] = ""
    events.loc[(events["eps_surprise_percent"] >= 0.10) | (events["revenue_surprise_percent"] >= 0.05), "signal"] = "earnings_beat"
    events.loc[(events["eps_surprise_percent"] <= -0.10) | (events["revenue_surprise_percent"] <= -0.05), "signal"] = "earnings_miss"
    return events


def build_short_interest_events(daily: pd.DataFrame) -> pd.DataFrame:
    df = read_dataset("short_interest")
    if df.empty:
        return df
    df["event_date"] = pd.to_datetime(df["settlement_date"]).dt.date
    df = df.sort_values(["ticker", "event_date"]).drop_duplicates(subset=["ticker", "event_date"], keep="last")
    grouped = df.groupby("ticker", sort=False)
    df["prev_short_interest"] = grouped["short_interest"].shift(1)
    df["short_interest_change_pct"] = df["short_interest"] / df["prev_short_interest"] - 1.0
    events = attach_forward_returns(
        df[
            [
                "ticker",
                "event_date",
                "short_interest",
                "prev_short_interest",
                "short_interest_change_pct",
                "avg_daily_volume",
                "days_to_cover",
            ]
        ].copy(),
        daily,
    )
    events["signal_score"] = (
        np.clip(events["short_interest_change_pct"].fillna(0.0), -1.0, 1.0)
        + 0.15 * events["days_to_cover"].fillna(0.0)
        + events["return_20d"].fillna(0.0)
    )
    events["event_family"] = "short_interest"
    events["signal"] = ""
    events.loc[
        (events["days_to_cover"] >= 5)
        & (events["short_interest_change_pct"] >= 0.10)
        & (events["return_20d"] > 0),
        "signal",
    ] = "squeeze_watch"
    events.loc[
        (events["days_to_cover"] >= 5) & (events["short_interest_change_pct"] >= 0.10),
        "signal",
    ] = events["signal"].replace("", "short_pressure_up")
    return events


def event_stats(events: pd.DataFrame, start: date, end: date) -> pd.DataFrame:
    start_ts = pd.Timestamp(start)
    end_ts = pd.Timestamp(end)
    sample = events[
        (events["event_date"] >= start_ts)
        & (events["event_date"] <= end_ts)
        & events["signal"].astype(str).ne("")
    ].copy()
    rows = []
    for (family, signal), group in sample.groupby(["event_family", "signal"], dropna=False):
        for horizon in HORIZONS:
            ret = group[f"fwd_{horizon}d"].replace([np.inf, -np.inf], np.nan).dropna()
            rows.append(
                {
                    "event_family": family,
                    "signal": signal,
                    "horizon": f"{horizon}d",
                    "count": int(ret.shape[0]),
                    "mean": float(ret.mean()) if not ret.empty else np.nan,
                    "median": float(ret.median()) if not ret.empty else np.nan,
                    "win_rate": float((ret > 0).mean()) if not ret.empty else np.nan,
                    "p25": float(ret.quantile(0.25)) if not ret.empty else np.nan,
                    "p75": float(ret.quantile(0.75)) if not ret.empty else np.nan,
                }
            )
    return pd.DataFrame(rows)


def recent_window(df: pd.DataFrame, asof: date, days: int) -> pd.DataFrame:
    start = pd.Timestamp(asof - timedelta(days=days))
    end = pd.Timestamp(asof)
    return df[(df["event_date"] >= start) & (df["event_date"] <= end)].copy()


def write_outputs(events: pd.DataFrame, stats: pd.DataFrame, latest: pd.DataFrame, asof: date) -> Path:
    out_dir = data_path("reports", "monetizable_signals")
    out_dir.mkdir(parents=True, exist_ok=True)
    feature_dir = data_path("features", "polygon", "monetizable_signals")
    feature_dir.mkdir(parents=True, exist_ok=True)

    write_parquet(events, feature_dir / "event_signals.parquet")
    stats.to_csv(out_dir / "event_signal_forward_stats.csv", index=False)

    def enrich(frame: pd.DataFrame) -> pd.DataFrame:
        merged = frame.merge(latest, on="ticker", how="left")
        return merged[
            merged["tradable_core"].fillna(False) & merged["is_common_or_adr"].fillna(False)
        ].copy()

    analyst = recent_window(events[events["event_family"].eq("analyst")], asof, 30)
    analyst = analyst[analyst["signal"].eq("analyst_positive")].sort_values("signal_score", ascending=False)
    enrich(analyst).head(100).to_csv(out_dir / "analyst_positive_top.csv", index=False)

    guidance = recent_window(events[events["event_family"].eq("guidance")], asof, 30)
    guidance = guidance[guidance["signal"].eq("guidance_up")].sort_values("signal_score", ascending=False)
    enrich(guidance).head(100).to_csv(out_dir / "guidance_up_top.csv", index=False)

    earnings = recent_window(events[events["event_family"].eq("earnings")], asof, 30)
    earnings = earnings[earnings["signal"].eq("earnings_beat")].sort_values("signal_score", ascending=False)
    enrich(earnings).head(100).to_csv(out_dir / "earnings_beat_top.csv", index=False)

    short_interest = events[events["event_family"].eq("short_interest")].copy()
    latest_si_date = short_interest["event_date"].max()
    squeeze = short_interest[short_interest["event_date"].eq(latest_si_date)]
    squeeze = squeeze[squeeze["signal"].isin(["squeeze_watch", "short_pressure_up"])].sort_values(
        "signal_score", ascending=False
    )
    enrich(squeeze).head(100).to_csv(out_dir / "short_squeeze_candidates.csv", index=False)

    report = out_dir / "monetizable_signals_report.md"
    lines = [
        "# Monetizable Signals Report",
        "",
        f"Generated at UTC: {datetime.now(timezone.utc).isoformat()}",
        f"As of: {asof}",
        "",
        "## Inventory",
        "",
        f"- event rows: {len(events):,}",
        f"- non-empty signal rows: {int(events['signal'].astype(str).ne('').sum()):,}",
        f"- stats rows: {len(stats):,}",
        "",
        "## Best 20d Buckets",
        "",
        "| event_family | signal | count | mean | win_rate |",
        "|---|---|---:|---:|---:|",
    ]
    if not stats.empty:
        best = stats[stats["horizon"].eq("20d")].sort_values(["mean", "count"], ascending=[False, False]).head(12)
        for row in best.itertuples(index=False):
            lines.append(
                f"| {row.event_family} | {row.signal} | {row.count:,} | {row.mean:.2%} | {row.win_rate:.2%} |"
            )
    lines += [
        "",
        "## Output Files",
        "",
        "- event_signal_forward_stats.csv",
        "- analyst_positive_top.csv",
        "- guidance_up_top.csv",
        "- earnings_beat_top.csv",
        "- short_squeeze_candidates.csv",
        "",
        "## Product Candidates",
        "",
        "- Analyst target-price revision and upgrade board",
        "- Guidance up/down alert board",
        "- Earnings surprise quality board",
        "- Short squeeze watchlist",
    ]
    report.write_text("\n".join(lines) + "\n")
    return report


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2024-01-01")
    parser.add_argument("--end", default="2026-05-11")
    parser.add_argument("--stats-start", default="2024-01-01")
    parser.add_argument("--stats-end", default="2026-03-01")
    args = parser.parse_args()

    start = parse_date(args.start, date(2024, 1, 1))
    end = parse_date(args.end, date.today())
    stats_start = parse_date(args.stats_start, start)
    stats_end = parse_date(args.stats_end, end - timedelta(days=max(HORIZONS)))
    asof = end

    daily = load_daily(start, end)
    latest = load_latest_universe(asof)
    frames = [
        build_analyst_events(daily),
        build_guidance_events(daily),
        build_earnings_events(daily),
        build_short_interest_events(daily),
    ]
    events = pd.concat([frame for frame in frames if not frame.empty], ignore_index=True, sort=False)
    events = events[events["event_date"].between(pd.Timestamp(start), pd.Timestamp(end))].copy()
    stats = event_stats(events, stats_start, stats_end)
    report = write_outputs(events, stats, latest, asof)
    print(report, flush=True)


if __name__ == "__main__":
    main()

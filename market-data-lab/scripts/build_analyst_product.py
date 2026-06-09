from __future__ import annotations

import argparse
import re
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

from common import data_path, load_env, parse_date, write_parquet


HORIZONS = [5, 20, 60]


def load_events() -> pd.DataFrame:
    path = data_path("features", "polygon", "monetizable_signals", "event_signals.parquet")
    if not path.exists():
        raise SystemExit("Missing event_signals.parquet. Run build_monetizable_signals.py first.")
    df = pd.read_parquet(path)
    df = df[df["event_family"].eq("analyst")].copy()
    df["event_date"] = pd.to_datetime(df["event_date"]).dt.date
    return df


def latest_universe(asof: date) -> pd.DataFrame:
    path = data_path("features", "polygon", "universe", "daily_tradable_universe_by_year", f"universe_{asof.year}.parquet")
    df = pd.read_parquet(path)
    df["trade_date"] = pd.to_datetime(df["trade_date"]).dt.date
    latest_date = max(day for day in df["trade_date"].unique() if day <= asof)
    cols = [
        "symbol",
        "name",
        "type",
        "close",
        "median_dollar_volume_20d",
        "return_20d",
        "tradable_core",
        "is_common_or_adr",
    ]
    return df[df["trade_date"].eq(latest_date)][cols].rename(columns={"symbol": "ticker"})


def clean_reason(text: object, max_len: int = 360) -> str:
    if pd.isna(text):
        return ""
    value = re.sub(r"\s+", " ", str(text)).strip()
    value = re.sub(r"^- \*\*", "", value)
    if len(value) <= max_len:
        return value
    return value[: max_len - 3].rstrip() + "..."


def enrich(events: pd.DataFrame, universe: pd.DataFrame) -> pd.DataFrame:
    df = events.merge(universe, on="ticker", how="left")
    df = df[df["tradable_core"].fillna(False) & df["is_common_or_adr"].fillna(False)].copy()
    df["reason_summary"] = df["insight"].map(clean_reason)
    df["price_target_upside_pct"] = df["price_target_upside"] * 100.0
    return df


def action_stats(events: pd.DataFrame, stats_start: date, stats_end: date) -> pd.DataFrame:
    sample = events[
        (events["event_date"] >= stats_start)
        & (events["event_date"] <= stats_end)
        & events["rating_action"].notna()
    ].copy()
    rows = []
    for action, group in sample.groupby("rating_action"):
        for horizon in HORIZONS:
            ret = group[f"fwd_{horizon}d"].replace([np.inf, -np.inf], np.nan).dropna()
            rows.append(
                {
                    "rating_action": action,
                    "horizon": f"{horizon}d",
                    "count": int(ret.shape[0]),
                    "mean": float(ret.mean()) if not ret.empty else np.nan,
                    "median": float(ret.median()) if not ret.empty else np.nan,
                    "win_rate": float((ret > 0).mean()) if not ret.empty else np.nan,
                }
            )
    return pd.DataFrame(rows)


def firm_stats(events: pd.DataFrame, stats_start: date, stats_end: date) -> pd.DataFrame:
    sample = events[
        (events["event_date"] >= stats_start)
        & (events["event_date"] <= stats_end)
        & events["firm"].notna()
    ].copy()
    rows = []
    for firm, group in sample.groupby("firm"):
        ret = group["fwd_20d"].replace([np.inf, -np.inf], np.nan).dropna()
        if ret.shape[0] < 50:
            continue
        rows.append(
            {
                "firm": firm,
                "count": int(ret.shape[0]),
                "mean_20d": float(ret.mean()),
                "median_20d": float(ret.median()),
                "win_rate_20d": float((ret > 0).mean()),
                "positive_actions": int(group["signal"].eq("analyst_positive").sum()),
                "negative_actions": int(group["signal"].eq("analyst_negative").sum()),
            }
        )
    return pd.DataFrame(rows).sort_values(["mean_20d", "count"], ascending=[False, False])


def consensus_board(events: pd.DataFrame, asof: date, lookback_days: int) -> pd.DataFrame:
    start = asof - timedelta(days=lookback_days)
    recent = events[(events["event_date"] >= start) & (events["event_date"] <= asof)].copy()
    rows = []
    for ticker, group in recent.groupby("ticker"):
        latest = group.sort_values("event_date").tail(1).iloc[0]
        rows.append(
            {
                "ticker": ticker,
                "company_name": latest.get("company_name"),
                "last_event_date": latest["event_date"],
                "events_30d": len(group),
                "firms_30d": group["firm"].nunique(),
                "upgrades_30d": int(group["rating_action"].eq("upgrades").sum()),
                "downgrades_30d": int(group["rating_action"].eq("downgrades").sum()),
                "positive_actions_30d": int(group["signal"].eq("analyst_positive").sum()),
                "negative_actions_30d": int(group["signal"].eq("analyst_negative").sum()),
                "avg_price_target_upside": group["price_target_upside"].replace([np.inf, -np.inf], np.nan).mean(),
                "max_price_target_upside": group["price_target_upside"].replace([np.inf, -np.inf], np.nan).max(),
                "latest_firm": latest.get("firm"),
                "latest_rating_action": latest.get("rating_action"),
                "latest_rating": latest.get("rating"),
                "latest_price_target": latest.get("price_target"),
                "latest_reason": clean_reason(latest.get("insight")),
            }
        )
    out = pd.DataFrame(rows)
    if out.empty:
        return out
    out["analyst_heat_score"] = (
        out["upgrades_30d"] * 3
        - out["downgrades_30d"] * 3
        + out["positive_actions_30d"]
        - out["negative_actions_30d"]
        + out["firms_30d"] * 0.5
        + np.clip(out["avg_price_target_upside"].fillna(0), -1, 1)
    )
    return out.sort_values("analyst_heat_score", ascending=False)


def write_report(out_dir, action, firms, boards) -> None:
    report = out_dir / "analyst_product_report.md"
    lines = [
        "# Analyst Product Report",
        "",
        f"Generated at UTC: {datetime.now(timezone.utc).isoformat()}",
        "",
        "## 20d Rating Action Stats",
        "",
        "| action | count | mean_20d | win_rate_20d |",
        "|---|---:|---:|---:|",
    ]
    best = action[action["horizon"].eq("20d")].sort_values(["mean", "count"], ascending=[False, False])
    for row in best.itertuples(index=False):
        lines.append(f"| {row.rating_action} | {row.count:,} | {row.mean:.2%} | {row.win_rate:.2%} |")
    lines += [
        "",
        "## Top Firms By 20d Mean",
        "",
        "| firm | count | mean_20d | win_rate_20d |",
        "|---|---:|---:|---:|",
    ]
    for row in firms.head(12).itertuples(index=False):
        lines.append(f"| {row.firm} | {row.count:,} | {row.mean_20d:.2%} | {row.win_rate_20d:.2%} |")
    lines += [
        "",
        "## Boards",
        "",
        "- analyst_upgrades.csv",
        "- analyst_target_upside.csv",
        "- analyst_heat_30d.csv",
        "- analyst_firm_stats.csv",
        "- analyst_action_stats.csv",
    ]
    report.write_text("\n".join(lines) + "\n")


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--asof", default="2026-05-11")
    parser.add_argument("--recent-days", type=int, default=30)
    parser.add_argument("--stats-start", default="2024-01-01")
    parser.add_argument("--stats-end", default="2026-03-01")
    args = parser.parse_args()

    asof = parse_date(args.asof, date.today())
    stats_start = parse_date(args.stats_start, date(2024, 1, 1))
    stats_end = parse_date(args.stats_end, asof - timedelta(days=60))
    out_dir = data_path("reports", "analyst_product")
    out_dir.mkdir(parents=True, exist_ok=True)
    feature_dir = data_path("features", "polygon", "analyst_product")
    feature_dir.mkdir(parents=True, exist_ok=True)

    events = load_events()
    universe = latest_universe(asof)
    enriched = enrich(events, universe)
    recent = enriched[(enriched["event_date"] >= asof - timedelta(days=args.recent_days)) & (enriched["event_date"] <= asof)]

    upgrades = recent[recent["rating_action"].eq("upgrades")].sort_values("signal_score", ascending=False)
    target_upside = recent[recent["price_target_upside"].notna()].sort_values("price_target_upside", ascending=False)
    heat = consensus_board(enriched, asof, args.recent_days).merge(universe, on="ticker", how="left")
    heat = heat[heat["tradable_core"].fillna(False) & heat["is_common_or_adr"].fillna(False)]
    actions = action_stats(enriched, stats_start, stats_end)
    firms = firm_stats(enriched, stats_start, stats_end)

    write_parquet(enriched, feature_dir / "analyst_events_enriched.parquet")
    upgrades.head(200).to_csv(out_dir / "analyst_upgrades.csv", index=False)
    target_upside.head(200).to_csv(out_dir / "analyst_target_upside.csv", index=False)
    heat.head(200).to_csv(out_dir / "analyst_heat_30d.csv", index=False)
    actions.to_csv(out_dir / "analyst_action_stats.csv", index=False)
    firms.to_csv(out_dir / "analyst_firm_stats.csv", index=False)
    write_report(out_dir, actions, firms, {"upgrades": upgrades, "target_upside": target_upside, "heat": heat})
    print(out_dir / "analyst_product_report.md", flush=True)


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from common import ROOT, data_path, load_env, parse_date


def read_option_aggs(start, end) -> pd.DataFrame:
    root = data_path("raw", "polygon_rest", "options_aggs_1d")
    frames = []
    for directory in sorted(root.glob("*_*")):
        path = directory / "option_aggs_1d.parquet"
        if not path.exists() or path.name.startswith("._"):
            continue
        try:
            df = pd.read_parquet(path)
        except Exception as exc:
            print(f"warn skip {path}: {exc}", flush=True)
            continue
        if df.empty or "bar_date" not in df.columns:
            continue
        df["bar_date"] = pd.to_datetime(df["bar_date"]).dt.date
        if start:
            df = df[df["bar_date"] >= start]
        if end:
            df = df[df["bar_date"] <= end]
        if not df.empty:
            frames.append(df)
    if not frames:
        return pd.DataFrame()
    df = pd.concat(frames, ignore_index=True)
    df = df.drop_duplicates(subset=["option_ticker", "bar_date"])
    df["premium"] = df["volume"].astype(float) * df["vwap"].astype(float) * 100.0
    return df


def read_underlying_prices(symbols: list[str], start, end) -> pd.DataFrame:
    files = sorted(data_path("processed", "polygon", "stocks_split_adjusted", "1d").glob("daily_split_adjusted_*.parquet"))
    frames = []
    for file in files:
        if file.name.startswith("._"):
            continue
        try:
            df = pd.read_parquet(file, columns=["symbol", "trade_date", "adj_close"])
        except Exception:
            continue
        df["trade_date"] = pd.to_datetime(df["trade_date"]).dt.date
        df = df[df["symbol"].isin(symbols)]
        if start:
            df = df[df["trade_date"] >= start]
        if end:
            df = df[df["trade_date"] <= end]
        if not df.empty:
            frames.append(df)
    if not frames:
        return pd.DataFrame(columns=["symbol", "trade_date", "adj_close"])
    return pd.concat(frames, ignore_index=True)


def compact_rows(rows: pd.DataFrame, value_column: str) -> list[dict]:
    if rows.empty:
        return []
    ranked = rows.sort_values(value_column, ascending=False).head(12)
    return [
        {
            "ticker": row.underlying,
            "premium": round(float(getattr(row, value_column)), 2),
        }
        for row in ranked.itertuples(index=False)
    ]


def build_payload(df: pd.DataFrame, out_path: Path | None = None) -> dict:
    latest = max(df["bar_date"])
    latest_df = df[df["bar_date"] == latest].copy()
    symbols = sorted(latest_df["underlying"].dropna().astype(str).unique())
    prices = read_underlying_prices(symbols, min(df["bar_date"]), latest)
    latest_prices = prices.sort_values("trade_date").groupby("symbol", as_index=False).tail(1)
    price_map = dict(zip(latest_prices["symbol"], latest_prices["adj_close"]))

    by_symbol_type = (
        latest_df.groupby(["underlying", "contract_type"], as_index=False)["premium"]
        .sum()
        .pivot(index="underlying", columns="contract_type", values="premium")
        .fillna(0.0)
        .reset_index()
    )
    for column in ["call", "put"]:
        if column not in by_symbol_type.columns:
            by_symbol_type[column] = 0.0
    by_symbol_type["total"] = by_symbol_type["call"] + by_symbol_type["put"]
    by_symbol_type["net"] = by_symbol_type["call"] - by_symbol_type["put"]
    focus = by_symbol_type.sort_values("total", ascending=False).iloc[0]
    focus_symbol = str(focus["underlying"])
    focus_df = df[df["underlying"] == focus_symbol].copy()

    timeline_rows = []
    for day, group in focus_df.groupby("bar_date", sort=True):
        call = float(group.loc[group["contract_type"] == "call", "premium"].sum())
        put = float(group.loc[group["contract_type"] == "put", "premium"].sum())
        call_volume = int(group.loc[group["contract_type"] == "call", "volume"].sum())
        put_volume = int(group.loc[group["contract_type"] == "put", "volume"].sum())
        price_row = prices[(prices["symbol"] == focus_symbol) & (prices["trade_date"] == day)]
        price = float(price_row["adj_close"].iloc[-1]) if not price_row.empty else float(price_map.get(focus_symbol, 0) or 0)
        timeline_rows.append(
            {
                "time": str(day),
                "call": round(call, 2),
                "put": round(-put, 2),
                "net": round(call - put, 2),
                "price": round(price, 4),
                "callVolume": call_volume,
                "putVolume": -put_volume,
            }
        )

    focus_latest = focus_df[focus_df["bar_date"] == latest]
    call_premium = float(focus_latest.loc[focus_latest["contract_type"] == "call", "premium"].sum())
    put_premium = float(focus_latest.loc[focus_latest["contract_type"] == "put", "premium"].sum())
    net = call_premium - put_premium
    direction = "偏多" if net > 0 else "偏空" if net < 0 else "分歧"
    headline = f"{focus_symbol} 期权权利金{direction}，当前仅代表 Call/Put 活跃度代理，仍需价格确认。"

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "asOf": str(latest),
        "source": {
            "vendor": "polygon",
            "inputs": ["options_contracts", "options_aggs_1d", "stocks_split_adjusted_1d"],
            "directionModel": "call_put_activity_proxy_v1",
            "directionConfidence": "low_without_quotes_or_trades",
        },
        "meta": {
            "symbol": focus_symbol,
            "company": focus_symbol,
            "tradeDate": str(latest),
            "expiration": str(focus_latest["expiration_date"].min()) if "expiration_date" in focus_latest.columns else str(latest),
            "underlyingLast": round(float(price_map.get(focus_symbol, 0) or 0), 4),
            "universe": symbols,
        },
        "summary": {
            "underlyingLast": round(float(price_map.get(focus_symbol, 0) or 0), 4),
            "callPremium": round(call_premium, 2),
            "putPremium": round(put_premium, 2),
            "netCallPutPremium": round(net, 2),
            "netDrift": round(net, 2),
            "totalPremium": round(call_premium + put_premium, 2),
            "callPutRatio": round(call_premium / put_premium, 4) if put_premium else None,
            "activeContracts": int(focus_latest["option_ticker"].nunique()),
            "headline": headline,
        },
        "timeline": timeline_rows,
        "bullish": compact_rows(by_symbol_type, "call"),
        "bearish": compact_rows(by_symbol_type, "put"),
        "boards": {
            "bullish": compact_rows(by_symbol_type, "call"),
            "bearish": compact_rows(by_symbol_type, "put"),
            "unusual": compact_rows(by_symbol_type, "total"),
            "contracts": [],
        },
        "quality": {
            "hasBidAsk": False,
            "hasTrades": False,
            "directionality": "unknown",
            "warnings": ["Polygon daily aggregates do not identify aggressor buy/sell direction."],
        },
    }
    if out_path is not None:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    return payload


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="")
    parser.add_argument("--end", default="")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    start = parse_date(args.start)
    end = parse_date(args.end)
    df = read_option_aggs(start, end)
    if df.empty:
        raise SystemExit("No options aggs found for requested range.")
    payload = build_payload(df, args.output)
    if args.output:
        print(f"saved {args.output} asOf={payload['asOf']} focus={payload['meta']['symbol']}", flush=True)
    else:
        print(json.dumps(payload, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()

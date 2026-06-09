from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from time import sleep
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import pandas as pd
import requests

from common import data_path, env, load_env, parse_date


BASE_URL = "https://api.polygon.io"


def with_api_key(url: str, api_key: str) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.setdefault("apiKey", api_key)
    return urlunparse(parsed._replace(query=urlencode(query)))


def get_json(
    session: requests.Session,
    url: str,
    params: dict,
    api_key: str,
    rate_limit_sleep: float,
    max_retries: int,
) -> dict:
    request_url = with_api_key(url, api_key)
    for attempt in range(max_retries + 1):
        response = session.get(request_url, params=params, timeout=60)
        if response.status_code == 429 and attempt < max_retries:
            retry_after = response.headers.get("Retry-After")
            wait = float(retry_after) if retry_after else rate_limit_sleep
            print(f"rate limited; sleeping {wait:.0f}s", flush=True)
            sleep(wait)
            params = {}
            continue
        break
    if response.status_code != 200:
        raise RuntimeError(f"{url}: {response.status_code} {response.text[:500]}")
    data = response.json()
    if data.get("status") in {"ERROR", "NOT_AUTHORIZED"}:
        raise RuntimeError(f"{url}: {data}")
    return data


def load_underlying_daily(symbols: list[str], start: date, end: date) -> pd.DataFrame:
    files = []
    for year in range(start.year, end.year + 1):
        path = data_path("processed", "polygon", "stocks_split_adjusted", "1d", f"daily_split_adjusted_{year}.parquet")
        if path.exists():
            files.append(path)
    if not files:
        raise SystemExit("Missing split-adjusted daily parquet files.")
    df = pd.concat(
        (
            pd.read_parquet(file, columns=["symbol", "trade_date", "adj_close"])
            for file in files
            if not file.name.startswith("._")
        ),
        ignore_index=True,
    )
    df["trade_date"] = pd.to_datetime(df["trade_date"]).dt.date
    return df[df["symbol"].isin(symbols) & (df["trade_date"] >= start) & (df["trade_date"] <= end)].copy()


def load_contracts(symbols: list[str], start: date, end: date) -> pd.DataFrame:
    frames = []
    root = data_path("raw", "polygon_rest", "options_contracts")
    for symbol in symbols:
        for file in sorted((root / symbol).glob("*.parquet")):
            if file.name.startswith("._"):
                continue
            frames.append(pd.read_parquet(file))
    if not frames:
        raise SystemExit("Missing options contracts parquet files. Run download_polygon_options_reference.py first.")
    df = pd.concat(frames, ignore_index=True)
    df = df[df["query_underlying"].isin(symbols)].copy()
    df["expiration_date"] = pd.to_datetime(df["expiration_date"]).dt.date
    df = df[df["expiration_date"] >= start]
    df = df[df["expiration_date"] <= end]
    return df.drop_duplicates(subset=["ticker"])


def build_targets(
    daily: pd.DataFrame,
    contracts: pd.DataFrame,
    dte_targets: list[int],
    dte_tolerance: int,
) -> pd.DataFrame:
    rows: list[dict] = []
    for symbol, daily_group in daily.groupby("symbol", sort=False):
        symbol_contracts = contracts[contracts["query_underlying"].eq(symbol)].copy()
        if symbol_contracts.empty:
            continue
        for bar in daily_group.itertuples(index=False):
            trade_date = bar.trade_date
            close = float(bar.adj_close)
            eligible = symbol_contracts[symbol_contracts["expiration_date"] >= trade_date].copy()
            if eligible.empty:
                continue
            eligible["dte"] = (
                pd.to_datetime(eligible["expiration_date"]) - pd.Timestamp(trade_date)
            ).dt.days
            for target_dte in dte_targets:
                near = eligible[
                    (eligible["dte"] >= max(0, target_dte - dte_tolerance))
                    & (eligible["dte"] <= target_dte + dte_tolerance)
                ].copy()
                if near.empty:
                    continue
                near["expiration_distance"] = (near["dte"] - target_dte).abs()
                expiration = near.sort_values(["expiration_distance", "expiration_date"]).iloc[0]["expiration_date"]
                near = near[near["expiration_date"].eq(expiration)].copy()
                for contract_type in ["call", "put"]:
                    side = near[near["contract_type"].eq(contract_type)].copy()
                    if side.empty:
                        continue
                    side["strike_distance"] = (side["strike_price"] - close).abs()
                    row = side.sort_values(["strike_distance", "strike_price"]).iloc[0]
                    rows.append(
                        {
                            "underlying": symbol,
                            "trade_date": trade_date,
                            "underlying_close": close,
                            "target_dte": target_dte,
                            "actual_dte": int(row["dte"]),
                            "option_ticker": row["ticker"],
                            "contract_type": contract_type,
                            "expiration_date": row["expiration_date"],
                            "strike_price": float(row["strike_price"]),
                            "moneyness": float(row["strike_price"]) / close if close else None,
                        }
                    )
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows).drop_duplicates(
        subset=["underlying", "trade_date", "target_dte", "contract_type", "option_ticker"]
    )


def download_contract_aggs(
    session: requests.Session,
    api_key: str,
    option_ticker: str,
    start: date,
    end: date,
    pause: float,
    rate_limit_sleep: float,
    max_retries: int,
) -> pd.DataFrame:
    url = f"{BASE_URL}/v2/aggs/ticker/{option_ticker}/range/1/day/{start.isoformat()}/{end.isoformat()}"
    data = get_json(
        session,
        url,
        {"adjusted": "true", "sort": "asc", "limit": 50000},
        api_key,
        rate_limit_sleep,
        max_retries,
    )
    rows = data.get("results") or []
    if pause:
        sleep(pause)
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["option_ticker"] = option_ticker
    df["bar_date"] = pd.to_datetime(df["t"], unit="ms", utc=True).dt.date
    df = df.rename(
        columns={
            "o": "open",
            "h": "high",
            "l": "low",
            "c": "close",
            "v": "volume",
            "vw": "vwap",
            "n": "transactions",
        }
    )
    return df[["option_ticker", "bar_date", "open", "high", "low", "close", "volume", "vwap", "transactions"]]


def write_parquet_atomic(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    df.to_parquet(tmp, index=False)
    tmp.replace(path)


def write_inventory(targets: pd.DataFrame, aggs: pd.DataFrame, out_dir: Path) -> Path:
    report = data_path("reports", "polygon_options_aggs_inventory.md")
    report.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Polygon Options Aggregates Inventory",
        "",
        f"Generated at UTC: {datetime.now(timezone.utc).isoformat()}",
        "",
        f"- target rows: {len(targets):,}",
        f"- unique contracts: {targets['option_ticker'].nunique() if not targets.empty else 0:,}",
        f"- aggregate rows: {len(aggs):,}",
        f"- output: {out_dir}",
    ]
    if not aggs.empty:
        by_underlying = targets.groupby("underlying")["option_ticker"].nunique()
        aggs_by_underlying = aggs.groupby("underlying")["option_ticker"].nunique()
        lines += ["", "## Rows By Underlying", ""]
        lines += ["| underlying | target_contracts | contracts_with_bars | agg_rows |", "|---|---:|---:|---:|"]
        for underlying, count in by_underlying.items():
            rows = int((aggs["underlying"] == underlying).sum())
            bars = int(aggs_by_underlying.get(underlying, 0))
            lines.append(f"| {underlying} | {count:,} | {bars:,} | {rows:,} |")
        lines += [
            f"- bar date range: {aggs['bar_date'].min()}..{aggs['bar_date'].max()}",
        ]
    report.write_text("\n".join(lines) + "\n")
    print(report, flush=True)
    return report


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--underlyings", default="SPY,QQQ,IWM")
    parser.add_argument("--start", default="2026-01-01")
    parser.add_argument("--end", default="")
    parser.add_argument("--dte", default="7,14,30,45")
    parser.add_argument("--dte-tolerance", type=int, default=3)
    parser.add_argument("--pause", type=float, default=0.03)
    parser.add_argument("--rate-limit-sleep", type=float, default=65.0)
    parser.add_argument("--max-retries", type=int, default=3)
    parser.add_argument("--max-contracts", type=int, help="Debug limit after target universe is built.")
    parser.add_argument("--save-every", type=int, default=100)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--build-only", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    api_key = env("POLYGON_API_KEY", required=True)
    symbols = [item.strip().upper() for item in args.underlyings.split(",") if item.strip()]
    start = parse_date(args.start, date(2026, 1, 1))
    end = parse_date(args.end, date.today())
    dte_targets = [int(item.strip()) for item in args.dte.split(",") if item.strip()]

    out_dir = data_path("raw", "polygon_rest", "options_aggs_1d", f"{start:%Y%m%d}_{end:%Y%m%d}")
    targets_path = out_dir / "target_contracts.parquet"
    aggs_path = out_dir / "option_aggs_1d.parquet"

    daily = load_underlying_daily(symbols, start, end)
    contract_end = end + timedelta(days=max(dte_targets) + args.dte_tolerance)
    contracts = load_contracts(symbols, start, contract_end)
    targets = build_targets(daily, contracts, dte_targets, args.dte_tolerance)
    if targets.empty:
        raise SystemExit("No target option contracts selected.")
    write_parquet_atomic(targets, targets_path)
    print(f"saved {targets_path} rows={len(targets):,} unique_contracts={targets['option_ticker'].nunique():,}", flush=True)

    if args.build_only:
        write_inventory(targets, pd.DataFrame(), out_dir)
        return
    if aggs_path.exists() and not args.overwrite and not args.resume:
        aggs = pd.read_parquet(aggs_path)
        print(f"skip existing {aggs_path} rows={len(aggs):,}", flush=True)
        write_inventory(targets, aggs, out_dir)
        return

    contract_ranges = (
        targets.groupby("option_ticker", as_index=False)
        .agg(
            start_date=("trade_date", "min"),
            end_date=("expiration_date", "max"),
            underlying=("underlying", "first"),
            contract_type=("contract_type", "first"),
            expiration_date=("expiration_date", "first"),
            strike_price=("strike_price", "first"),
        )
        .sort_values(["underlying", "expiration_date", "strike_price", "contract_type"])
    )
    if args.max_contracts:
        contract_ranges = contract_ranges.head(args.max_contracts)

    session = requests.Session()
    frames = []
    done_tickers: set[str] = set()
    if args.resume and aggs_path.exists():
        existing = pd.read_parquet(aggs_path)
        if not existing.empty:
            frames.append(existing)
            done_tickers = set(existing["option_ticker"].dropna().astype(str).unique())
            contract_ranges = contract_ranges[~contract_ranges["option_ticker"].isin(done_tickers)].copy()
            print(
                f"resume existing rows={len(existing):,} done_contracts={len(done_tickers):,} remaining={len(contract_ranges):,}",
                flush=True,
            )

    total = len(contract_ranges)
    for i, row in enumerate(contract_ranges.itertuples(index=False), start=1):
        if i % 100 == 0 or i == 1:
            print(f"option aggs {i:,}/{total:,}", flush=True)
        try:
            df = download_contract_aggs(
                session,
                api_key,
                row.option_ticker,
                row.start_date,
                min(row.end_date, end),
                args.pause,
                args.rate_limit_sleep,
                args.max_retries,
            )
        except RuntimeError as exc:
            print(f"warn {row.option_ticker}: {exc}", flush=True)
            continue
        if df.empty:
            continue
        df["underlying"] = row.underlying
        df["contract_type"] = row.contract_type
        df["expiration_date"] = row.expiration_date
        df["strike_price"] = row.strike_price
        frames.append(df)
        done_tickers.add(row.option_ticker)

        if args.save_every > 0 and i % args.save_every == 0:
            partial = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
            if not partial.empty:
                partial["source"] = "polygon"
                partial["endpoint"] = "/v2/aggs/ticker/{option_ticker}/range/1/day"
                partial["downloaded_at_utc"] = datetime.now(timezone.utc).isoformat()
                partial = partial.drop_duplicates(subset=["option_ticker", "bar_date"]).sort_values(
                    ["underlying", "option_ticker", "bar_date"]
                )
                write_parquet_atomic(partial, aggs_path)
                print(f"checkpoint {aggs_path} rows={len(partial):,}", flush=True)

    aggs = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if not aggs.empty:
        aggs["source"] = "polygon"
        aggs["endpoint"] = "/v2/aggs/ticker/{option_ticker}/range/1/day"
        aggs["downloaded_at_utc"] = datetime.now(timezone.utc).isoformat()
        aggs = aggs.drop_duplicates(subset=["option_ticker", "bar_date"]).sort_values(["underlying", "option_ticker", "bar_date"])
    write_parquet_atomic(aggs, aggs_path)
    print(f"saved {aggs_path} rows={len(aggs):,}", flush=True)
    write_inventory(targets, aggs, out_dir)


if __name__ == "__main__":
    main()

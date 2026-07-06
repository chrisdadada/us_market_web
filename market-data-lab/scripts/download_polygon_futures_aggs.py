from __future__ import annotations

import argparse
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from common import data_path, env, load_env, parse_date, write_parquet


BASE_URL = "https://api.polygon.io"
FUTURES_MONTH_CODES = {
    "F": 1,
    "G": 2,
    "H": 3,
    "J": 4,
    "K": 5,
    "M": 6,
    "N": 7,
    "Q": 8,
    "U": 9,
    "V": 10,
    "X": 11,
    "Z": 12,
}
PRODUCT_MONTH_CODES = {
    "ES": ["H", "M", "U", "Z"],
    "NQ": ["H", "M", "U", "Z"],
    "GC": ["G", "J", "M", "Q", "V", "Z"],
    "SI": ["H", "K", "N", "U", "Z"],
    "CL": ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"],
    "BZ": ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"],
}


@dataclass(frozen=True)
class FuturesContract:
    product: str
    ticker: str
    contract_year: int
    contract_month: int
    contract_expiry_date: date


def third_friday(year: int, month: int) -> date:
    day = date(year, month, 1)
    first_friday_offset = (4 - day.weekday()) % 7
    return day + timedelta(days=first_friday_offset + 14)


def third_last_business_day(year: int, month: int) -> date:
    if month == 12:
        day = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        day = date(year, month + 1, 1) - timedelta(days=1)
    count = 0
    while True:
        if day.weekday() < 5:
            count += 1
            if count == 3:
                return day
        day -= timedelta(days=1)


def product_expiry_date(product: str, year: int, month: int) -> date:
    if product in {"ES", "NQ"}:
        return third_friday(year, month)
    if product in {"GC", "SI"}:
        return third_last_business_day(year, month)
    if product in {"CL", "BZ"}:
        return third_last_business_day(year, month)
    return third_friday(year, month)


def parse_contract(ticker: str, product: str, contract_year_hint: int | None = None) -> tuple[str, int, int, date]:
    suffix = ticker[len(product) :]
    if len(suffix) < 2:
        raise ValueError(f"Unsupported futures ticker: {ticker}")
    month_code = suffix[0]
    year_digit = suffix[1]
    month_codes = PRODUCT_MONTH_CODES.get(product, PRODUCT_MONTH_CODES["ES"])
    if month_code not in month_codes or not year_digit.isdigit():
        raise ValueError(f"Unsupported futures ticker: {ticker}")
    if contract_year_hint is not None:
        year = int(contract_year_hint)
        if year % 10 != int(year_digit):
            raise ValueError(f"Ticker/year mismatch: {ticker} vs {contract_year_hint}")
    else:
        year = 2020 + int(year_digit)
    month = FUTURES_MONTH_CODES[month_code]
    return month_code, year, month, product_expiry_date(product, year, month)


def contract_tickers(product: str, start: date, end: date, extra_years: int = 1) -> list[FuturesContract]:
    product = product.upper()
    month_codes = PRODUCT_MONTH_CODES.get(product)
    if not month_codes:
        raise SystemExit(f"Unsupported futures product: {product}")
    contracts: list[FuturesContract] = []
    for year in range(start.year, end.year + extra_years + 1):
        for code in month_codes:
            ticker = f"{product}{code}{year % 10}"
            month = FUTURES_MONTH_CODES[code]
            contracts.append(
                FuturesContract(
                    product=product,
                    ticker=ticker,
                    contract_year=year,
                    contract_month=month,
                    contract_expiry_date=product_expiry_date(product, year, month),
                )
            )
    return contracts


def year_chunks(start: date, end: date) -> list[tuple[date, date]]:
    return [(date(year, 1, 1), date(year, 12, 31)) for year in range(start.year, end.year + 1)]


def date_chunks(start: date, end: date, days: int) -> list[tuple[date, date]]:
    chunks = []
    chunk_start = start
    while chunk_start <= end:
        chunk_end = min(end, chunk_start + timedelta(days=days - 1))
        chunks.append((chunk_start, chunk_end))
        chunk_start = chunk_end + timedelta(days=1)
    return chunks


def clip_chunk(chunk: tuple[date, date], start: date, end: date) -> tuple[date, date]:
    chunk_start, chunk_end = chunk
    return max(chunk_start, start), min(chunk_end, end)


def timeframe_resolution(timeframe: str) -> str:
    if timeframe == "5m":
        return "5min"
    if timeframe == "1d":
        return "1day"
    raise SystemExit(f"Unsupported timeframe: {timeframe}")


def request_json(session: requests.Session, url: str, params: dict[str, Any], pause: float) -> dict[str, Any]:
    attempts = 0
    while True:
        try:
            response = session.get(url, params=params, timeout=90)
        except requests.RequestException as exc:
            attempts += 1
            if attempts > 5:
                raise RuntimeError(f"Polygon futures request failed after retries: {exc}") from exc
            wait = max(pause, 2.0) * attempts
            print(f"request error; sleep {wait:.1f}s then retry", flush=True)
            time.sleep(wait)
            continue
        if response.status_code == 429:
            wait = float(response.headers.get("Retry-After") or max(pause, 2.0))
            print(f"rate limited; sleep {wait:.1f}s", flush=True)
            time.sleep(wait)
            continue
        if not response.ok:
            try:
                detail = response.json()
            except Exception:
                detail = {}
            message = detail.get("error") or detail.get("message") or response.reason
            if response.status_code == 404:
                print(f"warn Polygon futures not found: {url}", flush=True)
                return {"results": []}
            raise RuntimeError(f"Polygon futures request failed: status={response.status_code} message={message}")
        return response.json()


def download_aggs(
    session: requests.Session,
    api_key: str,
    contract: FuturesContract,
    timeframe: str,
    start: date,
    end: date,
    pause: float,
) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    chunk_days = 31 if timeframe == "5m" else 366
    for sub_start, sub_end in date_chunks(start, end, chunk_days):
        url = f"{BASE_URL}/futures/vX/aggs/{contract.ticker}"
        params: dict[str, Any] = {
            "resolution": timeframe_resolution(timeframe),
            "window_start.gte": sub_start.isoformat(),
            "window_start.lte": sub_end.isoformat(),
            "limit": 50000,
            "sort": "window_start.asc",
            "apiKey": api_key,
        }
        while url:
            payload = request_json(session, url, params, pause)
            rows.extend(payload.get("results") or [])
            next_url = payload.get("next_url")
            url = next_url if next_url else ""
            params = {"apiKey": api_key} if next_url else {}
            if pause:
                time.sleep(pause)

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df = df.rename(columns={"window_start": "window_start_ns", "transactions": "transaction_count"})
    if "ticker" not in df.columns:
        df["ticker"] = contract.ticker
    if "transaction_count" not in df.columns:
        df["transaction_count"] = pd.NA
    if "settlement_price" not in df.columns:
        df["settlement_price"] = pd.NA
    if "dollar_volume" not in df.columns:
        df["dollar_volume"] = pd.NA

    df["product"] = contract.product
    df["contract_ticker"] = contract.ticker
    df["contract_year"] = contract.contract_year
    df["contract_month"] = contract.contract_month
    df["contract_expiry_date"] = contract.contract_expiry_date.isoformat()
    df["timestamp_utc"] = pd.to_datetime(df["window_start_ns"], unit="ns", utc=True)
    df["timestamp_ct"] = df["timestamp_utc"].dt.tz_convert("America/Chicago")
    df["session_end_date"] = pd.to_datetime(df["session_end_date"]).dt.date
    df["source"] = "polygon"
    df["timeframe"] = timeframe
    df["downloaded_at_utc"] = datetime.now(timezone.utc).isoformat()

    columns = [
        "product",
        "contract_ticker",
        "ticker",
        "contract_year",
        "contract_month",
        "contract_expiry_date",
        "window_start_ns",
        "timestamp_utc",
        "timestamp_ct",
        "session_end_date",
        "open",
        "high",
        "low",
        "close",
        "settlement_price",
        "volume",
        "dollar_volume",
        "transaction_count",
        "source",
        "timeframe",
        "downloaded_at_utc",
    ]
    for column in columns:
        if column not in df.columns:
            df[column] = pd.NA
    return df[columns].sort_values("timestamp_utc").drop_duplicates(
        subset=["contract_ticker", "timestamp_utc"]
    )


def build_continuous(product: str, timeframe: str, files: list[Path], roll_days: int) -> pd.DataFrame:
    frames = [pd.read_parquet(path) for path in files if path.exists() and path.stat().st_size > 0]
    if not frames:
        return pd.DataFrame()
    df = pd.concat(frames, ignore_index=True)
    if df.empty:
        return df
    df["session_end_date"] = pd.to_datetime(df["session_end_date"]).dt.date
    df["contract_expiry_date"] = pd.to_datetime(df["contract_expiry_date"]).dt.date
    volume = pd.to_numeric(df["volume"], errors="coerce").fillna(0)
    daily_leaders = (
        df.assign(_volume=volume)
        .groupby(["session_end_date", "contract_ticker", "contract_expiry_date"], as_index=False)["_volume"]
        .sum()
        .sort_values(["session_end_date", "_volume", "contract_expiry_date", "contract_ticker"], ascending=[True, False, True, True])
        .drop_duplicates(subset=["session_end_date"], keep="first")
        [["session_end_date", "contract_ticker"]]
    )
    continuous = df.merge(daily_leaders, on=["session_end_date", "contract_ticker"], how="inner")
    continuous = continuous.sort_values(["timestamp_utc", "contract_expiry_date", "contract_ticker"])
    continuous = continuous.drop_duplicates(subset=["timestamp_utc"], keep="first").copy()
    continuous["continuous_symbol"] = f"{product}_CONT"
    continuous["roll_rule"] = "daily_max_volume_contract"
    continuous["roll_date"] = continuous["session_end_date"]
    columns = [
        "continuous_symbol",
        "product",
        "contract_ticker",
        "roll_rule",
        "contract_year",
        "contract_month",
        "contract_expiry_date",
        "roll_date",
        "window_start_ns",
        "timestamp_utc",
        "timestamp_ct",
        "session_end_date",
        "open",
        "high",
        "low",
        "close",
        "settlement_price",
        "volume",
        "dollar_volume",
        "transaction_count",
        "source",
        "timeframe",
        "downloaded_at_utc",
    ]
    return continuous[columns].sort_values("timestamp_utc").reset_index(drop=True)


def write_yearly(df: pd.DataFrame, out_dir: Path, prefix: str, timeframe: str, overwrite: bool) -> list[Path]:
    outputs: list[Path] = []
    if df.empty:
        return outputs
    out_dir.mkdir(parents=True, exist_ok=True)
    years = pd.to_datetime(df["timestamp_utc"]).dt.year
    for year in sorted(years.unique()):
        out = out_dir / f"{prefix}_{timeframe}_{year}.parquet"
        if out.exists() and out.stat().st_size > 0 and not overwrite:
            outputs.append(out)
            continue
        part = df[years == year].copy()
        write_parquet(part, out)
        outputs.append(out)
    return outputs


def file_stats(path: Path) -> dict[str, Any]:
    df = pd.read_parquet(path)
    timestamp_col = "timestamp_utc" if "timestamp_utc" in df.columns else None
    return {
        "rows": len(df),
        "first": str(df[timestamp_col].min()) if timestamp_col and not df.empty else "--",
        "last": str(df[timestamp_col].max()) if timestamp_col and not df.empty else "--",
        "dups": int(df.duplicated(subset=[timestamp_col]).sum()) if timestamp_col and not df.empty else 0,
        "null_ohlc": int(df[["open", "high", "low", "close"]].isna().any(axis=1).sum()) if not df.empty else 0,
    }


def write_report(raw_outputs: list[Path], continuous_outputs: list[Path], report_path: Path) -> None:
    products = sorted({path.parts[-3] for path in raw_outputs} | {path.parts[-2] for path in continuous_outputs})
    lines = [
        "# Polygon Futures Aggregates Inventory",
        "",
        f"- generated_at_utc: {datetime.now(timezone.utc).isoformat()}",
        f"- products: {', '.join(f'`{product}`' for product in products) if products else '--'}",
        "- source: Polygon futures REST aggregates",
        "- note: raw files are real expiring contracts; continuous files are stitched by roll rule.",
        "",
        "## Continuous Files",
        "",
        "| file | rows | first | last | duplicate timestamps | null OHLC rows |",
        "| --- | ---: | --- | --- | ---: | ---: |",
    ]
    for path in sorted(set(continuous_outputs)):
        stats = file_stats(path)
        lines.append(
            f"| `{path}` | {stats['rows']:,} | {stats['first']} | {stats['last']} | "
            f"{stats['dups']:,} | {stats['null_ohlc']:,} |"
        )
    lines.extend(
        [
            "",
            "## Raw Contract Files",
            "",
            "| file | rows | first | last | duplicate timestamps | null OHLC rows |",
            "| --- | ---: | --- | --- | ---: | ---: |",
        ]
    )
    for path in sorted(set(raw_outputs)):
        stats = file_stats(path)
        lines.append(
            f"| `{path}` | {stats['rows']:,} | {stats['first']} | {stats['last']} | "
            f"{stats['dups']:,} | {stats['null_ohlc']:,} |"
        )
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser(description="Download Polygon futures bars and build continuous series.")
    parser.add_argument("--products", default="ES,NQ", help="Comma list of futures product codes.")
    parser.add_argument("--start", default="2024-05-13")
    parser.add_argument("--end", default=date.today().isoformat())
    parser.add_argument("--timeframes", default="5m,1d", help="Comma list. Supported: 5m,1d.")
    parser.add_argument("--roll-days", type=int, default=5)
    parser.add_argument("--pause", type=float, default=0.05)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    api_key = env("POLYGON_API_KEY", required=True)
    start = parse_date(args.start)
    end = parse_date(args.end)
    if not start or not end:
        raise SystemExit("Both --start and --end are required.")

    products = [item.strip().upper() for item in args.products.split(",") if item.strip()]
    timeframes = [item.strip().lower() for item in args.timeframes.split(",") if item.strip()]
    session = requests.Session()
    raw_outputs: list[Path] = []
    continuous_outputs: list[Path] = []
    raw_by_product_timeframe: dict[tuple[str, str], list[Path]] = {}

    for product in products:
        for contract in contract_tickers(product, start, end):
            for timeframe in timeframes:
                for raw_chunk in year_chunks(start, end):
                    chunk_start, chunk_end = clip_chunk(raw_chunk, start, end)
                    if chunk_start > chunk_end:
                        continue
                    out = data_path(
                        "processed",
                        "polygon",
                        "futures",
                        "raw",
                        timeframe,
                        product,
                        contract.ticker,
                        f"{contract.ticker}_{timeframe}_{chunk_start.year}.parquet",
                    )
                    if out.exists() and out.stat().st_size > 0 and not args.overwrite:
                        print(f"exists {out}", flush=True)
                        raw_outputs.append(out)
                        raw_by_product_timeframe.setdefault((product, timeframe), []).append(out)
                        continue
                    print(f"download {contract.ticker} {timeframe} {chunk_start}..{chunk_end}", flush=True)
                    df = download_aggs(session, api_key, contract, timeframe, chunk_start, chunk_end, args.pause)
                    if df.empty:
                        print(f"warn empty {contract.ticker} {timeframe} {chunk_start.year}", flush=True)
                        continue
                    write_parquet(df, out)
                    print(f"saved {out} rows={len(df):,}", flush=True)
                    raw_outputs.append(out)
                    raw_by_product_timeframe.setdefault((product, timeframe), []).append(out)

    for product in products:
        for timeframe in timeframes:
            files = raw_by_product_timeframe.get((product, timeframe), [])
            continuous = build_continuous(product, timeframe, sorted(set(files)), args.roll_days)
            if continuous.empty:
                print(f"warn empty continuous {product} {timeframe}", flush=True)
                continue
            out_dir = data_path("processed", "polygon", "futures", "continuous", timeframe, product)
            outputs = write_yearly(continuous, out_dir, f"{product}_CONT", timeframe, args.overwrite)
            for out in outputs:
                print(f"saved {out} rows={len(pd.read_parquet(out)):,}", flush=True)
            continuous_outputs.extend(outputs)

    write_report(raw_outputs, continuous_outputs, data_path("reports", "polygon_futures_aggs_inventory.md"))


if __name__ == "__main__":
    main()

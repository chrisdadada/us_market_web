#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import urllib.request
from zipfile import ZipFile
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MARKET_DATA_ROOT = Path("/Volumes/Extreme SSD/market-data-lab/data")
LOCAL_MARKET_DATA_ROOT = ROOT / "market-data-lab" / "data"
POLYGON_REST = DEFAULT_MARKET_DATA_ROOT / "raw" / "polygon_rest"
DEFAULT_QQQ_HOLDINGS_URL = (
    "https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/QQQ/"
    "holdings/fund?idType=ticker&interval=monthly&productType=ETF"
)
DEFAULT_QQQ_FACT_SHEET_URL = (
    "https://www.invesco.com/us-rest/contentdetail?"
    "contentId=3a48e01e98630410VgnVCM10000046f1bf0aRCRD"
)
DEFAULT_SPY_HOLDINGS_URL = "https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx"
DEFAULT_SPY_FACT_SHEET_URL = "https://www.ssga.com/library-content/products/factsheets/etfs/us/factsheet-us-en-spy.pdf"
COMMON_STOCK_CODES = {"COM", "ADR", "ADRC", "DRNY", "COMMON_STOCK"}
XLSX_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
QQQ_OFFICIAL_FACT_SHEET_SNAPSHOT = {
    "asOf": "2026-03-31",
    "period": "Q1 2026",
    "sourceName": "Invesco QQQ Trust, Series 1 Fact Sheet",
    "sourceUrl": DEFAULT_QQQ_FACT_SHEET_URL,
    "methodNote": "Invesco 官方季度 fact sheet。P/E 与 P/B 为加权调和平均，ROE 为加权平均。",
    "metrics": {
        "pe": 36.52,
        "pb": 15.73,
        "roe": 38.97,
    },
}
SPY_OFFICIAL_FACT_SHEET_SNAPSHOT = {
    "asOf": "2026-03-31",
    "period": "Q1 2026",
    "sourceName": "State Street SPDR S&P 500 ETF Trust Fact Sheet",
    "sourceUrl": DEFAULT_SPY_FACT_SHEET_URL,
    "methodNote": "State Street 官方季度 fact sheet。P/E 与 P/B 为加权调和平均，ROE 为加权平均。",
    "metrics": {
        "pe": None,
        "pb": None,
        "roe": None,
    },
}


METRIC_DEFINITIONS = [
    ("pe", "市盈率", "x"),
    ("pb", "市净率", "x"),
    ("roe", "ROE", "%"),
    ("dividendYield", "股息率", "%"),
    ("peg", "PEG", "x"),
]

REQUIRED_DATASETS = [
    {
        "key": "indexConstituents",
        "name": "Nasdaq 100/QQQ 或 SPY 成分股清单",
        "required": True,
        "status": "missing",
        "note": "需要当前快照；计算历史分位还需要历史生效日期或定期快照。",
    },
    {
        "key": "indexWeights",
        "name": "成分权重",
        "required": True,
        "status": "missing",
        "note": "PE、PB、ROE、股息率、PEG 都需要一致权重口径。",
    },
    {
        "key": "componentPrices",
        "name": "成分股历史价格或历史市值",
        "required": True,
        "status": "available_without_index_membership",
        "note": "外接盘有美股日线价格，但没有成分权重，暂不能聚合到指数估值。",
    },
    {
        "key": "ttmFundamentals",
        "name": "TTM EPS、每股净资产、净利润、股东权益",
        "required": True,
        "status": "partial_unusable",
        "note": "仅发现少量 Polygon financials 批次，且当前环境读取行级数据失败；不是可直接用于指数估值的连续 TTM 面板。",
    },
    {
        "key": "dividends",
        "name": "分红明细或 TTM 股息面板",
        "required": True,
        "status": "partial",
        "note": "外接盘有分红明细；缺成分权重和价格对齐后才能计算指数股息率。",
    },
    {
        "key": "forwardGrowthEstimates",
        "name": "未来盈利增速预期",
        "required": True,
        "status": "missing",
        "note": "PEG 需要统一周期的 forward EPS growth；本地未发现可用于 QQQ/NDX 或 SPY 的一致增长率面板。",
    },
    {
        "key": "valuationHistory",
        "name": "同口径历史估值序列",
        "required": True,
        "status": "missing",
        "note": "历史分位必须使用同一计算口径的 PE/PB/ROE/股息率/PEG 序列，不能混用不同口径。",
    },
]


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def parse_date(value: Any) -> date | None:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except ValueError:
        return None


def safe_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and number not in (float("inf"), float("-inf")) else None


def normalize_symbol(value: Any) -> str:
    return str(value or "").strip().upper().replace(".", "-")


def pct(value: float | None, digits: int = 2) -> float | None:
    if value is None:
        return None
    return round(value, digits)


def parquet_metadata(path: Path, sample_columns: list[str] | None = None) -> dict[str, Any]:
    info: dict[str, Any] = {
        "path": str(path),
        "exists": path.exists(),
        "metadataReadable": False,
        "dataPageReadable": False,
    }
    if not path.exists():
        return info

    info["sizeBytes"] = path.stat().st_size
    try:
        import pyarrow.parquet as pq  # type: ignore
    except Exception as exc:
        info["error"] = f"pyarrow unavailable: {type(exc).__name__}: {exc}"
        return info

    try:
        parquet_file = pq.ParquetFile(path)
        info["rowCount"] = parquet_file.metadata.num_rows
        info["rowGroups"] = parquet_file.metadata.num_row_groups
        raw_columns = list(parquet_file.schema_arrow.names)
        info["columnsSample"] = [col for col in raw_columns if "source" not in col.lower()][:40]
        info["metadataReadable"] = True
    except Exception as exc:
        info["error"] = f"metadata read failed: {type(exc).__name__}: {exc}"
        return info

    try:
        columns = sample_columns or raw_columns[:1]
        parquet_file.read_row_group(0, columns=[col for col in columns if col in raw_columns][:1] or raw_columns[:1])
        info["dataPageReadable"] = True
    except Exception as exc:
        info["error"] = f"data page read failed: {type(exc).__name__}: {exc}"
    return info


def parquet_dir_summary(path: Path, recursive: bool = True, sample_columns: list[str] | None = None) -> dict[str, Any]:
    pattern = "**/*.parquet" if recursive else "*.parquet"
    files = sorted(
        file
        for file in path.glob(pattern)
        if file.is_file() and not file.name.startswith("._")
    ) if path.exists() else []
    summary: dict[str, Any] = {
        "path": str(path),
        "exists": path.exists(),
        "parquetCount": len(files),
    }
    if not files:
        return summary

    summary["firstFile"] = str(files[0])
    summary["lastFile"] = str(files[-1])
    summary["lastFileMetadata"] = parquet_metadata(files[-1], sample_columns=sample_columns)
    dated_names = [
        file.stem
        for file in files
        if len(file.stem) >= 10 and file.stem[:4].isdigit()
    ]
    if dated_names:
        summary["dateLabelRange"] = {"first": min(dated_names), "last": max(dated_names)}
    return summary


def fetch_qqq_holdings(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)

    raw_holdings = payload.get("holdings") if isinstance(payload, dict) else []
    holdings: list[dict[str, Any]] = []
    for item in raw_holdings or []:
        ticker = normalize_symbol(item.get("ticker"))
        if not ticker:
            continue
        weight = safe_float(item.get("percentageOfTotalNetAssets"))
        holdings.append(
            {
                "ticker": ticker,
                "rawTicker": item.get("ticker"),
                "issuerName": item.get("issuerName"),
                "units": safe_float(item.get("units")),
                "weightPct": weight,
                "securityTypeName": item.get("securityTypeName"),
                "securityTypeCode": item.get("securityTypeCode"),
                "currency": item.get("currency"),
            }
        )

    common_holdings = [
        item
        for item in holdings
        if str(item.get("securityTypeCode") or "").upper() in COMMON_STOCK_CODES
        or str(item.get("securityTypeName") or "").lower() == "common stock"
    ]
    if not common_holdings:
        common_holdings = [
            item
            for item in holdings
            if item.get("weightPct") is not None and item.get("currency") == "USD"
        ]

    return {
        "effectiveDate": payload.get("effectiveDate"),
        "effectiveBusinessDate": payload.get("effectiveBusinessDate"),
        "totalNumberOfHoldings": payload.get("totalNumberOfHoldings"),
        "holdings": holdings,
        "commonHoldings": common_holdings,
        "rawHoldingCount": len(raw_holdings or []),
    }


def read_xlsx_first_sheet(path: Path) -> list[list[str]]:
    with ZipFile(path) as workbook:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in workbook.namelist():
            shared_root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
            for item in shared_root.findall(f"{XLSX_NS}si"):
                shared_strings.append("".join(node.text or "" for node in item.iter(f"{XLSX_NS}t")))

        sheet_root = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
        rows: list[list[str]] = []
        for row in sheet_root.findall(f".//{XLSX_NS}row"):
            values: list[str] = []
            for cell in row.findall(f"{XLSX_NS}c"):
                raw = cell.find(f"{XLSX_NS}v")
                value = raw.text if raw is not None else ""
                if cell.get("t") == "s" and value:
                    value = shared_strings[int(value)]
                values.append(value)
            rows.append(values)
        return rows


def fetch_spy_holdings(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read()

    temp_path = Path("/tmp") / "ytd-gainers-spy-holdings.xlsx"
    temp_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path.write_bytes(payload)
    rows = read_xlsx_first_sheet(temp_path)

    effective_date = None
    header_index = None
    for index, row in enumerate(rows):
        if len(row) >= 2 and row[0] == "Holdings:":
            effective_date = str(row[1]).replace("As of ", "")
        if row[:5] == ["Name", "Ticker", "Identifier", "SEDOL", "Weight"]:
            header_index = index
            break
    if header_index is None:
        raise ValueError("SPY holdings header not found")

    holdings: list[dict[str, Any]] = []
    for row in rows[header_index + 1 :]:
        if len(row) < 5:
            continue
        ticker = normalize_symbol(row[1])
        weight = safe_float(row[4])
        if not ticker or weight is None:
            continue
        holdings.append(
            {
                "ticker": ticker,
                "rawTicker": row[1],
                "issuerName": row[0],
                "identifier": row[2] if len(row) > 2 else None,
                "sedol": row[3] if len(row) > 3 else None,
                "weightPct": weight,
                "sector": row[5] if len(row) > 5 else None,
                "units": safe_float(row[6]) if len(row) > 6 else None,
                "currency": row[7] if len(row) > 7 else None,
            }
        )

    return {
        "effectiveDate": effective_date,
        "effectiveBusinessDate": effective_date,
        "totalNumberOfHoldings": len(holdings),
        "holdings": holdings,
        "commonHoldings": [item for item in holdings if item.get("currency") in (None, "USD")],
        "rawHoldingCount": len(holdings),
    }


def latest_stock_price_snapshot(market_data_root: Path) -> dict[str, Any]:
    price_dir = market_data_root / "processed" / "polygon" / "stocks" / "1d"
    files = sorted(path for path in price_dir.rglob("*.parquet") if not path.name.startswith("._")) if price_dir.exists() else []
    if not files:
        return {"path": str(price_dir), "prices": {}, "asOf": None, "error": "latest_price_file_not_found"}

    import pyarrow.parquet as pq  # type: ignore

    latest = files[-1]
    table = pq.read_table(latest, columns=["symbol", "trade_date", "close"])
    rows = table.to_pylist()
    prices: dict[str, dict[str, Any]] = {}
    as_of: date | None = None
    for row in rows:
        symbol = normalize_symbol(row.get("symbol"))
        close = safe_float(row.get("close"))
        trade_date = parse_date(row.get("trade_date"))
        if not symbol or close is None or trade_date is None:
            continue
        prices[symbol] = {"close": close, "tradeDate": trade_date.isoformat()}
        if as_of is None or trade_date > as_of:
            as_of = trade_date

    return {"path": str(latest), "prices": prices, "asOf": as_of.isoformat() if as_of else None}


def read_price_history(market_data_root: Path, symbols: set[str], end: date | None, lookback_days: int = 90) -> dict[str, dict[str, float]]:
    if end is None:
        return {}
    start = end - timedelta(days=lookback_days)
    price_dir = market_data_root / "processed" / "polygon" / "stocks" / "1d"
    if not price_dir.exists():
        return {}

    import pyarrow.parquet as pq  # type: ignore

    history: dict[str, dict[str, float]] = defaultdict(dict)
    files = sorted(path for path in price_dir.rglob("*.parquet") if not path.name.startswith("._"))
    for path in files:
        file_date = parse_date(path.stem)
        if file_date is None or file_date < start or file_date > end:
            continue
        try:
            rows = pq.read_table(path, columns=["symbol", "trade_date", "close"]).to_pylist()
        except Exception:
            continue
        for row in rows:
            symbol = normalize_symbol(row.get("symbol"))
            if symbol not in symbols:
                continue
            trade_date = parse_date(row.get("trade_date"))
            close = safe_float(row.get("close"))
            if trade_date is None or close is None:
                continue
            history[trade_date.isoformat()][symbol] = close
    return dict(history)


def read_recent_dividends(market_data_root: Path, symbols: set[str], as_of: date) -> dict[str, float]:
    dividends_dir = market_data_root / "raw" / "polygon_rest" / "dividends_by_year"
    start = as_of - timedelta(days=365)
    files = [
        dividends_dir / f"dividends_{year}.parquet"
        for year in range(start.year, as_of.year + 1)
        if (dividends_dir / f"dividends_{year}.parquet").exists()
    ]
    if not files:
        return {}

    import pyarrow.parquet as pq  # type: ignore

    totals: dict[str, float] = defaultdict(float)
    for path in files:
        table = pq.read_table(path, columns=["ticker", "cash_amount", "dividend_type", "ex_dividend_date", "currency"])
        for row in table.to_pylist():
            ticker = normalize_symbol(row.get("ticker"))
            if ticker not in symbols:
                continue
            ex_date = parse_date(row.get("ex_dividend_date"))
            amount = safe_float(row.get("cash_amount"))
            if ex_date is None or amount is None:
                continue
            if not (start < ex_date <= as_of):
                continue
            if row.get("currency") != "USD" or row.get("dividend_type") != "CD":
                continue
            totals[ticker] += amount
    return dict(totals)


def nested_value(payload: dict[str, Any], *path: str) -> float | None:
    current: Any = payload
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    if isinstance(current, dict) and "value" in current:
        return safe_float(current.get("value"))
    return safe_float(current)


def financial_coverage(market_data_root: Path, holdings: list[dict[str, Any]]) -> dict[str, Any]:
    symbols = {item["ticker"] for item in holdings}
    weights = {item["ticker"]: safe_float(item.get("weightPct")) or 0.0 for item in holdings}
    financials_dir = market_data_root / "raw" / "polygon_rest" / "financials"
    files = sorted(path for path in financials_dir.glob("*.parquet") if not path.name.startswith("._")) if financials_dir.exists() else []
    coverage = {
        "financialFiles": len(files),
        "rowsRead": 0,
        "holdingsWithAnyFinancials": 0,
        "holdingsWithAnyFinancialsWeightPct": 0.0,
        "holdingsWithAnnualFinancials": 0,
        "holdingsWithAnnualFinancialsWeightPct": 0.0,
        "holdingsWithFourQuarterTtm": 0,
        "holdingsWithFourQuarterTtmWeightPct": 0.0,
        "holdingsWithEpsField": 0,
        "holdingsWithEquityField": 0,
        "holdingsWithNetIncomeField": 0,
        "canComputePe": False,
        "canComputePb": False,
        "canComputeRoe": False,
        "reason": "financial_coverage_or_fields_insufficient_for_index_level_metrics",
    }
    if not files:
        return coverage

    import pyarrow.parquet as pq  # type: ignore

    any_financials: set[str] = set()
    annual: set[str] = set()
    eps_field: set[str] = set()
    equity_field: set[str] = set()
    net_income_field: set[str] = set()
    quarterly_count: dict[str, int] = defaultdict(int)

    for path in files:
        try:
            rows = pq.read_table(path).to_pylist()
        except Exception as exc:
            coverage["readError"] = f"{path.name}: {type(exc).__name__}: {exc}"
            continue
        coverage["rowsRead"] += len(rows)
        for row in rows:
            row_symbols = [normalize_symbol(item) for item in row.get("tickers") or []]
            matched = [symbol for symbol in row_symbols if symbol in symbols]
            if not matched:
                continue
            financials = row.get("financials") or {}
            for symbol in matched:
                any_financials.add(symbol)
                if row.get("timeframe") == "annual":
                    annual.add(symbol)
                if row.get("timeframe") == "quarterly":
                    quarterly_count[symbol] += 1
                if nested_value(financials, "income_statement", "basic_earnings_per_share") is not None or nested_value(
                    financials, "income_statement", "diluted_earnings_per_share"
                ) is not None:
                    eps_field.add(symbol)
                if nested_value(financials, "balance_sheet", "equity") is not None or nested_value(
                    financials, "balance_sheet", "equity_attributable_to_parent"
                ) is not None:
                    equity_field.add(symbol)
                if nested_value(financials, "income_statement", "net_income_loss") is not None or nested_value(
                    financials, "income_statement", "net_income_loss_available_to_common_stockholders_basic"
                ) is not None:
                    net_income_field.add(symbol)

    four_quarter = {symbol for symbol, count in quarterly_count.items() if count >= 4}
    coverage.update(
        {
            "holdingsWithAnyFinancials": len(any_financials),
            "holdingsWithAnyFinancialsWeightPct": pct(sum(weights.get(symbol, 0.0) for symbol in any_financials), 2),
            "holdingsWithAnnualFinancials": len(annual),
            "holdingsWithAnnualFinancialsWeightPct": pct(sum(weights.get(symbol, 0.0) for symbol in annual), 2),
            "holdingsWithFourQuarterTtm": len(four_quarter),
            "holdingsWithFourQuarterTtmWeightPct": pct(sum(weights.get(symbol, 0.0) for symbol in four_quarter), 2),
            "holdingsWithEpsField": len(eps_field),
            "holdingsWithEquityField": len(equity_field),
            "holdingsWithNetIncomeField": len(net_income_field),
        }
    )
    return coverage


def latest_financial_rows(market_data_root: Path, symbols: set[str], max_filing_age_days: int = 540, as_of: date | None = None) -> dict[str, dict[str, Any]]:
    financials_dir = market_data_root / "raw" / "polygon_rest" / "financials"
    files = sorted(path for path in financials_dir.glob("*.parquet") if not path.name.startswith("._")) if financials_dir.exists() else []
    if not files:
        return {}

    import pyarrow.parquet as pq  # type: ignore

    latest: dict[str, tuple[tuple[str, str], dict[str, Any]]] = {}
    cutoff = (as_of or date.today()) - timedelta(days=max_filing_age_days)
    for path in files:
        try:
            rows = pq.read_table(path).to_pylist()
        except Exception:
            continue
        for row in rows:
            if row.get("timeframe") != "quarterly":
                continue
            filing_date = parse_date(row.get("filing_date"))
            if filing_date is None or filing_date < cutoff:
                continue
            row_symbols = [normalize_symbol(item) for item in row.get("tickers") or []]
            for symbol in row_symbols:
                if symbol not in symbols:
                    continue
                key = (str(row.get("filing_date") or ""), str(row.get("end_date") or ""))
                if symbol not in latest or key > latest[symbol][0]:
                    latest[symbol] = (key, row)
    return {symbol: row for symbol, (_, row) in latest.items()}


def weighted_harmonic(items: list[tuple[float, float]]) -> tuple[float | None, float]:
    total_weight = sum(weight for weight, value in items if value and value > 0)
    denominator = sum(weight / value for weight, value in items if value and value > 0)
    if not total_weight or not denominator:
        return None, 0.0
    return total_weight / denominator, total_weight


def weighted_average(items: list[tuple[float, float]]) -> tuple[float | None, float]:
    total_weight = sum(weight for weight, _ in items)
    if not total_weight:
        return None, 0.0
    return sum(weight * value for weight, value in items) / total_weight, total_weight


def build_price_driven_series(
    price_history: dict[str, dict[str, float]],
    components: list[dict[str, Any]],
    metric_key: str,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for trade_date, prices in sorted(price_history.items()):
        harmonic_items: list[tuple[float, float]] = []
        average_items: list[tuple[float, float]] = []
        for component in components:
            ticker = component.get("ticker")
            price = safe_float(prices.get(ticker))
            base_price = safe_float(component.get("price"))
            weight = safe_float(component.get("weightPct")) or 0.0
            if not ticker or price is None or base_price is None or base_price <= 0:
                continue
            base_value = safe_float(component.get(metric_key if metric_key != "roe" else "roePct"))
            if base_value is None:
                continue
            if metric_key in {"pe", "pb"}:
                value = base_value * price / base_price
                if value > 0:
                    harmonic_items.append((weight, value))
            elif metric_key == "roe":
                average_items.append((weight, base_value))
        if metric_key in {"pe", "pb"}:
            value, weight_coverage = weighted_harmonic(harmonic_items)
        else:
            value, weight_coverage = weighted_average(average_items)
        if value is None:
            continue
        rows.append(
            {
                "date": trade_date,
                "value": pct(value, 4),
                "coveragePct": pct(weight_coverage, 2),
                "method": "price_driven_approximation",
            }
        )
    return rows


def build_polygon_valuation_estimates(market_data_root: Path, holdings: list[dict[str, Any]], as_of: date | None) -> dict[str, Any]:
    symbols = {item["ticker"] for item in holdings}
    rows = latest_financial_rows(market_data_root, symbols, as_of=as_of)
    pe_items: list[tuple[float, float]] = []
    pb_items: list[tuple[float, float]] = []
    roe_items: list[tuple[float, float]] = []
    components: list[dict[str, Any]] = []

    for item in holdings:
        ticker = item["ticker"]
        row = rows.get(ticker)
        if not row:
            continue
        financials = row.get("financials") or {}
        income = financials.get("income_statement") or {}
        balance = financials.get("balance_sheet") or {}
        price = safe_float(item.get("price"))
        weight = safe_float(item.get("weightPct")) or 0.0
        eps = nested_value(income, "diluted_earnings_per_share") or nested_value(income, "basic_earnings_per_share")
        shares = nested_value(income, "diluted_average_shares") or nested_value(income, "basic_average_shares")
        net_income = nested_value(income, "net_income_loss") or nested_value(income, "net_income_loss_attributable_to_parent")
        equity = nested_value(balance, "equity_attributable_to_parent") or nested_value(balance, "equity")

        pe = (price / (eps * 4.0)) if price and eps and eps > 0 else None
        pb = (price * shares / equity) if price and shares and equity and equity > 0 else None
        roe = (net_income * 4.0 / equity * 100.0) if net_income is not None and equity and equity > 0 else None

        if pe is not None and pe > 0:
            pe_items.append((weight, pe))
        if pb is not None and pb > 0:
            pb_items.append((weight, pb))
        if roe is not None:
            roe_items.append((weight, roe))
        components.append(
            {
                "ticker": ticker,
                "weightPct": pct(weight, 4),
                "price": price,
                "filingDate": row.get("filing_date"),
                "fiscalPeriod": row.get("fiscal_period"),
                "fiscalYear": row.get("fiscal_year"),
                "pe": pct(pe, 4),
                "pb": pct(pb, 4),
                "roePct": pct(roe, 4),
            }
        )

    price_history = read_price_history(market_data_root, symbols, as_of, lookback_days=90)
    pe, pe_weight = weighted_harmonic(pe_items)
    pb, pb_weight = weighted_harmonic(pb_items)
    roe, roe_weight = weighted_average(roe_items)
    latest_filing_dates = sorted({item["filingDate"] for item in components if item.get("filingDate")})
    series = {
        "pe": build_price_driven_series(price_history, components, "pe"),
        "pb": build_price_driven_series(price_history, components, "pb"),
        "roe": build_price_driven_series(price_history, components, "roe"),
    }
    return {
        "method": "polygon_quarterly_annualized_estimate",
        "asOf": as_of.isoformat() if as_of else None,
        "latestFilingDate": latest_filing_dates[-1] if latest_filing_dates else None,
        "financialRowsMatched": len(rows),
        "components": sorted(components, key=lambda item: item.get("weightPct") or 0.0, reverse=True),
        "metrics": {
            "pe": {"value": pct(pe, 4), "weightCoveragePct": pct(pe_weight, 2), "componentCount": len(pe_items)},
            "pb": {"value": pct(pb, 4), "weightCoveragePct": pct(pb_weight, 2), "componentCount": len(pb_items)},
            "roe": {"value": pct(roe, 4), "weightCoveragePct": pct(roe_weight, 2), "componentCount": len(roe_items)},
        },
        "series": series,
        "note": "用当前可覆盖样本做近似估值。PE/PB 使用覆盖样本的加权调和平均，ROE 使用覆盖样本的加权平均；走势图仅反映近期价格变化对估值的影响。",
    }


def build_holdings_snapshot_from_data(market_data_root: Path, holdings_payload: dict[str, Any]) -> dict[str, Any]:
    price_snapshot = latest_stock_price_snapshot(market_data_root)
    prices = price_snapshot.get("prices", {})
    common_holdings = holdings_payload["commonHoldings"]
    common_symbols = {item["ticker"] for item in common_holdings}
    price_as_of = parse_date(price_snapshot.get("asOf"))
    dividend_totals = read_recent_dividends(market_data_root, common_symbols, price_as_of) if price_as_of else {}
    fin_coverage = financial_coverage(market_data_root, common_holdings)

    enriched: list[dict[str, Any]] = []
    dividend_value = 0.0
    priced_weight = 0.0
    dividend_payer_weight = 0.0
    missing_prices: list[str] = []

    for item in common_holdings:
        ticker = item["ticker"]
        weight = safe_float(item.get("weightPct")) or 0.0
        price_row = prices.get(ticker)
        close = safe_float(price_row.get("close")) if price_row else None
        ttm_dividend = dividend_totals.get(ticker, 0.0)
        dividend_yield = (ttm_dividend / close * 100.0) if close and close > 0 else None
        if close is None:
            missing_prices.append(ticker)
        else:
            priced_weight += weight
            dividend_value += (weight / 100.0) * ((dividend_yield or 0.0) / 100.0)
        if ttm_dividend > 0:
            dividend_payer_weight += weight
        enriched.append(
            {
                "ticker": ticker,
                "issuerName": item.get("issuerName"),
                "weightPct": pct(weight, 4),
                "units": item.get("units"),
                "price": pct(close, 4),
                "priceAsOf": price_row.get("tradeDate") if price_row else None,
                "ttmDividendPerShare": pct(ttm_dividend, 4),
                "dividendYieldPct": pct(dividend_yield, 4),
            }
        )

    common_weight = sum(safe_float(item.get("weightPct")) or 0.0 for item in common_holdings)
    top_holdings = sorted(enriched, key=lambda item: item.get("weightPct") or 0.0, reverse=True)[:10]
    polygon_estimates = build_polygon_valuation_estimates(market_data_root, enriched, price_as_of)
    return {
        "weightAsOf": holdings_payload.get("effectiveDate"),
        "effectiveBusinessDate": holdings_payload.get("effectiveBusinessDate"),
        "priceAsOf": price_snapshot.get("asOf"),
        "totalNumberOfHoldings": holdings_payload.get("totalNumberOfHoldings"),
        "holdingsWithTicker": len(holdings_payload["holdings"]),
        "valuationHoldings": len(common_holdings),
        "valuationWeightPct": pct(common_weight, 4),
        "priceCoveredHoldings": len(common_holdings) - len(missing_prices),
        "priceCoveredWeightPct": pct(priced_weight, 4),
        "priceCoveragePctOfValuationWeight": pct((priced_weight / common_weight * 100.0) if common_weight else None, 2),
        "priceMissingTickers": missing_prices,
        "dividendPayerHoldings": sum(1 for value in dividend_totals.values() if value > 0),
        "dividendPayerWeightPct": pct(dividend_payer_weight, 4),
        "topHoldings": top_holdings,
        "holdings": enriched,
        "dividendYieldMetric": {
            "value": pct(dividend_value * 100.0, 4),
            "coverage": {
                "holdingsCovered": len(common_holdings) - len(missing_prices),
                "holdingsTotal": len(common_holdings),
                "weightCoveragePct": pct((priced_weight / common_weight * 100.0) if common_weight else None, 2),
                "priceAsOf": price_snapshot.get("asOf"),
                "dividendWindowDays": 365,
                "ordinaryCashDividendsOnly": True,
            },
        },
        "fundamentalCoverage": fin_coverage,
        "polygonValuationEstimates": polygon_estimates,
    }


def build_holdings_snapshot(market_data_root: Path, holdings_url: str) -> dict[str, Any]:
    return build_holdings_snapshot_from_data(market_data_root, fetch_qqq_holdings(holdings_url))


def audit_local_sources(market_data_root: Path) -> dict[str, Any]:
    polygon_rest = market_data_root / "raw" / "polygon_rest"
    financials_dir = polygon_rest / "financials"
    local_root = LOCAL_MARKET_DATA_ROOT
    external_root = market_data_root

    searched_paths = [
        ROOT / "data",
        ROOT / "scripts",
        ROOT / "market-data-lab",
        local_root,
        external_root,
        Path("/Users/linlifu/Documents/美股PA "),
        Path("/Users/linlifu/Documents/pcdn_ng/data"),
    ]

    return {
        "checkedAt": now_iso(),
        "checkedPaths": [
            {"path": str(path), "exists": path.exists()}
            for path in searched_paths
        ],
        "directories": {
            "projectData": {"path": str(ROOT / "data"), "exists": (ROOT / "data").exists()},
            "projectMarketDataLabData": {
                "path": str(local_root),
                "exists": local_root.exists(),
                "note": "project-local directory is present but currently empty",
            },
            "externalMarketDataLabData": {
                "path": str(external_root),
                "exists": external_root.exists(),
            },
        },
        "structuredInventory": {
            "stockDailyBars": parquet_dir_summary(market_data_root / "processed" / "polygon" / "stocks" / "1d", sample_columns=["symbol"]),
            "stockSplitAdjustedDailyBars": parquet_dir_summary(market_data_root / "processed" / "polygon" / "stocks_split_adjusted" / "1d", recursive=False, sample_columns=["symbol"]),
            "tradableUniverse": parquet_dir_summary(market_data_root / "features" / "polygon" / "universe" / "daily_tradable_universe_by_year", sample_columns=["symbol"]),
            "dividendsByYear": parquet_dir_summary(polygon_rest / "dividends_by_year", recursive=False, sample_columns=["ticker"]),
            "dividendsLatestSmallFile": parquet_metadata(polygon_rest / "dividends.parquet", sample_columns=["ticker"]),
            "financials": parquet_dir_summary(financials_dir, recursive=False, sample_columns=["ticker", "tickers", "filing_date"]),
            "earnings": parquet_dir_summary(polygon_rest / "earnings", recursive=False, sample_columns=["ticker"]),
            "tickerReferenceActive": parquet_metadata(polygon_rest / "tickers_active.parquet", sample_columns=["ticker"]),
            "tickerReferenceInactive": parquet_metadata(polygon_rest / "tickers_inactive.parquet", sample_columns=["ticker"]),
            "indexDailyBarsRaw": parquet_dir_summary(market_data_root / "raw" / "polygon" / "us_indices" / "day_aggs_v1"),
        },
        "availability": {
            "qqqOrNasdaq100CurrentHoldings": "not_found",
            "qqqOrNasdaq100Weights": "not_found",
            "spyCurrentHoldings": "not_found",
            "spyWeights": "not_found",
            "componentDailyPrices": "available",
            "componentTtmFundamentals": "not_available_as_readable_panel",
            "componentDividends": "available_but_not_enough_without_holdings_and_weights",
            "forwardGrowthEstimates": "not_found",
            "historicalValuationSeries": "not_found",
        },
    }


def waiting_metric(key: str, label: str, unit: str) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "unit": unit,
        "status": "waiting_for_data",
        "value": None,
        "display": "等待估值数据",
        "asOf": None,
        "percentile": {
            "oneYear": None,
            "threeYear": None,
            "fiveYear": None,
            "tenYear": None,
        },
        "trend": [],
        "method": None,
    }


def computed_metric(
    key: str,
    label: str,
    unit: str,
    value: float | None,
    coverage: dict[str, Any],
    method: str,
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "unit": unit,
        "status": "computed",
        "value": value,
        "display": None if value is None else f"{value:.2f}{unit if unit != 'x' else 'x'}",
        "asOf": coverage.get("priceAsOf"),
        "coverage": coverage,
        "percentile": {
            "oneYear": None,
            "threeYear": None,
            "fiveYear": None,
            "tenYear": None,
        },
        "trend": [],
        "method": method,
    }


def official_snapshot_metric(
    key: str,
    label: str,
    unit: str,
    snapshot: dict[str, Any],
) -> dict[str, Any]:
    value = safe_float((snapshot.get("metrics") or {}).get(key))
    return {
        "key": key,
        "label": label,
        "unit": unit,
        "status": "computed",
        "value": value,
        "display": None if value is None else f"{value:.2f}{unit if unit != 'x' else 'x'}",
        "asOf": snapshot.get("asOf"),
        "note": "官方季度值",
        "coverage": {
            "period": snapshot.get("period"),
            "sourceName": snapshot.get("sourceName"),
            "methodNote": snapshot.get("methodNote"),
        },
        "percentile": {
            "oneYear": None,
            "threeYear": None,
            "fiveYear": None,
            "tenYear": None,
        },
        "trend": [],
        "method": snapshot.get("methodNote"),
    }


def polygon_estimate_metric(
    key: str,
    label: str,
    unit: str,
    estimates: dict[str, Any],
    fallback: dict[str, Any],
) -> dict[str, Any]:
    metric = (estimates.get("metrics") or {}).get(key) or {}
    value = safe_float(metric.get("value"))
    if value is None:
        return fallback
    coverage = {
        "method": estimates.get("method"),
        "methodNote": estimates.get("note"),
        "weightCoveragePct": metric.get("weightCoveragePct"),
        "componentCount": metric.get("componentCount"),
        "latestFilingDate": estimates.get("latestFilingDate"),
        "officialFallback": fallback.get("value"),
        "officialFallbackAsOf": fallback.get("asOf"),
    }
    return {
        "key": key,
        "label": label,
        "unit": unit,
        "status": "estimated",
        "value": value,
        "display": f"{value:.2f}{unit if unit != 'x' else 'x'}",
        "asOf": estimates.get("asOf"),
        "note": f"覆盖样本口径 · 权重{metric.get('weightCoveragePct')}%",
        "coverage": coverage,
        "percentile": {
            "oneYear": None,
            "threeYear": None,
            "fiveYear": None,
            "tenYear": None,
        },
        "trend": (estimates.get("series") or {}).get(key) or [],
        "method": estimates.get("note"),
    }


def readiness_datasets(partial_ready: bool, index_label: str = "指数") -> list[dict[str, Any]]:
    datasets = [dict(item) for item in REQUIRED_DATASETS]
    if not partial_ready:
        return datasets
    for item in datasets:
        if item["key"] == "indexConstituents":
            item["status"] = "available_current_snapshot"
            item["note"] = f"已接入 {index_label} 当前持仓快照；历史生效日期仍待补。"
        elif item["key"] == "indexWeights":
            item["status"] = "available_current_snapshot"
            item["note"] = f"已接入 {index_label} 当前成分权重；历史权重仍待补。"
        elif item["key"] == "componentPrices":
            item["status"] = "available_current_snapshot"
            item["note"] = f"外接盘最新日线覆盖当前 {index_label} 估值持仓。"
        elif item["key"] == "dividends":
            item["status"] = "available_for_current_metric"
            item["note"] = "可按近 365 天普通现金分红和当前权重计算股息率。"
    return datasets


def blocking_gaps(partial_ready: bool) -> list[dict[str, Any]]:
    if partial_ready:
        return [
            {
                "dataset": "ttm_fundamentals",
                "fields": ["date", "ticker", "ttm_eps", "book_value_per_share", "ttm_net_income", "shareholders_equity"],
                "minimumScope": "Point-in-time panel aligned to valuation dates.",
            },
            {
                "dataset": "shares_or_market_cap",
                "fields": ["date", "ticker", "shares_outstanding"],
                "minimumScope": "Needed for PB when book value per share is unavailable.",
            },
            {
                "dataset": "forward_growth",
                "fields": ["date", "ticker", "forward_eps_growth", "growth_period"],
                "minimumScope": "Needed only for PEG; one consistent period such as next fiscal year or long-term growth.",
            },
            {
                "dataset": "historical_holdings_weights",
                "fields": ["date", "ticker", "weight"],
                "minimumScope": "Needed for valuation trend and historical percentiles.",
            },
            {
                "dataset": "valuation_history",
                "fields": ["date", "pe", "pb", "roe", "dividend_yield", "peg"],
                "minimumScope": "Same methodology as current metrics; at least five years preferred for percentiles.",
            },
        ]
    return [
        {
            "dataset": "holdings_weights",
            "fields": ["date", "ticker", "weight"],
            "minimumScope": "QQQ/Nasdaq 100 current snapshot; for percentiles, monthly or daily history.",
        },
        {
            "dataset": "ttm_fundamentals",
            "fields": ["date", "ticker", "ttm_eps", "book_value_per_share", "ttm_net_income", "shareholders_equity"],
            "minimumScope": "Point-in-time panel aligned to valuation dates.",
        },
        {
            "dataset": "forward_growth",
            "fields": ["date", "ticker", "forward_eps_growth", "growth_period"],
            "minimumScope": "Needed only for PEG; one consistent period such as next fiscal year or long-term growth.",
        },
        {
            "dataset": "valuation_history",
            "fields": ["date", "pe", "pb", "roe", "dividend_yield", "peg"],
            "minimumScope": "Same methodology as current metrics; at least five years preferred for percentiles.",
        },
    ]


def build_single_index_payload(
    market_data_root: Path,
    index_symbol: str,
    index_name: str,
    holdings_url: str,
    fact_sheet_url: str,
    holdings_fetcher,
    official_snapshot_template: dict[str, Any],
) -> dict[str, Any]:
    audit = audit_local_sources(market_data_root)
    official_snapshot = {
        **official_snapshot_template,
        "sourceUrl": fact_sheet_url,
    }
    holdings_snapshot: dict[str, Any] | None = None
    holdings_error: str | None = None
    try:
        holdings_snapshot = build_holdings_snapshot_from_data(market_data_root, holdings_fetcher(holdings_url))
    except Exception as exc:
        holdings_error = f"{type(exc).__name__}: {exc}"

    if holdings_snapshot:
        audit["availability"].update(
            {
                "indexCurrentHoldings": "available",
                "indexWeights": "available_current_snapshot",
                "componentDailyPrices": f"available_for_current_{index_symbol.lower()}_holdings",
                "componentDividends": "available_for_current_dividend_yield",
            }
        )
    else:
        audit["holdingsFetchError"] = holdings_error
    audit["availability"]["officialQuarterlyValuation"] = "available_q1_2026_fact_sheet"

    dividend_metric = holdings_snapshot.get("dividendYieldMetric") if holdings_snapshot else None
    fundamental_coverage = holdings_snapshot.get("fundamentalCoverage") if holdings_snapshot else {}
    polygon_estimates = holdings_snapshot.get("polygonValuationEstimates") if holdings_snapshot else {}
    pe_official = official_snapshot_metric("pe", "市盈率", "x", official_snapshot)
    pe_waiting = polygon_estimate_metric("pe", "市盈率", "x", polygon_estimates or {}, pe_official)
    pe_waiting["coverage"] = {
        **(pe_waiting.get("coverage") or {}),
        "annualFinancialsWeightPct": fundamental_coverage.get("holdingsWithAnnualFinancialsWeightPct"),
        "fourQuarterTtmWeightPct": fundamental_coverage.get("holdingsWithFourQuarterTtmWeightPct"),
    }
    pb_official = official_snapshot_metric("pb", "市净率", "x", official_snapshot)
    pb_waiting = polygon_estimate_metric("pb", "市净率", "x", polygon_estimates or {}, pb_official)
    pb_waiting["coverage"] = {
        **(pb_waiting.get("coverage") or {}),
        "equityFieldHoldings": fundamental_coverage.get("holdingsWithEquityField"),
    }
    roe_official = official_snapshot_metric("roe", "ROE", "%", official_snapshot)
    roe_waiting = polygon_estimate_metric("roe", "ROE", "%", polygon_estimates or {}, roe_official)
    roe_waiting["coverage"] = {
        **(roe_waiting.get("coverage") or {}),
        "netIncomeFieldHoldings": fundamental_coverage.get("holdingsWithNetIncomeField"),
        "equityFieldHoldings": fundamental_coverage.get("holdingsWithEquityField"),
        "fourQuarterTtmWeightPct": fundamental_coverage.get("holdingsWithFourQuarterTtmWeightPct"),
    }
    peg_waiting = waiting_metric("peg", "PEG", "x")
    peg_waiting["coverage"] = {"forwardGrowthEstimates": "not_found"}
    peg_waiting["method"] = "需要统一周期的 forward EPS growth。"
    dividend_waiting = waiting_metric("dividendYield", "股息率", "%")
    metrics = [pe_waiting, pb_waiting, roe_waiting, dividend_waiting, peg_waiting]
    if dividend_metric and dividend_metric.get("value") is not None:
        metrics[3] = computed_metric(
            "dividendYield",
            "股息率",
            "%",
            dividend_metric.get("value"),
            dividend_metric.get("coverage") or {},
            f"按 {index_symbol} 当前成分权重聚合近 365 天普通现金分红与最新收盘价。",
        )

    partial_ready = bool(holdings_snapshot)
    computed_metrics = [metric["key"] for metric in metrics if metric.get("status") in {"computed", "estimated"}]
    return {
        "schemaVersion": 1,
        "generatedAt": now_iso(),
        "asOf": holdings_snapshot.get("priceAsOf") if holdings_snapshot else None,
        "module": "index-valuation",
        "title": f"{index_symbol} 估值观察",
        "status": "partial_data" if partial_ready else "waiting_for_data",
        "summary": (
            f"已接入 {index_symbol} 当前持仓权重、最新本地价格和可覆盖财务样本；历史分位和 PEG 仍等待完整财务口径。"
            if partial_ready
            else f"当前数据还不足以可靠计算 {index_symbol} 的 PE、PB、ROE、股息率、PEG 和历史分位。"
        ),
        "index": {
            "symbol": index_symbol,
            "name": index_name,
            "currency": "USD",
            "weighting": "constituent_weighted",
        },
        "weightAsOf": holdings_snapshot.get("weightAsOf") if holdings_snapshot else None,
        "priceAsOf": holdings_snapshot.get("priceAsOf") if holdings_snapshot else None,
        "coverage": (
            f"{index_symbol} 权重 {holdings_snapshot.get('weightAsOf')}；价格 {holdings_snapshot.get('priceAsOf')}；"
            f"估值样本覆盖约 {((polygon_estimates or {}).get('metrics') or {}).get('pe', {}).get('weightCoveragePct') or '--'}%；"
            f"当前权重价格覆盖 {holdings_snapshot.get('priceCoveragePctOfValuationWeight')}%。"
            if holdings_snapshot
            else None
        ),
        "officialValuationSnapshot": official_snapshot,
        "polygonValuationEstimates": polygon_estimates,
        "holdingsCoverage": holdings_snapshot if holdings_snapshot else {
            "status": "waiting_for_data",
            "error": holdings_error,
        },
        "topHoldings": holdings_snapshot.get("topHoldings") if holdings_snapshot else [],
        "dataReadiness": {
            "canComputeCurrentMetrics": bool(computed_metrics),
            "currentMetricStatus": "partial" if computed_metrics else "waiting_for_data",
            "computedMetrics": computed_metrics,
            "waitingMetrics": [metric["key"] for metric in metrics if metric.get("status") not in {"computed", "estimated"}],
            "canComputeHistoricalPercentiles": False,
            "canComputeTrendSeries": False,
            "reason": "partial_current_inputs_available" if partial_ready else "missing_required_index_valuation_inputs",
            "requiredDatasets": readiness_datasets(partial_ready, index_symbol),
            "blockingGaps": blocking_gaps(partial_ready),
        },
        "metrics": metrics,
        "trendSeries": [],
        "historyPercentiles": {
            "lookbackYears": None,
            "status": "waiting_for_data",
            "items": [],
        },
        "frontendHints": {
            "showWaitingState": not partial_ready,
            "emptyStateTitle": "等待估值数据",
            "emptyStateBody": "数据未接入前，不展示 PE、PB、ROE 等估值数字。",
            "hideMetricNumbers": False,
        },
        "copyGuardrails": ["仅展示数据状态和计算口径。", "不输出交易方向或时点判断。"],
        "audit": audit,
    }


def frontend_index_payload(payload: dict[str, Any]) -> dict[str, Any]:
    holdings = payload.get("holdingsCoverage") or {}
    holdings_summary_keys = [
        "weightAsOf",
        "effectiveBusinessDate",
        "priceAsOf",
        "totalNumberOfHoldings",
        "holdingsWithTicker",
        "valuationHoldings",
        "valuationWeightPct",
        "priceCoveredHoldings",
        "priceCoveredWeightPct",
        "priceCoveragePctOfValuationWeight",
        "dividendPayerHoldings",
        "dividendPayerWeightPct",
        "dividendYieldMetric",
        "fundamentalCoverage",
    ]
    holdings_summary = {key: holdings.get(key) for key in holdings_summary_keys if key in holdings}
    return {
        "schemaVersion": payload.get("schemaVersion"),
        "generatedAt": payload.get("generatedAt"),
        "asOf": payload.get("asOf"),
        "module": payload.get("module"),
        "title": payload.get("title"),
        "status": payload.get("status"),
        "summary": payload.get("summary"),
        "index": payload.get("index"),
        "weightAsOf": payload.get("weightAsOf"),
        "priceAsOf": payload.get("priceAsOf"),
        "coverage": payload.get("coverage"),
        "officialValuationSnapshot": payload.get("officialValuationSnapshot"),
        "holdingsCoverage": holdings_summary,
        "topHoldings": payload.get("topHoldings") or [],
        "dataReadiness": {
            "canComputeCurrentMetrics": (payload.get("dataReadiness") or {}).get("canComputeCurrentMetrics"),
            "currentMetricStatus": (payload.get("dataReadiness") or {}).get("currentMetricStatus"),
            "computedMetrics": (payload.get("dataReadiness") or {}).get("computedMetrics"),
            "waitingMetrics": (payload.get("dataReadiness") or {}).get("waitingMetrics"),
            "canComputeHistoricalPercentiles": (payload.get("dataReadiness") or {}).get("canComputeHistoricalPercentiles"),
            "canComputeTrendSeries": (payload.get("dataReadiness") or {}).get("canComputeTrendSeries"),
            "reason": (payload.get("dataReadiness") or {}).get("reason"),
            "blockingGaps": (payload.get("dataReadiness") or {}).get("blockingGaps"),
        },
        "metrics": payload.get("metrics") or [],
        "historyPercentiles": payload.get("historyPercentiles"),
        "frontendHints": payload.get("frontendHints"),
    }


def build_payload(market_data_root: Path, qqq_holdings_url: str, qqq_fact_sheet_url: str, spy_holdings_url: str, spy_fact_sheet_url: str) -> dict[str, Any]:
    qqq_payload = build_single_index_payload(
        market_data_root,
        "QQQ",
        "Nasdaq 100 / QQQ",
        qqq_holdings_url,
        qqq_fact_sheet_url,
        fetch_qqq_holdings,
        QQQ_OFFICIAL_FACT_SHEET_SNAPSHOT,
    )
    spy_payload = build_single_index_payload(
        market_data_root,
        "SPY",
        "S&P 500 / SPY",
        spy_holdings_url,
        spy_fact_sheet_url,
        fetch_spy_holdings,
        SPY_OFFICIAL_FACT_SHEET_SNAPSHOT,
    )
    qqq_frontend = frontend_index_payload(qqq_payload)
    spy_frontend = frontend_index_payload(spy_payload)
    return {
        "schemaVersion": 2,
        "generatedAt": now_iso(),
        "asOf": qqq_frontend.get("asOf"),
        "module": "index-valuation",
        "title": "指数估值观察",
        "status": qqq_frontend.get("status"),
        "summary": "已接入 QQQ 与 SPY 当前持仓权重、最新本地价格和可覆盖财务样本；历史分位和 PEG 仍等待完整财务口径。",
        "index": qqq_frontend.get("index"),
        "frontendHints": qqq_frontend.get("frontendHints"),
        "availableIndices": [
            {"symbol": "QQQ", "name": "纳指 100", "status": qqq_frontend.get("status")},
            {"symbol": "SPY", "name": "标普 500", "status": spy_frontend.get("status")},
        ],
        "indices": [qqq_frontend, spy_frontend],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build Nasdaq-100 valuation payload.")
    parser.add_argument(
        "--market-data-root",
        type=Path,
        default=DEFAULT_MARKET_DATA_ROOT,
        help="Path to market-data-lab/data.",
    )
    parser.add_argument(
        "--qqq-holdings-url",
        default=DEFAULT_QQQ_HOLDINGS_URL,
        help="Official QQQ holdings endpoint.",
    )
    parser.add_argument(
        "--qqq-fact-sheet-url",
        default=DEFAULT_QQQ_FACT_SHEET_URL,
        help="Official QQQ fact sheet URL used as fallback metadata.",
    )
    parser.add_argument(
        "--spy-holdings-url",
        default=DEFAULT_SPY_HOLDINGS_URL,
        help="Official SPY holdings workbook URL.",
    )
    parser.add_argument(
        "--spy-fact-sheet-url",
        default=DEFAULT_SPY_FACT_SHEET_URL,
        help="Official SPY fact sheet URL used as metadata.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    payload = build_payload(args.market_data_root, args.qqq_holdings_url, args.qqq_fact_sheet_url, args.spy_holdings_url, args.spy_fact_sheet_url)
    print(f"Built index valuation as of {payload.get('asOf') or '--'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

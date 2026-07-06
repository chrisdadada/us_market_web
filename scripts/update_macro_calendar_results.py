#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sqlite3
import urllib.request
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "product.db"


RESULT_COLUMNS = {
    "actual_value": "REAL",
    "actual_label": "TEXT",
    "forecast_value": "REAL",
    "forecast_label": "TEXT",
    "previous_value": "REAL",
    "previous_label": "TEXT",
    "result_updated_at": "TEXT",
}


def month_before(day: date) -> tuple[int, str]:
    first = day.replace(day=1)
    prev = first - timedelta(days=1)
    return prev.year, f"M{prev.month:02d}"


def previous_period(year: int, period: str) -> tuple[int, str]:
    month = int(period.removeprefix("M"))
    if month == 1:
        return year - 1, "M12"
    return year, f"M{month - 1:02d}"


def fetch_bls(series_ids: list[str], year: int, timeout: int) -> dict[str, dict[tuple[int, str], float]]:
    payload = {"seriesid": series_ids, "startyear": str(year - 1), "endyear": str(year)}
    req = urllib.request.Request(
        "https://api.bls.gov/publicAPI/v2/timeseries/data/",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "dongbimao/1.0"},
    )
    try:
        data = json.loads(urllib.request.urlopen(req, timeout=timeout).read())
    except Exception:
        return {}
    out: dict[str, dict[tuple[int, str], float]] = {}
    for series in data.get("Results", {}).get("series", []):
        points: dict[tuple[int, str], float] = {}
        for row in series.get("data", []):
            period = row.get("period")
            if not str(period).startswith("M"):
                continue
            try:
                points[(int(row["year"]), period)] = float(row["value"])
            except (KeyError, TypeError, ValueError):
                pass
        out[series.get("seriesID", "")] = points
    return out


def fetch_fred(series_id: str, timeout: int) -> list[tuple[date, float]]:
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
    try:
        text = urllib.request.urlopen(url, timeout=timeout).read().decode()
    except Exception:
        return []
    rows: list[tuple[date, float]] = []
    for row in csv.DictReader(io.StringIO(text)):
        try:
            value = float(row[series_id])
            rows.append((date.fromisoformat(row["observation_date"]), value))
        except (KeyError, TypeError, ValueError):
            pass
    return rows


def latest_on_or_before(rows: list[tuple[date, float]], day: date) -> tuple[date, float] | None:
    found = [row for row in rows if row[0] <= day]
    return found[-1] if found else None


def fred_monthly_points(series_id: str, timeout: int) -> dict[tuple[int, str], float]:
    return {
        (day.year, f"M{day.month:02d}"): value
        for day, value in fetch_fred(series_id, timeout)
    }


def ensure_columns(conn: sqlite3.Connection) -> None:
    existing = {row[1] for row in conn.execute("PRAGMA table_info(calendar_events)")}
    for name, col_type in RESULT_COLUMNS.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE calendar_events ADD COLUMN {name} {col_type}")


def update_event(
    conn: sqlite3.Connection,
    event_id: str,
    *,
    actual: float | None = None,
    actual_label: str | None = None,
    forecast: float | None = None,
    forecast_label: str | None = None,
    previous: float | None = None,
    previous_label: str | None = None,
) -> None:
    conn.execute(
        """
        UPDATE calendar_events
        SET actual_value = COALESCE(?, actual_value),
            actual_label = COALESCE(?, actual_label),
            forecast_value = COALESCE(?, forecast_value),
            forecast_label = COALESCE(?, forecast_label),
            previous_value = COALESCE(?, previous_value),
            previous_label = COALESCE(?, previous_label),
            result_updated_at = ?
        WHERE event_id = ?
        """,
        (
            actual,
            actual_label,
            forecast,
            forecast_label,
            previous,
            previous_label,
            datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S"),
            event_id,
        ),
    )


def number_value(value: Any) -> float | None:
    if value in (None, "", "-"):
        return None
    text = str(value).replace("%", "").replace(",", "").strip()
    multiplier = 1.0
    if text.upper().endswith("K"):
        multiplier = 1.0
        text = text[:-1]
    elif text.upper().endswith("M"):
        multiplier = 1000.0
        text = text[:-1]
    elif text.upper().endswith("B"):
        multiplier = 1000000.0
        text = text[:-1]
    try:
        return float(text) * multiplier
    except ValueError:
        return None


def label_value(value: Any, suffix: str = "") -> str | None:
    numeric = number_value(value)
    if numeric is None:
        return None
    if abs(numeric) >= 1000:
        return f"{numeric:,.0f}{suffix}"
    return f"{numeric:g}{suffix}"


def fetch_fmp_calendar(api_key: str, start: date, end: date, timeout: int) -> list[dict[str, Any]]:
    params = f"from={start.isoformat()}&to={end.isoformat()}&apikey={api_key}"
    urls = [
        f"https://financialmodelingprep.com/stable/economic-calendar?{params}",
        f"https://financialmodelingprep.com/api/v3/economic_calendar?{params}",
    ]
    for url in urls:
        try:
            data = json.loads(urllib.request.urlopen(url, timeout=timeout).read())
        except Exception:
            continue
        if isinstance(data, list):
            return [row for row in data if isinstance(row, dict)]
    return []


def macro_kind(title: str) -> str:
    text = title.lower()
    if "cpi" in text or "consumer price" in text:
        return "cpi"
    if "非农" in title or "employment situation" in text or "nonfarm" in text or "payroll" in text:
        return "payrolls"
    if "fomc" in text or "fed interest" in text or "federal funds" in text:
        return "fomc"
    return ""


def fmp_kind(row: dict[str, Any]) -> str:
    return macro_kind(" ".join(str(row.get(key) or "") for key in ("event", "name", "title")))


def fetch_trading_economics_calendar(api_key: str, start: date, end: date, timeout: int) -> list[dict[str, Any]]:
    if not api_key:
        return []
    url = (
        "https://api.tradingeconomics.com/calendar/country/"
        f"united%20states/{start.isoformat()}/{end.isoformat()}?c={quote(api_key)}&f=json"
    )
    try:
        data = json.loads(urllib.request.urlopen(url, timeout=timeout).read())
    except Exception:
        return []
    return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []


def trading_economics_kind(row: dict[str, Any]) -> str:
    text = " ".join(str(row.get(key) or "") for key in ("Event", "Category", "Ticker", "Symbol")).lower()
    if "non farm payroll" in text or "nonfarm payroll" in text or "payrolls" in text:
        return "payrolls"
    if "inflation rate" in text or "consumer price" in text or "cpi" in text:
        return "cpi"
    if "interest rate decision" in text or "fomc" in text or "fed interest rate" in text:
        return "fomc"
    return ""


def event_date(value: Any) -> str:
    return str(value or "")[:10]


def update_provider_events(conn: sqlite3.Connection, events: list[dict[str, Any]], kind_fn, date_key: str, forecast_key: str, actual_key: str, previous_key: str) -> int:
    rows = conn.execute(
        """
        SELECT event_id, event_date, title
        FROM calendar_events
        WHERE event_type = 'macro'
        """
    ).fetchall()
    by_date_kind: dict[tuple[str, str], dict[str, Any]] = {}
    for event in events:
        kind = kind_fn(event)
        day = event_date(event.get(date_key))
        if day and kind:
            by_date_kind.setdefault((day, kind), event)
    updated = 0
    for row in rows:
        kind = macro_kind(row["title"] or "")
        event = by_date_kind.get((row["event_date"], kind))
        if not event:
            continue
        suffix = "%" if kind in {"cpi", "fomc"} else "K"
        actual = number_value(event.get(actual_key))
        forecast = number_value(event.get(forecast_key))
        previous = number_value(event.get(previous_key))
        if actual is None and forecast is None and previous is None:
            continue
        update_event(
            conn,
            row["event_id"],
            actual=actual,
            actual_label=label_value(actual, suffix),
            forecast=forecast,
            forecast_label=label_value(forecast, suffix),
            previous=previous,
            previous_label=label_value(previous, suffix),
        )
        updated += 1
    return updated


def update_fmp_events(conn: sqlite3.Connection, api_key: str, timeout: int) -> int:
    if not api_key:
        return 0
    rows = conn.execute(
        """
        SELECT event_id, event_date, title
        FROM calendar_events
        WHERE event_type = 'macro'
        """
    ).fetchall()
    dates = [date.fromisoformat(row["event_date"]) for row in rows if row["event_date"]]
    if not dates:
        return 0
    events = fetch_fmp_calendar(api_key, min(dates) - timedelta(days=1), max(dates) + timedelta(days=1), timeout)
    return update_provider_events(conn, events, fmp_kind, "date", "estimate", "actual", "previous")


def update_trading_economics_events(conn: sqlite3.Connection, api_key: str, timeout: int) -> int:
    if not api_key:
        return 0
    rows = conn.execute("SELECT event_date FROM calendar_events WHERE event_type = 'macro'").fetchall()
    dates = [date.fromisoformat(row["event_date"]) for row in rows if row["event_date"]]
    if not dates:
        return 0
    events = fetch_trading_economics_calendar(api_key, min(dates) - timedelta(days=1), max(dates) + timedelta(days=1), timeout)
    return update_provider_events(conn, events, trading_economics_kind, "Date", "Forecast", "Actual", "Previous")


def update_bls_events(conn: sqlite3.Connection, timeout: int) -> int:
    rows = conn.execute(
        """
        SELECT event_id, event_date, title
        FROM calendar_events
        WHERE event_type = 'macro' AND (title LIKE '%CPI%' OR title LIKE '%非农%' OR title LIKE '%Employment Situation%')
        """
    ).fetchall()
    years = {date.fromisoformat(row["event_date"]).year for row in rows if row["event_date"]}
    series: dict[str, dict[tuple[int, str], float]] = {}
    for year in years:
        for key, points in fetch_bls(["CUUR0000SA0", "CES0000000001"], year, timeout).items():
            series.setdefault(key, {}).update(points)
    if not series.get("CUUR0000SA0"):
        series["CUUR0000SA0"] = fred_monthly_points("CPIAUCSL", timeout)
    if not series.get("CES0000000001"):
        series["CES0000000001"] = fred_monthly_points("PAYEMS", timeout)
    updated = 0
    for row in rows:
        event_day = date.fromisoformat(row["event_date"])
        year, period = month_before(event_day)
        title = row["title"] or ""
        if "CPI" in title:
            cpi = series.get("CUUR0000SA0", {})
            cur = cpi.get((year, period))
            prev_month = cpi.get(previous_period(year, period))
            last_year = cpi.get((year - 1, period))
            if cur is None or prev_month is None or last_year is None:
                continue
            yoy = (cur / last_year - 1) * 100
            mom = (cur / prev_month - 1) * 100
            update_event(conn, row["event_id"], actual=yoy, actual_label=f"同比 {yoy:.1f}%，环比 {mom:.1f}%")
            updated += 1
        elif "非农" in title or "Employment Situation" in title:
            payrolls = series.get("CES0000000001", {})
            cur = payrolls.get((year, period))
            prev_key = previous_period(year, period)
            prev = payrolls.get(prev_key)
            prev_prev = payrolls.get(previous_period(*prev_key))
            if cur is None or prev is None:
                continue
            change = cur - prev
            last_change = (prev - prev_prev) if prev_prev is not None else None
            update_event(conn, row["event_id"], actual=change, actual_label=f"{change:+.0f}K", previous=last_change, previous_label=f"{last_change:+.0f}K" if last_change is not None else None)
            updated += 1
    return updated


def update_fomc_events(conn: sqlite3.Connection, timeout: int) -> int:
    upper = fetch_fred("DFEDTARU", timeout)
    lower = fetch_fred("DFEDTARL", timeout)
    if not upper or not lower:
        return 0
    updated = 0
    for row in conn.execute("SELECT event_id, event_date, title FROM calendar_events WHERE event_type = 'macro' AND title LIKE '%FOMC%'"):
        day = date.fromisoformat(row["event_date"]) + timedelta(days=2)
        up = latest_on_or_before(upper, day)
        low = latest_on_or_before(lower, day)
        prev_up = latest_on_or_before(upper, day - timedelta(days=7))
        prev_low = latest_on_or_before(lower, day - timedelta(days=7))
        if not up or not low:
            continue
        label = f"{low[1]:.2f}%-{up[1]:.2f}%"
        prev_label = f"{prev_low[1]:.2f}%-{prev_up[1]:.2f}%" if prev_up and prev_low else None
        update_event(conn, row["event_id"], actual=up[1], actual_label=label, previous=prev_up[1] if prev_up else None, previous_label=prev_label)
        updated += 1
    return updated


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--fmp-api-key", default=os.environ.get("FMP_API_KEY", ""))
    parser.add_argument("--trading-economics-key", default=os.environ.get("TRADING_ECONOMICS_KEY", ""))
    args = parser.parse_args()
    with sqlite3.connect(args.db) as conn:
        conn.row_factory = sqlite3.Row
        ensure_columns(conn)
        bls_count = update_bls_events(conn, args.timeout)
        fomc_count = update_fomc_events(conn, args.timeout)
        fmp_count = update_fmp_events(conn, args.fmp_api_key, args.timeout)
        te_count = update_trading_economics_events(conn, args.trading_economics_key, args.timeout)
    print(f"Macro calendar results updated: BLS={bls_count}, FOMC={fomc_count}, FMP={fmp_count}, TE={te_count}")


if __name__ == "__main__":
    main()

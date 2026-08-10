#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import sqlite3
import urllib.request
from datetime import UTC, date, datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo


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
    if "revision" in text or "benchmark" in text:
        return ""
    if "non farm payroll" in text or "nonfarm payroll" in text or "payrolls" in text:
        return "payrolls"
    if "inflation rate" in text or "consumer price" in text or "cpi" in text:
        return "cpi"
    if "interest rate decision" in text or "fomc" in text or "fed interest rate" in text:
        return "fomc"
    return ""


class PublicCalendarParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_calendar = False
        self.in_row = False
        self.cell: list[str] | None = None
        self.cells: list[str] = []
        self.rows: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "table" and attributes.get("id") == "calendar":
            self.in_calendar = True
        elif self.in_calendar and tag == "tr":
            self.in_row = True
            self.cells = []
        elif self.in_row and tag == "td":
            self.cell = []

    def handle_data(self, data: str) -> None:
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self.cell is not None:
            self.cells.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.in_row:
            self.in_row = False
            if len(self.cells) >= 7:
                try:
                    released = datetime.strptime(
                        f"{self.cells[0]} {self.cells[1]}", "%Y-%m-%d %I:%M %p"
                    ).replace(tzinfo=UTC).astimezone(ZoneInfo("Asia/Shanghai"))
                except ValueError:
                    return
                self.rows.append({
                    "Date": released.date().isoformat(),
                    "Time": released.strftime("%H:%M"),
                    "Event": self.cells[2],
                    "Actual": self.cells[4],
                    "Previous": self.cells[5],
                    "Forecast": self.cells[6],
                })
        elif tag == "table" and self.in_calendar:
            self.in_calendar = False


class PublicRangeCalendarParser(HTMLParser):
    TARGET_EVENTS = {"inflation rate yoy", "non farm payrolls"}

    def __init__(self) -> None:
        super().__init__()
        self.row_depth = 0
        self.cell_depth = 0
        self.event = ""
        self.event_date = ""
        self.cell: list[str] | None = None
        self.cells: list[str] = []
        self.rows: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "tr":
            if self.row_depth:
                self.row_depth += 1
                return
            event = str(attributes.get("data-event") or "").strip().lower()
            country = str(attributes.get("data-country") or "").strip().lower()
            if country == "united states" and event in self.TARGET_EVENTS:
                self.row_depth = 1
                self.event = event
                self.event_date = ""
                self.cells = []
        elif tag == "td" and self.row_depth:
            if self.cell is None:
                self.cell = []
                classes = str(attributes.get("class") or "")
                match = re.search(r"\b\d{4}-\d{2}-\d{2}\b", classes)
                if not self.event_date and match:
                    self.event_date = match.group(0)
            self.cell_depth += 1

    def handle_data(self, data: str) -> None:
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self.row_depth and self.cell is not None:
            self.cell_depth -= 1
            if self.cell_depth == 0:
                self.cells.append(" ".join("".join(self.cell).split()))
                self.cell = None
        elif tag == "tr" and self.row_depth:
            self.row_depth -= 1
            if self.row_depth == 0:
                self._finish_row()

    def _finish_row(self) -> None:
        if not self.event_date or len(self.cells) < 6:
            return
        try:
            released = datetime.strptime(
                f"{self.event_date} {self.cells[0]}", "%Y-%m-%d %I:%M %p"
            ).replace(tzinfo=UTC).astimezone(ZoneInfo("Asia/Shanghai"))
        except ValueError:
            return
        self.rows.append({
            "Date": released.date().isoformat(),
            "Time": released.strftime("%H:%M"),
            "Event": "Inflation Rate YoY" if self.event == "inflation rate yoy" else "Non Farm Payrolls",
            "Actual": self.cells[3],
            "Previous": self.cells[4],
            "Forecast": self.cells[5],
        })


PUBLIC_CONSENSUS_PAGES = (
    "https://tradingeconomics.com/united-states/inflation-cpi",
    "https://tradingeconomics.com/united-states/non-farm-payrolls",
    "https://tradingeconomics.com/united-states/interest-rate",
)


def fetch_public_consensus_calendar(timeout: int) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for url in PUBLIC_CONSENSUS_PAGES:
        req = urllib.request.Request(url, headers={"User-Agent": "dongbimao/1.0"})
        try:
            parser = PublicCalendarParser()
            parser.feed(urllib.request.urlopen(req, timeout=timeout).read(2_000_001).decode(errors="ignore"))
        except Exception:
            continue
        rows.extend(parser.rows)
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    range_url = (
        "https://tradingeconomics.com/united-states/calendar/"
        f"{(today - timedelta(days=7)).isoformat()}/{(today + timedelta(days=90)).isoformat()}"
    )
    try:
        parser = PublicRangeCalendarParser()
        req = urllib.request.Request(range_url, headers={"User-Agent": "dongbimao/1.0"})
        parser.feed(urllib.request.urlopen(req, timeout=timeout).read(3_000_001).decode(errors="ignore"))
        rows.extend(parser.rows)
    except Exception:
        pass
    unique: dict[tuple[str, str, str], dict[str, str]] = {}
    for row in rows:
        key = (row.get("Date", ""), row.get("Time", ""), row.get("Event", ""))
        unique[key] = row
    return list(unique.values())


def event_date(value: Any) -> str:
    return str(value or "")[:10]


def macro_release_at(row: sqlite3.Row) -> datetime:
    event_time = row["event_time"] if "event_time" in row.keys() and row["event_time"] else "23:59"
    return datetime.strptime(f"{row['event_date']} {str(event_time)[:5]}", "%Y-%m-%d %H:%M").replace(tzinfo=ZoneInfo("Asia/Shanghai"))


def provider_match_score(kind: str, event: dict[str, Any]) -> int:
    text = " ".join(str(value or "") for value in event.values()).lower()
    if kind != "cpi":
        return 1
    if "core" in text or "核心" in text:
        return -1
    if "mom" in text or "month over month" in text or "monthly" in text:
        return -1
    if "yoy" in text or "year over year" in text or "annual" in text:
        return 30
    if "inflation rate" in text or "consumer price" in text or "cpi" in text:
        return 10
    return -1


def update_provider_events(conn: sqlite3.Connection, events: list[dict[str, Any]], kind_fn, date_key: str, forecast_key: str, actual_key: str, previous_key: str) -> int:
    rows = conn.execute(
        """
        SELECT *
        FROM calendar_events
        WHERE event_type = 'macro'
        """
    ).fetchall()
    by_date_kind: dict[tuple[str, str], tuple[int, dict[str, Any]]] = {}
    for event in events:
        kind = kind_fn(event)
        day = event_date(event.get(date_key))
        if day and kind:
            score = provider_match_score(kind, event)
            existing = by_date_kind.get((day, kind))
            if score >= 0 and (existing is None or score > existing[0]):
                by_date_kind[(day, kind)] = (score, event)
    updated = 0
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    for row in rows:
        kind = macro_kind(row["title"] or "")
        match = by_date_kind.get((row["event_date"], kind))
        if not match:
            continue
        event = match[1]
        suffix = "%" if kind in {"cpi", "fomc"} else "K"
        actual = number_value(event.get(actual_key)) if macro_release_at(row) <= now else None
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
        SELECT *
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


def ensure_public_macro_events(conn: sqlite3.Connection, events: list[dict[str, Any]]) -> int:
    window = conn.execute(
        "SELECT MIN(event_date), MAX(event_date) FROM calendar_events WHERE event_type = 'macro'"
    ).fetchone()
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    start = date.fromisoformat(window[0]) if window and window[0] else today - timedelta(days=45)
    end = date.fromisoformat(window[1]) if window and window[1] else today + timedelta(days=90)
    existing = {
        (row["event_date"], macro_kind(row["title"] or ""))
        for row in conn.execute("SELECT event_date, title FROM calendar_events WHERE event_type = 'macro'")
    }
    details = {
        "cpi": ("美国 CPI", "通胀数据会影响降息预期、成长股估值和美债利率交易。"),
        "payrolls": ("美国非农就业", "就业数据会影响降息预期、小盘风险偏好和美元利率交易。"),
    }
    inserted = 0
    for event in events:
        kind = trading_economics_kind(event)
        day = event_date(event.get("Date"))
        if kind not in details or not day or not (start <= date.fromisoformat(day) <= end) or (day, kind) in existing:
            continue
        title, summary = details[kind]
        event_time = str(event.get("Time") or "")
        source = "Trading Economics"
        payload = {
            "date": day, "time": event_time, "title": title, "type": "macro", "impact": "high",
            "sourceName": source, "relatedModules": ["美股重点财经前瞻"], "relatedAssets": [], "summary": summary,
        }
        basis = json.dumps([day, event_time, title, source], ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        conn.execute(
            """
            INSERT OR IGNORE INTO calendar_events
            (event_id, event_date, event_time, title, event_type, impact, source_name,
             related_modules_json, related_assets_json, summary, payload_json)
            VALUES (?, ?, ?, ?, 'macro', 'high', ?, ?, '[]', ?, ?)
            """,
            (
                hashlib.sha1(basis.encode()).hexdigest(), day, event_time, title, source,
                '["美股重点财经前瞻"]', summary,
                json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
            ),
        )
        if conn.execute("SELECT changes()").fetchone()[0]:
            inserted += 1
            existing.add((day, kind))
    return inserted


def update_public_consensus_events(
    conn: sqlite3.Connection,
    timeout: int,
    events: list[dict[str, Any]] | None = None,
) -> int:
    events = fetch_public_consensus_calendar(timeout) if events is None else events
    by_date_kind: dict[tuple[str, str], tuple[int, dict[str, Any]]] = {}
    for event in events:
        kind = trading_economics_kind(event)
        day = event_date(event.get("Date"))
        score = provider_match_score(kind, event)
        existing = by_date_kind.get((day, kind))
        if day and kind and score >= 0 and (existing is None or score > existing[0]):
            by_date_kind[(day, kind)] = (score, event)

    updated = 0
    for row in conn.execute(
        "SELECT event_id, event_date, title, previous_value FROM calendar_events WHERE event_type = 'macro'"
    ):
        kind = macro_kind(row["title"] or "")
        match = by_date_kind.get((row["event_date"], kind))
        if not match:
            continue
        event = match[1]
        forecast = number_value(event.get("Forecast"))
        if forecast is None:
            continue
        previous = number_value(event.get("Previous")) if row["previous_value"] is None else None
        suffix = "%" if kind in {"cpi", "fomc"} else "K"
        update_event(
            conn,
            row["event_id"],
            forecast=forecast,
            forecast_label=label_value(forecast, suffix),
            previous=previous,
            previous_label=label_value(previous, suffix),
        )
        updated += 1
    return updated


def update_bls_events(conn: sqlite3.Connection, timeout: int) -> int:
    rows = conn.execute(
        """
        SELECT *
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
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    for row in rows:
        event_day = date.fromisoformat(row["event_date"])
        if macro_release_at(row) > now:
            continue
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
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    rows = list(conn.execute(
        "SELECT event_id, event_date, event_time, title FROM calendar_events WHERE event_type = 'macro' AND title LIKE '%FOMC%'"
    ))
    for row in rows:
        release_at = macro_release_at(row)
        if release_at > now:
            conn.execute(
                "UPDATE calendar_events SET actual_value = NULL, actual_label = NULL WHERE event_id = ?",
                (row["event_id"],),
            )
    upper = fetch_fred("DFEDTARU", timeout)
    lower = fetch_fred("DFEDTARL", timeout)
    if not upper or not lower:
        return 0
    updated = 0
    for row in rows:
        release_at = macro_release_at(row)
        if release_at > now:
            current_up = latest_on_or_before(upper, now.date())
            current_low = latest_on_or_before(lower, now.date())
            if current_up and current_low:
                update_event(
                    conn,
                    row["event_id"],
                    previous=current_up[1],
                    previous_label=f"{current_low[1]:.2f}%-{current_up[1]:.2f}%",
                )
            continue
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
        public_events = fetch_public_consensus_calendar(args.timeout)
        inserted_count = ensure_public_macro_events(conn, public_events)
        now = datetime.now(ZoneInfo("Asia/Shanghai"))
        today = now.date().isoformat()
        conn.execute(
            """
            UPDATE calendar_events
            SET actual_value = NULL, actual_label = NULL
            WHERE event_type = 'macro'
              AND (event_date > ?
                   OR (event_date = ? AND COALESCE(NULLIF(event_time, ''), '23:59') > ?))
            """,
            (today, today, now.strftime("%H:%M")),
        )
        bls_count = update_bls_events(conn, args.timeout)
        fomc_count = update_fomc_events(conn, args.timeout)
        public_count = update_public_consensus_events(conn, args.timeout, public_events)
        fmp_count = update_fmp_events(conn, args.fmp_api_key, args.timeout)
        te_count = update_trading_economics_events(conn, args.trading_economics_key, args.timeout)
    print(f"Macro calendar results updated: Added={inserted_count}, BLS={bls_count}, FOMC={fomc_count}, Public={public_count}, FMP={fmp_count}, TE={te_count}")


if __name__ == "__main__":
    main()

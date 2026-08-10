import sqlite3
import unittest
from contextlib import closing
from datetime import date
from unittest.mock import patch

import scripts.update_macro_calendar_results as macro_results


class MacroCalendarResultsTest(unittest.TestCase):
    def test_nonfarm_annual_revision_is_not_a_monthly_payroll_event(self) -> None:
        self.assertEqual(
            macro_results.trading_economics_kind(
                {"Event": "Non Farm Payrolls Annual Revision Prel"}
            ),
            "",
        )

    def test_public_calendar_parser_reads_consensus_and_converts_gmt_date(self) -> None:
        parser = macro_results.PublicCalendarParser()
        parser.feed(
            """
            <table id="calendar">
              <tr><td>2026-07-29</td><td>06:00 PM</td><td>Fed Interest Rate Decision</td>
              <td></td><td>3.75%</td><td>3.75%</td><td>3.75%</td><td>3.75%</td></tr>
            </table>
            """
        )
        self.assertEqual(
            parser.rows,
            [{"Date": "2026-07-30", "Time": "02:00", "Event": "Fed Interest Rate Decision", "Actual": "3.75%", "Previous": "3.75%", "Forecast": "3.75%"}],
        )

    def test_public_consensus_does_not_replace_official_actual_or_previous(self) -> None:
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute(
                """
                CREATE TABLE calendar_events (
                  event_id TEXT PRIMARY KEY, event_date TEXT, title TEXT, event_type TEXT,
                  actual_value REAL, actual_label TEXT, forecast_value REAL, forecast_label TEXT,
                  previous_value REAL, previous_label TEXT, result_updated_at TEXT
                )
                """
            )
            conn.execute(
                """INSERT INTO calendar_events
                   (event_id, event_date, title, event_type, actual_value, actual_label, previous_value, previous_label)
                   VALUES ('nfp', '2026-07-02', 'Employment Situation / 非农就业', 'macro', 58, '+58K', 130, '+130K')"""
            )
            public_rows = [{"Date": "2026-07-02", "Event": "Non Farm Payrolls", "Actual": "57K", "Previous": "129K", "Forecast": "110K"}]
            with patch.object(macro_results, "fetch_public_consensus_calendar", return_value=public_rows):
                self.assertEqual(macro_results.update_public_consensus_events(conn, 1), 1)

            row = conn.execute("SELECT actual_label, forecast_label, previous_label FROM calendar_events").fetchone()
            self.assertEqual(dict(row), {"actual_label": "+58K", "forecast_label": "110K", "previous_label": "+130K"})

    def test_public_calendar_adds_missing_cpi_event(self) -> None:
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute(
                """
                CREATE TABLE calendar_events (
                  event_id TEXT PRIMARY KEY, event_date TEXT, event_time TEXT, title TEXT, event_type TEXT,
                  impact TEXT, source_name TEXT, related_modules_json TEXT, related_assets_json TEXT,
                  summary TEXT, payload_json TEXT
                )
                """
            )
            conn.execute(
                "INSERT INTO calendar_events VALUES ('range', '2026-06-01', '', '美国初请失业金', 'macro', '', '', '[]', '[]', '', '{}')"
            )
            conn.execute(
                "INSERT INTO calendar_events VALUES ('range2', '2026-09-01', '', '美国初请失业金', 'macro', '', '', '[]', '[]', '', '{}')"
            )
            rows = [{"Date": "2026-07-14", "Time": "20:30", "Event": "Inflation Rate YoY"}]
            self.assertEqual(macro_results.ensure_public_macro_events(conn, rows), 1)
            event = conn.execute("SELECT event_date, event_time, title, source_name FROM calendar_events WHERE title = '美国 CPI'").fetchone()
            self.assertEqual(dict(event), {"event_date": "2026-07-14", "event_time": "20:30", "title": "美国 CPI", "source_name": "Trading Economics"})

    def test_fmp_forecast_updates_matching_macro_event(self) -> None:
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute(
                """
                CREATE TABLE calendar_events (
                  event_id TEXT PRIMARY KEY,
                  event_date TEXT,
                  event_time TEXT,
                  title TEXT,
                  event_type TEXT,
                  actual_value REAL,
                  actual_label TEXT,
                  forecast_value REAL,
                  forecast_label TEXT,
                  previous_value REAL,
                  previous_label TEXT,
                  result_updated_at TEXT
                )
                """
            )
            conn.execute(
                "INSERT INTO calendar_events (event_id, event_date, title, event_type) VALUES (?, ?, ?, ?)",
                ("e1", "2026-07-02", "Employment Situation / 非农就业", "macro"),
            )

            with patch.object(
                macro_results,
                "fetch_fmp_calendar",
                return_value=[{"date": "2026-07-02 08:30:00", "event": "Nonfarm Payrolls", "actual": 57, "estimate": 110, "previous": 129}],
            ):
                self.assertEqual(macro_results.update_fmp_events(conn, "key", 1), 1)

            row = conn.execute("SELECT actual_label, forecast_label, previous_label FROM calendar_events").fetchone()
            self.assertEqual(dict(row), {"actual_label": "57K", "forecast_label": "110K", "previous_label": "129K"})

    def test_trading_economics_forecast_updates_matching_macro_event(self) -> None:
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute(
                """
                CREATE TABLE calendar_events (
                  event_id TEXT PRIMARY KEY,
                  event_date TEXT,
                  event_time TEXT,
                  title TEXT,
                  event_type TEXT,
                  actual_value REAL,
                  actual_label TEXT,
                  forecast_value REAL,
                  forecast_label TEXT,
                  previous_value REAL,
                  previous_label TEXT,
                  result_updated_at TEXT
                )
                """
            )
            conn.execute(
                "INSERT INTO calendar_events (event_id, event_date, title, event_type) VALUES (?, ?, ?, ?)",
                ("e1", "2026-07-02", "Employment Situation / 非农就业", "macro"),
            )

            with patch.object(
                macro_results,
                "fetch_trading_economics_calendar",
                return_value=[{"Date": "2026-07-02T08:30:00", "Event": "Non Farm Payrolls", "Actual": "57K", "Forecast": "110K", "Previous": "129K"}],
            ):
                self.assertEqual(macro_results.update_trading_economics_events(conn, "guest:guest", 1), 1)

            row = conn.execute("SELECT actual_label, forecast_label, previous_label FROM calendar_events").fetchone()
            self.assertEqual(dict(row), {"actual_label": "57K", "forecast_label": "110K", "previous_label": "129K"})

    def test_provider_does_not_publish_future_actual(self) -> None:
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute(
                """
                CREATE TABLE calendar_events (
                  event_id TEXT PRIMARY KEY,
                  event_date TEXT,
                  title TEXT,
                  event_type TEXT,
                  actual_value REAL,
                  actual_label TEXT,
                  forecast_value REAL,
                  forecast_label TEXT,
                  previous_value REAL,
                  previous_label TEXT,
                  result_updated_at TEXT
                )
                """
            )
            conn.execute(
                "INSERT INTO calendar_events (event_id, event_date, title, event_type) VALUES (?, ?, ?, ?)",
                ("future-cpi", "2099-07-14", "美国 CPI", "macro"),
            )
            rows = [{"Date": "2099-07-14T08:30:00", "Event": "Inflation Rate YoY", "Actual": "3.5%", "Forecast": "3.8%", "Previous": "4.2%"}]
            with patch.object(macro_results, "fetch_trading_economics_calendar", return_value=rows):
                self.assertEqual(macro_results.update_trading_economics_events(conn, "key", 1), 1)

            row = conn.execute(
                "SELECT actual_label, forecast_label, previous_label FROM calendar_events"
            ).fetchone()
            self.assertEqual(dict(row), {"actual_label": None, "forecast_label": "3.8%", "previous_label": "4.2%"})

    def test_cpi_prefers_headline_yoy_over_core_and_monthly_rows(self) -> None:
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute(
                """
                CREATE TABLE calendar_events (
                  event_id TEXT PRIMARY KEY,
                  event_date TEXT,
                  title TEXT,
                  event_type TEXT,
                  actual_value REAL,
                  actual_label TEXT,
                  forecast_value REAL,
                  forecast_label TEXT,
                  previous_value REAL,
                  previous_label TEXT,
                  result_updated_at TEXT
                )
                """
            )
            conn.execute(
                "INSERT INTO calendar_events (event_id, event_date, title, event_type) VALUES (?, ?, ?, ?)",
                ("cpi", "2026-07-14", "美国 CPI", "macro"),
            )
            rows = [
                {"Date": "2026-07-14T08:30:00", "Event": "Core CPI MoM", "Actual": "0.0%", "Forecast": "0.3%", "Previous": "0.2%"},
                {"Date": "2026-07-14T08:30:00", "Event": "Inflation Rate MoM", "Actual": "0.5%", "Forecast": "0.5%", "Previous": "0.6%"},
                {"Date": "2026-07-14T08:30:00", "Event": "Inflation Rate YoY", "Actual": "3.5%", "Forecast": "3.8%", "Previous": "4.2%"},
            ]
            with patch.object(macro_results, "fetch_trading_economics_calendar", return_value=rows):
                self.assertEqual(macro_results.update_trading_economics_events(conn, "key", 1), 1)

            row = conn.execute("SELECT actual_label, forecast_label, previous_label FROM calendar_events").fetchone()
            self.assertEqual(dict(row), {"actual_label": "3.5%", "forecast_label": "3.8%", "previous_label": "4.2%"})

    def test_future_fomc_event_is_not_marked_as_published(self) -> None:
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute(
                """
                CREATE TABLE calendar_events (
                  event_id TEXT PRIMARY KEY,
                  event_date TEXT,
                  event_time TEXT,
                  title TEXT,
                  event_type TEXT,
                  actual_value REAL,
                  actual_label TEXT,
                  forecast_value REAL,
                  forecast_label TEXT,
                  previous_value REAL,
                  previous_label TEXT,
                  result_updated_at TEXT
                )
                """
            )
            conn.execute(
                "INSERT INTO calendar_events (event_id, event_date, event_time, title, event_type) VALUES (?, ?, ?, ?, ?)",
                ("fomc", "2099-01-01", "02:00", "FOMC 议息会议", "macro"),
            )
            conn.execute(
                "UPDATE calendar_events SET actual_value = 3.75, actual_label = '3.50%-3.75%' WHERE event_id = 'fomc'"
            )
            target = [(date(2026, 1, 1), 3.75)]
            with patch.object(macro_results, "fetch_fred", return_value=target):
                self.assertEqual(macro_results.update_fomc_events(conn, 1), 0)

            row = conn.execute("SELECT actual_value, actual_label, previous_label FROM calendar_events").fetchone()
            self.assertIsNone(row["actual_value"])
            self.assertIsNone(row["actual_label"])
            self.assertEqual(row["previous_label"], "3.75%-3.75%")


if __name__ == "__main__":
    unittest.main()

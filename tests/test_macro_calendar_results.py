import sqlite3
import unittest
from datetime import date
from unittest.mock import patch

import scripts.update_macro_calendar_results as macro_results


class MacroCalendarResultsTest(unittest.TestCase):
    def test_fmp_forecast_updates_matching_macro_event(self) -> None:
        with sqlite3.connect(":memory:") as conn:
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
        with sqlite3.connect(":memory:") as conn:
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


if __name__ == "__main__":
    unittest.main()

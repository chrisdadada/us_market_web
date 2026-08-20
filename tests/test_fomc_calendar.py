from datetime import date
from pathlib import Path
import sys
from unittest import TestCase, mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import build_product_data
import build_product_db


FOMC_HTML = """
<h4>2026 FOMC Meetings</h4>
<div class="fomc-meeting__month"><strong>August</strong></div>
<div class="fomc-meeting__date">22 (notation vote)</div>
<div class="fomc-meeting__month"><strong>September</strong></div>
<div class="fomc-meeting__date">15-16</div>
"""


class FomcCalendarTest(TestCase):
    def test_retries_transient_official_source_failures(self) -> None:
        with mock.patch.object(
            build_product_data,
            "fetch_text",
            side_effect=[OSError("503"), OSError("503"), FOMC_HTML],
        ) as fetch:
            rows = build_product_data.build_fomc_macro_events(date(2026, 8, 1), date(2026, 10, 1))

        self.assertEqual(fetch.call_count, 3)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["date"], "2026-09-17")
        self.assertEqual(rows[0]["time"], "02:00")

    def test_uses_previous_database_rows_when_refresh_fails(self) -> None:
        previous = {
            "events": [
                {"date": "2026-09-17", "time": "02:00", "title": "FOMC 议息会议", "type": "macro"}
            ]
        }
        with mock.patch.object(build_product_data, "build_fomc_macro_events", return_value=[]), mock.patch.object(
            build_product_data, "build_bls_macro_events", return_value=[]
        ):
            rows = build_product_data.build_macro_calendar_events(
                date(2026, 8, 1), date(2026, 10, 1), previous=previous
            )

        self.assertEqual(rows, previous["events"])

    def test_fails_closed_without_fresh_or_previous_fomc(self) -> None:
        with mock.patch.object(build_product_data, "build_fomc_macro_events", return_value=[]), mock.patch.object(
            build_product_data, "build_bls_macro_events", return_value=[]
        ):
            with self.assertRaisesRegex(RuntimeError, "no previous FOMC"):
                build_product_data.build_macro_calendar_events(date(2026, 8, 1), date(2026, 10, 1))

    def test_database_builder_passes_previous_calendar_to_refresh(self) -> None:
        previous = {"events": [{"date": "2026-09-17", "title": "FOMC 议息会议"}]}
        build_product_db.PRODUCT_DATA_PAYLOADS = None
        with mock.patch.object(build_product_db, "load_existing_dataset_payload", return_value=(previous, None)), mock.patch.object(
            build_product_data, "build_events_calendar", return_value=previous
        ) as build_calendar, mock.patch.object(build_product_data, "build_event_opportunities", return_value=[]), mock.patch.object(
            build_product_data, "build_market_temperature", return_value={}
        ), mock.patch.object(build_product_data, "build_validation_center", return_value={}):
            payload, _ = build_product_db.load_product_data_payload("events-calendar")

        self.assertEqual(payload, previous)
        build_calendar.assert_called_once_with(previous)
        build_product_db.PRODUCT_DATA_PAYLOADS = None


if __name__ == "__main__":
    import unittest

    unittest.main()

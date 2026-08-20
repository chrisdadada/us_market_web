import json
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "server" / "bottom_strategy.json"
sys.path.insert(0, str(ROOT / "server"))
import auth_api  # noqa: E402


class BottomStrategySnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.payload = json.loads(DATA_PATH.read_text(encoding="utf-8"))

    def test_markets_have_verified_summary_and_records(self) -> None:
        for symbol in ("QQQ", "SPY"):
            market = self.payload["markets"][symbol]
            summary = market["summary"]
            self.assertEqual(summary["recentCount"], 5)
            self.assertEqual(summary["recentPositiveCount"], 5)
            self.assertEqual(len(market["recentRecords"]), 5)
            self.assertEqual(len(market["records"]), summary["totalSignals"])
            self.assertTrue(all(record["performance"]["180"]["endPct"] > 0 for record in market["recentRecords"]))

    def test_qqq_keeps_full_history_including_early_negative_results(self) -> None:
        records = self.payload["markets"]["QQQ"]["records"]
        completed = [record for record in records if record["status"] == "complete"]
        negative = [record for record in completed if record["performance"]["180"]["endPct"] < 0]
        observing = [record for record in records if record["status"] == "observing"]
        self.assertEqual(len(completed), 7)
        self.assertEqual(len(negative), 2)
        self.assertEqual(len(observing), 1)

    def test_price_history_includes_the_2020_market_cycle(self) -> None:
        for symbol in ("QQQ", "SPY"):
            first_date = self.payload["markets"][symbol]["priceSeries"][0]["date"]
            self.assertLessEqual(first_date, "2020-01-02")

    def test_stage_summary_uses_recent_complete_records(self) -> None:
        qqq = self.payload["markets"]["QQQ"]
        self.assertEqual(qqq["summary"]["end180MedianPct"], 30.64)
        self.assertEqual(qqq["summary"]["stageMaxMedianPct"]["180"], 30.67)
        self.assertEqual(qqq["status"]["key"], "normal")
        self.assertEqual(qqq["asOf"], "2026-08-11")

    def test_free_preview_does_not_include_signal_records(self) -> None:
        preview = auth_api.bottom_strategy_payload(False)
        full = auth_api.bottom_strategy_payload(True)
        self.assertTrue(preview["preview"])
        self.assertEqual(preview["markets"]["QQQ"]["records"], [])
        self.assertEqual(preview["markets"]["QQQ"]["status"], None)
        self.assertEqual(preview["markets"]["QQQ"]["priceSeries"], full["markets"]["QQQ"]["priceSeries"])
        self.assertEqual(preview["markets"]["QQQ"]["opportunityDates"], [record["signalDate"] for record in full["markets"]["QQQ"]["records"]])
        self.assertEqual(preview["markets"]["QQQ"]["summary"], {"totalSignals": 8})

    def test_fixed_low_valuation_cycles_fix_signal_at_first_entry(self) -> None:
        history = [
            {"date": "2020-01-03", "value": 25.0},
            {"date": "2020-01-10", "value": 23.4},
            {"date": "2020-01-17", "value": 21.0},
            {"date": "2020-01-24", "value": 24.0},
            {"date": "2020-04-01", "value": 23.2},
            {"date": "2020-04-08", "value": 22.0},
            {"date": "2020-04-15", "value": 25.0},
            {"date": "2021-01-01", "value": 23.0},
            {"date": "2021-01-08", "value": 22.0},
        ]
        prices = [
            {"date": "2020-01-03", "value": 100.0},
            {"date": "2020-01-10", "value": 99.0},
            {"date": "2020-01-17", "value": 89.0},
            {"date": "2020-01-24", "value": 88.0},
            {"date": "2020-04-01", "value": 87.0},
            {"date": "2020-04-08", "value": 86.0},
            {"date": "2020-04-15", "value": 95.0},
            {"date": "2021-01-01", "value": 84.0},
            {"date": "2021-01-08", "value": 83.0},
        ]
        result = auth_api._fixed_low_valuation_cycles(history, prices)
        self.assertEqual(result["historicalDates"], ["2020-01-17", "2021-01-01"])
        self.assertEqual(result["activeStartDate"], "2021-01-01")
        self.assertEqual(
            result["windows"],
            [
                {"startDate": "2020-01-17", "endDate": "2020-01-17"},
                {"startDate": "2020-04-01", "endDate": "2020-04-08"},
                {"startDate": "2021-01-01", "endDate": "2021-01-08"},
            ],
        )

        extended = auth_api._fixed_low_valuation_cycles(
            history + [
                {"date": "2021-01-15", "value": 18.0},
                {"date": "2021-01-22", "value": 24.0},
            ],
            prices + [
                {"date": "2021-01-15", "value": 80.0},
                {"date": "2021-01-22", "value": 81.0},
            ],
        )
        self.assertEqual(extended["historicalDates"], result["historicalDates"])
        self.assertEqual(extended["activeStartDate"], None)

    def test_fixed_low_valuation_cycles_require_a_real_price_drawdown(self) -> None:
        history = [
            {"date": "2020-01-03", "value": 23.0},
            {"date": "2020-02-07", "value": 22.5},
            {"date": "2020-02-28", "value": 21.0},
            {"date": "2020-03-20", "value": 18.0},
        ]
        prices = [
            {"date": "2020-01-03", "value": 100.0},
            {"date": "2020-02-07", "value": 101.0},
            {"date": "2020-02-28", "value": 89.0},
            {"date": "2020-03-20", "value": 72.0},
        ]
        result = auth_api._fixed_low_valuation_cycles(history, prices)
        self.assertEqual(result["historicalDates"], ["2020-02-28"])
        self.assertEqual(result["activeStartDate"], "2020-02-28")

    def test_bottom_strategy_freshness_fails_closed_after_one_market_session(self) -> None:
        payload = {
            "asOf": "2026-08-19",
            "freshness": {"status": "current", "asOf": "2026-08-19"},
        }
        market = {"asOf": "2026-08-19"}
        thursday_after_close = datetime(2026, 8, 20, 18, 0, tzinfo=ZoneInfo("America/New_York"))

        self.assertTrue(auth_api._bottom_strategy_current(payload, market, thursday_after_close))
        stale = {
            "asOf": "2026-08-18",
            "freshness": {"status": "current", "asOf": "2026-08-18"},
        }
        self.assertFalse(auth_api._bottom_strategy_current(stale, {"asOf": "2026-08-18"}, thursday_after_close))

        friday = {"asOf": "2026-08-21", "freshness": {"status": "current", "asOf": "2026-08-21"}}
        monday_before_close = datetime(2026, 8, 24, 10, 0, tzinfo=ZoneInfo("America/New_York"))
        self.assertTrue(auth_api._bottom_strategy_current(friday, {"asOf": "2026-08-21"}, monday_before_close))

    def test_bottom_strategy_freshness_rejects_stale_or_mismatched_metadata(self) -> None:
        now = datetime(2026, 8, 20, 18, 0, tzinfo=ZoneInfo("America/New_York"))
        market = {"asOf": "2026-08-20"}

        self.assertFalse(auth_api._bottom_strategy_current(
            {"asOf": "2026-08-20", "freshness": {"status": "stale", "asOf": "2026-08-20"}},
            market,
            now,
        ))
        self.assertFalse(auth_api._bottom_strategy_current(
            {"asOf": "2026-08-19", "freshness": {"status": "current", "asOf": "2026-08-19"}},
            market,
            now,
        ))

    def test_dca1_rejects_mixed_or_stale_valuation_snapshots(self) -> None:
        history = [
            {"date": f"{2024 + index // 52}-{index % 12 + 1:02d}-{index % 27 + 1:02d}", "value": 22.0}
            for index in range(104)
        ]
        history.sort(key=lambda item: item["date"])
        latest = history[-1]
        forward = {
            "asOf": latest["date"],
            "historicalAsOf": latest["date"],
            "forwardPe": latest["value"],
            "ranges": {"5y": {}},
        }
        source_date = datetime.fromisoformat(latest["date"]).date()
        fresh_prices = [{"date": (source_date + timedelta(days=7)).isoformat(), "value": 100.0}]

        self.assertTrue(auth_api._dca1_valuation_usable(forward, history, fresh_prices))
        self.assertFalse(auth_api._dca1_valuation_usable({**forward, "asOf": "2026-08-18"}, history, fresh_prices))
        stale_prices = [
            {"date": (source_date + timedelta(days=index)).isoformat(), "value": 100.0}
            for index in range(1, 12)
        ]
        self.assertFalse(auth_api._dca1_valuation_usable(forward, history, stale_prices))

    def test_dca1_accepts_ten_market_sessions_across_two_calendar_weeks(self) -> None:
        history = [
            {"date": f"2025-{month:02d}-05", "value": 22.0 + month / 100}
            for month in range(1, 13)
        ] * 9
        history.append({"date": "2026-08-05", "value": 22.4})
        history.sort(key=lambda item: item["date"])
        forward = {
            "asOf": "2026-08-05",
            "historicalAsOf": "2026-08-05",
            "forwardPe": 22.4,
            "ranges": {"5y": {}},
        }
        prices = [
            {"date": item, "value": 700.0}
            for item in (
                "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-10",
                "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14",
                "2026-08-17", "2026-08-18", "2026-08-19",
            )
        ]

        self.assertTrue(auth_api._dca1_valuation_usable(forward, history, prices))
        self.assertIsNotNone(auth_api._estimate_daily_forward_pe_history(forward, history, prices))

    def test_dca1_estimates_daily_forward_pe_from_the_same_source_anchor(self) -> None:
        forward = {"asOf": "2026-08-05", "forwardPe": 22.4}
        history = [
            {"date": "2026-07-29", "value": 23.0},
            {"date": "2026-08-05", "value": 22.4},
        ]
        prices = [
            {"date": "2026-08-05", "value": 700.0},
            {"date": "2026-08-06", "value": 686.0},
            {"date": "2026-08-07", "value": 714.0},
        ]

        result = auth_api._estimate_daily_forward_pe_history(forward, history, prices)

        self.assertEqual(
            result,
            [
                {"date": "2026-07-29", "value": 23.0},
                {"date": "2026-08-05", "value": 22.4},
                {"date": "2026-08-06", "value": 21.952},
                {"date": "2026-08-07", "value": 22.848},
            ],
        )

    def test_dca1_daily_estimate_fails_closed_without_a_nearby_anchor(self) -> None:
        forward = {"asOf": "2026-08-05", "forwardPe": 22.4}
        history = [{"date": "2026-08-05", "value": 22.4}]

        old_anchor = [{"date": "2026-07-30", "value": 700.0}]
        self.assertIsNone(auth_api._estimate_daily_forward_pe_history(forward, history, old_anchor))

        source_date = datetime.fromisoformat("2026-08-05").date()
        stale_prices = [
            {"date": (source_date + timedelta(days=index)).isoformat(), "value": 700.0}
            for index in range(12)
        ]
        self.assertIsNone(auth_api._estimate_daily_forward_pe_history(forward, history, stale_prices))

    def test_dca1_uses_the_nearest_price_when_the_source_date_is_missing(self) -> None:
        forward = {"asOf": "2026-08-05", "forwardPe": 22.4}
        history = [{"date": "2026-08-05", "value": 22.4}]
        prices = [
            {"date": "2026-07-31", "value": 680.0},
            {"date": "2026-08-06", "value": 700.0},
            {"date": "2026-08-07", "value": 714.0},
        ]

        result = auth_api._estimate_daily_forward_pe_history(forward, history, prices)

        self.assertEqual(
            result,
            [
                {"date": "2026-08-05", "value": 22.4},
                {"date": "2026-08-06", "value": 22.4},
                {"date": "2026-08-07", "value": 22.848},
            ],
        )


if __name__ == "__main__":
    unittest.main()

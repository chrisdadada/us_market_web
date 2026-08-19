import json
import sys
import unittest
from pathlib import Path


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

    def test_fixed_low_valuation_cycles_keep_history_and_current_cycle_separate(self) -> None:
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
        result = auth_api._fixed_low_valuation_cycles(history)
        self.assertEqual(result["historicalDates"], ["2020-01-17"])
        self.assertEqual(result["activeStartDate"], "2021-01-01")
        self.assertEqual(
            result["windows"],
            [
                {"startDate": "2020-01-10", "endDate": "2020-01-17"},
                {"startDate": "2020-04-01", "endDate": "2020-04-08"},
                {"startDate": "2021-01-01", "endDate": "2021-01-08"},
            ],
        )


if __name__ == "__main__":
    unittest.main()

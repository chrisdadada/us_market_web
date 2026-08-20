import argparse
import unittest

from scripts.check_product_coverage import validate


def args() -> argparse.Namespace:
    return argparse.Namespace(
        min_symbols=800,
        min_liquid_symbols=200,
        min_board_rows=800,
        min_macro_events=1,
        min_earnings_events=0,
        min_options_rows=0,
        min_forward_valuation_history=100,
        max_unknown_sector_pct=20.0,
        max_market_cap_missing_pct=5.0,
    )


def report(history_rows: int, has_five_year_range: bool, payloads_match: bool = True, snapshots_match: bool = True) -> dict:
    latest_date = "2026-08-18" if snapshots_match else "2026-08-05"
    latest_value = 22.02 if snapshots_match else 22.37
    return {
        "symbols": {"total": 1000, "liquid": 500},
        "ratios": {"unknownSectorPct": 0.0, "marketCapMissingPct": 0.0},
        "marketBoards": [{"board": "day", "rows": 1000}],
        "calendar": [{"type": "macro", "rows": 1}],
        "options": [],
        "indexValuation": {
            "forwardAsOf": "2026-08-18",
            "forwardHistoricalAsOf": latest_date,
            "forwardPe": 22.02,
            "forwardHistoryLatestDate": latest_date,
            "forwardHistoryLatestValue": latest_value,
            "forwardHistoryRows": history_rows,
            "hasFiveYearRange": has_five_year_range,
            "payloadsMatch": payloads_match,
        },
    }


class ProductCoverageTest(unittest.TestCase):
    def test_accepts_complete_forward_valuation_history(self):
        failures, _ = validate(report(521, True), args())
        self.assertEqual(failures, [])

    def test_rejects_erased_forward_valuation_history(self):
        failures, _ = validate(report(0, False), args())
        self.assertIn("QQQ forward valuation history 0 < 100", failures)
        self.assertIn("QQQ forward valuation 5y range is missing", failures)

    def test_rejects_api_payload_that_differs_from_dataset_payload(self):
        failures, _ = validate(report(521, True, payloads_match=False), args())
        self.assertIn("index-valuation datasets and raw_payloads are out of sync", failures)

    def test_rejects_mixed_current_and_historical_valuation_snapshots(self):
        failures, _ = validate(report(521, True, snapshots_match=False), args())
        self.assertIn("QQQ forward valuation current value and history use different snapshots", failures)


if __name__ == "__main__":
    unittest.main()

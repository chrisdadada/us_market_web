import argparse
import unittest

from scripts.check_product_coverage import validate


def args() -> argparse.Namespace:
    return argparse.Namespace(
        min_symbols=800,
        min_liquid_symbols=200,
        min_board_rows=800,
        min_macro_events=1,
        min_fomc_events=1,
        min_earnings_events=0,
        min_options_rows=0,
        min_forward_valuation_history=100,
        min_bottom_daily_prices=1000,
        bottom_history_start_by="2020-03-13",
        expected_as_of=None,
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
        "fomcEvents": 1,
        "options": [],
        "missingRequiredRawPayloads": [],
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
        "bottomStrategy": {
            "asOf": "2026-08-18",
            "expectedAsOf": "2026-08-18",
            "freshnessStatus": "current",
            "payloadsMatch": True,
            "markets": {
                symbol: {
                    "asOf": "2026-08-18",
                    "recordRows": 5,
                    "dailyPriceRows": 1600,
                    "completeDailyPriceRows": 1600,
                    "firstDailyPriceDate": "2020-01-02",
                    "latestDailyPriceDate": "2026-08-18",
                    "dailyPriceDatesSortedUnique": True,
                }
                for symbol in ("QQQ", "SPY")
            },
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

    def test_rejects_calendar_without_fomc(self):
        current = report(521, True)
        current["fomcEvents"] = 0

        failures, _ = validate(current, args())

        self.assertIn("FOMC calendar events 0 < 1", failures)

    def test_rejects_missing_required_raw_payload(self):
        current = report(521, True)
        current["missingRequiredRawPayloads"] = ["retail-sentiment"]

        failures, _ = validate(current, args())

        self.assertIn("required raw payload is missing: retail-sentiment", failures)

    def test_rejects_bottom_strategy_without_daily_price_history(self):
        current = report(521, True)
        current["bottomStrategy"]["markets"]["QQQ"]["dailyPriceRows"] = 0
        current["bottomStrategy"]["markets"]["QQQ"]["completeDailyPriceRows"] = 0
        current["bottomStrategy"]["markets"]["QQQ"]["firstDailyPriceDate"] = None
        current["bottomStrategy"]["markets"]["QQQ"]["latestDailyPriceDate"] = None

        failures, _ = validate(current, args())

        self.assertIn("QQQ bottom-strategy daily prices 0 < 1000", failures)
        self.assertIn("QQQ bottom-strategy daily prices do not reach 2026-08-18", failures)

    def test_rejects_bottom_strategy_from_the_wrong_snapshot(self):
        current = report(521, True)
        current["bottomStrategy"]["expectedAsOf"] = "2026-08-17"
        current["bottomStrategy"]["payloadsMatch"] = False

        failures, _ = validate(current, args())

        self.assertIn("bottom-strategy asOf and expectedAsOf use different snapshots", failures)
        self.assertIn("bottom-strategy datasets and raw_payloads are out of sync", failures)


if __name__ == "__main__":
    unittest.main()

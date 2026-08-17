import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_index_valuation import build_qqq_forward_valuation, build_qqq_forward_valuation_history, wilder_rsi  # noqa: E402


class ForwardValuationTest(unittest.TestCase):
    def test_builds_plain_language_inputs_from_official_snapshot(self):
        result = build_qqq_forward_valuation(
            {
                "effectiveDate": "2026-07-31",
                "priceToEarningsRatio": 29.997909,
                "forwardPriceToEarningsRatio": 26.707899,
            }
        )

        self.assertEqual(result["status"], "above_ten_year_average")
        self.assertEqual(result["asOf"], "2026-07-31")
        self.assertEqual(result["premiumToTenYearAveragePct"], 17.1)
        self.assertEqual(result["impliedEarningsGrowthPct"], 12.3)

    def test_rejects_missing_or_non_positive_pe(self):
        with self.assertRaises(ValueError):
            build_qqq_forward_valuation({"priceToEarningsRatio": 30, "forwardPriceToEarningsRatio": 0})

    def test_builds_historical_ranges_without_mixing_daily_series(self):
        history = [
            {"date": f"{year}-08-01", "value": value}
            for year, value in zip(range(2016, 2027), range(18, 29), strict=True)
        ]
        result = build_qqq_forward_valuation_history(
            {
                "current": {"forward": 27.5, "trailing": 31.0},
                "forward": history,
                "forwardOwn": [{"date": "2026-08-14", "value": 22.5}],
            }
        )

        self.assertEqual(result["forwardPe"], 22.5)
        self.assertEqual(result["historicalAsOf"], "2026-08-01")
        self.assertEqual(result["history"][-1], {"date": "2026-08-01", "value": 28.0})
        self.assertEqual(set(result["ranges"]), {"3y", "5y", "10y"})
        self.assertEqual(result["ranges"]["5y"]["min"], 24.0)

    def test_short_term_momentum_bounds(self):
        self.assertEqual(wilder_rsi([100.0] * 15), 50.0)
        self.assertEqual(wilder_rsi([float(value) for value in range(15)]), 100.0)
        self.assertEqual(wilder_rsi([float(value) for value in range(15, 0, -1)]), 0.0)


if __name__ == "__main__":
    unittest.main()

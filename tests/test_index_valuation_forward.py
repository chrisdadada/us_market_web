import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_index_valuation import (  # noqa: E402
    _ssga_section,
    build_qqq_forward_valuation,
    official_metric_or_waiting,
    qqq_official_snapshot,
    wilder_rsi,
)


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

    def test_uses_qqq_official_characteristics_for_current_metrics(self):
        result = qqq_official_snapshot(
            {
                "effectiveDate": "2026-07-31",
                "priceToEarningsRatio": 29.997909,
                "priceToBookRatio": 9.340639,
                "returnOnEquity": 34.78700256347656,
            }
        )
        self.assertEqual(result["asOf"], "2026-07-31")
        self.assertAlmostEqual(result["metrics"]["pe"], 29.997909)
        self.assertAlmostEqual(result["metrics"]["pb"], 9.340639)
        self.assertAlmostEqual(result["metrics"]["roe"], 34.78700256347656)

    def test_parses_state_street_characteristics_section(self):
        html = """
        <section><h2 class="comp-title">Index Characteristics <span class="date">as of 06 Aug 2026</span></h2>
        <table><tr><th class="label">Price/Earnings</th><td class="data">25.73</td></tr>
        <tr><th class="label">Price/Earnings Ratio FY1</th><td class="data">21.58</td></tr></table></section>
        """
        as_of, values = _ssga_section(html, "Index Characteristics")
        self.assertEqual(as_of, "2026-08-06")
        self.assertEqual(values["Price/Earnings"], "25.73")
        self.assertEqual(values["Price/Earnings Ratio FY1"], "21.58")

    def test_official_metric_never_inherits_estimated_trend(self):
        metric = official_metric_or_waiting(
            "pe",
            "市盈率",
            "x",
            {"asOf": "2026-08-06", "metrics": {"pe": 25.73}},
        )
        self.assertEqual(metric["value"], 25.73)
        self.assertEqual(metric["asOf"], "2026-08-06")
        self.assertEqual(metric["trend"], [])

    def test_short_term_momentum_bounds(self):
        self.assertEqual(wilder_rsi([100.0] * 15), 50.0)
        self.assertEqual(wilder_rsi([float(value) for value in range(15)]), 100.0)
        self.assertEqual(wilder_rsi([float(value) for value in range(15, 0, -1)]), 0.0)


if __name__ == "__main__":
    unittest.main()

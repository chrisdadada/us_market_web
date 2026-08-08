import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_index_valuation import (  # noqa: E402
    _ssga_section,
    build_qqq_forward_valuation,
    merge_official_metric_history,
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
                "forwardPriceToEarningsRatio": 26.707899,
                "priceToEarningsRatio": 29.997909,
                "priceToBookRatio": 9.340639,
                "returnOnEquity": 34.78700256347656,
            }
        )
        self.assertEqual(result["asOf"], "2026-07-31")
        self.assertAlmostEqual(result["metrics"]["forwardPe"], 26.707899)
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

    def test_accumulates_only_same_source_official_history(self):
        previous = {
            "indices": [{
                "index": {"symbol": "QQQ"},
                "metrics": [{
                    "key": "pe",
                    "value": 30.0,
                    "asOf": "2026-07-31",
                    "coverage": {"sourceName": "Invesco QQQ fund characteristics"},
                    "trend": [{"date": "2026-06-30", "value": 29.0}],
                }],
            }],
        }
        current = {
            "indices": [{
                "index": {"symbol": "QQQ"},
                "metrics": [{
                    "key": "pe",
                    "value": 31.0,
                    "asOf": "2026-08-31",
                    "coverage": {"sourceName": "Invesco QQQ fund characteristics"},
                    "trend": [],
                }],
            }],
        }
        result = merge_official_metric_history(current, previous)
        self.assertEqual(
            result["indices"][0]["metrics"][0]["trend"],
            [
                {"date": "2026-06-30", "value": 29.0},
                {"date": "2026-07-31", "value": 30.0},
                {"date": "2026-08-31", "value": 31.0},
            ],
        )

    def test_rejects_old_estimated_history(self):
        previous = {
            "indices": [{
                "index": {"symbol": "QQQ"},
                "metrics": [{
                    "key": "pe",
                    "value": 37.34,
                    "asOf": "2026-07-24",
                    "coverage": {"method": "polygon_quarterly_annualized_estimate"},
                    "trend": [{"date": "2026-06-01", "value": 35.0}],
                }],
            }],
        }
        current = {
            "indices": [{
                "index": {"symbol": "QQQ"},
                "metrics": [{
                    "key": "pe",
                    "value": 30.0,
                    "asOf": "2026-07-31",
                    "coverage": {"sourceName": "Invesco QQQ fund characteristics"},
                    "trend": [],
                }],
            }],
        }
        result = merge_official_metric_history(current, previous)
        self.assertEqual(result["indices"][0]["metrics"][0]["trend"], [{"date": "2026-07-31", "value": 30.0}])

    def test_preserves_official_history_during_fetch_failure(self):
        previous = {
            "indices": [{
                "index": {"symbol": "SPY"},
                "metrics": [{
                    "key": "pe",
                    "value": 25.73,
                    "asOf": "2026-08-06",
                    "coverage": {"sourceName": "State Street SPY fund and index characteristics"},
                    "trend": [{"date": "2026-08-05", "value": 25.60}],
                }],
            }],
        }
        current = {
            "indices": [{
                "index": {"symbol": "SPY"},
                "metrics": [{"key": "pe", "value": None, "asOf": None, "trend": []}],
            }],
        }
        result = merge_official_metric_history(current, previous)
        metric = result["indices"][0]["metrics"][0]
        self.assertEqual(metric["historySourceName"], "State Street SPY fund and index characteristics")
        self.assertEqual(
            metric["trend"],
            [{"date": "2026-08-05", "value": 25.60}, {"date": "2026-08-06", "value": 25.73}],
        )

    def test_seeds_direct_state_street_fact_sheet_history(self):
        current = {
            "indices": [{
                "index": {"symbol": "SPY"},
                "metrics": [{
                    "key": "forwardPe",
                    "value": 21.58,
                    "asOf": "2026-08-06",
                    "coverage": {"sourceName": "State Street SPY fund and index characteristics"},
                    "trend": [],
                }],
            }],
        }
        result = merge_official_metric_history(current, None)
        metric = result["indices"][0]["metrics"][0]
        self.assertEqual(
            metric["trend"],
            [{"date": "2026-06-30", "value": 22.50}, {"date": "2026-08-06", "value": 21.58}],
        )
        self.assertTrue(metric["historySeedSourceUrl"].endswith("factsheet-us-en-spy.pdf"))


if __name__ == "__main__":
    unittest.main()

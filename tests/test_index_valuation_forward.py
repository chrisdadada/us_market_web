import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_index_valuation import (  # noqa: E402
    _ssga_section,
    build_qqq_forward_valuation,
    merge_official_metric_history,
    market_valuation_level,
    official_metric_or_waiting,
    parse_market_valuation_snapshot,
    qqq_official_snapshot,
    wilder_rsi,
)


class ForwardValuationTest(unittest.TestCase):
    def test_builds_same_source_history_and_plain_level(self):
        detail = {
            "ts": 1786377600000,
            "pe": 31.15,
            "pb": 9.37,
            "roe": 0.3007,
            "yeild": 0.0043,
            "peg": 1.55,
            "pe_percentile": 0.5172,
            "pb_percentile": 0.8224,
        }
        histories = {
            "pe": {"index_eva_pe_growths": [{"ts": 1470844800000, "pe": 25.58}, {"ts": 1786377600000, "pe": 31.15}]},
            "pb": {"index_eva_pb_growths": [{"ts": 1470844800000, "pb": 4.08}, {"ts": 1786377600000, "pb": 9.37}]},
            "roe": {"index_eva_roe_growths": [{"ts": 1470844800000, "roe": 0.1597}, {"ts": 1786377600000, "roe": 0.3007}]},
        }
        result = parse_market_valuation_snapshot("QQQ", detail, histories)
        metrics = {item["key"]: item for item in result["metrics"]}
        self.assertEqual(result["level"], "偏高")
        self.assertEqual(result["pePercentile"], 51.72)
        self.assertEqual(metrics["roe"]["value"], 30.07)
        self.assertEqual(len(metrics["pe"]["trend"]), 2)
        self.assertEqual(metrics["pe"]["trend"][-1]["date"], "2026-08-11")
        self.assertTrue(result["historyPercentiles"]["items"])

    def test_market_valuation_level_uses_pe_and_pb_percentiles(self):
        self.assertEqual(market_valuation_level(20, 20), "偏低")
        self.assertEqual(market_valuation_level(40, 20), "适中")
        self.assertEqual(market_valuation_level(40, 40), "偏高")
        self.assertEqual(market_valuation_level(75, 20), "偏高")

    def test_missing_dividend_yield_stays_missing(self):
        result = parse_market_valuation_snapshot(
            "QQQ",
            {"ts": 1786377600000, "pe": 31, "pb": 9, "roe": 0.3, "peg": 1.5, "pe_percentile": 0.5, "pb_percentile": 0.8},
            {
                "pe": {"index_eva_pe_growths": []},
                "pb": {"index_eva_pb_growths": []},
                "roe": {"index_eva_roe_growths": []},
            },
        )
        self.assertIsNone(result["dividendYield"])

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

    def test_keeps_full_current_market_history(self):
        current = {
            "indices": [{
                "index": {"symbol": "QQQ"},
                "metrics": [{
                    "key": "pe",
                    "value": 31.0,
                    "asOf": "2026-08-11",
                    "coverage": {"sourceName": "雪球基金指数估值"},
                    "trend": [
                        {"date": "2016-08-11", "value": 25.5},
                        {"date": "2021-08-11", "value": 34.0},
                        {"date": "2026-08-11", "value": 31.0},
                    ],
                }],
            }],
        }
        result = merge_official_metric_history(current, None)
        metric = result["indices"][0]["metrics"][0]
        self.assertEqual(len(metric["trend"]), 3)
        self.assertEqual(metric["trend"][0], {"date": "2016-08-11", "value": 25.5})
        self.assertEqual(metric["historySourceName"], "雪球基金指数估值")

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

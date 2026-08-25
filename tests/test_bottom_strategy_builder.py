import copy
import unittest

from scripts.build_bottom_strategy import median_path, rsi, stale_payload, update_machine
from scripts.build_product_db import merge_bottom_strategy_history


class BottomStrategyBuilderTests(unittest.TestCase):
    def test_verified_early_prices_survive_a_shorter_database_baseline(self) -> None:
        fallback = {
            "markets": {
                "QQQ": {
                    "priceSeries": [
                        {"date": "2020-01-02", "value": 210.0},
                        {"date": "2021-01-04", "value": 300.0},
                    ]
                }
            }
        }
        baseline = {
            "markets": {
                "QQQ": {
                    "priceSeries": [
                        {"date": "2021-01-04", "value": 301.0},
                        {"date": "2026-08-18", "value": 746.0},
                    ]
                }
            }
        }

        merged = merge_bottom_strategy_history(baseline, fallback)

        self.assertEqual(
            merged["markets"]["QQQ"]["priceSeries"],
            [
                {"date": "2020-01-02", "value": 210.0},
                {"date": "2021-01-04", "value": 301.0},
                {"date": "2026-08-18", "value": 746.0},
            ],
        )
        self.assertEqual(baseline["markets"]["QQQ"]["priceSeries"][0]["value"], 301.0)

    def test_rsi_uses_wilder_smoothing(self) -> None:
        values = [10, 11, 12, 13, 14, 15, 16, 15, 16]
        result = rsi(values, period=6)
        self.assertEqual(result[6], 100.0)
        self.assertAlmostEqual(result[7], 83.3333333333, places=6)
        self.assertAlmostEqual(result[8], 86.1111111111, places=6)

    def test_warning_only_emits_once_until_rearmed(self) -> None:
        dates = ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"]
        values = {
            dates[0]: (19.0, 19.0),
            dates[1]: (18.0, 18.0),
            dates[2]: (35.0, 30.0),
            dates[3]: (36.0, 31.0),
        }
        state, signals, daily = update_machine(dates, values, "SPY", {})
        self.assertEqual(signals, [dates[0]])
        self.assertTrue(daily[dates[0]]["signal"])
        self.assertFalse(daily[dates[1]]["signal"])
        self.assertFalse(state["armed"])
        self.assertIsNotNone(state["cooldownElapsed"])

    def test_median_path_starts_from_zero_at_entry(self) -> None:
        rows = [
            {"date": "2026-01-02", "close": 101.0},
            *[
                {"date": f"2026-01-{day:02d}", "close": 100.0 + day}
                for day in range(3, 15)
            ],
        ]
        record = {"entryDate": "2026-01-02", "entryPrice": 100.0}
        points = median_path(rows, [record])
        self.assertEqual(points[0], {"day": 0, "pct": 0.0})
        self.assertEqual(points[1], {"day": 10, "pct": 12.0})

    def test_stale_payload_does_not_mutate_baseline(self) -> None:
        baseline = {"generatedAt": "old", "markets": {"QQQ": {"asOf": "2026-08-11"}}}
        original = copy.deepcopy(baseline)
        payload = stale_payload(baseline, None, "network unavailable")
        self.assertEqual(baseline, original)
        self.assertEqual(payload["freshness"]["status"], "stale")
        self.assertEqual(payload["asOf"], "2026-08-11")
        self.assertNotEqual(payload["generatedAt"], "old")


if __name__ == "__main__":
    unittest.main()

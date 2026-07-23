from __future__ import annotations

import json
import math
import sqlite3
import sys
import unittest
from pathlib import Path

try:
    import pandas as pd
    from scripts.build_tracking_pool import KEY_LEVEL_MIN_BARS, build_key_levels
except ModuleNotFoundError:
    pd = None
    KEY_LEVEL_MIN_BARS = 90
    build_key_levels = None

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from server.auth_api import product_market_row_payload


def sample_bars(count: int) -> pd.DataFrame:
    dates = pd.bdate_range("2026-01-02", periods=count)
    close = [100 + math.sin(index * math.pi / 6) * 8 + index * 0.02 for index in range(count)]
    return pd.DataFrame(
        {
            "trade_date": dates.strftime("%Y-%m-%d"),
            "adj_high": [value + 1.2 for value in close],
            "adj_low": [value - 1.2 for value in close],
            "adj_close": close,
            "adj_volume": [1_000_000 + index * 1_000 for index in range(count)],
        }
    )


class TrackingKeyLevelsTest(unittest.TestCase):
    @unittest.skipIf(build_key_levels is None, "pandas is available in the quant environment")
    def test_insufficient_history_does_not_emit_levels(self) -> None:
        levels, history = build_key_levels(sample_bars(30), "2026-07-22")

        self.assertEqual(levels["status"], "insufficient")
        self.assertEqual(levels["requiredBars"], KEY_LEVEL_MIN_BARS)
        self.assertNotIn("support", levels)
        self.assertEqual(len(history), 30)

    @unittest.skipIf(build_key_levels is None, "pandas is available in the quant environment")
    def test_confirmed_pivots_emit_levels_and_ignore_latest_extreme(self) -> None:
        bars = sample_bars(130)
        bars.loc[bars.index[-1], "adj_high"] = 160

        levels, history = build_key_levels(bars, "2026-07-22")

        self.assertEqual(levels["status"], "ready")
        self.assertIsNotNone(levels["support"])
        self.assertIsNotNone(levels["resistance"])
        self.assertLess(levels["resistance"]["center"], 130)
        self.assertGreater(levels["atr14"], 0)
        self.assertEqual(len(history), 60)

    def test_unpaid_market_payload_excludes_tracking_analysis(self) -> None:
        raw_payload = json.dumps(
            {
                "keyLevels": {"status": "ready", "support": {"center": 100}},
                "priceHistory": [{"date": "2026-07-22", "close": 101}],
            }
        )
        with sqlite3.connect(":memory:") as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT
                  'day' AS board, 1 AS rank, 'TEST' AS symbol, '2026-07-22' AS trade_date,
                  'Test Inc' AS company, 'TEST' AS chinese_name, '科技' AS sector,
                  NULL AS risk, NULL AS action_note, 101.0 AS price, 1.0 AS change_pct,
                  NULL AS volume_label, NULL AS dollar_volume, NULL AS volume_ratio,
                  NULL AS market_cap_label, NULL AS market_cap_value, ? AS payload_json
                """,
                (raw_payload,),
            ).fetchone()

        paid = product_market_row_payload(row, True)
        unpaid = product_market_row_payload(row, False)
        self.assertIn("keyLevels", paid)
        self.assertIn("priceHistory", paid)
        self.assertNotIn("keyLevels", unpaid)
        self.assertNotIn("priceHistory", unpaid)


if __name__ == "__main__":
    unittest.main()

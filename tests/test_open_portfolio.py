import sqlite3
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

import open_portfolio  # noqa: E402


class OpenPortfolioCashTest(unittest.TestCase):
    def setUp(self) -> None:
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        open_portfolio.ensure_schema(self.conn)

    def tearDown(self) -> None:
        self.conn.close()

    def add(self, payload: dict) -> dict:
        with self.conn:
            return open_portfolio.add_trade(self.conn, payload, "2026-07-07 00:00:00")

    def test_backdated_buy_uses_cash_at_trade_date_not_current_cash(self) -> None:
        self.add({"tradeTime": "2026-06-01", "symbol": "SNDK", "side": "buy", "price": 1, "amount": 9_997_900})
        self.add({"tradeTime": "2026-06-10", "symbol": "SNDK", "side": "sell", "price": 1, "quantity": 8_875_300})

        current = open_portfolio.payload(self.conn)
        self.assertEqual(current["availableCash"], 8_877_400)

        with self.assertRaisesRegex(ValueError, "MRVL 买入金额超过可用资金"):
            with self.conn:
                open_portfolio.add_trade(
                    self.conn,
                    {"tradeTime": "2026-06-01", "symbol": "MRVL", "side": "buy", "price": 205, "amount": 1_055_000},
                    "2026-07-07 00:00:00",
                )

        after = open_portfolio.payload(self.conn)
        self.assertEqual(after["availableCash"], 8_877_400)
        self.assertEqual(len(after["trades"]), 2)


if __name__ == "__main__":
    unittest.main()

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

    def test_trade_history_amounts_realized_pnl_and_equity_are_stable(self) -> None:
        self.add({"tradeTime": "2026-01-01", "symbol": "ABC", "side": "buy", "price": 10, "amount": 1_000})
        self.add({"tradeTime": "2026-01-02", "symbol": "ABC", "side": "sell", "price": 15, "quantity": 40})
        self.add({"tradeTime": "2026-01-03", "symbol": "ABC", "side": "buy", "price": 12, "amount": 120})

        result = open_portfolio.payload(self.conn)
        self.assertEqual(result["availableCash"], 9_999_480)
        self.assertEqual(result["realizedPnl"], 200)
        self.assertEqual(result["equity"], 10_000_200)
        self.assertEqual(result["holdings"], [{
            "symbol": "ABC",
            "quantity": 70.0,
            "quantityStep": 1.0,
            "avgCost": 10.29,
            "cost": 720.0,
            "positionPct": 0.01,
            "sector": "其他",
        }])

        newest, sell, oldest = result["trades"]
        self.assertEqual((newest["tradeTime"], newest["side"], newest["amount"], newest["quantity"], newest["realizedPnl"], newest["equityAfter"]), ("2026-01-03", "buy", 120, 10, 0, 10_000_200))
        self.assertEqual((sell["tradeTime"], sell["side"], sell["amount"], sell["quantity"], sell["realizedPnl"], sell["equityAfter"]), ("2026-01-02", "sell", 600, 40, 200, 10_000_200))
        self.assertEqual((oldest["tradeTime"], oldest["side"], oldest["amount"], oldest["quantity"], oldest["realizedPnl"], oldest["equityAfter"]), ("2026-01-01", "buy", 1_000, 100, 0, 10_000_000))


if __name__ == "__main__":
    unittest.main()

import unittest
from datetime import UTC, datetime, timedelta

from scripts.build_crypto_etf_flows import build_payload, parse_page_props


class CryptoEtfFlowsTests(unittest.TestCase):
    def test_parse_and_aggregate_trading_days_without_filling_missing_values(self) -> None:
        flows = {}
        first_day = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=24)
        for index in range(25):
            timestamp = int((first_day + timedelta(days=index)).timestamp())
            row = {"date": timestamp, "Bitcoin": (index + 1) * 1_000_000}
            if index >= 2:
                row["Ethereum"] = -(index + 1) * 500_000
            flows[str(timestamp)] = row
        html = (
            '<script id="__NEXT_DATA__" type="application/json">'
            + __import__("json").dumps({"props": {"pageProps": {"flows": flows, "lastUpdated": "test"}}})
            + "</script>"
        )

        payload = build_payload(parse_page_props(html))

        self.assertEqual(payload["assets"]["BTC"]["flow5dUsd"], 115_000_000)
        self.assertEqual(payload["assets"]["BTC"]["flow21dUsd"], 315_000_000)
        self.assertEqual(payload["assets"]["ETH"]["flow5dUsd"], -57_500_000)
        self.assertIsNone(payload["history"][0]["ethFlowUsd"])
        self.assertEqual(payload["history"][0]["totalFlowUsd"], 1_000_000)


if __name__ == "__main__":
    unittest.main()

import unittest
import sys
import tempfile
import types
from datetime import UTC, datetime, timedelta
from pathlib import Path

import scripts.build_product_db as build_product_db
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

    def test_product_db_live_import_does_not_write_json_cache(self) -> None:
        fake = types.SimpleNamespace(
            fetch_payload=lambda: {
                "asOf": datetime.now(UTC).date().isoformat(),
                "assets": {"BTC": {}, "ETH": {}},
            }
        )
        original = sys.modules.get("build_crypto_etf_flows")
        original_data_dir = build_product_db.DATA_DIR
        sys.modules["build_crypto_etf_flows"] = fake
        try:
            with tempfile.TemporaryDirectory() as tempdir:
                build_product_db.DATA_DIR = Path(tempdir)
                payload, source = build_product_db.load_crypto_etf_flows_payload()
                self.assertEqual(source, Path("direct:crypto-etf-flows"))
                self.assertIn("assets", payload)
                self.assertFalse((Path(tempdir) / "crypto-etf-flows.json").exists())
        finally:
            build_product_db.DATA_DIR = original_data_dir
            if original is None:
                sys.modules.pop("build_crypto_etf_flows", None)
            else:
                sys.modules["build_crypto_etf_flows"] = original


if __name__ == "__main__":
    unittest.main()

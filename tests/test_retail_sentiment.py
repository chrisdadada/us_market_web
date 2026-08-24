import unittest
import json
import os
import sqlite3
import sys
import tempfile
import types
from datetime import date
from pathlib import Path

import scripts.build_product_db as build_product_db
from scripts.build_retail_sentiment import (
    build_payload,
    parse_aaii_history,
    parse_cboe_ratio,
    parse_finra_history,
)


class RetailSentimentTests(unittest.TestCase):
    def test_official_source_parsers_and_calculations(self) -> None:
        cboe = '<script>\\"name\\":\\"EQUITY PUT/CALL RATIO\\",\\"value\\":\\"0.51\\"</script>'
        aaii = """
        <table><tr><th>Reported Date</th><th>Bullish</th><th>Neutral</th><th>Bearish</th></tr>
        <tr><td>Aug 19</td><td>35.5%</td><td>24.6%</td><td>39.9%</td></tr>
        <tr><td>Aug 12</td><td>34.7%</td><td>27.4%</td><td>37.9%</td></tr>
        <tr><td>Aug 5</td><td>37.0%</td><td>25.0%</td><td>38.0%</td></tr>
        <tr><td>Jul 29</td><td>31.0%</td><td>26.9%</td><td>42.1%</td></tr></table>
        """
        finra = """
        <table><tr><th>Month/Year</th><th>Debit Balances</th></tr>
        <tr><td>Jul-26</td><td>1,417,225</td></tr>
        <tr><td>Jun-26</td><td>1,502,072</td></tr></table>
        """
        options = [
            {"date": "2026-08-20", "putCallRatio": 0.58, "callSharePct": 63.3},
            {"date": "2026-08-21", "putCallRatio": parse_cboe_ratio(cboe), "callSharePct": 66.2},
        ]
        payload = build_payload(
            options,
            parse_aaii_history(aaii, date(2026, 8, 24)),
            parse_finra_history(finra),
            date(2026, 8, 24),
        )

        self.assertEqual(payload["options"]["changePp"], 2.9)
        self.assertEqual(payload["survey"]["date"], "2026-08-19")
        self.assertEqual(payload["survey"]["spreadPp"], -4.4)
        self.assertEqual(payload["margin"]["changePct"], -5.6)

    def test_product_build_reuses_the_last_valid_payload_when_a_source_is_blocked(self) -> None:
        saved = {"asOf": "2026-08-21", "options": {"date": "2026-08-21"}, "survey": {"date": "2026-08-19"}, "margin": {"date": "2026-07"}}
        original = sys.modules.get("build_retail_sentiment")
        original_product_db = os.environ.get("PRODUCT_DB")
        with tempfile.TemporaryDirectory() as tempdir:
            db_path = Path(tempdir) / "product.db"
            with sqlite3.connect(db_path) as conn:
                conn.execute("CREATE TABLE datasets (name TEXT PRIMARY KEY, payload_json TEXT NOT NULL)")
                conn.execute("INSERT INTO datasets VALUES (?, ?)", ("retail-sentiment", json.dumps(saved)))
            os.environ["PRODUCT_DB"] = str(db_path)
            sys.modules["build_retail_sentiment"] = types.SimpleNamespace(fetch_payload=lambda: (_ for _ in ()).throw(RuntimeError("blocked")))
            try:
                payload, source = build_product_db.load_retail_sentiment_payload()
                self.assertEqual(payload, saved)
                self.assertIn("retail-sentiment", str(source))
            finally:
                if original is None:
                    sys.modules.pop("build_retail_sentiment", None)
                else:
                    sys.modules["build_retail_sentiment"] = original
                if original_product_db is None:
                    os.environ.pop("PRODUCT_DB", None)
                else:
                    os.environ["PRODUCT_DB"] = original_product_db


if __name__ == "__main__":
    unittest.main()

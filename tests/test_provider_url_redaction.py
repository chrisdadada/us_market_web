from __future__ import annotations

import sys
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "market-data-lab" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from common import public_url


class ProviderUrlRedactionTest(unittest.TestCase):
    def test_removes_api_key_and_preserves_other_query_values(self) -> None:
        url = "https://api.polygon.io/v3/reference/tickers?cursor=next&apiKey=secret&limit=1000"

        redacted = public_url(url)

        self.assertNotIn("secret", redacted)
        self.assertNotIn("apikey", redacted.lower())
        self.assertIn("cursor=next", redacted)
        self.assertIn("limit=1000", redacted)


if __name__ == "__main__":
    unittest.main()

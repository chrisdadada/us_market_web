from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from macro_freshness import partition_fresh_indicators


class MacroFreshnessTest(unittest.TestCase):
    def test_stale_or_missing_indicators_are_hidden(self) -> None:
        visible, hidden = partition_fresh_indicators(
            [
                {"key": "vixcls", "asOf": "2026-08-14"},
                {"key": "dxy", "asOf": "2026-08-07"},
                {"key": "dcoilwtico", "asOf": "2026-08-11"},
                {"key": "dcoilbrenteu"},
                {"key": "cpiaucsl", "asOf": "2026-07-01"},
            ],
            "2026-08-14",
        )

        self.assertEqual([item["key"] for item in visible], ["vixcls", "cpiaucsl"])
        self.assertEqual(
            [item["key"] for item in hidden],
            ["dxy", "dcoilwtico", "dcoilbrenteu"],
        )


if __name__ == "__main__":
    unittest.main()

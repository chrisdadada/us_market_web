import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.preserve_product_runtime_tables import fingerprint, merge, verify


class PreserveProductRuntimeTablesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        self.existing = root / "existing.db"
        self.incoming = root / "incoming.db"
        with sqlite3.connect(self.existing) as conn:
            conn.executescript(
                """
                CREATE TABLE market_opinion_items (item_id TEXT PRIMARY KEY, body TEXT NOT NULL);
                INSERT INTO market_opinion_items VALUES ('old-item', 'keep this');
                CREATE TABLE open_portfolio_trades (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  symbol TEXT NOT NULL,
                  note TEXT
                );
                CREATE INDEX idx_open_portfolio_trades_symbol ON open_portfolio_trades(symbol);
                INSERT INTO open_portfolio_trades(symbol, note) VALUES ('SPY', 'keep this too');
                INSERT INTO open_portfolio_trades(symbol, note) VALUES ('QQQ', 'deleted row');
                DELETE FROM open_portfolio_trades WHERE symbol = 'QQQ';
                CREATE TABLE open_portfolio_symbol_rules (
                  symbol TEXT PRIMARY KEY,
                  quantity_step TEXT NOT NULL
                );
                INSERT INTO open_portfolio_symbol_rules VALUES ('BTC', '0.00001');
                """
            )
        with sqlite3.connect(self.incoming) as conn:
            conn.executescript(
                """
                CREATE TABLE market_opinion_items (item_id TEXT PRIMARY KEY, body TEXT NOT NULL);
                INSERT INTO market_opinion_items VALUES ('generated-item', 'replace this');
                CREATE TABLE datasets (name TEXT PRIMARY KEY, as_of TEXT NOT NULL);
                INSERT INTO datasets VALUES ('market-movers', '2026-07-21');
                """
            )

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_merge_preserves_runtime_tables_exactly(self) -> None:
        merge(self.incoming, self.existing)
        verify(self.existing, self.incoming)
        with sqlite3.connect(self.incoming) as conn:
            self.assertEqual(
                conn.execute("SELECT item_id, body FROM market_opinion_items").fetchall(),
                [("old-item", "keep this")],
            )
            self.assertEqual(conn.execute("SELECT seq FROM sqlite_sequence WHERE name = 'open_portfolio_trades'").fetchone()[0], 2)
            self.assertEqual(conn.execute("SELECT as_of FROM datasets WHERE name = 'market-movers'").fetchone()[0], "2026-07-21")

    def test_verify_rejects_protected_content_change(self) -> None:
        merge(self.incoming, self.existing)
        with sqlite3.connect(self.incoming) as conn:
            conn.execute("UPDATE open_portfolio_trades SET note = 'changed'")
        with self.assertRaisesRegex(RuntimeError, "content fingerprint changed"):
            verify(self.existing, self.incoming)

    def test_fingerprint_changes_with_any_database_content(self) -> None:
        before = fingerprint(self.existing)
        with sqlite3.connect(self.existing) as conn:
            conn.execute("UPDATE market_opinion_items SET body = 'changed'")
        self.assertNotEqual(fingerprint(self.existing), before)

    def test_fingerprint_cli(self) -> None:
        result = subprocess.run(
            [sys.executable, "scripts/preserve_product_runtime_tables.py", "fingerprint", "--db", str(self.existing)],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.stdout.strip(), fingerprint(self.existing))


if __name__ == "__main__":
    unittest.main()

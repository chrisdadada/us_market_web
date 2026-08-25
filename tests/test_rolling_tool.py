from __future__ import annotations

import json
import sqlite3
import subprocess
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from server import rolling_tool


ROOT = Path(__file__).resolve().parents[1]
RULES = {"symbol": "BTCUSDT", "qtyStep": Decimal("0.001"), "tickSize": Decimal("0.1")}


def base_payload(**updates):
    payload = {
        "symbol": "BTCUSDT",
        "side": "long",
        "triggerDirection": "rise",
        "initialNotional": "1000",
        "leverage": "3",
        "entryMode": "immediate",
        "entryDirection": "rise",
        "intervalType": "percent",
        "intervalValue": "2",
        "addPercent": "50",
        "maxAdds": "4",
        "protectionDistance": "6",
    }
    payload.update(updates)
    return payload


class RollingToolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "app.db"
        with self.connect() as conn:
            conn.execute("CREATE TABLE users(id INTEGER PRIMARY KEY)")
            conn.executemany("INSERT INTO users(id) VALUES (?)", [(1,), (2,)])
            rolling_tool.init_schema(conn)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def connect(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def read_plan(self, plan_id: str):
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM rolling_plans WHERE id = ?", (plan_id,)).fetchone()
        return row, json.loads(row["state_json"])

    def test_fixed_add_gap_and_next_trigger_match_browser_core(self) -> None:
        with self.connect() as conn:
            plan_id = rolling_tool.create_plan(conn, 1, base_payload(), Decimal("100"), RULES)
            rolling_tool.process_symbol(conn, "BTCUSDT", Decimal("110"))
        row, state = self.read_plan(plan_id)
        self.assertEqual(row["status"], "running")
        self.assertEqual(state["addsCompleted"], 1)
        self.assertEqual(Decimal(state["fixedAddNotional"]), Decimal("500"))
        self.assertEqual(Decimal(state["totalNotional"]), Decimal("1500"))
        self.assertEqual(Decimal(state["nextTriggerPrice"]), Decimal("112.2"))

        script = """
          import { simulatePath } from './main-web/src/vendor/rolling-pro/rolling-simulator.mjs';
          const plan = {schemaVersion:1,symbol:'BTCUSDT',side:'long',triggerDirection:'rise',initialNotional:1000,leverage:3,entry:{mode:'immediate'},addInterval:{type:'percent',value:2},addPercent:50,maxAdds:4,protectionDistance:6};
          const state = simulatePath(plan, 100, [110]).at(-1);
          console.log(JSON.stringify({addsCompleted:state.addsCompleted,totalNotional:state.totalNotional,nextTriggerPrice:state.nextTriggerPrice,averagePrice:state.averagePrice}));
        """
        expected = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", script], cwd=ROOT, text=True))
        self.assertEqual(state["addsCompleted"], expected["addsCompleted"])
        self.assertAlmostEqual(float(state["totalNotional"]), expected["totalNotional"], places=8)
        self.assertAlmostEqual(float(state["nextTriggerPrice"]), expected["nextTriggerPrice"], places=8)
        self.assertAlmostEqual(float(state["averagePrice"]), expected["averagePrice"], places=8)

    def test_max_adds_enters_holding_protection(self) -> None:
        with self.connect() as conn:
            plan_id = rolling_tool.create_plan(conn, 1, base_payload(maxAdds="1"), Decimal("100"), RULES)
            rolling_tool.process_symbol(conn, "BTCUSDT", Decimal("102"))
            rolling_tool.process_symbol(conn, "BTCUSDT", Decimal("120"))
        row, state = self.read_plan(plan_id)
        self.assertEqual(row["status"], "holding_protection")
        self.assertEqual(state["addsCompleted"], 1)
        self.assertIsNone(state["nextTriggerPrice"])

        runtime = rolling_tool.RollingRuntime(self.path, poll_seconds=60)
        runtime.action(1, plan_id, "end")
        with self.connect() as conn:
            rolling_tool.process_symbol(conn, "BTCUSDT", Decimal("121"))
        row, state = self.read_plan(plan_id)
        self.assertEqual(row["status"], "ended")
        self.assertEqual(Decimal(state["exitPrice"]), Decimal("121"))
        runtime.latest["BTCUSDT"] = (Decimal("999"), float("inf"))
        history = runtime.snapshot(1)["plans"][0]
        self.assertEqual(Decimal(history["currentPrice"]), Decimal("121"))
        self.assertEqual(Decimal(history["estimatedPnl"]), Decimal(state["estimatedPnl"]))
        self.assertFalse(history["marketConnected"])

    def test_protection_is_checked_before_add(self) -> None:
        with self.connect() as conn:
            plan_id = rolling_tool.create_plan(
                conn,
                1,
                base_payload(triggerDirection="fall", intervalValue="2"),
                Decimal("100"),
                RULES,
            )
            rolling_tool.process_symbol(conn, "BTCUSDT", Decimal("93"))
        row, state = self.read_plan(plan_id)
        self.assertEqual(row["status"], "ended")
        self.assertEqual(state["addsCompleted"], 0)
        self.assertEqual(Decimal(state["exitPrice"]), Decimal("93"))

    def test_protection_only_tightens_after_adds(self) -> None:
        with self.connect() as conn:
            plan_id = rolling_tool.create_plan(conn, 1, base_payload(), Decimal("100"), RULES)
            first_protection = Decimal(json.loads(conn.execute("SELECT state_json FROM rolling_plans WHERE id = ?", (plan_id,)).fetchone()[0])["protectionPrice"])
            rolling_tool.process_symbol(conn, "BTCUSDT", Decimal("102"))
            second_protection = Decimal(json.loads(conn.execute("SELECT state_json FROM rolling_plans WHERE id = ?", (plan_id,)).fetchone()[0])["protectionPrice"])
            rolling_tool.process_symbol(conn, "BTCUSDT", Decimal("104.04"))
        _, state = self.read_plan(plan_id)
        self.assertGreaterEqual(second_protection, first_protection)
        self.assertGreaterEqual(Decimal(state["protectionPrice"]), second_protection)

    def test_pause_stops_adds_but_keeps_protection(self) -> None:
        with self.connect() as conn:
            plan_id = rolling_tool.create_plan(conn, 1, base_payload(), Decimal("100"), RULES)
        runtime = rolling_tool.RollingRuntime(self.path, poll_seconds=60)
        runtime.action(1, plan_id, "pause")
        with self.connect() as conn:
            rolling_tool.process_symbol(conn, "BTCUSDT", Decimal("110"))
        row, state = self.read_plan(plan_id)
        self.assertEqual(row["status"], "paused")
        self.assertEqual(state["addsCompleted"], 0)
        with self.connect() as conn:
            rolling_tool.process_symbol(conn, "BTCUSDT", Decimal("93"))
        row, _ = self.read_plan(plan_id)
        self.assertEqual(row["status"], "ended")

    def test_conditional_entry_must_be_beyond_current_price(self) -> None:
        payload = base_payload(entryMode="conditional", entryDirection="rise", entryTriggerPrice="99")
        with self.connect() as conn, self.assertRaisesRegex(rolling_tool.RollingError, "正确方向"):
            rolling_tool.create_plan(conn, 1, payload, Decimal("100"), RULES)

    def test_waiting_entry_can_end_cleanly(self) -> None:
        payload = base_payload(entryMode="conditional", entryDirection="rise", entryTriggerPrice="110")
        with self.connect() as conn:
            plan_id = rolling_tool.create_plan(conn, 1, payload, Decimal("100"), RULES)
        runtime = rolling_tool.RollingRuntime(self.path, poll_seconds=60)
        runtime.action(1, plan_id, "end")
        with self.connect() as conn:
            rolling_tool.process_symbol(conn, "BTCUSDT", Decimal("101"))
        row, state = self.read_plan(plan_id)
        self.assertEqual(row["status"], "ended")
        self.assertEqual(Decimal(state["estimatedPnl"]), Decimal("0"))

    def test_plan_ids_are_random_and_users_are_isolated(self) -> None:
        with self.connect() as conn:
            first = rolling_tool.create_plan(conn, 1, base_payload(), Decimal("100"), RULES)
            second = rolling_tool.create_plan(conn, 2, base_payload(), Decimal("100"), RULES)
        self.assertRegex(first, r"^[a-f0-9]{32}$")
        self.assertNotEqual(first, second)
        runtime = rolling_tool.RollingRuntime(self.path, poll_seconds=60)
        self.assertEqual([item["id"] for item in runtime.snapshot(1)["plans"]], [first])
        self.assertEqual([item["id"] for item in runtime.snapshot(2)["plans"]], [second])
        with self.assertRaisesRegex(rolling_tool.RollingError, "不存在"):
            runtime.action(2, first, "pause")


if __name__ == "__main__":
    unittest.main()

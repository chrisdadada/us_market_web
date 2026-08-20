import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  applyMarketPrice,
  normalizePlan,
  projectNextAdd,
  startSimulation,
} from "../main-web/src/vendor/rolling-pro/rolling-simulator.mjs";

const basePlan = {
  schemaVersion: 1,
  symbol: "BTCUSDT",
  side: "long",
  triggerDirection: "rise",
  initialNotional: 1000,
  leverage: 3,
  entry: { mode: "immediate" },
  addInterval: { type: "percent", value: 2 },
  addPercent: 50,
  maxAdds: 4,
  protectionDistance: 6,
};

const normalized = normalizePlan({
  ...basePlan,
  api_key: "must-not-export",
  exchange_credentials: { value: "must-not-export" },
  entryFillPrice: 100,
  marketPrices: [101, 102],
});
assert.deepEqual(Object.keys(normalized).sort(), [
  "addInterval", "addPercent", "entry", "initialNotional", "leverage", "maxAdds",
  "protectionDistance", "schemaVersion", "side", "symbol", "triggerDirection",
].sort());
assert.equal(JSON.stringify(normalized).includes("must-not-export"), false);

const initial = startSimulation(basePlan, 100);
assert.equal(initial.nextTriggerPrice, 102);
assert.equal(initial.fixedAddNotional, 500);
assert.equal(initial.estimatedInitialMargin, 1000 / 3);

const gapMove = applyMarketPrice(initial, 110);
assert.equal(gapMove.addsCompleted, 1, "one price update can fill at most one add");
assert.equal(gapMove.totalNotional, 1500);
assert.equal(gapMove.nextTriggerPrice, 112.2);
assert.equal(projectNextAdd(gapMove)?.totalNotional, 2000);

const protectionPlan = { ...basePlan, triggerDirection: "fall", maxAdds: 2 };
const protectedState = applyMarketPrice(startSimulation(protectionPlan, 100), 93);
assert.equal(protectedState.status, "ended", "protection must be checked before an add");
assert.equal(protectedState.addsCompleted, 0);
assert.equal(protectedState.exitPrice, 93);
const blockedProjection = projectNextAdd(startSimulation({
  ...protectionPlan,
  addInterval: { type: "percent", value: 10 },
}, 100));
assert.equal(blockedProjection?.blockedByProtection, true, "the UI must be able to warn when protection precedes an add");

const contractPath = fileURLToPath(new URL("../main-web/src/vendor/rolling-pro/website-contract.v1.json", import.meta.url));
const contract = JSON.parse(await readFile(contractPath, "utf8"));
assert.equal(contract.simulation.runs_in_browser, true);
assert.equal(contract.simulation.uses_real_orders, false);
assert.equal(contract.exchange_connection.live_orders_enabled, false);
assert.deepEqual(contract.private_fields, ["api_key", "api_secret", "exchange_credentials", "raw_order_payloads"]);

console.log("rolling simulator tests passed");

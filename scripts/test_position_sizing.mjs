import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "../main-web/node_modules/esbuild/lib/main.js";

const outdir = path.join(tmpdir(), "dongbimao-position-sizing-check");
const outfile = path.join(outdir, "positionSizing.mjs");
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [path.resolve("main-web/src/positionSizing.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "silent"
});

const { calculatePositionSizing } = await import(pathToFileURL(outfile).href);

const long = calculatePositionSizing({
  direction: "long",
  accountSize: 100000,
  riskAmount: 1000,
  entryPrice: 50,
  stopPrice: 48,
  latestPrice: 51
});
assert.equal(long.shares, 500);
assert.equal(long.actualRisk, 1000);
assert.equal(long.oneRPrice, 52);
assert.equal(long.latestPnl, 500);

const short = calculatePositionSizing({
  direction: "short",
  accountSize: 100000,
  riskAmount: 1000,
  entryPrice: 50,
  stopPrice: 52,
  latestPrice: 49
});
assert.equal(short.shares, 500);
assert.equal(short.twoRPrice, 46);
assert.equal(short.latestPnl, 500);

const floored = calculatePositionSizing({
  direction: "long",
  accountSize: 50000,
  riskAmount: 1000,
  entryPrice: 100,
  stopPrice: 97
});
assert.equal(floored.shares, 333);
assert.equal(floored.actualRisk, 999);

assert.throws(() => calculatePositionSizing({
  direction: "long",
  accountSize: 100000,
  riskAmount: 1000,
  entryPrice: 50,
  stopPrice: 51
}), /止损价必须低于买入价/);

assert.throws(() => calculatePositionSizing({
  direction: "short",
  accountSize: 100000,
  riskAmount: 1000,
  entryPrice: 50,
  stopPrice: 49
}), /止损价必须高于卖出价/);

console.log("position sizing checks passed");

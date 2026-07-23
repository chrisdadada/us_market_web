import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";

const buildDir = mkdtempSync(join(tmpdir(), "position-sizing-"));
after(() => rmSync(buildDir, { recursive: true, force: true }));

execFileSync("main-web/node_modules/.bin/tsc", [
  "main-web/src/positionSizing.ts",
  "--target", "ES2022",
  "--module", "ES2022",
  "--moduleResolution", "Bundler",
  "--skipLibCheck",
  "--outDir", buildDir
]);

const { calculatePositionSizing } = await import(pathToFileURL(join(buildDir, "positionSizing.js")));

test("sizes a long trade from the loss budget", () => {
  const result = calculatePositionSizing({
    direction: "long",
    accountSize: 100_000,
    riskAmount: 1_000,
    entryPrice: 180,
    stopPrice: 175
  });

  assert.equal(result.shares, 200);
  assert.equal(result.positionAmount, 36_000);
  assert.equal(result.actualRisk, 1_000);
  assert.equal(result.positionPct, 36);
  assert.equal(result.cashLimited, false);
});

test("supports short trades and rounds down to whole shares", () => {
  const result = calculatePositionSizing({
    direction: "short",
    accountSize: 10_000,
    riskAmount: 100,
    entryPrice: 10,
    stopPrice: 13
  });

  assert.equal(result.shares, 33);
  assert.equal(result.actualRisk, 99);
  assert.equal(result.oneRPrice, 7);
  assert.equal(result.twoRPrice, 4);
});

test("caps the result at the cash account limit", () => {
  const result = calculatePositionSizing({
    direction: "long",
    accountSize: 10_000,
    riskAmount: 100,
    entryPrice: 100,
    stopPrice: 99.5
  });

  assert.equal(result.riskBasedShares, 200);
  assert.equal(result.shares, 100);
  assert.equal(result.actualRisk, 50);
  assert.equal(result.riskPct, 0.5);
  assert.equal(result.cashLimited, true);
});

test("rejects invalid stops and unaffordable trades", () => {
  assert.throws(() => calculatePositionSizing({
    direction: "long",
    accountSize: 10_000,
    riskAmount: 100,
    entryPrice: 100,
    stopPrice: 101
  }), /止损价必须低于买入价/);

  assert.throws(() => calculatePositionSizing({
    direction: "long",
    accountSize: 50,
    riskAmount: 10,
    entryPrice: 100,
    stopPrice: 90
  }), /账户资金不足以交易 1 股/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../main-web/src/App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../main-web/src/styles.css", import.meta.url), "utf8");

assert.match(app, /valuationRangePercentile\(peMetric, years\)/);
assert.match(app, /valuationRangePercentile\(pbMetric, years\)/);
assert.match(app, /PE位于\$\{rangeLabel\}/);
assert.match(app, /新增资金更适合分批/);
assert.match(app, /"全部历史"/);
assert.match(app, /valuationReferenceCards/);
assert.match(app, /fillArea/);
assert.doesNotMatch(app, /PE 百分位<\/span><b>\{summary\?\.pePercentile/);
assert.match(css, /\.valuationChartLayout\s*\{[^}]*grid-template-columns:/s);
assert.match(css, /\.valuationChartStage \.marketChartArea\s*\{[^}]*fill:/s);

console.log("index valuation UI contract: ok");

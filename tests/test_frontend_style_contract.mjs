import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../main-web/src/styles.css", import.meta.url), "utf8");

assert.match(css, /\.marketToolPanel,\s*\.temperatureSnapshot,\s*\.strengthMetrics\s*\{[^}]*border-radius:\s*var\(--front-card-radius\)[^}]*box-shadow:\s*var\(--front-card-shadow\)/s);
assert.match(css, /\.marketToolTable table\s*\{[^}]*table-layout:\s*fixed/s);
assert.match(css, /\.marketToolTable td\s*\{[^}]*font-size:\s*var\(--front-table-body-size\)[^}]*font-weight:\s*var\(--front-table-body-weight\)/s);
assert.match(css, /\.marketToolTable td strong\s*\{[^}]*font-size:\s*var\(--front-table-body-size\)[^}]*font-weight:\s*var\(--front-table-body-weight\)/s);
assert.match(css, /\.marketToolTable td\s*\{\s*height:\s*46px;/s);
assert.match(css, /\.trackingPage \.screenerTable td,[^{]*\{[^}]*height:\s*46px;/s);
assert.match(css, /\.stockLibraryTable th,\s*\.stockLibraryTable td\s*\{[^}]*height:\s*46px;/s);
assert.match(css, /\.sideRail nav button\s*\{[^}]*min-height:\s*var\(--front-nav-row-height\)[^}]*font-size:\s*var\(--front-nav-size\)[^}]*font-weight:\s*var\(--front-nav-weight\)/s);
assert.match(css, /\.sideRail nav button:focus-visible,[^{]*\{[^}]*outline:\s*0[^}]*box-shadow:\s*inset/s);

console.log("frontend style contract: ok");

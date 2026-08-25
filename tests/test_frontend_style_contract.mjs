import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "../main-web/node_modules/postcss/lib/postcss.mjs";

const css = readFileSync(new URL("../main-web/src/styles.css", import.meta.url), "utf8");
const calendarCss = readFileSync(new URL("../main-web/src/calendar.css", import.meta.url), "utf8");
const stocksCss = readFileSync(new URL("../main-web/src/stocks.css", import.meta.url), "utf8");
const marketFundsCss = readFileSync(new URL("../main-web/src/marketFunds.css", import.meta.url), "utf8");
const trackingCss = readFileSync(new URL("../main-web/src/tracking.css", import.meta.url), "utf8");
const opinionsCss = readFileSync(new URL("../main-web/src/opinions.css", import.meta.url), "utf8");
const rollingCss = readFileSync(new URL("../main-web/src/rollingTool.css", import.meta.url), "utf8");

function duplicateSelectors(source, from) {
  const seen = new Map();
  postcss.parse(source, { from }).walkRules((rule) => {
    const parent = rule.parent?.type === "atrule" ? `@${rule.parent.name} ${rule.parent.params}|` : "";
    const key = `${parent}${rule.selector.replace(/\s+/g, " ").trim()}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  });
  return [...seen].filter(([, count]) => count > 1).map(([selector]) => selector);
}

assert.match(css, /\.marketToolPanel,\s*\.temperatureSnapshot,\s*\.strengthMetrics\s*\{[^}]*border-radius:\s*var\(--front-card-radius\)[^}]*box-shadow:\s*var\(--front-card-shadow\)/s);
assert.match(css, /\.marketToolTable table\s*\{[^}]*table-layout:\s*fixed/s);
assert.match(css, /\.marketToolTable td\s*\{[^}]*font-size:\s*var\(--front-table-body-size\)[^}]*font-weight:\s*var\(--front-table-body-weight\)/s);
assert.match(css, /\.marketToolTable td strong\s*\{[^}]*font-size:\s*var\(--front-table-body-size\)[^}]*font-weight:\s*var\(--front-table-body-weight\)/s);
assert.match(css, /\.marketToolTable td\s*\{\s*height:\s*46px;/s);
assert.match(trackingCss, /\.trackingPage \.screenerTable td\s*\{[^}]*height:\s*46px;/s);
assert.match(stocksCss, /\.stockLibraryTable th,\s*\.stockLibraryTable td\s*\{[^}]*height:\s*46px;/s);
assert.match(css, /\.sideRail nav button\s*\{[^}]*min-height:\s*var\(--front-nav-row-height\)[^}]*font-size:\s*var\(--front-nav-size\)[^}]*font-weight:\s*var\(--front-nav-weight\)/s);
assert.match(css, /\.sideRail nav button:focus-visible,[^{]*\{[^}]*outline:\s*0[^}]*box-shadow:\s*inset/s);
assert.match(calendarCss, /\.topbar\.calendarTopbar\s*\{[^}]*height:\s*64px\s*!important[^}]*padding:\s*12px 28px\s*!important/s);
assert.match(calendarCss, /\.topbar\.calendarTopbar \.accountMenu,\s*\.topbar\.calendarTopbar > \.accountButton\s*\{[^}]*position:\s*relative[^}]*top:\s*auto[^}]*right:\s*auto/s);
assert.match(rollingCss, /\.rollingToolPage\s*\{[^}]*align-content:\s*start/s);
assert.match(rollingCss, /\.rollingInlineQuote\s*\{[^}]*white-space:\s*nowrap/s);
assert.match(marketFundsCss, /\.cryptoEtfView \.marketSegment\s*\{[^}]*display:\s*inline-flex[^}]*height:\s*34px/s);
assert.match(marketFundsCss, /\.cryptoEtfView \.marketSegment button\.active\s*\{[^}]*background:\s*#fff[^}]*color:\s*#1677e8/s);
assert.doesNotMatch(css, /\.(?:calendar[A-Za-z0-9_-]*|stocksPage|stockLibrary[A-Za-z0-9_-]*|market[A-Za-z0-9_-]*V3|marketViewTabs|cryptoEtf[A-Za-z0-9_-]*|tracking[A-Za-z0-9_-]*|opinion[A-Za-z0-9_-]*)/);
assert.deepEqual(duplicateSelectors(calendarCss, "calendar.css"), []);
assert.deepEqual(duplicateSelectors(stocksCss, "stocks.css"), []);
assert.deepEqual(duplicateSelectors(marketFundsCss, "marketFunds.css"), []);
assert.deepEqual(duplicateSelectors(trackingCss, "tracking.css"), []);
assert.deepEqual(duplicateSelectors(opinionsCss, "opinions.css"), []);

console.log("frontend style contract: ok");

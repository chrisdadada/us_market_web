import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../main-web/src/App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../main-web/src/styles.css", import.meta.url), "utf8");
const opinionsCss = readFileSync(new URL("../main-web/src/opinions.css", import.meta.url), "utf8");
const main = readFileSync(new URL("../main-web/src/main.tsx", import.meta.url), "utf8");
const productConfig = readFileSync(new URL("../main-web/src/productConfig.ts", import.meta.url), "utf8");
const opinionsPage = app.slice(app.indexOf("function OpinionsPage"), app.indexOf("function TrackingPage"));

const repeatedPageTitles = ["opinions", "tracking", "risk", "valuation", "strength", "market", "stocks"];
for (const page of repeatedPageTitles) {
  assert.doesNotMatch(app, new RegExp(`<h1>\\{pageLabels\\.${page}\\}</h1>`), `${page} must not repeat its navigation label as a page heading`);
}

assert.match(productConfig, /opinions:\s*"猫言猫语"/);
assert.match(app, /crypto:\s*"加密相关"/);
assert.match(app, /daily:\s*"个股观点"/);
assert.match(app, /postmarket:\s*"盘后复盘"/);
assert.match(css, /--front-table-head-size:\s*11\.5px;/);
assert.match(css, /--front-table-body-size:\s*12px;/);
assert.match(css, /--front-table-sub-size:\s*11px;/);
assert.match(css, /--front-nav-size:\s*13px;/);
assert.match(css, /--front-nav-weight:\s*520;/);
assert.match(css, /td strong\s*\{[^}]*font-size:\s*inherit;[^}]*font-weight:\s*var\(--front-table-value-weight\)/s);
assert.match(css, /\.stockLibraryTable td > strong\s*\{[^}]*font-size:\s*var\(--front-table-body-size\)[^}]*font-weight:\s*var\(--front-table-value-weight\)/s);
assert.doesNotMatch(css, /\.(?:opinionProductHeading|trackingHeading|marketToolHeading|marketPageHeadV3|stockLibraryHead)\b/);
assert.doesNotMatch(css, /\.(?:opinionProductPage|opinionReaderPage)\b/, "opinion page styles must have one owner");
assert.match(main, /import "\.\/opinions\.css";/);
assert.match(opinionsCss, /\.opinionProductPage\s*\{/);
assert.match(opinionsCss, /\.opinionReaderPage\s*\{/);
assert.match(opinionsPage, /该栏目暂时没有内容/);
assert.match(opinionsPage, />返回列表</);
assert.doesNotMatch(opinionsPage, /返回首页|opinionMemberLabel|formatOpinionClock|featured/);

console.log("frontend typography contract: ok");

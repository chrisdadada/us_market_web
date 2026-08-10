import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../main-web/src/App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../main-web/src/styles.css", import.meta.url), "utf8");

const pageHeadings = [
  "opinionProductHeading",
  "trackingHeading",
  "marketToolHeading",
  "marketPageHeadV3",
  "stockLibraryHead"
];

for (const className of pageHeadings) {
  assert.match(app, new RegExp(`className="[^"]*frontPageHeading[^"]*${className}|className="[^"]*${className}[^"]*frontPageHeading`));
}

assert.match(css, /--front-type-page-title:\s*20px;/);
assert.match(css, /\.frontPageHeading h1\s*\{[^}]*var\(--front-type-page-title\)/s);

for (const className of pageHeadings) {
  const selector = new RegExp(`\\.${className} h1\\s*\\{([^}]*)\\}`, "g");
  for (const match of css.matchAll(selector)) {
    assert.doesNotMatch(match[1], /font-(?:size|weight)\s*:/, `${className} must use the shared page-title role`);
  }
}

console.log("frontend typography contract: ok");

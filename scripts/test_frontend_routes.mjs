import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultMaxDocumentHeight = 9000;
const workspaceMaxDocumentHeight = 2400;

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

const routeCases = [
  { hash: "", view: "dashboard", text: "市场快照", maxHeight: workspaceMaxDocumentHeight },
  { hash: "#market", view: "market", text: "行情异动", maxHeight: workspaceMaxDocumentHeight },
  { hash: "#flows", view: "flows", text: "资金流向", maxHeight: workspaceMaxDocumentHeight },
  { hash: "#events", view: "events", text: "财经日志" },
  { hash: "#stocks", view: "stocks", text: "股票库" },
  { hash: "#strength", view: "strength", text: "今日强弱观察池" },
];

const marketSectionCases = [
  { section: "movers", view: "market", text: "行情异动", maxHeight: workspaceMaxDocumentHeight },
  { section: "sectors", view: "market", text: "板块排行", maxHeight: workspaceMaxDocumentHeight },
  { section: "heatmap", view: "market", text: "热力图", maxHeight: workspaceMaxDocumentHeight },
  { section: "flows", view: "flows", text: "资金流向", maxHeight: workspaceMaxDocumentHeight },
];

const flowsToMarketSectionCases = [
  { section: "movers", view: "market", text: "行情异动", maxHeight: workspaceMaxDocumentHeight },
  { section: "sectors", view: "market", text: "板块排行", maxHeight: workspaceMaxDocumentHeight },
  { section: "heatmap", view: "market", text: "热力图", maxHeight: workspaceMaxDocumentHeight },
];

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const filePath = normalize(join(root, requestedPath));

      if (!filePath.startsWith(root)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": mimeTypes.get(extname(filePath)) || "application/octet-stream",
      });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolveServer({
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
        url: `http://127.0.0.1:${address.port}/`,
      });
    });
  });
}

async function launchBrowser() {
  const launchOptions = {
    headless: true,
    viewport: { width: 1440, height: 1100 },
  };

  try {
    return await chromium.launch({ ...launchOptions, channel: "chrome" });
  } catch {
    return chromium.launch(launchOptions);
  }
}

async function collectRouteState(page) {
  return page.evaluate(() => {
    const visibleViews = [...document.querySelectorAll(".page-view")]
      .filter((view) => {
        const style = getComputedStyle(view);
        return !view.hidden && style.display !== "none" && style.visibility !== "hidden";
      })
      .map((view) => view.dataset.view);
    const activeView = document.querySelector(".page-view.is-active")?.dataset.view || "";
    const activeMarketSection = document.querySelector(".page-view.is-active [data-market-section].is-active")?.dataset.marketSection || "";
    const marketView = document.querySelector('[data-view="market"]');
    const flowsView = document.querySelector('[data-view="flows"]');

    return {
      activeView,
      visibleViews,
      title: document.title,
      bodyText: document.body.innerText,
      activeViewText: document.querySelector(".page-view.is-active")?.innerText || "",
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      activeMarketSection,
      marketHidden: marketView?.hidden || false,
      flowsHidden: flowsView?.hidden || false,
    };
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertRoute(page, expected) {
  const state = await collectRouteState(page);
  assert(state.activeView === expected.view, `${expected.hash || "/"} active view is ${state.activeView}, expected ${expected.view}`);
  assert(state.visibleViews.length === 1, `${expected.hash || "/"} has visible views ${state.visibleViews.join(", ")}`);
  assert(state.visibleViews[0] === expected.view, `${expected.hash || "/"} visible view is ${state.visibleViews[0]}, expected ${expected.view}`);
  assert(state.activeViewText.includes(expected.text), `${expected.hash || "/"} active view missing text ${expected.text}`);
  const maxHeight = expected.maxHeight || defaultMaxDocumentHeight;
  assert(state.documentHeight <= maxHeight, `${expected.hash || "/"} document height ${state.documentHeight} exceeds ${maxHeight}`);
  return state;
}

async function run() {
  const server = await startStaticServer();
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    for (const route of routeCases) {
      await page.goto(`${server.url}${route.hash}`, { waitUntil: "networkidle" });
      await page.waitForSelector(`.page-view.is-active[data-view="${route.view}"]`);
      await assertRoute(page, route);
    }

    await page.goto(`${server.url}#market`, { waitUntil: "networkidle" });
    await page.waitForSelector('.page-view.is-active[data-view="market"]');
    for (const sectionCase of marketSectionCases) {
      await page.locator(`.page-view.is-active [data-market-section="${sectionCase.section}"]`).first().click();
      await page.waitForSelector(`.page-view.is-active[data-view="${sectionCase.view}"]`);
      await page.waitForSelector(`.page-view.is-active [data-market-section="${sectionCase.section}"].is-active`);
      const state = await assertRoute(page, {
        hash: `market:${sectionCase.section}`,
        view: sectionCase.view,
        text: sectionCase.text,
        maxHeight: sectionCase.maxHeight,
      });

      assert(
        state.activeMarketSection === sectionCase.section,
        `market:${sectionCase.section} active tab is ${state.activeMarketSection}, expected ${sectionCase.section}`,
      );
    }

    await page.goto(`${server.url}#flows`, { waitUntil: "networkidle" });
    await page.waitForSelector('.page-view.is-active[data-view="flows"]');
    for (const sectionCase of flowsToMarketSectionCases) {
      await page.locator(`.page-view.is-active [data-market-section="${sectionCase.section}"]`).first().click();
      await page.waitForSelector(`.page-view.is-active[data-view="${sectionCase.view}"]`);
      await page.waitForSelector(`.page-view.is-active [data-market-section="${sectionCase.section}"].is-active`);
      const state = await assertRoute(page, {
        hash: `flows:${sectionCase.section}`,
        view: sectionCase.view,
        text: sectionCase.text,
        maxHeight: sectionCase.maxHeight,
      });
      assert(
        state.activeMarketSection === sectionCase.section,
        `flows:${sectionCase.section} active tab is ${state.activeMarketSection}, expected ${sectionCase.section}`,
      );
    }
  } finally {
    await browser.close();
    await server.close();
  }

  console.log(`Frontend route regression passed (${routeCases.length + marketSectionCases.length + flowsToMarketSectionCases.length} checks).`);
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

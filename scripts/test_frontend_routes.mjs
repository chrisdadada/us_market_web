import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { readProductDataset } from "./product_db_test_data.mjs";
import { strengthPageFixture } from "./strength_page_fixture.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultMaxDocumentHeight = 9000;
const workspaceMaxDocumentHeight = 2400;

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

const routeCases = [
  { hash: "", view: "dashboard", text: "最新", maxHeight: workspaceMaxDocumentHeight },
  { hash: "#market-opinion", view: "market-opinion", text: "美股热点风向标" },
  { hash: "#market-opinion/weekly", view: "market-opinion", text: "6月行情可能" },
  { hash: "#market-opinion/daily", view: "market-opinion", text: "MRVL" },
  { hash: "#market-opinion/research", view: "market-opinion", text: "Intel 扩产预期链" },
  { hash: "#market-opinion/premarket", view: "market-opinion", text: "盘前前瞻" },
  { hash: "#market-opinion/postmarket", view: "market-opinion", text: "盘后复盘延展" },
  { hash: "#market-opinion/journal", view: "market-opinion", text: "FOMC 后指数普跌" },
  { hash: "#market", view: "market", text: "板块资金方向", maxHeight: workspaceMaxDocumentHeight },
  { hash: "#flows", view: "market", text: "板块资金方向", maxHeight: workspaceMaxDocumentHeight },
  { hash: "#market/flows", view: "market", text: "板块资金方向", maxHeight: workspaceMaxDocumentHeight },
  { hash: "#events", view: "events", text: "重点财经前瞻", absentText: "股票事件" },
  { hash: "#stocks", view: "stocks", text: "美股行情" },
  { hash: "#tracking", view: "tracking", text: "本次新增" },
  { hash: "#stock-events", view: "dashboard", text: "最新" },
  { hash: "#stock-events/guidance_up", view: "dashboard", text: "最新" },
  { hash: "#events/guidance_up", view: "dashboard", text: "最新" },
  { hash: "#risk", view: "risk", text: "登录后可看市场活跃指数", maxHeight: workspaceMaxDocumentHeight },
  { hash: "#valuation", view: "valuation", text: "短期涨跌动能" },
  { hash: "#strength", view: "strength", text: "会员可看行业板块强弱", maxHeight: workspaceMaxDocumentHeight },
  { hash: "#watchlist", view: "dashboard", text: "最新", absentText: "观察池" },
];

const marketSectionCases = [
  { section: "movers", view: "market", text: "行情异动", maxHeight: workspaceMaxDocumentHeight },
  { section: "sectors", view: "market", text: "板块排行", maxHeight: workspaceMaxDocumentHeight },
  { section: "heatmap", view: "market", text: "成交额热力图", maxHeight: workspaceMaxDocumentHeight },
  { section: "flows", view: "market", text: "板块资金方向", maxHeight: workspaceMaxDocumentHeight },
];

const flowsToMarketSectionCases = [
  { section: "movers", view: "market", text: "行情异动", maxHeight: workspaceMaxDocumentHeight },
  { section: "sectors", view: "market", text: "板块排行", maxHeight: workspaceMaxDocumentHeight },
  { section: "heatmap", view: "market", text: "成交额热力图", maxHeight: workspaceMaxDocumentHeight },
  { section: "flows", view: "market", text: "板块资金方向", maxHeight: workspaceMaxDocumentHeight },
];

const datasetCache = new Map();

async function readDataset(name) {
  if (!datasetCache.has(name)) datasetCache.set(name, readProductDataset(name));
  return datasetCache.get(name);
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function normalizeProductSymbol(row) {
  const symbol = String(row.symbol || row.ticker || "").toUpperCase();
  return {
    symbol,
    company: row.company || row.companyName || row.name || row.chineseName || "",
    chineseName: row.chineseName || "",
    sector: row.sector || row.sectorProxy || "",
    marketCap: row.marketCap || "",
    marketCapValue: row.marketCapValue || null,
    price: row.price || row.close || null,
    dollarVolume: row.dollarVolume || row.dollarVolume20d || null,
    volumeRatio: row.volumeRatio || "",
    latestSource: row.latestSource || "test",
    sources: row.sources || ["test"],
    updatedAt: row.updatedAt || "",
  };
}

function marketRow(row, board) {
  const changeValue = board === "ytd" ? row.changeYtd : row.change;
  return {
    ...row,
    board,
    changePct: changeValue,
    ...(board === "ytd" ? { changeYtd: changeValue } : { change: changeValue }),
  };
}

async function productApiPayload(url) {
  const ytd = await readDataset("ytd-gainers");
  const movers = await readDataset("market-movers");
  const sectorFlow = await readDataset("sector-flow");
  const calendar = await readDataset("events-calendar");
  const strength = await readDataset("strength-scanner");
  const eventOpportunities = await readDataset("event-opportunities");
  const earningsQuality = await readDataset("earnings-quality");
  const core = await readDataset("core-signals");
  const strengthReview = await readDataset("strength-review");
  const marketTemperature = await readDataset("market-temperature");
  const marketOpinion = await readDataset("market-opinion-content");
  const allMarketRows = [
    ...(ytd.rows || []).map((row) => marketRow(row, "ytd")),
    ...Object.entries(movers.boards || {}).flatMap(([board, payload]) => (payload.rows || []).map((row) => marketRow(row, board))),
  ];
  const symbolMap = new Map();
  allMarketRows.forEach((row) => {
    const symbol = String(row.symbol || "").toUpperCase();
    if (symbol && !symbolMap.has(symbol)) symbolMap.set(symbol, normalizeProductSymbol(row));
  });
  (strength.rows || []).forEach((row) => {
    const symbol = String(row.symbol || "").toUpperCase();
    if (symbol && !symbolMap.has(symbol)) symbolMap.set(symbol, normalizeProductSymbol(row));
  });

  if (url.pathname === "/api/product/bootstrap") {
    return {
      meta: { schemaVersion: "test", generatedAt: ytd.updatedAt || movers.updatedAt || "", counts: {}, datasets: [] },
      ytd: { ...ytd, rows: (ytd.rows || []).map((row) => marketRow(row, "ytd")) },
      movers: {
        ...movers,
        boards: Object.fromEntries(
          Object.entries(movers.boards || {}).map(([board, payload]) => [board, { ...payload, rows: (payload.rows || []).map((row) => marketRow(row, board)) }]),
        ),
      },
      core,
      strength,
      strengthReview,
      sectorFlow,
      marketTemperature,
    };
  }

  if (url.pathname.startsWith("/api/product/raw/")) {
    const name = url.pathname.split("/").pop();
    return readDataset(name);
  }

  if (url.pathname === "/api/product/strength") return strengthPageFixture(strength, url);

  if (url.pathname === "/api/product/symbols") {
    const query = String(url.searchParams.get("query") || url.searchParams.get("q") || "").toUpperCase();
    const limit = Number(url.searchParams.get("limit") || 50);
    const rows = [...symbolMap.values()]
      .filter((row) => !query || row.symbol.includes(query) || String(row.company || "").toUpperCase().includes(query))
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .slice(0, limit);
    return { rows };
  }

  if (url.pathname.startsWith("/api/product/symbols/")) {
    const symbol = url.pathname.split("/").pop().toUpperCase();
    const profile = symbolMap.get(symbol) || normalizeProductSymbol({ symbol });
    return {
      profile,
      marketRows: allMarketRows.filter((row) => String(row.symbol || "").toUpperCase() === symbol),
      peers: [...symbolMap.values()].filter((row) => row.sector === profile.sector && row.symbol !== symbol).slice(0, 8),
      events: Object.values(eventOpportunities.boards || {}).flatMap((board) => board.rows || []).filter((row) => String(row.ticker || row.symbol || "").toUpperCase() === symbol),
      earnings: Object.values(earningsQuality.boards || {}).flatMap((board) => board.rows || []).filter((row) => String(row.ticker || row.symbol || "").toUpperCase() === symbol),
      strength: (strength.rows || []).find((row) => String(row.symbol || "").toUpperCase() === symbol) || null,
    };
  }

  if (url.pathname === "/api/product/sectors") return { rows: sectorFlow.rows || [] };
  if (url.pathname === "/api/product/calendar") return { rows: calendar.events || [] };
  if (url.pathname === "/api/product/opinions") return { rows: marketOpinion.items || [] };
  if (url.pathname === "/api/product/market") {
    const board = url.searchParams.get("board") || "ytd";
    const rows = allMarketRows.filter((row) => row.board === board).slice(0, Number(url.searchParams.get("limit") || 100));
    return { board, rows };
  }
  return { ok: true };
}

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname === "/api/product" || url.pathname.startsWith("/api/product/")) {
        sendJson(response, await productApiPayload(url));
        return;
      }
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
  await page.waitForFunction(
    ({ view, text }) => {
      const active = document.querySelector(`.page-view.is-active[data-view="${view}"]`);
      return Boolean(active && active.innerText.includes(text));
    },
    { view: expected.view, text: expected.text },
    { timeout: 1500 },
  ).catch(() => {});
  const state = await collectRouteState(page);
  assert(state.activeView === expected.view, `${expected.hash || "/"} active view is ${state.activeView}, expected ${expected.view}`);
  assert(state.visibleViews.length === 1, `${expected.hash || "/"} has visible views ${state.visibleViews.join(", ")}`);
  assert(state.visibleViews[0] === expected.view, `${expected.hash || "/"} visible view is ${state.visibleViews[0]}, expected ${expected.view}`);
  assert(state.activeViewText.includes(expected.text), `${expected.hash || "/"} active view missing text ${expected.text}`);
  if (expected.absentText) {
    assert(!state.activeViewText.includes(expected.absentText), `${expected.hash || "/"} active view still contains ${expected.absentText}`);
  }
  const maxHeight = expected.maxHeight || defaultMaxDocumentHeight;
  assert(state.documentHeight <= maxHeight, `${expected.hash || "/"} document height ${state.documentHeight} exceeds ${maxHeight}`);
  return state;
}

async function assertExpandedStockSearch(page, serverUrl) {
  await page.goto(`${serverUrl}#stocks`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('.page-view.is-active[data-view="stocks"]');
  await page.waitForFunction(() => document.querySelectorAll("#stocksTableBody tr").length >= 200);
  const stockRows = await page.locator("#stocksTableBody tr").count();
  assert(stockRows >= 200, `stocks library rendered ${stockRows} rows, expected at least 200`);

  await page.locator("#globalSearchInput").fill("MU");
  await page.waitForSelector('[data-global-search-result][data-result-type="stock"][data-symbol="MU"]');
  await page.locator("#globalSearchInput").press("Enter");
  await page.waitForSelector('.page-view.is-active[data-view="stock"]');
  const state = await collectRouteState(page);
  assert(state.activeView === "stock", `global search opened ${state.activeView}, expected stock`);
  assert(state.activeViewText.includes("MU"), "global search stock page is missing MU");
}

async function run() {
  const server = await startStaticServer();
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    for (const route of routeCases) {
      await page.goto(`${server.url}${route.hash}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(`.page-view.is-active[data-view="${route.view}"]`);
      await assertRoute(page, route);
    }

    await page.goto(`${server.url}#market`, { waitUntil: "domcontentloaded" });
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

    await page.goto(`${server.url}#flows`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('.page-view.is-active[data-view="market"]');
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

    await assertExpandedStockSearch(page, server.url);
  } finally {
    await browser.close();
    await server.close();
  }

  console.log(`Frontend route regression passed (${routeCases.length + marketSectionCases.length + flowsToMarketSectionCases.length + 2} checks).`);
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

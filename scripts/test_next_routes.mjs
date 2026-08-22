import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { readProductDataset } from "./product_db_test_data.mjs";
import { strengthPageFixture } from "./strength_page_fixture.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distRoot = join(root, "main-web", "dist");
const dcaOnly = process.env.DCA_ONLY === "1";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".svg", "image/svg+xml"],
]);

async function readDataset(name) {
  return readProductDataset(name);
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function moneyValue(label) {
  const text = String(label || "").replace(/[$,]/g, "");
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return null;
  if (/T$/i.test(text)) return value * 1e12;
  if (/B$/i.test(text)) return value * 1e9;
  if (/M$/i.test(text)) return value * 1e6;
  return value;
}

async function apiPayload(url) {
  if (url.pathname === "/api/auth/status") {
    return { authenticated: false, user: null, entitlements: { paid: false, pro: false, proPlus: false, admin: false } };
  }
  if (url.pathname === "/api/open-portfolio") return { curve: [], holdings: [], trades: [] };
  if (url.pathname === "/api/watchlist") return { rows: [] };
  if (url.pathname === "/api/courses") return { series: [] };
  if (url.pathname === "/api/tools/funding-arbitrage") return { rows: [], updated_at: "", stale: false };
  if (url.pathname === "/api/tools/bottom-strategy") {
    return JSON.parse(await readFile(join(root, "server", "bottom_strategy.json"), "utf8"));
  }
  if (url.pathname === "/api/tools/dca-strategies") {
    const bottom = JSON.parse(await readFile(join(root, "server", "bottom_strategy.json"), "utf8"));
    const qqq = bottom.markets.QQQ;
    const locations = qqq.priceSeries.map((point, index, rows) => ({
      date: point.date,
      position: Math.round((index / Math.max(1, rows.length - 1)) * 70 + 15),
    }));
    return {
      preview: false,
      products: {
        dca1: { asOf: qqq.asOf, status: { key: "waiting", position: 0, headline: "暂未触发", action: "暂不执行" }, opportunityDates: qqq.records.slice(0, 5).map((item) => item.signalDate), opportunityWindows: qqq.records.slice(0, 5).map((item) => ({ startDate: item.signalDate, endDate: item.signalDate })), currentCycleStart: null, locationSeries: locations, lowBoundaryPosition: 30, priceSeries: qqq.priceSeries },
        dca2: { asOf: qqq.asOf, status: { key: "waiting", position: 0, headline: "暂未触发", action: "暂不执行" }, opportunityDates: qqq.records.map((item) => item.signalDate), opportunityWindows: qqq.records.map((item) => ({ startDate: item.signalDate, endDate: item.signalDate })), currentCycleStart: qqq.records.at(-1)?.signalDate || null, locationSeries: [], lowBoundaryPosition: null, priceSeries: qqq.priceSeries },
      },
    };
  }

  const ytd = await readDataset("ytd-gainers");
  const movers = await readDataset("market-movers");
  const sectorFlow = await readDataset("sector-flow");
  const strength = await readDataset("strength-scanner");
  const calendar = await readDataset("events-calendar");
  const opinions = await readDataset("market-opinion-content");

  const opinionItems = (opinions.items || []).filter((item) => item.status === "published");
  const allMarketRows = [
    ...(ytd.rows || []).map((row) => ({ ...row, board: "ytd", changeYtd: row.changeYtd ?? row.change })),
    ...Object.entries(movers.boards || {}).flatMap(([board, payload]) =>
      (payload.rows || []).map((row) => ({ ...row, board, changePct: row.change ?? row.changeYtd })),
    ),
  ];

  if (url.pathname === "/api/product/bootstrap") {
    return {
      meta: { schemaVersion: "test", generatedAt: ytd.updatedAt || movers.updatedAt || "", counts: {} },
      ytd: { ...ytd, rows: (ytd.rows || []).slice(0, 20) },
      movers: {
        ...movers,
        boards: Object.fromEntries(
          Object.entries(movers.boards || {}).map(([board, payload]) => [board, { ...payload, rows: (payload.rows || []).slice(0, 20) }]),
        ),
      },
      strength,
      sectorFlow,
    };
  }

  if (url.pathname === "/api/product/opinions") {
    const limit = Number(url.searchParams.get("limit") || 8);
    const offset = Number(url.searchParams.get("offset") || 0);
    const section = String(url.searchParams.get("section") || "");
    const rows = section ? opinionItems.filter((item) => item.section === section) : opinionItems;
    return { rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset, section };
  }

  if (url.pathname === "/api/product/calendar") {
    const limit = Number(url.searchParams.get("limit") || 50);
    const offset = Number(url.searchParams.get("offset") || 0);
    const rows = calendar.events || [];
    return { rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
  }

  if (url.pathname === "/api/product/strength") return strengthPageFixture(strength, url);

  if (url.pathname === "/api/product/symbols/meta") {
    return { total: 3, sectors: [{ sector: "科技", count: 3 }] };
  }

  if (url.pathname === "/api/product/symbols") {
    const rows = (strength.rows || []).slice(0, 3).map((row) => ({
      symbol: row.symbol,
      company: row.name || row.company || row.symbol,
      sector: row.sector || "科技",
      marketCap: row.marketCap || "--",
      marketCapValue: moneyValue(row.marketCap),
      price: row.price || null,
      dollarVolume: moneyValue(row.liquidity),
      dayChange: Number.parseFloat(String(row.periods?.["1d"] || "0")),
      weekChange: Number.parseFloat(String(row.periods?.["5d"] || "0")),
      monthChange: Number.parseFloat(String(row.periods?.["20d"] || "0")),
      ytdChange: 0,
      strengthLabel: row.label || null,
    }));
    return { rows, total: rows.length, limit: rows.length, offset: 0, sort: "dollarVolume" };
  }

  if (url.pathname.startsWith("/api/product/symbols/")) {
    const symbol = decodeURIComponent(url.pathname.split("/").pop() || "MU").toUpperCase();
    const profile = { symbol, company: symbol, sector: "科技", marketCap: "$1.0B", price: 100, dollarVolume: 10000000, volumeRatio: 1.2 };
    return { profile, marketRows: [], peers: [], events: [], earnings: [], strength: null };
  }

  if (url.pathname === "/api/product/market") {
    return { rows: allMarketRows.slice(0, 20) };
  }

  return { ok: true };
}

function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) {
        sendJson(response, await apiPayload(url));
        return;
      }

      let relativePath = url.pathname.startsWith("/next/") ? url.pathname.slice("/next/".length) : url.pathname.slice(1);
      if (!relativePath) relativePath = "index.html";
      let filePath = join(distRoot, relativePath);
      try {
        await readFile(filePath);
      } catch (error) {
        if (!relativePath.startsWith("assets/")) throw error;
        filePath = join(root, relativePath);
        await readFile(filePath);
      }
      response.writeHead(200, { "Content-Type": mimeTypes.get(extname(filePath)) || "application/octet-stream" });
      createReadStream(filePath).pipe(response);
    } catch {
      try {
        const indexPath = join(distRoot, "index.html");
        await readFile(indexPath);
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        createReadStream(indexPath).pipe(response);
      } catch {
        response.writeHead(404);
        response.end("Not found");
      }
    }
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolveServer({
        rootUrl: `http://127.0.0.1:${address.port}/`,
        nextUrl: `http://127.0.0.1:${address.port}/next/`,
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const routeCases = [
  { query: "", text: "首页" },
  { query: "?page=opinions", text: "猫言猫语" },
  { query: "?page=tracking", text: "机会跟踪榜单" },
  { query: "?page=market", text: "市场资金走向" },
  { query: "?page=risk", text: "注册后查看" },
  { query: "?page=strength", text: "开通查看完整内容" },
  { query: "?page=valuation", text: "注册后查看" },
  { query: "?page=stocks&symbol=MU", text: "美股行情" },
  { query: "?page=calendar", text: "重点财经前瞻" },
  { query: "?page=open", text: "Open 持仓参考" },
  { query: "?page=watchlist", text: "注册后查看" },
  { query: "?page=dca1", text: "登录后查看定投产品" },
  { query: "?page=dca2", text: "登录后查看定投产品" },
  { query: "?page=bottom", text: "登录后查看定投产品" },
  { query: "?page=courses", text: "实战课程" },
  { query: "?page=funding", text: "资金费套利扫描" },
  { query: "?page=forum", text: "论坛讨论区" },
];
const selectedRouteCases = dcaOnly
  ? routeCases.filter((item) => ["?page=dca1", "?page=dca2", "?page=bottom"].includes(item.query))
  : routeCases;

const moverFixture = await readDataset("market-movers");
const boardSignatures = ["day", "week", "month"].map((board) => JSON.stringify(
  (moverFixture.boards?.[board]?.rows || []).slice(0, 20).map((row) => [
    row.symbol,
    row.change ?? row.changeYtd,
    row.dollarVolume,
  ]),
));
if (new Set(boardSignatures).size <= 1) {
  throw new Error("Market range fixture should produce different board rows");
}

const server = await startServer();
async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true, channel: "chrome" });
  } catch {
    return chromium.launch({ headless: true });
  }
}

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => console.error(error.stack));
  for (const baseUrl of [server.rootUrl, server.nextUrl]) {
    for (const item of selectedRouteCases) {
      if (process.env.ROUTE_TRACE) console.log("route", baseUrl, item.query || "/");
      await page.goto(`${baseUrl}${item.query}`, { waitUntil: "networkidle" });
      const text = await page.locator("body").innerText();
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const logoLoaded = await page.locator(".brand img").evaluate((image) => image instanceof HTMLImageElement && image.naturalWidth > 0);
      assert(text.includes(item.text), `Missing text for ${baseUrl}${item.query || ""}: ${item.text}`);
      assert(height < 9000, `Page too tall for ${baseUrl}${item.query || ""}: ${height}`);
      assert(logoLoaded, `Logo failed to load for ${baseUrl}${item.query || ""}`);
    }
  }
  const sharedFailureCounts = { bootstrap: 0, signals: 0 };
  const failOnce = (key) => async (route) => {
    sharedFailureCounts[key] += 1;
    if (sharedFailureCounts[key] === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary failure" }) });
      return;
    }
    await route.fallback();
  };
  const failBootstrap = failOnce("bootstrap");
  const failSignals = failOnce("signals");
  await page.route("**/api/product/bootstrap?**", failBootstrap);
  await page.route("**/api/signals", failSignals);
  await page.goto(server.rootUrl, { waitUntil: "networkidle" });
  assert(await page.locator(".appDataError").isVisible(), "Shared data failure should show a retry action");
  await page.waitForTimeout(250);
  assert(sharedFailureCounts.bootstrap === 1 && sharedFailureCounts.signals === 1, "Failed shared requests should stop instead of retrying in a loop");
  await page.locator(".appDataError button").click();
  await page.locator(".appDataError").waitFor({ state: "detached" });
  assert(sharedFailureCounts.bootstrap === 2 && sharedFailureCounts.signals === 2, "Retry should request only failed shared data again");
  await page.unroute("**/api/product/bootstrap?**", failBootstrap);
  await page.unroute("**/api/signals", failSignals);
  let stockFailureCount = 0;
  const failStocksOnce = async (route) => {
    stockFailureCount += 1;
    if (stockFailureCount === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary failure" }) });
      return;
    }
    await route.fallback();
  };
  await page.route("**/api/product/symbols?**", failStocksOnce);
  await page.goto(`${server.rootUrl}?page=stocks`, { waitUntil: "networkidle" });
  assert(await page.locator(".stockLibraryError").isVisible(), "Stock list failure should not look like an empty result");
  assert((await page.locator(".stockLibraryEmpty").count()) === 0, "Stock list failure should hide the empty-result message");
  await page.locator(".stockLibraryError button").click();
  await page.locator(".stockLibraryError").waitFor({ state: "detached" });
  assert(stockFailureCount === 2, "Stock list retry should make one new request");
  await page.unroute("**/api/product/symbols?**", failStocksOnce);

  let authFailureCount = 0;
  const failAuthOnce = async (route) => {
    authFailureCount += 1;
    if (authFailureCount === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary failure" }) });
      return;
    }
    await route.fallback();
  };
  await page.route("**/api/auth/status", failAuthOnce);
  await page.goto(server.rootUrl, { waitUntil: "networkidle" });
  assert(await page.locator(".authStatusError").isVisible(), "Auth status failure should not look like a signed-out session");
  await page.locator(".authStatusError button").click();
  await page.locator(".authStatusError").waitFor({ state: "detached" });
  assert(authFailureCount === 2, "Auth status retry should make one new request");
  await page.unroute("**/api/auth/status", failAuthOnce);

  await page.route("**/api/auth/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      authenticated: true,
      user: { id: 2, email: "yearly@example.test", role: "user", plan: "yearly", onboardingSeenAt: "2026-08-01 12:00:00" },
      entitlements: { paid: true, pro: true, proPlus: true, admin: false, yearly: true },
    }),
  }));

  let rollingFailureCount = 0;
  const failRollingOnce = async (route) => {
    rollingFailureCount += 1;
    if (rollingFailureCount === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary failure" }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ plans: [], marketError: "" }) });
  };
  await page.route("**/api/rolling/plans", failRollingOnce);
  await page.goto(`${server.rootUrl}?page=rolling`, { waitUntil: "networkidle" });
  assert(await page.locator(".marketToolError").isVisible(), "Rolling plan failure should not look like an empty plan list");
  assert((await page.locator("body").innerText()).includes("temporary failure") === false, "Rolling plan failure should not expose a technical error");
  await page.locator(".marketToolError .requestRetry").click();
  await page.locator("[data-testid='rolling-tool-page']").waitFor({ state: "visible" });
  assert(rollingFailureCount === 2, "Rolling plan retry should make one new request");
  await page.unroute("**/api/rolling/plans", failRollingOnce);

  let watchlistFailureCount = 0;
  const failWatchlistOnce = async (route) => {
    watchlistFailureCount += 1;
    if (watchlistFailureCount === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary failure" }) });
      return;
    }
    await route.fallback();
  };
  await page.route("**/api/watchlist", failWatchlistOnce);
  await page.goto(`${server.rootUrl}?page=watchlist`, { waitUntil: "networkidle" });
  assert(await page.locator(".watchlistDataError").isVisible(), "Watchlist failure should not look like an empty watchlist");
  assert((await page.locator(".watchlistEmpty").count()) === 0, "Watchlist failure should hide the empty state");
  await page.locator(".watchlistDataError button").click();
  await page.locator(".watchlistDataError").waitFor({ state: "detached" });
  assert(watchlistFailureCount === 2, "Watchlist retry should make one new request");
  await page.unroute("**/api/watchlist", failWatchlistOnce);

  let detailFailureCount = 0;
  const failDetailOnce = async (route) => {
    detailFailureCount += 1;
    if (detailFailureCount === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary failure" }) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        profile: { symbol: "ZZZZ", company: "Test Company", sector: "科技", price: 100 },
        marketRows: [],
        peers: [],
        events: [],
        earnings: [],
        strength: null,
      }),
    });
  };
  await page.route("**/api/product/symbols/ZZZZ", failDetailOnce);
  await page.goto(`${server.rootUrl}?page=stocks&symbol=ZZZZ`, { waitUntil: "networkidle" });
  assert(await page.locator(".trackingDetailEmpty").isVisible(), "Stock detail failure should show a retry action");
  assert((await page.locator("body").innerText()).includes("temporary failure") === false, "Stock detail should not expose a technical error");
  await page.locator(".trackingDetailEmpty .requestRetry").click();
  await page.locator(".trackingDetailQuote").waitFor({ state: "visible" });
  assert(detailFailureCount === 2, "Stock detail retry should make one new request");
  await page.unroute("**/api/product/symbols/ZZZZ", failDetailOnce);

  let watchlistStatusFailureCount = 0;
  const failWatchlistStatusOnce = async (route) => {
    watchlistStatusFailureCount += 1;
    if (watchlistStatusFailureCount === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary failure" }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [] }) });
  };
  await page.route("**/api/watchlist", failWatchlistStatusOnce);
  await page.goto(`${server.rootUrl}?page=stocks&symbol=ZZZZ`, { waitUntil: "networkidle" });
  assert(await page.locator(".stockPreviewWatchlist .requestRetry").isVisible(), "Watchlist status failure should stop the add action and show retry");
  assert((await page.locator("body").innerText()).includes("temporary failure") === false, "Watchlist status should not expose a technical error");
  await page.locator(".stockPreviewWatchlist .requestRetry").click();
  await page.getByRole("button", { name: "加入自选", exact: true }).waitFor({ state: "visible" });
  assert(watchlistStatusFailureCount === 2, "Watchlist status retry should make one new request");
  await page.unroute("**/api/watchlist", failWatchlistStatusOnce);

  let cryptoFailureCount = 0;
  const failCryptoOnce = async (route) => {
    cryptoFailureCount += 1;
    if (cryptoFailureCount === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary failure" }) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-08-21",
        assets: {
          BTC: { latestDate: "2026-08-21", latestFlowUsd: 1, flow5dUsd: 2, flow21dUsd: 3, history: [] },
          ETH: { latestDate: "2026-08-21", latestFlowUsd: 1, flow5dUsd: 2, flow21dUsd: 3, history: [] },
        },
        history: [{ date: "2026-08-21", btcFlowUsd: 1, ethFlowUsd: 1, totalFlowUsd: 2 }],
      }),
    });
  };
  await page.route("**/api/product/raw/crypto-etf-flows", failCryptoOnce);
  await page.goto(`${server.rootUrl}?page=market`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "加密 ETF", exact: true }).evaluate((element) => element.click());
  assert(await page.locator(".cryptoEtfState").isVisible(), "Crypto ETF failure should show a retry action");
  assert((await page.locator("body").innerText()).includes("temporary failure") === false, "Crypto ETF should not expose a technical error");
  await page.locator(".cryptoEtfState .requestRetry").click();
  await page.locator(".cryptoEtfView").waitFor({ state: "visible" });
  assert(cryptoFailureCount === 2, "Crypto ETF retry should make one new request");
  await page.unroute("**/api/product/raw/crypto-etf-flows", failCryptoOnce);

  let openFailureCount = 0;
  const failOpenOnce = async (route) => {
    openFailureCount += 1;
    if (openFailureCount === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary failure" }) });
      return;
    }
    await route.fallback();
  };
  await page.route("**/api/open-portfolio", failOpenOnce);
  await page.goto(`${server.rootUrl}?page=open`, { waitUntil: "networkidle" });
  assert(await page.locator(".openPortfolioError").isVisible(), "Open portfolio failure should not look like an empty portfolio");
  assert((await page.getByText("暂无持仓", { exact: true }).count()) === 0, "Open portfolio failure should hide the empty state");
  await page.locator(".openPortfolioError button").click();
  await page.locator(".openPortfolioError").waitFor({ state: "detached" });
  assert(openFailureCount === 2, "Open portfolio retry should make one new request");
  await page.unroute("**/api/open-portfolio", failOpenOnce);

  await page.unroute("**/api/auth/status");
  await page.route("**/api/auth/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      authenticated: true,
      user: { id: 1, email: "admin@example.test", role: "admin", plan: "yearly", onboardingSeenAt: "2026-08-01 12:00:00" },
      entitlements: { paid: true, pro: true, proPlus: true, admin: true, yearly: true },
    }),
  }));
  let fundingFailureCount = 0;
  const failFundingOnce = async (route) => {
    fundingFailureCount += 1;
    if (fundingFailureCount <= 2) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary failure" }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], updated_at: "2026-08-22 12:00:00", stale: false }) });
  };
  await page.route("**/api/tools/funding-arbitrage?**", failFundingOnce);
  await page.goto(`${server.rootUrl}?page=funding`, { waitUntil: "networkidle" });
  assert(await page.locator(".fundingScannerError").isVisible(), "Funding scanner failure should show an error state");
  assert((await page.locator(".fundingScannerEmpty").innerText()) === "扫描未完成", "Funding scanner failure should not look like an empty result");
  assert((await page.locator("body").innerText()).includes("temporary failure") === false, "Funding scanner should not expose a technical error");
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByText("没有符合条件的结果", { exact: true }).waitFor({ state: "visible" });
  assert((await page.locator(".fundingScannerEmpty").innerText()) === "没有符合条件的结果", "Funding scanner should show the empty state only after a successful scan");
  assert(fundingFailureCount === 3, "Funding scanner retry should make one new request after its two initial requests");
  await page.unroute("**/api/tools/funding-arbitrage?**", failFundingOnce);

  await page.goto(`${server.rootUrl}?page=dca1`, { waitUntil: "networkidle" });
  assert(await page.locator("[data-testid='dca1-strategy-page']").isVisible(), "Paid DCA 1 page should be visible");
  const dca1Action = await page.locator(".dcaDecisionContent strong").innerText();
  assert(dca1Action.includes("尚未进入分批区"), `DCA 1 should show the current action; received: ${dca1Action}`);
  assert((await page.locator(".dcaAdvice").count()) === 0, "DCA pages should not repeat the action in a side panel");
  assert(await page.locator(".dcaChart").isVisible(), "DCA 1 history chart should be visible");
  assert((await page.locator("[data-testid='dca-chart-legend']").innerText()).includes("分批区\n开始日"), "DCA 1 should explain the opportunity band and entry date");
  assert(await page.locator(".dcaOpportunityDot").count() === 5, "DCA 1 should place each fixture opportunity on the QQQ chart");
  assert((await page.locator("body").innerText()).includes("收益") === false, "DCA pages should not market historical returns");
  for (const internalCopy of ["回测", "算法", "阈值", "数据来源", "交易日更新"]) {
    assert((await page.locator("body").innerText()).includes(internalCopy) === false, `DCA pages should not expose internal copy: ${internalCopy}`);
  }
  if (process.env.DCA_STRATEGY_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.DCA_STRATEGY_SCREENSHOT_PREFIX}-dca1-desktop.png`, fullPage: true });
  await page.goto(`${server.rootUrl}?page=bottom`, { waitUntil: "networkidle" });
  assert(await page.locator("[data-testid='dca2-strategy-page']").isVisible(), "Legacy bottom route should open DCA 2");
  assert(await page.locator(".dcaChart").isVisible(), "DCA 2 history chart should be visible");
  assert((await page.locator("[data-testid='dca-chart-legend']").innerText()).trim() === "确认日", "DCA 2 should identify confirmation dates without implying a shared opportunity band");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Desktop DCA page should not overflow horizontally");
  if (process.env.DCA_STRATEGY_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.DCA_STRATEGY_SCREENSHOT_PREFIX}-dca2-desktop.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${server.rootUrl}?page=dca2`, { waitUntil: "networkidle" });
  assert(await page.locator("[data-testid='dca2-strategy-page']").isVisible(), "Mobile DCA page should be visible");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Mobile DCA page should not overflow horizontally");
  if (process.env.DCA_STRATEGY_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.DCA_STRATEGY_SCREENSHOT_PREFIX}-dca2-mobile.png`, fullPage: true });
} finally {
  await browser.close();
  await server.close();
}

console.log(`Next/root front regression passed (${selectedRouteCases.length * 2 + 6} checks).`);

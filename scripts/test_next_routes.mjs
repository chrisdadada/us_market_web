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
  if (url.pathname === "/api/tools/bottom-strategy") {
    return JSON.parse(await readFile(join(root, "server", "bottom_strategy.json"), "utf8"));
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
  { query: "?page=stocks&symbol=MU", text: "美股行情" },
  { query: "?page=calendar", text: "重点财经前瞻" },
  { query: "?page=open", text: "Open 持仓参考" },
  { query: "?page=forum", text: "论坛讨论区" },
];

const moverFixture = await readDataset("market-movers");
const topSectorByBoard = ["day", "week", "month"].map((board) => {
  const totals = new Map();
  for (const row of moverFixture.boards?.[board]?.rows || []) {
    if (!row.sector || row.sector === "未分类" || row.sector === "ETF") continue;
    const change = Number(row.change || row.changeYtd || 0);
    const volume = Number(row.dollarVolume || 0);
    totals.set(row.sector, (totals.get(row.sector) || 0) + (change >= 0 ? volume : -volume));
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
});
if (new Set(topSectorByBoard).size <= 1) {
  throw new Error("Market range fixture should produce different sector rankings");
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
    for (const item of routeCases) {
      await page.goto(`${baseUrl}${item.query}`, { waitUntil: "networkidle" });
      const text = await page.locator("body").innerText();
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const logoLoaded = await page.locator(".brand img").evaluate((image) => image instanceof HTMLImageElement && image.naturalWidth > 0);
      assert(text.includes(item.text), `Missing text for ${baseUrl}${item.query || ""}: ${item.text}`);
      assert(height < 9000, `Page too tall for ${baseUrl}${item.query || ""}: ${height}`);
      assert(logoLoaded, `Logo failed to load for ${baseUrl}${item.query || ""}`);
    }
  }
  await page.route("**/api/auth/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      authenticated: true,
      user: { id: 2, email: "monthly@example.test", role: "user", plan: "monthly", onboardingSeenAt: "2026-08-01 12:00:00" },
      entitlements: { paid: true, pro: true, proPlus: false, admin: false, yearly: false },
    }),
  }));
  await page.goto(`${server.rootUrl}?page=bottom`, { waitUntil: "networkidle" });
  assert(await page.locator("[data-testid='bottom-strategy-page']").isVisible(), "Paid bottom strategy page should be visible");
  assert((await page.locator(".bottomStrategyDecision h1").innerText()).includes("继续等待"), "Bottom strategy should lead with the current action");
  assert((await page.locator(".bottomStrategySummaryRow h2").innerText()).includes("均走出上涨行情"), "Bottom strategy summary should show verified recent results");
  assert(await page.locator(".bottomStrategyRecent p").count() === 5, "Bottom strategy should show five recent completed signals");
  await page.getByRole("button", { name: "完整记录" }).click();
  assert(await page.locator(".bottomStrategyRecords tbody tr").count() === 8, "Bottom strategy should preserve all eight QQQ signals");
  assert(await page.locator(".bottomStrategyRecords .negative").count() === 2, "Bottom strategy should preserve the two early negative QQQ outcomes");
  await page.getByRole("button", { name: "信号位置" }).click();
  assert(await page.locator(".bottomStrategyChart svg").isVisible(), "Bottom strategy signal position chart should be visible");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Desktop bottom strategy should not overflow horizontally");
  if (process.env.BOTTOM_STRATEGY_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.BOTTOM_STRATEGY_SCREENSHOT_PREFIX}-desktop.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${server.rootUrl}?page=bottom`, { waitUntil: "networkidle" });
  assert(await page.locator("[data-testid='bottom-strategy-page']").isVisible(), "Mobile bottom strategy page should be visible");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Mobile bottom strategy should not overflow horizontally");
  if (process.env.BOTTOM_STRATEGY_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.BOTTOM_STRATEGY_SCREENSHOT_PREFIX}-mobile.png`, fullPage: true });
} finally {
  await browser.close();
  await server.close();
}

console.log(`Next/root front regression passed (${routeCases.length * 2 + 2} checks).`);

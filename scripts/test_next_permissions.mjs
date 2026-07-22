import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { readProductDataset } from "./product_db_test_data.mjs";

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

const profiles = {
  anonymous: {
    authenticated: false,
    user: null,
    entitlements: { paid: false, pro: false, proPlus: false, admin: false, yearly: false },
  },
  free: {
    authenticated: true,
    user: { id: 1, email: "free@example.test", role: "user", plan: "free", subscriptionExpiresAt: null },
    entitlements: { paid: false, pro: false, proPlus: false, admin: false, yearly: false },
  },
  monthly: {
    authenticated: true,
    user: { id: 2, email: "monthly@example.test", role: "user", plan: "monthly", subscriptionExpiresAt: "2026-07-22 12:00:00", onboardingSeenAt: "2026-07-01 12:00:00" },
    entitlements: { paid: true, pro: true, proPlus: false, admin: false, yearly: false },
  },
  yearly: {
    authenticated: true,
    user: { id: 3, email: "yearly@example.test", role: "user", plan: "yearly", subscriptionExpiresAt: "2027-06-22 12:00:00" },
    entitlements: { paid: true, pro: true, proPlus: true, admin: false, yearly: true },
  },
  admin: {
    authenticated: true,
    user: { id: 4, email: "admin@example.test", role: "admin", plan: "free", subscriptionExpiresAt: null },
    entitlements: { paid: false, pro: false, proPlus: false, admin: true, yearly: true },
  },
};

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

async function apiPayload(url, authProfile) {
  if (url.pathname === "/api/auth/status") return authProfile;
  if (url.pathname === "/api/auth/logout") return { ok: true };
  if (url.pathname === "/api/open-portfolio") return { curve: [], holdings: [], trades: [] };

  const ytd = await readDataset("ytd-gainers");
  const movers = await readDataset("market-movers");
  const sectorFlow = await readDataset("sector-flow");
  const strength = await readDataset("strength-scanner");
  const calendar = await readDataset("events-calendar");
  const opinions = await readDataset("market-opinion-content");
  const marketTemperature = await readDataset("market-temperature");
  const macroSeries = await readDataset("macro-series");

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
      strength: authProfile.entitlements.paid ? strength : null,
      sectorFlow,
    };
  }

  if (url.pathname === "/api/product/raw/market-temperature") return marketTemperature;
  if (url.pathname === "/api/product/raw/macro-series") return macroSeries;
  if (url.pathname === "/api/product/raw/strength-scanner") return strength;

  if (url.pathname === "/api/product/opinions") {
    const items = (opinions.items || []).filter((item) => item.status === "published");
    const limit = Number(url.searchParams.get("limit") || 8);
    const offset = Number(url.searchParams.get("offset") || 0);
    const section = String(url.searchParams.get("section") || "");
    const rows = section ? items.filter((item) => item.section === section) : items;
    return { rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset, section };
  }

  if (url.pathname === "/api/product/calendar") {
    const limit = Number(url.searchParams.get("limit") || 50);
    const offset = Number(url.searchParams.get("offset") || 0);
    const rows = calendar.events || [];
    return { rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
  }

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
    }));
    return { rows, total: rows.length, limit: rows.length, offset: 0, sort: "dollarVolume" };
  }

  if (url.pathname.startsWith("/api/product/symbols/")) {
    const symbol = decodeURIComponent(url.pathname.split("/").pop() || "MU").toUpperCase();
    return {
      profile: { symbol, company: symbol, sector: "科技", marketCap: "$1.0B", price: 100, dollarVolume: 10000000, volumeRatio: 1.2 },
      marketRows: [],
      peers: [],
      events: [],
      earnings: [],
      strength: null,
    };
  }

  return { ok: true };
}

function startServer(authProfile) {
  const apiRequests = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) {
        apiRequests.push(url.pathname);
        sendJson(response, await apiPayload(url, authProfile));
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
      const indexPath = join(distRoot, "index.html");
      await readFile(indexPath);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      createReadStream(indexPath).pipe(response);
    }
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolveServer({
        rootUrl: `http://127.0.0.1:${address.port}/`,
        nextUrl: `http://127.0.0.1:${address.port}/next/`,
        apiRequests,
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true, channel: "chrome" });
  } catch {
    return chromium.launch({ headless: true });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const gates = {
  open: "开通查看完整内容",
};

const scenarios = [
  { profile: "anonymous", page: "home", presentSelector: ".frontHomeTableLock" },
  { profile: "anonymous", page: "opinions", absent: Object.values(gates) },
  { profile: "anonymous", page: "tracking", presentSelector: ".lockedStockName" },
  { profile: "anonymous", page: "open", present: [gates.open] },
  { profile: "anonymous", page: "calendar", absent: Object.values(gates) },
  { profile: "anonymous", page: "market", present: [gates.open] },
  { profile: "anonymous", page: "stocks", absent: Object.values(gates) },
  { profile: "anonymous", page: "risk", present: ["注册后查看"] },
  { profile: "anonymous", page: "strength", present: [gates.open], absentSelector: ".strengthMetrics" },
  { profile: "free", page: "opinions", absent: Object.values(gates) },
  { profile: "free", page: "tracking", presentSelector: ".lockedStockName" },
  { profile: "free", page: "home", presentSelector: ".frontHomeTableLock" },
  { profile: "free", page: "open", present: [gates.open] },
  { profile: "free", page: "market", present: [gates.open] },
  { profile: "free", page: "risk", presentSelector: "[data-testid='market-temperature-page']", absent: Object.values(gates) },
  { profile: "free", page: "strength", present: [gates.open], absentSelector: ".strengthMetrics" },
  { profile: "monthly", page: "opinions", absent: Object.values(gates) },
  { profile: "monthly", page: "tracking", absentSelector: ".lockedStockName" },
  { profile: "monthly", page: "home", absentSelector: ".frontHomeTableLock" },
  { profile: "monthly", page: "open", present: [gates.open] },
  { profile: "monthly", page: "market", absent: Object.values(gates) },
  { profile: "monthly", page: "risk", presentSelector: "[data-testid='market-temperature-page']", absent: Object.values(gates) },
  { profile: "monthly", page: "strength", presentSelector: "[data-testid='market-strength-page']", absent: Object.values(gates) },
  { profile: "yearly", page: "opinions", absent: Object.values(gates) },
  { profile: "yearly", page: "tracking", absentSelector: ".lockedStockName" },
  { profile: "yearly", page: "open", absent: [gates.open] },
  { profile: "yearly", page: "market", absent: Object.values(gates) },
  { profile: "admin", page: "opinions", absent: Object.values(gates) },
  { profile: "admin", page: "tracking", absentSelector: ".lockedStockName" },
  { profile: "admin", page: "open", absent: [gates.open] },
  { profile: "admin", page: "market", absent: Object.values(gates) },
];

const browser = await launchBrowser();
try {
  for (const [profileName, authProfile] of Object.entries(profiles)) {
    const server = await startServer(authProfile);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", (error) => console.error(`Browser error (${profileName}):`, error.stack));
    try {
      for (const baseUrl of [server.rootUrl, server.nextUrl]) {
        for (const scenario of scenarios.filter((item) => item.profile === profileName)) {
          await page.goto(`${baseUrl}?page=${scenario.page}`, { waitUntil: "networkidle" });
          if (scenario.page === "home") {
            await page.waitForSelector(".frontHomeStrengthPanel");
          }
          const text = await page.locator("body").innerText();
          assert(!new URL(page.url()).pathname.startsWith("/legacy"), `${profileName}/${scenario.page} should stay in the white main site`);
          if (!authProfile.entitlements.admin) {
            assert(await page.locator(".navGroupTitle", { hasText: "管理员工具" }).count() === 0, `${profileName} should not show the admin tool group`);
          }
          for (const expected of scenario.present || []) {
            assert(text.includes(expected), `${profileName}/${baseUrl}/${scenario.page} should show gate: ${expected}; body=${text.slice(0, 240)}`);
          }
          for (const unexpected of scenario.absent || []) {
            assert(!text.includes(unexpected), `${profileName}/${baseUrl}/${scenario.page} should not show gate: ${unexpected}`);
          }
          if (scenario.presentSelector) {
            await page.waitForSelector(scenario.presentSelector);
            assert(await page.locator(scenario.presentSelector).count() > 0, `${profileName}/${baseUrl}/${scenario.page} should show ${scenario.presentSelector}`);
          }
          if (scenario.absentSelector) {
            assert(await page.locator(scenario.absentSelector).count() === 0, `${profileName}/${baseUrl}/${scenario.page} should hide ${scenario.absentSelector}`);
          }
        }
      }
      const strengthRequestCount = server.apiRequests.filter((path) => path === "/api/product/raw/strength-scanner").length;
      if (profileName === "anonymous" || profileName === "free") {
        assert(strengthRequestCount === 0, `${profileName} should not request the paid strength dataset`);
      }
      if (profileName === "monthly") {
        assert(strengthRequestCount > 0, "monthly member should request the paid strength dataset");
      }
      if (profileName === "monthly") {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${server.rootUrl}?page=strength`, { waitUntil: "networkidle" });
        await page.waitForSelector("[data-testid='market-strength-page']");
        assert(await page.locator(".mobileShellBar").isVisible(), "mobile shell bar should be visible");
        assert(!(await page.locator(".strengthTable").isVisible()), "desktop strength table should be hidden on mobile");
        assert(await page.locator(".strengthMobileList").isVisible(), "mobile strength list should be visible");
        assert(await page.locator(".strengthMobileRow").count() > 0, "mobile strength list should contain rows");
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile strength page should not overflow horizontally");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-strength.png`, fullPage: true });

        await page.locator(".mobileMenuButton").click();
        await page.waitForFunction(() => document.querySelector(".sideRail")?.classList.contains("mobileOpen"));
        await page.waitForTimeout(250);
        const navigationBox = await page.locator(".sideRail").boundingBox();
        assert(Boolean(navigationBox && navigationBox.x <= 1 && navigationBox.width >= 300), `mobile navigation should fully open: ${JSON.stringify(navigationBox)}`);
        const primaryLabels = await page.locator(".sideRail > nav button span").allTextContents();
        assert(primaryLabels.join("|") === "首页|美股热点风向标|股票机会跟踪榜单|股票库|美股重点财经前瞻", `mobile primary navigation is incorrect: ${primaryLabels.join("|")}`);
        assert(await page.locator(".sideRail", { hasText: "工具数据" }).count() === 1, "mobile navigation should include the tool-data group");
        assert(await page.locator(".sideRail", { hasText: "交易实战课程" }).count() === 0, "courses should not appear in mobile navigation");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-navigation.png` });
        await page.locator(".mobileNavClose").click();
        await page.waitForTimeout(250);
        assert(await page.locator(".mobileMenuButton").evaluate((element) => document.activeElement === element), "closing mobile navigation should restore focus to the menu button");

        await page.locator(".strengthMobileControls button").click();
        assert(await page.locator(".strengthFilterSheet").isVisible(), "mobile strength filter sheet should open");
        assert(await page.locator("body.strengthFilterLocked").count() === 1, "mobile strength filter should lock background scrolling");
        await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "关闭筛选");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-filter.png` });
        await page.locator(".strengthSheetFilters select").first().selectOption({ index: 1 });
        await page.locator(".strengthFilterApply").click();
        assert(await page.locator(".strengthMobileControls b").textContent() === "1", "applying a strength filter should update the active filter count");
        await page.locator(".strengthMobileControls button").click();
        await page.locator(".strengthFilterReset").click();
        await page.locator(".strengthFilterSheet header button").click();
        assert(await page.locator(".strengthFilterSheet").count() === 0, "mobile strength filter sheet should close");
        assert(await page.locator(".strengthMobileControls b").count() === 0, "resetting strength filters should clear the active filter count");

        await page.setViewportSize({ width: 768, height: 820 });
        await page.goto(`${server.rootUrl}?page=strength`, { waitUntil: "networkidle" });
        assert(await page.locator(".mobileShellBar").isVisible(), "tablet shell bar should be visible");
        assert(await page.locator(".strengthMobileList").isVisible(), "tablet should use the mobile strength list");
        assert(!(await page.locator(".strengthTable").isVisible()), "tablet should not show the wide strength table");
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "tablet strength page should not overflow horizontally");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-tablet.png`, fullPage: true });
        await page.locator(".strengthMobileControls button").click();
        await page.setViewportSize({ width: 1200, height: 820 });
        await page.waitForTimeout(50);
        assert(await page.locator(".strengthFilterSheet").count() === 0, "resizing to desktop should close the mobile strength filter");
        assert(await page.locator("body.strengthFilterLocked").count() === 0, "resizing to desktop should unlock background scrolling");
      }
    } finally {
      await page.close();
      await server.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`Next/root permission regression passed (${scenarios.length * 2} checks).`);

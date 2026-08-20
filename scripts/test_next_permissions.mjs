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
const rollingOnly = process.env.ROLLING_ONLY === "1";
const fullQa = !dcaOnly && !rollingOnly;

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
    user: { id: 1, email: "free@example.test", role: "user", plan: "free", subscriptionExpiresAt: null, onboardingSeenAt: "2026-07-01 12:00:00" },
    entitlements: { paid: false, pro: false, proPlus: false, admin: false, yearly: false },
  },
  monthly: {
    authenticated: true,
    user: { id: 2, email: "monthly@example.test", role: "user", plan: "monthly", subscriptionExpiresAt: "2026-07-22 12:00:00", onboardingSeenAt: "2026-07-01 12:00:00" },
    entitlements: { paid: true, pro: true, proPlus: false, admin: false, yearly: false },
  },
  yearly: {
    authenticated: true,
    user: { id: 3, email: "yearly@example.test", role: "user", plan: "yearly", subscriptionExpiresAt: "2027-06-22 12:00:00", onboardingSeenAt: "2026-07-01 12:00:00" },
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

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
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

const trackingPriceHistory = Array.from({ length: 60 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 4, 1 + index)).toISOString().slice(0, 10),
  close: 96 + index * 0.2 + Math.sin(index / 4) * 2,
}));

const opinionFixture = {
  id: "test-opinion",
  section: "premarket",
  sectionLabel: "盘前前瞻",
  title: "测试观点",
  tradeDate: "2026-07-25 08:00:00",
  summary: "用于验证会员预览和观点详情权限。",
  symbols: ["AAPL"],
  topics: ["测试"],
  highlights: ["验证权限展示"],
  body: "观点正文仅用于自动化权限测试。",
  featured: true,
  status: "published",
};

const opinionFixtures = [
  opinionFixture,
  { ...opinionFixture, id: "test-opinion-2", section: "daily", sectionLabel: "盘中观察", title: "第二条测试观点", featured: false },
];

const macroResultFixtures = [
  {
    id: "test-cpi-result",
    date: "2026-07-14",
    time: "20:30:00",
    title: "美国 CPI",
    type: "macro",
    impact: "high",
    actualLabel: "同比 3.5%",
    actualValue: 3.5,
    forecastLabel: "3.8%",
    forecastValue: 3.8,
    previousLabel: "4.2%",
    previousValue: 4.2,
    resultKind: "cpi",
    resultHeadline: "低于预期",
    resultMeaning: "通胀更低，美股短线通常偏利好",
    resultTone: "positive",
  },
  {
    id: "test-jobs-result",
    date: "2026-07-02",
    time: "20:30:00",
    title: "美国非农就业",
    type: "macro",
    impact: "high",
    actualLabel: "+20K",
    actualValue: 20,
    forecastLabel: "110K",
    forecastValue: 110,
    previousLabel: "+63K",
    previousValue: 63,
    resultKind: "jobs",
    resultHeadline: "低于预期",
    resultMeaning: "就业降温，降息预期可能升温",
    resultTone: "watch",
  },
  {
    id: "test-rate-result",
    date: "2026-06-18",
    time: "02:00:00",
    title: "FOMC 议息会议",
    type: "macro",
    impact: "high",
    actualLabel: "3.50%-3.75%",
    actualValue: 3.75,
    forecastLabel: "3.75%",
    forecastValue: 3.75,
    previousLabel: "3.50%-3.75%",
    previousValue: 3.75,
    resultKind: "rate",
    resultHeadline: "利率不变",
    resultMeaning: "借钱成本没有变化，美股影响偏中性",
    resultTone: "neutral",
  },
];

function trackingFixture(board, includeAnalysis) {
  const changeByBoard = { day: 1.2, week: 3.4, month: 8.6, volume: 1.2 };
  return {
    rank: 9001,
    symbol: "AAPL",
    company: "Apple Inc.",
    sector: "科技",
    price: 107.8,
    change: changeByBoard[board] || 1.2,
    volumeRatio: 1.4,
    dollarVolume: 5000000000,
    marketCap: "$3.2T",
    marketCapValue: 3200000000000,
    ...(board === "day" && includeAnalysis ? {
      keyLevels: {
        status: "ready",
        asOf: "2026-07-22",
        currentPrice: 107.8,
        support: { center: 100, lower: 99, upper: 101, strength: "strong", strengthText: "强", touches: 3, basis: "近120日出现 3 次确认", lastConfirmedAt: "2026-07-08" },
        secondarySupport: { center: 95, lower: 94, upper: 96, strength: "medium", strengthText: "中", touches: 2, basis: "近120日出现 2 次确认", lastConfirmedAt: "2026-06-18" },
        resistance: { center: 110, lower: 109, upper: 111, strength: "converting", strengthText: "转换中", touches: 1, basis: "原支撑跌破后，等待反抽确认", lastConfirmedAt: "2026-07-15" },
        position: "near_resistance",
        positionText: "接近阻力",
        supportDistancePct: 6.3,
        resistanceDistancePct: 1.1,
        atr14: 2.4,
        atrPct: 2.23,
        ma20: 105.2,
        ma60: 101.4,
        trend: "strong",
        trendText: "偏强",
      },
      priceHistory: trackingPriceHistory,
    } : {}),
  };
}

async function apiPayload(url, authProfile) {
  if (url.pathname === "/api/auth/status") return authProfile;
  if (url.pathname === "/api/auth/logout") return { ok: true };
  if (url.pathname === "/api/open-portfolio") return { curve: [], holdings: [], trades: [] };
  if (url.pathname === "/api/tools/dca-strategies") {
    const bottom = JSON.parse(await readFile(join(root, "server", "bottom_strategy.json"), "utf8"));
    const qqq = bottom.markets.QQQ;
    const unlocked = Boolean(authProfile.entitlements.paid || authProfile.entitlements.admin);
    return {
      preview: !unlocked,
      products: {
        dca1: { asOf: qqq.asOf, status: unlocked ? { key: "waiting", position: 0, headline: "暂未触发", action: "暂不执行" } : null, opportunityDates: qqq.records.slice(0, 5).map((item) => item.signalDate), opportunityWindows: qqq.records.slice(0, 5).map((item) => ({ startDate: item.signalDate, endDate: item.signalDate })), currentCycleStart: null, locationSeries: qqq.priceSeries.map((point, index, rows) => ({ date: point.date, position: Math.round((index / Math.max(1, rows.length - 1)) * 70 + 15) })), lowBoundaryPosition: 30, priceSeries: qqq.priceSeries },
        dca2: { asOf: qqq.asOf, status: unlocked ? { key: "waiting", position: 0, headline: "暂未触发", action: "暂不执行" } : null, opportunityDates: qqq.records.map((item) => item.signalDate), opportunityWindows: qqq.records.map((item) => ({ startDate: item.signalDate, endDate: item.signalDate })), currentCycleStart: qqq.records.at(-1)?.signalDate || null, locationSeries: [], lowBoundaryPosition: null, priceSeries: qqq.priceSeries },
      },
    };
  }

  const ytd = await readDataset("ytd-gainers");
  const movers = await readDataset("market-movers");
  const sectorFlow = await readDataset("sector-flow");
  const strength = await readDataset("strength-scanner");
  const calendar = await readDataset("events-calendar");
  const opinions = await readDataset("market-opinion-content");
  const marketTemperature = await readDataset("market-temperature");
  const macroSeries = await readDataset("macro-series");

  if (url.pathname === "/api/product/bootstrap") {
    const boards = Object.fromEntries(
      Object.entries(movers.boards || {}).map(([board, payload]) => {
        const rows = (payload.rows || []).filter((row) => row.symbol !== "AAPL").slice(0, 19);
        return [board, { ...payload, rows: [trackingFixture(board, authProfile.entitlements.paid || authProfile.entitlements.admin), ...rows] }];
      }),
    );
    return {
      meta: { schemaVersion: "test", generatedAt: ytd.updatedAt || movers.updatedAt || "", counts: {} },
      ytd: { ...ytd, rows: (ytd.rows || []).slice(0, 20) },
      movers: {
        ...movers,
        boards,
      },
      strength: authProfile.entitlements.paid ? strength : null,
      sectorFlow,
    };
  }

  if (url.pathname === "/api/product/raw/market-temperature") return marketTemperature;
  if (url.pathname === "/api/product/raw/macro-series") return macroSeries;
  if (url.pathname === "/api/product/strength") return strengthPageFixture(strength, url);
  if (url.pathname === "/api/product/sectors") {
    return {
      ...sectorFlow,
      board: url.searchParams.get("board") || "day",
      rows: sectorFlow.rows || [],
    };
  }

  if (url.pathname === "/api/product/opinions") {
    const sourceItems = opinions.items?.length ? opinions.items : opinionFixtures;
    const items = sourceItems
      .map((item) => ({ ...item, status: item.status || "published" }))
      .filter((item) => item.status === "published");
    const limit = Number(url.searchParams.get("limit") || 8);
    const offset = Number(url.searchParams.get("offset") || 0);
    const section = String(url.searchParams.get("section") || "");
    const rows = section ? items.filter((item) => item.section === section) : items;
    return { rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset, section };
  }

  if (url.pathname === "/api/product/calendar") {
    const limit = Number(url.searchParams.get("limit") || 50);
    const offset = Number(url.searchParams.get("offset") || 0);
    const type = String(url.searchParams.get("type") || "");
    const impact = String(url.searchParams.get("impact") || "");
    const resultsOnly = url.searchParams.get("resultsOnly") === "true";
    const windowDays = Number(url.searchParams.get("windowDays") || 0);
    const fixtureToday = new Date("2026-07-25T00:00:00Z");
    const startDate = fixtureToday.toISOString().slice(0, 10);
    const endDate = new Date(fixtureToday.getTime() + windowDays * 86400000).toISOString().slice(0, 10);
    const sourceRows = resultsOnly ? macroResultFixtures : (calendar.events || []);
    const rows = sourceRows.filter((event) => {
      if (type && event.type !== type) return false;
      if (impact && event.impact !== impact) return false;
      if (resultsOnly && (!event.resultHeadline || !event.resultMeaning)) return false;
      if (windowDays && (event.date < startDate || event.date > endDate)) return false;
      return true;
    });
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
  let rollingPlans = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) {
        apiRequests.push(url.pathname);
        if (url.pathname === "/api/rolling/quote") {
          sendJson(response, { symbol: url.searchParams.get("symbol") || "BTCUSDT", price: "72000", asOf: Date.now() / 1000, connected: true });
          return;
        }
        if (url.pathname === "/api/rolling/plans" && request.method === "GET") {
          sendJson(response, { plans: rollingPlans, marketError: "" });
          return;
        }
        if (url.pathname === "/api/rolling/plans" && request.method === "POST") {
          const input = await readJsonBody(request);
          const fixedAdd = Number(input.initialNotional) * Number(input.addPercent) / 100;
          const plan = {
            id: "0123456789abcdef0123456789abcdef",
            symbol: input.symbol,
            status: "running",
            config: { ...input, schemaVersion: 1, maxAdds: Number(input.maxAdds), entryTriggerPrice: input.entryTriggerPrice || null },
            state: { quantity: String(Number(input.initialNotional) / 72000), averagePrice: "72000", totalNotional: input.initialNotional, fixedAddNotional: String(fixedAdd), addsCompleted: 0, nextTriggerPrice: "73440", protectionPrice: "67680", entryPrice: "72000", exitPrice: null, estimatedPnl: null, lastFillPrice: "72000" },
            currentPrice: "72000",
            currentNotional: input.initialNotional,
            estimatedPnl: "0",
            estimatedMargin: String(Number(input.initialNotional) / Number(input.leverage)),
            marketConnected: true,
            marketAsOf: Date.now() / 1000,
            createdAt: "2026-08-20T12:00:00Z",
            updatedAt: "2026-08-20T12:00:00Z",
            endedAt: null,
            events: [{ id: 1, type: "entry", price: "72000", detail: {}, createdAt: "2026-08-20T12:00:00Z" }],
          };
          rollingPlans = [plan];
          sendJson(response, { ok: true, id: plan.id }, 201);
          return;
        }
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
  { profile: "anonymous", page: "home", presentSelector: ".frontHomeMemberBar" },
  { profile: "anonymous", page: "opinions", absent: Object.values(gates) },
  { profile: "anonymous", page: "tracking", presentSelector: ".lockedStockName" },
  { profile: "anonymous", page: "open", present: [gates.open] },
  { profile: "anonymous", page: "calendar", absent: Object.values(gates) },
  { profile: "anonymous", page: "market", present: [gates.open] },
  { profile: "anonymous", page: "stocks", absent: Object.values(gates) },
  { profile: "anonymous", page: "risk", present: ["注册后查看"] },
  { profile: "anonymous", page: "position", present: [gates.open] },
  { profile: "anonymous", page: "rolling", present: [gates.open] },
  { profile: "anonymous", page: "dca1", present: ["登录后查看定投产品"] },
  { profile: "anonymous", page: "strength", present: [gates.open], absentSelector: ".strengthMetrics" },
  { profile: "free", page: "opinions", absent: Object.values(gates) },
  { profile: "free", page: "tracking", presentSelector: ".lockedStockName" },
  { profile: "free", page: "home", presentSelector: ".frontHomeMemberBar" },
  { profile: "free", page: "open", present: [gates.open] },
  { profile: "free", page: "market", present: [gates.open] },
  { profile: "free", page: "risk", presentSelector: "[data-testid='market-temperature-page']", absent: Object.values(gates) },
  { profile: "free", page: "position", present: [gates.open] },
  { profile: "free", page: "rolling", present: [gates.open] },
  { profile: "free", page: "dca1", presentSelector: ".dcaGate", present: ["开通查看操作参考"] },
  { profile: "free", page: "dca2", presentSelector: ".dcaGate", present: ["开通查看操作参考"] },
  { profile: "free", page: "strength", present: [gates.open], absentSelector: ".strengthMetrics" },
  { profile: "monthly", page: "opinions", absent: Object.values(gates) },
  { profile: "monthly", page: "tracking", absentSelector: ".lockedStockName" },
  { profile: "monthly", page: "home", absentSelector: ".frontHomeMemberBar" },
  { profile: "monthly", page: "open", present: [gates.open] },
  { profile: "monthly", page: "market", absent: Object.values(gates) },
  { profile: "monthly", page: "risk", presentSelector: "[data-testid='market-temperature-page']", absent: Object.values(gates) },
  { profile: "monthly", page: "strength", presentSelector: "[data-testid='market-strength-page']", absent: Object.values(gates) },
  { profile: "monthly", page: "position", presentSelector: "[data-testid='position-sizing-page']", absent: Object.values(gates) },
  { profile: "monthly", page: "rolling", present: [gates.open], absentSelector: "[data-testid='rolling-tool-page']" },
  { profile: "monthly", page: "dca1", presentSelector: "[data-testid='dca1-strategy-page']", absentSelector: ".dcaGate", absent: ["收益", "判断方式"] },
  { profile: "monthly", page: "dca2", presentSelector: "[data-testid='dca2-strategy-page']", absentSelector: ".dcaGate", absent: ["收益", "判断方式"] },
  { profile: "yearly", page: "opinions", absent: Object.values(gates) },
  { profile: "yearly", page: "tracking", absentSelector: ".lockedStockName" },
  { profile: "yearly", page: "open", absent: [gates.open] },
  { profile: "yearly", page: "market", absent: Object.values(gates) },
  { profile: "yearly", page: "position", presentSelector: "[data-testid='position-sizing-page']", absent: Object.values(gates) },
  { profile: "yearly", page: "rolling", presentSelector: "[data-testid='rolling-tool-page']", absent: Object.values(gates) },
  { profile: "admin", page: "opinions", absent: Object.values(gates) },
  { profile: "admin", page: "tracking", absentSelector: ".lockedStockName" },
  { profile: "admin", page: "open", absent: [gates.open] },
  { profile: "admin", page: "market", absent: Object.values(gates) },
  { profile: "admin", page: "position", presentSelector: "[data-testid='position-sizing-page']", absent: Object.values(gates) },
  { profile: "admin", page: "rolling", presentSelector: "[data-testid='rolling-tool-page']", absent: Object.values(gates) },
];
const selectedScenarios = dcaOnly
  ? scenarios.filter((item) => ["dca1", "dca2"].includes(item.page) && ["anonymous", "free", "monthly"].includes(item.profile))
  : rollingOnly
    ? scenarios.filter((item) => item.page === "rolling")
    : scenarios;

const browser = await launchBrowser();
try {
  for (const [profileName, authProfile] of Object.entries(profiles).filter(([name]) => selectedScenarios.some((item) => item.profile === name))) {
    const server = await startServer(authProfile);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", (error) => console.error(`Browser error (${profileName}):`, error.stack));
    try {
      for (const baseUrl of [server.rootUrl, server.nextUrl]) {
        for (const scenario of selectedScenarios.filter((item) => item.profile === profileName)) {
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
          if (scenario.page === "home" && !authProfile.entitlements.paid && !authProfile.entitlements.admin) {
            assert(text.includes("完整榜单会员可见"), `${profileName}/${baseUrl}/home should explain the blurred preview`);
            assert(await page.locator(".frontHomeMemberBar i").count() === 0, `${profileName}/${baseUrl}/home should not show a hand-drawn lock`);
            const lockedPreview = page.locator(".frontHomeLockedTable .frontHomeDesktopTable");
            assert((await lockedPreview.innerText()).includes("AAPL"), `${profileName}/${baseUrl}/home should retain real preview contours`);
            const previewStyle = await lockedPreview.evaluate((element) => {
              const style = getComputedStyle(element);
              return { filter: style.filter, opacity: style.opacity };
            });
            assert(previewStyle.filter.includes("blur(3px)"), `${profileName}/${baseUrl}/home should use the approved light blur`);
            assert(previewStyle.opacity === "0.7", `${profileName}/${baseUrl}/home should keep preview contours visible`);
            if (profileName === "free" && baseUrl === server.rootUrl && process.env.MOBILE_QA_SCREENSHOT_PREFIX) {
              const continueButton = page.getByRole("button", { name: "同意并继续" });
              if (await continueButton.isVisible()) await continueButton.click();
              await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-home-free.png`, fullPage: true });
            }
          }
          if (scenario.page === "tracking" && !authProfile.entitlements.paid && !authProfile.entitlements.admin) {
            await page.getByText("会员可见", { exact: true }).first().waitFor();
            assert(await page.getByText("会员可见", { exact: true }).count() > 0, `${profileName}/${baseUrl}/tracking should use the member preview label`);
            assert(await page.locator(".lockedStockName i").count() === 0, `${profileName}/${baseUrl}/tracking should not repeat lock icons`);
            if (profileName === "free" && baseUrl === server.rootUrl && process.env.MOBILE_QA_SCREENSHOT_PREFIX) {
              const continueButton = page.getByRole("button", { name: "同意并继续" });
              if (await continueButton.isVisible()) await continueButton.click();
              await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-tracking-free.png`, fullPage: true });
            }
          }
          if (scenario.page === "opinions" && profileName === "free" && baseUrl === server.rootUrl) {
            const memberPreview = page.locator(".opinionMemberLabel").first();
            await memberPreview.waitFor();
            assert((await memberPreview.innerText()) === "会员可见", "opinion list should use a quiet member label");
            assert(await page.locator(".opinionInlineLock").count() === 0, "opinion list should not show lock icons");
            const excerpt = page.locator(".opinionLockedExcerpt p").first();
            const excerptStyle = await excerpt.evaluate((element) => {
              const style = getComputedStyle(element);
              return { filter: style.filter, opacity: style.opacity };
            });
            assert(excerptStyle.filter.includes("blur(2.6px)"), "opinion list should keep a light real-content preview");
            assert(excerptStyle.opacity === "0.76", "opinion list preview should remain visibly loaded");
            await page.locator(".opinionProductFeed > button").first().click();
            await page.waitForSelector(".readerMemberPreview");
            assert(await page.locator(".readerMemberPreview i").count() === 0, "opinion detail should not show a lock icon");
            assert((await page.locator(".readerMemberPreview").innerText()).includes("查看完整观点"), "opinion detail should keep one clear next action");
          }
        }
      }
      const strengthRequestCount = server.apiRequests.filter((path) => path === "/api/product/strength").length;
      if (fullQa && (profileName === "anonymous" || profileName === "free")) {
        assert(strengthRequestCount === 0, `${profileName} should not request the paid strength dataset`);
      }
      if (fullQa && profileName === "monthly") {
        assert(strengthRequestCount > 0, "monthly member should request the paid strength dataset");
      }
      if (!dcaOnly && profileName === "yearly") {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`${server.rootUrl}?page=rolling`, { waitUntil: "networkidle" });
        const onboardingAccept = page.getByRole("button", { name: "同意并继续" });
        if (await onboardingAccept.count()) await onboardingAccept.click();
        await page.waitForSelector(".rollingInlineQuote.connected");
        await page.getByTestId("rolling-start").click();
        await page.waitForSelector("[data-testid='rolling-add-progress']");
        assert((await page.getByTestId("rolling-add-progress").innerText()) === "已完成 0 · 剩余 4", "rolling server plan should begin with no adds");
        assert(!(await page.locator("body").innerText()).includes("导出方案"), "rolling tool should hide plan export");
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "desktop rolling tool should not overflow horizontally");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-rolling-desktop.png`, fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(200);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile rolling tool should not overflow horizontally");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-rolling-mobile.png`, fullPage: true });
      }
      if (fullQa && profileName === "monthly") {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`${server.rootUrl}?page=home`, { waitUntil: "networkidle" });
        assert(await page.locator(".frontHomeDesktopTable").isVisible(), "desktop home should show the stock table");
        assert(!(await page.locator(".frontHomeMobileList").isVisible()), "desktop home should hide the mobile stock list");
        const homeTableText = await page.locator(".frontHomeDesktopTable").innerText();
        assert(homeTableText.includes("关键点位"), "desktop home should show the technical-analysis column");
        assert(homeTableText.includes("$100.00") && homeTableText.includes("$110.00"), "desktop home should show support and resistance");
        assert(await page.locator(".frontLeadMeta time").count() === 1, "home opinion should show its publish time");
        assert((await page.locator(".frontLeadMeta span").innerText()) === "猫言猫语", "home opinion should use the approved column name");
        const opinionUpdateTime = await page.locator(".frontLeadMeta time").innerText();
        assert(opinionUpdateTime.startsWith("更新于 "), "home opinion should label the update time clearly");
        assert(!opinionUpdateTime.includes("北京时间"), "home opinion should not repeat the Beijing-time label");
        assert(await page.locator(".frontPanelTitle time").count() >= 2, "home data panels should show real update times");
        const leadTitleStyle = await page.locator(".frontLeadPanel h1").evaluate((element) => {
          const style = getComputedStyle(element);
          return { lineClamp: style.webkitLineClamp, fontSize: style.fontSize };
        });
        assert(leadTitleStyle.lineClamp === "2", "home opinion title should stay within two lines");
        assert(Number.parseFloat(leadTitleStyle.fontSize) <= 30, "home opinion title should use the approved compact size");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-home-desktop.png`, fullPage: true });

        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForFunction(() => getComputedStyle(document.querySelector(".sideRail")).visibility === "hidden");
        assert(await page.locator(".frontHomeMobileList").isVisible(), "mobile home should show the compact stock list");
        assert(!(await page.locator(".frontHomeDesktopTable").isVisible()), "mobile home should hide the desktop stock table");
        assert(await page.locator(".frontHomeMobileRow").count() > 0, "mobile home should keep the stock rows");
        const firstHomeMobileRow = page.locator(".frontHomeMobileRow", { hasText: "AAPL" });
        const firstHomeMobileText = await firstHomeMobileRow.innerText();
        for (const label of ["近1天", "近1周", "近1月", "成交额", "关键点位", "支撑", "阻力"]) {
          assert(firstHomeMobileText.includes(label), `mobile home should keep ${label}`);
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile home should not overflow horizontally");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-home-mobile.png`, fullPage: true });

        await page.goto(`${server.rootUrl}?page=opinions`, { waitUntil: "networkidle" });
        await page.waitForSelector(".opinionProductDay");
        assert(await page.locator(".opinionProductFeed > button.featured").count() === 1, "opinion list should highlight one latest item");
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile opinion list should not overflow horizontally");
        const mobileOpinionLayout = await page.locator(".opinionProductFeed > button").first().evaluate((element) => {
          const style = getComputedStyle(element);
          const titleRow = element.querySelector(".opinionProductTitle");
          const title = element.querySelector(".opinionProductTitle strong");
          return {
            display: style.display,
            width: element.getBoundingClientRect().width,
            feedWidth: element.parentElement.getBoundingClientRect().width,
            titleDisplay: titleRow ? getComputedStyle(titleRow).display : "",
            titleAlign: title ? getComputedStyle(title).textAlign : "",
            titleFontSize: title ? Number.parseFloat(getComputedStyle(title).fontSize) : 0,
          };
        });
        assert(mobileOpinionLayout.display === "block", "mobile opinion item should use a single-column layout");
        assert(Math.abs(mobileOpinionLayout.width - mobileOpinionLayout.feedWidth) <= 2, "mobile opinion item should use the full feed width");
        assert(mobileOpinionLayout.titleDisplay === "block" && mobileOpinionLayout.titleAlign === "left", "mobile opinion title should use a full-width left-aligned row");
        assert(mobileOpinionLayout.titleFontSize >= 16, "mobile opinion title should remain readable");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-opinions-mobile.png`, fullPage: true });

        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.reload({ waitUntil: "networkidle" });
        const opinionDayCount = await page.locator(".opinionProductDay").count();
        const opinionItemCount = await page.locator(".opinionProductFeed > button").count();
        assert(opinionDayCount > 0 && opinionDayCount < opinionItemCount, "desktop opinion list should group repeated dates");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-opinions-desktop.png`, fullPage: true });

        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`${server.rootUrl}?page=tracking`, { waitUntil: "networkidle" });
        assert(await page.locator(".trackingPage > h1, .trackingHeading").count() === 0, "tracking page should not repeat the navigation label");
        const keyLevelHelp = page.locator(".trackingKeyLevelsHead .infoTip");
        await keyLevelHelp.hover();
        assert(await keyLevelHelp.locator(".infoTipBubble").isVisible(), "tracking help should appear immediately on hover");
        assert(await page.locator(".trackingKeyLevelsHead [title]").count() === 0, "tracking help should not use delayed native tooltips");
        const trackingHeadText = await page.locator(".trackingDesktopTable thead").innerText();
        assert(trackingHeadText.includes("关键点位") && trackingHeadText.includes("操作"), "desktop tracking list should keep key levels and actions visible");
        assert(!trackingHeadText.includes("市值") && !trackingHeadText.includes("信号时间"), "desktop tracking list should move secondary fields into detail");
        assert(await page.locator(".trackingDesktopTable").isVisible(), "desktop tracking list should show the compact table");
        assert(!(await page.locator(".trackingMobileList").isVisible()), "desktop tracking list should hide mobile cards");
        await page.mouse.move(0, 0);
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-tracking-list.png`, fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(200);
        assert(!(await page.locator(".trackingDesktopTable").isVisible()), "mobile tracking list should hide the desktop table");
        assert(await page.locator(".trackingMobileList").isVisible(), "mobile tracking list should show compact stock rows");
        const mobileTrackingText = await page.locator(".trackingMobileRow", { hasText: "AAPL" }).innerText();
        for (const label of ["近1月", "近1周", "成交倍数", "支撑", "阻力", "查看详情"]) {
          assert(mobileTrackingText.includes(label), `mobile tracking row should keep ${label}`);
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile tracking list should not overflow horizontally");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-tracking-list-mobile.png`, fullPage: true });

        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.waitForTimeout(200);
        const aaplRow = page.locator(".trackingPage .screenerTable tbody tr", { hasText: "AAPL" });
        assert((await aaplRow.innerText()).includes("$100.00"), "paid tracking row should show support");
        assert((await aaplRow.innerText()).includes("$110.00"), "paid tracking row should show resistance");
        await aaplRow.locator(".screenerLink").click();
        await page.waitForSelector(".trackingDetailMain");
        assert(await page.locator(".trackingPriceChart svg").count() === 1, "tracking detail should show the price chart");
        assert((await page.locator(".trackingDetailMain").innerText()).includes("支撑区"), "tracking detail should show level evidence");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-tracking-detail.png`, fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(300);
        assert(await page.locator(".trackingDetailMain").isVisible(), "mobile tracking detail should keep key levels visible");
        assert(!(await page.locator(".sideRail").evaluate((element) => element.classList.contains("mobileOpen"))), "mobile tracking detail should keep navigation closed");
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile tracking detail should not overflow horizontally");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-tracking-detail-mobile.png`, fullPage: true });

        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`${server.rootUrl}?page=stocks`, { waitUntil: "networkidle" });
        assert(await page.locator(".stocksSignalStrip").count() === 0, "stock library should remove page-local market summaries");
        assert(await page.locator(".stockLibraryDesktopTable").isVisible(), "desktop stock library should show the comparison table");
        assert(!(await page.locator(".stockLibraryMobileList").isVisible()), "desktop stock library should hide mobile rows");
        const stockLibraryHead = await page.locator(".stockLibraryTable thead").innerText();
        assert(stockLibraryHead.includes("现价") && stockLibraryHead.includes("操作"), "stock library should keep price and the overview action");
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "desktop stock library should not overflow horizontally");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-stocks-desktop.png`, fullPage: true });

        const firstStockView = page.locator(".stockLibraryTable tbody .stockLibraryView").first();
        await firstStockView.click();
        await page.waitForSelector(".trackingDetailPage");
        assert(await page.locator(".trackingDetailQuote").count() === 1, "stock detail should open on demand");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-stocks-overview-desktop.png`, fullPage: true });
        await page.locator(".trackingDetailBack").click();
        assert(await page.locator(".trackingDetailPage").count() === 0, "stock detail should return to the list");

        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(200);
        assert(!(await page.locator(".stockLibraryDesktopTable").isVisible()), "mobile stock library should hide the desktop table");
        assert(await page.locator(".stockLibraryMobileList").isVisible(), "mobile stock library should show compact rows");
        const firstMobileStockText = await page.locator(".stockLibraryMobileRow").first().innerText();
        for (const label of ["近1天", "近1周", "近1月", "成交额", "市值", "查看详情"]) {
          assert(firstMobileStockText.includes(label), `mobile stock library should keep ${label}`);
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile stock library should not overflow horizontally");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-stocks-mobile.png`, fullPage: true });
        await page.locator(".stockLibraryMobileRow .stockLibraryMobileFoot button").first().click();
        await page.waitForSelector(".trackingDetailPage");
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile stock detail should not overflow horizontally");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-stocks-overview-mobile.png`, fullPage: true });
        await page.locator(".trackingDetailBack").click();
        assert(await page.locator(".trackingDetailPage").count() === 0, "mobile stock detail should return to the list");

        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`${server.rootUrl}?page=calendar`, { waitUntil: "networkidle" });
        assert(await page.locator(".calendarPageHead").count() === 0, "calendar should not repeat the navigation title");
        assert(await page.locator(".calendarFilters > strong").count() === 0, "calendar filters should not repeat the page title");
        assert(!(await page.locator("body").innerText()).includes("北京时间"), "calendar should not show redundant timezone copy");
        assert(await page.locator(".calendarCoreMacro").count() === 1, "calendar should keep CPI, payrolls and FOMC in the core macro tracker");
        assert(await page.locator(".calendarMacroTabs").count() === 1, "calendar should provide the three core macro tabs");
        assert(await page.locator(".calendarCoreHead").count() === 0, "calendar should not add a redundant core macro heading");
        const calendarAccountOverlapsFilters = await page.evaluate(() => {
          const account = document.querySelector(".calendarTopbar .accountButton");
          const filters = document.querySelector(".calendarFilterControls");
          if (!account || !filters) return false;
          const accountRect = account.getBoundingClientRect();
          const filterRect = filters.getBoundingClientRect();
          return accountRect.left < filterRect.right && accountRect.right > filterRect.left
            && accountRect.top < filterRect.bottom && accountRect.bottom > filterRect.top;
        });
        assert(!calendarAccountOverlapsFilters, "calendar account control should not overlap the date and impact filters");
        assert(await page.locator(".calendarNextEvent > div").count() === 4, "calendar next event should keep date, event, forecast and previous value");
        assert(await page.locator(".calendarMacroTimeline article").count() <= 8, "calendar should keep the expanded core timeline concise");
        const conclusion = page.locator(".calendarMacroConclusion");
        for (const [tab, headline, meaning] of [
          ["CPI", "低于预期", "通胀更低"],
          ["非农", "低于预期", "就业降温"],
          ["FOMC", "利率不变", "借钱成本没有变化"],
        ]) {
          await page.getByRole("tab", { name: tab, exact: true }).click();
          assert(await conclusion.count() === 1, `calendar should show one conclusion for ${tab}`);
          const conclusionText = await conclusion.innerText();
          assert(conclusionText.includes("最近结论"), "calendar conclusion should identify the latest published result");
          assert(conclusionText.includes(headline) && conclusionText.includes(meaning), `calendar should show the verified ${tab} conclusion`);
        }
        assert(await page.locator(".calendarEarningsPreview article").count() <= 3, "calendar should keep the default earnings preview concise");
        const calendarSectionOrder = await page.evaluate(() => {
          const macro = document.querySelector(".calendarCoreMacro");
          const earnings = document.querySelector(".calendarEarningsSection");
          return Boolean(macro && earnings && (macro.compareDocumentPosition(earnings) & Node.DOCUMENT_POSITION_FOLLOWING));
        });
        assert(calendarSectionOrder, "macro events should remain above the earnings calendar");
        const earningsAction = page.locator(".calendarEarningsSection .calendarSectionAction");
        assert(await earningsAction.count() === 1, "calendar should offer the complete earnings calendar on demand");
        await earningsAction.click();
        await page.waitForFunction(() => document.querySelector(".calendarEarningsSection h2")?.textContent?.includes("财报日历"));
        assert(await page.locator(".calendarEarningsTable, .calendarEarningsSection .calendarState").count() === 1, "calendar should reveal the complete earnings calendar or its empty state on demand");
        assert(await page.locator(".calendarPager").count() === 1, "calendar should paginate the complete earnings table");
        assert(!(await page.locator("body").innerText()).includes("优先看利率、通胀、就业"), "calendar should remove explanatory filler");
        assert(!(await page.locator("body").innerText()).includes("下一次公布 · 历史变化"), "calendar should remove redundant core macro helper copy");
        assert(!(await page.locator("body").innerText()).includes("按日期排列"), "calendar should remove redundant earnings helper copy");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-calendar-desktop.png`, fullPage: true });

        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(200);
        assert(!(await page.locator(".calendarTableHead").first().isVisible()), "mobile calendar should hide desktop table headings");
        const mobileEventContext = page.locator(".calendarMobileMeta").first();
        if (await mobileEventContext.count()) {
          assert(await mobileEventContext.isVisible(), "mobile calendar should show compact event context");
        } else {
          assert(await page.locator(".calendarEarningsSection .calendarState").isVisible(), "mobile calendar should show an honest empty state when no earnings are scheduled");
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile calendar should not overflow horizontally");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-calendar-mobile.png`, fullPage: true });

        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`${server.rootUrl}?page=risk`, { waitUntil: "networkidle" });
        const temperatureHelp = page.locator(".temperatureScoreLabel .infoTip");
        await temperatureHelp.hover();
        assert(await temperatureHelp.locator(".infoTipBubble").isVisible(), "temperature help should appear immediately on hover");
        const temperatureHelpText = await temperatureHelp.locator(".infoTipBubble").innerText();
        assert(temperatureHelpText.includes("分数越高，市场整体越强"), "temperature help should explain the score directly");
        assert(temperatureHelpText.includes("不代表未来一定上涨或下跌"), "temperature help should state the indicator boundary");
        assert(await page.locator(".temperatureAdvice").count() === 1, "temperature score should show one concise action");
        const temperatureAdvice = await page.locator(".temperatureAdvice").innerText();
        assert(["市场较强，可重点观察强势股", "方向不清，等待走势确认", "风险较高，少追涨、控仓位", "数据更新中"].includes(temperatureAdvice), "temperature action should use the approved plain-language copy");

        await page.setViewportSize({ width: 390, height: 844 });
        await temperatureHelp.click();
        assert(await temperatureHelp.locator(".infoTipBubble").isVisible(), "temperature help should open on mobile tap");
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile temperature page should not overflow horizontally");

        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`${server.rootUrl}?page=market`, { waitUntil: "networkidle" });
        assert(await page.locator(".marketPageV3 > h1, .marketPageHeadV3").count() === 0, "market page should not repeat the navigation label");
        assert(await page.locator(".marketSegmentV3 button.active", { hasText: "热力图" }).count() === 1, "market page should open with the heatmap");
        const firstHeatTile = page.locator(".marketHeatmapV3 > button").first();
        await firstHeatTile.hover();
        const heatTooltip = page.locator(".marketHeatTooltipV3");
        await heatTooltip.waitFor();
        assert((await heatTooltip.innerText()).includes("均涨跌"), "market heatmap should show the average change immediately");
        assert((await heatTooltip.innerText()).includes("资金方向"), "market heatmap should show the fund direction immediately");
        assert(await page.locator(".marketHeatmapV3 > button[title]").count() === 0, "market heatmap should not use delayed native tooltips");
        assert(!(await page.locator(".marketLeadersV3").innerText()).match(/\b\d{8,}\b/), "market leaders should format raw liquidity values");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-market-desktop.png`, fullPage: true });

        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(200);
        const marketControlRows = await page.locator(".marketToolGroupV3").evaluateAll((elements) => elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        }));
        assert(marketControlRows.length === 2 && marketControlRows[0].bottom <= marketControlRows[1].top, "mobile market controls should not overlap");
        assert(await page.locator(".marketVolumeMobileV3").isVisible(), "mobile market page should use compact volume rows");
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile market page should not overflow horizontally");
        await page.getByRole("button", { name: "排行", exact: true }).click();
        assert(await page.locator(".marketRankMobileV3").isVisible(), "mobile market ranking should use compact rows");
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile market ranking should not overflow horizontally");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-market-rank-mobile.png`, fullPage: true });
        await page.getByRole("button", { name: "热力图", exact: true }).click();
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-market-mobile.png`, fullPage: true });

        await page.goto(`${server.rootUrl}?page=strength`, { waitUntil: "networkidle" });
        const strengthTabs = page.locator(".strengthListHead .marketToolTabs button");
        assert(await strengthTabs.count() === 4, "strength page should show three focused lists and all stocks");
        const allStocksTab = page.locator(".strengthListHead .marketToolTabs button", { hasText: "全部股票" });
        assert(await allStocksTab.count() === 1, "strength page should show one all-stocks tab");
        await Promise.all([
          page.waitForResponse((response) => response.url().includes("/api/product/strength?") && response.url().includes("bucket=all")),
          allStocksTab.click(),
        ]);
        await page.waitForFunction(() => document.querySelector(".strengthTable")?.getAttribute("aria-busy") === "false");
        assert((await page.locator(".strengthPagination").innerText()).includes("共"), "all-stocks view should show server-side pagination");
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`${server.rootUrl}?page=position`, { waitUntil: "networkidle" });
        await page.getByTestId("position-account").fill("10000");
        await page.getByTestId("position-risk").fill("1");
        assert((await page.locator(".positionDerivedRisk").innerText()).includes("$100.00"), "risk amount should derive from account size and risk percent");
        await page.getByTestId("position-account").fill("20000");
        assert((await page.locator(".positionDerivedRisk").innerText()).includes("$200.00"), "risk amount should update when account size changes");
        await page.getByTestId("position-account").fill("10000");
        await page.getByTestId("position-entry").fill("100");
        await page.getByTestId("position-stop").fill("99.5");
        assert((await page.getByTestId("position-result-shares").innerText()).includes("100"), "cash cap should lower the suggested shares to 100");
        assert((await page.getByTestId("position-warnings").innerText()).includes("已按账户资金下调"), "cash cap should explain why the result was lowered");
        await page.getByTestId("position-save").click();
        assert(await page.locator(".positionHistoryTable tbody tr").count() === 1, "saving a valid plan should add one history row");
        await page.locator(".positionHistoryDelete").click();
        assert((await page.locator(".positionHistoryEmpty").innerText()).includes("暂无最近计算"), "deleting a history row should restore the empty state");
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "desktop position page should not overflow horizontally");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-position-desktop.png`, fullPage: true });

        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${server.rootUrl}?page=position`, { waitUntil: "networkidle" });
        await page.getByTestId("position-entry").fill("100");
        await page.getByTestId("position-stop").fill("95");
        assert(await page.locator(".positionMobileResult").isVisible(), "mobile position result should stay visible");
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile position page should not overflow horizontally");
        if (process.env.MOBILE_QA_SCREENSHOT_PREFIX) await page.screenshot({ path: `${process.env.MOBILE_QA_SCREENSHOT_PREFIX}-position-mobile.png`, fullPage: true });

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
        assert(primaryLabels.join("|") === "首页|猫言猫语|重点财经前瞻|机会跟踪榜单|美股行情|市场资金走向|市场活跃指数|行业板块强弱|指数估值|实战课程|自选|纳指定投 1 号|纳指定投 2 号", `mobile primary navigation is incorrect: ${primaryLabels.join("|")}`);
        const memberToolLabels = await page.locator(".navToolGroup", { hasText: "会员工具" }).locator("button span").allTextContents();
        assert(memberToolLabels.join("|") === "以损定仓|滚仓工具", `mobile member-tool navigation is incorrect: ${memberToolLabels.join("|")}`);
        assert(await page.locator(".sideRail", { hasText: "工具数据" }).count() === 0, "mobile navigation should not separate market pages into a tool-data group");
        assert(await page.locator(".sideRail", { hasText: "实战课程" }).count() === 1, "courses should appear in mobile navigation");
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

console.log(`Next/root permission regression passed (${selectedScenarios.length * 2} checks).`);

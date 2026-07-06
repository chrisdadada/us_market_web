import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mockRoot = join(root, "mockups");
const outputDir = join(mockRoot, "output");

const mockups = {
  index: { file: "index.html", name: "mockup-index" },
  "trend-signals": { file: "trend-signals-paywall.html", name: "trend-signals" },
  "stock-library": { file: "stock-library-terminal.html", name: "stock-library" },
  "strength-tracking": { file: "strength-tracking-redesign.html", name: "strength-tracking" },
  "stock-workbench": { file: "stock-workbench-terminal.html", name: "stock-workbench" },
  "founder-insights": { file: "founder-insights-delivery.html", name: "founder-insights" },
  "live-portfolio": { file: "live-portfolio-redesign.html", name: "live-portfolio" },
  "trade-journal": { file: "trade-journal-detail.html", name: "trade-journal" },
  "us-opportunities": { file: "us-opportunities-center.html", name: "us-opportunities" },
  "research-opinion": { file: "research-opinion-module.html", name: "research-opinion" },
  "market-opinion": { file: "market-opinion-center.html", name: "market-opinion" },
  "market-opinion-real": { file: "market-opinion-real-content.html", name: "market-opinion-real" },
  "weekly-theme": { file: "weekly-market-theme-detail.html", name: "weekly-theme" },
  "daily-opinion": { file: "daily-market-opinion-column.html", name: "daily-opinion" },
};

const viewports = [
  { name: "desktop", width: 1440, height: 1200 },
  { name: "mobile", width: 390, height: 1200, isMobile: true },
];

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
]);

function listMockups() {
  console.log("Available mockups:");
  Object.entries(mockups).forEach(([key, value]) => {
    console.log(`- ${key}: mockups/${value.file}`);
  });
}

function startServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = normalize(join(mockRoot, requestedPath));

    if (!filePath.startsWith(mockRoot)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes.get(extname(filePath)) || "application/octet-stream",
    });
    createReadStream(filePath)
      .on("error", () => {
        if (!response.headersSent) response.writeHead(404);
        response.end("Not found");
      })
      .pipe(response);
  });

  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolveServer({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

async function launchBrowser() {
  const shared = { headless: true };
  try {
    return await chromium.launch({ ...shared, channel: "chrome" });
  } catch {
    const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    try {
      return await chromium.launch({ ...shared, executablePath: chromePath, args: ["--no-sandbox"] });
    } catch {
      return chromium.launch(shared);
    }
  }
}

async function qaPage(page, key, viewportName) {
  const result = await page.evaluate(() => ({
    title: document.title,
    textLength: document.body.innerText.trim().length,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));

  if (!result.title) throw new Error(`${key}/${viewportName}: missing title`);
  if (result.textLength < 80) throw new Error(`${key}/${viewportName}: page looks empty`);
  if (result.scrollWidth > result.clientWidth + 2) {
    throw new Error(`${key}/${viewportName}: horizontal overflow ${result.scrollWidth - result.clientWidth}px`);
  }
  return result;
}

async function captureOne(browser, serverUrl, key, config) {
  for (const viewport of viewports) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: Boolean(viewport.isMobile),
      deviceScaleFactor: 1,
    });
    const url = `${serverUrl}/${config.file}`;
    await page.goto(url, { waitUntil: "load", timeout: 15000 });
    await page.screenshot({
      path: join(outputDir, `${config.name}-${viewport.name}.png`),
      fullPage: true,
    });
    const qa = await qaPage(page, key, viewport.name);
    console.log(`${key}/${viewport.name}: ${qa.title} (${qa.clientWidth}x${qa.scrollHeight})`);
    await page.close();
  }
}

async function run() {
  const target = process.argv[2] || "list";
  if (target === "list" || target === "--list") {
    listMockups();
    return;
  }

  const keys = target === "all" ? Object.keys(mockups) : [target];
  const missing = keys.filter((key) => !mockups[key]);
  if (missing.length) {
    listMockups();
    throw new Error(`Unknown mockup: ${missing.join(", ")}`);
  }

  await mkdir(outputDir, { recursive: true });
  const server = await startServer();
  const browser = await launchBrowser();

  try {
    for (const key of keys) {
      await captureOne(browser, server.url, key, mockups[key]);
    }
  } finally {
    await browser.close();
    await server.close();
  }

  console.log(`Screenshots written to ${outputDir}`);
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
MAIN_APP = (ROOT / "main-web/src/App.tsx").read_text(encoding="utf-8")
MAIN_ENTRY = (ROOT / "main-web/src/main.tsx").read_text(encoding="utf-8")
MAIN_HTML = (ROOT / "main-web/index.html").read_text(encoding="utf-8")
MAIN_STYLES = (ROOT / "main-web/src/styles.css").read_text(encoding="utf-8")
ADMIN_APP = (ROOT / "admin-web/src/App.tsx").read_text(encoding="utf-8")
CALENDAR_STYLES = (ROOT / "main-web/src/calendar.css").read_text(encoding="utf-8")
STOCKS_STYLES = (ROOT / "main-web/src/stocks.css").read_text(encoding="utf-8")
MARKET_FUNDS_STYLES = (ROOT / "main-web/src/marketFunds.css").read_text(encoding="utf-8")
TRACKING_STYLES = (ROOT / "main-web/src/tracking.css").read_text(encoding="utf-8")
PRODUCT_CONFIG = (ROOT / "main-web/src/productConfig.ts").read_text(encoding="utf-8")
ROLLING_TOOL = (ROOT / "main-web/src/RollingToolPage.tsx").read_text(encoding="utf-8")
DEPLOY = (ROOT / "scripts/deploy_dev.sh").read_text(encoding="utf-8")

LEGACY_MIGRATION_ROUTES = {
    "/legacy/#options",
    "/legacy/#signals",
    "/legacy/#stock-events",
    "/legacy/#earnings",
}
LEGACY_FILES = ("index.html", "admin.html", "app.js", "styles.css")


class FrontendArchitectureTest(unittest.TestCase):
    def test_admin_logout_failure_is_visible_and_not_repeated(self) -> None:
        self.assertIn("disabled={logoutPending}", ADMIN_APP)
        self.assertIn('{logoutPending ? "退出中" : "退出"}', ADMIN_APP)
        self.assertIn('setError(err instanceof Error ? err.message : "退出失败，请重试")', ADMIN_APP)

    def test_position_quote_failure_is_not_reported_as_missing_data(self) -> None:
        self.assertIn('setPriceStatus("行情暂时不可用")', MAIN_APP)

    def test_admin_auth_failure_does_not_look_signed_out(self) -> None:
        self.assertIn('className="loginPage adminAuthStatusError"', ADMIN_APP)
        self.assertIn("后台暂时无法连接", ADMIN_APP)
        self.assertIn("setAuthRetry((value) => value + 1)", ADMIN_APP)

    def test_white_frontend_has_one_source_of_truth(self) -> None:
        self.assertIn('import "./styles.css"', MAIN_ENTRY)
        self.assertIn('import "./calendar.css"', MAIN_ENTRY)
        self.assertIn('import "./stocks.css"', MAIN_ENTRY)
        self.assertIn('import "./marketFunds.css"', MAIN_ENTRY)
        self.assertIn('import "./tracking.css"', MAIN_ENTRY)
        self.assertIn('import "./article.css"', MAIN_ENTRY)
        self.assertNotIn("/legacy/", MAIN_ENTRY)
        self.assertNotIn("app.js", MAIN_HTML)
        self.assertNotIn("styles.css", MAIN_HTML)

    def test_product_navigation_has_one_source_of_truth(self) -> None:
        self.assertIn('from "./productConfig"', MAIN_APP)
        self.assertNotIn("const pageLabels", MAIN_APP)
        block = re.search(r"primaryNavItems: NavItem\[\] = \[(.*?)\];", PRODUCT_CONFIG, re.S)
        self.assertIsNotNone(block)
        keys = re.findall(r'key: "([^"]+)"', block.group(1))
        self.assertEqual(keys, [
            "home", "opinions", "calendar", "tracking", "stocks", "market", "risk",
            "strength", "valuation", "courses", "watchlist", "dca1", "dca2",
        ])

    def test_only_the_explicit_migration_list_can_open_legacy(self) -> None:
        references: dict[str, list[str]] = {}
        for path in (ROOT / "main-web/src").rglob("*"):
            if path.suffix not in {".ts", ".tsx", ".css"}:
                continue
            matches = re.findall(r'/legacy/[^"\'\s)]+', path.read_text(encoding="utf-8"))
            if matches:
                references[str(path.relative_to(ROOT))] = sorted(matches)
        self.assertEqual(references, {"main-web/src/productConfig.ts": sorted(LEGACY_MIGRATION_ROUTES)})

    def test_legacy_is_isolated_from_the_default_dev_site(self) -> None:
        self.assertIn('cp -a "${next_root}/main-web/dist/." "${next_web}/"', DEPLOY)
        self.assertIn('"${next_web}/legacy"', DEPLOY)
        self.assertNotIn("cp -a /opt/dongbimao-dev/index.html /var/www/dongbimao-dev/", DEPLOY)

    def test_legacy_files_must_disappear_when_the_migration_list_is_empty(self) -> None:
        if LEGACY_MIGRATION_ROUTES:
            for filename in LEGACY_FILES:
                self.assertTrue((ROOT / filename).is_file(), filename)
            return
        for filename in LEGACY_FILES:
            self.assertFalse((ROOT / filename).exists(), filename)
        self.assertNotIn("/legacy", DEPLOY)

    def test_calendar_starts_with_the_user_task_instead_of_a_duplicate_heading(self) -> None:
        self.assertNotIn('className="calendarFilters"', MAIN_APP)
        self.assertNotIn('className="calendarCoreHead"', MAIN_APP)
        self.assertNotIn('className="calendarCoreTitle"', MAIN_APP)
        self.assertIn('className="calendarCoreToolbar"', MAIN_APP)
        self.assertIn('"近期高影响财报"', MAIN_APP)
        self.assertIn(".calendarV3 .calendarCoreToolbar", CALENDAR_STYLES)
        self.assertNotRegex(MAIN_STYLES, r"\.calendar[A-Za-z0-9_-]*")
        self.assertIn("@keyframes calendarLoading", CALENDAR_STYLES)

    def test_homepage_keeps_macro_events_separate_from_earnings(self) -> None:
        self.assertIn('className="frontHomeMarketStrip"', MAIN_APP)
        self.assertIn('type: "macro"', MAIN_APP)
        self.assertIn('type: "earnings"', MAIN_APP)
        self.assertIn('const macroEvent = eventRows.find((item) => item.type === "macro")', MAIN_APP)
        self.assertIn('const earningsRows = eventRows.filter((item) => item.type === "earnings")', MAIN_APP)
        self.assertIn('.filter((item) => isFutureOrToday(item.date))', MAIN_APP)
        self.assertIn('const marketSignalCount = Number(hasMacroSignal)', MAIN_APP)
        self.assertNotIn('api.dcaStrategies()', MAIN_APP)

    def test_global_search_only_promises_supported_stock_code_search(self) -> None:
        self.assertNotIn("搜索股票、观点、财报、页面", MAIN_APP)
        self.assertGreaterEqual(MAIN_APP.count('placeholder="搜索股票代码"'), 2)

    def test_rolling_tool_uses_server_plans_and_stays_yearly_gated(self) -> None:
        self.assertIn('rolling: "滚仓工具"', PRODUCT_CONFIG)
        self.assertRegex(PRODUCT_CONFIG, r'rolling:\s*\{\s*level: "yearly"')
        self.assertIn('{ key: "rolling", label: pageLabels.rolling }', PRODUCT_CONFIG)
        self.assertIn('page === "rolling" && pageUnlocked ? <RollingToolPage />', MAIN_APP)
        self.assertIn('from "./vendor/rolling-pro/rolling-simulator.mjs"', ROLLING_TOOL)
        self.assertIn("normalizePlan({", ROLLING_TOOL)
        self.assertIn("api.rollingPlans()", ROLLING_TOOL)
        self.assertIn("api.createRollingPlan(input)", ROLLING_TOOL)
        self.assertIn('className={`rollingInlineQuote', ROLLING_TOOL)
        self.assertIn("计划摘要", ROLLING_TOOL)
        self.assertIn("历史计划", ROLLING_TOOL)
        self.assertIn("历史结果", ROLLING_TOOL)
        self.assertIn("最终盈亏", ROLLING_TOOL)
        self.assertIn("全部触发后", ROLLING_TOOL)
        self.assertIn("预计占用保证金", ROLLING_TOOL)
        self.assertNotIn("rollingAutoCalc", ROLLING_TOOL)
        self.assertNotIn("最大投入", ROLLING_TOOL)
        self.assertNotIn('<h1>滚仓工具</h1>', ROLLING_TOOL)
        self.assertNotIn('className="rollingMarketBar"', ROLLING_TOOL)
        self.assertNotIn("导出", ROLLING_TOOL)
        for forbidden in ("api_key", "api_secret", "exchange_credentials", "raw_order_payloads"):
            self.assertNotIn(forbidden, ROLLING_TOOL)

    def test_tracking_page_does_not_publish_hardcoded_new_symbols(self) -> None:
        self.assertNotIn("trackingAddedSymbols", MAIN_APP)
        self.assertNotIn("本次新增", MAIN_APP)
        self.assertIn('className="trackingDataAsOf"', MAIN_APP)

    def test_stock_library_styles_have_one_owner(self) -> None:
        self.assertNotRegex(MAIN_STYLES, r"\.(?:stocksPage|stockLibrary[A-Za-z0-9_-]*)")
        self.assertIn(".stocksPage", STOCKS_STYLES)
        self.assertIn(".stockLibraryWorkbench", STOCKS_STYLES)
        self.assertIn('["mag7", "科技七姐妹"]', MAIN_APP)
        self.assertIn('stockSortHeader("ytdChange", "年初至今")', MAIN_APP)
        self.assertNotIn(".stocksWorkbench", MAIN_STYLES)
        self.assertNotIn(".stocksWorkbench", STOCKS_STYLES)

    def test_market_funds_styles_have_one_owner(self) -> None:
        self.assertNotRegex(
            MAIN_STYLES,
            r"\.(?:market[A-Za-z0-9_-]*V3|marketViewTabs|cryptoEtf[A-Za-z0-9_-]*)",
        )
        self.assertIn(".marketPageV3", MARKET_FUNDS_STYLES)
        self.assertIn(".marketHeatmapV3", MARKET_FUNDS_STYLES)
        self.assertIn(".marketViewTabs", MARKET_FUNDS_STYLES)
        self.assertIn(".cryptoEtfView", MARKET_FUNDS_STYLES)

    def test_tracking_empty_state_hides_internal_data_thresholds(self) -> None:
        self.assertNotIn("历史数据不足", MAIN_APP)
        self.assertNotIn("个交易日后自动计算", MAIN_APP)

    def test_stock_detail_has_one_shared_compact_source(self) -> None:
        self.assertIn("function StockDetailPage(", MAIN_APP)
        self.assertNotIn("function TrackingStockDetailPage(", MAIN_APP)
        self.assertNotIn("function StockPreviewPanel(", MAIN_APP)
        self.assertIn("stockSource: StockSource", MAIN_APP)
        self.assertIn('onOpenStock(item.symbol, "watchlist")', MAIN_APP)
        self.assertIn('className="trackingDetailQuote"', MAIN_APP)
        self.assertIn("trackingDetailDecision ${keyLevels.position", MAIN_APP)
        self.assertIn('className="trackingDetailBottom"', MAIN_APP)
        self.assertNotRegex(MAIN_STYLES, r"\.(?:tracking[A-Za-z0-9_-]*|chartGridLine|chartPriceLabel|resistanceZone|supportZone|currentPriceLine|currentPriceDot|currentPriceLabel|chartDateLabel|levelStrength)")
        self.assertEqual(len(re.findall(r"^\.trackingDetailPage \{", TRACKING_STYLES, re.MULTILINE)), 1)
        for legacy_selector in (
            ".trackingStockDetailPage",
            ".trackingStockHero",
            ".trackingStockHead",
            ".trackingStockMetrics",
            ".trackingStockPanel",
            ".trackingKeyLevelsPanel",
        ):
            self.assertNotIn(legacy_selector, TRACKING_STYLES)
        for legacy_selector in (
            ".stocksTerminalLayout",
            ".stocksPreviewPanel",
            ".stockPreviewOverlay",
            ".stockPreviewDrawer",
        ):
            self.assertNotIn(legacy_selector, TRACKING_STYLES)
        self.assertNotIn("趋势策略方向为", MAIN_APP)


if __name__ == "__main__":
    unittest.main()

const PRODUCT_API_BASE = "/api/product";
const WATCHLIST_STORAGE_KEY = "meigu_strategy_watchlist_v1";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "meigu_strategy_sidebar_collapsed_v1";
const GLOBAL_SEARCH_LIMIT = 12;
const PRODUCT_SYMBOL_LIMIT = 3000;
const STOCK_LIBRARY_DISPLAY_LIMIT = 360;
const STOCK_LIQUID_DOLLAR_VOLUME_MIN = 5_000_000;

const state = {
  activeBoard: "ytd",
  boards: {},
  core: null,
  strength: null,
  strengthReview: null,
  sectorFlow: null,
  strengthBucket: "strongest",
  strengthQuery: "",
  strengthLabelFilter: "all",
  strengthFactorFilter: "all",
  earningsQuality: null,
  marketTemperature: null,
  macroSeries: null,
  macroSeriesRange: "1y",
  indexValuation: null,
  optionsFlow: null,
  valuationIndex: "QQQ",
  valuationMetric: "pe",
  valuationRange: "3m",
  eventOpportunities: null,
  eventsCalendar: null,
  calendarEarningsQuery: "",
  calendarEarningsWindow: "45",
  calendarEarningsImpact: "all",
  validationCenter: null,
  loading: {},
  qualityBoard: "quality",
  qualityQuery: "",
  selectedQualitySymbol: "",
  eventBoard: "all",
  eventQuery: "",
  eventScoreFilter: "all",
  eventRiskFilter: "all",
  eventStyleFilter: "all",
  selectedEventSymbol: "",
  meta: {},
  rows: [],
  query: "",
  capFilter: "all",
  sectorFilter: "all",
  directionFilter: "all",
  riskFilter: "all",
  macroFilter: "all",
  marketVisualMode: "overview",
  auth: {
    authenticated: false,
    user: null,
    entitlements: { paid: false, pro: false, proPlus: false, admin: false },
  },
  adminUsers: [],
  adminPerformance: [],
  adminSummary: null,
  signals: null,
  selectedSignalSymbol: "",
  selectedMarketSymbol: "",
  selectedMarketSector: "",
  selectedStockSymbol: "",
  stockBackPage: "market",
  watchlist: [],
  watchlistQuery: "",
  watchlistViewFilter: "all",
  watchlistSourceFilter: "all",
  globalSearchQuery: "",
  globalSearchIndex: -1,
  searchUniverse: null,
  productMeta: null,
  productCoverage: null,
  productSymbols: null,
  productStockLibrary: null,
  productSectors: null,
  productCalendar: null,
  productStockDetails: {},
  globalSearchStocks: null,
  stocksQuery: "",
  stocksPresetFilter: "all",
  stocksSectorFilter: "all",
  stocksCapFilter: "all",
  stocksSort: "dollarVolume",
  marketWorkspaceSection: "movers",
};

const escapeHtml = (value) =>
  String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const setText = (selector, value) => {
  const element = document.querySelector(selector);
  if (element && value !== undefined && value !== null) {
    element.textContent = value;
  }
};

const neutralCopy = (value) =>
  String(value || "")
    .replace(/可以关注/g, "可观察")
    .replace(/适合提高/g, "可提高")
    .replace(/适合保留/g, "可保留")
    .replace(/更适合控制/g, "更偏向控制")
    .replace(/只看/g, "仅看");

const compactText = (value, maxLength = 140) => {
  const text = String(value || "")
    .replace(/\*\*/g, "")
    .replace(/[`#>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
};

const apiFetch = async (url, options = {}) => {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "请求失败");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
};

const fetchOptionalJson = async (url) => {
  const response = await fetch(url).catch(() => null);
  if (!response || !response.ok) return null;
  return response.json().catch(() => null);
};

const productApiJson = (path) => fetchOptionalJson(`${PRODUCT_API_BASE}${path}`);

const normalizeProductSymbolRow = (row = {}) => {
  const symbol = normalizeStockSymbol(row.symbol);
  const marketCap = row.marketCap || row.marketCapLabel || "";
  return {
    ...row,
    symbol,
    ticker: symbol,
    name: row.company || row.chineseName || row.name || "",
    company: row.company || row.name || "",
    chineseName: row.chineseName || "",
    sector: sectorDisplayName(row.sector),
    marketCap,
    marketCapValue: row.marketCapValue,
    price: row.price,
    dollarVolume: Number(row.dollarVolume || 0),
    volumeRatio: row.volumeRatio || "",
    dayChange: row.dayChange == null ? null : Number(row.dayChange),
    weekChange: row.weekChange == null ? null : Number(row.weekChange),
    monthChange: row.monthChange == null ? null : Number(row.monthChange),
    ytdChange: row.ytdChange == null ? null : Number(row.ytdChange),
    eventLabel: row.eventLabel || "",
    eventDate: row.eventDate || "",
    hasEvent: Boolean(row.hasEvent),
    qualityLabel: row.qualityLabel || "",
    qualityScore: row.qualityScore == null ? null : Number(row.qualityScore),
    strengthLabel: row.strengthLabel || "",
    strengthScore: row.strengthScore == null ? null : Number(row.strengthScore),
    sources: [...new Set([...(row.sources || []), "产品库"])],
  };
};

const normalizeProductMarketRow = (row = {}) => ({
  ...row,
  symbol: normalizeStockSymbol(row.symbol),
  company: row.company || row.name || "",
  chineseName: row.chineseName || "",
  sector: sectorDisplayName(row.sector),
  change: Number(row.changePct),
  changeYtd: Number(row.changePct),
  price: row.price,
  volume: row.volume,
  dollarVolume: Number(row.dollarVolume || 0),
  volumeRatio: row.volumeRatio || "",
  marketCap: row.marketCap || "",
  risk: row.risk || "按行情和成交额复盘",
  actionNote: row.actionNote || "",
});

const normalizeProductStrengthRow = (row = {}) => ({
  ...row,
  symbol: normalizeStockSymbol(row.symbol),
  name: row.company || row.name || "",
  sectorProxy: sectorDisplayName(row.sector),
  periods: row.periods || {},
  relative: row.relative || {},
  crowding: {
    volumeRatio: row.volumeRatio || row.liquidity || "",
  },
  liquidity: row.liquidity || row.marketCap || "",
});

const normalizeProductQualityRow = (row = {}) => ({
  ...row,
  ticker: normalizeStockSymbol(row.symbol || row.ticker),
  symbol: normalizeStockSymbol(row.symbol || row.ticker),
  companyName: row.companyName || row.company || "",
  avgPriceTargetUpsidePct: row.priceTargetUpsidePct ?? row.avgPriceTargetUpsidePct,
});

const normalizeProductEventRow = (row = {}) => ({
  ...row,
  ticker: normalizeStockSymbol(row.symbol || row.ticker),
  symbol: normalizeStockSymbol(row.symbol || row.ticker),
  companyName: row.companyName || row.company || "",
});

const normalizeProductSectorRow = (row = {}) => ({
  ...row,
  sector: sectorDisplayName(row.sector),
  count: Number(row.count || row.stock_count || 0),
  upCount: Number(row.upCount || row.up_count || 0),
  downCount: Number(row.downCount || row.down_count || 0),
  breadthPct: Number(row.breadthPct ?? row.breadth_pct ?? 0),
  avgChange: Number(row.avgChangePct ?? row.avgChange ?? row.avg_change_pct ?? 0),
  activeValue: Number(row.activeValue ?? row.active_value ?? 0),
  netFlowProxy: Number(row.netFlowProxy ?? row.net_flow_proxy ?? 0),
  netFlowLabel: formatSignedCompactMoney(row.netFlowProxy ?? row.net_flow_proxy ?? 0),
  activeValueLabel: formatCompactMoney(row.activeValue ?? row.active_value ?? 0),
  status: row.status || "板块资金观察",
  leaders: (row.leaders || []).map((leader) => ({
    ...leader,
    symbol: normalizeStockSymbol(leader.symbol || leader.ticker),
    change: Number(leader.changePct ?? leader.change ?? 0),
    liquidity: leader.liquidity || leader.volumeRatio || "",
    marketCap: leader.marketCap || "",
  })),
});

const normalizeProductCalendarRow = (row = {}) => ({
  id: row.id || row.eventId || row.event_id,
  date: row.date || row.eventDate || row.event_date,
  time: row.time || row.eventTime || row.event_time || "",
  title: row.title || "--",
  type: row.type || row.eventType || row.event_type || "macro",
  impact: row.impact || "medium",
  sourceName: row.sourceName || row.source_name || "",
  relatedModules: row.relatedModules || row.related_modules || [],
  relatedAssets: row.relatedAssets || row.related_assets || [],
  summary: row.summary || "",
});

const loadProductMeta = () => {
  if (state.productMeta) return Promise.resolve(state.productMeta);
  if (state.loading.productMeta) return state.loading.productMeta;
  state.loading.productMeta = productApiJson("/health")
    .then((payload) => {
      state.productMeta = payload || null;
      return state.productMeta;
    })
    .catch((error) => {
      console.warn("Product metadata unavailable", error);
      state.productMeta = null;
      return null;
    })
    .finally(() => {
      delete state.loading.productMeta;
    });
  return state.loading.productMeta;
};

const loadProductCoverage = () => {
  if (state.productCoverage) return Promise.resolve(state.productCoverage);
  if (state.loading.productCoverage) return state.loading.productCoverage;
  state.loading.productCoverage = productApiJson("/coverage")
    .then((payload) => {
      state.productCoverage = payload || null;
      renderDataStatus();
      return state.productCoverage;
    })
    .catch((error) => {
      console.warn("Product coverage unavailable", error);
      state.productCoverage = null;
      return null;
    })
    .finally(() => {
      delete state.loading.productCoverage;
    });
  return state.loading.productCoverage;
};

const loadProductSymbols = () => {
  if (state.productSymbols) return Promise.resolve(state.productSymbols);
  if (state.loading.productSymbols) return state.loading.productSymbols;
  state.loading.productSymbols = productApiJson(`/symbols?limit=${PRODUCT_SYMBOL_LIMIT}`)
    .then((payload) => {
      const rows = Array.isArray(payload?.rows) ? payload.rows.map(normalizeProductSymbolRow) : null;
      state.productSymbols = rows;
      if (rows?.length) {
        state.searchUniverse = rows;
      }
      return rows || [];
    })
    .catch((error) => {
      console.warn("Product symbols unavailable", error);
      state.productSymbols = null;
      return [];
    })
    .finally(() => {
      delete state.loading.productSymbols;
    });
  return state.loading.productSymbols;
};

const stockLibraryApiKey = () => [
  state.stocksQuery.trim(),
  state.stocksPresetFilter,
  state.stocksSectorFilter,
  state.stocksCapFilter,
  state.stocksSort,
  watchlistSignature(),
].join("|");

const stockLibraryApiPath = () => {
  const params = new URLSearchParams();
  params.set("limit", String(STOCK_LIBRARY_DISPLAY_LIMIT));
  params.set("offset", "0");
  params.set("sort", state.stocksSort || "dollarVolume");
  const query = state.stocksQuery.trim();
  if (query) params.set("query", query);
  if (state.stocksPresetFilter && state.stocksPresetFilter !== "all") params.set("preset", state.stocksPresetFilter);
  if (state.stocksSectorFilter && state.stocksSectorFilter !== "all") params.set("sector", state.stocksSectorFilter);
  if (state.stocksCapFilter && state.stocksCapFilter !== "all") params.set("cap", state.stocksCapFilter);
  if (state.stocksPresetFilter === "watchlist") {
    params.set("watchlist", watchlistSignature());
  }
  return `/symbols?${params.toString()}`;
};

const loadProductStockLibrary = () => {
  const key = stockLibraryApiKey();
  if (state.productStockLibrary?.key === key) return Promise.resolve(state.productStockLibrary);
  if (state.loading.productStockLibrary?.key === key) return state.loading.productStockLibrary.promise;
  const promise = productApiJson(stockLibraryApiPath())
    .then((payload) => {
      const rows = Array.isArray(payload?.rows) ? payload.rows.map(normalizeProductSymbolRow) : [];
      state.productStockLibrary = {
        key,
        rows,
        total: Number(payload?.total || rows.length || 0),
        limit: Number(payload?.limit || STOCK_LIBRARY_DISPLAY_LIMIT),
        offset: Number(payload?.offset || 0),
        ok: Boolean(payload),
      };
      return state.productStockLibrary;
    })
    .catch((error) => {
      console.warn("Product stock library unavailable", error);
      state.productStockLibrary = { key, rows: [], total: 0, limit: STOCK_LIBRARY_DISPLAY_LIMIT, offset: 0, ok: false };
      return state.productStockLibrary;
    })
    .finally(() => {
      if (state.loading.productStockLibrary?.key === key) delete state.loading.productStockLibrary;
    });
  state.loading.productStockLibrary = { key, promise };
  return promise;
};

const loadGlobalStockSearch = (query) => {
  const clean = String(query || "").trim();
  const key = clean.toLowerCase();
  if (!clean) return Promise.resolve({ key, rows: [], ok: true });
  if (state.globalSearchStocks?.key === key) return Promise.resolve(state.globalSearchStocks);
  if (state.loading.globalSearchStocks?.key === key) return state.loading.globalSearchStocks.promise;
  const params = new URLSearchParams();
  params.set("query", clean);
  params.set("limit", String(GLOBAL_SEARCH_LIMIT));
  params.set("sort", "dollarVolume");
  const promise = productApiJson(`/symbols?${params.toString()}`)
    .then((payload) => {
      const rows = Array.isArray(payload?.rows) ? payload.rows.map(normalizeProductSymbolRow) : [];
      state.globalSearchStocks = { key, rows, ok: Boolean(payload) };
      return state.globalSearchStocks;
    })
    .catch((error) => {
      console.warn("Global stock search unavailable", error);
      state.globalSearchStocks = { key, rows: [], ok: false };
      return state.globalSearchStocks;
    })
    .finally(() => {
      if (state.loading.globalSearchStocks?.key === key) delete state.loading.globalSearchStocks;
    });
  state.loading.globalSearchStocks = { key, promise };
  return promise;
};

const loadProductStockDetail = (symbol) => {
  const target = normalizeStockSymbol(symbol);
  if (!target) return Promise.resolve(null);
  if (state.productStockDetails[target]) return Promise.resolve(state.productStockDetails[target]);
  const key = `productStock:${target}`;
  if (state.loading[key]) return state.loading[key];
  state.loading[key] = productApiJson(`/symbols/${encodeURIComponent(target)}`)
    .then((payload) => {
      if (!payload?.profile) return null;
      const detail = {
        profile: normalizeProductSymbolRow(payload.profile),
        marketRows: (payload.marketRows || []).map(normalizeProductMarketRow),
        peers: (payload.peers || []).map(normalizeProductSymbolRow),
        events: (payload.events || []).map(normalizeProductEventRow),
        earnings: (payload.earnings || []).map(normalizeProductQualityRow),
        strength: payload.strength ? normalizeProductStrengthRow(payload.strength) : null,
      };
      state.productStockDetails[target] = detail;
      return detail;
    })
    .catch((error) => {
      console.warn(`Product detail unavailable: ${target}`, error);
      return null;
    })
    .finally(() => {
      delete state.loading[key];
    });
  return state.loading[key];
};

const loadProductSectors = () => {
  if (state.productSectors) return Promise.resolve(state.productSectors);
  if (state.loading.productSectors) return state.loading.productSectors;
  state.loading.productSectors = productApiJson("/sectors?limit=100")
    .then((payload) => {
      const rows = Array.isArray(payload?.rows) ? payload.rows.map(normalizeProductSectorRow) : [];
      state.productSectors = rows;
      if (rows.length) {
        state.sectorFlow = {
          ...(state.sectorFlow || {}),
          asOf: payload?.asOf || state.sectorFlow?.asOf || state.productMeta?.generatedAt,
          rows,
        };
      }
      return rows;
    })
    .catch((error) => {
      console.warn("Product sectors unavailable", error);
      state.productSectors = null;
      return [];
    })
    .finally(() => {
      delete state.loading.productSectors;
    });
  return state.loading.productSectors;
};

const loadProductCalendar = () => {
  if (state.productCalendar) return Promise.resolve(state.productCalendar);
  if (state.loading.productCalendar) return state.loading.productCalendar;
  state.loading.productCalendar = productApiJson("/calendar?limit=200")
    .then((payload) => {
      const rows = Array.isArray(payload?.rows) ? payload.rows.map(normalizeProductCalendarRow) : [];
      const calendar = rows.length
        ? {
            ...(state.eventsCalendar || {}),
            asOf: payload?.asOf || state.eventsCalendar?.asOf || state.productMeta?.generatedAt,
            generatedAt: state.productMeta?.generatedAt || state.eventsCalendar?.generatedAt,
            events: rows,
          }
        : null;
      state.productCalendar = calendar;
      if (calendar) state.eventsCalendar = calendar;
      return calendar;
    })
    .catch((error) => {
      console.warn("Product calendar unavailable", error);
      state.productCalendar = null;
      return null;
    })
    .finally(() => {
      delete state.loading.productCalendar;
    });
  return state.loading.productCalendar;
};

const lazyDatasets = {
  macroSeries: {
    url: `${PRODUCT_API_BASE}/raw/macro-series`,
    render: (payload) => renderMacroSeries(payload),
  },
  indexValuation: {
    url: `${PRODUCT_API_BASE}/raw/index-valuation`,
    render: (payload) => renderIndexValuation(payload),
  },
  optionsFlow: {
    url: `${PRODUCT_API_BASE}/raw/options-flow-snapshot`,
    render: (payload) => renderOptionsFlow(payload),
  },
  earningsQuality: {
    url: `${PRODUCT_API_BASE}/raw/earnings-quality`,
    render: (payload) => renderEarningsQuality(payload),
  },
  eventOpportunities: {
    url: `${PRODUCT_API_BASE}/raw/event-opportunities`,
    render: (payload) => renderEventOpportunities(payload),
  },
  eventsCalendar: {
    url: `${PRODUCT_API_BASE}/raw/events-calendar`,
    render: (payload) => renderEventsCalendar(payload),
  },
  validationCenter: {
    url: `${PRODUCT_API_BASE}/raw/validation-center`,
    render: (payload) => renderValidationCenter(payload),
  },
};

const loadLazyDataset = async (key) => {
  const config = lazyDatasets[key];
  if (!config) return null;
  if (state[key]) return state[key];
  if (state.loading[key]) return state.loading[key];
  state.loading[key] = fetchOptionalJson(config.url)
    .then((payload) => {
      if (payload) {
        config.render(payload);
        renderDashboardVisualBoard();
        renderDataStatus();
      }
      return payload;
    })
    .catch(() => null)
    .finally(() => {
      delete state.loading[key];
    });
  return state.loading[key];
};

const ensurePageData = (page) => {
  const jobs = [];
  if (page === "risk") jobs.push(loadLazyDataset("macroSeries"));
  if (page === "valuation") jobs.push(loadLazyDataset("indexValuation"));
  if (page === "options") jobs.push(loadLazyDataset("optionsFlow"));
  if (page === "signals") jobs.push(loadSignals());
  if (page === "earnings") jobs.push(loadLazyDataset("earningsQuality"));
  if (page === "events") {
    jobs.push(loadProductCalendar().then((calendar) => (calendar ? renderEventsCalendar(calendar) : loadLazyDataset("eventsCalendar"))));
  }
  if (page === "market" || page === "dashboard") {
    jobs.push(loadProductCoverage());
    jobs.push(loadProductSectors().then(() => {
      renderDashboardIntelligence();
      if (page === "market") {
        renderFlowsPage();
        renderMarketVisualBoard(getFilteredRows());
      }
    }));
    if (page === "dashboard") {
      jobs.push(loadProductCalendar().then((calendar) => {
        if (calendar) renderDashboardVisualBoard();
        return calendar;
      }));
    }
  }
  if (page === "stock-events") jobs.push(loadLazyDataset("eventOpportunities"), loadLazyDataset("validationCenter"));
  if (page === "validation") jobs.push(loadLazyDataset("validationCenter"));
  if (page === "stock") {
    jobs.push(
      loadProductStockDetail(state.selectedStockSymbol),
      loadProductCalendar().then((calendar) => {
        if (calendar) renderEventsCalendar(calendar);
        return calendar;
      }),
      loadProductSectors(),
      loadLazyDataset("earningsQuality"),
      loadLazyDataset("eventOpportunities"),
    );
  }
  if (page === "stocks") {
    jobs.push(
      Promise.all([
        loadProductMeta(),
        loadProductCoverage(),
        loadProductCalendar().then((calendar) => {
          if (calendar) renderEventsCalendar(calendar);
          return calendar;
        }),
        loadProductSectors(),
        loadProductStockLibrary(),
        loadLazyDataset("earningsQuality"),
        loadLazyDataset("eventOpportunities"),
      ])
        .then(() => renderStocksPage()),
    );
  }
  if (page === "watchlist") {
    jobs.push(
      Promise.all([
        loadProductCalendar().then((calendar) => {
          if (calendar) renderEventsCalendar(calendar);
          return calendar;
        }),
        loadProductSectors(),
        loadLazyDataset("earningsQuality"),
        loadLazyDataset("eventOpportunities"),
      ]).then(() => renderWatchlist()),
    );
  }
  return Promise.all(jobs).catch(() => []);
};

const formatPercent = (value) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + "%";

const formatNumber = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return new Intl.NumberFormat("en-US").format(number);
};

const formatMoney = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 2 : 3,
    maximumFractionDigits: value >= 100 ? 2 : 3,
  }).format(value);

const formatCompactMoney = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  const sign = number < 0 ? "-" : "";
  const absolute = Math.abs(number);
  if (absolute >= 1_000_000_000) return `${sign}$${(absolute / 1_000_000_000).toFixed(1)}B`;
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(1)}M`;
  return formatMoney(number);
};

const formatSignedPct = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number >= 0 ? "+" : ""}${formatPercent(number)}`;
};

const formatPlainPct = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return formatPercent(number);
};

const formatEvidencePct = (value, count, minCount = 30) => {
  const sample = Number(count);
  if (!Number.isFinite(sample) || sample < minCount) return "样本不足";
  return formatPlainPct(value);
};

const formatEvidenceSignedPct = (value, count, minCount = 30) => {
  const sample = Number(count);
  if (!Number.isFinite(sample) || sample < minCount) return "样本不足";
  return formatSignedPct(value);
};

const roleLabel = (role) => {
  if (role === "super_admin") return "超级管理员";
  if (role === "admin") return "普通管理员";
  return "普通用户";
};

const planLabel = (plan) => {
  if (plan === "paid" || plan === "pro" || plan === "pro_plus") return "付费";
  return "免费";
};

const safeReadJson = (key, fallback) => {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
};

const safeWriteJson = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // localStorage 不可用时，当前页面仍保留内存状态。
  }
};

const setSidebarCollapsed = (collapsed) => {
  document.body.classList.toggle("is-sidebar-collapsed", collapsed);
  document.querySelectorAll(".sidebar-toggle").forEach((button) => {
    button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    button.setAttribute("aria-label", collapsed ? "展开一级导航" : "收起一级导航");
  });
  safeWriteJson(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed);
};

const initSidebarState = () => {
  setSidebarCollapsed(Boolean(safeReadJson(SIDEBAR_COLLAPSED_STORAGE_KEY, false)));
};

const formatDateTime = (value) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDisplayDate = (value) => {
  if (!value) return "--";
  const text = String(value).trim();
  const isoDate = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

const latestDisplayDate = (...values) => {
  const dates = values
    .filter(Boolean)
    .map(formatDisplayDate)
    .filter((value) => value && value !== "--")
    .sort();
  return dates.length ? dates.at(-1) : "--";
};

const parseDateValue = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const startOfDate = (value) => {
  const date = parseDateValue(value);
  if (!date) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const addDays = (value, days) => {
  const date = startOfDate(value) || startOfDate(new Date());
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

const daysBetween = (from, to) => {
  const start = startOfDate(from);
  const end = startOfDate(to);
  if (!start || !end) return 0;
  return Math.round((end - start) / 86_400_000);
};

const hasPaidAccess = () =>
  Boolean(
    state.auth.authenticated &&
      (state.auth.entitlements.paid || state.auth.entitlements.pro || state.auth.entitlements.proPlus),
  );

const marketCapNumber = (label) => {
  const match = String(label || "").trim().replace(/[$,]/g, "").match(/^([\d.]+)([KMBT])$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === "T") return value * 1_000_000;
  if (unit === "B") return value * 1000;
  if (unit === "K") return value / 1000;
  return value;
};

const getChange = (row) => (typeof row.change === "number" ? row.change : row.changeYtd);

const impliedReferencePrice = (row) => row.price / (1 + getChange(row) / 100);

const capBucket = (row) => {
  const cap = marketCapNumber(row.marketCap);
  if (cap == null) return "unknown";
  if (cap >= 10000) return "large";
  if (cap >= 1000) return "mid";
  return "small";
};

const capLabel = (row) => {
  const bucket = capBucket(row);
  if (bucket === "large") return "大盘";
  if (bucket === "mid") return "中盘";
  if (bucket === "small") return "小盘";
  return "市值待补";
};

const parseSignedPercent = (value) => {
  const number = Number(String(value || "").replace("%", "").replace("+", "").replace(",", ""));
  return Number.isFinite(number) ? number : 0;
};

const parseRatio = (value) => {
  const number = Number(String(value || "").replace("x", ""));
  return Number.isFinite(number) ? number : 0;
};

const formatVolumeRatioLabel = (value) => {
  if (value == null || value === "") return "--";
  const number = parseRatio(value);
  if (!Number.isFinite(number) || number <= 0) return String(value);
  const text = number >= 10 ? number.toFixed(1) : number.toFixed(2);
  return `${text.replace(/\.?0+$/, "")}x`;
};

const parseMoneyLabel = (value) => {
  const text = String(value || "").trim().replace("$", "").replace(/,/g, "");
  if (!text || text === "--") return 0;
  const suffix = text.at(-1)?.toUpperCase();
  const multiplier = suffix === "B" ? 1_000_000_000 : suffix === "M" ? 1_000_000 : suffix === "K" ? 1_000 : 1;
  const raw = multiplier === 1 ? text : text.slice(0, -1);
  const number = Number(raw);
  return Number.isFinite(number) ? number * multiplier : 0;
};

const normalizeSectorName = (sector) => {
  const value = String(sector || "").trim();
  if (!value || value === "未分类" || value === "板块待补" || value === "--") return "";
  if (/半导体|科技|软件|芯片|AI|云|网络安全|XLK|SMH/i.test(value)) return "科技";
  if (/金融|银行|保险|支付|XLF/i.test(value)) return "金融";
  if (/医疗|医药|生物|制药|XLV|IBB/i.test(value)) return "医疗";
  if (/能源|油气|XLE/i.test(value)) return "能源";
  if (/消费|零售|电商|汽车|XLY|XLP/i.test(value)) return "消费";
  if (/通信|互联网|媒体|XLC/i.test(value)) return "通信";
  if (/工业|制造|航空|国防|XLI/i.test(value)) return "工业";
  if (/材料|金属|化工|XLB/i.test(value)) return "材料";
  if (/地产|房托|XLRE/i.test(value)) return "地产";
  if (/公用|电力|水务|XLU/i.test(value)) return "公用事业";
  return value;
};

const isKnownSector = (sector) => {
  const value = normalizeSectorName(sector);
  return Boolean(value && value !== "未分类" && value !== "板块待补" && value !== "--");
};

const knownSectorRows = (rows = []) => {
  const filtered = rows.filter((row) => isKnownSector(row.sector));
  return filtered.length >= 5 ? filtered : rows;
};

const industrySectorRows = (rows = []) => {
  const known = knownSectorRows(rows);
  const filtered = known.filter((row) => normalizeSectorName(row.sector) !== "ETF");
  return filtered.length >= 5 ? filtered : known;
};

const sectorDisplayName = (sector) => (isKnownSector(sector) ? normalizeSectorName(sector) : "板块待补");

const formatChangeValue = (row) => {
  if (!row) return "--";
  const change = getChange(row);
  if (!Number.isFinite(change)) return "--";
  return `${change >= 0 ? "+" : ""}${formatPercent(change)}`;
};

const uniqueBySymbol = (rows) => {
  const seen = new Set();
  return rows.filter((row) => {
    if (seen.has(row.symbol)) return false;
    seen.add(row.symbol);
    return true;
  });
};

const getRiskScore = (row) => {
  let score = 28;
  const absChange = Math.abs(getChange(row));
  if (absChange >= 1000) score += 28;
  else if (absChange >= 500) score += 20;
  else if (absChange >= 100) score += 16;
  else if (absChange >= 30) score += 10;

  const cap = capBucket(row);
  if (cap === "small") score += 22;
  else if (cap === "mid") score += 10;

  if (row.price < 1) score += 14;
  else if (row.price < 5) score += 10;

  if (/低价|高波动|流动性|临床|题材/.test(row.risk)) score += 8;
  if (Number(String(row.volume).replace(/,/g, "")) < 500000) score += 5;

  return Math.min(score, 99);
};

const getRiskBucket = (row) => {
  const score = getRiskScore(row);
  if (score >= 80) return "extreme";
  if (score >= 62) return "high";
  return "watch";
};

const getRiskLabel = (bucket) => {
  if (bucket === "extreme") return "极高";
  if (bucket === "high") return "偏高";
  return "观察";
};

const signalClass = (bucket) => {
  if (bucket === "positive") return "is-positive";
  if (bucket === "watch") return "is-watch";
  return "is-neutral";
};

const lightClass = (bucket) => {
  if (bucket === "positive") return "positive";
  if (bucket === "watch") return "watch";
  return "neutral";
};

const openAuthModal = (message) => {
  const modal = document.querySelector("#authModal");
  if (!modal) return;
  if (message) setText("#authPrompt", message);
  setText("#authError", "");
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  setTimeout(() => {
    const emailInput = document.querySelector("#authEmail");
    if (emailInput) emailInput.focus();
  }, 30);
};

const closeAuthModal = () => {
  const modal = document.querySelector("#authModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
};

const renderAuthState = () => {
  const button = document.querySelector("#authButton");
  if (!button) return;
  const { authenticated, user, entitlements } = state.auth;
  const hasPaid = hasPaidAccess();
  const isAdmin = Boolean(authenticated && entitlements.admin);
  button.classList.toggle("is-authenticated", authenticated);
  document.querySelectorAll("[data-admin-only]").forEach((item) => {
    item.classList.toggle("is-hidden", !isAdmin);
  });
  document.querySelectorAll('#adminCreateForm [name="role"] option[value="admin"]').forEach((option) => {
    option.disabled = !(user && user.role === "super_admin");
  });
  if (!isAdmin && document.querySelector('[data-view="admin"]').classList.contains("is-active")) {
    showPage("dashboard");
  }
  if (!isAdmin && document.querySelector('[data-view="validation"]').classList.contains("is-active")) {
    showPage("dashboard");
  }
  document.querySelectorAll("[data-requires-plan='paid']").forEach((card) => {
    card.classList.toggle("is-unlocked", hasPaid);
    card.querySelectorAll("em").forEach((item) => {
      item.textContent = hasPaid ? "已解锁" : "锁定";
    });
  });
  document.querySelectorAll("[data-pro-plus-copy]").forEach((item) => {
    if (!item.dataset.lockedCopy) item.dataset.lockedCopy = item.textContent;
    item.textContent = hasPaid ? "已解锁" : item.dataset.lockedCopy;
  });
  renderStrengthPremiumSections();
  if (!authenticated) {
    button.textContent = "登录";
    return;
  }
  const label = user && user.role === "super_admin" ? "超级管理员" : hasPaid ? "付费" : "免费";
  button.textContent = `${label}`;
};

const refreshAuth = async () => {
  try {
    const payload = await apiFetch("/api/auth/status");
    state.auth = {
      authenticated: Boolean(payload.authenticated),
      user: payload.user,
      entitlements: payload.entitlements || { paid: false, pro: false, proPlus: false, admin: false },
    };
  } catch {
    state.auth = {
      authenticated: false,
      user: null,
      entitlements: { paid: false, pro: false, proPlus: false, admin: false },
    };
  }
  renderAuthState();
};

const renderUnlockedTradeRecords = (records) => {
  const container = document.querySelector('[data-view="live"] .locked-records');
  if (!container) return;
  container.innerHTML = records
    .map(
      (record) => `
        <div>
          <span>${escapeHtml(record.symbol)}</span>
          <strong>${escapeHtml(record.direction)} · ${escapeHtml(record.profit)}</strong>
          <em>已解锁</em>
        </div>
      `,
    )
    .join("");
};

const unlockTradeRecords = async () => {
  if (!state.auth.authenticated) {
    openAuthModal("请先登录。付费用户可查看完整交割记录。");
    return;
  }
  if (!(state.auth.entitlements.paid || state.auth.entitlements.pro || state.auth.entitlements.proPlus)) {
    showPage("subscription");
    openAuthModal("当前账号尚未开通付费会员，升级后可查看完整交割记录。");
    return;
  }
  try {
    const payload = await apiFetch("/api/pro/trade-records");
    renderUnlockedTradeRecords(payload.records || []);
    renderAuthState();
  } catch (error) {
    openAuthModal(error.message || "暂时无法读取交割记录。");
  }
};

const renderAdminUsers = () => {
  const body = document.querySelector("#adminUsersBody");
  if (!body) return;
  const summary = state.adminSummary || {};
  setText("#adminTotalUsers", summary.total == null ? "--" : `${summary.total}`);
  setText("#adminActiveUsers", summary.active == null ? "--" : `${summary.active}`);
  setText("#adminPaidUsers", summary.paid == null ? "--" : `${summary.paid}`);
  setText("#adminManagerUsers", summary.admin == null ? "--" : `${summary.admin}`);

  const performance = document.querySelector("#adminPerformanceList");
  if (performance) {
    performance.innerHTML = state.adminPerformance.length
      ? state.adminPerformance
          .map(
            (item) => `
              <div>
                <strong>${escapeHtml(item.creatorEmail)}</strong>
                <span>创建 ${item.total} 人 · 有效 ${item.active} 人 · 付费 ${item.paid} 人</span>
              </div>
            `,
          )
          .join("")
      : "<p>暂无业绩数据。</p>";
  }

  if (!state.adminUsers.length) {
    body.innerHTML = '<tr><td colspan="8">暂无用户。</td></tr>';
    return;
  }

  const currentUser = state.auth.user || {};
  const canSetAdmin = currentUser.role === "super_admin";
  body.innerHTML = state.adminUsers
    .map((user) => {
      const disabled = user.isSuperAdmin ? "disabled" : "";
      const createdBy = user.createdBy && user.createdBy.email ? user.createdBy.email : "系统 / 超级管理员";
      return `
        <tr data-admin-user-id="${user.id}">
          <td>
            <strong>${escapeHtml(user.email)}</strong>
            <span>ID ${user.id}</span>
          </td>
          <td>${escapeHtml(createdBy)}</td>
          <td>
            ${
              user.isSuperAdmin
                ? `<strong>${roleLabel(user.role)}</strong>`
                : `<select data-admin-field="role" ${disabled}>
                    <option value="user" ${user.role === "user" ? "selected" : ""}>普通用户</option>
                    <option value="admin" ${user.role === "admin" ? "selected" : ""} ${canSetAdmin ? "" : "disabled"}>普通管理员</option>
                  </select>`
            }
          </td>
          <td>
            <select data-admin-field="plan" ${disabled}>
              <option value="free" ${user.plan === "free" ? "selected" : ""}>免费</option>
              <option value="paid" ${planLabel(user.plan) === "付费" ? "selected" : ""}>付费</option>
            </select>
          </td>
          <td><input data-admin-field="subscriptionExpiresAt" type="date" value="${escapeHtml((user.subscriptionExpiresAt || "").slice(0, 10))}" ${disabled} /></td>
          <td>
            <label class="admin-inline-check">
              <input data-admin-field="isActive" type="checkbox" ${user.isActive ? "checked" : ""} ${disabled} />
              <span>${user.isActive ? "启用" : "停用"}</span>
            </label>
          </td>
          <td>${escapeHtml(formatDateTime(user.lastLoginAt))}</td>
          <td>
            ${
              user.isSuperAdmin
                ? '<span class="admin-lock">保留</span>'
                : `<button type="button" data-admin-action="save">保存</button>
                   <button type="button" data-admin-action="reset-password">改密</button>`
            }
          </td>
        </tr>
      `;
    })
    .join("");
};

const loadAdminUsers = async () => {
  if (!state.auth.entitlements.admin) return;
  const payload = await apiFetch("/api/admin/users");
  state.adminUsers = payload.users || [];
  state.adminSummary = payload.summary || null;
  state.adminPerformance = payload.performance || [];
  renderAdminUsers();
};

const directionLabel = (direction, fallback) => {
  if (fallback) return fallback;
  if (direction === "long") return "上行观察";
  if (direction === "short") return "下行观察";
  return direction || "--";
};

const signalPolarity = (signal) => {
  if (!signal) return { label: "暂无趋势信号", className: "is-neutral", note: "当前没有接入该标的的趋势方向。" };
  if (signal.direction === "long") return { label: "多头", className: "is-long", note: "当前趋势信号偏上行，重点看顺向表现是否延续。" };
  if (signal.direction === "short") return { label: "空头", className: "is-short", note: "当前趋势信号偏下行，重点看反弹是否失效。" };
  return { label: "中性", className: "is-neutral", note: "当前趋势方向不明确，先等待下一次信号更新。" };
};

const signalStatusText = (signalSide) => `当前趋势信号：${signalSide.label}`;

const signalEventsForSymbol = (symbol) =>
  (state.signals?.feed || []).filter((item) => item.symbol === symbol);

const signalStateForSymbol = (symbol) =>
  (state.signals?.states || []).find((item) => item.symbol === symbol) || null;

const renderSignalDetail = (symbol) => {
  const panel = document.querySelector("#signalDetailPanel");
  if (!panel) return;
  const tag = document.querySelector("#signalDetailTag");
  const current = signalStateForSymbol(symbol);
  const events = signalEventsForSymbol(symbol);
  if (!symbol || !current) {
    if (tag) tag.textContent = "选择标的";
    panel.innerHTML = `
      <div class="empty-detail">
        <strong>点击上方任一标的</strong>
        <p>查看首发、历次复盘、方向变化、最佳表现和最大反向波动。</p>
      </div>
    `;
    return;
  }
  if (tag) tag.textContent = symbol;
  const firstEvent = [...events].reverse()[0] || current;
  const latestEvent = events[0] || current;
  const side = signalPolarity(current);
  panel.innerHTML = `
    <div class="detail-hero">
      <div>
        <span>${escapeHtml(current.theme || "未分类")}</span>
        <strong>${escapeHtml(symbol)}</strong>
        <p><b class="signal-side-pill ${escapeHtml(side.className)}">${escapeHtml(side.label)}</b> · ${escapeHtml(current.intervalLabel || current.interval || "--")}</p>
      </div>
      <div>
        <span>最佳表现</span>
        <strong>${escapeHtml(current.maxFavorablePct || current.marketChangePct || "--")}</strong>
        <p>最大反向波动 ${escapeHtml(current.maxAdversePct || "--")}</p>
      </div>
      <div>
        <span>已跟踪</span>
        <strong>${escapeHtml(current.signalAge || "--")}</strong>
        <p>首发 ${escapeHtml(current.firstSignalAt || firstEvent.currentTime || "--")}</p>
      </div>
    </div>
    <div class="detail-timeline">
      ${events.slice(0, 8).map((item, index) => `
        <article>
          <span>${escapeHtml(item.currentTime || item.receivedAt || "--")}</span>
          <strong>${index === 0 ? "近期" : eventTypeLabel(item.eventType)} · ${escapeHtml(directionLabel(item.direction, item.directionText))}</strong>
          <p>触发价 ${escapeHtml(item.price || "--")}，现价 ${escapeHtml(item.livePrice || "--")}，表现 ${escapeHtml(item.marketChangePct || "--")}，最佳 ${escapeHtml(item.maxFavorablePct || "--")}。</p>
        </article>
      `).join("")}
    </div>
    <div class="detail-summary">
      <span>复盘结论</span>
      <p>从 ${escapeHtml(firstEvent.currentTime || current.firstSignalAt || "--")} 到 ${escapeHtml(latestEvent.currentTime || latestEvent.receivedAt || "--")}，当前趋势信号为 ${escapeHtml(side.label)}。重点看后续是否继续刷新顺向表现，或出现方向切换。</p>
    </div>
  `;
};

const renderSignalDashboard = () => {
  const payload = state.signals;
  if (!payload) return;
  const overview = payload.overview || {};
  const stateRows = payload.states || [];
  const feedRows = payload.feed || [];
  const reviewRows = payload.reviewQueue || [];
  const activeCount = overview.activeSymbols ?? stateRows.length;
  const switchCount = overview.switches24h ?? feedRows.filter((item) => item.eventType === "switch" || item.eventType === "direction_change").length;
  const reviewCount = overview.reviewQueue ?? reviewRows.length;
  const capturedMove = overview.capturedMovePct || (stateRows.length ? "--" : "暂无记录");
  setText("#signalActiveCount", `${activeCount}`);
  setText("#signalSwitchCount", `${switchCount}`);
  setText("#signalReviewCount", `${reviewCount}`);
  setText("#signalCapturePct", capturedMove);
  setText("#signalCapturedHero", capturedMove);

  const feed = document.querySelector("#signalFeed");
  if (feed) {
    const rows = payload.feed || [];
    feed.innerHTML = rows.length
      ? rows.slice(0, 8).map((item) => `
          <article class="${item.eventType === "switch" || item.eventType === "direction_change" ? "is-switch" : ""}">
            <span>${escapeHtml(item.symbol)} · ${escapeHtml(item.theme || "未分类")} · ${escapeHtml(item.intervalLabel || item.interval || "--")}</span>
            <strong>${escapeHtml(eventTypeLabel(item.eventType))} · ${escapeHtml(directionLabel(item.direction, item.directionText))}</strong>
            <p>触发价 ${escapeHtml(item.price || "--")}，现价 ${escapeHtml(item.livePrice || "--")}，表现 ${escapeHtml(item.marketChangePct || "--")}。</p>
            <em>${escapeHtml(item.currentTime || item.receivedAt || "--")}</em>
          </article>
        `).join("")
      : "<article><strong>等待信号记录</strong><p>收到新信号、复盘或方向切换后，会显示标的、方向、价格和复盘表现。</p><em>等待接入</em></article>";
  }

  const stateTable = document.querySelector("#signalStateTable");
  if (stateTable) {
    const rows = payload.states || [];
    if (!state.selectedSignalSymbol && rows[0]) state.selectedSignalSymbol = rows[0].symbol;
    stateTable.innerHTML = rows.length
      ? `
        <div class="signal-state-head signal-workbench-row">
          <span>标的</span>
          <span>当前趋势</span>
          <span>周期</span>
          <span>触发价</span>
          <span>现价</span>
          <span>当前表现</span>
          <span>最佳顺向</span>
          <span>最大反向</span>
          <span>持续</span>
          <span>操作</span>
        </div>
        ${rows.slice(0, 18).map((item) => {
          const side = signalPolarity(item);
          return `
            <button class="signal-state-row signal-workbench-row ${state.selectedSignalSymbol === item.symbol ? "is-selected" : ""}" type="button" data-signal-symbol="${escapeHtml(item.symbol)}">
              <strong>
                ${escapeHtml(item.symbol)}
                <small>${escapeHtml(item.theme || "未分类")}</small>
              </strong>
              <span class="signal-direction-cell ${escapeHtml(side.className)}"><i>${escapeHtml(side.label)}</i><small>${escapeHtml(directionLabel(item.direction, item.directionText))}</small></span>
              <span>${escapeHtml(item.intervalLabel || item.interval || "--")}</span>
              <span>${escapeHtml(item.price || "--")}</span>
              <span>${escapeHtml(item.livePrice || "--")}</span>
              <b class="${escapeHtml(stockSignedClass(item.marketChangePct))}">${escapeHtml(item.marketChangePct || "--")}</b>
              <b class="${escapeHtml(stockSignedClass(item.maxFavorablePct))}">${escapeHtml(item.maxFavorablePct || "--")}</b>
              <b class="${escapeHtml(stockSignedClass(item.maxAdversePct))}">${escapeHtml(item.maxAdversePct || "--")}</b>
              <span>${escapeHtml(item.signalAge || "--")}</span>
              <span class="signal-row-actions">
                <em>点行复盘</em>
              </span>
            </button>
          `;
        }).join("")}
      `
      : "<div><span>等待记录</span><strong>有新信号后会显示方向、价格和表现。</strong></div>";
  }
  renderSignalDetail(state.selectedSignalSymbol);

  const latest = payload.latestState;
  const lifeCard = document.querySelector("#signalLifeCard");
  if (lifeCard && latest) {
    lifeCard.innerHTML = `
      <div>
        <span>观察标的</span>
        <strong>${escapeHtml(latest.symbol)}</strong>
        <small class="signal-theme-pill">${escapeHtml(latest.theme || "未分类")}</small>
      </div>
      <ol>
        <li><b>首发</b><span>${escapeHtml(directionLabel(latest.direction, latest.directionText))} · 触发价 ${escapeHtml(latest.price || "--")} · ${escapeHtml(latest.intervalLabel || "--")}</span></li>
        <li><b>持续</b><span>${escapeHtml(latest.signalAge || "--")}，当前方向 ${escapeHtml(directionLabel(latest.direction, latest.directionText))}</span></li>
        <li><b>表现</b><span>当前 ${escapeHtml(latest.marketChangePct || "--")}，最佳 ${escapeHtml(latest.maxFavorablePct || "--")}</span></li>
        <li><b>回撤</b><span>最大反向波动 ${escapeHtml(latest.maxAdversePct || "--")}</span></li>
      </ol>
    `;
  } else if (lifeCard) {
    lifeCard.innerHTML = `
      <div>
        <span>观察标的</span>
        <strong>等待信号</strong>
      </div>
      <ol>
        <li><b>首发</b><span>收到首条信号后显示触发价和周期。</span></li>
        <li><b>复盘</b><span>有复盘记录后显示持续时间和方向变化。</span></li>
        <li><b>表现</b><span>有价格表现后显示当前和最佳表现。</span></li>
      </ol>
    `;
  }

  const sectorList = document.querySelector("#signalSectorList");
  if (sectorList) {
    const sectors = payload.sectors || [];
    sectorList.innerHTML = sectors.length
      ? sectors.slice(0, 6).map((item) => `
          <article>
            <span>${escapeHtml(item.theme)}</span>
            <strong>${escapeHtml(item.total)} 个标的 · 上行 ${escapeHtml(item.long)} / 下行 ${escapeHtml(item.short)}</strong>
            <p>${escapeHtml((item.symbols || []).slice(0, 5).join(" / ") || "--")}</p>
          </article>
        `).join("")
      : "<article><span>板块观察</span><strong>等待更多记录</strong><p>有多只标的进入观察后，会显示主题强弱。</p></article>";
  }

  const sectorBoard = document.querySelector("#signalSectorBoard");
  if (sectorBoard) {
    const sectors = payload.sectors || [];
    sectorBoard.innerHTML = sectors.length
      ? sectors.slice(0, 4).map((item) => `
          <article>
            <span>${escapeHtml(item.theme)}</span>
            <strong>${escapeHtml(item.longRatioPct || "--")} 上行占比</strong>
            <p>最佳 ${escapeHtml(item.bestSymbol || "--")} · 捕捉幅度 ${escapeHtml(item.capturedMovePct || "--")}</p>
          </article>
        `).join("")
      : `
        <article>
          <span>等待主题</span>
          <strong>等待更多信号</strong>
          <p>多只标的进入观察后，会自动形成板块强弱。</p>
        </article>
      `;
  }

  const reviewQueue = document.querySelector("#signalReviewQueue");
  if (reviewQueue) {
    const reviews = payload.reviewQueue || [];
    reviewQueue.innerHTML = reviews.length
      ? reviews.slice(0, 6).map((item) => `
          <div><span>${escapeHtml(item.intervalLabel || "--")}</span><strong>${escapeHtml(item.symbol)} · ${escapeHtml(directionLabel(item.direction, item.directionText))}</strong></div>
        `).join("")
      : "<div><span>等待记录</span><strong>有复盘任务后会显示队列</strong></div>";
  }
  renderAuthState();
};

const fallbackSignalPayload = (core = state.core) => {
  const fallbackSignals = core?.risk?.signals?.length
    ? core.risk.signals
    : [
        { term: "SPY", bucket: "neutral", label: "待接入", note: "趋势信号接口暂无记录，先保留大盘观察位。" },
        { term: "QQQ", bucket: "neutral", label: "待接入", note: "趋势信号接口暂无记录，先保留科技股观察位。" },
        { term: "IWM", bucket: "neutral", label: "待接入", note: "趋势信号接口暂无记录，先保留小盘股观察位。" },
        { term: "VIX", bucket: "neutral", label: "待接入", note: "趋势信号接口暂无记录，先保留波动率观察位。" },
        { term: "10Y", bucket: "neutral", label: "待接入", note: "趋势信号接口暂无记录，先保留利率观察位。" },
      ];
  const fallbackStates = fallbackSignals.map((item) => {
    const bucket = item.bucket || "";
    const direction = bucket === "watch" ? "short" : bucket === "positive" ? "long" : "neutral";
    return {
      symbol: item.term,
      direction,
      directionText: item.label,
      intervalLabel: "日线",
      price: item.label || "--",
      livePrice: item.asOf || core?.asOf || "--",
      marketChangePct: bucket === "positive" ? "偏强" : bucket === "watch" ? "压力" : "中性",
      theme: "市场信号",
      firstSignalAt: item.asOf || core?.asOf || "--",
      signalAge: "核心信号",
      maxFavorablePct: "--",
      maxAdversePct: "--",
    };
  });
  return {
    overview: {
      activeSymbols: fallbackStates.length,
      switches24h: 0,
      reviewQueue: 0,
      capturedMovePct: fallbackStates.length ? "核心信号" : "暂无记录",
    },
    states: fallbackStates,
    feed: fallbackSignals.map((item) => {
      const bucket = item.bucket || "";
      return {
        symbol: item.term,
        theme: "市场信号",
        intervalLabel: "日线",
        eventType: "core_signal",
        direction: bucket === "watch" ? "short" : bucket === "positive" ? "long" : "neutral",
        directionText: item.label,
        price: item.label,
        livePrice: item.asOf || core?.asOf || "--",
        marketChangePct: neutralCopy(item.note || "--"),
        currentTime: item.asOf || core?.asOf || "--",
      };
    }),
    sectors: [],
    reviewQueue: [],
  };
};

const loadSignals = async () => {
  try {
    const payload = await apiFetch("/api/signals");
    if (payload?.states?.length || payload?.feed?.length) {
      state.signals = payload;
    } else {
      let fallback = fallbackSignalPayload();
      if (!fallback.states.length) {
        const bootstrap = await productApiJson("/bootstrap").catch(() => null);
        if (bootstrap?.core && !state.core) state.core = bootstrap.core;
        fallback = fallbackSignalPayload(bootstrap?.core || state.core);
      }
      state.signals = fallback;
    }
    renderSignalDashboard();
    renderWatchlist();
  } catch (error) {
    state.signals = fallbackSignalPayload();
    renderSignalDashboard();
  }
};

const normalizeStockSymbol = (symbol) => String(symbol || "").trim().toUpperCase();

const stockRuntimeCache = {
  marketRowsKey: "",
  marketRows: null,
  marketMapKey: "",
  marketMap: null,
  qualityRowsKey: "",
  qualityRows: null,
  qualityMapKey: "",
  qualityMap: null,
  eventRowsKey: "",
  eventRows: null,
  eventMapKey: "",
  eventMap: null,
  productMapKey: "",
  productMap: null,
  globalSearchKey: "",
  globalSearchItems: null,
  stockLibraryKey: "",
  stockLibraryRows: null,
};

const rowsSignature = (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  return `${list.length}:${normalizeStockSymbol(list[0]?.symbol || list[0]?.ticker)}:${normalizeStockSymbol(list.at(-1)?.symbol || list.at(-1)?.ticker)}`;
};

const boardsSignature = () =>
  Object.entries(state.boards || {})
    .map(([key, rows]) => `${key}:${rowsSignature(rows)}`)
    .join("|");

const watchlistSignature = () =>
  (state.watchlist || [])
    .map((row) => normalizeStockSymbol(row.symbol || row.ticker))
    .sort()
    .join(",");

const allMarketRows = () => {
  const key = boardsSignature();
  if (stockRuntimeCache.marketRowsKey === key && stockRuntimeCache.marketRows) return stockRuntimeCache.marketRows;
  stockRuntimeCache.marketRowsKey = key;
  stockRuntimeCache.marketRows = uniqueBySymbol(Object.values(state.boards || {}).flat());
  stockRuntimeCache.marketMapKey = "";
  return stockRuntimeCache.marketRows;
};

const marketRowMap = () => {
  const key = boardsSignature();
  if (stockRuntimeCache.marketMapKey === key && stockRuntimeCache.marketMap) return stockRuntimeCache.marketMap;
  const map = new Map();
  allMarketRows().forEach((row) => {
    const symbol = normalizeStockSymbol(row.symbol);
    if (symbol && !map.has(symbol)) map.set(symbol, row);
  });
  stockRuntimeCache.marketMapKey = key;
  stockRuntimeCache.marketMap = map;
  return map;
};

const allQualityRows = () => {
  const key = Object.entries(state.earningsQuality?.boards || {})
    .map(([board, payload]) => `${board}:${rowsSignature(payload?.rows || [])}`)
    .join("|");
  if (stockRuntimeCache.qualityRowsKey === key && stockRuntimeCache.qualityRows) return stockRuntimeCache.qualityRows;
  const boards = state.earningsQuality?.boards || {};
  stockRuntimeCache.qualityRowsKey = key;
  stockRuntimeCache.qualityRows = uniqueBySymbol(
    Object.values(boards)
      .flatMap((board) => board.rows || [])
      .map((row) => ({ ...row, symbol: row.ticker })),
  );
  stockRuntimeCache.qualityMapKey = "";
  return stockRuntimeCache.qualityRows;
};

const allEventRows = () => {
  const key = Object.entries(state.eventOpportunities?.boards || {})
    .map(([board, payload]) => `${board}:${rowsSignature(payload?.rows || [])}`)
    .join("|");
  if (stockRuntimeCache.eventRowsKey === key && stockRuntimeCache.eventRows) return stockRuntimeCache.eventRows;
  const boards = state.eventOpportunities?.boards || {};
  stockRuntimeCache.eventRowsKey = key;
  stockRuntimeCache.eventRows = uniqueBySymbol(
    Object.values(boards)
      .flatMap((board) => board.rows || [])
      .map((row) => ({ ...row, symbol: row.ticker })),
  );
  stockRuntimeCache.eventMapKey = "";
  return stockRuntimeCache.eventRows;
};

const findMarketRow = (symbol) => {
  const target = normalizeStockSymbol(symbol);
  return (
    getMarketDetailSource(target) ||
    marketRowMap().get(target) ||
    null
  );
};

const findStrengthRow = (symbol) => {
  const target = normalizeStockSymbol(symbol);
  return (state.strength?.rows || []).find((row) => normalizeStockSymbol(row.symbol) === target) || null;
};

const findQualityRow = (symbol) => {
  const target = normalizeStockSymbol(symbol);
  allQualityRows();
  if (stockRuntimeCache.qualityMapKey !== stockRuntimeCache.qualityRowsKey || !stockRuntimeCache.qualityMap) {
    stockRuntimeCache.qualityMap = new Map();
    allQualityRows().forEach((row) => {
      const rowSymbol = normalizeStockSymbol(row.ticker || row.symbol);
      if (rowSymbol && !stockRuntimeCache.qualityMap.has(rowSymbol)) stockRuntimeCache.qualityMap.set(rowSymbol, row);
    });
    stockRuntimeCache.qualityMapKey = stockRuntimeCache.qualityRowsKey;
  }
  return stockRuntimeCache.qualityMap.get(target) || null;
};

const findEventRow = (symbol) => {
  const target = normalizeStockSymbol(symbol);
  allEventRows();
  if (stockRuntimeCache.eventMapKey !== stockRuntimeCache.eventRowsKey || !stockRuntimeCache.eventMap) {
    const boards = state.eventOpportunities?.boards || {};
    const orderedRows = [
      ...(boards.guidance_up?.rows || []),
      ...(boards.earnings_beat?.rows || []),
      ...(boards.analyst_positive?.rows || []),
      ...(boards.short_squeeze?.rows || []),
      ...allEventRows(),
    ];
    stockRuntimeCache.eventMap = new Map();
    orderedRows.forEach((row) => {
      const rowSymbol = normalizeStockSymbol(row.ticker || row.symbol);
      if (rowSymbol && !stockRuntimeCache.eventMap.has(rowSymbol)) stockRuntimeCache.eventMap.set(rowSymbol, row);
    });
    stockRuntimeCache.eventMapKey = stockRuntimeCache.eventRowsKey;
  }
  return stockRuntimeCache.eventMap.get(target) || null;
};

const findProductProfile = (symbol) => {
  const target = normalizeStockSymbol(symbol);
  if (state.productStockDetails[target]?.profile) return state.productStockDetails[target].profile;
  const currentLibraryRow = (state.productStockLibrary?.rows || []).find((row) => normalizeStockSymbol(row.symbol) === target);
  if (currentLibraryRow) return currentLibraryRow;
  const key = rowsSignature(state.productSymbols || []);
  if (stockRuntimeCache.productMapKey !== key || !stockRuntimeCache.productMap) {
    stockRuntimeCache.productMap = new Map();
    (state.productSymbols || []).forEach((row) => {
      const rowSymbol = normalizeStockSymbol(row.symbol);
      if (rowSymbol && !stockRuntimeCache.productMap.has(rowSymbol)) stockRuntimeCache.productMap.set(rowSymbol, row);
    });
    stockRuntimeCache.productMapKey = key;
  }
  return stockRuntimeCache.productMap.get(target) || null;
};

const stockDisplayName = (symbol) => {
  const product = findProductProfile(symbol);
  const market = findMarketRow(symbol);
  const strength = findStrengthRow(symbol);
  const quality = findQualityRow(symbol);
  const event = findEventRow(symbol);
  return {
    symbol: normalizeStockSymbol(symbol),
    chineseName: product?.chineseName || market?.chineseName || "",
    company: product?.company || market?.company || quality?.companyName || event?.companyName || quality?.name || strength?.name || "",
    sector: sectorDisplayName(product?.sector || market?.sector || strength?.sectorProxy || signalStateForSymbol(symbol)?.theme),
  };
};

const resultSymbolFromRow = (row) => normalizeStockSymbol(row?.symbol || row?.ticker);

const mergeSearchRow = (map, row, source) => {
  const symbol = resultSymbolFromRow(row);
  if (!symbol) return;
  const existing = map.get(symbol) || { symbol, sources: new Set() };
  existing.sources.add(source);
  existing.name = existing.name
    || row.company
    || row.companyName
    || row.name
    || row.chineseName
    || "";
  existing.sector = existing.sector
    || row.sector
    || row.sectorProxy
    || row.theme
    || "";
  existing.change = existing.change
    || row.changePct
    || row.dayChangePct
    || row.change
    || row.return1dPct
    || row.return20d
    || "";
  existing.marketCap = existing.marketCap || row.marketCap || "";
  existing.volume = existing.volume || row.dollarVolume || row.volumeDollar || row.volume || "";
  map.set(symbol, existing);
};

const extractSearchRows = (value, rows = []) => {
  if (Array.isArray(value)) {
    value.forEach((item) => extractSearchRows(item, rows));
    return rows;
  }
  if (!value || typeof value !== "object") return rows;
  const symbol = resultSymbolFromRow(value);
  if (symbol) rows.push(value);
  Object.values(value).forEach((item) => {
    if (item && typeof item === "object") extractSearchRows(item, rows);
  });
  return rows;
};

const loadGlobalSearchUniverse = () => {
  if (state.searchUniverse) return Promise.resolve(state.searchUniverse);
  if (state.loading.searchUniverse) return state.loading.searchUniverse;
  state.loading.searchUniverse = loadProductSymbols()
    .then((productRows) => {
      if (productRows?.length) return productRows;
      return productApiJson("/raw/site-data-index");
    })
    .then((payload) => {
      if (Array.isArray(payload)) {
        state.searchUniverse = payload;
        return state.searchUniverse;
      }
      const rows = extractSearchRows(payload?.payloads || payload || []);
      const map = new Map();
      rows.forEach((row) => mergeSearchRow(map, row, "覆盖池"));
      state.searchUniverse = [...map.values()];
      return state.searchUniverse;
    })
    .catch(() => {
      state.searchUniverse = [];
      return state.searchUniverse;
    })
    .finally(() => {
      delete state.loading.searchUniverse;
    });
  return state.loading.searchUniverse;
};

const buildGlobalSearchItems = () => {
  allQualityRows();
  allEventRows();
  const key = [
    rowsSignature(state.productSymbols || []),
    rowsSignature(state.searchUniverse || []),
    boardsSignature(),
    rowsSignature(state.strength?.rows || []),
    stockRuntimeCache.qualityRowsKey,
    stockRuntimeCache.eventRowsKey,
    watchlistSignature(),
  ].join("|");
  if (stockRuntimeCache.globalSearchKey === key && stockRuntimeCache.globalSearchItems) {
    return stockRuntimeCache.globalSearchItems;
  }
  const map = new Map();
  (state.productSymbols || []).forEach((row) => mergeSearchRow(map, row, "产品库"));
  (state.searchUniverse || []).forEach((row) => mergeSearchRow(map, row, "覆盖池"));
  allMarketRows().forEach((row) => mergeSearchRow(map, row, "行情"));
  (state.strength?.rows || []).forEach((row) => mergeSearchRow(map, row, "强弱"));
  (state.watchlist || []).forEach((row) => mergeSearchRow(map, row, "自选"));
  const coreRows = Array.isArray(state.core?.mag7)
    ? state.core.mag7
    : Array.isArray(state.core?.rows)
      ? state.core.rows
      : [];
  coreRows.forEach((row) => mergeSearchRow(map, row, "核心"));
  allQualityRows().forEach((row) => mergeSearchRow(map, row, "财报"));
  allEventRows().forEach((row) => mergeSearchRow(map, row, "事件"));
  stockRuntimeCache.globalSearchKey = key;
  stockRuntimeCache.globalSearchItems = [...map.values()].map((item) => ({
    ...item,
    sources: [...item.sources],
    searchText: [item.symbol, item.name, item.sector, ...item.sources].join(" ").toLowerCase(),
  }));
  return stockRuntimeCache.globalSearchItems;
};

const globalPageSearchItems = () =>
  pageModules
    .filter((item) => !["dashboard", "subscription", "courses", "strategies", "live"].includes(item.id))
    .map((item) => ({
      type: "page",
      id: item.id,
      title: item.title,
      nav: item.nav,
      summary: item.summary,
      searchText: [item.title, item.nav, item.kicker, item.summary].join(" ").toLowerCase(),
    }));

const globalSectorSearchItems = () =>
  dashboardIndustryRows(sectorFlowDisplayRows())
    .map((item) => ({
      type: "sector",
      sector: item.sector,
      title: sectorDisplayName(item.sector),
      summary: `${item.status || "板块资金观察"} · ${Math.round(item.breadthPct || 0)}%上涨`,
      metric: item.netFlowProxy == null ? formatSignedPct(item.avgChange || 0) : formatSignedCompactMoney(item.netFlowProxy, item.netFlowLabel),
      tone: Number(item.netFlowProxy ?? item.avgChange) >= 0 ? "is-positive" : "is-negative",
      searchText: [item.sector, sectorDisplayName(item.sector), item.status, ...(item.leaders || []).map((leader) => leader.symbol)].join(" ").toLowerCase(),
    }));

const globalCalendarSearchItems = () =>
  calendarRows()
    .filter((item) => item.type !== "manual")
    .slice(0, 120)
    .map((item) => ({
      type: "calendar",
      id: item.id || `${item.date}-${item.title}`,
      title: item.title || "财经日历",
      summary: `${eventTypeLabel(item.type)} · ${calendarDayDistanceLabel(item)} · ${calendarScopeText(item)}`,
      metric: eventImpactLabel(item.impact),
      tone: item.impact === "high" ? "is-negative" : item.impact === "medium" ? "is-neutral" : "",
      searchText: [
        item.title,
        item.summary,
        item.sourceName,
        item.type,
        eventTypeLabel(item.type),
        eventImpactLabel(item.impact),
        ...splitReferenceList(item.relatedAssets),
        ...splitReferenceList(item.relatedModules),
      ].join(" ").toLowerCase(),
    }));

const globalEventSearchItems = () =>
  allEventRows()
    .slice(0, 120)
    .map((item) => {
      const symbol = normalizeStockSymbol(item.ticker || item.symbol);
      const label = displayEventLabel(item, "股票事件");
      return {
        type: "event",
        symbol,
        title: symbol ? `${symbol} · ${label}` : label,
        summary: eventReasonForUser(item),
        metric: item.eventDate ? formatDisplayDate(item.eventDate) : "事件",
        tone: "is-neutral",
        searchText: [symbol, item.companyName, item.company, label, item.reason, item.eventType, eventReasonForUser(item)].join(" ").toLowerCase(),
      };
    });

const filterGlobalSearchItems = (items, clean, limit) =>
  items
    .map((item) => {
      const text = item.searchText || "";
      const title = String(item.title || item.sector || item.symbol || "").toLowerCase();
      const exact = title === clean;
      const starts = title.startsWith(clean);
      const includes = text.includes(clean);
      if (!exact && !starts && !includes) return null;
      return { ...item, score: exact ? 0 : starts ? 1 : 2 };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || String(a.title || a.symbol || "").localeCompare(String(b.title || b.symbol || "")))
    .slice(0, limit);

const globalSearchResults = (query) => {
  const clean = String(query || "").trim().toLowerCase();
  if (!clean) return { stocks: [], sectors: [], calendar: [], events: [], pages: [] };
  const dbSearch = state.globalSearchStocks?.key === clean ? state.globalSearchStocks : null;
  const stocks = dbSearch?.ok
    ? dbSearch.rows.slice(0, GLOBAL_SEARCH_LIMIT)
    : buildGlobalSearchItems()
      .map((item) => {
        const symbolMatch = item.symbol.toLowerCase().startsWith(clean);
        const exact = item.symbol.toLowerCase() === clean;
        const includes = item.searchText.includes(clean);
        if (!symbolMatch && !includes) return null;
        return { ...item, score: exact ? 0 : symbolMatch ? 1 : 2 };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score || a.symbol.localeCompare(b.symbol))
      .slice(0, GLOBAL_SEARCH_LIMIT);
  const sectors = filterGlobalSearchItems(globalSectorSearchItems(), clean, 4);
  const calendar = filterGlobalSearchItems(globalCalendarSearchItems(), clean, 4);
  const events = filterGlobalSearchItems(globalEventSearchItems(), clean, 4);
  const pages = filterGlobalSearchItems(globalPageSearchItems(), clean, 4);
  return { stocks, sectors, calendar, events, pages };
};

const flattenGlobalResults = () =>
  [...document.querySelectorAll("[data-global-search-result]")];

const closeGlobalSearch = () => {
  const panel = document.querySelector("#globalSearchResults");
  const input = document.querySelector("#globalSearchInput");
  if (panel) {
    panel.hidden = true;
    panel.innerHTML = "";
  }
  if (input) input.setAttribute("aria-expanded", "false");
  state.globalSearchIndex = -1;
};

const openGlobalResult = (item) => {
  if (!item) return;
  const type = item.dataset.resultType;
  if (type === "stock") {
    closeGlobalSearch();
    openStockHub(item.dataset.symbol);
    return;
  }
  if (type === "page") {
    closeGlobalSearch();
    showPage(item.dataset.page);
  }
  if (type === "sector") {
    closeGlobalSearch();
    state.selectedMarketSector = item.dataset.sector || "";
    state.marketWorkspaceSection = "sectors";
    state.marketVisualMode = "sectors";
    showPage("market", { hash: "#market/sectors" });
    renderMarketVisualBoard();
    return;
  }
  if (type === "calendar") {
    closeGlobalSearch();
    showPage("events");
    return;
  }
  if (type === "event") {
    closeGlobalSearch();
    const symbol = item.dataset.symbol;
    if (symbol) {
      openStockHub(symbol);
      return;
    }
    showPage("stock-events");
  }
};

const setGlobalSearchActive = (index) => {
  const items = flattenGlobalResults();
  state.globalSearchIndex = items.length ? Math.max(0, Math.min(index, items.length - 1)) : -1;
  items.forEach((item, itemIndex) => {
    const active = itemIndex === state.globalSearchIndex;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-selected", active ? "true" : "false");
  });
};

const ensureGlobalSearchContext = (query) => {
  const clean = String(query || "").trim();
  const key = clean.toLowerCase();
  const refreshIfCurrent = () => {
    if (document.querySelector("#globalSearchInput")?.value.trim() === query) renderGlobalSearchResults();
  };
  if (clean && state.globalSearchStocks?.key !== key && state.loading.globalSearchStocks?.key !== key) {
    loadGlobalStockSearch(clean).then((result) => {
      if (result?.ok === false && !state.searchUniverse && !state.loading.searchUniverse) {
        loadGlobalSearchUniverse().then(refreshIfCurrent);
        return;
      }
      refreshIfCurrent();
    });
  }
  if (state.productSectors === undefined && !state.loading.productSectors) {
    loadProductSectors().then(refreshIfCurrent);
  }
  if (state.productCalendar === undefined && !state.loading.productCalendar) {
    loadProductCalendar().then(refreshIfCurrent);
  }
  if (!state.eventOpportunities && !state.loading.eventOpportunities) {
    loadLazyDataset("eventOpportunities").then(refreshIfCurrent);
  }
};

const globalSearchStockContext = (item) => {
  const row = normalizeStockLibraryItem(item);
  const change = Number.isFinite(row.dayChange) ? row.dayChange : parseSignedPercent(item.change);
  const decision = stockLibraryDecision(row);
  const sectorFlow = stockLibrarySectorFlow(row);
  const calendar = stockLibraryCalendarSummary(row);
  const changeClass = Number.isFinite(change) && change !== 0 ? (change > 0 ? "is-positive" : "is-negative") : "";
  const profile = [row.name, sectorDisplayName(row.sector), row.marketCap && row.marketCap !== "--" ? row.marketCap : ""]
    .filter(Boolean)
    .join(" · ");
  const calendarText = calendar.title === "暂无日程"
    ? calendar.meta
    : `${calendar.meta} · ${compactText(calendar.title, 28)}`;
  return {
    row,
    change,
    changeClass,
    profile,
    decision,
    sectorFlow,
    calendar,
    calendarText,
  };
};

const renderGlobalSearchResults = () => {
  const input = document.querySelector("#globalSearchInput");
  const panel = document.querySelector("#globalSearchResults");
  if (!input || !panel) return;
  const query = input.value.trim();
  state.globalSearchQuery = query;
  if (!query) {
    closeGlobalSearch();
    return;
  }
  ensureGlobalSearchContext(query);
  const { stocks, sectors, calendar, events, pages } = globalSearchResults(query);
  const queryKey = query.toLowerCase();
  const isLoadingStockSearch = state.loading.globalSearchStocks?.key === queryKey || (state.loading.searchUniverse && state.globalSearchStocks?.key === queryKey && state.globalSearchStocks?.ok === false);
  if (!stocks.length && isLoadingStockSearch) {
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
    panel.innerHTML = `
      <div class="global-search-empty">
        <strong>正在搜索股票库</strong>
        <span>稍后会显示匹配的股票和页面。</span>
      </div>
    `;
    state.globalSearchIndex = -1;
    return;
  }
  if (!stocks.length && !sectors.length && !calendar.length && !events.length && !pages.length) {
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
    panel.innerHTML = `
      <div class="global-search-empty">
        <strong>未找到匹配结果</strong>
        <span>可以输入股票代码、公司名、板块名、事件名称，或进入股票库查看覆盖范围。</span>
      </div>
    `;
    state.globalSearchIndex = -1;
    return;
  }
  panel.hidden = false;
  input.setAttribute("aria-expanded", "true");
  panel.innerHTML = `
    ${stocks.length ? `
      <div class="global-search-group">股票</div>
      ${stocks.map((item) => {
        const context = globalSearchStockContext(item);
        const sourceChips = stockLibrarySourceChips(context.row);
        return `
          <button class="global-search-result global-search-stock-result" type="button" role="option" data-global-search-result data-result-type="stock" data-symbol="${escapeHtml(item.symbol)}">
            <strong>${escapeHtml(item.symbol)}</strong>
            <span>${escapeHtml(context.profile || item.sources.join(" / "))}</span>
            <em class="${escapeHtml(context.changeClass)}">${escapeHtml(Number.isFinite(context.change) ? formatSignedPct(context.change) : context.row.sources[0] || "股票")}</em>
            <small class="global-search-flow">资金 ${escapeHtml(context.sectorFlow.netFlow)} · ${escapeHtml(context.sectorFlow.label)} · 广度 ${escapeHtml(context.sectorFlow.breadth)}</small>
            <small class="global-search-calendar">日程 ${escapeHtml(context.calendarText || "先看财经日历")}</small>
            <i class="${escapeHtml(context.decision.className)}">${escapeHtml(context.decision.title)}</i>
            <span class="global-search-source-chips">${sourceChips}</span>
          </button>
        `;
      }).join("")}
    ` : ""}
    ${sectors.length ? `
      <div class="global-search-group">板块</div>
      ${sectors.map((item) => `
        <button class="global-search-result global-search-compact-result" type="button" role="option" data-global-search-result data-result-type="sector" data-sector="${escapeHtml(item.sector)}">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.summary)}</span>
          <em class="${escapeHtml(item.tone)}">${escapeHtml(item.metric)}</em>
        </button>
      `).join("")}
    ` : ""}
    ${calendar.length ? `
      <div class="global-search-group">财经日历</div>
      ${calendar.map((item) => `
        <button class="global-search-result global-search-compact-result" type="button" role="option" data-global-search-result data-result-type="calendar" data-calendar-id="${escapeHtml(item.id)}">
          <strong>${escapeHtml(compactText(item.title, 14))}</strong>
          <span>${escapeHtml(item.summary)}</span>
          <em class="${escapeHtml(item.tone)}">${escapeHtml(item.metric)}</em>
        </button>
      `).join("")}
    ` : ""}
    ${events.length ? `
      <div class="global-search-group">事件线索</div>
      ${events.map((item) => `
        <button class="global-search-result global-search-compact-result" type="button" role="option" data-global-search-result data-result-type="event" data-symbol="${escapeHtml(item.symbol)}">
          <strong>${escapeHtml(compactText(item.title, 14))}</strong>
          <span>${escapeHtml(compactText(item.summary, 58))}</span>
          <em class="${escapeHtml(item.tone)}">${escapeHtml(item.metric)}</em>
        </button>
      `).join("")}
    ` : ""}
    ${pages.length ? `
      <div class="global-search-group">页面</div>
      ${pages.map((item) => `
        <button class="global-search-result" type="button" role="option" data-global-search-result data-result-type="page" data-page="${escapeHtml(item.id)}">
          <strong>${escapeHtml(item.nav)}</strong>
          <span>${escapeHtml(item.title)} · ${escapeHtml(item.summary)}</span>
          <em>打开</em>
        </button>
      `).join("")}
    ` : ""}
  `;
  setGlobalSearchActive(0);
};

const stockCapBucketFromItem = (item) => {
  const cap = marketCapNumber(item.marketCap);
  if (cap == null) return "unknown";
  if (cap >= 10000) return "large";
  if (cap >= 1000) return "mid";
  return "small";
};

const normalizeStockLibraryItem = (item) => {
  const symbol = normalizeStockSymbol(item.symbol || item.ticker);
  const product = findProductProfile(symbol) || item;
  const market = findMarketRow(symbol);
  const strength = findStrengthRow(symbol);
  const quality = findQualityRow(symbol);
  const eventRow = findEventRow(symbol);
  const signal = signalStateForSymbol(symbol);
  const day = getBoardRow("day", symbol) || market;
  const week = getBoardRow("week", symbol);
  const month = getBoardRow("month", symbol);
  const ytd = getBoardRow("ytd", symbol);
  const name = product?.name || product?.company || item.name || market?.company || market?.chineseName || strength?.name || quality?.companyName || "";
  const sector = sectorDisplayName(product?.sector || item.sector || market?.sector || strength?.sectorProxy || signal?.theme);
  const change = market ? getChange(market) : parseSignedPercent(item.change);
  const marketCap = product?.marketCap || item.marketCap || market?.marketCap || "--";
  const dollarVolume = Number(product?.dollarVolume || item.dollarVolume || item.volume || market?.dollarVolume || market?.volumeDollar || quality?.dollarVolume20d || 0);
  const volumeRatio = product?.volumeRatio || market?.volumeRatio || strength?.crowding?.volumeRatio || "";
  const sources = new Set([...(item.sources || [])]);
  if (product) sources.add("产品库");
  if (market) sources.add("行情");
  if (strength) sources.add("强弱");
  if (quality) sources.add("财报");
  if (eventRow) sources.add("事件");
  if (isInWatchlist(symbol)) sources.add("自选");
  return {
    symbol,
    name,
    sector,
    change,
    price: product?.price ?? market?.price ?? strength?.price ?? quality?.close ?? eventRow?.close,
    marketCap,
    capBucket: stockCapBucketFromItem({ marketCap }),
    dollarVolume,
    volumeRatio,
    dayChange: Number.isFinite(Number(item.dayChange)) ? Number(item.dayChange) : day ? getChange(day) : change,
    weekChange: Number.isFinite(Number(item.weekChange)) ? Number(item.weekChange) : week ? getChange(week) : null,
    monthChange: Number.isFinite(Number(item.monthChange)) ? Number(item.monthChange) : month ? getChange(month) : null,
    ytdChange: Number.isFinite(Number(item.ytdChange)) ? Number(item.ytdChange) : ytd ? getChange(ytd) : null,
    strengthRank: strength?.rank,
    strengthScore: strength?.score,
    strengthLabel: item.strengthLabel || strength?.label,
    relativeStrength: strength?.relative?.spy || strength?.relative?.qqq || strength?.relative?.sector || "",
    eventLabel: item.eventLabel || eventRow?.eventLabel || "",
    eventDate: item.eventDate || eventRow?.eventDate || "",
    qualityLabel: item.qualityLabel || quality?.userAngle || "",
    qualityScore: item.qualityScore ?? quality?.score,
    hasEvent: Boolean(item.hasEvent || eventRow),
    inWatchlist: isInWatchlist(symbol),
    sources: [...sources],
    market,
    strength,
    quality,
    eventRow,
    signal,
  };
};

const stockLibraryRows = () => {
  allQualityRows();
  allEventRows();
  const key = [
    rowsSignature(state.productSymbols || []),
    rowsSignature(state.searchUniverse || []),
    boardsSignature(),
    rowsSignature(state.strength?.rows || []),
    stockRuntimeCache.qualityRowsKey,
    stockRuntimeCache.eventRowsKey,
    watchlistSignature(),
    state.signals?.updatedAt || state.signals?.asOf || "",
  ].join("|");
  if (stockRuntimeCache.stockLibraryKey === key && stockRuntimeCache.stockLibraryRows) {
    return stockRuntimeCache.stockLibraryRows;
  }
  const map = new Map();
  (state.productSymbols || []).forEach((row) => mergeSearchRow(map, row, "产品库"));
  (state.searchUniverse || []).forEach((row) => mergeSearchRow(map, row, "覆盖池"));
  buildGlobalSearchItems().forEach((row) => mergeSearchRow(map, row, row.sources?.[0] || "搜索"));
  stockRuntimeCache.stockLibraryKey = key;
  stockRuntimeCache.stockLibraryRows = [...map.values()]
    .map(normalizeStockLibraryItem)
    .filter((item) => item.symbol)
    .sort((a, b) => {
      if (b.dollarVolume !== a.dollarVolume) return b.dollarVolume - a.dollarVolume;
      return a.symbol.localeCompare(b.symbol);
    });
  return stockRuntimeCache.stockLibraryRows;
};

const filteredStockLibraryRows = () => {
  const query = state.stocksQuery.trim().toLowerCase();
  return stockLibraryRows().filter((item) => {
    const matchesQuery = !query || [item.symbol, item.name, item.sector].join(" ").toLowerCase().includes(query);
    const matchesPreset =
      state.stocksPresetFilter === "all" ||
      (state.stocksPresetFilter === "liquid" && item.dollarVolume >= STOCK_LIQUID_DOLLAR_VOLUME_MIN) ||
      (state.stocksPresetFilter === "watchlist" && item.inWatchlist) ||
      (state.stocksPresetFilter === "event" && item.hasEvent);
    const matchesSector = state.stocksSectorFilter === "all" || item.sector === state.stocksSectorFilter;
    const matchesCap = state.stocksCapFilter === "all" || item.capBucket === state.stocksCapFilter;
    return matchesQuery && matchesPreset && matchesSector && matchesCap;
  });
};

const stockLibrarySortValue = (item, key) => {
  if (key === "marketCap") return marketCapNumber(item.marketCap) || 0;
  if (key === "symbol") return item.symbol || "";
  return Number(item[key]);
};

const sortedStockLibraryRows = (rows) => {
  const sortKey = state.stocksSort || "dollarVolume";
  return rows.slice().sort((a, b) => {
    if (sortKey === "symbol") return String(a.symbol || "").localeCompare(String(b.symbol || ""));
    const left = stockLibrarySortValue(a, sortKey);
    const right = stockLibrarySortValue(b, sortKey);
    const leftScore = Number.isFinite(left) ? left : -Infinity;
    const rightScore = Number.isFinite(right) ? right : -Infinity;
    if (rightScore !== leftScore) return rightScore - leftScore;
    return String(a.symbol || "").localeCompare(String(b.symbol || ""));
  });
};

const stocksSortLabel = () => ({
  dollarVolume: "成交额降序",
  dayChange: "1D 涨跌降序",
  weekChange: "5D 涨跌降序",
  monthChange: "1M 涨跌降序",
  ytdChange: "YTD 涨跌降序",
  marketCap: "市值降序",
  symbol: "代码升序",
}[state.stocksSort] || "成交额降序");

const setStocksSort = (sortKey) => {
  state.stocksSort = sortKey || "dollarVolume";
  const sort = document.querySelector("#stocksSortFilter");
  if (sort) sort.value = state.stocksSort;
  renderStocksPage();
};

const syncStocksTableSortState = () => {
  const table = document.querySelector(".stocks-terminal-table");
  if (!table) return;
  const sortKey = state.stocksSort || "dollarVolume";
  table.dataset.sort = sortKey;
  table.querySelectorAll("th[data-sort-column]").forEach((cell) => {
    const active = cell.dataset.sortColumn === sortKey;
    cell.classList.toggle("is-active-sort", active);
    cell.setAttribute("role", "button");
    cell.setAttribute("tabindex", "0");
    cell.setAttribute("aria-sort", active ? (sortKey === "symbol" ? "ascending" : "descending") : "none");
  });
};

const syncStocksPresetButtons = () => {
  document.querySelectorAll("[data-stocks-preset]").forEach((button) => {
    const active = button.dataset.stocksPreset === state.stocksPresetFilter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
};

const renderStocksSectorOptions = (rows) => {
  const select = document.querySelector("#stocksSectorFilter");
  if (!select) return;
  const current = select.value || state.stocksSectorFilter;
  const sectors = [...new Set(rows.map((item) => item.sector).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  select.innerHTML = '<option value="all">全部板块</option>' + sectors.map((sector) => `<option value="${escapeHtml(sector)}">${escapeHtml(sector)}</option>`).join("");
  select.value = sectors.includes(current) ? current : "all";
  state.stocksSectorFilter = select.value;
};

const stockLibraryDecision = (item) => {
  const day = Number(item.dayChange);
  const month = Number(item.monthChange);
  const volumeRatio = parseRatio(item.volumeRatio);
  if (item.hasEvent && volumeRatio >= 1.5) {
    return {
      title: "事件 + 成交确认",
      note: `${formatVolumeRatioLabel(item.volumeRatio)}，先看事件是否能解释放量。`,
      className: "is-positive",
    };
  }
  if (item.hasEvent) {
    return {
      title: "事件待确认",
      note: item.eventDate || "事件日期待补，进详情页看原因链。",
      className: "is-neutral",
    };
  }
  if (Number.isFinite(month) && month >= 20 && Number.isFinite(volumeRatio) && volumeRatio >= 1.2) {
    return {
      title: "强势延续",
      note: `20D ${formatSignedPct(month)}，成交额 ${formatVolumeRatioLabel(item.volumeRatio)}。`,
      className: "is-positive",
    };
  }
  if (Number.isFinite(day) && day < -5 && Number.isFinite(volumeRatio) && volumeRatio >= 1.5) {
    return {
      title: "放量承压",
      note: `1D ${formatSignedPct(day)}，先看风险和同板块扩散。`,
      className: "is-negative",
    };
  }
  if (item.qualityScore != null || item.qualityLabel) {
    return {
      title: "财报线索",
      note: item.qualityLabel || `${Number(item.qualityScore).toFixed(1)}分`,
      className: "is-neutral",
    };
  }
  if (item.dollarVolume >= STOCK_LIQUID_DOLLAR_VOLUME_MIN) {
    return {
      title: "高流动性观察",
      note: "先用价格、成交额和板块表现筛选。",
      className: "is-neutral",
    };
  }
  return {
    title: "低频观察",
    note: "流动性或线索不足，优先级靠后。",
    className: "is-muted",
  };
};

const stockLibrarySectorFlow = (item) => {
  const sector = sectorDisplayName(item.sector);
  const sectorRows = isKnownSector(sector)
    ? uniqueBySymbol(allMarketRows().filter((row) => sectorDisplayName(row.sector) === sector))
    : [];
  return stockSectorFlowDetail({ ...stockDisplayName(item.symbol), sector }, sectorRows);
};

const stockLibraryPeerPosition = (item) => {
  const target = normalizeStockSymbol(item.symbol);
  const sector = sectorDisplayName(item.sector);
  const sectorRows = isKnownSector(sector)
    ? uniqueBySymbol(allMarketRows().filter((row) => sectorDisplayName(row.sector) === sector))
    : [];
  const changeRows = sectorRows.slice().sort((a, b) => getChange(b) - getChange(a));
  const rank = changeRows.findIndex((row) => normalizeStockSymbol(row.symbol) === target) + 1;
  const capRows = sectorRows
    .filter((row) => marketCapNumber(row.marketCap) != null)
    .sort((a, b) => marketCapNumber(b.marketCap) - marketCapNumber(a.marketCap));
  const capRank = capRows.findIndex((row) => normalizeStockSymbol(row.symbol) === target) + 1;
  return {
    rankText: rank > 0 ? `${rank}/${changeRows.length}` : "--",
    capRankText: capRank > 0 ? `${capRank}/${capRows.length}` : "--",
  };
};

const stockLibraryVolumeState = (item) => {
  const ratio = parseRatio(item.volumeRatio);
  const day = Number(item.dayChange);
  if (Number.isFinite(ratio) && ratio >= 1.5 && Number.isFinite(day) && day > 0) {
    return { label: "放量上涨", note: `成交额 ${formatVolumeRatioLabel(item.volumeRatio)}`, className: "is-positive" };
  }
  if (Number.isFinite(ratio) && ratio >= 1.5 && Number.isFinite(day) && day < 0) {
    return { label: "放量下跌", note: `成交额 ${formatVolumeRatioLabel(item.volumeRatio)}`, className: "is-negative" };
  }
  if (Number.isFinite(ratio) && ratio >= 1.2) {
    return { label: "成交活跃", note: `成交额 ${formatVolumeRatioLabel(item.volumeRatio)}`, className: "is-neutral" };
  }
  if (item.dollarVolume >= STOCK_LIQUID_DOLLAR_VOLUME_MIN) {
    return { label: "流动性可用", note: formatCompactMoney(item.dollarVolume), className: "is-muted" };
  }
  return { label: "低流动性", note: item.dollarVolume ? formatCompactMoney(item.dollarVolume) : "--", className: "is-muted" };
};

const stockLibraryCatalystSummary = (item, calendar) => {
  if (item.eventRow) {
    return {
      title: displayEventLabel(item.eventRow, "股票事件"),
      meta: item.eventRow.eventDate ? `${formatDisplayDate(item.eventRow.eventDate)} · 事件` : "事件日期待补",
      className: "is-neutral",
    };
  }
  if (item.quality) {
    const date = item.quality.latestEarningsDate || item.quality.reportDate;
    return {
      title: item.quality.userAngle || item.qualityLabel || "财报线索",
      meta: date ? `${formatDisplayDate(date)} · 财报` : "财报日期待补",
      className: "is-neutral",
    };
  }
  return calendar;
};

const stockLibraryCalendarSummary = (item) => {
  const target = normalizeStockSymbol(item.symbol);
  const profile = stockDisplayName(target);
  const macroExposure = stockMacroExposure(profile, item.market || findMarketRow(target));
  const rows = stockLinkedCalendarRows({ target, profile, macroExposure, quality: item.quality || findQualityRow(target) });
  const direct = rows.find((row) => row.matchType === "direct") || rows[0];
  if (!direct) {
    return {
      title: item.eventLabel || item.qualityLabel || "暂无日程",
      meta: item.eventDate || item.quality?.latestEarningsDate || "先看财经日历整体事件",
      className: "is-muted",
    };
  }
  return {
    title: direct.title || eventTypeLabel(direct.type),
    meta: `${formatDisplayDate(direct.date)} · ${eventTypeLabel(direct.type)}${rows.length > 1 ? ` · ${rows.length}条` : ""}`,
    className: direct.impact === "high" ? "is-negative" : direct.impact === "medium" ? "is-neutral" : "is-muted",
  };
};

const stockLibrarySourceChips = (item) => {
  const preferred = ["自选", "事件", "财报", "强弱", "行情", "产品库"];
  const sources = preferred.filter((source) => item.sources.includes(source));
  return (sources.length ? sources : item.sources.slice(0, 3))
    .map((source) => `<b>${escapeHtml(source)}</b>`)
    .join("");
};

const formatStockCellPct = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? formatSignedPct(number) : "--";
};

const stockPctClass = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "";
  return number > 0 ? "is-positive" : "is-negative";
};

const stocksCapLabel = (bucket) => {
  if (bucket === "large") return "大盘";
  if (bucket === "mid") return "中盘";
  if (bucket === "small") return "小盘";
  return "待补";
};

const stockLibraryTopBy = (rows, key, direction = "desc", limit = 5) =>
  rows
    .filter((item) => Number.isFinite(Number(item[key])))
    .slice()
    .sort((a, b) => {
      const delta = Number(b[key]) - Number(a[key]);
      if (delta !== 0) return direction === "asc" ? -delta : delta;
      return String(a.symbol || "").localeCompare(String(b.symbol || ""));
    })
    .slice(0, limit);

const stockRankRow = (item, metric, className = "", index = 0) => {
  const value = metric === "volume"
    ? formatCompactMoney(item.dollarVolume)
    : metric === "ratio"
      ? formatVolumeRatioLabel(item.volumeRatio)
      : formatStockCellPct(item[metric]);
  const subtitle = metric === "volume"
    ? `${sectorDisplayName(item.sector)} · ${formatVolumeRatioLabel(item.volumeRatio)}`
    : `${sectorDisplayName(item.sector)} · ${item.marketCap || "--"}`;
  return `
    <button class="stocks-rank-row" type="button" data-stock-open="${escapeHtml(item.symbol)}">
      <i>${escapeHtml(String(index + 1).padStart(2, "0"))}</i>
      <strong>${escapeHtml(item.symbol)}</strong>
      <span>${escapeHtml(compactText(item.name || sectorDisplayName(item.sector), 22))}</span>
      <em class="${escapeHtml(className)}">${escapeHtml(value)}</em>
      <small>${escapeHtml(subtitle)}</small>
    </button>
  `;
};

const renderStocksRankStrip = (rows) => {
  const strip = document.querySelector("#stocksRankStrip");
  if (!strip) return;
  if (!rows.length) {
    strip.innerHTML = `<div class="stocks-rank-empty">当前筛选下暂无可展示的榜单速览。</div>`;
    return;
  }
  const gainers = stockLibraryTopBy(rows, "dayChange", "desc", 5).filter((item) => Number(item.dayChange) > 0);
  const losers = stockLibraryTopBy(rows, "dayChange", "asc", 5).filter((item) => Number(item.dayChange) < 0);
  const active = stockLibraryTopBy(rows, "dollarVolume", "desc", 5);
  const panels = [
    {
      title: "涨幅前排",
      note: "按当前筛选的 1D 涨幅排序",
      rows: gainers,
      metric: "dayChange",
      className: "is-positive",
    },
    {
      title: "跌幅前排",
      note: "按当前筛选的 1D 跌幅排序",
      rows: losers,
      metric: "dayChange",
      className: "is-negative",
    },
    {
      title: "成交额前排",
      note: "优先看资金关注度",
      rows: active,
      metric: "volume",
      className: "",
    },
  ];
  strip.innerHTML = panels.map((panel) => `
    <article class="stocks-rank-panel">
      <header>
        <span>${escapeHtml(panel.title)}</span>
        <em>${escapeHtml(panel.note)}</em>
      </header>
      <div>
        ${panel.rows.length
          ? panel.rows.map((item, index) => stockRankRow(item, panel.metric, panel.className, index)).join("")
          : '<p class="stocks-rank-empty">暂无匹配标的。</p>'}
      </div>
    </article>
  `).join("");
};

const renderStocksPage = () => {
  const body = document.querySelector("#stocksTableBody");
  if (!body) return;
  syncStocksTableSortState();
  syncStocksPresetButtons();
  const asOf = state.meta?.day?.updatedAt || state.marketTemperature?.asOf || "";
  setText("#stocksAsOf", formatDisplayDate(asOf));
  if (!state.productSectors && !state.loading.productSectors) {
    loadProductSectors().then(renderStocksPage);
  }
  const requestKey = stockLibraryApiKey();
  const hasCurrentApiRows = state.productStockLibrary?.key === requestKey && state.productStockLibrary.ok;
  const loadingCurrentApiRows = state.loading.productStockLibrary?.key === requestKey;
  if (!hasCurrentApiRows && !loadingCurrentApiRows) {
    loadProductStockLibrary().then(renderStocksPage);
  }
  const sectorOptionRows = state.productSectors?.length
    ? state.productSectors
    : hasCurrentApiRows
      ? state.productStockLibrary.rows
      : [];
  renderStocksSectorOptions(sectorOptionRows);
  let rows = [];
  let totalRows = 0;
  let usingApiRows = false;
  if (hasCurrentApiRows) {
    rows = state.productStockLibrary.rows.map(normalizeStockLibraryItem);
    totalRows = Number(state.productStockLibrary.total || rows.length);
    usingApiRows = true;
  } else if (state.productStockLibrary?.key === requestKey && state.productStockLibrary.ok === false) {
    if (!state.searchUniverse && !state.loading.searchUniverse) {
      loadGlobalSearchUniverse().then(renderStocksPage);
    }
    const filteredRows = filteredStockLibraryRows();
    rows = sortedStockLibraryRows(filteredRows).slice(0, STOCK_LIBRARY_DISPLAY_LIMIT);
    totalRows = filteredRows.length;
  } else {
    body.innerHTML = `<tr><td colspan="14">正在加载股票库。</td></tr>`;
  }
  const coverage = state.productCoverage || {};
  const symbolCoverage = coverage.symbols || {};
  const calendarCounts = Object.fromEntries((coverage.calendar || []).map((row) => [row.type, Number(row.rows || 0)]));
  const unknownSector = Number(symbolCoverage.unknownSector || 0);
  const coverageStatus = state.stocksPresetFilter === "all" ? "成交额优先" : state.stocksPresetFilter === "liquid" ? "$5M+" : "按筛选";
  const sortMetric = {
    dollarVolume: "成交额",
    dayChange: "1D",
    weekChange: "5D",
    monthChange: "1M",
    ytdChange: "YTD",
    marketCap: "市值",
    symbol: "代码",
  }[state.stocksSort] || "成交额";
  const label = state.stocksQuery
    ? `搜索：${state.stocksQuery}`
    : state.stocksPresetFilter === "liquid"
      ? "高流动性 · 成交额 $5M+"
      : state.stocksPresetFilter === "watchlist"
        ? "自选"
        : state.stocksPresetFilter === "event"
          ? "事件关联"
          : "全部股票";
  setText("#stocksResultLabel", `${label} · ${stocksSortLabel()}`);
  setText("#stocksCurrentCount", label.replace(" · 成交额 $5M+", ""));
  setText(
    "#stocksCurrentNote",
    rows.length < totalRows
      ? "列表保留排序前排，精搜可继续定位全库标的。"
      : "表格已按当前筛选展示。"
  );
  setText("#stocksCoverageStatus", coverageStatus);
  setText("#stocksCoverageNote", usingApiRows ? "默认按成交额和筛选条件收敛，避免低流动性噪音。" : "当前使用本地缓存筛选，精搜仍可定位标的。");
  setText("#stocksSectorGap", unknownSector ? "待补" : "完整");
  setText(
    "#stocksSectorGapNote",
    unknownSector
      ? `少量长尾标的板块或市值待补，不参与关键判断。`
      : "主要板块分类与市值字段已接入。",
  );
  setText("#stocksCalendarStatus", calendarCounts.earnings ? "宏观+财报" : calendarCounts.macro ? "宏观已接" : "待接入");
  setText(
    "#stocksCalendarNote",
    calendarCounts.earnings
      ? "个股财报日期会在详情页和日程列里联动。"
      : "财报日期源下一步接入，人工日志单独展示。",
  );
  setText("#stocksSortMetric", sortMetric);
  renderStocksRankStrip(rows);
  if (!rows.length) {
    if (loadingCurrentApiRows && !state.productStockLibrary?.ok) {
      body.innerHTML = `<tr><td colspan="14">正在加载股票库。</td></tr>`;
    } else {
      body.innerHTML = `<tr><td colspan="14">当前筛选下暂无结果。</td></tr>`;
    }
    return;
  }
  body.innerHTML = rows
    .map((item) => {
      const price = Number(item.price);
      const decision = stockLibraryDecision(item);
      const sectorFlow = stockLibrarySectorFlow(item);
      const peerPosition = stockLibraryPeerPosition(item);
      const volumeState = stockLibraryVolumeState(item);
      const calendar = stockLibraryCatalystSummary(item, stockLibraryCalendarSummary(item));
      const sourceChips = stockLibrarySourceChips(item);
      const volumeRatioLabel = formatVolumeRatioLabel(item.volumeRatio);
      const capLabelText = stocksCapLabel(item.capBucket);
      return `
        <tr>
          <td class="stocks-symbol-cell" data-label="代码">
            <div class="stocks-profile-head">
              <button class="inline-stock-link stocks-symbol-link" type="button" data-stock-open="${escapeHtml(item.symbol)}">${escapeHtml(item.symbol)}</button>
              ${item.inWatchlist ? '<span class="stocks-mini-flag">自选</span>' : ""}
            </div>
            <div class="stocks-source-chips">${sourceChips}</div>
          </td>
          <td class="stocks-company-cell" data-label="公司">
            <strong>${escapeHtml(item.name || "--")}</strong>
            <span>${escapeHtml(item.eventLabel || item.qualityLabel || item.strengthLabel || decision.title)}</span>
          </td>
          <td class="stocks-sector-cell" data-label="板块">
            <strong>${escapeHtml(sectorDisplayName(item.sector))}</strong>
            <span>${escapeHtml(`涨跌位置 ${peerPosition.rankText} · 广度 ${sectorFlow.breadth}`)}</span>
          </td>
          <td class="stocks-num-cell" data-label="市值">
            <strong>${escapeHtml(item.marketCap || "--")}</strong>
            <span>${escapeHtml(`${capLabelText} · 板块 ${peerPosition.capRankText}`)}</span>
          </td>
          <td class="stocks-num-cell" data-label="价格">${escapeHtml(Number.isFinite(price) ? formatMoney(price) : "--")}</td>
          <td class="stocks-num-cell ${escapeHtml(stockPctClass(item.dayChange))}" data-label="1D">${escapeHtml(formatStockCellPct(item.dayChange))}</td>
          <td class="stocks-num-cell ${escapeHtml(stockPctClass(item.weekChange))}" data-label="5D">${escapeHtml(formatStockCellPct(item.weekChange))}</td>
          <td class="stocks-num-cell ${escapeHtml(stockPctClass(item.monthChange))}" data-label="1M">${escapeHtml(formatStockCellPct(item.monthChange))}</td>
          <td class="stocks-num-cell ${escapeHtml(stockPctClass(item.ytdChange))}" data-label="YTD">${escapeHtml(formatStockCellPct(item.ytdChange))}</td>
          <td class="stocks-num-cell" data-label="成交额">${escapeHtml(item.dollarVolume ? formatCompactMoney(item.dollarVolume) : "--")}</td>
          <td class="stocks-volume-cell ${escapeHtml(volumeState.className)}" data-label="异动">
            <strong>${escapeHtml(volumeRatioLabel)}</strong>
            <span>${escapeHtml(volumeState.label)}</span>
          </td>
          <td class="stocks-flow-cell" data-label="板块资金">
            <strong class="${escapeHtml(sectorFlow.className)}">${escapeHtml(sectorFlow.netFlow)}</strong>
            <span>${escapeHtml(`${sectorFlow.label} · ${sectorFlow.activeValue}`)}</span>
          </td>
          <td class="stocks-calendar-cell ${escapeHtml(calendar.className)}" data-label="日程">
            <strong>${escapeHtml(calendar.title)}</strong>
            <span>${escapeHtml(calendar.meta)}</span>
          </td>
          <td class="stocks-action-cell" data-label="操作">
            <button class="table-action" type="button" data-stock-open="${escapeHtml(item.symbol)}">详情</button>
            <button class="table-action" type="button" data-watchlist-toggle="${escapeHtml(item.symbol)}" data-watchlist-source="股票库">${item.inWatchlist ? "已自选" : "自选"}</button>
          </td>
        </tr>
      `;
    })
    .join("");
};

const flowRows = () => {
  const volumeRows = state.boards?.volume || [];
  const dayRows = state.boards?.day || [];
  const rows = volumeRows.length ? volumeRows : dayRows;
  return rows
    .map((row) => {
      const day = getBoardRow("day", row.symbol);
      const market = getMarketDetailSource(row.symbol) || row;
      const change = day ? getChange(day) : getChange(market);
      const ratio = parseRatio(row.volumeRatio || market.volumeRatio);
      const signal = ratio >= 1.5 && change > 0
        ? "量价确认"
        : ratio >= 1.5 && change < 0
          ? "放量承压"
          : ratio >= 1.2
            ? "成交活跃"
            : "普通活跃";
      return {
        ...market,
        symbol: row.symbol,
        sector: market.sector || row.sector || "未分类",
        change,
        ratio,
        volumeRatio: row.volumeRatio || market.volumeRatio || (ratio ? `${ratio.toFixed(1)}x` : "--"),
        signal,
      };
    })
    .filter((row) => row.symbol)
    .sort((a, b) => b.ratio - a.ratio || Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 80);
};

const flowSectorRows = (rows) => {
  const map = new Map();
  rows.forEach((row) => {
    const key = row.sector || "未分类";
    const current = map.get(key) || { sector: key, count: 0, totalRatio: 0, upCount: 0, downCount: 0 };
    current.count += 1;
    current.totalRatio += Number.isFinite(row.ratio) ? row.ratio : 0;
    if (row.change >= 0) current.upCount += 1;
    else current.downCount += 1;
    map.set(key, current);
  });
  return [...map.values()]
    .map((item) => ({ ...item, avgRatio: item.totalRatio / Math.max(1, item.count) }))
    .sort((a, b) => b.avgRatio - a.avgRatio || b.count - a.count)
    .slice(0, 8);
};

const sectorPeriodChange = (sector, board = "week") => {
  const rows = (state.boards?.[board] || []).filter((row) => (row.sector || "未分类") === sector);
  if (!rows.length) return null;
  return rows.reduce((sum, row) => sum + getChange(row), 0) / rows.length;
};

const sectorFlowRows = () => {
  if (Array.isArray(state.sectorFlow?.rows) && state.sectorFlow.rows.length) return state.sectorFlow.rows;
  const map = new Map();
  flowRows().forEach((row) => {
    const sector = row.sector || "未分类";
    const liquidity = parseMoneyLabel(row.liquidity || row.volume || row.volumeDollar || row.dollarVolume);
    const signed = liquidity * Math.sign(row.change || 0);
    const current = map.get(sector) || {
      sector,
      count: 0,
      upCount: 0,
      downCount: 0,
      totalChange: 0,
      activeValue: 0,
      netFlowProxy: 0,
      leaders: [],
    };
    current.count += 1;
    current.upCount += row.change > 0 ? 1 : 0;
    current.downCount += row.change < 0 ? 1 : 0;
    current.totalChange += row.change || 0;
    current.activeValue += liquidity;
    current.netFlowProxy += signed;
    current.leaders.push({ symbol: row.symbol, change: row.change, liquidity: row.volumeRatio || row.volume || "--", marketCap: row.marketCap || "--" });
    map.set(sector, current);
  });
  return [...map.values()]
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      avgChange: item.totalChange / Math.max(1, item.count),
      breadthPct: (item.upCount / Math.max(1, item.count)) * 100,
      activeValueLabel: formatCompactMoney(item.activeValue),
      netFlowLabel: formatCompactMoney(item.netFlowProxy),
      status: item.netFlowProxy > 0 ? "流入领先" : item.netFlowProxy < 0 ? "流出压力" : "活跃分歧",
      leaders: item.leaders.slice(0, 5),
    }))
    .sort((a, b) => b.netFlowProxy - a.netFlowProxy || b.activeValue - a.activeValue)
    .map((item, index) => ({ ...item, rank: index + 1 }))
    .slice(0, 16);
};

const sectorFlowDisplayRows = () => {
  const rows = sectorFlowRows();
  const filtered = rows.filter((row) => isKnownSector(row.sector));
  return filtered.length >= 5 ? filtered : rows;
};

const formatSignedCompactMoney = (value, fallback = "") => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback || "--";
  const label = formatCompactMoney(number);
  return number > 0 ? `+${label}` : label;
};

const setMarketSectionMetric = (selector, value, tone = "") => {
  const node = document.querySelector(selector);
  if (!node) return;
  node.textContent = value == null || value === "" ? "--" : value;
  node.classList.remove("is-positive", "is-negative", "is-neutral");
  if (tone) node.classList.add(tone);
};

const marketSectionContext = (section, rows) => {
  const total = rows.length;
  const upCount = rows.filter((row) => getChange(row) >= 0).length;
  const downCount = Math.max(0, total - upCount);
  const top = rows[0];
  if (section === "sectors") {
    const sectorRows = industrySectorRows(sectorFlowDisplayRows().length ? sectorFlowDisplayRows() : marketSectorStats(rows));
    const topSector = sectorRows[0];
    const positiveCount = sectorRows.filter((item) => Number(item.netFlowProxy ?? item.avgChange) >= 0).length;
    const negativeCount = Math.max(0, sectorRows.length - positiveCount);
    const activeSector = sectorRows.slice().sort((a, b) => (b.activeValue || b.dollarVolume || 0) - (a.activeValue || a.dollarVolume || 0))[0];
    return {
      kicker: "板块排行",
      title: "板块排行",
      note: "按板块资金方向、成交活跃度和上涨广度排序，先确认主线是不是板块级扩散。",
      primaryLabel: "领先板块",
      primary: sectorDisplayName(topSector?.sector) || "--",
      primaryTone: Number(topSector?.netFlowProxy ?? topSector?.avgChange) >= 0 ? "is-positive" : "is-negative",
      secondaryLabel: "流入 / 流出",
      secondary: sectorRows.length ? `${positiveCount} / ${negativeCount}` : "--",
      tertiaryLabel: "成交活跃",
      tertiary: sectorDisplayName(activeSector?.sector) || "--",
    };
  }
  if (section === "flows") {
    const flowSectors = sectorFlowDisplayRows();
    const topFlow = flowSectors[0];
    const positiveCount = flowSectors.filter((item) => (item.netFlowProxy || 0) > 0).length;
    const negativeCount = flowSectors.filter((item) => (item.netFlowProxy || 0) < 0).length;
    return {
      kicker: "板块资金",
      title: "板块资金方向",
      note: "用板块成交额、涨跌方向和上涨广度做资金流向代理，观察钱更集中流向哪些方向。",
      primaryLabel: "流入领先",
      primary: topFlow ? sectorDisplayName(topFlow.sector) : "--",
      primaryTone: (topFlow?.netFlowProxy || 0) >= 0 ? "is-positive" : "is-negative",
      secondaryLabel: "流入 / 流出",
      secondary: flowSectors.length ? `${positiveCount} / ${negativeCount}` : "--",
      tertiaryLabel: "净方向",
      tertiary: topFlow ? formatSignedCompactMoney(topFlow.netFlowProxy, topFlow.netFlowLabel) : "--",
      tertiaryTone: (topFlow?.netFlowProxy || 0) >= 0 ? "is-positive" : "is-negative",
    };
  }
  if (section === "heatmap") {
    const tiles = knownSectorRows(rows)
      .map((row) => ({ ...row, heatSize: marketHeatmapSize(row) }))
      .sort((a, b) => b.heatSize - a.heatSize)
      .slice(0, 24);
    const upTiles = tiles.filter((row) => getChange(row) > 0).length;
    const downTiles = tiles.filter((row) => getChange(row) < 0).length;
    const topTile = tiles[0];
    return {
      kicker: "成交热力图",
      title: "成交额热力图",
      note: "面积代表成交活跃度，颜色代表涨跌方向，用来快速发现资金集中交易的股票和板块。",
      primaryLabel: "最大热区",
      primary: topTile?.symbol || "--",
      primaryTone: topTile && getChange(topTile) >= 0 ? "is-positive" : "is-negative",
      secondaryLabel: "涨 / 跌",
      secondary: tiles.length ? `${upTiles} / ${downTiles}` : "--",
      tertiaryLabel: "所属板块",
      tertiary: sectorDisplayName(topTile?.sector) || "--",
    };
  }
  const boardMeta = state.meta[state.activeBoard] || {};
  const volumeHot = rows.filter((row) => parseRatio(getBoardRow("volume", row.symbol)?.volumeRatio || row.volumeRatio) >= 2).length;
  return {
    kicker: "涨跌幅榜",
    title: "行情异动",
    note: "按涨跌幅、成交额、市值和风险标签筛出需要复盘的股票，再进入个股工作台确认原因。",
    primaryLabel: "当前榜单",
    primary: boardMeta.title || "涨跌幅榜",
    secondaryLabel: "涨 / 跌",
    secondary: total ? `${upCount} / ${downCount}` : "--",
    tertiaryLabel: "榜首 / 放量",
    tertiary: top ? `${top.symbol} · ${volumeHot}只` : "--",
    tertiaryTone: top && getChange(top) >= 0 ? "is-positive" : "is-negative",
  };
};

const renderMarketSectionContext = (rows = getFilteredRows()) => {
  const section = state.marketWorkspaceSection || "movers";
  const context = marketSectionContext(section, Array.isArray(rows) ? rows : []);
  setText("#marketSectionKicker", context.kicker);
  setText("#marketSectionTitle", context.title);
  setText("#marketSectionNote", context.note);
  setText("#marketSectionPrimaryLabel", context.primaryLabel);
  setText("#marketSectionSecondaryLabel", context.secondaryLabel);
  setText("#marketSectionTertiaryLabel", context.tertiaryLabel);
  setMarketSectionMetric("#marketSectionPrimary", context.primary, context.primaryTone);
  setMarketSectionMetric("#marketSectionSecondary", context.secondary, context.secondaryTone);
  setMarketSectionMetric("#marketSectionTertiary", context.tertiary, context.tertiaryTone);
  const page = document.querySelector('[data-view="market"]');
  if (page) page.dataset.marketWorkspaceSection = section;
};

const renderMarketRouteStrip = (active = "movers") => {
  const items = [
    ["sectors", "板块排行", "看主线"],
    ["flows", "板块资金", "看流向"],
    ["heatmap", "成交热力图", "看权重"],
    ["movers", "涨跌幅榜", "看个股"],
  ];
  return `
    <div class="market-route-strip" aria-label="市场模块联动">
      <span>联动查看</span>
      ${items.map(([key, label, hint]) => `
        <button class="${key === active ? "is-active" : ""}" type="button" data-market-section="${key}">
          <strong>${escapeHtml(label)}</strong>
          <small>${escapeHtml(hint)}</small>
        </button>
      `).join("")}
    </div>
  `;
};

const renderMarketSymbolTokens = (items, limit = 4) => {
  const symbols = uniqueBySymbol((items || []).map((item) => ({ symbol: item?.symbol || item })))
    .map((item) => normalizeStockSymbol(item.symbol))
    .filter(Boolean)
    .slice(0, limit);
  if (!symbols.length) return "--";
  return `
    <div class="market-symbol-tokens">
      ${symbols.map((symbol) => `
        <button type="button" data-stock-open="${escapeHtml(symbol)}">${escapeHtml(symbol)}</button>
      `).join("")}
    </div>
  `;
};

const renderFlowsPage = () => {
  const body = document.querySelector("#flowsSectorBody");
  const sectorList = document.querySelector("#flowsSectorList");
  const inflowList = document.querySelector("#flowsInflowList");
  const outflowList = document.querySelector("#flowsOutflowList");
  const balance = document.querySelector("#flowsMapBalance");
  const directionMatrix = document.querySelector("#flowsDirectionMatrix");
  if (!body) return;
  const rows = sectorFlowDisplayRows();
  const stockRows = flowRows();
  const top = rows[0];
  const activeSector = rows.slice().sort((a, b) => (b.activeValue || 0) - (a.activeValue || 0))[0];
  const maxAbsFlow = Math.max(...rows.map((row) => Math.abs(Number(row.netFlowProxy) || 0)), 1);
  const positiveSectors = rows.filter((row) => (row.netFlowProxy || 0) > 0).length;
  const negativeSectors = rows.filter((row) => (row.netFlowProxy || 0) < 0).length;
  const inflowRows = rows.filter((row) => (row.netFlowProxy || 0) > 0).slice(0, 6);
  const outflowRows = rows
    .filter((row) => (row.netFlowProxy || 0) < 0)
    .sort((a, b) => Math.abs(b.netFlowProxy || 0) - Math.abs(a.netFlowProxy || 0))
    .slice(0, 6);
  const inflowTotal = rows.reduce((sum, row) => sum + Math.max(0, Number(row.netFlowProxy) || 0), 0);
  const outflowTotal = rows.reduce((sum, row) => sum + Math.abs(Math.min(0, Number(row.netFlowProxy) || 0)), 0);
  const flowTotal = inflowTotal + outflowTotal;
  const inflowShare = flowTotal ? (inflowTotal / flowTotal) * 100 : 50;
  setText("#flowsAsOf", formatDisplayDate(state.sectorFlow?.asOf || state.meta?.volume?.updatedAt || state.meta?.day?.updatedAt));
  setText("#flowsHeroTitle", top ? `${sectorDisplayName(top.sector)} · ${formatSignedCompactMoney(top.netFlowProxy, top.netFlowLabel)}` : "等待板块数据");
  setText(
    "#flowsHeroLead",
    top
      ? `${top.status || "板块领先"}，上涨广度 ${Math.round(top.breadthPct || 0)}%，代表标的 ${(top.leaders || []).slice(0, 3).map((item) => item.symbol).join(" / ") || "--"}。这里的资金方向用成交额和涨跌方向估算。`
      : "用板块层面的成交活跃和涨跌广度判断资金偏好。",
  );
  setText("#flowsTopSymbol", top ? sectorDisplayName(top.sector) : "--");
  setText("#flowsTopNote", top ? `${formatSignedCompactMoney(top.netFlowProxy, top.netFlowLabel)} · ${top.status || "资金方向"}` : "等待数据。");
  setText("#flowsTopSector", activeSector ? sectorDisplayName(activeSector.sector) : "--");
  setText("#flowsAccumulationCount", positiveSectors ? String(positiveSectors) : "--");
  setText("#flowsDistributionCount", negativeSectors ? String(negativeSectors) : "--");
  setText(
    "#flowsMapTitle",
    rows.length
      ? `${positiveSectors} 个方向净流入，${negativeSectors} 个方向净流出`
      : "等待板块资金方向",
  );
  setText(
    "#flowsMapLead",
    rows.length
      ? `净流入代理 ${formatCompactMoney(inflowTotal)}，净流出代理 ${formatCompactMoney(outflowTotal)}。先看板块，再看龙头和成交确认。`
      : "绿色为净流入代理，红色为净流出代理；条形越长，说明该板块对当日资金方向的贡献越大。",
  );
  if (balance) {
    balance.innerHTML = `
      <i class="is-positive" style="width:${Math.max(4, inflowShare).toFixed(1)}%"></i>
      <i class="is-negative" style="width:${Math.max(4, 100 - inflowShare).toFixed(1)}%"></i>
    `;
  }
  if (directionMatrix) {
    directionMatrix.innerHTML = renderMarketFlowMatrix(rows, getFilteredRows(), {
      title: "板块资金矩阵",
      note: "按成交额加权涨跌估算资金方向，再用上涨广度和龙头确认。",
      limit: 8,
      flowOpen: true,
    });
  }
  const renderFlowMapList = (items, direction) => {
    const max = Math.max(...items.map((item) => Math.abs(Number(item.netFlowProxy) || 0)), 1);
    return items.length
      ? items.map((item) => {
          const value = Math.abs(Number(item.netFlowProxy) || 0);
          const leaders = (item.leaders || []).slice(0, 3).map((leader) => leader.symbol).filter(Boolean).join(" / ");
          const width = Math.max(6, (value / max) * 100);
          const toneClass = direction === "in" ? "is-positive" : "is-negative";
          return `
            <button class="flows-map-row ${toneClass}" type="button" data-flow-sector-open="${escapeHtml(item.sector)}">
              <span>${escapeHtml(sectorDisplayName(item.sector))}</span>
              <i><b style="width:${width.toFixed(1)}%"></b></i>
              <strong>${escapeHtml(formatSignedCompactMoney(item.netFlowProxy, item.netFlowLabel))}</strong>
              <small>${escapeHtml(`${Math.round(item.breadthPct || 0)}%上涨 · ${leaders || "等待龙头"}`)}</small>
            </button>
          `;
        }).join("")
      : `<p>${direction === "in" ? "暂无明显流入板块。" : "暂无明显流出板块。"}</p>`;
  };
  if (inflowList) inflowList.innerHTML = renderFlowMapList(inflowRows, "in");
  if (outflowList) outflowList.innerHTML = renderFlowMapList(outflowRows, "out");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="10">等待板块资金流向数据。</td></tr>`;
  } else {
    body.innerHTML = rows.slice(0, 16).map((row) => {
      const flowValue = Number(row.netFlowProxy) || 0;
      const changeClass = flowValue >= 0 ? "is-positive" : "is-negative";
      const leaders = (row.leaders || []).slice(0, 4);
      const leader = leaders[0];
      const weekChange = sectorPeriodChange(row.sector, "week");
      const upCount = row.upCount || 0;
      const downCount = row.downCount || 0;
      const flowWidth = Math.max(5, (Math.abs(flowValue) / maxAbsFlow) * 100);
      return `
        <tr>
          <td><button class="inline-stock-link" type="button" data-flow-sector-open="${escapeHtml(row.sector)}">${escapeHtml(sectorDisplayName(row.sector))}</button></td>
          <td>
            <div class="flow-direction-cell ${changeClass}">
              <strong>${escapeHtml(formatSignedCompactMoney(row.netFlowProxy, row.netFlowLabel))}</strong>
              <i><b style="width:${flowWidth.toFixed(1)}%"></b></i>
              <span>${escapeHtml(row.status || "资金方向")}</span>
            </div>
          </td>
          <td class="${Number(row.avgChange) >= 0 ? "gain-cell" : "loss-cell"}">${escapeHtml(row.avgChange == null ? "--" : formatSignedPct(row.avgChange))}</td>
          <td class="${Number(weekChange) >= 0 ? "gain-cell" : "loss-cell"}">${escapeHtml(weekChange == null ? "--" : formatSignedPct(weekChange))}</td>
          <td>${escapeHtml(row.activeValueLabel || formatCompactMoney(row.activeValue || 0))}</td>
          <td class="flow-breadth-cell">
            <strong>${escapeHtml(`${Math.round(row.breadthPct || 0)}%`)}</strong>
            <span><b class="is-positive">${escapeHtml(`${upCount}涨`)}</b><i>/</i><b class="is-negative">${escapeHtml(`${downCount}跌`)}</b></span>
          </td>
          <td>${leader?.symbol ? `<button class="inline-stock-link market-leader-link" type="button" data-stock-open="${escapeHtml(leader.symbol)}">${escapeHtml(leader.symbol)}</button>` : "--"}</td>
          <td class="${Number(leader?.change) >= 0 ? "gain-cell" : "loss-cell"}">${escapeHtml(leader?.change == null ? "--" : formatSignedPct(leader.change))}</td>
          <td>${renderMarketSymbolTokens(leaders, 4)}</td>
          <td><button class="table-action" type="button" data-flow-sector-open="${escapeHtml(row.sector)}">看板块</button></td>
        </tr>
      `;
    }).join("");
  }
  if (sectorList) {
    const detailRows = stockRows.slice(0, 10);
    const max = Math.max(...detailRows.map((item) => parseRatio(item.volumeRatio)), 1);
    sectorList.innerHTML = detailRows.length
      ? detailRows.map((item) => `
        <button type="button" data-stock-open="${escapeHtml(item.symbol)}">
          <span>${escapeHtml(item.symbol)}</span>
          <i><b style="width:${Math.max(8, (parseRatio(item.volumeRatio) / max) * 100).toFixed(1)}%"></b></i>
          <strong>${escapeHtml(item.volumeRatio || "--")}</strong>
          <small>${escapeHtml(`${sectorDisplayName(item.sector)} · ${formatSignedPct(item.change)}`)}</small>
        </button>
      `).join("")
      : "<p>等待个股活跃度数据。</p>";
  }
  renderMarketSectionContext(getFilteredRows());
};

const syncMarketWorkspacePanels = () => {
  const section = state.marketWorkspaceSection || "movers";
  const scanner = document.querySelector("#marketScannerPanel");
  const flows = document.querySelector("#marketFlowsPanel");
  const visual = document.querySelector("#marketVisualBoard");
  const brief = document.querySelector(".market-workspace .market-board-brief");
  const strip = document.querySelector(".market-workspace .market-strip");
  const macroFilter = document.querySelector("#marketMacroFilter");
  const pageTitle = document.querySelector("#pageTitle");
  const pageSubtitle = document.querySelector("#pageSubtitle");
  const showMovers = section === "movers";
  const showFlows = section === "flows";
  if (scanner) scanner.hidden = !showMovers;
  if (flows) flows.hidden = !showFlows;
  if (visual) visual.hidden = showFlows;
  if (brief) brief.hidden = !showMovers;
  if (strip) strip.hidden = !showMovers;
  if (macroFilter && !showMovers) macroFilter.hidden = true;
  renderMarketSectionContext();
  if (showFlows) {
    if (pageTitle) pageTitle.textContent = "板块资金方向";
    if (pageSubtitle) pageSubtitle.textContent = "按板块聚合成交额、涨跌扩散和领涨股票，观察主线是否有成交额确认。";
  } else if (section === "sectors") {
    if (pageTitle) pageTitle.textContent = "板块排行";
    if (pageSubtitle) pageSubtitle.textContent = "按板块涨跌、成交活跃度和领涨股票观察市场主线。";
  } else if (section === "heatmap") {
    if (pageTitle) pageTitle.textContent = "成交额热力图";
    if (pageSubtitle) pageSubtitle.textContent = "用成交额活跃度和涨跌方向观察个股、板块与市场结构的相对强弱。";
  } else {
    if (pageTitle) pageTitle.textContent = "行情异动";
    if (pageSubtitle) pageSubtitle.textContent = "从涨跌幅、成交额、市值和风险标签筛出需要复盘的股票。";
  }
};

const stockMetric = (label, value, className = "") => `
  <article class="${className}">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value == null || value === "" ? "--" : value)}</strong>
  </article>
`;

const stockSignedClass = (value) => {
  const parsed = parseSignedPercent(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "";
  return parsed >= 0 ? "is-positive" : "is-negative";
};

const volumeRatioSummary = (value, change) => {
  const ratio = parseRatio(value);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return {
      label: "等待成交额数据",
      note: "成交异动表示当前成交额相对平时成交额的倍数。",
    };
  }
  const percent = Math.round((ratio - 1) * 100);
  const direction = Number.isFinite(change) && change < 0 ? "下跌" : "上涨";
  const label = ratio >= 5
    ? "极端放量"
    : ratio >= 2
      ? "明显放量"
      : ratio >= 1.2
        ? "成交活跃"
        : ratio >= 0.8
          ? "接近平时"
          : "低于平时";
  const compare = percent >= 0 ? `高于平时约 ${percent}%` : `低于平时约 ${Math.abs(percent)}%`;
  const action = ratio >= 1.2
    ? `${direction}伴随放量，优先确认是否有公告、财报或板块共振。`
    : "成交没有明显放大，先降低短线结论权重。";
  return { label, note: `${compare}。${action}` };
};

const stockSectorFlowSummary = (rows) => {
  if (!rows.length) {
    return { label: "--", note: "等待板块成交额数据。", active: "--", breadth: "--" };
  }
  const upCount = rows.filter((row) => getChange(row) > 0).length;
  const downCount = rows.filter((row) => getChange(row) < 0).length;
  const activeRows = rows.filter((row) => parseRatio(row.volumeRatio) >= 1.2).length;
  const activeRatio = Math.round((activeRows / rows.length) * 100);
  const breadth = Math.round((upCount / rows.length) * 100);
  const activeValue = rows.reduce((sum, row) => sum + Number(row.dollarVolume || 0), 0);
  const label = upCount >= downCount ? "板块偏流入" : "板块偏流出";
  return {
    label,
    note: `${upCount}涨/${downCount}跌，上涨广度 ${breadth}%。`,
    active: `${activeRatio}% 活跃`,
    breadth: activeValue ? formatCompactMoney(activeValue) : "--",
  };
};

const signalToHistoryLabel = {
  guidance_up: "业绩预期变好",
  earnings_beat: "财报超预期",
  analyst_positive: "机构观点变化",
  short_squeeze: "空头压力变化",
};

const displayEventLabel = (rowOrLabel, fallback = "股票事件") => {
  const raw = typeof rowOrLabel === "string" ? rowOrLabel : rowOrLabel?.eventLabel || rowOrLabel?.eventType;
  const type = typeof rowOrLabel === "string" ? "" : rowOrLabel?.eventType;
  if (type && signalToHistoryLabel[type]) return signalToHistoryLabel[type];
  const text = String(raw || fallback);
  return text.replace(/预期改善观察/g, "业绩预期变好").replace(/预期改善/g, "业绩预期变好");
};

const stockHistoryEvidence = (signal) => {
  const key = signal === "short_squeeze" ? "squeeze_watch" : signal;
  const decision = (state.validationCenter?.productDecisions || []).find((item) => item.signal === key);
  const benchmark = (state.validationCenter?.historicalBenchmarkStats || []).find(
    (item) => item.signal === key && item.horizon === "20d",
  );
  const row = decision || benchmark || {};
  return {
    label: signalToHistoryLabel[signal] || row.label || "同类线索",
    count: row.count,
    positiveRate: row.winRatePct,
    strongerSpyRate: row.beatSpyRatePct,
    median: row.medianPct,
    stableAverage: row.trimmedMeanPct,
    status: decision?.status || "参考观察",
    note: decision?.note || "历史样本仅用于辅助判断，仍需结合价格、成交和市场环境。",
  };
};

const stockResearchSummary = ({ target, market, strength, quality, eventRow, signal }) => {
  const evidence = stockHistoryEvidence(eventRow?.eventType || "guidance_up");
  const title = eventRow
    ? `${displayEventLabel(eventRow)}：${eventReasonForUser(eventRow)}`
    : quality
      ? `财报观察：${quality.userReason || quality.userAngle || "财报和预期数据正在补充"}`
      : strength
        ? `强弱观察：${strength.action || strength.label || "价格相对强弱正在跟踪"}`
        : `${target} 暂无完整事件记录`;
  const currentState = strength?.label
    || (market ? getRiskLabel(getRiskBucket(market)) : "")
    || (signal ? directionLabel(signal.direction, signal.directionText) : "")
    || "等待更多数据";
  const risk = eventRow?.risk
    || quality?.userRisk
    || market?.risk
    || "暂无独立风险标签，先看价格、成交额和大盘环境是否继续确认。";
  const nextStep = eventRow
    ? "先加入自选，接下来检查价格是否继续站稳、成交额是否放大，以及市场温度是否恶化。"
    : quality
      ? "先看财报后的价格承接，再观察接下来几天是否继续强于大盘。"
      : "先保留观察，不急于下结论，等待更多数据确认。";
  return { title, currentState, risk, nextStep, evidence };
};

const stockDataSources = ({ market, day, week, month, volume, strength, quality, eventRow, signal }) => [
  ["行情", Boolean(market || day || week || month || volume)],
  ["强弱", Boolean(strength)],
  ["财报", Boolean(quality)],
  ["线索", Boolean(eventRow)],
  ["信号", Boolean(signal)],
];

const stockSourceCount = (sources) => sources.filter(([, active]) => active).length;

const stockReviewPriority = ({ target, market, day, week, month, volume, strength, quality, eventRow, signal }) => {
  const sources = stockDataSources({ market, day, week, month, volume, strength, quality, eventRow, signal });
  const sourceCount = stockSourceCount(sources);
  const marketChange = market ? getChange(market) : null;
  const directChange = Number(quality?.return20dPct ?? eventRow?.return20dPct);
  const monthChange = month
    ? getChange(month)
    : Number.isFinite(Number(marketChange))
      ? marketChange
      : Number.isFinite(directChange)
        ? directChange
        : parseSignedPercent(strength?.periods?.["20d"]);
  const dayChange = day ? getChange(day) : parseSignedPercent(strength?.periods?.["1d"]);
  const volumeRatio = parseRatio(volume?.volumeRatio || strength?.crowding?.volumeRatio || market?.volumeRatio);
  const strengthScore = Number(strength?.score);
  const qualityScore = Number(quality?.score ?? quality?.qualityScore ?? quality?.confluenceScore);
  const eventScore = Number(eventRow?.signalScore);
  const riskBucket = market ? getRiskBucket(market) : "watch";
  let score = 34;

  if (Number.isFinite(strengthScore)) score += Math.min(26, strengthScore * 0.28);
  if (Number.isFinite(qualityScore)) score += Math.min(12, qualityScore * 1.35);
  if (Number.isFinite(eventScore)) score += Math.min(12, eventScore * 3);
  if (eventRow) score += 10;
  if (quality) score += 9;
  if (signal) score += 7;
  score += Math.min(18, sourceCount * 4);

  if (Number.isFinite(monthChange)) {
    if (monthChange >= 20) score += 12;
    else if (monthChange >= 8) score += 8;
    else if (monthChange >= 0) score += 4;
    else if (monthChange <= -20) score -= 10;
    else score -= 4;
  }
  if (Number.isFinite(dayChange) && Math.abs(dayChange) >= 18) score -= 4;
  if (volumeRatio >= 3) score += 10;
  else if (volumeRatio >= 2) score += 7;
  else if (volumeRatio >= 1.25) score += 4;

  if (riskBucket === "extreme") score -= 24;
  else if (riskBucket === "high") score -= 10;
  if (Number(market?.price) > 0 && Number(market.price) < 5) score -= 6;

  const reasons = [];
  if (Number.isFinite(strengthScore)) reasons.push(`强弱 ${Math.round(strengthScore)}`);
  if (Number.isFinite(qualityScore)) reasons.push(`财报分 ${qualityScore.toFixed(1)}`);
  if (Number.isFinite(eventScore)) reasons.push(`事件分 ${eventScore.toFixed(1)}`);
  if (volumeRatio >= 1.25) reasons.push(`成交额 ${volumeRatio}x`);
  if (Number.isFinite(monthChange)) reasons.push(`近月 ${formatSignedPct(monthChange)}`);
  if (sourceCount) reasons.push(`依据 ${sourceCount}项`);
  if (eventRow) reasons.push("事件线索");
  if (quality) reasons.push("财报线索");
  if (signal) reasons.push("趋势信号");
  if (market) reasons.push(`风险 ${getRiskLabel(riskBucket)}`);

  return {
    score: Math.round(Math.max(0, Math.min(100, score))),
    reason: reasons.slice(0, 5).join(" · ") || "等待更多数据",
  };
};

const reviewPriorityForMarketRow = (row) => {
  const target = normalizeStockSymbol(row?.symbol);
  return stockReviewPriority({
    target,
    market: row,
    day: getBoardRow("day", target),
    week: getBoardRow("week", target),
    month: getBoardRow("month", target),
    volume: getBoardRow("volume", target),
    strength: findStrengthRow(target),
    quality: findQualityRow(target),
    eventRow: findEventRow(target),
    signal: signalStateForSymbol(target),
  });
};

const reviewPriorityForQualityRow = (row) => {
  const target = normalizeStockSymbol(row?.ticker || row?.symbol);
  return stockReviewPriority({
    target,
    market: findMarketRow(target),
    day: getBoardRow("day", target),
    week: getBoardRow("week", target),
    month: getBoardRow("month", target) || { change: Number(row?.return20dPct) },
    volume: getBoardRow("volume", target),
    strength: findStrengthRow(target),
    quality: row,
    eventRow: findEventRow(target),
    signal: signalStateForSymbol(target),
  });
};

const reviewPriorityForEventRow = (row) => {
  const target = normalizeStockSymbol(row?.ticker || row?.symbol);
  return stockReviewPriority({
    target,
    market: findMarketRow(target),
    day: getBoardRow("day", target),
    week: getBoardRow("week", target),
    month: getBoardRow("month", target) || { change: Number(row?.return20dPct) },
    volume: getBoardRow("volume", target),
    strength: findStrengthRow(target),
    quality: findQualityRow(target),
    eventRow: row,
    signal: signalStateForSymbol(target),
  });
};

const stockResearchVerdict = ({ market, strength, quality, eventRow, signal }) => {
  const sourceCount = stockSourceCount(stockDataSources({ market, strength, quality, eventRow, signal }));
  const riskText = `${eventRow?.risk || ""} ${quality?.userRisk || ""} ${market?.risk || ""}`;
  if (/低价|流动性|短期涨幅|高热度|空头|波动/.test(riskText)) return "可观察，但需要更严格风控";
  if (eventRow && strength) return "复盘优先级高";
  if (quality && strength) return "基本面与价格同时改善";
  if (signal && strength) return "方向信号与强弱共振";
  if (sourceCount >= 2) return "可以继续观察";
  return "先等待更多数据确认";
};

const stockHeatSummary = ({ market, strength, month, volume }) => {
  const monthChange = month ? getChange(month) : null;
  const crowding = Number(strength?.crowding?.score || 0);
  const volumeRatio = parseRatio(volume?.volumeRatio || market?.volumeRatio);
  if ((Number.isFinite(monthChange) && monthChange >= 40) || crowding >= 72 || volumeRatio >= 3) {
    return {
      label: "短线偏热",
      note: "涨幅、成交或热度已经偏高，更适合等分歧、回踩或新的确认。不要只因为涨得快就提高优先级。",
    };
  }
  if ((Number.isFinite(monthChange) && monthChange <= -20) || strength?.bucket === "weakest") {
    return {
      label: "走势偏弱",
      note: "价格表现落后，先看是否有明确修复信号；没有新理由前，观察优先级可以降低。",
    };
  }
  if (strength && strength.bucket === "strongest") {
    return {
      label: "相对强势",
      note: "相对大盘或行业表现更强，可以继续观察，但仍要看成交额和市场温度是否配合。",
    };
  }
  return {
    label: "等待确认",
    note: "当前信息还不够集中，先看价格、成交额和新的财报/事件是否继续支持。",
  };
};

const stockWatchlistState = (symbol) => {
  const target = normalizeStockSymbol(symbol);
  const raw = state.watchlist.find((item) => normalizeStockSymbol(item.symbol) === target);
  if (!raw) {
    return {
      active: false,
      title: "未加入自选",
      note: "如果这只股票需要继续跟踪，可以先加入自选，并按复盘节奏检查。",
      source: "未加入",
      review: "--",
    };
  }
  const item = enrichWatchlistItem(raw);
  const review = watchlistReviewPlan(item);
  const priority = watchlistReviewPriority(item);
  const status = watchlistStatus(item);
  return {
    active: true,
    title: review.due ? "自选待复盘" : "已在自选",
    note: watchlistNextStep(item),
    source: raw.source || "自选",
    review: watchlistReviewLabel(item),
    score: priority.score,
    reason: priority.reason,
    statusLabel: status.label,
    statusClass: status.className,
  };
};

const stockPrimarySource = ({ market, strength, quality, eventRow, signal }) => {
  if (eventRow) return displayEventLabel(eventRow, "股票事件");
  if (quality) return quality.userAngle || "财报观察";
  if (signal) return "趋势信号";
  if (strength) return "全市场强弱";
  if (market) return "涨跌幅榜";
  return "等待数据";
};

const stockReviewPlan = ({ eventRow, quality, strength, signal, market }) => {
  if (signal) return "按信号周期复盘，方向切换时重新评估。";
  if (eventRow) return eventNextReview(eventRow);
  if (quality) return "看财报后的价格承接、机构关注度和未来预期是否继续改善。";
  if (strength) return "看相对大盘和行业的强弱是否保持，回落时降低观察频率。";
  if (market) return "先看成交额是否连续放大，避免只被单日波动吸引。";
  return "先保留观察，等待更多行情、财报或线索数据补充。";
};

const isInWatchlist = (symbol) => {
  const target = normalizeStockSymbol(symbol);
  return state.watchlist.some((item) => normalizeStockSymbol(item.symbol) === target);
};

const saveWatchlist = () => {
  state.watchlist = uniqueBySymbol(
    state.watchlist
      .map((item) => ({ ...item, symbol: normalizeStockSymbol(item.symbol) }))
      .filter((item) => item.symbol),
  );
  safeWriteJson(WATCHLIST_STORAGE_KEY, state.watchlist);
};

const addToWatchlist = (symbol, source = "手动加入") => {
  const target = normalizeStockSymbol(symbol);
  if (!target) return;
  if (isInWatchlist(target)) {
    state.watchlist = state.watchlist.map((item) =>
      normalizeStockSymbol(item.symbol) === target
        ? { ...item, source: item.source || source, updatedAt: new Date().toISOString() }
        : item,
    );
  } else {
    const profile = stockDisplayName(target);
    state.watchlist.unshift({
      symbol: target,
      name: profile.chineseName || profile.company || target,
      company: profile.company || "",
      sector: profile.sector || "未分类",
      source,
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  saveWatchlist();
  refreshWatchlistViews();
};

const removeFromWatchlist = (symbol) => {
  const target = normalizeStockSymbol(symbol);
  state.watchlist = state.watchlist.filter((item) => normalizeStockSymbol(item.symbol) !== target);
  saveWatchlist();
  refreshWatchlistViews();
};

const clearWatchlist = () => {
  state.watchlist = [];
  saveWatchlist();
  refreshWatchlistViews();
};

const updateWatchlistReview = (symbol, action) => {
  const target = normalizeStockSymbol(symbol);
  if (!target) return;
  const now = new Date().toISOString();
  state.watchlist = state.watchlist.map((item) => {
    if (normalizeStockSymbol(item.symbol) !== target) return item;
    const reviewCount = Number(item.reviewCount || 0) + 1;
    const nextDays = action === "lower" ? 10 : action === "continue" ? 3 : 5;
    return {
      ...item,
      reviewAction: action,
      reviewCount,
      lastReviewedAt: now,
      nextReviewAt: addDays(now, nextDays),
      updatedAt: now,
    };
  });
  saveWatchlist();
  refreshWatchlistViews();
};

const watchlistActionButton = (symbol, source = "手动加入") => {
  const target = normalizeStockSymbol(symbol);
  const active = isInWatchlist(target);
  return `<button class="watchlist-action ${active ? "is-added" : ""}" type="button" data-watchlist-toggle="${escapeHtml(target)}" data-watchlist-source="${escapeHtml(source)}">${active ? "已加入自选" : "加入自选"}</button>`;
};

const watchlistDataSources = (item) => [
  ["行情", Boolean(item.market || item.ytd || item.month)],
  ["强弱", Boolean(item.strength)],
  ["财报", Boolean(item.quality)],
  ["事件", Boolean(item.eventRow)],
  ["信号", Boolean(item.signal)],
];

const watchlistDataCount = (item) => watchlistDataSources(item).filter(([, active]) => active).length;

const watchlistReviewPlan = (item) => {
  const dataCount = watchlistDataCount(item);
  const anchor = item.lastReviewedAt
    || item.addedAt
    || item.eventRow?.eventDate
    || item.quality?.latestEarningsDate
    || state.eventOpportunities?.asOf
    || state.strength?.asOf
    || state.meta?.ytd?.updatedAt
    || new Date().toISOString();
  const reviewGap = item.signal ? 1 : item.eventRow || item.quality ? 3 : item.strength ? 5 : 7;
  const nextReviewAt = item.nextReviewAt || addDays(anchor, reviewGap);
  const daysLeft = daysBetween(new Date(), nextReviewAt);
  const due = dataCount > 0 && daysLeft <= 0;
  const actionLabel = item.reviewAction === "continue"
    ? "继续观察"
    : item.reviewAction === "lower"
      ? "降低频率"
      : item.reviewAction === "reviewed"
        ? "已复盘"
        : "未复盘";
  const label = due ? "今天复盘" : daysLeft === 1 ? "明天复盘" : `${Math.max(daysLeft, 0)}天后复盘`;
  return {
    due,
    label,
    actionLabel,
    date: formatDisplayDate(nextReviewAt),
    daysLeft,
  };
};

const watchlistReviewPriority = (item) => {
  const target = normalizeStockSymbol(item?.symbol);
  const base = stockReviewPriority({
    target,
    market: item.market || findMarketRow(target),
    day: getBoardRow("day", target),
    week: getBoardRow("week", target),
    month: item.month || getBoardRow("month", target),
    volume: getBoardRow("volume", target),
    strength: item.strength || findStrengthRow(target),
    quality: item.quality || findQualityRow(target),
    eventRow: item.eventRow || findEventRow(target),
    signal: item.signal || signalStateForSymbol(target),
  });
  const review = watchlistReviewPlan(item);
  let score = base.score;
  const reasons = base.reason === "等待更多数据" ? [] : base.reason.split(" · ");
  if (review.due) {
    score += 8;
    reasons.unshift("到期复盘");
  }
  if (item.reviewAction === "lower") {
    score -= 12;
    reasons.push("已降频");
  }
  if (item.reviewAction === "reviewed") {
    score -= 4;
    reasons.push("已复盘");
  }
  return {
    score: Math.round(Math.max(0, Math.min(100, score))),
    reason: reasons.slice(0, 5).join(" · ") || "等待更多数据",
  };
};

const watchlistPriorityScore = (item) => {
  return watchlistReviewPriority(item).score;
};

const watchlistStatus = (item) => {
  const dataCount = watchlistDataCount(item);
  const review = watchlistReviewPlan(item);
  if (review.due) return { label: "待复盘", className: "is-watch" };
  if (item.signal) {
    return {
      label: directionLabel(item.signal.direction, item.signal.directionText),
      className: item.signal.direction === "short" ? "is-watch" : "is-ready",
    };
  }
  if (dataCount >= 2) return { label: "优先复盘", className: "is-ready" };
  if (item.eventRow) return { label: "事件确认", className: "is-event" };
  if (item.quality) return { label: "财报跟踪", className: "is-event" };
  if (item.strength) return { label: item.strength.label || "强弱跟踪", className: "is-ready" };
  if (item.market) return { label: "涨跌幅榜", className: "is-muted" };
  return { label: "等待数据", className: "is-muted" };
};

const watchlistNextStep = (item) => {
  if (item.signal) {
    return `看 ${item.signal.intervalLabel || item.signal.interval || "当前周期"} 方向是否延续，若方向切换就重新评估。`;
  }
  if (item.eventRow) {
    return "先看事件后的价格和成交额是否继续确认，再决定是否提高优先级。";
  }
  if (item.quality) {
    return "看财报后的股价表现是否延续，避免只因为单次业绩超预期就提高优先级。";
  }
  if (item.strength) {
    return "看强弱是否保持在同类股票前列，回落时降低跟踪优先级。";
  }
  if (item.market) {
    return "先确认成交额是否连续放大，避免只追一天的情绪波动。";
  }
  return "等待更多数据补充，先不要把它当成高优先级线索。";
};

const watchlistReviewLabel = (item) => {
  const review = watchlistReviewPlan(item);
  if (review.due) return `复盘到期 ${review.date}`;
  if (item.signal?.intervalLabel) return `按 ${item.signal.intervalLabel} 复盘`;
  if (item.nextReviewAt) return `下次复盘 ${formatDisplayDate(item.nextReviewAt)}`;
  if (item.eventRow?.eventDate) return `事件后复盘 ${formatDisplayDate(item.eventRow.eventDate)}`;
  if (item.quality?.latestEarningsDate) return `财报后复盘 ${formatDisplayDate(item.quality.latestEarningsDate)}`;
  if (item.addedAt) return `加入于 ${formatDisplayDate(item.addedAt)}`;
  return "下次看盘复盘";
};

const enrichWatchlistItem = (item) => {
  const target = normalizeStockSymbol(item.symbol);
  const profile = stockDisplayName(target);
  const market = findMarketRow(target);
  const strength = findStrengthRow(target);
  const quality = findQualityRow(target);
  const eventRow = findEventRow(target);
  const signal = signalStateForSymbol(target);
  const ytd = getBoardRow("ytd", target);
  const month = getBoardRow("month", target);
  return {
    ...item,
    symbol: target,
    name: profile.chineseName || item.name || profile.company || target,
    company: profile.company || item.company || "",
    sector: profile.sector || item.sector || "未分类",
    market,
    strength,
    quality,
    eventRow,
    signal,
    ytd,
    month,
  };
};

const watchlistMatchesView = (item) => {
  const filter = state.watchlistViewFilter;
  if (filter === "all") return true;
  if (filter === "due") return watchlistReviewPlan(item).due;
  if (filter === "priority") return watchlistPriorityScore(item) >= 70;
  if (filter === "signal") return Boolean(item.signal);
  if (filter === "event") return Boolean(item.eventRow);
  if (filter === "earnings") return Boolean(item.quality);
  if (filter === "strength") return Boolean(item.strength);
  if (filter === "market") return Boolean(item.market) && watchlistDataCount(item) === 1;
  if (filter === "no-data") return watchlistDataCount(item) === 0;
  return true;
};

const getWatchlistRows = () => {
  const query = state.watchlistQuery.trim().toLowerCase();
  return state.watchlist
    .map(enrichWatchlistItem)
    .filter((item) => {
      if (state.watchlistSourceFilter !== "all" && (item.source || "自选") !== state.watchlistSourceFilter) return false;
      if (!watchlistMatchesView(item)) return false;
      if (!query) return true;
      const haystack = [
        item.symbol,
        item.name,
        item.company,
        item.sector,
        item.source,
        item.eventRow?.reason,
        item.quality?.userReason,
        item.strength?.action,
        item.market?.actionNote,
        watchlistNextStep(item),
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => watchlistPriorityScore(b) - watchlistPriorityScore(a));
};

const renderWatchlistSourceOptions = (rows) => {
  const select = document.querySelector("#watchlistSourceFilter");
  if (!select) return;
  const sources = Array.from(new Set(rows.map((item) => item.source || "自选"))).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const current = state.watchlistSourceFilter;
  select.innerHTML = '<option value="all">全部来源</option>' + sources.map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join("");
  select.value = sources.includes(current) ? current : "all";
  if (select.value !== current) state.watchlistSourceFilter = select.value;
};

const renderWatchlistDailyPlan = (rows, reviewRows, priorityRows) => {
  const focus = document.querySelector("#watchlistTodayFocus");
  const reason = document.querySelector("#watchlistTodayReason");
  const action = document.querySelector("#watchlistTodayAction");
  const next = document.querySelector("#watchlistTodayNext");
  if (!focus || !reason || !action || !next) return;
  const top = reviewRows[0] || priorityRows[0] || rows[0];
  if (!top) {
    focus.textContent = "先加入自选对象";
    reason.textContent = "自选会根据复盘分、到期时间和已接入线索自动排序。";
    action.textContent = "等待观察对象";
    next.textContent = "从涨跌幅榜、强弱、财报或股票事件加入股票后，这里会给出下一步。";
    return;
  }
  const review = watchlistReviewPlan(top);
  const status = watchlistStatus(top);
  const priority = watchlistReviewPriority(top);
  focus.textContent = `${top.symbol} · ${status.label}`;
  reason.textContent = review.due
    ? `${top.symbol} 已到复盘时间，复盘分 ${priority.score}，先检查加入理由是否仍成立。`
    : `${top.symbol} 复盘分 ${priority.score}，${priority.reason}。`;
  action.textContent = review.due ? "先复盘，再决定保留频率" : "继续观察确认条件";
  next.textContent = watchlistNextStep(top);
};

const watchlistSectorFlow = (item) => {
  const profile = stockDisplayName(item.symbol);
  const sector = sectorDisplayName(profile.sector || item.sector);
  const sectorRows = isKnownSector(sector) ? uniqueBySymbol(allMarketRows().filter((row) => sectorDisplayName(row.sector) === sector)) : [];
  return stockSectorFlowDetail({ ...profile, sector }, sectorRows);
};

const watchlistCalendarSummary = (item) => {
  const target = normalizeStockSymbol(item.symbol);
  const profile = stockDisplayName(target);
  const macroExposure = stockMacroExposure(profile, item.market || findMarketRow(target));
  const rows = stockLinkedCalendarRows({ target, profile, macroExposure, quality: item.quality || findQualityRow(target) });
  const first = rows[0];
  if (!first) return { label: "暂无日程", detail: "先看财经日历整体事件", count: 0 };
  return {
    label: `${formatDisplayDate(first.date)} · ${eventTypeLabel(first.type)}`,
    detail: first.title || first.summary || "关联日程",
    count: rows.length,
  };
};

const watchlistPeerSummary = (item) => {
  const target = normalizeStockSymbol(item.symbol);
  const profile = stockDisplayName(target);
  const sector = sectorDisplayName(profile.sector || item.sector);
  const sectorRows = isKnownSector(sector)
    ? uniqueBySymbol(allMarketRows().filter((row) => sectorDisplayName(row.sector) === sector))
    : [];
  const changeRows = sectorRows.slice().sort((a, b) => getChange(b) - getChange(a));
  const rank = changeRows.findIndex((row) => normalizeStockSymbol(row.symbol) === target) + 1;
  const capRows = sectorRows
    .filter((row) => marketCapNumber(row.marketCap) != null)
    .sort((a, b) => marketCapNumber(b.marketCap) - marketCapNumber(a.marketCap));
  const capRank = capRows.findIndex((row) => normalizeStockSymbol(row.symbol) === target) + 1;
  const leader = changeRows.find((row) => normalizeStockSymbol(row.symbol) !== target) || changeRows[0];
  const changes = changeRows.map(getChange).filter(Number.isFinite);
  const average = changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : null;
  return {
    sector,
    rankText: rank > 0 ? `${rank}/${changeRows.length}` : "--",
    capRankText: capRank > 0 ? `${capRank}/${capRows.length}` : "--",
    leaderText: leader?.symbol ? `${leader.symbol} ${formatChangeValue(leader)}` : "--",
    averageText: average == null ? "--" : formatSignedPct(average),
  };
};

const watchlistCatalystSummary = (item, calendar) => {
  if (item.eventRow) {
    return {
      label: `事件 · ${formatDisplayDate(item.eventRow.eventDate)}`,
      detail: item.eventRow.reason || displayEventLabel(item.eventRow, "股票事件"),
      meta: item.eventRow.return20dPct == null ? "事件后表现待补" : `事件后20日 ${formatSignedPct(item.eventRow.return20dPct)}`,
    };
  }
  if (item.quality) {
    const date = item.quality.latestEarningsDate || item.quality.reportDate;
    return {
      label: `财报 · ${date ? formatDisplayDate(date) : "日期待补"}`,
      detail: item.quality.userReason || item.quality.userAngle || "财报线索",
      meta: item.quality.avgPriceTargetUpsidePct == null ? "目标价空间待补" : `目标空间 ${formatSignedPct(item.quality.avgPriceTargetUpsidePct)}`,
    };
  }
  if (calendar.count) {
    return {
      label: calendar.label,
      detail: calendar.detail,
      meta: `${calendar.count}条关联日程`,
    };
  }
  return {
    label: "暂无直接日程",
    detail: "先看行情、强弱、板块资金和成交额是否继续确认。",
    meta: "等待事件或财报补充",
  };
};

const watchlistTrendLabel = (item) => {
  if (item.signal) return directionLabel(item.signal.direction, item.signal.directionText);
  if (item.strength?.label) return item.strength.label;
  if (item.market) return "行情异动";
  return "--";
};

const watchlistTrendClass = (item) => {
  if (item.signal?.direction === "short") return "is-negative";
  if (item.signal?.direction === "long") return "is-positive";
  const change = getChange(item.month || item.market || {});
  return Number.isFinite(change) && change < 0 ? "is-negative" : Number.isFinite(change) && change > 0 ? "is-positive" : "";
};

const stockPeerRows = (symbol, limit = 6) => {
  const target = normalizeStockSymbol(symbol);
  const profile = stockDisplayName(target);
  const byMarket = isKnownSector(profile.sector)
    ? allMarketRows().filter((row) => row.symbol !== target && row.sector === profile.sector)
    : [];
  const byStrength = (state.strength?.rows || [])
    .filter((row) => isKnownSector(profile.sector) && normalizeStockSymbol(row.symbol) !== target && row.sectorProxy === profile.sector)
    .map((row) => ({
      symbol: row.symbol,
      company: row.name,
      chineseName: row.symbol,
      sector: row.sectorProxy,
      change: parseSignedPercent(row.periods?.["20d"]),
      price: row.price,
      volumeRatio: row.crowding?.volumeRatio,
      volume: row.liquidity,
      marketCap: row.liquidity,
      risk: row.label,
      actionNote: row.action,
    }));
  return uniqueBySymbol([...byMarket, ...byStrength])
    .sort((a, b) => (marketCapNumber(b.marketCap) || 0) - (marketCapNumber(a.marketCap) || 0) || Math.abs(getChange(b)) - Math.abs(getChange(a)))
    .slice(0, limit);
};

const stockTimelineItems = (symbol) => {
  const target = normalizeStockSymbol(symbol);
  const items = [];
  ["day", "week", "month", "ytd", "volume"].forEach((board) => {
    const row = getBoardRow(board, target);
    if (row) {
      const label = board === "day" ? "1D榜" : board === "week" ? "周榜" : board === "month" ? "月榜" : board === "ytd" ? "年内榜" : "成交额榜";
      items.push({
        label,
        title: `进入${label}`,
        value: `${formatChangeValue(row)} · 排名 ${row.rank}`,
      });
    }
  });
  const strength = findStrengthRow(target);
  if (strength) {
    items.push({
      label: "强弱榜",
      title: strength.label,
      value: `${strength.periods?.["20d"] || "--"} · ${strength.action || "--"}`,
    });
  }
  const quality = findQualityRow(target);
  const eventRow = findEventRow(target);
  if (quality) {
    items.push({
      label: "财报观察",
      title: quality.userAngle || "财报观察",
      value: `${quality.return20dPct == null ? "--" : formatSignedPct(quality.return20dPct)} · ${quality.latestEarningsDate || "--"}`,
    });
  }
  if (eventRow) {
    items.push({
      label: "股票事件",
      title: displayEventLabel(eventRow, "股票事件"),
      value: `${eventRow.return20dPct == null ? "--" : formatSignedPct(eventRow.return20dPct)} · ${eventRow.eventDate || "--"}`,
    });
  }
  const signal = signalStateForSymbol(target);
  if (signal) {
    items.push({
      label: "趋势信号",
      title: directionLabel(signal.direction, signal.directionText),
      value: `${signal.marketChangePct || "--"} · ${signal.intervalLabel || signal.interval || "--"}`,
    });
  }
  return items;
};

const stockActionChecklist = (symbol) => {
  const target = normalizeStockSymbol(symbol);
  const market = findMarketRow(target);
  const strength = findStrengthRow(target);
  const quality = findQualityRow(target);
  const eventRow = findEventRow(target);
  const signal = signalStateForSymbol(target);
  const items = [];
  if (strength) items.push(`先看强弱是否保持：${strength.label}，20日表现 ${strength.periods?.["20d"] || "--"}。`);
  if (market) items.push(`再看风险是否可接受：${market.risk}，不只看涨幅，也看成交额是否连续。`);
  if (quality) items.push(`财报角度：${quality.userReason || quality.userAngle || "等待更多财报解释"}。`);
  if (eventRow) items.push(`股票事件：${eventRow.reason || displayEventLabel(eventRow) || "先看事件是否继续被价格确认"}。`);
  if (signal) items.push(`趋势信号：${directionLabel(signal.direction, signal.directionText)}，当前表现 ${signal.marketChangePct || "--"}。`);
  if (!items.length) items.push("先加入自选，等待更多行情、强弱、财报或信号数据补充。");
  return items.slice(0, 4);
};

const renderWatchlist = () => {
  const body = document.querySelector("#watchlistBody");
  const empty = document.querySelector("#watchlistEmpty");
  if (!body || !empty) return;

  const allRows = state.watchlist.map(enrichWatchlistItem).sort((a, b) => watchlistPriorityScore(b) - watchlistPriorityScore(a));
  renderWatchlistSourceOptions(allRows);
  const rows = getWatchlistRows();

  const reviewRows = allRows.filter((item) => watchlistReviewPlan(item).due);
  const priorityRows = allRows.filter((item) => watchlistPriorityScore(item) >= 70);
  setText("#watchlistCount", `${allRows.length}只`);
  setText("#watchlistReviewCount", `${reviewRows.length}只`);
  setText("#watchlistPriorityCount", `${priorityRows.length}只`);
  setText("#watchlistCoverageCount", allRows.length ? `${allRows.filter((item) => watchlistDataCount(item) > 0).length}只` : "--");
  setText("#watchlistResultSummary", `${rows.length} / ${allRows.length} 只`);
  setText(
    "#watchlistDataAsOf",
    latestDisplayDate(
      state.eventOpportunities?.asOf,
      state.earningsQuality?.asOf,
      state.strength?.asOf,
      state.marketTemperature?.asOf,
      state.meta?.ytd?.updatedAt,
    ),
  );
  renderWatchlistDailyPlan(allRows, reviewRows, priorityRows);
  empty.classList.toggle("is-hidden", rows.length > 0);
  empty.querySelector("strong").textContent = allRows.length ? "当前筛选没有结果" : "还没有加入自选";
  empty.querySelector("p").textContent = allRows.length
    ? "换一个复盘状态、加入来源或搜索词再看。"
    : "在涨跌幅榜、全市场强弱、财报观察或股票详情页点击“加入自选”。";

  body.innerHTML = rows.length
    ? `
      <div class="watchlist-workbench-table" role="table" aria-label="自选复盘队列">
        <div class="watchlist-workbench-row is-head" role="row">
          <span>股票</span>
          <span>复盘</span>
          <span>走势</span>
          <span>板块 / 资金</span>
          <span>事件 / 日程</span>
          <span>下一步</span>
          <span>操作</span>
        </div>
        ${rows.map((item) => {
      const status = watchlistStatus(item);
      const dataSources = watchlistDataSources(item);
      const review = watchlistReviewPlan(item);
      const priority = watchlistReviewPriority(item);
      const reason = item.eventRow?.reason || item.quality?.userReason || item.strength?.action || item.market?.actionNote || "等待更多数据补充。";
      const itemDataAsOf = latestDisplayDate(
        item.eventRow?.eventDate,
        item.quality?.latestEarningsDate,
        state.strength?.asOf,
        state.meta?.ytd?.updatedAt,
      );
      const sectorFlow = watchlistSectorFlow(item);
      const calendar = watchlistCalendarSummary(item);
      const peerSummary = watchlistPeerSummary(item);
      const catalyst = watchlistCatalystSummary(item, calendar);
      const trendClass = watchlistTrendClass(item);
      const sourceChips = dataSources
        .filter(([, active]) => active)
        .map(([label]) => `<b>${escapeHtml(label)}</b>`)
        .join("") || "<b>待接入</b>";
      const marketCap = item.market?.marketCap || item.quality?.marketCap || findProductProfile(item.symbol)?.marketCap || "--";
      return `
          <article class="watchlist-workbench-row" role="row" data-watchlist-symbol="${escapeHtml(item.symbol)}">
            <div class="watchlist-stock-cell">
              <button class="inline-stock-link" type="button" data-stock-open="${escapeHtml(item.symbol)}">${escapeHtml(item.symbol)}</button>
              <strong>${escapeHtml(item.name)}${item.company && item.company !== item.name ? ` · ${escapeHtml(item.company)}` : ""}</strong>
              <p>${escapeHtml(sectorDisplayName(item.sector))} · ${escapeHtml(marketCap)} · ${escapeHtml(item.source || "自选")}</p>
              <div class="watchlist-source-chips">${sourceChips}</div>
            </div>
            <div class="watchlist-score-cell">
              <strong>${escapeHtml(String(priority.score))}</strong>
              <span class="${escapeHtml(status.className)}">${escapeHtml(status.label)}</span>
              <p>${escapeHtml(review.label)} · ${escapeHtml(review.actionLabel)}${item.reviewCount ? ` · ${escapeHtml(String(item.reviewCount))}次` : ""}</p>
            </div>
            <div class="watchlist-trend-cell">
              <strong class="${escapeHtml(trendClass)}">${escapeHtml(watchlistTrendLabel(item))}</strong>
              <p>1M <b class="${item.month && getChange(item.month) < 0 ? "is-negative" : "is-positive"}">${formatChangeValue(item.month)}</b> · YTD <b class="${item.ytd && getChange(item.ytd) < 0 ? "is-negative" : "is-positive"}">${formatChangeValue(item.ytd)}</b></p>
              <small>${escapeHtml(item.strength?.relative?.spy ? `相对SPY ${item.strength.relative.spy}` : item.signal?.marketChangePct ? `信号表现 ${item.signal.marketChangePct}` : "等待相对强弱")}</small>
            </div>
            <div class="watchlist-flow-cell">
              <strong class="${escapeHtml(sectorFlow.className)}">${escapeHtml(sectorFlow.netFlow)}</strong>
              <p>${escapeHtml(sectorFlow.label)} · 广度 ${escapeHtml(sectorFlow.breadth)}</p>
              <small>${escapeHtml(peerSummary.sector)} ${escapeHtml(peerSummary.rankText)} · 市值 ${escapeHtml(peerSummary.capRankText)}</small>
            </div>
            <div class="watchlist-calendar-cell">
              <strong>${escapeHtml(catalyst.label)}</strong>
              <p>${escapeHtml(compactText(catalyst.detail, 70))}</p>
              <small>${escapeHtml(catalyst.meta || itemDataAsOf)}</small>
            </div>
            <div class="watchlist-next-cell">
              <strong>${escapeHtml(compactText(priority.reason, 70))}</strong>
              <p>${escapeHtml(compactText(reason, 84))}</p>
              <small>${escapeHtml(compactText(watchlistNextStep(item), 92))}</small>
            </div>
            <div class="watchlist-actions-cell">
              <button class="table-action" type="button" data-stock-open="${escapeHtml(item.symbol)}">详情</button>
              <button type="button" data-watchlist-review="reviewed" data-watchlist-symbol="${escapeHtml(item.symbol)}">已复盘</button>
              <button type="button" data-watchlist-review="continue" data-watchlist-symbol="${escapeHtml(item.symbol)}">继续</button>
              <button class="icon-action" type="button" data-watchlist-remove="${escapeHtml(item.symbol)}" aria-label="移除 ${escapeHtml(item.symbol)}">×</button>
            </div>
          </article>
    `;
    }).join("")}
      </div>
    `
    : "";
};

const refreshWatchlistViews = () => {
  renderWatchlist();
  const activePage = document.querySelector(".page-view.is-active")?.dataset.view;
  if (activePage === "stock") renderStockHub(state.selectedStockSymbol);
  if (activePage === "market") renderMarketDetail(state.selectedMarketSymbol);
  if (activePage === "strength") renderStrengthTable();
  if (activePage === "earnings") renderQualityTable();
  if (activePage === "events") renderEventTable();
};

const splitReferenceList = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "")
    .split(/[\/,，、;；|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizedReferenceSet = (value) => new Set(splitReferenceList(value).map((item) => normalizeStockSymbol(item) || item.toUpperCase()));

const calendarRows = () => {
  const rows = state.eventsCalendar?.events || state.eventsCalendar?.rows || [];
  return (Array.isArray(rows) ? rows : []).map(normalizeProductCalendarRow).sort(calendarEventSort);
};

const calendarRowMatchesStock = (row, target, profile, macroExposure) => {
  const assets = normalizedReferenceSet(row.relatedAssets);
  const modules = splitReferenceList(row.relatedModules).join(" ").toLowerCase();
  const titleText = `${row.title || ""} ${row.summary || ""} ${row.sourceName || ""}`.toUpperCase();
  const profileText = `${profile?.company || ""} ${profile?.chineseName || ""} ${profile?.sector || ""}`.toUpperCase();
  if (assets.has(target) || titleText.includes(target)) return "direct";
  if (row.type === "earnings" && profileText && titleText && titleText.includes(profileText.split(/\s+/)[0])) return "direct";
  if (row.type === "macro" || row.type === "policy") {
    if (assets.has("SPY") || assets.has("QQQ") || assets.has("IWM") || /市场|风险|估值|股票|macro|market|risk/.test(modules)) return "macro";
    if (macroExposure?.keys?.some((key) => titleText.includes(key.toUpperCase()))) return "macro";
  }
  return "";
};

const stockLinkedCalendarRows = ({ target, profile, macroExposure, quality }) => {
  const allRows = calendarRows();
  const futureRows = allRows.filter(isFutureCalendarEvent);
  const rows = futureRows.length ? futureRows : allRows;
  const matches = rows
    .map((row) => ({ ...row, matchType: calendarRowMatchesStock(row, target, profile, macroExposure) }))
    .filter((row) => row.matchType);
  const direct = matches.filter((row) => row.matchType === "direct");
  const macro = matches.filter((row) => row.matchType === "macro");
  const syntheticEarnings = quality?.latestEarningsDate && !direct.some((row) => row.type === "earnings")
    ? [{
        id: `${target}-quality-earnings`,
        date: quality.latestEarningsDate,
        time: "",
        title: `${target} 财报日期`,
        type: "earnings",
        impact: "medium",
        relatedModules: ["个股详情", "财报观察"],
        relatedAssets: [target],
        summary: quality.userAngle || quality.userReason || "来自财报观察数据。",
        matchType: "direct",
      }]
    : [];
  return [...syntheticEarnings, ...direct, ...macro].sort(calendarEventSort).slice(0, 5);
};

const stockEarningsDateLabel = (linkedRows, quality) => {
  const earnings = linkedRows.find((row) => row.type === "earnings");
  if (earnings?.date) return formatDisplayDate(earnings.date);
  if (quality?.latestEarningsDate) return formatDisplayDate(quality.latestEarningsDate);
  return "财报日期待接入";
};

const stockEarningsFact = (linkedRows, quality) => {
  const earnings = linkedRows.find((row) => row.type === "earnings");
  if (earnings?.date) {
    return {
      label: formatDisplayDate(earnings.date),
      note: compactText(`${earnings.title || "财报日期"}${earnings.sourceName ? ` · ${earnings.sourceName}` : ""}`, 88),
    };
  }
  if (quality?.latestEarningsDate) {
    return {
      label: formatDisplayDate(quality.latestEarningsDate),
      note: compactText(quality.userAngle || quality.userReason || "来自财报观察数据。", 88),
    };
  }
  return {
    label: "财报日期待接入",
    note: "财经日历和财报观察暂未提供该标的日期。",
  };
};

const stockSectorFlowDetail = (profile, sectorRankRows) => {
  const sector = sectorDisplayName(profile?.sector);
  const rows = sectorFlowDisplayRows();
  const row = rows.find((item) => sectorDisplayName(item.sector) === sector) || null;
  const changes = sectorRankRows.map(getChange).filter(Number.isFinite);
  const breadthPct = row?.breadthPct ?? (changes.length ? (changes.filter((value) => value >= 0).length / changes.length) * 100 : null);
  const flowValue = Number(row?.netFlowProxy);
  const flowClass = Number.isFinite(flowValue) && flowValue < 0 ? "is-negative" : Number.isFinite(flowValue) && flowValue > 0 ? "is-positive" : "";
  return {
    row,
    label: row?.status || (Number.isFinite(flowValue) ? (flowValue >= 0 ? "资金净流入" : "资金净流出") : "资金方向待接入"),
    netFlow: Number.isFinite(flowValue) ? formatSignedCompactMoney(flowValue) : row?.netFlowLabel || "--",
    activeValue: row?.activeValueLabel || (row?.activeValue ? formatCompactMoney(row.activeValue) : "--"),
    breadth: Number.isFinite(breadthPct) ? `${Math.round(breadthPct)}%` : "--",
    leaders: (row?.leaders || sectorRankRows.slice(0, 4)).slice(0, 4),
    className: flowClass,
  };
};

const renderStockCalendarRows = (rows) => {
  if (!rows.length) {
    return `<div class="stock-linked-empty">暂无直接关联日程。宏观事件可先回到财经日历整体观察。</div>`;
  }
  return rows.map((row) => {
    const impactClass = row.impact === "high" ? "is-high" : row.impact === "medium" ? "is-medium" : "is-low";
    const related = splitReferenceList(row.relatedAssets).slice(0, 3).join(" / ") || splitReferenceList(row.relatedModules).slice(0, 2).join(" / ") || eventTypeLabel(row.type);
    return `
      <div class="stock-linked-row">
        <time>${escapeHtml(formatDisplayDate(row.date))}</time>
        <strong>${escapeHtml(row.title || "--")}</strong>
        <span>${escapeHtml(related || "--")}</span>
        <em class="${impactClass}">${escapeHtml(eventImpactLabel(row.impact))}</em>
        <p>${escapeHtml(compactText(row.summary || row.sourceName || "等待事件摘要补充。", 92))}</p>
      </div>
    `;
  }).join("");
};

const renderStockHub = (symbol) => {
  const target = normalizeStockSymbol(symbol || state.selectedStockSymbol);
  const content = document.querySelector("#stockHubContent");
  if (!content) return;
  if (!target) {
    setText("#stockHubSymbol", "--");
    setText("#stockHubSubtitle", "集中查看涨跌幅、强弱位置、财报质量、趋势信号和风险提示。");
    content.innerHTML = `
      <div class="empty-detail">
        <strong>选择一只股票</strong>
        <p>从股票事件、涨跌幅榜、全市场强弱或财报观察进入后，会自动汇总这只股票的关键数据。</p>
      </div>
    `;
    return;
  }

  const productDetail = state.productStockDetails[target] || null;
  const productMarketRows = productDetail?.marketRows || [];
  const productBoardRow = (board) => productMarketRows.find((row) => row.board === board) || null;
  const ytd = productBoardRow("ytd") || getBoardRow("ytd", target);
  const day = productBoardRow("day") || getBoardRow("day", target);
  const week = productBoardRow("week") || getBoardRow("week", target);
  const month = productBoardRow("month") || getBoardRow("month", target);
  const volume = productBoardRow("volume") || getBoardRow("volume", target);
  const market = day || findMarketRow(target) || ytd || month || volume || null;
  const strength = productDetail?.strength || findStrengthRow(target);
  const quality = productDetail?.earnings?.[0] || findQualityRow(target);
  const eventRow = productDetail?.events?.[0] || findEventRow(target);
  const signal = signalStateForSymbol(target);
  const events = signalEventsForSymbol(target);
  const profile = stockDisplayName(target);
  const currentPrice = productDetail?.profile?.price || market?.price || strength?.price || quality?.close || eventRow?.close || signal?.livePrice || "--";
  const moveReasons = market ? inferMoveReason(market, volume) : [];
  const targetUpside = quality?.avgPriceTargetUpsidePct == null ? "--" : formatSignedPct(quality.avgPriceTargetUpsidePct);
  const signalPerformance = signal?.marketChangePct || signal?.directionalChangePct || "--";
  const productPeers = (productDetail?.peers || []).map((peer) => {
    const marketPeer = findMarketRow(peer.symbol) || getBoardRow("day", peer.symbol) || getBoardRow("ytd", peer.symbol) || {};
    return {
      ...marketPeer,
      ...peer,
      company: peer.company || marketPeer.company,
      chineseName: peer.chineseName || marketPeer.chineseName,
      sector: peer.sector || marketPeer.sector,
      marketCap: peer.marketCap || marketPeer.marketCap,
      change: Number.isFinite(Number(marketPeer.change)) ? Number(marketPeer.change) : marketPeer.change,
      changeYtd: Number.isFinite(Number(marketPeer.changeYtd)) ? Number(marketPeer.changeYtd) : marketPeer.changeYtd,
      volumeRatio: peer.volumeRatio || marketPeer.volumeRatio,
      volume: peer.volume || marketPeer.volume,
    };
  });
  const peers = uniqueBySymbol([...stockPeerRows(target, 6), ...productPeers])
    .filter((row) => normalizeStockSymbol(row.symbol) !== target)
    .sort((a, b) => {
      const capDiff = (marketCapNumber(b.marketCap) || 0) - (marketCapNumber(a.marketCap) || 0);
      if (capDiff) return capDiff;
      const changeA = Number.isFinite(getChange(a)) ? getChange(a) : -Infinity;
      const changeB = Number.isFinite(getChange(b)) ? getChange(b) : -Infinity;
      return changeB - changeA;
    })
    .slice(0, 8);
  const strongestPeer = peers.slice().sort((a, b) => getChange(b) - getChange(a))[0];
  const sectorKnown = isKnownSector(profile.sector);
  const sectorRankRows = sectorKnown
    ? uniqueBySymbol(allMarketRows().filter((row) => row.sector === profile.sector))
        .sort((a, b) => getChange(b) - getChange(a))
    : [];
  const sectorRank = sectorRankRows.findIndex((row) => normalizeStockSymbol(row.symbol) === target) + 1;
  const sectorRankText = sectorRank > 0 ? `${sectorRank}/${sectorRankRows.length}` : "--";
  const volumeRatioText = formatVolumeRatioLabel(volume?.volumeRatio || market?.volumeRatio || strength?.crowding?.volumeRatio);
  const marketCapText = productDetail?.profile?.marketCap || market?.marketCap || quality?.marketCap || "--";
  const volumeSummary = volumeRatioSummary(volumeRatioText, market ? getChange(market) : getChange(day || {}));
  const sectorChanges = sectorRankRows.map(getChange).filter(Number.isFinite);
  const sectorAverageChange = sectorChanges.length ? sectorChanges.reduce((sum, value) => sum + value, 0) / sectorChanges.length : null;
  const sectorAverageText = sectorAverageChange == null ? "--" : formatSignedPct(sectorAverageChange);
  const marketCapRankRows = sectorRankRows
    .filter((row) => marketCapNumber(row.marketCap) != null)
    .sort((a, b) => marketCapNumber(b.marketCap) - marketCapNumber(a.marketCap));
  const marketCapRank = marketCapRankRows.findIndex((row) => normalizeStockSymbol(row.symbol) === target) + 1;
  const marketCapPosition = marketCapRank > 0 ? `板块市值 ${marketCapRank}/${marketCapRankRows.length}` : capLabel(market || { marketCap: marketCapText });
  const peerRows = peers.slice(0, 5);
  const targetPeerRow = {
    ...(market || day || {}),
    symbol: target,
    company: profile.company,
    chineseName: profile.chineseName,
    sector: profile.sector,
    marketCap: marketCapText,
    change: market ? getChange(market) : getChange(day || {}),
    volumeRatio: volume?.volumeRatio || market?.volumeRatio || strength?.crowding?.volumeRatio,
  };
  const peerTableRows = [
    targetPeerRow,
    ...uniqueBySymbol(peers)
      .filter((row) => normalizeStockSymbol(row.symbol) && normalizeStockSymbol(row.symbol) !== target)
      .sort((a, b) => (marketCapNumber(b.marketCap) || 0) - (marketCapNumber(a.marketCap) || 0) || getChange(b) - getChange(a))
      .slice(0, 6),
  ].filter((row) => normalizeStockSymbol(row.symbol));
  const peerRankRows = [...uniqueBySymbol([targetPeerRow, ...peers])]
    .filter((row) => normalizeStockSymbol(row.symbol))
    .sort((a, b) => (marketCapNumber(b.marketCap) || 0) - (marketCapNumber(a.marketCap) || 0) || getChange(b) - getChange(a))
    .map((row, index) => [normalizeStockSymbol(row.symbol), index + 1]);
  const peerRankMap = new Map(peerRankRows);
  const peerTableNote = (peer, isTarget) => {
    if (isTarget) return "当前标的";
    const change = getChange(peer);
    const ratio = parseRatio(peer.volumeRatio);
    if (Number.isFinite(change) && change >= 3 && Number.isFinite(ratio) && ratio >= 1.5) return "量价领先";
    if (Number.isFinite(change) && change < 0 && Number.isFinite(ratio) && ratio >= 1.5) return "放量走弱";
    if (marketCapNumber(peer.marketCap) && marketCapNumber(marketCapText) && marketCapNumber(peer.marketCap) > marketCapNumber(marketCapText)) return "大市值参照";
    return "同板块参照";
  };
  const stockMoveRow = targetPeerRow;
  const moveInsight = marketMoveExplanation(stockMoveRow, volume);
  const sectorUpCount = sectorRankRows.filter((row) => getChange(row) >= 0).length;
  const sectorDownCount = Math.max(0, sectorRankRows.length - sectorUpCount);
  const sectorBreadthText = sectorRankRows.length ? `${Math.round((sectorUpCount / sectorRankRows.length) * 100)}%上涨` : "--";
  const sectorLeaderText = strongestPeer ? `${strongestPeer.symbol} ${formatChangeValue(strongestPeer)}` : "--";
  const eventSummary = eventRow
    ? `${displayEventLabel(eventRow, eventTypeLabel(eventRow.eventType))} · ${eventRow.eventDate || "日期待补"}`
    : "暂无事件线索";
  const earningsSummary = quality
    ? `${quality.userAngle || "财报观察"} · ${quality.latestEarningsDate || "日期待补"}`
    : "暂无财报线索";
  const timelineItems = stockTimelineItems(target);
  const actionItems = stockActionChecklist(target);
  const research = stockResearchSummary({ target, market, strength, quality, eventRow, signal });
  const evidence = research.evidence;
  const dataSources = stockDataSources({ market, day, week, month, volume, strength, quality, eventRow, signal });
  const sourceCount = stockSourceCount(dataSources);
  const priority = stockReviewPriority({ target, market, day, week, month, volume, strength, quality, eventRow, signal });
  const verdict = stockResearchVerdict({ market, strength, quality, eventRow, signal });
  const heat = stockHeatSummary({ market, strength, month, volume });
  const watchState = stockWatchlistState(target);
  const macroExposure = stockMacroExposure(profile, market);
  const linkedCalendarRows = stockLinkedCalendarRows({ target, profile, macroExposure, quality });
  const directCalendarCount = linkedCalendarRows.filter((row) => row.matchType === "direct").length;
  const macroCalendarCount = linkedCalendarRows.filter((row) => row.matchType === "macro").length;
  const nextCalendarRow = linkedCalendarRows[0] || null;
  const earningsDateText = stockEarningsDateLabel(linkedCalendarRows, quality);
  const earningsFact = stockEarningsFact(linkedCalendarRows, quality);
  const sectorFlowDetailData = stockSectorFlowDetail(profile, sectorRankRows);
  const sectorFlowLeaders = (sectorFlowDetailData.leaders || [])
    .map((item) => normalizeStockSymbol(item.symbol || item.ticker))
    .filter(Boolean)
    .slice(0, 4);
  const primarySource = stockPrimarySource({ market, strength, quality, eventRow, signal });
  const reviewPlan = stockReviewPlan({ eventRow, quality, strength, signal, market });
  const dataDates = [
    productDetail?.profile?.updatedAt,
    state.eventOpportunities?.asOf,
    state.earningsQuality?.asOf,
    state.marketTemperature?.asOf,
    state.strength?.asOf,
  ].filter(Boolean).map(formatDisplayDate);
  const dataAsOf = dataDates.length ? dataDates.sort().at(-1) : "--";
  const signalSide = signalPolarity(signal);
  const priceMeta = signal
    ? `数据日期 ${escapeHtml(dataAsOf)} · 趋势信号表现 ${escapeHtml(signalPerformance)} · 依据 ${escapeHtml(`${sourceCount}项`)}`
    : `数据日期 ${escapeHtml(dataAsOf)} · 依据 ${escapeHtml(`${sourceCount}项`)}`;
  const signalCard = signal
    ? `
      <article class="stock-hub-card desk-panel">
        <div class="stock-card-head">
          <div>
            <span>趋势信号</span>
            <strong class="signal-status-text ${escapeHtml(signalSide.className)}"><i class="signal-side-pill ${escapeHtml(signalSide.className)}">${escapeHtml(signalSide.label)}</i>${escapeHtml(signalStatusText(signalSide))}</strong>
          </div>
          <em>${escapeHtml(signal.intervalLabel || signal.interval || "基础")}</em>
        </div>
        <div class="stock-metric-grid">
          ${stockMetric("当前多空", signalSide.label, signalSide.className)}
          ${stockMetric("周期", signal.intervalLabel || signal.interval || "--")}
          ${stockMetric("触发价", signal.price || "--")}
          ${stockMetric("现价", signal.livePrice || "--")}
          ${stockMetric("当前表现", signalPerformance, stockSignedClass(signalPerformance))}
          ${stockMetric("最佳表现", signal.maxFavorablePct || "--", stockSignedClass(signal.maxFavorablePct))}
          ${stockMetric("反向波动", signal.maxAdversePct || "--", "is-negative")}
        </div>
        <p class="stock-card-note">${escapeHtml(signalSide.note)} 已跟踪 ${escapeHtml(signal.signalAge || "--")}，首发时间 ${escapeHtml(signal.firstSignalAt || "--")}。</p>
      </article>
    `
    : `
      <article class="stock-hub-card desk-panel">
        <div class="stock-card-head">
          <div>
            <span>趋势信号</span>
            <strong class="signal-status-text is-neutral"><i class="signal-side-pill is-neutral">无信号</i>当前趋势信号：无信号</strong>
          </div>
          <em>未触发</em>
        </div>
        <div class="stock-metric-grid">
          ${stockMetric("当前多空", "无信号", "is-neutral")}
          ${stockMetric("周期", "--")}
          ${stockMetric("触发价", "--")}
          ${stockMetric("当前表现", "--")}
        </div>
        <p class="stock-card-note">该标的当前没有趋势信号，先以行情、成交额、板块和事件数据为主。</p>
      </article>
    `;
  const signalHistoryCard = events.length
    ? `
      <article class="stock-hub-card stock-hub-card-wide desk-panel" data-lockable-module="stock-hub-signal-history">
        <div class="stock-card-head">
          <div>
            <span>信号生命周期</span>
            <strong>从首发到复盘</strong>
          </div>
          <em>信号记录</em>
        </div>
        <div class="stock-event-list">
          ${events.slice(0, 5).map((item) => `
            <div>
              <span>${escapeHtml(item.currentTime || item.receivedAt || "--")}</span>
              <strong>${escapeHtml(eventTypeLabel(item.eventType))} · ${escapeHtml(directionLabel(item.direction, item.directionText))}</strong>
              <p>触发价 ${escapeHtml(item.price || "--")}，现价 ${escapeHtml(item.livePrice || "--")}，表现 ${escapeHtml(item.marketChangePct || "--")}。</p>
            </div>
          `).join("")}
        </div>
      </article>
    `
    : "";
  const riskFacts = [
    ["行情风险", market?.risk || "先看价格、成交额和板块是否同步确认"],
    ["财报风险", quality?.userRisk || "暂无独立财报风险标签"],
    ["事件风险", eventRow?.risk || "暂无独立事件风险标签"],
    ["宏观背景", macroExposure.label || "按市场温度辅助判断"],
  ];
  const signedNumberClass = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number === 0) return "";
    return number > 0 ? "is-positive" : "is-negative";
  };
  const peerBoardRow = (peer, board) => {
    const peerSymbol = normalizeStockSymbol(peer?.symbol);
    if (!peerSymbol) return null;
    if (peerSymbol === target) {
      return { day, week, month, volume, ytd }[board] || peer;
    }
    return getBoardRow(board, peerSymbol) || (board === "day" ? findMarketRow(peerSymbol) : null) || peer;
  };
  const renderPeerComparisonRow = (peer) => {
    const peerSymbol = normalizeStockSymbol(peer.symbol);
    const isTarget = peerSymbol === target;
    const dayRow = peerBoardRow(peer, "day");
    const weekRow = peerBoardRow(peer, "week");
    const monthRow = peerBoardRow(peer, "month");
    const volumeRow = peerBoardRow(peer, "volume");
    const dayChange = getChange(dayRow || peer);
    const weekChange = getChange(weekRow || {});
    const monthChange = getChange(monthRow || {});
    const note = peerTableNote(peer, isTarget);
    const peerRank = peerRankMap.get(peerSymbol);
    const rankText = isTarget ? "本股" : String(peerRank || "--").padStart(2, "0");
    return `
      <div class="stock-peer-workbench-row ${isTarget ? "is-current" : ""}" data-stock-open="${escapeHtml(peerSymbol)}" role="button" tabindex="0">
        <span class="stock-peer-rank">${escapeHtml(rankText)}</span>
        <span class="stock-peer-symbol">
          <strong>${escapeHtml(peerSymbol)}</strong>
          <small>${escapeHtml(isTarget ? "当前标的" : `板块第 ${peerRank || "--"}`)}</small>
        </span>
        <span class="stock-peer-company">${escapeHtml(peer.company || peer.name || peer.chineseName || peerSymbol)}</span>
        <b class="${signedNumberClass(dayChange)}">${escapeHtml(Number.isFinite(dayChange) ? formatSignedPct(dayChange) : "--")}</b>
        <b class="${signedNumberClass(weekChange)}">${escapeHtml(Number.isFinite(weekChange) ? formatSignedPct(weekChange) : "--")}</b>
        <b class="${signedNumberClass(monthChange)}">${escapeHtml(Number.isFinite(monthChange) ? formatSignedPct(monthChange) : "--")}</b>
        <em>${escapeHtml(peer.marketCap || "--")}</em>
        <small>${escapeHtml(formatVolumeRatioLabel(volumeRow?.volumeRatio || peer.volumeRatio) || volumeRow?.volume || "--")}</small>
        <small>${escapeHtml(note)}</small>
      </div>
    `;
  };
  const stockFactRow = (label, value, note, className = "") => `
    <tr>
      <th scope="row">${escapeHtml(label)}</th>
      <td><strong class="${escapeHtml(className)}">${escapeHtml(value || "--")}</strong></td>
      <td>${escapeHtml(note || "--")}</td>
    </tr>
  `;
  const calendarFactValue = nextCalendarRow
    ? `${formatDisplayDate(nextCalendarRow.date)} · ${eventTypeLabel(nextCalendarRow.type)}`
    : "暂无直接日程";
  const eventReturnClass = eventRow?.return20dPct == null ? "" : signedNumberClass(eventRow.return20dPct);
  const targetUpsideClass = quality?.avgPriceTargetUpsidePct == null ? "" : signedNumberClass(quality.avgPriceTargetUpsidePct);
  const eventFactRows = [
    stockFactRow("财经日历", calendarFactValue, nextCalendarRow?.title || `直接 ${directCalendarCount} 条，宏观 ${macroCalendarCount} 条`),
    stockFactRow("下一次财报", earningsFact.label, earningsFact.note),
    stockFactRow("事件类型", eventRow ? displayEventLabel(eventRow) : "--", eventRow?.eventDate ? `事件日期 ${formatDisplayDate(eventRow.eventDate)}` : "暂无独立事件日期"),
    stockFactRow("事件后20日", eventRow?.return20dPct == null ? "--" : formatSignedPct(eventRow.return20dPct), compactText(eventRow?.reason, 96) || "暂无事件表现数据", eventReturnClass),
    stockFactRow("财报口径", quality?.userAngle || "--", compactText(quality?.userReason, 96) || "暂无财报摘要"),
    stockFactRow("目标空间", targetUpside, quality?.avgPriceTargetUpsidePct == null ? "暂无目标价空间数据" : "用于观察预期是否还有上修空间", targetUpsideClass),
  ].join("");
  const flowFactRows = [
    stockFactRow("板块资金", sectorFlowDetailData.netFlow, `${sectorFlowDetailData.label} · 活跃成交 ${sectorFlowDetailData.activeValue}`, sectorFlowDetailData.className),
    stockFactRow("上涨广度", sectorFlowDetailData.breadth, `${sectorUpCount}涨/${sectorDownCount}跌 · ${sectorBreadthText}`),
    stockFactRow("成交额异动", volumeRatioText, `${volumeSummary.label} · ${volumeSummary.note}`),
    stockFactRow("代表标的", sectorFlowLeaders.join(" / ") || "--", strongestPeer ? `板块领先 ${sectorLeaderText}` : "等待板块样本"),
    ...riskFacts.map(([label, value]) => stockFactRow(label, compactText(value, 52) || "--", label === "宏观背景" ? macroExposure.note : "作为复盘过滤条件")),
    stockFactRow("复盘动作", compactText(reviewPlan, 64) || "--", priority.reason || "等待更多数据"),
    stockFactRow("数据口径", `${sourceCount}项数据`, `更新至 ${dataAsOf}`),
  ].join("");

  setText("#stockHubSymbol", target);
  setText(
    "#stockHubSubtitle",
    `${profile.chineseName ? `${profile.chineseName} · ` : ""}${profile.company || "单股观察"} · ${profile.sector} · ${watchState.active ? `自选：${watchState.statusLabel}` : "未加入自选"}`,
  );

  content.innerHTML = `
    <section class="stock-hub-hero stock-identity-strip">
      <div class="stock-identity-card">
        <div>
          <span>单股画像</span>
          <strong>${escapeHtml(target)}</strong>
          <p>${escapeHtml(profile.chineseName ? `${profile.chineseName} · ${profile.company}` : profile.company || "等待名称数据补充")}</p>
        </div>
        <div class="stock-badge-row">
          <span>${escapeHtml(profile.sector)}</span>
          <span class="signal-status-chip ${escapeHtml(signalSide.className)}">${escapeHtml(signalStatusText(signalSide))}</span>
          ${watchlistActionButton(target, "股票详情")}
        </div>
      </div>
      <div class="stock-price-card">
        <span>最近价</span>
        <strong>${escapeHtml(typeof currentPrice === "number" ? formatMoney(currentPrice) : currentPrice)}</strong>
        <p>${priceMeta}</p>
      </div>
    </section>

    <section class="stock-watchlist-bridge" aria-label="自选复盘联动">
      <article>
        <span>自选状态</span>
        <strong class="${escapeHtml(watchState.active ? watchState.statusClass : "is-muted")}">${escapeHtml(watchState.title)}</strong>
        <p>${escapeHtml(`${watchState.source} · ${watchState.review}`)}</p>
      </article>
      <article>
        <span>复盘安排</span>
        <strong>${escapeHtml(watchState.active && Number.isFinite(watchState.score) ? `${watchState.score}分` : `${priority.score}分`)}</strong>
        <p>${escapeHtml(compactText(watchState.active ? watchState.reason : watchState.note, 82))}</p>
      </article>
      <article>
        <span>板块位置</span>
        <strong>${escapeHtml(sectorRankText)}</strong>
        <p>${escapeHtml(`市值 ${marketCapPosition} · 板块均值 ${sectorAverageText}`)}</p>
      </article>
      <article>
        <span>事件 / 财报</span>
        <strong>${escapeHtml(nextCalendarRow ? `${formatDisplayDate(nextCalendarRow.date)} · ${eventTypeLabel(nextCalendarRow.type)}` : earningsDateText)}</strong>
        <p>${escapeHtml(compactText(nextCalendarRow?.title || eventSummary || earningsSummary, 82))}</p>
      </article>
    </section>

    <section class="stock-market-strip" aria-label="单股行情摘要">
      <article>
        <span>市值</span>
        <strong>${escapeHtml(marketCapText)}</strong>
        <p>${escapeHtml(marketCapPosition)}</p>
      </article>
      <article>
        <span>板块</span>
        <strong>${escapeHtml(profile.sector)}</strong>
        <p>涨跌位置 ${escapeHtml(sectorRankText)} · 均值 ${escapeHtml(sectorAverageText)}</p>
      </article>
      <article>
        <span>成交额异动 <button class="info-tip" type="button" aria-label="成交额异动解释" data-tip="当前成交额相对平时成交额的倍数。1.00x 约等于平时水平，4.90x 表示成交额接近平时的 4.9 倍。">?</button></span>
        <strong>${escapeHtml(volumeRatioText)}</strong>
        <p>${escapeHtml(`${volumeSummary.label} · ${volumeSummary.note}`)}</p>
      </article>
      <article>
        <span>资金流向摘要</span>
        <strong class="${escapeHtml(sectorFlowDetailData.className)}">${escapeHtml(sectorFlowDetailData.netFlow)}</strong>
        <p>${escapeHtml(`${sectorFlowDetailData.label} · 广度 ${sectorFlowDetailData.breadth} · 活跃成交 ${sectorFlowDetailData.activeValue}`)}</p>
      </article>
    </section>

    <section class="stock-core-row metric-row" aria-label="单股核心判断">
      <article class="metric-cell">
        <span>价格与位置</span>
        <strong>${escapeHtml(heat.label)}</strong>
        <p>${escapeHtml(heat.note)}</p>
      </article>
      <article class="metric-cell">
        <span>强弱与资金</span>
        <strong>${escapeHtml(primarySource)}</strong>
        <p>${escapeHtml(research.title)}</p>
      </article>
      <article class="metric-cell">
        <span>风险与下一步</span>
        <strong>${escapeHtml(`${priority.score}分 · ${verdict}`)}</strong>
        <p>${escapeHtml(reviewPlan)}。${escapeHtml(research.risk)}</p>
      </article>
    </section>

    <section class="stock-move-link-panel" aria-label="行情异动联动">
      <article>
        <div>
          <span>异动解释</span>
          <strong class="${escapeHtml(moveInsight.tone)}">${escapeHtml(moveInsight.title)}</strong>
        </div>
        <p>${escapeHtml(moveInsight.reasons.join(" / ") || "暂无明确异动标签")}</p>
        <small>${escapeHtml(moveInsight.note)}</small>
      </article>
      <article>
        <div>
          <span>板块线索</span>
          <strong>${escapeHtml(profile.sector)}</strong>
        </div>
        <p><b class="${sectorUpCount >= sectorDownCount ? "is-positive" : "is-negative"}">${escapeHtml(sectorBreadthText)}</b> · ${escapeHtml(`${sectorUpCount}涨/${sectorDownCount}跌`)}</p>
        <small>板块龙头 ${escapeHtml(sectorLeaderText)} · 本股位置 ${escapeHtml(sectorRankText)}</small>
      </article>
      <article>
        <div>
          <span>成交额说明</span>
          <strong>${escapeHtml(volumeRatioText)}</strong>
        </div>
        <p>${escapeHtml(`${volumeSummary.label} · 板块资金 ${sectorFlowDetailData.netFlow}`)}</p>
        <small>${escapeHtml(`活跃成交 ${sectorFlowDetailData.activeValue} · 广度 ${sectorFlowDetailData.breadth}`)}</small>
      </article>
      <article>
        <div>
          <span>下一步动作</span>
          <strong>${escapeHtml(`${priority.score}分`)}</strong>
        </div>
        <p>${escapeHtml(reviewPlan)}</p>
        <small>${escapeHtml(priority.reason || "等待更多数据")}</small>
      </article>
    </section>

    <section class="stock-research-strip" aria-label="单股研究摘要">
      <article>
        <div>
          <span>同板块对比</span>
          <strong>${escapeHtml(sectorRankText)}</strong>
        </div>
        <p>板块均值 ${escapeHtml(sectorAverageText)}，当前领先 ${escapeHtml(strongestPeer ? `${strongestPeer.symbol} ${formatChangeValue(strongestPeer)}` : "--")}。</p>
        <div class="stock-mini-list">
          ${
            peerRows.length
              ? peerRows.map((peer) => `<b>${escapeHtml(peer.symbol)} <em class="${getChange(peer) >= 0 ? "is-positive" : "is-negative"}">${formatChangeValue(peer)}</em></b>`).join("")
              : "<p>等待同板块样本。</p>"
          }
        </div>
      </article>
      <article>
        <div>
          <span>成交解释</span>
          <strong>${escapeHtml(volumeRatioText)}</strong>
        </div>
        <p>${escapeHtml(volumeSummary.note)}</p>
        <div class="stock-mini-grid">
          <b>1D ${formatChangeValue(day)}</b>
          <b>近周 ${formatChangeValue(week)}</b>
          <b>近月 ${formatChangeValue(month)}</b>
        </div>
      </article>
      <article>
        <div>
          <span>事件 / 财报</span>
          <strong>${escapeHtml(nextCalendarRow ? `${formatDisplayDate(nextCalendarRow.date)} · ${eventTypeLabel(nextCalendarRow.type)}` : earningsDateText)}</strong>
        </div>
        <p>${escapeHtml(nextCalendarRow?.title || eventSummary)}</p>
        <p>财报 ${escapeHtml(earningsDateText)}${quality?.avgPriceTargetUpsidePct == null ? "" : ` · 目标价空间 ${escapeHtml(targetUpside)}`}</p>
      </article>
    </section>

    <section class="stock-terminal-grid" aria-label="单股工作台事实表">
      <article class="stock-terminal-panel">
        <div class="stock-terminal-head">
          <div>
            <span>同板块排序</span>
            <strong>${escapeHtml(profile.sector)}</strong>
          </div>
          <em>${escapeHtml(sectorRankText)}</em>
        </div>
        <div class="stock-peer-workbench-table" role="table" aria-label="同板块可比股票">
          <div class="stock-peer-workbench-row is-head" role="row">
            <span>排序</span>
            <span>代码</span>
            <span>公司</span>
            <span>1D</span>
            <span>5D</span>
            <span>1M</span>
            <span>市值</span>
            <span>成交异动</span>
            <span>备注</span>
          </div>
          ${
            peerTableRows.length
              ? peerTableRows.map(renderPeerComparisonRow).join("")
              : `<div class="stock-terminal-empty">该标的暂无可比板块样本，先看自身行情、成交额和事件数据。</div>`
          }
        </div>
      </article>
      <article class="stock-terminal-panel">
        <div class="stock-terminal-head">
          <div>
            <span>事件 / 财报 / 资金</span>
            <strong>事实表</strong>
          </div>
          <em>研究</em>
        </div>
        <div class="stock-linked-calendar">
          <div class="stock-linked-summary">
            <span>财经日历关联</span>
            <strong>${escapeHtml(nextCalendarRow ? nextCalendarRow.title : "暂无直接日程")}</strong>
            <em>${escapeHtml(`直接 ${directCalendarCount} · 宏观 ${macroCalendarCount}`)}</em>
          </div>
          <div class="stock-linked-list">
            ${renderStockCalendarRows(linkedCalendarRows)}
          </div>
        </div>
        <div class="stock-fact-matrix">
          <section>
            <h3>日程 / 财报事实</h3>
            <table class="stock-detail-fact-table">
              <thead><tr><th>字段</th><th>当前值</th><th>解读</th></tr></thead>
              <tbody>${eventFactRows}</tbody>
            </table>
          </section>
          <section class="stock-risk-facts">
            <h3>资金 / 风险</h3>
            <table class="stock-detail-fact-table">
              <thead><tr><th>字段</th><th>当前值</th><th>解读</th></tr></thead>
              <tbody>${flowFactRows}</tbody>
            </table>
          </section>
        </div>
      </article>
    </section>

    <section class="stock-macro-panel" data-lockable-module="stock-hub-macro" aria-label="单股宏观背景">
      <div class="stock-macro-copy">
        <span>宏观背景</span>
        <h2>${escapeHtml(macroExposure.label)}</h2>
        <p>${escapeHtml(macroExposure.note)}</p>
      </div>
      <div class="stock-macro-grid">
        ${
          macroExposure.rows.length
            ? macroExposure.rows.map((indicator) => `
                <article class="${signalClass(indicator.status)}">
                  <span>
                    ${escapeHtml(indicator.name || "宏观指标")}
                    <button class="info-tip" type="button" aria-label="${escapeHtml(indicator.name || "宏观指标")}解释" data-tip="${escapeHtml(marketIndicatorTip(indicator))}">?</button>
                  </span>
                  <strong>${escapeHtml(indicator.value || "--")} · ${escapeHtml(indicator.level || "--")}</strong>
                  <p>${escapeHtml(macroImpactCopy(indicator))}</p>
                  <em>${escapeHtml(indicator.explain || "--")}</em>
                </article>
              `).join("")
            : `
              <article>
                <span>宏观背景</span>
                <strong>暂无匹配指标</strong>
                <p>当前先以价格、成交额、板块和事件线索复盘。</p>
              </article>
            `
        }
      </div>
    </section>

    <section class="stock-research-panel desk-panel">
      <article class="stock-research-main">
        <span>研究摘要</span>
        <h2>${escapeHtml(research.title)}</h2>
        <p>${escapeHtml(research.nextStep)}</p>
        <div class="stock-research-actions">
          ${watchlistActionButton(target, eventRow ? "股票事件" : "股票详情")}
          <button class="ghost-action" type="button" data-page-link="watchlist">去自选</button>
        </div>
      </article>
      <article class="stock-research-side">
        <span>当前状态</span>
        <strong>${escapeHtml(research.currentState)}</strong>
        <p>${escapeHtml(research.risk)}</p>
      </article>
    </section>

    <section class="stock-evidence-grid metric-row">
      <article class="metric-cell">
        <span>同类历史样本</span>
        <strong>${escapeHtml(evidence.count ? formatNumber(evidence.count) : "样本不足")}</strong>
        <p>${escapeHtml(evidence.label)} · ${escapeHtml(evidence.status)}</p>
      </article>
      <article class="metric-cell">
        <span>20日正向占比</span>
        <strong>${escapeHtml(formatEvidencePct(evidence.positiveRate, evidence.count))}</strong>
        <p>只在样本量足够时展示</p>
      </article>
      <article class="metric-cell">
        <span>强于SPY占比</span>
        <strong>${escapeHtml(formatEvidencePct(evidence.strongerSpyRate, evidence.count))}</strong>
        <p>和大盘做相对比较</p>
      </article>
      <article class="metric-cell">
        <span>稳健均值</span>
        <strong>${escapeHtml(formatEvidenceSignedPct(evidence.stableAverage, evidence.count))}</strong>
        <p>去除极端值后的参考</p>
      </article>
    </section>

    <section class="stock-hub-grid stock-hub-grid-compact workspace-main">
      ${signalCard}

      <article class="stock-hub-card desk-panel" data-lockable-module="stock-hub-action-plan">
        <div class="stock-card-head">
          <div>
            <span>下一步怎么跟</span>
            <strong>观察清单</strong>
          </div>
          <em>复盘动作</em>
        </div>
        <div class="stock-checklist">
          ${actionItems.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}
        </div>
      </article>

      <article class="stock-hub-card desk-panel" data-lockable-module="stock-hub-history">
        <div class="stock-card-head">
          <div>
            <span>观察记录</span>
            <strong>${timelineItems.length ? `${timelineItems.length} 条记录` : "等待记录"}</strong>
          </div>
          <em>记录</em>
        </div>
        <div class="stock-timeline">
          ${
            timelineItems.length
              ? timelineItems.map((item) => `
                  <div>
                    <span>${escapeHtml(item.label)}</span>
                    <strong>${escapeHtml(item.title)}</strong>
                    <p>${escapeHtml(item.value)}</p>
                  </div>
                `).join("")
            : "<p class=\"stock-card-note\">暂无观察记录。先看行情、成交额、板块和事件事实表。</p>"
          }
        </div>
      </article>

      ${signalHistoryCard}
    </section>
  `;
};

const openStockHub = (symbol) => {
  const target = normalizeStockSymbol(symbol);
  if (!target) return;
  const activeView = document.querySelector(".page-view.is-active");
  state.stockBackPage = activeView?.dataset.view && activeView.dataset.view !== "stock" ? activeView.dataset.view : state.stockBackPage || "market";
  state.selectedStockSymbol = target;
  showPage("stock", { hash: `#stock/${encodeURIComponent(target)}` });
  renderStockHub(target);
  loadProductStockDetail(target).then((detail) => {
    if (detail && state.selectedStockSymbol === target) renderStockHub(target);
  });
  if (!state.signals) {
    loadSignals().then(() => renderStockHub(target));
  }
};

const valuationMetricConfig = {
  pe: {
    label: "PE",
    title: "PE 估值走势",
    unit: "x",
    tip: "市盈率，常用来观察价格相对盈利的水平。",
  },
  pb: {
    label: "PB",
    title: "PB 估值走势",
    unit: "x",
    tip: "市净率，常用来观察价格相对净资产的水平。",
  },
  roe: {
    label: "ROE",
    title: "ROE 走势",
    unit: "%",
    tip: "净资产收益率，观察企业使用股东权益创造利润的效率。",
  },
  dividendYield: {
    label: "股息率",
    title: "股息率走势",
    unit: "%",
    tip: "年度股息相对价格的比例，用于观察现金分红水平。",
  },
  peg: {
    label: "PEG",
    title: "PEG 走势",
    unit: "x",
    tip: "市盈率相对盈利增速的比例，用于把估值和增长放在一起观察。",
  },
};

const parseValuationNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/[%x倍,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const formatValuationValue = (value, unit = "") => {
  const number = parseValuationNumber(value);
  if (!Number.isFinite(number)) return "--";
  const decimals = Math.abs(number) >= 100 ? 1 : 2;
  if (unit === "%") return `${number.toFixed(decimals)}%`;
  if (unit === "x") return `${number.toFixed(decimals)}x`;
  return number.toFixed(decimals);
};

const formatValuationPercentile = (value) => {
  const number = parseValuationNumber(value);
  if (!Number.isFinite(number)) return "等待分位";
  return `${Math.round(Math.max(0, Math.min(100, number)))}%分位`;
};

const valuationPayloadReady = (payload) =>
  Boolean(payload && !["waiting", "waiting_for_data", "pending"].includes(String(payload.status || "").toLowerCase()) && !payload.frontendHints?.showWaitingState);

const normalizeValuationMetrics = (payload) => {
  const rawMetrics = payload?.metrics || payload?.indicators || payload?.valuation || {};
  const rawMetricMap = Array.isArray(rawMetrics)
    ? Object.fromEntries(rawMetrics.map((item) => [item.key || item.id || item.label, item]))
    : rawMetrics;
  const trendMap = Array.isArray(payload?.trendSeries)
    ? Object.fromEntries(payload.trendSeries.map((item) => [item.key || item.metric || item.id, item]))
    : payload?.trendSeries || {};
  const percentileItems = payload?.historyPercentiles?.items;
  const percentileMap = Array.isArray(percentileItems)
    ? Object.fromEntries(percentileItems.map((item) => [item.key || item.metric || item.id, item]))
    : {};
  return Object.entries(valuationMetricConfig).reduce((acc, [key, config]) => {
    const raw = rawMetricMap[key] || rawMetricMap[config.label] || rawMetricMap[key.toLowerCase()] || {};
    const trend = trendMap[key] || {};
    const percentileItem = percentileMap[key] || {};
    const series = (raw.series || raw.points || raw.data || raw.trend || trend.series || trend.points || trend.data || [])
      .map((point) => ({
        date: point.date || point.t || point[0],
        value: parseValuationNumber(point.value ?? point.close ?? point.y ?? point[1]),
      }))
      .filter((point) => point.date && Number.isFinite(point.value))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    acc[key] = {
      ...raw,
      key,
      label: raw.label || config.label,
      unit: raw.unit || config.unit,
      value: raw.current ?? raw.currentValue ?? raw.latestValue ?? raw.value ?? series.at(-1)?.value,
      percentile: raw.percentile?.fiveYear ?? raw.percentile?.tenYear ?? raw.percentile ?? raw.rankPercentile ?? raw.percentileRank ?? raw.percentiles?.fiveYear ?? percentileItem.percentile,
      note: raw.note || raw.summary || raw.description || "等待数据",
      refs: raw.refs || raw.bands || raw.referenceLines || {
        p25: raw.p25 ?? percentileItem.p25,
        median: raw.median ?? percentileItem.median,
        p75: raw.p75 ?? percentileItem.p75,
      },
      series,
    };
    return acc;
  }, {});
};

const renderValuationNavState = (ready) => {
  document.querySelectorAll("[data-valuation-nav]").forEach((item) => {
    item.classList.toggle("nav-item-waiting", !ready);
    item.dataset.valuationState = ready ? "ready" : "waiting";
  });
  document.querySelectorAll("[data-valuation-nav-link]").forEach((item) => {
    item.dataset.valuationState = ready ? "ready" : "waiting";
  });
  const module = pageModules.find((item) => item.id === "valuation");
  if (module) module.status = ready ? "数据驱动" : "待数据";
};

const getActiveIndexValuation = (payload) => {
  const indices = Array.isArray(payload?.indices) ? payload.indices : [];
  if (!indices.length) return payload;
  const selected = indices.find((item) => String(item?.index?.symbol || "").toUpperCase() === state.valuationIndex);
  return selected || indices[0] || payload;
};

const valuationIndexName = (symbol, fallback = "") => {
  if (symbol === "QQQ") return "纳指 100";
  if (symbol === "SPY") return "标普 500";
  return fallback || symbol || "指数";
};

const valuationReferenceMarkers = (refs, geometry, min, max, unit) => {
  const markers = [
    ["P75", refs.p75 ?? refs.p70],
    ["中位", refs.median],
    ["P25", refs.p25 ?? refs.p30],
  ];
  return markers
    .map(([label, rawValue]) => {
      const value = parseValuationNumber(rawValue);
      if (!Number.isFinite(value)) return "";
      const y = macroSeriesYFromValue(value, geometry, min, max);
      if (y < geometry.y - 1 || y > geometry.y + geometry.height + 1) return "";
      return `
        <g class="valuation-ref">
          <line x1="${geometry.x}" x2="${geometry.x + geometry.width}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"></line>
          <text x="${geometry.labelX}" y="${(y + 4).toFixed(1)}">${escapeHtml(label)} ${escapeHtml(formatValuationValue(value, unit))}</text>
        </g>
      `;
    })
    .join("");
};

const valuationRangeDays = {
  "3m": 92,
  "6m": 183,
  "1y": 366,
};

const filterValuationSeriesByRange = (points) => {
  const days = valuationRangeDays[state.valuationRange];
  if (!days || points.length < 2) return points;
  const lastDate = new Date(points.at(-1).date);
  if (Number.isNaN(lastDate.getTime())) return points;
  const cutoff = new Date(lastDate);
  cutoff.setDate(cutoff.getDate() - days);
  const filtered = points.filter((point) => new Date(point.date) >= cutoff);
  return filtered.length >= 2 ? filtered : points;
};

const valuationDateTicks = (points, geometry) => {
  if (!points.length) return "";
  const tickCount = points.length < 45 ? 3 : 4;
  const indexes = Array.from({ length: tickCount }, (_, index) =>
    Math.round((index * (points.length - 1)) / Math.max(1, tickCount - 1)),
  );
  return [...new Set(indexes)]
    .map((index) => {
      const point = points[index];
      const x = geometry.x + (points.length > 1 ? (geometry.width * index) / (points.length - 1) : 0);
      return `<text class="macro-series-x-label" x="${x.toFixed(1)}" y="${geometry.y + geometry.height + 28}" text-anchor="${index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}">${escapeHtml(formatDisplayDate(point.date).slice(0, 7))}</text>`;
    })
    .join("");
};

const valuationMetricSparkline = (metric) => {
  const points = filterValuationSeriesByRange(metric?.series || []).slice(-72);
  if (points.length < 2) return "";
  const values = points.map((point) => point.value).filter(Number.isFinite);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = maxValue - minValue || 1;
  const width = 150;
  const height = 38;
  const pad = 3;
  const path = points
    .map((point, index) => {
      const x = pad + ((width - pad * 2) * index) / Math.max(1, points.length - 1);
      const y = pad + (1 - (point.value - minValue) / span) * (height - pad * 2);
      return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const first = points[0].value;
  const last = points.at(-1).value;
  const trendClass = last >= first ? "is-up" : "is-down";
  return `
    <div class="valuation-metric-spark ${trendClass}" aria-hidden="true">
      <svg viewBox="0 0 ${width} ${height}">
        <path d="${path}"></path>
      </svg>
      <span>${last >= first ? "近阶段上行" : "近阶段回落"}</span>
    </div>
  `;
};

const bindValuationChartHover = (points, geometry, min, max, unit) => {
  const svg = document.querySelector("#valuationChartWrap svg");
  const hover = svg?.querySelector("[data-valuation-hover]");
  const hit = svg?.querySelector("[data-valuation-hover-hit]");
  if (!svg || !hover || !hit || points.length < 2) return;
  const line = hover.querySelector("[data-hover-line]");
  const dot = hover.querySelector("[data-hover-dot]");
  const box = hover.querySelector("[data-hover-box]");
  const dateText = hover.querySelector("[data-hover-date]");
  const valueText = hover.querySelector("[data-hover-value]");
  const positions = points.map((point, index) => macroSeriesPositionFromGeometry(point, index, points.length, geometry, min, max));

  const setHover = (event) => {
    const rect = svg.getBoundingClientRect();
    const viewBoxWidth = svg.viewBox.baseVal.width || 1280;
    const x = ((event.clientX - rect.left) / rect.width) * viewBoxWidth;
    const index = Math.max(
      0,
      Math.min(
        points.length - 1,
        Math.round(((x - geometry.x) / Math.max(1, geometry.width)) * (points.length - 1)),
      ),
    );
    const point = points[index];
    const position = positions[index];
    const boxX = Math.min(geometry.x + geometry.width - 136, Math.max(geometry.x + 8, position.x + 12));
    const boxY = Math.max(geometry.y + 10, Math.min(geometry.y + geometry.height - 68, position.y - 70));
    hover.style.opacity = "1";
    line.setAttribute("x1", position.x.toFixed(1));
    line.setAttribute("x2", position.x.toFixed(1));
    line.setAttribute("y1", geometry.y);
    line.setAttribute("y2", geometry.y + geometry.height);
    dot.setAttribute("cx", position.x.toFixed(1));
    dot.setAttribute("cy", position.y.toFixed(1));
    box.setAttribute("transform", `translate(${boxX.toFixed(1)}, ${boxY.toFixed(1)})`);
    dateText.textContent = formatDisplayDate(point.date);
    valueText.textContent = formatValuationValue(point.value, unit);
  };

  hit.addEventListener("pointermove", setHover);
  hit.addEventListener("pointerleave", () => {
    hover.style.opacity = "0";
  });
};

const renderValuationChart = (metric) => {
  const wrap = document.querySelector("#valuationChartWrap");
  if (!wrap) return;
  const config = valuationMetricConfig[metric.key] || valuationMetricConfig.pe;
  const points = filterValuationSeriesByRange(metric.series || []);
  if (points.length < 2) {
    const hasCurrentValue = Number.isFinite(parseValuationNumber(metric.value));
    wrap.innerHTML = `
      <div class="valuation-empty-chart">
        <span>${escapeHtml(hasCurrentValue ? "等待完整历史" : "等待估值数据")}</span>
        <strong>${escapeHtml(hasCurrentValue ? `${config.label} 当前值已显示` : `${config.title}将在数据接入后显示`)}</strong>
        <p>${escapeHtml(hasCurrentValue ? "历史分位需要同口径历史估值序列，当前先展示最新覆盖样本读数。" : "当前不会展示示意数值。")}</p>
      </div>
    `;
    return;
  }

  const refs = metric.refs || {};
  const refValues = [refs.p25, refs.p30, refs.median, refs.p70, refs.p75].map(parseValuationNumber).filter(Number.isFinite);
  const values = [...points.map((point) => point.value), ...refValues];
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const padding = (maxValue - minValue || Math.abs(maxValue) || 1) * 0.08;
  const min = minValue - padding;
  const max = maxValue + padding;
  const width = 1280;
  const height = 420;
  const geometry = { x: 96, y: 44, width: 910, height: 286, axisX: 72, labelX: 1028 };
  const linePath = macroSeriesPathFromGeometry(points, geometry, min, max);
  const areaPath = `${linePath} L${geometry.x + geometry.width} ${geometry.y + geometry.height} L${geometry.x} ${geometry.y + geometry.height} Z`;
  const end = points.at(-1);
  const endPosition = macroSeriesPositionFromGeometry(end, points.length - 1, points.length, geometry, min, max);
  const ticks = macroSeriesTickValues(min, max, 5);
  const clipId = `valuation-clip-${metric.key}`;
  const currentValue = formatValuationValue(metric.value, metric.unit);
  const calloutX = Math.min(width - 172, endPosition.x + 28);
  const calloutY = Math.max(48, Math.min(height - 108, endPosition.y - 34));

  wrap.innerHTML = `
    <svg class="valuation-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(config.title)}">
      <defs>
        <clipPath id="${clipId}">
          <rect x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}"></rect>
        </clipPath>
      </defs>
      <rect class="valuation-plot-bg" x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}"></rect>
      ${macroSeriesYAxis(ticks, geometry, metric.unit)}
      ${valuationReferenceMarkers(refs, geometry, min, max, metric.unit)}
      <g clip-path="url(#${clipId})">
        <path class="valuation-area" d="${areaPath}"></path>
        <path class="valuation-line" d="${linePath}"></path>
      </g>
      <line class="valuation-current-guide" x1="${endPosition.x.toFixed(1)}" x2="${(calloutX - 12).toFixed(1)}" y1="${endPosition.y.toFixed(1)}" y2="${(calloutY + 33).toFixed(1)}"></line>
      <circle class="valuation-current-dot" cx="${endPosition.x.toFixed(1)}" cy="${endPosition.y.toFixed(1)}" r="5"></circle>
      <g class="valuation-current-callout" transform="translate(${calloutX.toFixed(1)}, ${calloutY.toFixed(1)})">
        <rect width="148" height="66" rx="7"></rect>
        <text x="14" y="21">当前值</text>
        <text class="valuation-current-value" x="14" y="44">${escapeHtml(currentValue)}</text>
        <text class="valuation-current-date" x="14" y="58">${escapeHtml(formatDisplayDate(end.date))}</text>
      </g>
      <g class="valuation-hover" data-valuation-hover style="opacity:0">
        <line data-hover-line x1="0" x2="0" y1="0" y2="0"></line>
        <circle data-hover-dot cx="0" cy="0" r="5"></circle>
        <g data-hover-box>
          <rect width="126" height="58" rx="6"></rect>
          <text data-hover-date x="12" y="22"></text>
          <text class="valuation-hover-value" data-hover-value x="12" y="44"></text>
        </g>
      </g>
      <rect class="valuation-hover-hit" data-valuation-hover-hit x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}"></rect>
      ${valuationDateTicks(points, geometry)}
    </svg>
  `;
  bindValuationChartHover(points, geometry, min, max, metric.unit);
};

const formatValuationWeight = (value) => {
  const number = parseValuationNumber(value);
  if (!Number.isFinite(number)) return "--";
  return `${number.toFixed(number >= 10 ? 1 : 2)}%`;
};

const formatValuationStat = (value, suffix = "") => {
  const number = parseValuationNumber(value);
  if (!Number.isFinite(number)) return "--";
  return `${formatNumber(Math.round(number))}${suffix}`;
};

const renderValuationHoldings = (payload, ready) => {
  const panel = document.querySelector("#valuationHoldingsPanel");
  if (!panel) return;
  const coverage = payload?.holdingsCoverage || {};
  const topHoldings = payload?.topHoldings || coverage.topHoldings || [];
  const hasHoldings = ready && topHoldings.length > 0;

  if (!hasHoldings) {
    panel.innerHTML = `
      <div class="valuation-holdings-head">
        <div>
          <span>持仓结构</span>
          <h2>等待持仓数据</h2>
        </div>
        <p>成分权重接入后，会显示前十大持仓和当前覆盖情况。</p>
      </div>
    `;
    return;
  }

  const stats = [
    ["持仓数量", formatValuationStat(coverage.valuationHoldings || coverage.holdingsWithTicker), "只"],
    ["权重覆盖", formatValuationWeight(coverage.valuationWeightPct || coverage.priceCoveredWeightPct), ""],
    ["价格覆盖", formatValuationWeight(coverage.priceCoveragePctOfValuationWeight), ""],
  ];

  const maxWeight = Math.max(...topHoldings.map((item) => parseValuationNumber(item.weightPct) || 0), 1);
  panel.innerHTML = `
    <div class="valuation-holdings-head">
      <div>
        <span>估值样本构成</span>
        <h2>前十大权重股</h2>
      </div>
      <p>前十大权重股用于理解当前估值读数的构成；PE、PB、ROE 使用当前可覆盖样本口径，PEG 和完整历史分位仍等待同口径数据。</p>
    </div>
    <div class="valuation-holdings-stats">
      ${stats
        .map(
          ([label, value, suffix]) => `
            <article>
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}${escapeHtml(suffix)}</strong>
            </article>
          `,
        )
        .join("")}
    </div>
    <div class="valuation-holdings-list">
      ${topHoldings
        .map((item, index) => {
          const weight = parseValuationNumber(item.weightPct) || 0;
          const width = Math.max(3, (weight / maxWeight) * 100);
          return `
            <article>
              <div class="valuation-holding-rank">${index + 1}</div>
              <div class="valuation-holding-main">
                <div>
                  <strong>${escapeHtml(item.ticker || "--")}</strong>
                  <span>${escapeHtml(item.issuerName || "")}</span>
                </div>
                <em>${escapeHtml(formatValuationWeight(weight))}</em>
              </div>
              <div class="valuation-holding-bar" aria-hidden="true"><i style="width:${width.toFixed(1)}%"></i></div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
};

const renderIndexValuation = (payload) => {
  state.indexValuation = payload;
  const activePayload = getActiveIndexValuation(payload);
  const activeSymbol = String(activePayload?.index?.symbol || state.valuationIndex || "QQQ").toUpperCase();
  state.valuationIndex = activeSymbol;
  const ready = valuationPayloadReady(activePayload);
  const partialReady = String(activePayload?.status || "").toLowerCase() === "partial_data";
  renderValuationNavState(ready);

  const metrics = normalizeValuationMetrics(activePayload || {});
  const selectedKey = metrics[state.valuationMetric] ? state.valuationMetric : "pe";
  const selected = metrics[selectedKey];
  const indexName = activePayload?.index?.name || activePayload?.indexName || activePayload?.name || "Nasdaq 100";
  const shortIndexName = valuationIndexName(activeSymbol, indexName);

  document.querySelectorAll("[data-valuation-metric]").forEach((button) => {
    const active = button.dataset.valuationMetric === selectedKey;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll("[data-valuation-range]").forEach((button) => {
    const active = button.dataset.valuationRange === state.valuationRange;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  document.querySelectorAll("[data-valuation-index]").forEach((button) => {
    const symbol = String(button.dataset.valuationIndex || "").toUpperCase();
    const available = !Array.isArray(payload?.indices) || payload.indices.some((item) => String(item?.index?.symbol || "").toUpperCase() === symbol);
    const active = symbol === activeSymbol;
    button.classList.toggle("is-active", active);
    button.disabled = !available;
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  setText("#valuationPageTitle", `${shortIndexName} 估值`);
  setText("#valuationPageSubtitle", `用 PE、PB、ROE、股息率和 PEG 观察 ${shortIndexName} 当前所处的位置。`);
  setText("#valuationIndexLabel", indexName);
  setText("#valuationAsOf", ready ? formatDisplayDate(activePayload?.asOf || activePayload?.updatedAt || activePayload?.generatedAt) : "--");
  setText("#valuationCoverage", ready ? activePayload?.coverage || activePayload?.sample || "指数估值样本" : "等待指数估值样本接入");
  setText("#valuationTitle", ready ? activePayload?.title || `${indexName} 估值概览` : "等待估值数据");
  setText(
    "#valuationSummary",
    ready
      ? activePayload?.summary || "展示核心估值指标的当前读数、历史分位和趋势变化。"
      : activePayload?.frontendHints?.emptyStateBody || "数据未接入前，不展示 PE、PB、ROE 等估值数字。",
  );
  setText("#valuationChartKicker", ready ? `${valuationMetricConfig[selectedKey].label} 观察` : "趋势图");
  setText("#valuationChartTitle", ready ? valuationMetricConfig[selectedKey].title : "等待估值数据");

  const metricGrid = document.querySelector("#valuationMetricSummary");
  if (metricGrid) {
    metricGrid.innerHTML = Object.entries(valuationMetricConfig)
      .map(([key, config]) => {
        const metric = metrics[key];
        const value = ready ? formatValuationValue(metric.value, metric.unit) : "--";
        const percentile = ready
          ? Number.isFinite(parseValuationNumber(metric.percentile))
            ? formatValuationPercentile(metric.percentile)
            : metric.value == null
              ? "等待数据"
              : metric.note || "当前值"
          : "等待数据";
        return `
          <article class="${key === selectedKey ? "is-active" : ""}">
            <span>${escapeHtml(config.label)} <button class="info-tip" type="button" aria-label="${escapeHtml(config.label)}解释" data-tip="${escapeHtml(config.tip)}">?</button></span>
            <strong>${escapeHtml(value)}</strong>
            ${valuationMetricSparkline(metric)}
            <p>${escapeHtml(percentile)}</p>
          </article>
        `;
      })
      .join("");
  }

  renderValuationHoldings(activePayload, ready);

  setText(
    "#valuationPercentileNote",
    ready
      ? selected.series?.length
        ? `${valuationMetricConfig[selectedKey].label} 轨迹为近似口径，用于观察阶段变化。`
        : `${valuationMetricConfig[selectedKey].label} 暂无同口径历史序列。`
      : "轨迹用于观察近期价格变化对估值读数的影响，不代表未来方向。",
  );
  renderValuationChart(ready ? selected : { ...selected, series: [] });
};

const pageModules = [
  {
    id: "dashboard",
    kicker: "策略总览",
    title: "策略驾驶舱",
    nav: "总览",
    summary: "先看市场温度，再进入具体工具。",
    status: "入口",
  },
  {
    id: "risk",
    kicker: "市场温度",
    title: "市场温度计",
    nav: "温度",
    summary: "用几项公开指标看当前市场偏强、偏中性还是偏防守。",
    status: "已上线",
  },
  {
    id: "events",
    kicker: "财经日历",
    title: "财经日历",
    nav: "日历",
    summary: "查看宏观事件和财报日期的时间、影响范围和关联模块。",
    status: "数据驱动",
  },
  {
    id: "stock-events",
    kicker: "股票事件",
    title: "股票事件",
    nav: "事件",
    summary: "把业绩预期变好、财报超预期、机构观点和空头压力翻译成个股复盘入口。",
    status: "数据驱动",
  },
  {
    id: "strength",
    kicker: "全市场强弱",
    title: "今日强弱榜",
    nav: "强弱",
    summary: "把全市场压缩为重点观察、风险回避和等回踩清单。",
    status: "数据驱动",
  },
  {
    id: "stocks",
    kicker: "股票库",
    title: "股票库",
    nav: "股票",
    summary: "搜索和筛选可研究股票，进入个股详情继续复盘。",
    status: "搜索入口",
  },
  {
    id: "mag7",
    kicker: "七姐妹雷达",
    title: "强弱排序",
    nav: "七姐",
    summary: "跟踪七姐妹谁在领跑、谁在掉队、谁需要降权。",
    status: "已上线",
  },
  {
    id: "watchlist",
    kicker: "自选",
    title: "我的自选",
    nav: "自选",
    summary: "集中跟踪从涨跌幅、强弱、财报和信号加入的股票。",
    status: "本地保存",
  },
  {
    id: "earnings",
    kicker: "财报观察",
    title: "财报观察",
    nav: "财报",
    summary: "筛选财报超预期、预期上调、股价走强的候选股。",
    status: "数据驱动",
  },
  {
    id: "valuation",
    kicker: "指数估值",
    title: "估值观察",
    nav: "估值",
    summary: "观察指数 PE、PB、ROE、股息率和 PEG 的历史位置。",
    status: "待数据",
  },
  {
    id: "market",
    kicker: "涨跌幅榜",
    title: "涨跌幅榜",
    nav: "行情",
    summary: "按年内、日、周、月和成交额异动查看市场热点。",
    status: "数据驱动",
  },
  {
    id: "flows",
    kicker: "板块资金流向",
    title: "资金流向",
    nav: "资金",
    summary: "按板块聚合成交额、涨跌方向和上涨广度，观察资金偏好。",
    status: "代理指标",
  },
  {
    id: "options",
    kicker: "衍生品线索",
    title: "期权流向复盘",
    nav: "流向",
    summary: "把期权权利金、净流向和价格确认放进同一个复盘视角。",
    status: "离线快照",
  },
  {
    id: "signals",
    kicker: "趋势信号",
    title: "信号中心",
    nav: "信号",
    summary: "跟踪方向变化、定时复盘和板块共振。",
    status: "接口接入",
  },
];

const pageMeta = Object.fromEntries(pageModules.map((item) => [item.id, [item.kicker, item.title]]));
pageMeta.market = ["市场与资金", "市场工作区"];
pageMeta.flows = ["市场与资金", "资金流向"];
pageMeta.stock = ["股票详情", "股票详情"];

const dataFreshnessLabel = (value, item = {}) => {
  if (item.status === "waiting" || item.ready === false) return { label: "待接入", level: "muted" };
  if (!value) return { label: "待接入", level: "muted" };
  const age = daysBetween(value, new Date());
  if (age <= 0) return { label: "今日可用", level: "fresh" };
  if (age === 1) return { label: "1天前", level: "fresh" };
  if (age <= 7) return { label: `${age}天前`, level: "normal" };
  return { label: `${age}天前`, level: "stale" };
};

const getPageFromHash = () => {
  const raw = window.location.hash ? window.location.hash.replace("#", "") : "dashboard";
  const [page, symbol] = raw.split("/");
  if (page === "stock") {
    state.selectedStockSymbol = normalizeStockSymbol(symbol ? decodeURIComponent(symbol) : state.selectedStockSymbol);
    return "stock";
  }
  if (page === "events") {
    if (symbol && eventBoardFallbacks[symbol]) {
      state.eventBoard = symbol;
      return "stock-events";
    }
    return "events";
  }
  if (page === "stock-events") {
    state.eventBoard = symbol && eventBoardFallbacks[symbol] ? symbol : "all";
    return "stock-events";
  }
  if (page === "market") {
    if (symbol === "sectors" || symbol === "heatmap" || symbol === "flows") {
      state.marketVisualMode = symbol === "sectors" ? "sectors" : symbol === "heatmap" ? "heatmap" : "overview";
      state.marketWorkspaceSection = symbol;
    } else {
      state.marketVisualMode = "overview";
      state.marketWorkspaceSection = "movers";
    }
    return "market";
  }
  if (page === "flows") {
    state.marketVisualMode = "overview";
    state.marketWorkspaceSection = "flows";
    return "flows";
  }
  return pageMeta[page] ? page : "dashboard";
};

const renderModuleGrid = () => {
  const grid = document.querySelector("#dashboardModuleGrid");
  if (!grid) return;
  grid.innerHTML = pageModules
    .filter((item) => item.id !== "dashboard")
    .map(
      (item) => `
        <button class="module-card" type="button" data-page-link="${escapeHtml(item.id)}">
          <span>${escapeHtml(item.nav)}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.summary)}</p>
          <em>${escapeHtml(item.status)}</em>
        </button>
      `,
    )
    .join("");
};

const renderDashboardFocus = () => {
  const activeBoard = state.rows?.length ? state.rows : state.boards?.day || state.boards?.ytd || [];
  const mover = activeBoard[0];
  const strengthLeader = state.strength?.rows?.find((row) => row.bucket === "strongest") || state.strength?.rows?.[0];
  const eventBoards = state.eventOpportunities?.boards || {};
  const eventRows = Object.values(eventBoards).flatMap((board) => board.rows || []);
  const eventTop = eventRows[0];
  const temp = normalizeTemperaturePayload(state.marketTemperature || {});
  const tempScore = temp.overall?.score;
  const tempLabel = temp.overall?.label || "等待温度";

  setText("#dashboardFocusTemperature", Number.isFinite(Number(tempScore)) ? `${tempScore}分 · ${tempLabel}` : tempLabel);
  setText("#dashboardFocusTemperatureNote", neutralCopy(temp.overall?.summary || "先看当前环境偏强、偏中性还是偏防守。"));

  setText("#dashboardFocusMover", mover ? `${mover.symbol} ${formatChangeValue(mover)}` : "等待涨跌幅榜");
  setText(
    "#dashboardFocusMoverNote",
    mover
      ? `${mover.chineseName || mover.company || mover.symbol} · ${mover.sector} · ${getRiskLabel(getRiskBucket(mover))}风险。`
      : "看当前最明显的涨跌、成交额和风险标签。",
  );

  setText("#dashboardFocusStrength", strengthLeader ? `${strengthLeader.symbol} · ${strengthLeader.label}` : "等待强弱扫描");
  setText(
    "#dashboardFocusStrengthNote",
    strengthLeader
      ? `${strengthLeader.primaryFactor || strengthLeader.label || "相对强弱靠前"}，继续看成交额和价格确认。`
      : "优先从强于大盘和行业的股票里找线索。",
  );

  setText("#dashboardFocusEvent", eventTop ? `${normalizeStockSymbol(eventTop.ticker || eventTop.symbol)} · ${displayEventLabel(eventTop, "股票事件")}` : "等待股票事件");
  setText(
    "#dashboardFocusEventNote",
    eventTop ? eventReasonForUser(eventTop) : "用财报、业绩预期和机构观点解释为什么需要继续跟踪。",
  );
};

const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

const boardDirectionStats = (rows = []) => {
  const total = rows.length;
  const upCount = rows.filter((row) => getChange(row) >= 0).length;
  return {
    total,
    upCount,
    downCount: Math.max(0, total - upCount),
    upPct: total ? (upCount / total) * 100 : 0,
  };
};

const dashboardRadarScores = () => {
  const coreSignals = state.core?.risk?.signals || [];
  const trendTerms = ["SPY", "QQQ", "IWM"];
  const trendRows = trendTerms.map((term) => coreSignals.find((item) => item.term === term)).filter(Boolean);
  const trendScore = trendRows.length
    ? (trendRows.filter((item) => item.bucket === "positive").length / trendRows.length) * 100
    : parseRiskBudget(state.core?.marketRegime?.riskBudget);
  const dayStats = boardDirectionStats(state.boards?.day || []);
  const vixSignal = coreSignals.find((item) => item.term === "VIX");
  const vixValue = Number.parseFloat(String(vixSignal?.label || "").replace(/[^\d.-]/g, ""));
  const volatilityScore = Number.isFinite(vixValue) ? 100 - Math.max(0, Math.min(100, (vixValue - 12) * 4.5)) : 56;
  const volumeRows = state.boards?.volume || [];
  const hotCount = volumeRows.filter((row) => parseRatio(row.volumeRatio) >= 2).length;
  const heatScore = volumeRows.length ? Math.min(100, (hotCount / Math.min(volumeRows.length, 80)) * 180) : 45;
  return [
    ["趋势", trendScore],
    ["广度", dayStats.upPct],
    ["波动", volatilityScore],
    ["热度", heatScore],
  ];
};

const renderDashboardRegimeRadar = () => {
  const radar = document.querySelector("#dashboardRegimeRadar");
  if (!radar) return;
  radar.innerHTML = dashboardRadarScores()
    .map(([label, score]) => {
      const safeScore = clampPercent(score);
      return `<div><b>${escapeHtml(label)}</b><i style="--level:${safeScore}%"></i><em>${safeScore}</em></div>`;
    })
    .join("");
};

const dashboardStrengthMix = () => {
  const rows = state.strength?.rows || [];
  const strongest = rows.filter((row) => row.bucket === "strongest").length;
  const watchlist = rows.filter((row) => row.bucket === "watchlist").length;
  const weakest = rows.filter((row) => row.bucket === "weakest").length;
  return [
    ["强势", strongest, "is-positive"],
    ["观察", watchlist, "is-neutral"],
    ["弱势", weakest, "is-negative"],
  ];
};

const dashboardIndustryRows = (rows = []) => {
  return industrySectorRows(rows);
};

const renderDashboardVisualBoard = () => {
  const board = document.querySelector("#dashboardSnapshotBoard");
  if (!board) return;
  const temp = normalizeTemperaturePayload(state.marketTemperature || {});
  const tempScore = clampPercent(temp.overall?.score);
  const tempLabel = temp.overall?.label || "等待数据";
  const dayRows = state.boards?.day || [];
  const direction = boardDirectionStats(dayRows);
  const sectorRows = dashboardIndustryRows(marketSectorStats(dayRows)).slice(0, 5);
  const maxSectorCount = Math.max(...sectorRows.map((item) => item.count), 1);
  const strengthMix = dashboardStrengthMix();
  const maxStrength = Math.max(...strengthMix.map((item) => item[1]), 1);
  const calendarEvents = state.eventsCalendar?.events || [];
  const scheduledCalendarEvents = calendarEvents.filter((item) => item.type !== "manual");
  const calendarTypes = scheduledCalendarEvents.length
    ? [
        ["宏观", scheduledCalendarEvents.filter((item) => item.type === "macro").length],
        ["财报", scheduledCalendarEvents.filter((item) => item.type === "earnings").length],
        ["高影响", scheduledCalendarEvents.filter((item) => item.impact === "high").length],
      ].filter((item) => item[1])
    : [];
  const eventDisplayTypes = calendarTypes;
  const eventTotal = scheduledCalendarEvents.length;
  const maxEvent = Math.max(...eventDisplayTypes.map((item) => item[1]), 1);

  board.innerHTML = `
    <article class="dashboard-snapshot-card dashboard-temperature-card">
      <div class="dashboard-snapshot-head">
        <span>市场快照</span>
        <strong>${escapeHtml(String(tempScore))}分</strong>
      </div>
      <div class="dashboard-ring" style="--score:${tempScore}%">
        <b>${escapeHtml(tempLabel)}</b>
      </div>
      <p>${escapeHtml(neutralCopy(temp.overall?.summary || "等待市场环境数据。"))}</p>
    </article>

    <article class="dashboard-snapshot-card">
      <div class="dashboard-snapshot-head">
        <span>涨跌结构</span>
        <strong>${direction.total ? `${direction.upCount}涨 / ${direction.downCount}跌` : "--"}</strong>
      </div>
      <div class="dashboard-breadth-meter" style="--up:${direction.upPct.toFixed(1)}%">
        <i></i><b></b>
      </div>
      <div class="dashboard-sector-bars">
        ${sectorRows.length ? sectorRows.map((item) => `
          <div>
            <span>${escapeHtml(sectorDisplayName(item.sector))}</span>
            <i style="--level:${Math.max(8, (item.count / maxSectorCount) * 100).toFixed(1)}%"></i>
            <b>${escapeHtml(String(item.count))}</b>
          </div>
        `).join("") : '<em>等待板块数据</em>'}
      </div>
    </article>

    <article class="dashboard-snapshot-card">
      <div class="dashboard-snapshot-head">
        <span>强弱分布</span>
        <strong>${escapeHtml(state.strength?.summary?.leader || "--")}</strong>
      </div>
      <div class="dashboard-strength-bars">
        ${strengthMix.map(([label, value, className]) => `
          <div class="${escapeHtml(className)}">
            <span>${escapeHtml(label)}</span>
            <i style="--level:${Math.max(6, (value / maxStrength) * 100).toFixed(1)}%"></i>
            <b>${escapeHtml(String(value))}</b>
          </div>
        `).join("")}
      </div>
      <p>相对强弱用于区分主线、观察和弱势风险。</p>
    </article>

    <article class="dashboard-snapshot-card">
      <div class="dashboard-snapshot-head">
        <span>财经日历</span>
        <strong>${eventTotal ? `${eventTotal}条` : "--"}</strong>
      </div>
      <div class="dashboard-event-bars">
        ${eventDisplayTypes.length ? eventDisplayTypes.map(([label, value]) => `
          <div>
            <span>${escapeHtml(label)}</span>
            <i style="--level:${Math.max(8, (value / maxEvent) * 100).toFixed(1)}%"></i>
            <b>${escapeHtml(String(value))}</b>
          </div>
        `).join("") : '<em>等待财经日历</em>'}
      </div>
      <p>只展示宏观和财报时间点；个股理由进入股票事件页。</p>
    </article>
  `;
  renderDashboardIntelligence();
};

const parseEventDateValue = (value) => {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return Number.POSITIVE_INFINITY;
  const time = new Date(`${text}T00:00:00`).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
};

const dashboardEventRows = () => {
  const events = state.eventsCalendar?.events || [];
  const scheduledEvents = events
    .filter((item) => item.type !== "manual")
    .sort((a, b) => parseEventDateValue(a.date) - parseEventDateValue(b.date))
    .slice(0, 4);
  return scheduledEvents;
};

const renderDashboardIntelligence = () => {
  const sectorRank = document.querySelector("#dashboardSectorRank");
  const flowPulse = document.querySelector("#dashboardFlowPulse");
  const heatmapPulse = document.querySelector("#dashboardHeatmapPulse");
  const calendarLog = document.querySelector("#dashboardCalendarLog");
  const dayRows = state.boards?.day || state.rows || [];
  const productSectorRows = sectorFlowDisplayRows();
  const sectors = (
    productSectorRows.length
      ? dashboardIndustryRows(productSectorRows).slice().sort((a, b) => (b.avgChange || 0) - (a.avgChange || 0))
      : dashboardIndustryRows(marketSectorStats(dayRows))
  ).slice(0, 5);
  const sectorMax = Math.max(...sectors.map((item) => item.activeValue || item.dollarVolume || item.count), 1);
  const topSector = sectors[0];

  setText(
    "#dashboardSectorLead",
    topSector ? `${sectorDisplayName(topSector.sector)} · ${formatSignedPct(topSector.avgChange)}` : "等待板块数据",
  );
  if (sectorRank) {
    sectorRank.innerHTML = sectors.length
      ? sectors.map((item, index) => {
        const tone = item.avgChange >= 0 ? "is-positive" : "is-negative";
        const width = Math.max(8, ((item.activeValue || item.dollarVolume || item.count) / sectorMax) * 100).toFixed(1);
        return `
          <button type="button" data-dashboard-sector-open="${escapeHtml(item.sector)}">
            <em>${String(index + 1).padStart(2, "0")}</em>
            <span>${escapeHtml(sectorDisplayName(item.sector))}</span>
            <i><b style="width:${width}%"></b></i>
            <strong class="${tone}">${escapeHtml(formatSignedPct(item.avgChange))}</strong>
          </button>
        `;
      }).join("")
      : "<p>等待行情板块排行。</p>";
  }

  const flowRowsSorted = sectorFlowDisplayRows().slice(0, 5);
  const flowTop = flowRowsSorted[0];
  const flowMax = Math.max(...flowRowsSorted.map((item) => Math.abs(item.netFlowProxy || 0)), 1);
  setText(
    "#dashboardFlowLead",
    flowTop ? `${flowTop.sector} · ${flowTop.netFlowLabel || formatCompactMoney(flowTop.netFlowProxy || 0)}` : "等待资金数据",
  );
  if (flowPulse) {
    flowPulse.innerHTML = flowRowsSorted.length
      ? flowRowsSorted.map((item) => {
        const positive = (item.netFlowProxy || 0) >= 0;
        const width = Math.max(8, (Math.abs(item.netFlowProxy || 0) / flowMax) * 100).toFixed(1);
        return `
          <button type="button" data-flow-sector-open="${escapeHtml(item.sector)}">
            <span>${escapeHtml(sectorDisplayName(item.sector))}</span>
            <i class="${positive ? "is-positive" : "is-negative"}"><b style="width:${width}%"></b></i>
            <strong class="${positive ? "is-positive" : "is-negative"}">${escapeHtml(item.netFlowLabel || formatCompactMoney(item.netFlowProxy || 0))}</strong>
            <small>${escapeHtml(`${Math.round(item.breadthPct || 0)}%上涨`)}</small>
          </button>
        `;
      }).join("")
      : "<p>等待板块资金方向数据。</p>";
  }

  const heatRows = dashboardIndustryRows(dayRows)
    .map((row) => ({ ...row, heatSize: marketHeatmapSize(row) }))
    .sort((a, b) => b.heatSize - a.heatSize)
    .slice(0, 5);
  const heatTop = heatRows[0];
  const heatMax = Math.max(...heatRows.map((item) => item.heatSize), 1);
  setText(
    "#dashboardHeatmapLead",
    heatTop ? `${heatTop.symbol} · ${sectorDisplayName(heatTop.sector)}` : "等待热区数据",
  );
  if (heatmapPulse) {
    heatmapPulse.innerHTML = heatRows.length
      ? heatRows.map((item) => {
        const change = getChange(item);
        const tone = change >= 0 ? "is-positive" : "is-negative";
        const width = Math.max(8, (item.heatSize / heatMax) * 100).toFixed(1);
        return `
          <button type="button" data-stock-open="${escapeHtml(item.symbol)}">
            <span>${escapeHtml(item.symbol)}</span>
            <i class="${tone}"><b style="width:${width}%"></b></i>
            <strong class="${tone}">${escapeHtml(formatSignedPct(change))}</strong>
            <small>${escapeHtml(sectorDisplayName(item.sector))}</small>
          </button>
        `;
      }).join("")
      : "<p>等待成交热区数据。</p>";
  }

  const events = dashboardEventRows();
  const highCount = (state.eventsCalendar?.events || []).filter((item) => item.impact === "high").length;
  const first = events[0];
  setText("#dashboardCalendarLead", first ? `${first.date} · ${first.title}` : "等待财经日历");
  if (calendarLog) {
    calendarLog.innerHTML = events.length
      ? `
        <div class="dashboard-calendar-summary">
          <span>高影响事件</span>
          <strong>${escapeHtml(highCount ? `${highCount}项` : "--")}</strong>
        </div>
        ${events.map((item) => {
          const impactClass = item.impact === "high" ? "is-high" : item.impact === "medium" ? "is-medium" : "";
          return `
            <button type="button" data-page-link="events">
              <time>${escapeHtml(item.date || "--")} ${escapeHtml(item.time || "")}</time>
              <strong>${escapeHtml(item.title || "--")}</strong>
              <span class="calendar-impact ${impactClass}">${escapeHtml(eventImpactLabel(item.impact))}</span>
            </button>
          `;
        }).join("")}
      `
      : "<p>等待宏观和财报日程。</p>";
  }
};

const dataStatusItems = () => [
  {
    label: "股票事件",
    date: state.eventOpportunities?.asOf,
    generatedAt: state.eventOpportunities?.generatedAt,
    cadence: "按数据批次更新",
    note: "查看财报、指引和机构观点变化后的股票事件。",
  },
  {
    label: "市场温度计",
    date: state.marketTemperature?.asOf,
    generatedAt: state.marketTemperature?.generatedAt,
    cadence: "宏观数据更新后刷新",
    note: "观察波动率、利率、美元、原油和通胀环境。",
  },
  {
    label: "全市场强弱",
    date: state.strength?.asOf,
    generatedAt: state.strength?.generatedAt,
    cadence: "行情批次更新",
    note: "观察个股相对强弱、成交额异动和行业分布。",
  },
  {
    label: "财报观察",
    date: state.earningsQuality?.asOf,
    generatedAt: state.earningsQuality?.generatedAt,
    cadence: "财报季重点更新",
    note: "查看财报超预期、预期变化和价格确认。",
  },
  {
    label: "指数估值",
    date: state.indexValuation?.asOf,
    generatedAt: state.indexValuation?.generatedAt,
    status: valuationPayloadReady(state.indexValuation) ? "ready" : "waiting",
    ready: valuationPayloadReady(state.indexValuation),
    cadence: "等待估值数据",
    note: "等待成分权重、价格/市值和 TTM 财务序列接入。",
  },
  {
    label: "期权流向",
    date: state.optionsFlow?.asOf || state.optionsFlow?.meta?.tradeDate,
    generatedAt: state.optionsFlow?.generatedAt || state.optionsFlow?.meta?.generatedAt,
    cadence: "离线期权批次更新",
    note: "查看期权权利金、Call/Put 活跃度和价格确认。",
  },
  {
    label: "涨跌幅榜",
    date: state.meta?.ytd?.updatedAt || state.meta?.day?.updatedAt,
    generatedAt: "",
    cadence: "行情批次更新",
    note: "查看年内、1D、周度、月度和成交额变化。",
  },
  {
    label: "历史验证",
    date: state.validationCenter?.asOf,
    generatedAt: state.validationCenter?.generatedAt,
    cadence: "样本更新后刷新",
    note: "查看历史样本、相对指数表现和样本数量。",
  },
];

const renderDataStatus = () => {
  const grid = document.querySelector("#dashboardDataStatusGrid");
  if (!grid) return;
  const items = dataStatusItems();
  grid.innerHTML = items
    .map((item) => {
      const date = formatDisplayDate(item.date || item.generatedAt);
      const freshness = dataFreshnessLabel(item.date || item.generatedAt, item);
      return `
        <article class="data-status-card is-${escapeHtml(freshness.level)}">
          <span>${escapeHtml(item.label)} <em>${escapeHtml(freshness.label)}</em></span>
          <strong>${escapeHtml(date)}</strong>
          <small>${escapeHtml(item.cadence || "按数据批次更新")}</small>
          <p>${escapeHtml(item.note)}</p>
        </article>
      `;
    })
    .join("");
};

const optionFlowPayload = (payload = state.optionsFlow) => {
  if (!payload) return null;
  const boards = payload.boards || {};
  return {
    generatedAt: payload.generatedAt || payload.meta?.generatedAt,
    asOf: payload.asOf || payload.meta?.tradeDate,
    meta: payload.meta || {},
    summary: payload.summary || {},
    timeline: Array.isArray(payload.timeline) ? payload.timeline : [],
    bullish: Array.isArray(payload.bullish) ? payload.bullish : (boards.bullish || []),
    bearish: Array.isArray(payload.bearish) ? payload.bearish : (boards.bearish || []),
    quality: payload.quality || {},
  };
};

const optionPremiumValue = (row) => Number(row?.premium ?? row?.callPremium ?? row?.putPremium ?? row?.netCallPutPremium ?? 0);

const optionFlowState = (summary) => {
  const call = Math.abs(Number(summary.callPremium || 0));
  const put = Math.abs(Number(summary.putPremium || 0));
  const net = Number(summary.netDrift ?? summary.netCallPutPremium ?? 0);
  const total = Math.max(Math.abs(Number(summary.totalPremium || 0)), call + put, 1);
  if (!call && !put) return ["等待数据", "接入期权快照后判断偏多、偏空或分歧。"];
  if (Math.abs(net) / total >= 0.2) {
    if (net > 0) return ["净流向偏多", "净权利金偏向 Call 侧，但仍要看价格是否同步确认。"];
    return ["净流向偏空", "净权利金偏向 Put 或卖压代理，先看股价是否确认压力。"];
  }
  const ratio = put ? call / put : 99;
  if (ratio >= 1.35) return ["Call 活跃", "Call 权利金明显高于 Put，方向仍需价格确认。"];
  if (ratio <= 0.74) return ["Put 活跃", "Put 权利金明显高于 Call，先看股价是否确认压力。"];
  return ["多空分歧", "Call 与 Put 权利金接近，适合等待价格走出方向。"];
};

const optionPathFromPoints = (points) =>
  points.map((point, index) => `${index ? "L" : "M"}${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(" ");

const optionScaleY = (value, min, max, yMin, yMax) => {
  if (max === min) return (yMin + yMax) / 2;
  return yMax - ((value - min) / (max - min)) * (yMax - yMin);
};

const renderOptionsChart = (timeline) => {
  const svg = document.querySelector("#optionsFlowChart");
  if (!svg) return;
  if (!timeline.length) {
    svg.innerHTML = `<text x="32" y="70" class="options-chart-empty">等待期权流向数据</text>`;
    return;
  }
  const width = 760;
  const height = 500;
  const pad = { left: 72, right: 68, top: 42, bottom: 52 };
  const chartBottom = height - pad.bottom;
  const xStep = timeline.length > 1 ? (width - pad.left - pad.right) / (timeline.length - 1) : 0;
  const premiumValues = timeline.flatMap((row) => [Number(row.call || 0), Number(row.put || 0), Number(row.net || 0)]);
  const premiumMax = Math.max(20_000_000, ...premiumValues);
  const premiumMin = Math.min(-20_000_000, ...premiumValues);
  const prices = timeline.map((row) => Number(row.price || 0)).filter(Number.isFinite);
  const priceMin = Math.min(...prices) - 4;
  const priceMax = Math.max(...prices) + 4;
  const x = (index) => pad.left + index * xStep;
  const premiumPoint = (row, index, key) => [x(index), optionScaleY(Number(row[key] || 0), premiumMin, premiumMax, pad.top, chartBottom - 70)];
  const pricePoint = (row, index) => [x(index), optionScaleY(Number(row.price || 0), priceMin, priceMax, pad.top, chartBottom - 70)];
  const volumeValues = timeline.map((row) => Number(row.putVolume ?? row.callVolume ?? 0));
  const volumeMin = Math.min(...volumeValues, 0);
  const volumeMax = Math.max(...volumeValues, 1);
  const volumeTop = chartBottom - 52;
  const volumePoint = (row, index) => [
    x(index),
    optionScaleY(Number(row.putVolume ?? row.callVolume ?? 0), volumeMin, volumeMax, volumeTop, chartBottom),
  ];
  const ticks = [-100_000_000, -60_000_000, -20_000_000, 0, 20_000_000].filter((tick) => tick >= premiumMin && tick <= premiumMax);
  const grid = ticks
    .map((tick) => {
      const y = optionScaleY(tick, premiumMin, premiumMax, pad.top, chartBottom - 70);
      return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}" class="options-grid-line"></line><text x="18" y="${y + 5}" class="options-axis-label">${escapeHtml(formatCompactMoney(tick))}</text>`;
    })
    .join("");
  const priceTicks = [priceMin, (priceMin + priceMax) / 2, priceMax]
    .map((tick) => {
      const y = optionScaleY(tick, priceMin, priceMax, pad.top, chartBottom - 70);
      return `<text x="${width - pad.right + 12}" y="${y + 5}" class="options-axis-label">$${tick.toFixed(0)}</text>`;
    })
    .join("");
  const timeLabels = timeline
    .filter((_, index) => index === 0 || index === Math.floor((timeline.length - 1) / 2) || index === timeline.length - 1)
    .map((row, index, rows) => {
      const originalIndex = rows.length === 1 ? 0 : (index === 0 ? 0 : index === 1 ? Math.floor((timeline.length - 1) / 2) : timeline.length - 1);
      return `<text x="${x(originalIndex) - 18}" y="${height - 16}" class="options-time-label">${escapeHtml(row.time || "")}</text>`;
    })
    .join("");
  const volumePath = optionPathFromPoints(timeline.map(volumePoint));
  const volumeArea = `${volumePath} L${width - pad.right} ${chartBottom} L${pad.left} ${chartBottom} Z`;
  svg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
    ${grid}
    ${priceTicks}
    <path class="options-volume-area" d="${volumeArea}"></path>
    <path class="options-price-line" d="${optionPathFromPoints(timeline.map(pricePoint))}"></path>
    <path class="options-call-line" d="${optionPathFromPoints(timeline.map((row, index) => premiumPoint(row, index, "call")))}"></path>
    <path class="options-put-line" d="${optionPathFromPoints(timeline.map((row, index) => premiumPoint(row, index, "put")))}"></path>
    <path class="options-net-line" d="${optionPathFromPoints(timeline.map((row, index) => premiumPoint(row, index, "net")))}"></path>
    ${timeLabels}
  `;
};

const renderOptionsRank = (selector, rows, tone) => {
  const element = document.querySelector(selector);
  if (!element) return;
  if (!rows.length) {
    element.innerHTML = `<p class="options-empty">等待榜单数据</p>`;
    return;
  }
  const max = Math.max(...rows.map((row) => Math.abs(optionPremiumValue(row))), 1);
  element.innerHTML = rows
    .slice(0, 12)
    .map((row, index) => {
      const premium = Math.abs(optionPremiumValue(row));
      const width = Math.max(4, (premium / max) * 100);
      const ticker = row.ticker || row.symbol || "--";
      return `
        <button class="options-rank-row" type="button" data-watchlist-toggle="${escapeHtml(ticker)}" data-watchlist-source="期权流向">
          <span>${index + 1}</span>
          <strong>${escapeHtml(ticker)}</strong>
          <em class="is-${escapeHtml(tone)}" style="--level:${width.toFixed(1)}%"><i></i><b>${escapeHtml(formatCompactMoney(premium))}</b></em>
        </button>
      `;
    })
    .join("");
};

const renderOptionsFlow = (payload) => {
  state.optionsFlow = payload || state.optionsFlow;
  const data = optionFlowPayload(state.optionsFlow);
  if (!data) return;
  const { meta, summary, timeline, bullish, bearish } = data;
  const symbol = meta.symbol || "--";
  const company = meta.company || "离线流向快照";
  const [stateLabel, stateNote] = optionFlowState(summary);
  setText("#optionsAsOf", formatDisplayDate(data.asOf || data.generatedAt));
  setText("#optionsFocusSymbol", symbol);
  setText("#optionsFocusCompany", company);
  setText("#optionsBullishPremium", formatCompactMoney(Math.abs(Number(summary.callPremium || 0))));
  setText("#optionsBearishPremium", formatCompactMoney(Math.abs(Number(summary.putPremium || 0))));
  setText("#optionsFlowState", stateLabel);
  setText("#optionsFlowStateNote", stateNote);
  setText("#optionsHeadline", summary.headline || `${symbol} 期权流向等待确认。`);
  setText("#optionsLeadNote", `净流向 ${formatCompactMoney(Number(summary.netDrift ?? summary.netCallPutPremium ?? 0))}，标的价格 ${formatMoney(Number(summary.underlyingLast || meta.underlyingLast || 0))}。`);
  setText("#optionsChartTitle", `${symbol} Call / Put / 股价`);
  setText("#optionsExpiration", `到期日 ${formatDisplayDate(meta.expiration || meta.expirationDate || data.asOf)}`);
  const action = document.querySelector("[data-options-add-watch]");
  if (action) {
    action.dataset.watchlistToggle = symbol;
    action.dataset.watchlistSource = "期权流向";
    action.textContent = isInWatchlist(symbol) ? "已加入自选" : "加入自选";
  }
  renderOptionsChart(timeline);
  renderOptionsRank("#optionsBullishRows", bullish, "positive");
  renderOptionsRank("#optionsBearishRows", bearish, "negative");
  renderDataStatus();
};

const showPage = (page, options = {}) => {
  const { syncHash = true, hash = "" } = options;
  const requestedPage = page;
  if (page === "flows") {
    page = "market";
    state.marketWorkspaceSection = "flows";
  }
  if (!pageMeta[page]) page = "dashboard";
  if ((page === "admin" || page === "validation") && !state.auth.entitlements.admin) {
    openAuthModal("请先使用管理员账号登录。");
    page = "dashboard";
  }
  document.querySelectorAll(".page-view").forEach((view) => {
    const active = view.dataset.view === page;
    view.classList.toggle("is-active", active);
    view.hidden = !active;
  });
  document.querySelectorAll(".nav-item").forEach((item) => {
    const active = item.dataset.page === page;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-current", active ? "page" : "false");
  });
  document.querySelectorAll("[data-page-link]").forEach((item) => {
    const active = item.dataset.pageLink === page;
    item.classList.toggle("is-active", active);
    if (!item.matches("a[data-disabled='true']")) {
      item.setAttribute("aria-current", active ? "page" : "false");
    }
  });
  const meta = pageMeta[page] || pageMeta.market;
  document.querySelector("#workspaceKicker").textContent = meta[0];
  document.querySelector("#workspaceTitle").textContent = meta[1];
  document.title = `${meta[1]} - 懂币猫`;
  const targetHash = hash || `#${requestedPage === "flows" ? "flows" : page}`;
  if (syncHash && window.location.hash !== targetHash) {
    window.history.pushState(null, "", targetHash);
  }
  window.scrollTo({ top: 0, behavior: "auto" });
  if (page === "admin" && state.auth.entitlements.admin) {
    loadAdminUsers().catch((error) => {
      const body = document.querySelector("#adminUsersBody");
      if (body) body.innerHTML = `<tr><td colspan="8">${escapeHtml(error.message || "用户列表加载失败")}</td></tr>`;
    });
  }
  if (page === "earnings") {
    renderQualityTable();
  }
  if (page === "stock-events") {
    renderEventTable();
  }
  if (page === "stocks") {
    renderStocksPage();
  }
  if (page === "market") {
    if (state.marketWorkspaceSection !== "flows") {
      state.marketWorkspaceSection = state.marketVisualMode === "sectors"
        ? "sectors"
        : state.marketVisualMode === "heatmap"
          ? "heatmap"
          : "movers";
    }
    syncMarketWorkspaceTabs();
    syncMarketWorkspacePanels();
    if (state.rows?.length) renderTable();
    if (state.marketWorkspaceSection === "flows") renderFlowsPage();
  }
  if (page === "valuation") {
    renderIndexValuation(state.indexValuation);
  }
  if (page === "options") {
    renderOptionsFlow(state.optionsFlow);
  }
  if (page === "stock") {
    renderStockHub(state.selectedStockSymbol);
  }
  if (page === "watchlist") {
    renderWatchlist();
  }
  const dataPromise = ensurePageData(page);
  if (page === "stock") {
    const symbolAtRequest = state.selectedStockSymbol;
    dataPromise.then(() => {
      const activeView = document.querySelector(".page-view.is-active")?.dataset.view;
      if (activeView === "stock" && state.selectedStockSymbol === symbolAtRequest) {
        renderStockHub(symbolAtRequest);
      }
    });
  }
};

const syncMarketWorkspaceTabs = () => {
  const active = state.marketWorkspaceSection || "movers";
  const activeView = document.querySelector(".page-view.is-active");
  activeView?.querySelectorAll("[data-market-section]").forEach((item) => {
    const isActive = item.dataset.marketSection === active;
    item.classList.toggle("is-active", isActive);
    item.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
  document.querySelectorAll(".page-view:not(.is-active) [data-market-section]").forEach((item) => {
    item.classList.remove("is-active");
    item.setAttribute("aria-pressed", "false");
  });
};

const getFilteredRows = () => {
  const query = state.query.trim().toLowerCase();
  const macroPool = state.macroFilter === "all" ? null : macroStockPools.find((pool) => pool.key === state.macroFilter);
  const filtered = state.rows.filter((row) => {
      const matchesQuery =
        !query ||
        row.symbol.toLowerCase().includes(query) ||
        row.company.toLowerCase().includes(query) ||
        row.chineseName.includes(query) ||
        row.sector.includes(query);
      const matchesCap = state.capFilter === "all" || capBucket(row) === state.capFilter;
      const matchesSector = state.sectorFilter === "all" || row.sector === state.sectorFilter;
      const matchesRisk = state.riskFilter === "all" || getRiskBucket(row) === state.riskFilter;
      const matchesDirection =
        state.directionFilter === "all" ||
        (state.directionFilter === "up" && getChange(row) >= 0) ||
        (state.directionFilter === "down" && getChange(row) < 0);
      const matchesMacro = !macroPool || macroPoolMatchesRow(macroPool, row);
      return matchesQuery && matchesCap && matchesSector && matchesRisk && matchesDirection && matchesMacro;
    });
  if (!macroPool) return filtered;
  return filtered
    .map((row) => {
      const priority = reviewPriorityForMarketRow(row);
      return {
        ...row,
        macroPriority: priority.score,
        macroPriorityReason: priority.reason,
      };
    })
    .sort((a, b) => b.macroPriority - a.macroPriority)
    .map((row, index) => ({ ...row, displayRank: index + 1 }));
};

const renderLeader = (leader, updatedAt) => {
  const change = getChange(leader);
  const meta = state.meta[state.activeBoard];
  if (document.querySelector('[data-view="market"]').classList.contains("is-active")) {
    document.title = meta.title;
  }
  document.querySelector("#pageTitle").textContent = meta.title;
  document.querySelector("#pageSubtitle").textContent = meta.subtitle;
  document.querySelector("#leaderBadge").textContent = meta.badge;
  document.querySelector("#updatedAt").textContent = updatedAt;
  document.querySelector("#leader-title").textContent = leader.symbol;
  document.querySelector("#leader-cn-name").textContent = leader.chineseName;
  document.querySelector("#leader-name").textContent = leader.company;
  document.querySelector("#leader-sector").textContent = leader.sector;
  document.querySelector("#leader-risk").textContent = leader.risk;
  document.querySelector("#leader-change").textContent =
    (change >= 0 ? "+" : "") + formatPercent(change);
  document.querySelector("#leader-price").textContent = formatMoney(leader.price);
  document.querySelector("#leader-start").textContent = formatMoney(impliedReferencePrice(leader));

  const multiple = 1 + change / 100;
  document.querySelector("#leaderMultiple").textContent = multiple.toFixed(2) + "x";
  setText("#changeHeader", `${meta.periodLabel}涨跌幅`);
  document.querySelector("#leaderChangeLabel").textContent = `${meta.periodLabel}累计涨跌幅`;
  document.querySelector("#leaderReferenceLabel").textContent = meta.referenceLabel;
  document.querySelector("#leaderMultipleLabel").textContent = meta.multipleLabel || `${meta.periodLabel}价格倍数`;
  document.querySelector("#leader-start").textContent =
    meta.referenceMode === "volume" ? escapeHtml(leader.volume || "--") : formatMoney(impliedReferencePrice(leader));

  if (meta.multipleMode === "volumeRatio") {
    document.querySelector("#leaderMultiple").textContent = leader.volumeRatio || "--";
    return;
  }

  document.querySelector("#leaderMultiple").textContent = multiple.toFixed(2) + "x";
};

const renderSectorOptions = () => {
  const sectorFilter = document.querySelector("#sectorFilter");
  if (!sectorFilter) return;
  const sectors = Array.from(new Set(state.rows.map((row) => row.sector).filter(isKnownSector))).sort((a, b) =>
    a.localeCompare(b, "zh-CN"),
  );
  sectorFilter.innerHTML =
    '<option value="all">全部板块</option>' +
    sectors.map((sector) => `<option value="${escapeHtml(sector)}">${escapeHtml(sector)}</option>`).join("");
  if (!sectors.includes(state.sectorFilter)) {
    state.sectorFilter = "all";
  }
  sectorFilter.value = state.sectorFilter;
};

const renderStats = () => {
  const total = state.rows.length;
  const tenBaggers = state.rows.filter((row) => getChange(row) >= 900).length;
  const smallCap = state.rows.filter((row) => capBucket(row) === "small").length;
  const extremeRisk = state.rows.filter((row) => getRiskBucket(row) === "extreme").length;
  const topUp = state.rows.filter((row) => getChange(row) >= 0)[0];
  const topDown = state.rows.filter((row) => getChange(row) < 0).sort((a, b) => getChange(a) - getChange(b))[0];
  const countEl = document.querySelector("#statCount");
  const topEl = document.querySelector("#statTopGain");
  const thirdLabelEl = document.querySelector("#statThirdLabel");
  const thirdEl = document.querySelector("#statTenBaggers");
  const fourthLabelEl = document.querySelector("#statFourthLabel");
  const fourthEl = document.querySelector("#statSmallCap");
  const clearTone = (node) => node?.classList.remove("is-positive", "is-negative");

  [countEl, topEl, thirdEl, fourthEl].forEach(clearTone);
  if (countEl) countEl.textContent = state.activeBoard === "volume" ? "成交额排序" : total ? "流动性过滤" : "--";
  if (topEl) {
    topEl.textContent = topUp ? "+" + formatPercent(getChange(topUp)) : "--";
    if (topUp) topEl.classList.add("is-positive");
  }
  if (thirdLabelEl) {
    thirdLabelEl.textContent =
      state.activeBoard === "ytd" ? "十倍股数量" : state.activeBoard === "volume" ? "最高成交额倍数" : "最大下跌";
  }
  if (thirdEl) {
    thirdEl.textContent =
      state.activeBoard === "ytd"
        ? `${tenBaggers}只`
        : state.activeBoard === "volume"
          ? ((state.rows[0] && state.rows[0].volumeRatio) || "--")
          : topDown
            ? formatPercent(getChange(topDown))
            : "--";
    if (state.activeBoard !== "ytd" && state.activeBoard !== "volume" && topDown) thirdEl.classList.add("is-negative");
  }
  if (fourthLabelEl) {
    fourthLabelEl.textContent =
      state.activeBoard === "ytd" ? "小市值占比" : state.activeBoard === "volume" ? "高热度标的" : "极高风险";
  }
  if (fourthEl) {
    fourthEl.textContent =
      state.activeBoard === "ytd"
        ? total
          ? `${Math.round((smallCap / total) * 100)}%`
          : "--"
        : state.activeBoard === "volume"
          ? `${state.rows.filter((row) => parseRatio(row.volumeRatio) >= 2).length}只`
          : `${extremeRisk}只`;
  }
};

const marketBoardBrief = (rows) => {
  const total = rows.length;
  const upCount = rows.filter((row) => getChange(row) >= 0).length;
  const downCount = total - upCount;
  const hotVolume = rows.filter((row) => parseRatio(row.volumeRatio) >= 2).length;
  const extremeRisk = rows.filter((row) => getRiskBucket(row) === "extreme").length;
  const top = rows[0];
  const topChange = top ? formatChangeValue(top) : "--";
  const boardLabel = state.activeBoard === "day"
    ? "1D涨跌"
    : state.activeBoard === "week"
      ? "周度强弱"
      : state.activeBoard === "month"
        ? "月度趋势"
        : state.activeBoard === "volume"
          ? "成交额异动"
          : "年内强势";
  const conclusion = top ? `${boardLabel}：${top.symbol} ${topChange}` : "等待数据";
  const conclusionNote = top
    ? `${top.chineseName || top.company || top.symbol} 处在当前榜首，先看异动是否有成交额和板块支撑。`
    : "加载后显示当前榜单榜首。";
  const structure = total ? `${upCount}涨 / ${downCount}跌` : "--";
  const structureNote = state.activeBoard === "volume"
    ? `${hotVolume} 只成交额明显放大，优先排查是否有财报、公告或主题催化。`
    : `当前筛选里 ${upCount} 只上涨、${downCount} 只下跌，用来判断是单点异动还是整体扩散。`;
  const risk = total ? `${extremeRisk}只高波动` : "--";
  const riskNote = extremeRisk
    ? "高波动股票先看流动性和回撤承接，不急着按涨幅排序下结论。"
    : "当前极端风险较少，但仍要看成交额和数据日期。";
  const next = state.activeBoard === "volume" ? "先看原因链" : "先看详情页";
  const nextNote = state.activeBoard === "volume"
    ? "成交额放大只是入口，下一步要看价格是否同步确认。"
    : "从卡片进入股票详情，把涨跌幅、强弱、财报和线索放在一起看。";
  return { conclusion, conclusionNote, structure, structureNote, risk, riskNote, next, nextNote };
};

const renderMarketBrief = (rows) => {
  const brief = marketBoardBrief(rows);
  setText("#marketBriefConclusion", brief.conclusion);
  setText("#marketBriefConclusionNote", brief.conclusionNote);
  setText("#marketBriefStructure", brief.structure);
  setText("#marketBriefStructureNote", brief.structureNote);
  setText("#marketBriefRisk", brief.risk);
  setText("#marketBriefRiskNote", brief.riskNote);
  setText("#marketBriefNext", brief.next);
  setText("#marketBriefNextNote", brief.nextNote);
};

const marketSectorStats = (rows) => {
  const sectorMap = new Map();
  rows.forEach((row) => {
    const key = row.sector || "未分类";
    const volumeRow = getBoardRow("volume", row.symbol);
    const ratio = parseRatio(volumeRow?.volumeRatio || row.volumeRatio);
    const dollarVolume = Number(row.dollarVolume || row.volumeDollar || 0) || ratio;
    const current = sectorMap.get(key) || {
      sector: key,
      count: 0,
      upCount: 0,
      totalChange: 0,
      hotVolume: 0,
      dollarVolume: 0,
      signedFlowProxy: 0,
    };
    current.count += 1;
    current.totalChange += getChange(row);
    if (getChange(row) >= 0) current.upCount += 1;
    if (ratio >= 2) current.hotVolume += 1;
    current.dollarVolume += dollarVolume;
    current.signedFlowProxy += dollarVolume * Math.sign(getChange(row));
    sectorMap.set(key, current);
  });
  return [...sectorMap.values()]
    .map((item) => ({
      ...item,
      avgChange: item.totalChange / Math.max(1, item.count),
      breadthPct: (item.upCount / Math.max(1, item.count)) * 100,
    }))
    .sort((a, b) => b.dollarVolume - a.dollarVolume || b.count - a.count || b.avgChange - a.avgChange);
};

const marketVisualTabs = () => "";

const renderMarketSectorFocusList = (sectors, options = {}) => {
  if (!sectors.length) return "";
  const title = options.title || "板块方向";
  const subtitle = options.subtitle || "按资金方向和成交活跃度切换右侧详情。";
  const maxAbsFlow = Math.max(...sectors.map((item) => Math.abs(Number(item.netFlowProxy ?? item.avgChange) || 0)), 1);
  return `
    <div class="market-sector-focus-list" aria-label="${escapeHtml(title)}">
      <div class="market-sector-focus-head">
        <span>${escapeHtml(title)}</span>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      ${sectors.slice(0, 10).map((item, index) => {
        const flowValue = Number(item.netFlowProxy ?? item.avgChange) || 0;
        const tone = flowValue >= 0 ? "is-positive" : "is-negative";
        const width = Math.max(6, (Math.abs(flowValue) / maxAbsFlow) * 100);
        return `
          <button class="${item.sector === state.selectedMarketSector ? "is-selected" : ""}" type="button" data-market-sector-pick="${escapeHtml(item.sector)}">
            <em>${String(index + 1).padStart(2, "0")}</em>
            <span>${escapeHtml(sectorDisplayName(item.sector))}</span>
            <strong class="${tone}">${escapeHtml(item.netFlowProxy == null ? formatSignedPct(item.avgChange || 0) : formatSignedCompactMoney(item.netFlowProxy, item.netFlowLabel))}</strong>
            <i><b class="${tone}" style="width:${width.toFixed(1)}%"></b></i>
          </button>
        `;
      }).join("")}
    </div>
  `;
};

const marketSectorSignal = (item) => {
  const flowValue = Number(item.netFlowProxy ?? item.avgChange) || 0;
  const breadth = Number(item.breadthPct || 0);
  if (flowValue > 0 && breadth >= 58) return { label: "流入扩散", className: "is-positive" };
  if (flowValue > 0) return { label: "局部流入", className: "is-positive" };
  if (flowValue < 0 && breadth <= 45) return { label: "流出扩散", className: "is-negative" };
  if (flowValue < 0) return { label: "流出压力", className: "is-negative" };
  return { label: "多空分歧", className: "is-neutral" };
};

const renderMarketFlowMatrix = (sectors, rows, options = {}) => {
  const display = industrySectorRows(sectors).slice(0, options.limit || 8);
  if (!display.length) return `<p class="market-flow-empty">等待板块资金矩阵。</p>`;
  const maxAbsFlow = Math.max(...display.map((item) => Math.abs(Number(item.netFlowProxy ?? item.avgChange) || 0)), 1);
  const title = options.title || "板块资金矩阵";
  const note = options.note || "同一张表里看资金方向、上涨广度、成交活跃和龙头，避免只盯单一指标。";
  const actionAttr = options.flowOpen ? "data-flow-sector-open" : "data-market-sector-pick";
  return `
    <div class="market-flow-matrix">
      <header>
        <div>
          <span>${escapeHtml(title)}</span>
          <strong>${escapeHtml(note)}</strong>
        </div>
        <em>绿=流入或上涨占优，红=流出或下跌占优</em>
      </header>
      <div class="market-flow-matrix-head">
        <span>板块</span>
        <span>资金方向</span>
        <span>上涨广度</span>
        <span>成交活跃</span>
        <span>龙头</span>
        <span>信号</span>
      </div>
      <div class="market-flow-matrix-body">
        ${display.map((item) => {
          const flowValue = Number(item.netFlowProxy ?? item.avgChange) || 0;
          const tone = flowValue >= 0 ? "is-positive" : "is-negative";
          const width = Math.max(5, (Math.abs(flowValue) / maxAbsFlow) * 100);
          const detailRows = sectorDetailRows(rows, item.sector);
          const leaders = (item.leaders?.length ? item.leaders : detailRows).slice(0, 3);
          const leader = leaders[0];
          const signal = marketSectorSignal(item);
          return `
            <button class="market-flow-matrix-row ${item.sector === state.selectedMarketSector ? "is-selected" : ""}" type="button" ${actionAttr}="${escapeHtml(item.sector)}">
              <span><b>${escapeHtml(sectorDisplayName(item.sector))}</b><small>${escapeHtml(`${item.count || detailRows.length || 0}只样本`)}</small></span>
              <span class="market-flow-bar ${tone}"><strong>${escapeHtml(item.netFlowProxy == null ? formatSignedPct(item.avgChange || 0) : formatSignedCompactMoney(item.netFlowProxy, item.netFlowLabel))}</strong><i><b style="width:${width.toFixed(1)}%"></b></i></span>
              <span class="market-flow-breadth"><strong>${escapeHtml(`${Math.round(item.breadthPct || 0)}%`)}</strong><small><b class="is-positive">${escapeHtml(`${item.upCount || 0}涨`)}</b>/<b class="is-negative">${escapeHtml(`${item.downCount || 0}跌`)}</b></small></span>
              <span>${escapeHtml(item.activeValueLabel || formatCompactMoney(item.activeValue || item.dollarVolume || 0))}</span>
              <span>${leader?.symbol ? `<b>${escapeHtml(leader.symbol)}</b><small class="${Number(leader.change) >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(leader.change == null ? "--" : formatSignedPct(leader.change))}</small>` : "--"}</span>
              <span class="${escapeHtml(signal.className)}">${escapeHtml(signal.label)}</span>
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
};

const sectorDetailRows = (rows, sector) =>
  knownSectorRows(rows)
    .filter((row) => (row.sector || "未分类") === sector)
    .map((row) => {
      const day = getBoardRow("day", row.symbol);
      const week = getBoardRow("week", row.symbol);
      const volume = getBoardRow("volume", row.symbol);
      return {
        ...row,
        dayChange: day ? getChange(day) : getChange(row),
        weekChange: week ? getChange(week) : null,
        heatSize: marketHeatmapSize(row),
        volumeRatio: volume?.volumeRatio || row.volumeRatio || "--",
        dollarVolume: Number(volume?.dollarVolume || row.dollarVolume || 0),
      };
    })
    .sort((a, b) => b.heatSize - a.heatSize || Math.abs(getChange(b)) - Math.abs(getChange(a)));

const renderMarketSectorDetail = (rows, sectors) => {
  const fallback = sectors[0]?.sector || "";
  const selected = sectors.some((item) => item.sector === state.selectedMarketSector)
    ? state.selectedMarketSector
    : fallback;
  state.selectedMarketSector = selected;
  const sector = sectors.find((item) => item.sector === selected);
  const detailRows = sectorDetailRows(rows, selected).slice(0, 8);
  const maxHeat = Math.max(...detailRows.map((row) => row.heatSize), 1);
  const flowValue = Number(sector?.netFlowProxy ?? sector?.avgChange ?? 0);
  const flowTone = flowValue >= 0 ? "is-positive" : "is-negative";
  const leaders = (sector?.leaders || detailRows).slice(0, 3).map((item) => item.symbol).filter(Boolean).join(" / ");
  const activeValue = sector?.activeValueLabel || formatCompactMoney(sector?.activeValue || sector?.dollarVolume || 0);
  return `
    <aside class="market-sector-detail-pane" aria-label="板块详情">
      <div class="market-sector-detail-head">
        <span>板块详情</span>
        <strong>${escapeHtml(sectorDisplayName(selected))}</strong>
        <button class="table-action" type="button" data-sector-open="${escapeHtml(selected)}">筛到涨跌榜</button>
        <p>切换板块后，先看资金方向和上涨广度，再看前排股票是否有成交额确认。</p>
      </div>
      <div class="market-sector-detail-metrics">
        <div><span>资金方向</span><b class="${flowTone}">${escapeHtml(sector?.netFlowProxy == null ? formatSignedPct(sector?.avgChange || 0) : formatSignedCompactMoney(sector.netFlowProxy, sector.netFlowLabel))}</b></div>
        <div><span>上涨广度</span><b>${escapeHtml(`${Math.round(sector?.breadthPct || 0)}%`)}</b></div>
        <div><span>成交活跃</span><b>${escapeHtml(activeValue)}</b></div>
        <div><span>代表标的</span><b>${escapeHtml(leaders || "--")}</b></div>
      </div>
      <div class="market-sector-detail-table">
        <div class="market-sector-detail-row is-head">
          <span>股票</span>
          <span>成交热度</span>
          <span>1D</span>
          <span>5D</span>
        </div>
        ${
          detailRows.length
            ? detailRows.map((row) => {
                const change = getChange(row);
                const tone = change >= 0 ? "is-positive" : "is-negative";
                return `
                  <button class="market-sector-detail-row" type="button" data-stock-open="${escapeHtml(row.symbol)}">
                    <span><b>${escapeHtml(row.symbol)}</b><small>${escapeHtml(capLabel(row))}</small></span>
                    <i><em style="width:${Math.max(7, (row.heatSize / maxHeat) * 100).toFixed(1)}%"></em></i>
                    <strong class="${row.dayChange >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatSignedPct(row.dayChange))}</strong>
                    <strong class="${row.weekChange == null || row.weekChange >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(row.weekChange == null ? "--" : formatSignedPct(row.weekChange))}</strong>
                  </button>
                `;
              }).join("")
            : "<p>当前筛选下暂无该板块股票。</p>"
        }
      </div>
    </aside>
  `;
};

const renderMarketSectorRankingView = (rows) => {
  const flowSectors = sectorFlowDisplayRows();
  const sectors = industrySectorRows(flowSectors.length ? flowSectors : marketSectorStats(rows)).slice(0, 12);
  const maxAbsFlow = Math.max(...sectors.map((item) => Math.abs(Number(item.netFlowProxy ?? item.avgChange) || 0)), 1);
  const positiveCount = sectors.filter((item) => Number(item.netFlowProxy ?? item.avgChange) >= 0).length;
  const negativeCount = sectors.length - positiveCount;
  const activeSector = sectors.slice().sort((a, b) => (b.activeValue || b.dollarVolume || 0) - (a.activeValue || a.dollarVolume || 0))[0];
  const topSector = sectors[0];
  if (!sectors.some((item) => item.sector === state.selectedMarketSector)) {
    state.selectedMarketSector = topSector?.sector || "";
  }
  return `
    ${marketVisualTabs()}
    ${renderMarketRouteStrip("sectors")}
    <section class="market-sector-ranking professional-market-board">
      <div class="market-visual-copy">
        <span>板块排行</span>
        <strong>${escapeHtml(sectorDisplayName(topSector?.sector))}</strong>
        <p>按板块资金方向、成交活跃度和上涨广度排序。绿色表示流入或上涨占优，红色表示流出或下跌占优。</p>
        <div class="market-visual-metrics">
          <div><span>流入板块</span><b class="is-positive">${escapeHtml(String(positiveCount))}</b></div>
          <div><span>流出板块</span><b class="is-negative">${escapeHtml(String(negativeCount))}</b></div>
          <div><span>成交最活跃</span><b>${escapeHtml(sectorDisplayName(activeSector?.sector))}</b></div>
        </div>
        ${renderMarketSectorFocusList(sectors, { title: "板块快选", subtitle: "切换右侧详情，查看该板块前排股票。" })}
      </div>
      ${renderMarketFlowMatrix(sectors, rows, { title: "主线矩阵", note: "先看资金方向，再用广度和成交额确认是否是板块级主线。", limit: 8 })}
      <div class="market-sector-table-wrap">
        <table class="market-sector-terminal-table data-table">
          <thead>
            <tr>
              <th><span>排名</span><em>方向</em></th>
              <th><span>板块</span><em>分类</em></th>
              <th><span>资金方向</span><em>涨跌成交代理</em></th>
              <th><span>1D</span><em>均值</em></th>
              <th><span>5D</span><em>均值</em></th>
              <th><span>成交额</span><em>活跃度</em></th>
              <th><span>上涨广度</span><em>涨/跌</em></th>
              <th><span>龙头</span><em>成交领先</em></th>
              <th><span>代表标的</span><em>前排样本</em></th>
              <th><span>操作</span><em>联动</em></th>
            </tr>
          </thead>
          <tbody>
            ${sectors.map((item, index) => {
          const flowValue = item.netFlowProxy ?? item.avgChange ?? 0;
          const breadth = item.breadthPct == null ? 0 : item.breadthPct;
          const detailRows = sectorDetailRows(rows, item.sector);
          const leaders = (item.leaders?.length ? item.leaders : detailRows).slice(0, 4);
          const leader = leaders[0];
          const upCount = item.upCount || 0;
          const downCount = item.downCount ?? Math.max(0, (item.count || 0) - upCount);
          const changeClass = flowValue >= 0 ? "is-positive" : "is-negative";
          const flowWidth = Math.max(5, (Math.abs(Number(flowValue) || 0) / maxAbsFlow) * 100);
          const weekChange = sectorPeriodChange(item.sector, "week");
          return `
            <tr class="${item.sector === state.selectedMarketSector ? "is-selected" : ""}">
              <td>${String(index + 1).padStart(2, "0")}</td>
              <td><button class="inline-stock-link" type="button" data-market-sector-focus="${escapeHtml(item.sector)}">${escapeHtml(sectorDisplayName(item.sector))}</button></td>
              <td>
                <div class="market-sector-flow-cell ${changeClass}">
                  <strong>${escapeHtml(item.netFlowProxy == null ? formatSignedPct(item.avgChange || 0) : formatSignedCompactMoney(item.netFlowProxy, item.netFlowLabel))}</strong>
                  <i><b style="width:${flowWidth.toFixed(1)}%"></b></i>
                </div>
              </td>
              <td class="${Number(item.avgChange) >= 0 ? "gain-cell" : "loss-cell"}">${escapeHtml(item.avgChange == null ? "--" : formatSignedPct(item.avgChange))}</td>
              <td class="${Number(weekChange) >= 0 ? "gain-cell" : "loss-cell"}">${escapeHtml(weekChange == null ? "--" : formatSignedPct(weekChange))}</td>
              <td>${escapeHtml(item.activeValueLabel || formatCompactMoney(item.activeValue || item.dollarVolume || 0))}</td>
              <td class="market-sector-breadth-cell"><strong>${escapeHtml(`${Math.round(breadth)}%`)}</strong><span><b class="is-positive">${escapeHtml(`${upCount}涨`)}</b><i>/</i><b class="is-negative">${escapeHtml(`${downCount}跌`)}</b></span></td>
              <td>${leader?.symbol ? `<button class="inline-stock-link" type="button" data-stock-open="${escapeHtml(leader.symbol)}">${escapeHtml(leader.symbol)}</button>` : "--"}</td>
              <td>${escapeHtml(leaders.map((leaderItem) => leaderItem.symbol).filter(Boolean).join(" / ") || "--")}</td>
              <td><button class="table-action" type="button" data-sector-open="${escapeHtml(item.sector)}">筛到榜单</button></td>
            </tr>
          `;
        }).join("")}
          </tbody>
        </table>
      </div>
      ${renderMarketSectorDetail(rows, sectors)}
    </section>
  `;
};

const marketHeatmapSize = (row) => {
  const volumeRow = getBoardRow("volume", row.symbol);
  const ratio = parseRatio(volumeRow?.volumeRatio || row.volumeRatio);
  const dollarVolume = Number(row.dollarVolume || row.volumeDollar || 0);
  return Math.max(1, dollarVolume || ratio || Math.abs(getChange(row)));
};

const marketHeatmapIntensity = (change) => {
  const value = Math.min(1, Math.abs(Number(change) || 0) / 12);
  return (0.42 + value * 0.38).toFixed(2);
};

const renderMarketHeatmapView = (rows) => {
  const displayRows = industrySectorRows(rows);
  const tiles = [...displayRows]
    .map((row) => ({ ...row, heatSize: marketHeatmapSize(row) }))
    .sort((a, b) => b.heatSize - a.heatSize)
    .slice(0, 48);
  const max = Math.max(...tiles.map((row) => row.heatSize), 1);
  const upTiles = tiles.filter((row) => getChange(row) > 0).length;
  const downTiles = tiles.filter((row) => getChange(row) < 0).length;
  const sectorCount = new Set(tiles.map((row) => sectorDisplayName(row.sector))).size;
  const topTile = tiles[0];
  const sectorGroups = [...tiles.reduce((map, row) => {
    const key = row.sector || "未分类";
    const current = map.get(key) || { sector: key, rows: [], heatSize: 0, upCount: 0, downCount: 0 };
    current.rows.push(row);
    current.heatSize += row.heatSize;
    if (getChange(row) >= 0) current.upCount += 1;
    else current.downCount += 1;
    map.set(key, current);
    return map;
  }, new Map()).values()]
    .sort((a, b) => b.heatSize - a.heatSize)
    .slice(0, 8);
  const maxGroupHeat = Math.max(...sectorGroups.map((group) => group.heatSize), 1);
  const flowSectors = sectorFlowDisplayRows();
  const detailSectors = industrySectorRows(flowSectors.length ? flowSectors : marketSectorStats(displayRows)).slice(0, 12);
  if (!detailSectors.some((item) => item.sector === state.selectedMarketSector)) {
    state.selectedMarketSector = sectorGroups[0]?.sector || detailSectors[0]?.sector || "";
  }
  return `
    ${marketVisualTabs()}
    ${renderMarketRouteStrip("heatmap")}
    <section class="market-heatmap-view professional-market-board">
      <div class="market-visual-copy">
        <span>成交额权重热力图</span>
        <strong>${escapeHtml(topTile?.symbol || "--")}</strong>
        <p>面积代表成交活跃度，绿色为上涨，红色为下跌。先看大块集中在哪些板块，再进入个股详情确认原因。</p>
        <div class="market-visual-metrics">
          <div><span>上涨</span><b class="is-positive">${escapeHtml(String(upTiles))}</b></div>
          <div><span>下跌</span><b class="is-negative">${escapeHtml(String(downTiles))}</b></div>
          <div><span>热区板块</span><b>${escapeHtml(String(sectorCount))}</b></div>
        </div>
      </div>
      ${renderMarketFlowMatrix(detailSectors, displayRows, { title: "热区矩阵", note: "把热力图里的成交集中度，落回板块资金和上涨广度。", limit: 5 })}
      <div class="market-heatmap-shell">
        <div class="market-heatmap-legend">
          <span><i class="is-up"></i>上涨</span>
          <span><i class="is-down"></i>下跌</span>
          <span><i></i>面积=成交活跃度</span>
        </div>
        <div class="market-heatmap-groups">
          ${sectorGroups.map((group) => `
            <section class="market-heatmap-sector" style="--sector-weight:${Math.max(0.65, group.heatSize / maxGroupHeat).toFixed(2)}">
              <header>
                <button type="button" data-market-sector-pick="${escapeHtml(group.sector)}">${escapeHtml(sectorDisplayName(group.sector))}</button>
                <strong><b class="is-positive">${escapeHtml(`${group.upCount}涨`)}</b><i>/</i><b class="is-negative">${escapeHtml(`${group.downCount}跌`)}</b></strong>
              </header>
              <div class="market-heatmap-grid">
                ${group.rows.slice(0, 8).map((row) => {
                  const change = getChange(row);
                  const tone = change > 0 ? "is-up" : change < 0 ? "is-down" : "is-flat";
                  const heatShare = row.heatSize / max;
                  const span = heatShare > 0.46 ? "is-large" : heatShare > 0.18 ? "is-mid" : "";
                  const heatRows = heatShare > 0.46 ? 2 : heatShare > 0.18 ? 1.45 : 1;
                  const volumeRow = getBoardRow("volume", row.symbol);
                  const rawVolume = Number(volumeRow?.dollarVolume || row.dollarVolume || row.volumeDollar);
                  const volumeLabel = Number.isFinite(rawVolume) && rawVolume > 0
                    ? formatCompactMoney(rawVolume)
                    : row.volumeRatio || "成交活跃";
                  return `
                    <button class="market-heat-tile ${tone} ${span}" type="button" data-stock-open="${escapeHtml(row.symbol)}" style="--heat-size:${heatRows.toFixed(2)}; --heat-alpha:${marketHeatmapIntensity(change)};">
                      <small>${escapeHtml(row.chineseName || sectorDisplayName(row.sector))}</small>
                      <strong>${escapeHtml(row.symbol)}</strong>
                      <span>${escapeHtml(formatSignedPct(change))}</span>
                      <em>${escapeHtml(volumeLabel)}</em>
                    </button>
                  `;
                }).join("")}
              </div>
            </section>
          `).join("")}
        </div>
      </div>
      ${renderMarketSectorDetail(displayRows, detailSectors)}
    </section>
  `;
};

const renderMarketOverviewView = (rows) => {
  const total = rows.length;
  const sectors = knownSectorRows(marketSectorStats(rows)).slice(0, 7);
  const maxSectorCount = Math.max(...sectors.map((item) => item.count), 1);
  const upCount = rows.filter((row) => getChange(row) >= 0).length;
  const downCount = total - upCount;
  const riskStats = [
    ["极高风险", rows.filter((row) => getRiskBucket(row) === "extreme").length, "is-negative"],
    ["高风险", rows.filter((row) => getRiskBucket(row) === "high").length, "is-watch"],
    ["可观察", rows.filter((row) => getRiskBucket(row) === "watch").length, "is-positive"],
  ];
  const hotVolumeRows = [...rows]
    .map((row) => {
      const volumeRow = getBoardRow("volume", row.symbol);
      return {
        ...row,
        volumeRatio: volumeRow?.volumeRatio || row.volumeRatio,
        ratio: parseRatio(volumeRow?.volumeRatio || row.volumeRatio),
      };
    })
    .filter((row) => Number.isFinite(row.ratio) && row.ratio > 0)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 5);
  const fallbackVolumeRows = !hotVolumeRows.length
    ? (state.boards.volume || [])
        .map((row) => ({ ...row, ratio: parseRatio(row.volumeRatio) }))
        .filter((row) => Number.isFinite(row.ratio) && row.ratio > 0)
        .slice(0, 5)
    : hotVolumeRows;
  const maxVolumeRatio = Math.max(...fallbackVolumeRows.map((row) => row.ratio), 1);
  return `
    ${marketVisualTabs()}
    <div class="market-overview-grid professional-market-board">
      <article class="market-chart-card market-sector-chart">
        <div class="market-chart-head">
          <span>板块集中度</span>
        <strong>${escapeHtml(sectorDisplayName(sectors[0]?.sector))}</strong>
        </div>
        <div class="market-sector-bars">
          ${sectors.map((item) => `
            <div>
              <b>${escapeHtml(sectorDisplayName(item.sector))}</b>
              <i><em style="width:${Math.max(5, (item.count / maxSectorCount) * 100).toFixed(1)}%"></em></i>
              <strong>${escapeHtml(String(item.count))}</strong>
            </div>
          `).join("")}
        </div>
      </article>
      <article class="market-chart-card">
        <div class="market-chart-head">
          <span>涨跌扩散</span>
          <strong>${escapeHtml(`${upCount} / ${downCount}`)}</strong>
        </div>
        <div class="market-direction-meter">
          <i style="width:${((upCount / total) * 100).toFixed(1)}%"></i>
        </div>
        <div class="market-direction-labels">
          <span>上涨 ${escapeHtml(String(upCount))}</span>
          <span>下跌 ${escapeHtml(String(downCount))}</span>
        </div>
        <p>${escapeHtml(upCount >= downCount ? "当前筛选里上涨占优。" : "当前筛选里回落更多。")}</p>
      </article>
      <article class="market-chart-card">
        <div class="market-chart-head">
          <span>波动风险</span>
          <strong>${escapeHtml(`${riskStats[0][1]}只`)}</strong>
        </div>
        <div class="market-risk-donut" style="--extreme:${(riskStats[0][1] / total * 100).toFixed(1)}%; --high:${(riskStats[1][1] / total * 100).toFixed(1)}%">
          <b>${escapeHtml(String(total))}</b>
        </div>
        <div class="market-risk-legend">
          ${riskStats.map(([label, count, className]) => `<span class="${className}">${escapeHtml(label)} ${escapeHtml(String(count))}</span>`).join("")}
        </div>
      </article>
      <article class="market-chart-card">
        <div class="market-chart-head">
          <span>成交异动</span>
          <strong>${escapeHtml(hotVolumeRows[0]?.symbol || "--")}</strong>
        </div>
        <div class="market-volume-rank">
          ${fallbackVolumeRows.length ? fallbackVolumeRows.map((row) => `
            <div>
              <b>${escapeHtml(row.symbol)}</b>
              <i><em style="width:${Math.max(5, (row.ratio / maxVolumeRatio) * 100).toFixed(1)}%"></em></i>
              <strong>${escapeHtml(row.volumeRatio || `${row.ratio.toFixed(1)}x`)}</strong>
            </div>
          `).join("") : "<p>当前榜单暂无成交额倍数字段。</p>"}
        </div>
      </article>
    </div>
  `;
};

const renderMarketVisualBoard = (rows = getFilteredRows()) => {
  const board = document.querySelector("#marketVisualBoard");
  if (!board) return;
  const total = rows.length;
  if (!total) {
    board.innerHTML = `
      ${marketVisualTabs()}
      <article class="market-chart-card">
        <span>行情雷达</span>
        <strong>暂无符合条件的股票</strong>
      </article>
    `;
    return;
  }
  if (state.marketVisualMode === "sectors") {
    board.innerHTML = renderMarketSectorRankingView(rows);
    return;
  }
  if (state.marketVisualMode === "heatmap") {
    board.innerHTML = renderMarketHeatmapView(rows);
    return;
  }
  board.innerHTML = renderMarketOverviewView(rows);
};

const getBoardRow = (board, symbol) => (state.boards[board] || []).find((row) => row.symbol === symbol);

const getMarketDetailSource = (symbol) =>
  getBoardRow(state.activeBoard, symbol) ||
  getBoardRow("ytd", symbol) ||
  getBoardRow("day", symbol) ||
  getBoardRow("week", symbol) ||
  getBoardRow("month", symbol) ||
  getBoardRow("volume", symbol);

const inferMoveReason = (row, volume) => {
  const change = Math.abs(getChange(row));
  const volumeRatio = parseRatio(volume?.volumeRatio || row.volumeRatio);
  const reasons = [];
  if (volumeRatio >= 3) reasons.push("成交额明显放大");
  else if (volumeRatio >= 1.8) reasons.push("成交额高于平时");
  if (change >= 100) reasons.push("价格波动极端");
  else if (change >= 30) reasons.push("短线涨跌幅较大");
  if (/AI|半导体|科技|算力|航天|加密|金融/.test(row.sector)) reasons.push("热门主题带动");
  if (/低价|高波动|极端|剧震|小盘/.test(row.risk)) reasons.push("波动风险偏高");
  return reasons.length ? reasons : ["等待更多成交额和公告数据确认"];
};

const marketMoveExplanation = (row, volume) => {
  const change = getChange(row);
  const volumeText = volume?.volumeRatio || row.volumeRatio;
  const volumeSummary = volumeRatioSummary(volumeText, change);
  const reasons = inferMoveReason(row, volume).slice(0, 3);
  const tone = change >= 0 ? "is-positive" : "is-negative";
  return {
    title: volumeSummary.label,
    note: volumeSummary.note,
    reasons,
    tone,
  };
};

const marketSectorClue = (row) => {
  const peers = uniqueBySymbol(state.rows.filter((item) => item.sector === row.sector && item.symbol !== row.symbol));
  const sectorRows = uniqueBySymbol(state.rows.filter((item) => item.sector === row.sector));
  const topPeer = peers.slice().sort((a, b) => getChange(b) - getChange(a))[0];
  const upCount = sectorRows.filter((item) => getChange(item) >= 0).length;
  const downCount = Math.max(0, sectorRows.length - upCount);
  const breadth = sectorRows.length ? Math.round((upCount / sectorRows.length) * 100) : 0;
  return {
    sector: sectorDisplayName(row.sector),
    breadthText: sectorRows.length ? `${breadth}%上涨` : "--",
    spreadText: sectorRows.length ? `${upCount}涨/${downCount}跌` : "--",
    leaderText: topPeer ? `${topPeer.symbol} ${formatChangeValue(topPeer)}` : "--",
    peerCount: peers.length,
  };
};

const marketDetailPreview = (row) => {
  const target = normalizeStockSymbol(row.symbol);
  const day = getBoardRow("day", target);
  const week = getBoardRow("week", target);
  const month = getBoardRow("month", target);
  const volume = getBoardRow("volume", target);
  const strength = findStrengthRow(target);
  const quality = findQualityRow(target);
  const eventRow = findEventRow(target);
  const signal = signalStateForSymbol(target);
  const sources = stockDataSources({ market: row, day, week, month, volume, strength, quality, eventRow, signal })
    .filter(([, active]) => active)
    .map(([label]) => label);
  const heat = stockHeatSummary({ market: row, strength, month, volume });
  return {
    title: eventRow ? displayEventLabel(eventRow) : quality?.userAngle || strength?.label || heat.label,
    note: eventRow?.reason || quality?.userReason || strength?.action || heat.note,
    primary: stockPrimarySource({ market: row, strength, quality, eventRow, signal }),
    sourceText: sources.length ? sources.join(" / ") : "行情",
  };
};

const renderSectorDetail = (row) => {
  const sectorRows = uniqueBySymbol(
    Object.values(state.boards)
      .flat()
      .filter((item) => item.sector === row.sector),
  );
  const sorted = [...sectorRows].sort((a, b) => getChange(b) - getChange(a));
  const top = sorted.slice(0, 5);
  const hot = sectorRows.filter((item) => parseRatio(item.volumeRatio) >= 2).length;
  const highRisk = sectorRows.filter((item) => getRiskBucket(item) === "extreme").length;
  const macroExposure = stockMacroExposure({ sector: row.sector, company: row.sector, chineseName: "" }, row);
  return `
    <div class="market-paid-module market-sector-detail" data-lockable-module="sector-detail">
      <div class="module-head">
        <div>
          <span>板块详情</span>
          <strong>${escapeHtml(sectorDisplayName(row.sector))}</strong>
        </div>
      </div>
      <div class="sector-detail-grid">
        <article><span>成交额放大</span><strong>${hot}只</strong></article>
        <article><span>极高风险</span><strong>${highRisk}只</strong></article>
        <article><span>领涨标的</span><strong>${escapeHtml(top[0]?.symbol || "--")}</strong></article>
      </div>
      <div class="sector-peer-list">
        ${
          top.length
            ? top.map((peer) => `<b>${escapeHtml(peer.symbol)} ${formatChangeValue(peer)}</b>`).join("")
            : "<p>暂无同板块对比。</p>"
        }
      </div>
      <div class="sector-macro-strip">
        <span>宏观背景</span>
        <strong>${escapeHtml(macroExposure.label)}</strong>
        <p>${escapeHtml(macroExposure.note)}</p>
        <div>
          ${
            macroExposure.rows.length
              ? macroExposure.rows.slice(0, 3).map((indicator) => `<b>${escapeHtml(indicator.name)} ${escapeHtml(indicator.value || "--")} · ${escapeHtml(indicator.level || "--")}</b>`).join("")
              : "<b>等待宏观数据</b>"
          }
        </div>
      </div>
    </div>
  `;
};

const renderMarketCards = (rows) => {
  const grid = document.querySelector("#marketCardGrid");
  if (!grid) return;
  if (!rows.length) {
    grid.innerHTML = `
      <article class="market-observation-card">
        <span>暂无符合条件的股票</span>
        <strong>可以放宽筛选</strong>
        <p>先切换榜单或放宽板块、市值、风险筛选。</p>
      </article>
    `;
    return;
  }
  grid.innerHTML = rows.slice(0, 12).map((row) => {
    const change = getChange(row);
    const volume = getBoardRow("volume", row.symbol);
    const reasons = inferMoveReason(row, volume).slice(0, 3);
    const preview = marketDetailPreview(row);
    const riskBucket = getRiskBucket(row);
    const selected = state.selectedMarketSymbol === row.symbol;
    return `
      <article class="market-observation-card ${selected ? "is-selected" : ""}" data-market-symbol="${escapeHtml(row.symbol)}">
        <div class="market-card-head">
          <div>
            <span>${escapeHtml(sectorDisplayName(row.sector))}</span>
            <strong>${escapeHtml(row.symbol)}</strong>
            <p>${escapeHtml(row.chineseName || row.company || row.symbol)}</p>
          </div>
          <em>${escapeHtml(capLabel(row))}</em>
        </div>
        <div class="market-card-metrics">
          <div>
            <span>${escapeHtml(state.meta[state.activeBoard].periodLabel)}</span>
            <strong class="${change >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatChangeValue(row))}</strong>
          </div>
          <div>
            <span>最近价</span>
            <strong>${escapeHtml(formatMoney(row.price))}</strong>
          </div>
          <div>
            <span>成交额</span>
            <strong>${escapeHtml(volume?.volumeRatio || row.volumeRatio || row.volume || "--")}</strong>
          </div>
        </div>
        <section>
          <span>为什么异动</span>
          <p>${reasons.map(escapeHtml).join(" / ")}</p>
        </section>
        <section>
          <span>下一步观察</span>
          <p>${escapeHtml(row.actionNote || "先看价格和成交额是否继续确认。")}</p>
        </section>
        <section>
          <span>点进详情看什么</span>
          <p>${escapeHtml(`${preview.primary} · ${preview.sourceText}`)}</p>
        </section>
        <div class="market-card-actions">
          <span class="risk-pill risk-${riskBucket}">${escapeHtml(getRiskLabel(riskBucket))}</span>
          ${watchlistActionButton(row.symbol, "涨跌幅榜")}
          <button class="ghost-action" type="button" data-stock-open="${escapeHtml(row.symbol)}">股票详情</button>
        </div>
      </article>
    `;
  }).join("");
};

const renderMarketDetail = (symbol) => {
  const panel = document.querySelector("#marketDetailPanel");
  if (!panel) return;
  const row = getMarketDetailSource(symbol);
  if (!row) {
    panel.innerHTML = `
      <div class="empty-detail">
        <strong>点击榜单股票查看详情</strong>
        <p>集中查看 1D、周、月、年内表现、成交额异动、风险标签和同板块对比。</p>
      </div>
    `;
    return;
  }
  const ytd = getBoardRow("ytd", row.symbol);
  const day = getBoardRow("day", row.symbol);
  const week = getBoardRow("week", row.symbol);
  const month = getBoardRow("month", row.symbol);
  const volume = getBoardRow("volume", row.symbol);
  const moveReasons = inferMoveReason(row, volume);
  const riskBucket = getRiskBucket(row);
  const riskScore = getRiskScore(row);
  const peers = uniqueBySymbol(state.rows.filter((item) => item.sector === row.sector && item.symbol !== row.symbol)).slice(0, 5);
  panel.innerHTML = `
    <div class="market-detail-head">
      <div>
        <span>单股详情</span>
        <strong>${escapeHtml(row.symbol)}</strong>
        <p>${escapeHtml(row.chineseName)} · ${escapeHtml(row.company)}</p>
      </div>
      <div class="market-detail-actions">
        <div class="tag-row">
          <span>${escapeHtml(sectorDisplayName(row.sector))}</span>
          <span>${escapeHtml(row.risk)}</span>
          <span>${capLabel(row)}</span>
        </div>
        <div class="market-action-row">
          ${watchlistActionButton(row.symbol, "涨跌幅榜")}
          <button class="ghost-action" type="button" data-stock-open="${escapeHtml(row.symbol)}">完整画像</button>
        </div>
      </div>
    </div>
    <div class="market-detail-grid">
      <article>
        <span>1D</span>
        <strong class="${day && getChange(day) < 0 ? "loss-cell" : "gain-cell"}">${formatChangeValue(day)}</strong>
        <p>${day ? `排名 ${escapeHtml(day.rank)}` : "暂无 1D 榜单记录"}</p>
      </article>
      <article>
        <span>近一周</span>
        <strong class="${week && getChange(week) < 0 ? "loss-cell" : "gain-cell"}">${formatChangeValue(week)}</strong>
        <p>${week ? `排名 ${escapeHtml(week.rank)}` : "暂无周榜记录"}</p>
      </article>
      <article>
        <span>近一月</span>
        <strong class="${month && getChange(month) < 0 ? "loss-cell" : "gain-cell"}">${formatChangeValue(month)}</strong>
        <p>${month ? `排名 ${escapeHtml(month.rank)}` : "暂无月榜记录"}</p>
      </article>
      <article>
        <span>今年以来</span>
        <strong class="${ytd && getChange(ytd) < 0 ? "loss-cell" : "gain-cell"}">${formatChangeValue(ytd)}</strong>
        <p>${ytd ? `排名 ${escapeHtml(ytd.rank)}` : "暂无年内榜记录"}</p>
      </article>
      <article>
        <span>成交额异动</span>
        <strong>${escapeHtml(volume?.volumeRatio || row.volumeRatio || "--")}</strong>
        <p>${escapeHtml(volume?.volume || row.volume || "--")}</p>
      </article>
      <article>
        <span>风险标签</span>
        <strong>${escapeHtml(getRiskLabel(riskBucket))}</strong>
        <div class="risk-score risk-${riskBucket}">
          <div class="risk-bar"><i style="width: ${riskScore}%"></i></div>
          <span>${escapeHtml(row.risk)}</span>
        </div>
      </article>
    </div>
    <div class="market-detail-bottom">
      <div class="market-paid-module" data-lockable-module="observe-action">
        <div class="module-head">
          <span>观察动作</span>
        </div>
        <p>${escapeHtml(row.actionNote)}</p>
      </div>
      <div class="market-paid-module" data-lockable-module="sector-peers">
        <div class="module-head">
          <span>同板块对比</span>
        </div>
        ${
          peers.length
            ? peers.map((peer) => `<b>${escapeHtml(peer.symbol)} ${formatChangeValue(peer)}</b>`).join("")
            : "<p>当前筛选下暂无同板块标的。</p>"
        }
      </div>
    </div>
    <div class="market-extra-grid">
      <div class="market-paid-module" data-lockable-module="move-reason">
        <div class="module-head">
          <div>
            <span>成交额异动原因</span>
            <strong>初步拆解</strong>
          </div>
        </div>
        <div class="reason-list">
          ${moveReasons.map((reason) => `<b>${escapeHtml(reason)}</b>`).join("")}
        </div>
        <p>先用成交额、涨跌幅、风险标签和板块热度拆解；若同时有财报或事件线索，再进入完整画像确认。</p>
      </div>
      ${renderSectorDetail(row)}
    </div>
  `;
};

const renderTable = () => {
  const rows = getFilteredRows();
  const body = document.querySelector("#gainersBody");
  const summary = document.querySelector("#resultSummary");

  syncMarketWorkspacePanels();
  if (state.marketWorkspaceSection === "flows") {
    renderFlowsPage();
    return;
  }
  summary.textContent = `${state.meta[state.activeBoard].title} · 当前筛选`;
  if (rows.length && (!state.selectedMarketSymbol || !rows.some((row) => row.symbol === state.selectedMarketSymbol))) {
    state.selectedMarketSymbol = rows[0].symbol;
  }
  renderMarketBrief(rows);
  renderMarketVisualBoard(rows);
  if (state.marketWorkspaceSection === "movers") {
    renderMarketMacroFilter(rows);
  } else {
    const macroFilter = document.querySelector("#marketMacroFilter");
    if (macroFilter) macroFilter.hidden = true;
  }
  renderDashboardFocus();
  renderDashboardVisualBoard();

  if (!rows.length) {
    body.innerHTML = `
      <tr>
        <td colspan="15">没有符合条件的股票</td>
      </tr>
    `;
    renderMarketDetail("");
    return;
  }

  body.innerHTML = rows
    .map((row) => {
      const change = getChange(row);
      const day = getBoardRow("day", row.symbol);
      const week = getBoardRow("week", row.symbol);
      const volume = getBoardRow("volume", row.symbol);
      const riskBucket = getRiskBucket(row);
      const riskScore = getRiskScore(row);
      const riskLabel = getRiskLabel(riskBucket);
      const preview = marketDetailPreview(row);
      const priority = state.macroFilter === "all" ? reviewPriorityForMarketRow(row) : { score: row.macroPriority, reason: row.macroPriorityReason };
      const dollarVolume = Number(volume?.dollarVolume || row.dollarVolume);
      const volumeRatio = volume?.volumeRatio || row.volumeRatio || "--";
      const move = marketMoveExplanation(row, volume);
      const sectorClue = marketSectorClue(row);
      return `
        <tr class="market-row ${state.selectedMarketSymbol === row.symbol ? "is-selected" : ""}" data-market-symbol="${escapeHtml(row.symbol)}">
          <td class="rank-cell" data-label="排名">${escapeHtml(row.displayRank || row.rank || "--")}</td>
          <td class="symbol-cell" data-label="股票">
            <strong>${escapeHtml(row.symbol)}</strong>
            <span>${escapeHtml(capLabel(row))}</span>
          </td>
          <td class="company-cell" data-label="中文简称">
            <strong>${escapeHtml(row.chineseName || row.symbol)}</strong>
            <span>${escapeHtml(row.company || row.symbol)}</span>
          </td>
          <td data-label="板块"><span class="sector-chip">${escapeHtml(sectorDisplayName(row.sector))}</span></td>
          <td data-label="${escapeHtml(state.meta[state.activeBoard].changeLabel)}" class="${change >= 0 ? "gain-cell" : "loss-cell"}">${change >= 0 ? "+" : ""}${formatPercent(change)}</td>
          <td data-label="最近价">${formatMoney(row.price)}</td>
          <td data-label="1D" class="${day && getChange(day) < 0 ? "loss-cell" : "gain-cell"}">${escapeHtml(formatChangeValue(day))}</td>
          <td data-label="5D" class="${week && getChange(week) < 0 ? "loss-cell" : "gain-cell"}">${escapeHtml(formatChangeValue(week))}</td>
          <td data-label="成交额">${escapeHtml(Number.isFinite(dollarVolume) ? formatCompactMoney(dollarVolume) : row.volume || "--")}</td>
          <td data-label="成交额倍数">${escapeHtml(volumeRatio)}</td>
          <td data-label="市值">${escapeHtml(row.marketCap || "--")}</td>
          <td data-label="风险">
            <div class="risk-score risk-${riskBucket}">
              <strong>${escapeHtml(riskLabel)}</strong>
              <div class="risk-bar"><i style="width: ${riskScore}%"></i></div>
              <span>${escapeHtml(row.risk || "--")}</span>
            </div>
          </td>
          <td class="move-cell" data-label="异动解释">
            <strong class="${move.tone}">${escapeHtml(move.title)}</strong>
            <span>${escapeHtml(move.reasons.join(" / "))}</span>
            <small>${escapeHtml(move.note)}</small>
          </td>
          <td class="sector-clue-cell" data-label="板块线索">
            <button class="inline-stock-link" type="button" data-sector-open="${escapeHtml(row.sector)}">${escapeHtml(sectorClue.sector)}</button>
            <strong class="${sectorClue.breadthText.startsWith("0") ? "is-negative" : "is-positive"}">${escapeHtml(sectorClue.breadthText)}</strong>
            <span>${escapeHtml(`${sectorClue.spreadText} · 龙头 ${sectorClue.leaderText}`)}</span>
          </td>
          <td class="action-cell" data-label="操作">
            <strong>${escapeHtml(preview.primary)}</strong>
            <small class="macro-rank-reason">${escapeHtml(`优先级 ${priority.score} · ${priority.reason || "等待更多数据"}`)}</small>
            <div class="inline-action-row">
              <button class="inline-stock-link" type="button" data-stock-open="${escapeHtml(row.symbol)}">详情</button>
              <button class="inline-stock-link" type="button" data-watchlist-toggle="${escapeHtml(row.symbol)}" data-watchlist-source="涨跌幅榜">${isInWatchlist(row.symbol) ? "已自选" : "加入自选"}</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
  renderMarketDetail(state.selectedMarketSymbol);
};

const enrichMarketRow = (row, nameMap) => {
  const mapped = nameMap[row.symbol] || {};
  return {
    rank: row.rank,
    symbol: row.symbol,
    company: row.name || mapped.company || row.symbol,
    chineseName: mapped.chineseName || row.symbol,
    sector: row.sectorProxy || mapped.sector || "未分类",
    risk: row.label || mapped.risk || "波动观察",
    actionNote: row.action || mapped.actionNote || "先观察成交额和价格是否能延续。",
    change: parseSignedPercent(row.periods && row.periods["20d"]),
    price: Number(row.price) || 0,
    volume: row.liquidity || mapped.volume || "--",
    volumeRatio: row.crowding && row.crowding.volumeRatio ? row.crowding.volumeRatio : "--",
    marketCap: mapped.marketCap || "--",
  };
};

const parseRiskBudget = (value) => {
  const number = Number(String(value || "").replace("%", ""));
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 50;
};

const temperatureProfile = (riskBudget) => {
  const score = parseRiskBudget(riskBudget);
  if (score >= 70) {
    return {
      score,
      title: "偏热，环境偏强",
      label: "偏强环境",
      copy: "市场比较友好，可以优先复盘强势方向，但仍要看确认。",
      scoreLabel: "满分 100，当前适合提高复盘频率。",
      className: "is-hot",
    };
  }
  if (score >= 50) {
    return {
      score,
      title: "不冷不热，边走边看",
      label: "观察环境",
      copy: "线索还在，但不急于下结论，先等价格和成交继续确认。",
      scoreLabel: "满分 100，当前适合保留弹性。",
      className: "is-warm",
    };
  }
  return {
    score,
    title: "偏冷，先防守",
    label: "防守观察",
    copy: "风险信号增多，先少做决定，多留现金和耐心。",
    scoreLabel: "满分 100，当前更适合控制回撤。",
    className: "is-cool",
  };
};

const readableActionCopy = (action, score) => {
  if (score >= 70) return "市场环境相对友好，可以提高强势线索的复盘优先级。";
  if (score >= 50) return "市场环境中性，优先看价格、成交额和事件理由同时清楚的线索。";
  if (/降低|防守|控制/.test(action || "")) return "市场压力偏高，先把高波动线索放到低频观察。";
  return "市场信号还不清楚，先以观察和复盘为主。";
};

const riskSignalDisplay = {
  SPY: {
    label: "大盘",
    tip: "用 SPY 代表美股整体。如果它走弱，很多个股会更难赚钱。",
  },
  QQQ: {
    label: "科技股",
    tip: "用 QQQ 观察科技股。科技股强，通常说明市场风险偏好更好。",
  },
  IWM: {
    label: "小盘股",
    tip: "用 IWM 看小公司股票。如果小盘也活跃，市场情绪通常更好。",
  },
  VIX: {
    label: "波动",
    tip: "用 VIX 看市场紧张程度。它上升时，价格来回扫的概率更高。",
  },
  "10Y": {
    label: "利率",
    tip: "用美国 10 年期国债收益率观察资金成本。利率高时，成长股更容易承压。",
  },
  "HY Spread": {
    label: "信用",
    tip: "看公司借钱是否变难。信用变差时，市场更容易进入防守。",
  },
};

const readableRuleCopy = (rule, index) => {
  const fallback = [
    ["大盘站稳", "大盘不弱时，股票事件的参考价值会更高。"],
    ["科技股带路", "科技股更强时，市场通常还有愿意承担风险的资金。"],
    ["波动和利率别太高", "市场太紧张或利率压力太大时，线索需要更多确认。"],
    ["信用风险别恶化", "如果公司借钱明显变难，防守观察优先级会上升。"],
  ];
  return fallback[index] || [rule.title || "观察指标", rule.note || "用来判断市场环境是偏积极、中性还是偏防守。"];
};

const renderCoreSignals = (core) => {
  if (!core) return;

  const marketRegime = core.marketRegime || {};
  const risk = core.risk || {};
  const mag7 = core.mag7 || {};
  const temperature = temperatureProfile(marketRegime.riskBudget);
  const actionCopy = readableActionCopy(marketRegime.action, temperature.score);

  setText("#marketRegimeLabel", marketRegime.label);
  setText("#marketRegimeSummary", marketRegime.summary);
  setText("#dashboardTemperatureScore", String(temperature.score));
  setText("#dashboardTemperatureLabel", temperature.label);
  setText("#dashboardTemperatureCopy", temperature.copy);
  setText("#temperatureTitle", temperature.title);
  setText("#temperatureSummary", marketRegime.summary || temperature.copy);
  setText("#temperatureAction", marketRegime.action || temperature.label);
  setText("#temperatureScore", String(temperature.score));
  setText("#temperatureScoreLabel", temperature.scoreLabel);
  setText("#dashboardRiskBudget", marketRegime.riskBudget);
  setText("#dashboardRiskNote", temperature.copy);
  setText("#riskBudgetValue", marketRegime.riskBudget);
  setText("#riskBudgetNote", `当前观察强度参考 ${marketRegime.riskBudget || "--"}，用于安排复盘精力。`);
  setText("#riskRegimeValue", marketRegime.label);
  setText("#riskRegimeNote", marketRegime.summary || temperature.copy);
  setText("#riskActionValue", marketRegime.action);
  setText("#riskActionNote", actionCopy);
  renderDashboardRegimeRadar();
  const needle = document.querySelector("#temperatureNeedle");
  if (needle) needle.style.left = `${temperature.score}%`;
  document.querySelectorAll(".temperature-hero, .temperature-mini").forEach((item) => {
    item.classList.remove("is-hot", "is-warm", "is-cool");
    item.classList.add(temperature.className);
  });

  if (core.strategy) {
    setText("#strategyOneYear", core.strategy.oneYear);
    setText("#strategyBenchmark", `对比 QQQ ${core.strategy.benchmarkOneYear}`);
    setText("#strategyDrawdown", core.strategy.maxDrawdown);
    setText("#strategyPosition", core.strategy.position);
  }

  const signals = risk.signals || [];
  const spy = signals.find((item) => item.term === "SPY");
  const qqq = signals.find((item) => item.term === "QQQ");
  setText("#dashboardSpyState", spy && spy.label);
  setText("#dashboardQqqState", qqq && qqq.label);

  const riskLights = document.querySelectorAll(".risk-lights .light-row");
  [spy, qqq].forEach((signal, index) => {
    if (signal && riskLights[index]) {
      riskLights[index].className = `light-row ${lightClass(signal.bucket)}`;
    }
  });
  if (riskLights[2]) {
    riskLights[2].className = `light-row ${marketRegime.riskBudget === "30%" ? "watch" : "neutral"}`;
  }

  const riskGrid = document.querySelector("#riskSignalGrid");
  if (riskGrid && signals.length) {
    riskGrid.innerHTML = signals
      .map(
        (signal) => {
          const display = riskSignalDisplay[signal.term] || {
            label: signal.term,
            tip: signal.tooltip || "这个指标用来判断市场现在偏强、偏中性还是偏防守。",
          };
          return `
          <article class="signal-card ${signalClass(signal.bucket)}">
            <span>
              ${escapeHtml(display.label)}
              <button class="info-tip" type="button" aria-label="${escapeHtml(display.label)}解释" data-tip="${escapeHtml(display.tip)}">?</button>
            </span>
            <strong>${escapeHtml(signal.label)}</strong>
            <p>${escapeHtml(signal.note)}</p>
          </article>
        `;
        },
      )
      .join("");
  }

  const ruleTimeline = document.querySelector("#riskRuleTimeline");
  if (ruleTimeline && risk.rules && risk.rules.length) {
    ruleTimeline.innerHTML = risk.rules
      .map((rule, index) => {
        const [title, note] = readableRuleCopy(rule, index);
        return `
          <div class="${rule.done ? "is-done" : ""}">
            <span>${String(index + 1).padStart(2, "0")}</span>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(note)}</p>
          </div>
        `;
      })
      .join("");
  }

  const mag7Rows = mag7.rows || [];
  const leader = mag7.leader || mag7Rows[0];
  if (leader) {
    setText("#mag7LeaderSymbol", leader.symbol);
    setText("#mag7LeaderScore", leader.status || "领先");
    setText(
      "#mag7LeaderNote",
      `${leader.name}当前是七姐妹中优先级更高的跟踪主线。`,
    );
  }

  const dashboardGrid = document.querySelector("#dashboardMag7Grid");
  if (dashboardGrid && mag7Rows.length) {
    dashboardGrid.innerHTML = mag7Rows
      .map(
        (row) => `
          <article>
            <strong>${escapeHtml(row.symbol)}</strong>
            <span>${escapeHtml(row.name)} · ${escapeHtml(row.status)}</span>
            <b>${escapeHtml(row.status)}</b>
            <i style="width:${Math.max(0, Math.min(100, Number(row.score) || 0))}%"></i>
          </article>
        `,
      )
      .join("");
  }

  const mag7Table = document.querySelector("#mag7Table");
  if (mag7Table && mag7Rows.length) {
    mag7Table.innerHTML = mag7Rows
      .map(
        (row, index) => `
          <div class="mag7-row ${index === 0 ? "is-top" : ""}">
            <span>${index + 1}</span>
            <strong>${escapeHtml(row.symbol)} ${escapeHtml(row.name)}</strong>
            <em>${escapeHtml(row.status)}</em>
            <b>${escapeHtml(row.monthReturn)}</b>
            <i style="width:${Math.max(0, Math.min(100, Number(row.score) || 0))}%"></i>
          </div>
        `,
      )
      .join("");
  }

  const allocationList = document.querySelector("#allocationList");
  if (allocationList && mag7.allocation && mag7.allocation.length) {
    allocationList.innerHTML = mag7.allocation
      .map(
        (item) => `
          <div>
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.symbols)}</strong>
            <em>${escapeHtml(item.weight)}</em>
          </div>
        `,
      )
      .join("");
  }
};

const marketTermTips = {
  vix: "VIX 常被叫作恐慌指数，用来观察市场对未来波动的担心程度。数值越高，短线震荡通常越大。",
  treasury: "美债收益率代表资金成本。收益率上行时，成长股和高估值股票更容易承压。",
  dgs30: "30年期美债收益率反映更长期的资金成本。它走高时，长久期资产、地产、公用事业和高估值股票更容易承压。",
  ten_year: "10 年期美债收益率是市场常看的长端利率，能影响股票估值和资金风险偏好。",
  fedfunds: "联邦基金利率可以理解成美国基准利率。利率越高，企业融资和股票估值压力通常越大。",
  cpiaucsl: "CPI 是通胀指标。通胀偏高时，美联储更难降息，成长股估值容易受压。",
  dtwexbgs: "美元指数用于观察美元强弱。美元偏强时，全球风险偏好、大宗商品和海外收入占比较高的公司都需要观察。",
  dcoilwtico: "WTI 原油是市场常看的美国原油价格。油价上行会影响通胀预期、能源股和航空物流等成本敏感行业。",
  dcoilbrenteu: "Brent 原油是全球原油定价的重要参考。油价上行时，通胀和企业成本压力更容易被市场重新关注。",
  unrate: "失业率反映就业情况。就业明显变差时，市场会担心经济放缓。",
  credit: "信用利差观察公司融资环境。利差扩大，说明市场更担心信用风险，股票环境通常偏防守。",
  credit_spread: "信用利差观察公司融资环境。利差扩大，说明市场更担心信用风险，股票环境通常偏防守。",
  bamlh0a0hym2: "高收益债利差可以理解成风险公司借钱的难度。利差越大，市场越偏防守。",
  high_yield_spread: "高收益债利差能反映风险资产压力。利差快速扩大时，短线高热度线索要降级观察。",
};

const marketIndicatorTip = (indicator) => {
  const text = `${indicator?.key || ""} ${indicator?.name || ""}`.toLowerCase();
  if (marketTermTips[String(indicator?.key || "").toLowerCase()]) {
    return marketTermTips[String(indicator.key).toLowerCase()];
  }
  if (/vix|波动|恐慌/.test(text)) return marketTermTips.vix;
  if (/10y|treasury|yield|美债|利率|国债/.test(text)) return marketTermTips.treasury;
  if (/30y|30年/.test(text)) return marketTermTips.dgs30;
  if (/dollar|美元|dtwex|dxy/.test(text)) return marketTermTips.dtwexbgs;
  if (/oil|原油|wti/.test(text)) return marketTermTips.dcoilwtico;
  if (/brent/.test(text)) return marketTermTips.dcoilbrenteu;
  if (/credit|spread|信用|利差/.test(text)) return marketTermTips.credit;
  return indicator?.explain || "这个指标会影响市场风险偏好，用来辅助判断市场环境是偏积极、中性还是偏防守。";
};

const macroPressureKeys = ["dgs10", "dgs30", "dtwexbgs", "dcoilwtico", "cpiaucsl"];

const macroImpactCopy = (indicator) => {
  const key = String(indicator?.key || "").toLowerCase();
  const impact = indicator?.impact || "市场环境";
  if (key === "dgs10") return `${impact}：影响成长股估值和资金成本。`;
  if (key === "dgs30") return `${impact}：影响长周期资产和高估值板块。`;
  if (key === "dtwexbgs") return `${impact}：影响黄金、原油和海外收入公司。`;
  if (key === "dcoilwtico") return `${impact}：影响能源链、通胀预期和企业成本。`;
  if (key === "cpiaucsl") return `${impact}：影响利率预期和风险偏好。`;
  return `影响：${impact}。`;
};

const macroFactorAffectedAssets = (indicator) => {
  const key = normalizeMacroIndicatorKey(indicator);
  const mapping = {
    vixcls: "指数 / 小盘 / 高波动",
    dgs10: "成长股 / 科技 / 地产",
    dgs30: "长久期资产 / 公用事业",
    dtwexbgs: "黄金 / 材料 / 海外收入",
    dcoilwtico: "能源 / 航空 / 消费",
    dcoilbrenteu: "能源 / 运输 / 通胀",
    cpiaucsl: "利率敏感 / 消费 / 成长股",
  };
  return mapping[key] || indicator?.impact || indicator?.category || "市场环境";
};

const macroFactorAction = (indicator) => {
  const key = normalizeMacroIndicatorKey(indicator);
  const status = indicator?.status || indicator?.riskLevel;
  const elevated = status === "watch" || status === "elevated" || status === "high" || indicator?.level === "高";
  if (key === "vixcls") return elevated ? "减少追高，先看回撤承接" : "可正常跟踪强势线索";
  if (key === "dgs10" || key === "dgs30") return elevated ? "高估值股票需要成交额确认" : "成长线索按强弱排序复盘";
  if (key === "dtwexbgs") return elevated ? "黄金和海外收入线索多看一层确认" : "美元压力不构成主约束";
  if (key === "dcoilwtico" || key === "dcoilbrenteu") return elevated ? "能源和成本敏感方向分开看" : "油价暂按背景变量处理";
  if (key === "cpiaucsl") return elevated ? "通胀敏感线索降低频率" : "通胀压力暂不主导排序";
  return elevated ? "提高确认门槛" : "继续观察";
};

const normalizeMacroIndicatorKey = (item) => String(item?.key || item?.id || item?.sourceId || "").toLowerCase();

const macroPressureIndicatorFromSeries = (item) => {
  if (!item) return null;
  const key = normalizeMacroIndicatorKey(item);
  const value = item.value || formatIndicatorValueWithUnit(item.current ?? item.currentValue ?? item.latestValue, item.unit || "");
  return {
    key,
    name: item.name || macroSeriesFallbackNames[key] || "宏观指标",
    value,
    previous: item.previous || formatIndicatorValueWithUnit(item.previousValue ?? item.previous, item.unit || ""),
    change: item.change || "变化待更新",
    status: item.status || (item.level === "高" ? "watch" : item.level === "低" ? "positive" : "neutral"),
    level: item.level || item.riskLabel || "--",
    explain: item.summary || item.explain || item.explanation || "",
    impact: item.impact || item.category || "市场环境",
    percentiles: item.percentiles || {},
    percentile: item.percentile ?? item.rankPercentile,
    points: item.points || [],
    current: item.current ?? item.currentValue ?? item.latestValue,
    unit: item.unit || "",
    bands: item.bands || item.refs || item.referenceLines || {},
  };
};

const macroPressureRows = (indicators = []) => {
  const byKey = new Map();
  indicators.forEach((item) => {
    const key = normalizeMacroIndicatorKey(item);
    if (!key) return;
    byKey.set(key, {
      ...item,
      key,
      impact: item.impact || item.category || "市场环境",
    });
  });
  normalizeMacroSeriesItems(state.macroSeries).forEach((item) => {
    const row = macroPressureIndicatorFromSeries(item);
    if (!row) return;
    const existing = byKey.get(row.key);
    byKey.set(row.key, existing ? { ...row, ...existing, points: row.points, percentiles: row.percentiles, bands: row.bands, percentile: row.percentile, unit: row.unit || existing.unit } : row);
  });
  return macroPressureKeys.map((key) => byKey.get(key)).filter(Boolean);
};

const getMacroIndicator = (key) =>
  macroPressureRows(state.marketTemperature?.indicators || []).find((item) => normalizeMacroIndicatorKey(item) === key) || null;

const stockMacroProfile = (profile, market) => {
  const text = `${profile?.sector || ""} ${profile?.company || ""} ${profile?.chineseName || ""} ${market?.sector || ""}`.toLowerCase();
  if (/能源|原油|油气|oil|gas|energy/.test(text)) {
    return {
      label: "能源与成本",
      keys: ["dcoilwtico", "dcoilbrenteu", "dtwexbgs"],
      note: "重点看油价和美元。油价偏高会影响能源线索，也会重新推高成本和通胀预期。",
    };
  }
  if (/黄金|白银|贵金属|金矿|silver|gold|mining|precious/.test(text)) {
    return {
      label: "美元与实际利率",
      keys: ["dtwexbgs", "dgs10", "cpiaucsl"],
      note: "重点看美元、利率和通胀。美元或利率走强时，贵金属相关线索通常需要多看一层确认。",
    };
  }
  if (/银行|金融|券商|保险|fintech|financial|bank|broker|insurance/.test(text)) {
    return {
      label: "利率曲线",
      keys: ["dgs10", "t10y2y", "dtwexbgs"],
      note: "重点看长端利率和利差。金融股不只看利率高低，还要看曲线和信用环境是否配合。",
    };
  }
  if (/地产|公用事业|reits|reit|real estate|utility|utilities/.test(text)) {
    return {
      label: "长期利率压力",
      keys: ["dgs30", "dgs10", "cpiaucsl"],
      note: "重点看30年期和10年期美债。长期利率偏高时，长久期资产和分红类资产更容易承压。",
    };
  }
  if (/航空|物流|运输|零售|消费|airline|transport|logistics|retail|consumer/.test(text)) {
    return {
      label: "成本与消费压力",
      keys: ["dcoilwtico", "cpiaucsl", "dtwexbgs"],
      note: "重点看油价、CPI 和美元。成本或通胀压力上行时，消费和运输相关线索需要更谨慎复盘。",
    };
  }
  if (/加密|稳定币|crypto|bitcoin|ethereum|blockchain/.test(text)) {
    return {
      label: "美元与风险偏好",
      keys: ["dtwexbgs", "dgs10", "vixcls"],
      note: "重点看美元、利率和波动率。风险偏好走弱时，加密相关美股通常波动会放大。",
    };
  }
  if (/科技|半导体|软件|互联网|云|算力|ai|航天|新能源车|technology|semiconductor|software|internet|cloud|auto|space/.test(text)) {
    return {
      label: "成长股估值压力",
      keys: ["dgs10", "dgs30", "cpiaucsl"],
      note: "重点看10年期、30年期美债和CPI。利率或通胀压力偏高时，高估值成长股需要更多价格确认。",
    };
  }
  return {
    label: "通用宏观背景",
    keys: ["dgs10", "dtwexbgs", "cpiaucsl"],
    note: "先看利率、美元和通胀三件事。它们会影响市场风险偏好和估值环境。",
  };
};

const stockMacroExposure = (profile, market) => {
  const profileInfo = stockMacroProfile(profile, market);
  const rows = profileInfo.keys
    .map((key) => getMacroIndicator(key))
    .filter(Boolean)
    .slice(0, 3);
  return {
    ...profileInfo,
    rows,
    pressureCount: rows.filter((item) => item.status === "watch").length,
  };
};

const macroStockPools = [
  {
    key: "rates",
    label: "利率敏感",
    title: "利率压力相关",
    indicatorKeys: ["dgs10", "dgs30", "cpiaucsl"],
    pattern: /科技|半导体|软件|互联网|云|算力|ai|航天|新能源车|地产|公用事业|xlk|smh|xlre|xlu|technology|semiconductor|software|cloud|space|auto|real estate|utility/i,
    note: "重点看高估值成长、地产、公用事业等长久期资产。利率偏高时，这些线索更需要价格和成交确认。",
  },
  {
    key: "dollar",
    label: "美元敏感",
    title: "美元强弱相关",
    indicatorKeys: ["dtwexbgs", "dgs10", "cpiaucsl"],
    pattern: /黄金|白银|贵金属|材料|能源|中概|电商|出行|通信|xlb|xle|xlc|gold|silver|mining|materials|energy|china|internet/i,
    note: "重点看贵金属、大宗商品、海外收入和中概相关线索。美元偏强时，需要多看一层风险偏好。",
  },
  {
    key: "oil",
    label: "原油敏感",
    title: "油价与成本相关",
    indicatorKeys: ["dcoilwtico", "dcoilbrenteu", "cpiaucsl"],
    pattern: /能源|原油|油气|航空|物流|运输|消费|零售|工业|工业服务|xle|xli|xly|oil|gas|energy|airline|transport|logistics|consumer|retail/i,
    note: "重点看能源受益线索，以及航空、物流、消费等成本敏感方向。油价偏高时，通胀预期也要一起看。",
  },
  {
    key: "inflation",
    label: "通胀敏感",
    title: "通胀与成本相关",
    indicatorKeys: ["cpiaucsl", "dgs10", "dcoilwtico"],
    pattern: /消费|零售|能源|材料|地产|公用事业|医疗|工业|xly|xle|xlb|xlre|xlu|xlv|xli|consumer|retail|energy|materials|real estate|utility|healthcare|industrial/i,
    note: "重点看消费成本、能源材料、地产和分红类资产。CPI 偏高时，利率敏感线索也要同步复盘。",
  },
];

const macroPoolByKey = (key) => macroStockPools.find((pool) => pool.key === key) || null;

const macroPoolMatchesRow = (pool, row) => {
  if (!pool || !row) return false;
  const strength = findStrengthRow(row.symbol);
  const text = [
    row.symbol,
    row.company,
    row.name,
    row.chineseName,
    row.sector,
    row.sectorProxy,
    strength?.sectorProxy,
    strength?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return pool.pattern.test(text);
};

const macroPriorityScore = (row) => {
  return reviewPriorityForMarketRow(row).score;
};

const macroPriorityReason = (row) => {
  return reviewPriorityForMarketRow(row).reason;
};

const macroPoolRows = (pool) => {
  const candidates = uniqueBySymbol([
    ...allMarketRows(),
    ...(state.strength?.rows || []).map((row) => enrichMarketRow(row, {})),
  ]).filter((row) => macroPoolMatchesRow(pool, row));
  return candidates
    .map((row) => {
      const strength = findStrengthRow(row.symbol);
      const change = Number.isFinite(getChange(row)) ? getChange(row) : parseSignedPercent(strength?.periods?.["20d"]);
      const score = macroPriorityScore(row);
      return {
        ...row,
        change,
        score,
        macroPriorityReason: macroPriorityReason(row),
        stateLabel: strengthStateLabel(strength) || row.risk || "观察",
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
};

const renderMacroStockPools = () => {
  const grid = document.querySelector("#macroStockGrid");
  if (!grid) return;
  const visiblePools = macroStockPools.map((pool) => ({
    ...pool,
    indicators: pool.indicatorKeys.map(getMacroIndicator).filter(Boolean),
    rows: macroPoolRows(pool),
  }));
  const activeCount = visiblePools.reduce((sum, pool) => sum + pool.rows.length, 0);
  setText(
    "#macroStockSummary",
    activeCount
      ? `已整理 ${activeCount} 条宏观相关股票事件。点击股票可进入完整画像。`
      : "根据利率、美元、原油和通胀，把相关板块里的强弱线索整理成复盘池。",
  );
  grid.innerHTML = visiblePools
    .map((pool) => {
      const watchCount = pool.indicators.filter((item) => item.status === "watch").length;
      return `
        <article>
          <div class="macro-stock-head">
            <span>${escapeHtml(pool.label)}</span>
            <strong>${escapeHtml(pool.title)}</strong>
            <p>${escapeHtml(pool.note)}</p>
          </div>
          <div class="macro-factor-row">
            ${
              pool.indicators.length
                ? pool.indicators.map((indicator) => `<b class="${signalClass(indicator.status)}">${escapeHtml(indicator.name)} ${escapeHtml(indicator.value || "--")} · ${escapeHtml(indicator.level || "--")}</b>`).join("")
                : "<b>等待宏观数据</b>"
            }
          </div>
          <div class="macro-stock-list">
            ${
              pool.rows.length
                ? pool.rows.map((row) => `
                    <button type="button" data-stock-open="${escapeHtml(row.symbol)}">
                      <strong>${escapeHtml(row.symbol)}</strong>
                      <span>${escapeHtml(row.chineseName || row.company || row.name || row.symbol)}</span>
                      <em class="${Number(row.change) >= 0 ? "is-positive" : "is-negative"}">${Number.isFinite(row.change) ? formatSignedPct(row.change) : "--"}</em>
                      <small>${escapeHtml(`复盘分 ${row.score} · ${row.macroPriorityReason || "等待更多数据"}`)}</small>
                    </button>
                  `).join("")
                : "<p>当前没有足够匹配的股票事件。</p>"
            }
          </div>
          <small>${watchCount ? `${watchCount} 个宏观因子偏高，复盘时先看确认。` : "宏观压力不算极端，继续看价格和成交确认。"}</small>
          <button class="macro-pool-action" type="button" data-macro-pool-open="${escapeHtml(pool.key)}">查看相关股票</button>
        </article>
      `;
    })
    .join("");
};

const renderMarketMacroFilter = (rows) => {
  const panel = document.querySelector("#marketMacroFilter");
  if (!panel) return;
  const pool = macroPoolByKey(state.macroFilter);
  if (!pool) {
    panel.hidden = true;
    return;
  }
  const indicators = pool.indicatorKeys.map(getMacroIndicator).filter(Boolean);
  const pressure = indicators.filter((item) => item.status === "watch").length;
  panel.hidden = false;
  setText("#marketMacroFilterTitle", `${pool.label} · ${rows.length} 只股票`);
  setText(
    "#marketMacroFilterNote",
    `${pool.note} 当前相关宏观因子：${indicators.map((item) => `${item.name} ${item.value || "--"} · ${item.level || "--"}`).join("；") || "等待数据"}。${pressure ? `${pressure} 项偏高。` : ""} 当前按强弱、成交额确认、价格表现和风险等级综合排序。`,
  );
};

const applyMacroPoolFilter = (poolKey) => {
  const pool = macroPoolByKey(poolKey);
  if (!pool) return;
  state.activeBoard = "month";
  state.rows = state.boards.month || state.rows;
  state.macroFilter = pool.key;
  state.query = "";
  state.capFilter = "all";
  state.sectorFilter = "all";
  state.riskFilter = "all";
  state.directionFilter = "all";
  const input = document.querySelector("#searchInput");
  if (input) input.value = "";
  const cap = document.querySelector("#capFilter");
  if (cap) cap.value = "all";
  const risk = document.querySelector("#riskFilter");
  if (risk) risk.value = "all";
  const direction = document.querySelector("#directionFilter");
  if (direction) direction.value = "all";
  renderSectorOptions();
  const sector = document.querySelector("#sectorFilter");
  if (sector) sector.value = "all";
  document.querySelectorAll(".board-tab").forEach((item) => {
    const active = item.dataset.board === state.activeBoard;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-pressed", active ? "true" : "false");
  });
  renderStats();
  renderLeader(state.rows[0], state.meta[state.activeBoard].updatedAt);
  renderTable();
  showPage("market");
};

const clearMacroPoolFilter = () => {
  state.macroFilter = "all";
  renderTable();
};

const renderMacroPressure = (indicators) => {
  const grid = document.querySelector("#macroPressureGrid");
  if (!grid) return;
  const macroRows = macroPressureRows(indicators);
  const pressureCount = macroRows.filter((item) => item.status === "watch").length;
  const neutralCount = macroRows.filter((item) => item.status === "neutral").length;
  setText(
    "#macroPressureSummary",
    macroRows.length
      ? `${pressureCount} 项偏高，${neutralCount} 项需要观察。重点看利率、美元、油价和通胀对板块的影响。`
      : "读取最新宏观数据后，会显示对成长股、能源、黄金和风险偏好的影响。",
  );
  grid.innerHTML = macroRows.length
    ? macroRows
        .map((indicator) => `
          <tr class="${signalClass(indicator.status)}">
            <td>
              ${escapeHtml(indicator.name || "宏观指标")}
              <button class="info-tip" type="button" aria-label="${escapeHtml(indicator.name || "宏观指标")}解释" data-tip="${escapeHtml(marketIndicatorTip(indicator))}">?</button>
            </td>
            <td>
              <strong>${escapeHtml(indicator.value || "--")}</strong>
              <span>前值 ${escapeHtml(indicator.previous || "--")}</span>
            </td>
            <td>
              <div class="macro-pressure-rank ${signalClass(indicator.status)}">
                <b>${escapeHtml(indicator.level || "--")}</b>
                ${macroPressureSparkline(indicator)}
              </div>
            </td>
            <td><em class="${indicatorChangeMetaClass(indicator.change)}">${escapeHtml(indicatorChangeMetaLabel(indicator.change))}</em></td>
            <td>${escapeHtml(macroFactorAffectedAssets(indicator))}</td>
            <td>${escapeHtml(macroFactorAction(indicator))}</td>
          </tr>
        `)
        .join("")
    : `
      <tr><td colspan="6">宏观压力数据生成前，页面保持可用。</td></tr>
    `;
  renderMacroStockPools();
  renderMacroMonitor();
};

const macroSeriesOrder = ["vixcls", "dgs10", "dgs30", "dtwexbgs", "dcoilwtico", "dcoilbrenteu", "cpiaucsl"];
const macroSeriesFallbackNames = {
  vixcls: "VIX",
  dgs10: "美债10年",
  dgs30: "美债30年",
  dtwexbgs: "美元指数",
  dcoilwtico: "WTI原油",
  dcoilbrenteu: "Brent原油",
  cpiaucsl: "CPI同比",
};

const macroSeriesPlainExplanations = {
  vixcls: "衡量市场预期波动，数值越高通常代表市场越紧张。",
  dgs10: "观察成长股估值压力和市场对长期利率的定价。",
  dgs30: "观察长期资金成本，对高估值资产和长久期资产影响更明显。",
  dtwexbgs: "观察美元强弱，美元偏强时大宗商品和全球风险偏好通常更受压制。",
  dcoilwtico: "观察美国原油价格，对能源、通胀和企业成本有直接影响。",
  dcoilbrenteu: "观察国际油价水平，对通胀、能源股和运输消费成本有影响。",
  cpiaucsl: "观察通胀压力和降息预期，是利率敏感资产的重要背景。",
};

const macroSeriesConclusionLabel = (item) => {
  const level = item.level || "";
  const percentile = parseMacroSeriesNumber(item.percentile);
  if (item.key === "vixcls") {
    if (level === "低" || percentile <= 35) return "低波动区间";
    if (level === "高" || percentile >= 75) return "波动压力偏高";
    return "波动需要观察";
  }
  if (level === "高" || percentile >= 80) return "历史位置偏高";
  if (level === "低" || percentile <= 30) return "历史位置偏低";
  return "处在中性区间";
};

const macroSeriesTone = (item) => {
  if (item.status === "watch" || item.level === "高") return "is-watch";
  if (item.status === "positive" || item.level === "低") return "is-positive";
  return "is-neutral";
};

const macroSeriesRangeYears = () => (state.macroSeriesRange === "5y" ? 5 : state.macroSeriesRange === "3y" ? 3 : 1);
const macroSeriesRangeLabel = () => state.macroSeriesRange.replace("y", "年");

const macroMonitorKeys = ["vixcls", "dgs10", "dtwexbgs", "dcoilwtico", "cpiaucsl"];

const macroMonitorSeriesItems = () => {
  const byKey = new Map(normalizeMacroSeriesItems(state.macroSeries).map((item) => [item.key, item]));
  return macroMonitorKeys.map((key) => byKey.get(key)).filter(Boolean);
};

const macroMonitorPressureScore = (item, value) => {
  const points = item.points || [];
  const values = points.map((point) => point.value).filter(Number.isFinite);
  if (!values.length || !Number.isFinite(value)) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const score = ((value - min) / (max - min || 1)) * 100;
  return Math.max(0, Math.min(100, score));
};

const macroMonitorCompositePoints = () => {
  const items = macroMonitorSeriesItems();
  if (items.length < 2) return [];
  const count = Math.min(90, ...items.map((item) => item.points.length));
  if (count < 8) return [];
  return Array.from({ length: count }, (_, index) => {
    const scores = items
      .map((item) => {
        const point = item.points[item.points.length - count + index];
        return macroMonitorPressureScore(item, point?.value);
      })
      .filter(Number.isFinite);
    const date = items[0].points[items[0].points.length - count + index]?.date;
    const value = scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length);
    return { date, value };
  }).filter((point) => point.date && Number.isFinite(point.value));
};

const macroMonitorSvg = (points) => {
  if (points.length < 2) return '<div class="macro-chart-empty">等待图表</div>';
  const width = 1160;
  const height = 380;
  const pad = { left: 66, right: 242, top: 38, bottom: 58 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const min = 0;
  const max = 100;
  const xFor = (index) => pad.left + (plotW * index) / Math.max(1, points.length - 1);
  const yFor = (value) => pad.top + (1 - (value - min) / (max - min)) * plotH;
  const path = points.map((point, index) => `${index ? "L" : "M"}${xFor(index).toFixed(1)} ${yFor(point.value).toFixed(1)}`).join(" ");
  const area = `${path} L${xFor(points.length - 1).toFixed(1)} ${pad.top + plotH} L${pad.left} ${pad.top + plotH} Z`;
  const last = points.at(-1);
  const previous = points.at(Math.max(0, points.length - 11));
  const delta = Number.isFinite(last.value) && Number.isFinite(previous?.value) ? last.value - previous.value : 0;
  const deltaLabel = Math.abs(delta) < 1 ? "近10点持平" : delta > 0 ? `近10点 +${delta.toFixed(1)}` : `近10点 ${delta.toFixed(1)}`;
  const stateLabel = last.value >= 65 ? "高压力" : last.value >= 35 ? "中性" : "低压力";
  const lastX = xFor(points.length - 1);
  const lastY = yFor(last.value);
  const ticks = [100, 80, 65, 50, 35, 20, 0];
  const labels = [points[0], points[Math.floor(points.length / 2)], points.at(-1)];
  const zone = (from, to, className) => {
    const yTop = yFor(to);
    const yBottom = yFor(from);
    return `<rect class="${className}" x="${pad.left}" y="${yTop.toFixed(1)}" width="${plotW}" height="${(yBottom - yTop).toFixed(1)}"></rect>`;
  };
  const zoneLabel = (value, label, range, className) => `
    <g class="macro-monitor-zone-label ${className}" transform="translate(${(pad.left + 16).toFixed(1)}, ${(yFor(value) + 4).toFixed(1)})">
      <text>${escapeHtml(label)}</text>
      <text class="macro-monitor-zone-range" x="0" y="17">${escapeHtml(range)}</text>
    </g>
  `;
  const thresholdLine = (value, label) => {
    const y = yFor(value);
    return `
      <g class="macro-monitor-threshold">
        <line x1="${pad.left}" x2="${width - pad.right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"></line>
        <text x="${pad.left + 10}" y="${(y - 7).toFixed(1)}">${escapeHtml(label)}</text>
      </g>
    `;
  };
  const calloutX = pad.left + plotW + 30;
  const calloutY = Math.max(pad.top + 10, Math.min(pad.top + plotH - 92, lastY - 44));
  return `
    <svg class="macro-monitor-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="宏观综合压力走势">
      <rect class="macro-monitor-plot" x="${pad.left}" y="${pad.top}" width="${plotW}" height="${plotH}"></rect>
      ${zone(0, 35, "macro-monitor-zone is-low")}
      ${zone(35, 65, "macro-monitor-zone is-mid")}
      ${zone(65, 100, "macro-monitor-zone is-high")}
      ${zoneLabel(18, "低压力", "0-35", "is-low")}
      ${zoneLabel(50, "中性", "35-65", "is-mid")}
      ${zoneLabel(83, "高压力", "65+", "is-high")}
      ${thresholdLine(65, "高压力阈值")}
      ${thresholdLine(35, "低压力阈值")}
      ${ticks.map((tick) => {
        const y = yFor(tick);
        return `<g class="macro-monitor-gridline"><line x1="${pad.left}" x2="${width - pad.right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"></line><text x="${pad.left - 12}" y="${(y + 4).toFixed(1)}" text-anchor="end">${tick}</text></g>`;
      }).join("")}
      <text class="macro-monitor-axis-title" x="${pad.left}" y="20">压力指数 0-100</text>
      <path class="macro-monitor-area" d="${area}"></path>
      <path class="macro-monitor-line" d="${path}"></path>
      <line class="macro-monitor-guide" x1="${lastX.toFixed(1)}" x2="${lastX.toFixed(1)}" y1="${pad.top}" y2="${pad.top + plotH}"></line>
      <line class="macro-monitor-current-level" x1="${pad.left}" x2="${width - pad.right}" y1="${lastY.toFixed(1)}" y2="${lastY.toFixed(1)}"></line>
      <circle class="macro-monitor-dot" cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="5.5"></circle>
      <line class="macro-monitor-callout-link" x1="${lastX.toFixed(1)}" x2="${(calloutX - 12).toFixed(1)}" y1="${lastY.toFixed(1)}" y2="${(calloutY + 43).toFixed(1)}"></line>
      <g class="macro-monitor-rail" transform="translate(${(pad.left + plotW + 16).toFixed(1)}, ${pad.top})">
        <rect width="${(pad.right - 34).toFixed(1)}" height="${plotH.toFixed(1)}" rx="0"></rect>
        <text x="14" y="22">当前读数</text>
        <text x="14" y="${(plotH - 18).toFixed(1)}">数值越高，宏观扰动越强</text>
      </g>
      <g class="macro-monitor-callout" transform="translate(${calloutX.toFixed(1)}, ${calloutY.toFixed(1)})">
        <rect width="176" height="86" rx="7"></rect>
        <text x="13" y="20">${escapeHtml(stateLabel)}</text>
        <text class="macro-monitor-callout-value" x="13" y="50">${Math.round(last.value)}</text>
        <text class="macro-monitor-callout-date" x="76" y="49">${escapeHtml(formatDisplayDate(last.date).slice(0, 10))}</text>
        <text class="macro-monitor-callout-delta" x="13" y="68">${escapeHtml(deltaLabel)}</text>
      </g>
      ${labels.map((point, index) => {
        const pointIndex = index === 0 ? 0 : index === 1 ? Math.floor(points.length / 2) : points.length - 1;
        return `<text class="macro-monitor-x" x="${xFor(pointIndex).toFixed(1)}" y="${height - 8}" text-anchor="${index === 0 ? "start" : index === 2 ? "end" : "middle"}">${escapeHtml(formatDisplayDate(point.date).slice(0, 7))}</text>`;
      }).join("")}
    </svg>
  `;
};

const macroMonitorVerdict = (score) => {
  if (!Number.isFinite(score)) return "等待历史数据";
  if (score >= 65) return "高压力区：先控制高波动股票，重点看 VIX、利率和美元是否继续上行。";
  if (score >= 35) return "中性区：不要只看指数涨跌，要拆开看压力来自利率、美元还是通胀。";
  return "低压力区：宏观背景相对可控，继续看强弱和事件线索是否有价格确认。";
};

const macroPressureBand = (score) => {
  if (!Number.isFinite(score)) return { label: "等待分区", className: "is-neutral" };
  if (score >= 65) return { label: "高压力区", className: "is-watch" };
  if (score >= 35) return { label: "中性区", className: "is-neutral" };
  return { label: "低压力区", className: "is-positive" };
};

const macroFactorPercentile = (indicator) => {
  const candidates = [
    indicator?.percentiles?.oneYear,
    indicator?.percentiles?.threeYear,
    indicator?.percentiles?.fiveYear,
    indicator?.percentile,
    indicator?.rankPercentile,
  ];
  for (const value of candidates) {
    const number = parseMacroSeriesNumber(value);
    if (Number.isFinite(number)) return Math.max(0, Math.min(100, number));
  }
  return null;
};

const macroFactorScore = (indicator) => {
  const percentile = macroFactorPercentile(indicator);
  if (Number.isFinite(percentile)) return percentile;
  if (indicator?.points?.length) {
    const current = parseMacroSeriesNumber(indicator.current ?? indicator.latestValue ?? indicator.value ?? indicator.points.at(-1)?.value);
    const pressureScore = macroMonitorPressureScore(indicator, current);
    if (Number.isFinite(pressureScore)) return pressureScore;
  }
  const raw = Number(indicator?.riskScore);
  if (Number.isFinite(raw)) return Math.max(0, Math.min(100, raw * 33.3));
  const status = indicator?.status || indicator?.riskLevel;
  if (status === "watch" || status === "elevated" || status === "high") return 78;
  if (status === "neutral") return 52;
  return 28;
};

const macroFactorPressureLabel = (score) => {
  if (!Number.isFinite(score)) return "待判断";
  if (score >= 75) return "高压力";
  if (score >= 60) return "偏高";
  if (score >= 35) return "中性";
  return "低压力";
};

const macroFactorScoreClass = (score) => {
  if (!Number.isFinite(score)) return "is-neutral";
  if (score >= 65) return "is-watch";
  if (score >= 35) return "is-neutral";
  return "is-positive";
};

const macroFactorNarrative = (indicator) => {
  const pieces = [
    indicator.impact || indicator.category || "市场环境",
    indicator.asOf ? `更新 ${formatDisplayDate(indicator.asOf)}` : "",
    indicator.change && indicator.change !== "变化待更新" ? indicatorChangeMetaLabel(indicator.change) : "",
  ].filter(Boolean);
  return pieces.join(" · ") || "等待更多历史数据";
};

const macroFactorDrivers = (rows) =>
  [...rows]
    .map((indicator) => ({ ...indicator, factorScore: Math.round(macroFactorScore(indicator)) }))
    .sort((a, b) => b.factorScore - a.factorScore);

const macroDriverLabel = (rows, keys) =>
  keys
    .map((key) => rows.find((row) => normalizeMacroIndicatorKey(row) === key))
    .filter(Boolean)
    .map((row) => `${row.name}${row.level ? ` ${row.level}` : ""}`)
    .join(" / ") || "等待因子";

const macroAssetImpactRows = (rows, score) => {
  const pressureText = rows.map((row) => `${normalizeMacroIndicatorKey(row)}:${row.status || row.riskLevel || ""}`).join(" ");
  const rateHigh = /dgs10:watch|dgs10:elevated|dgs30:watch|dgs30:elevated/.test(pressureText);
  const usdHigh = /dtwexbgs:watch|dtwexbgs:elevated/.test(pressureText);
  const oilHigh = /dcoilwtico:watch|dcoilwtico:elevated/.test(pressureText);
  const cpiHigh = /cpiaucsl:watch|cpiaucsl:elevated/.test(pressureText);
  const vixHigh = /vixcls:watch|vixcls:elevated/.test(pressureText);
  return [
    { asset: "SPY / QQQ", stateLabel: score >= 65 || vixHigh ? "承压观察" : "环境可跟踪", driver: macroDriverLabel(rows, ["vixcls", "dgs10"]), note: rateHigh ? "利率是关键变量，先看指数趋势是否能守住。" : "先看趋势是否延续，再回到强弱榜筛选。", stateClass: score >= 65 || vixHigh ? "is-watch" : "is-positive" },
    { asset: "七姐妹 / 成长股", stateLabel: rateHigh || cpiHigh ? "估值压力" : "主线仍可观察", driver: macroDriverLabel(rows, ["dgs10", "cpiaucsl"]), note: "高估值股票重点看10Y、CPI和成交额确认。", stateClass: rateHigh || cpiHigh ? "is-watch" : "is-positive" },
    { asset: "黄金 / 贵金属", stateLabel: usdHigh || rateHigh ? "需要确认" : "避险弹性", driver: macroDriverLabel(rows, ["dtwexbgs", "dgs10"]), note: "美元和实际利率决定节奏，避免只看避险叙事。", stateClass: usdHigh || rateHigh ? "is-neutral" : "is-positive" },
    { asset: "能源 / 原油链", stateLabel: oilHigh ? "热度升温" : "中性观察", driver: macroDriverLabel(rows, ["dcoilwtico", "cpiaucsl"]), note: "油价影响通胀和利润预期，同时看能源板块资金。", stateClass: oilHigh ? "is-watch" : "is-neutral" },
    { asset: "小盘高波动", stateLabel: score >= 60 || vixHigh ? "降低频率" : "精选观察", driver: macroDriverLabel(rows, ["vixcls"]), note: "先看流动性、回撤和是否有明确事件支撑。", stateClass: score >= 60 || vixHigh ? "is-watch" : "is-positive" },
  ];
};

const renderMacroMonitor = () => {
  const chart = document.querySelector("#macroCompositeChart");
  if (!chart) return;
  const points = macroMonitorCompositePoints();
  const lastScore = points.length ? Math.round(points.at(-1).value) : null;
  const macroRows = macroPressureRows(state.marketTemperature?.indicators || []);
  const factorDrivers = macroFactorDrivers(macroRows);
  const topDrivers = factorDrivers.slice(0, 3);
  const band = macroPressureBand(lastScore);
  setText("#macroCompositeScore", Number.isFinite(lastScore) ? `${lastScore}` : "--");
  setText("#macroCompositeBand", Number.isFinite(lastScore) ? `${band.label} · ${lastScore}/100` : band.label);
  setText("#macroCompositeVerdict", macroMonitorVerdict(lastScore));
  const bandNode = document.querySelector("#macroCompositeBand");
  if (bandNode) {
    bandNode.classList.remove("is-positive", "is-neutral", "is-watch");
    bandNode.classList.add(band.className);
  }
  setText("#riskDriverValue", topDrivers.length ? topDrivers.map((item) => item.name).join(" / ") : "等待数据");
  setText(
    "#riskDriverNote",
    topDrivers.length
      ? `${topDrivers.map((item) => `${item.name}${item.level ? `(${item.level})` : ""}`).join("、")} 是当前最需要盯住的变量。`
      : "显示当前最需要盯住的宏观变量。",
  );
  setText(
    "#macroMonitorSummary",
    points.length
      ? `压力指数处于${band.label}，由 VIX、10Y、美元、原油和 CPI 近似合成；数值越高代表宏观扰动越强。`
      : "读取宏观历史数据后，会把利率、美元、油价、通胀和波动率合成一张压力图。",
  );
  chart.innerHTML = macroMonitorSvg(points);

  const factorBoard = document.querySelector("#macroFactorBoard");
  if (factorBoard) {
    factorBoard.innerHTML = macroRows.length
      ? `
        <div class="macro-factor-header">
          <span>因子</span>
          <span>压力位置</span>
          <span>分数</span>
          <span>当前读数</span>
        </div>
        ${factorDrivers.map((indicator) => {
          const score = Math.max(0, Math.min(100, indicator.factorScore));
          return `
            <div class="macro-factor-row ${macroFactorScoreClass(score)}">
              <b>${escapeHtml(indicator.name || "宏观因子")}<span>${escapeHtml(macroFactorNarrative(indicator))}</span></b>
              <i><em style="width: ${score}%"></em></i>
              <strong>${escapeHtml(`${score}`)}<span>${escapeHtml(macroFactorPressureLabel(score))}</span></strong>
              <small>${escapeHtml(indicator.value || "--")} / ${escapeHtml(indicatorChangeMetaLabel(indicator.change))}</small>
            </div>
          `;
        }).join("")}
      `
      : '<div><b>等待数据</b><i><em style="width: 0%"></em></i><strong>--</strong></div>';
  }

  const impact = document.querySelector("#macroAssetImpact");
  if (impact) {
    impact.innerHTML = macroAssetImpactRows(macroRows, Number(lastScore)).map(({ asset, stateLabel, driver, note, stateClass }) => `
      <div class="macro-asset-row ${escapeHtml(stateClass)}">
        <b>${escapeHtml(asset)}</b>
        <strong>${escapeHtml(stateLabel)}</strong>
        <span>${escapeHtml(driver)}</span>
        <em>${escapeHtml(note)}</em>
      </div>
    `).join("");
  }
};

const parseMacroSeriesNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null || value === "") return null;
  const parsed = parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeMacroSeriesItems = (payload) => {
  const raw = Array.isArray(payload?.series)
    ? payload.series
    : Array.isArray(payload?.indicators)
      ? payload.indicators
      : Array.isArray(payload)
        ? payload
        : payload && typeof payload === "object"
          ? Object.entries(payload)
              .filter(([key, value]) => value && typeof value === "object" && (Array.isArray(value.points) || Array.isArray(value.data) || Array.isArray(value.series)))
              .map(([key, value]) => ({ key, ...value }))
          : [];

  return raw
    .map((item) => {
      const rawKey = String(item.key || item.id || item.sourceId || item.symbol || "").toLowerCase();
      const key = rawKey === "vix" ? "vixcls" : rawKey;
      const points = (item.points || item.data || item.series || [])
        .map((point) => ({
          date: point.date || point.t || point[0],
          value: parseMacroSeriesNumber(point.value ?? point.close ?? point.y ?? point[1]),
        }))
        .filter((point) => point.date && Number.isFinite(point.value))
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      return {
        key,
        name: item.name || item.label || macroSeriesFallbackNames[key] || key.toUpperCase(),
        unit: item.unit || "",
        status: item.status || "neutral",
        level: item.level || "",
        asOf: item.asOf || item.date || item.updatedAt,
        impact: item.impact || "",
        conclusion: item.currentConclusion || item.conclusion || item.summary || "用于观察当前水平相对历史的位置。",
        currentValue: item.current ?? item.currentValue ?? item.latestValue ?? item.value ?? points.at(-1)?.value,
        percentile: item.percentiles?.fiveYear ?? item.percentile5y ?? item.fiveYearPercentile ?? item.percentile ?? item.rankPercentile,
        refs: item.bands || item.refs || item.referenceLines || {
          p30: item.p30,
          median: item.median,
          p70: item.p70,
        },
        points,
      };
    })
    .filter((item) => item.key && item.points.length);
};

const macroPressureSparkline = (indicator) => {
  const key = normalizeMacroIndicatorKey(indicator);
  const item = normalizeMacroSeriesItems(state.macroSeries).find((seriesItem) => seriesItem.key === key);
  const points = item?.points?.slice(-64) || [];
  if (points.length < 2) return "";
  const values = points.map((point) => point.value).filter(Number.isFinite);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const pad = 3;
  const width = 180;
  const height = 48;
  const span = maxValue - minValue || 1;
  const path = points
    .map((point, index) => {
      const x = pad + ((width - pad * 2) * index) / Math.max(1, points.length - 1);
      const y = pad + (1 - (point.value - minValue) / span) * (height - pad * 2);
      return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const area = `${path} L${width - pad} ${height - pad} L${pad} ${height - pad} Z`;
  const lastPoint = points.at(-1);
  const lastX = width - pad;
  const lastY = pad + (1 - (lastPoint.value - minValue) / span) * (height - pad * 2);
  const first = points[0].value;
  const last = points.at(-1).value;
  const change = last - first;
  const direction = change >= 0 ? "is-up" : "is-down";
  const label = change >= 0 ? "近期上行" : "近期回落";
  return `
    <div class="macro-pressure-spark ${direction}">
      <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
        <path class="macro-pressure-spark-area" d="${area}"></path>
        <path d="${path}"></path>
        <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.8"></circle>
      </svg>
      <span>${label}</span>
    </div>
  `;
};

const macroSeriesPointPath = (points, width, height, pad, min, max) => {
  const span = max - min || 1;
  const xStep = points.length > 1 ? (width - pad.left - pad.right) / (points.length - 1) : 0;
  return points
    .map((point, index) => {
      const x = pad.left + index * xStep;
      const y = pad.top + (1 - (point.value - min) / span) * (height - pad.top - pad.bottom);
      return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
};

const macroSeriesPathFromGeometry = (points, geometry, min, max) => {
  const span = max - min || 1;
  const xStep = points.length > 1 ? geometry.width / (points.length - 1) : 0;
  return points
    .map((point, index) => {
      const x = geometry.x + index * xStep;
      const y = geometry.y + (1 - (point.value - min) / span) * geometry.height;
      return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
};

const macroSeriesPointPosition = (point, index, count, width, height, pad, min, max) => {
  const span = max - min || 1;
  const xStep = count > 1 ? (width - pad.left - pad.right) / (count - 1) : 0;
  return {
    x: pad.left + index * xStep,
    y: pad.top + (1 - (point.value - min) / span) * (height - pad.top - pad.bottom),
  };
};

const macroSeriesPositionFromGeometry = (point, index, count, geometry, min, max) => {
  const span = max - min || 1;
  const xStep = count > 1 ? geometry.width / (count - 1) : 0;
  return {
    x: geometry.x + index * xStep,
    y: geometry.y + (1 - (point.value - min) / span) * geometry.height,
  };
};

const macroSeriesYFromValue = (value, geometry, min, max) => geometry.y + (1 - (value - min) / (max - min || 1)) * geometry.height;

const macroSeriesReferenceLine = (label, value, min, max, width, height, pad) => {
  const number = parseMacroSeriesNumber(value);
  if (!Number.isFinite(number)) return "";
  const y = pad.top + (1 - (number - min) / (max - min || 1)) * (height - pad.top - pad.bottom);
  if (y < pad.top - 1 || y > height - pad.bottom + 1) return "";
  return `
    <g class="macro-series-ref">
      <line x1="${pad.left}" x2="${width - pad.right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"></line>
      <text x="${width - pad.right - 4}" y="${(y - 6).toFixed(1)}">${escapeHtml(label)}</text>
    </g>
  `;
};

const formatMacroSeriesValue = (value, unit = "") => {
  const number = parseMacroSeriesNumber(value);
  if (!Number.isFinite(number)) return value == null || value === "" ? "--" : String(value);
  const decimals = Math.abs(number) >= 100 ? 1 : 2;
  if (unit === "$") return `$${number.toFixed(decimals)}`;
  if (unit === "%") return `${number.toFixed(decimals)}%`;
  return number.toFixed(decimals);
};

const formatMacroSeriesAxisValue = (value, unit = "") => {
  const number = parseMacroSeriesNumber(value);
  if (!Number.isFinite(number)) return "--";
  const decimals = Math.abs(number) >= 100 ? 0 : Math.abs(number) >= 10 ? 1 : 2;
  const formatted = number.toFixed(decimals);
  if (unit === "%") return `${formatted}%`;
  if (unit === "$") return formatted;
  return formatted;
};

const formatMacroSeriesPercentile = (value) => {
  const number = parseMacroSeriesNumber(value);
  if (!Number.isFinite(number)) return "--";
  return `${Math.round(Math.max(0, Math.min(100, number)))}%`;
};

const macroSeriesDisplayUnit = (item) => (item.key === "vixcls" || item.key === "dtwexbgs" ? "" : item.unit || "");

const macroSeriesUnitLabel = (unit) => {
  if (unit === "%") return "百分比";
  if (unit === "$") return "美元";
  return unit || "指数点";
};

const macroSeriesTickValues = (min, max, count = 5) => {
  const span = max - min || 1;
  return Array.from({ length: count }, (_, index) => min + (span * index) / (count - 1)).reverse();
};

const macroSeriesDateTicks = (points, geometry) => {
  if (!points.length) return "";
  const tickCount = state.macroSeriesRange === "1y" ? 3 : 4;
  const indexes = Array.from({ length: tickCount }, (_, index) =>
    Math.round((index * (points.length - 1)) / Math.max(1, tickCount - 1)),
  );
  const uniqueIndexes = [...new Set(indexes)];
  return uniqueIndexes
    .map((index) => {
      const point = points[index];
      const x = geometry.x + (points.length > 1 ? (geometry.width * index) / (points.length - 1) : 0);
      return `<text class="macro-series-x-label" x="${x.toFixed(1)}" y="${geometry.y + geometry.height + 34}" text-anchor="${index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}">${escapeHtml(formatDisplayDate(point.date).slice(0, 7))}</text>`;
    })
    .join("");
};

const macroSeriesReferenceMarkers = (refs, geometry, min, max, unit) => {
  const markers = [
    ["70%分位", refs.p70],
    ["中位值", refs.median],
    ["30%分位", refs.p30],
  ];
  return markers
    .map(([label, rawValue]) => {
      const value = parseMacroSeriesNumber(rawValue);
      if (!Number.isFinite(value)) return "";
      const y = macroSeriesYFromValue(value, geometry, min, max);
      if (y < geometry.y - 1 || y > geometry.y + geometry.height + 1) return "";
      return `
        <g class="macro-series-ref">
          <line x1="${geometry.x}" x2="${geometry.x + geometry.width}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"></line>
          <text class="macro-series-ref-label" x="${geometry.labelX}" y="${(y + 4).toFixed(1)}">${escapeHtml(label)} ${escapeHtml(formatMacroSeriesAxisValue(value, unit))}</text>
        </g>
      `;
    })
    .join("");
};

const macroSeriesYAxis = (ticks, geometry, unit) =>
  ticks
    .map((value) => {
      const y = macroSeriesYFromValue(value, geometry, ticks.at(-1), ticks[0]);
      return `
        <g class="macro-series-y-tick">
          <line x1="${geometry.x}" x2="${geometry.x + geometry.width}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"></line>
          <text x="${geometry.axisX}" y="${(y + 4).toFixed(1)}">${escapeHtml(formatMacroSeriesAxisValue(value, unit))}</text>
        </g>
      `;
    })
    .join("");

const macroSeriesCalloutY = (endY, refYs, geometry) => {
  const boxHeight = 58;
  const clamp = (value) => Math.max(geometry.y + 8, Math.min(geometry.y + geometry.height - boxHeight - 8, value));
  const bottomSlot = clamp(geometry.y + geometry.height - boxHeight - 8);
  const topSlot = clamp(geometry.y + 12);
  const endSlot = clamp(endY - boxHeight / 2);
  const collides = (candidate) => refYs.some((y) => Math.abs(y - (candidate + boxHeight / 2)) < 34);
  if (!collides(endSlot)) return endSlot;
  return endY > geometry.y + geometry.height / 2 ? topSlot : bottomSlot;
};

const renderMacroSeriesCard = (item) => {
  const years = macroSeriesRangeYears();
  const latestDate = item.points.at(-1) ? new Date(item.points.at(-1).date) : null;
  const cutoff = latestDate ? new Date(latestDate) : null;
  if (cutoff) cutoff.setFullYear(cutoff.getFullYear() - years);
  const visiblePoints = cutoff ? item.points.filter((point) => new Date(point.date) >= cutoff) : item.points;
  const points = visiblePoints.length >= 2 ? visiblePoints : item.points.slice(-Math.min(item.points.length, 260));
  const refs = item.refs || {};
  const refValues = [refs.p30, refs.median, refs.p70].map(parseMacroSeriesNumber).filter(Number.isFinite);
  const values = [...points.map((point) => point.value), ...refValues];
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const padding = (maxValue - minValue || Math.abs(maxValue) || 1) * 0.08;
  const min = minValue - padding;
  const max = maxValue + padding;
  const width = 1040;
  const height = 420;
  const geometry = { x: 62, y: 42, width: 780, height: 292, axisX: 38, labelX: 872 };
  const linePath = macroSeriesPathFromGeometry(points, geometry, min, max);
  const areaPath = `${linePath} L${geometry.x + geometry.width} ${geometry.y + geometry.height} L${geometry.x} ${geometry.y + geometry.height} Z`;
  const start = points[0];
  const end = points.at(-1);
  const endPosition = macroSeriesPositionFromGeometry(end, points.length - 1, points.length, geometry, min, max);
  const tone = macroSeriesTone(item);
  const conclusion = macroSeriesConclusionLabel(item);
  const displayUnit = macroSeriesDisplayUnit(item);
  const ticks = macroSeriesTickValues(min, max, 5);
  const refYs = [refs.p30, refs.median, refs.p70]
    .map(parseMacroSeriesNumber)
    .filter(Number.isFinite)
    .map((value) => macroSeriesYFromValue(value, geometry, min, max));
  const calloutY = macroSeriesCalloutY(endPosition.y, refYs, geometry);
  const currentValue = formatMacroSeriesValue(item.currentValue, displayUnit);
  const currentPercentile = formatMacroSeriesPercentile(item.percentile);
  const clipId = `macro-series-clip-${item.key}-${state.macroSeriesRange}`;

  return `
    <article class="macro-series-card ${tone}">
      <div class="macro-series-info">
        <span>${escapeHtml(item.category || item.impact || "宏观指标")}</span>
        <h3>${escapeHtml(item.name)}</h3>
        <div class="macro-series-reading">
          <strong>${escapeHtml(currentValue)}</strong>
          <em>${escapeHtml(currentPercentile)}分位</em>
        </div>
        <div class="macro-series-verdict">
          <span>当前位置</span>
          <strong>${escapeHtml(conclusion)}</strong>
        </div>
        <p>${escapeHtml(macroSeriesPlainExplanations[item.key] || item.conclusion)}</p>
        <div class="macro-series-metrics">
          <div>
            <span>样本区间</span>
            <strong>${escapeHtml(formatDisplayDate(start?.date).slice(0, 7))} 至 ${escapeHtml(formatDisplayDate(end?.date).slice(0, 7))}</strong>
          </div>
          <div>
            <span>数据单位</span>
            <strong>${escapeHtml(macroSeriesUnitLabel(displayUnit))}</strong>
          </div>
        </div>
        <div class="macro-series-meta">
          <b>${escapeHtml(item.impact || "市场背景")}</b>
          <em>更新至 ${escapeHtml(formatDisplayDate(item.asOf || end?.date))}</em>
        </div>
      </div>
      <div class="macro-series-visual">
        <div class="macro-series-chart-head">
          <div>
            <strong>${escapeHtml(item.name)}走势</strong>
            <span>${escapeHtml(formatDisplayDate(start?.date))} 至 ${escapeHtml(formatDisplayDate(end?.date))}</span>
          </div>
          <p><i></i>走势 <b></b>分位参考</p>
        </div>
        <svg class="macro-series-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(item.name)}历史走势">
          <defs>
            <clipPath id="${clipId}">
              <rect x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" rx="0"></rect>
            </clipPath>
          </defs>
          <rect class="macro-series-plot-bg" x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}"></rect>
          ${macroSeriesYAxis(ticks, geometry, displayUnit)}
          ${macroSeriesReferenceMarkers(refs, geometry, min, max, displayUnit)}
          <g clip-path="url(#${clipId})">
            <path class="macro-series-area" d="${areaPath}"></path>
            <path class="macro-series-line" d="${linePath}"></path>
          </g>
          <line class="macro-series-current-guide" x1="${endPosition.x.toFixed(1)}" x2="${geometry.labelX - 12}" y1="${endPosition.y.toFixed(1)}" y2="${(calloutY + 29).toFixed(1)}"></line>
          <circle class="macro-series-current-dot" cx="${endPosition.x.toFixed(1)}" cy="${endPosition.y.toFixed(1)}" r="5.5"></circle>
          <g class="macro-series-current-callout" transform="translate(${geometry.labelX}, ${calloutY.toFixed(1)})">
            <rect width="138" height="66" rx="7"></rect>
            <text x="14" y="21">当前值</text>
            <text class="macro-series-current-value" x="14" y="44">${escapeHtml(currentValue)}</text>
            <text class="macro-series-current-date" x="14" y="58">${escapeHtml(formatDisplayDate(end.date))}</text>
          </g>
          ${macroSeriesDateTicks(points, geometry)}
        </svg>
        <div class="macro-series-foot">
          <span>分位线只用于观察当前位置。</span>
          <span>${escapeHtml(macroSeriesRangeLabel())}</span>
        </div>
      </div>
    </article>
  `;
};

const renderMacroSeries = (payload) => {
  const grid = document.querySelector("#macroSeriesGrid");
  if (!grid) return;
  state.macroSeries = payload;
  document.querySelectorAll("[data-macro-series-range]").forEach((button) => {
    const active = button.dataset.macroSeriesRange === state.macroSeriesRange;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  const items = normalizeMacroSeriesItems(payload)
    .sort((a, b) => macroSeriesOrder.indexOf(a.key) - macroSeriesOrder.indexOf(b.key))
    .filter((item) => macroSeriesOrder.includes(item.key));
  setText(
    "#macroSeriesSummary",
    items.length
      ? `${items.length} 个宏观指标，展示当前读数、历史位置和分位参考。`
      : "等待历史数据",
  );

  grid.innerHTML = items.length
    ? items.map(renderMacroSeriesCard).join("")
    : `
      <article class="macro-series-empty">
        <span>等待历史数据</span>
        <strong>指标走势生成后会显示在这里</strong>
        <p>页面会继续保持可用。</p>
      </article>
    `;
  renderMacroPressure(state.marketTemperature?.indicators || []);
  renderMacroMonitor();
};

const temperatureClassFromScore = (score) => {
  if (score >= 70) return "is-hot";
  if (score >= 50) return "is-warm";
  return "is-cool";
};

const readableTemperatureAction = (action, score) => {
  const text = String(action || "").trim();
  if (text) {
    const positionWord = ["仓", "位"].join("");
    const newPositionWord = ["新", "开", "仓"].join("");
    return text
      .replace(/优先观察/g, "重点查看")
      .replace(/提高观察频率/g, "扩大复盘覆盖")
      .replace(new RegExp(`降低${newPositionWord}权重`, "g"), "减少新增线索")
      .replace(new RegExp(newPositionWord, "g"), "新增线索")
      .replace(new RegExp(positionWord, "g"), "观察强度");
  }
  if (score >= 70) return "强势股与事件共振线索";
  if (score >= 50) return "价格和成交额确认更清楚的线索";
  return "低频复盘和风险确认";
};

const formatIndicatorValueWithUnit = (value, unit = "") => {
  if (value == null || value === "") return "--";
  const text = String(value).trim();
  if (!unit || text.includes(unit)) return text;
  if (unit === "$") return text.startsWith("$") ? text : `$${text}`;
  return `${text}${unit}`;
};

const formatIndicatorChange = (value, unit = "") => {
  if (value == null || value === "") return "变化待更新";
  let text = String(value).trim().replace(/^\+\+/, "+").replace(/^--/, "-");
  if (text === "--") return "变化待更新";
  if (/^\$\+/.test(text)) text = `+$${text.slice(2)}`;
  if (/^\$-/.test(text)) text = `-$${text.slice(2)}`;
  if (unit === "$" && !text.includes("$")) {
    const sign = text.startsWith("-") ? "-" : "+";
    const numeric = text.replace(/^[+-]/, "");
    return `${sign}$${numeric}`;
  }
  if (unit && unit !== "$" && !text.includes(unit)) text = `${text}${unit}`;
  if (/^[+-]/.test(text)) return text;
  const number = Number(text.replace(/[$,%]/g, ""));
  if (Number.isFinite(number) && number > 0) return `+${text}`;
  return text;
};

const indicatorChangeMetaLabel = (change) => {
  if (!change || change === "--" || change === "变化待更新") return "变化待更新";
  return `变化 ${change}`;
};

const indicatorChangeMetaClass = (change) => {
  const text = String(change || "");
  const value = Number(text.replace(/[$,%+\s]/g, ""));
  if (!Number.isFinite(value) || value === 0) return "is-flat";
  if (text.trim().startsWith("-") || value < 0) return "is-down";
  return "is-up";
};

const temperatureWatchPlan = (score, label, position) => {
  if (score >= 70) {
    return [
      ["先看大盘", "SPY 和 QQQ 不破短线趋势时，可以保留较高频率的观察节奏。", true],
      ["再看主线", "从强弱榜、七姐妹和股票事件里查看资金已经关注的股票。", true],
      ["控制高热度", `观察强度参考 ${position}，但单只股票仍要看确认，不把结论一次打满。`, false],
      ["留意失效条件", "如果 VIX 或利率快速走高，新增线索需要重新确认。", false],
    ];
  }
  if (score >= 50) {
    return [
      ["先看确认", "只有价格、成交额和事件理由同时站得住，才进入自选。", true],
      ["少看弱势", "下跌趋势和低流动性股票先放后面，只做低频复盘。", true],
      ["节奏分层", `观察强度参考 ${position}，其余留给回踩确认后的线索。`, false],
      ["等待环境改善", "温度重新进入友好区后，再提升复盘覆盖范围。", false],
    ];
  }
  return [
    ["控制波动暴露", "市场偏防守时，高波动股票和短线追涨线索先降级。", true],
    ["只看少数强者", "自选只保留基本面或价格表现非常强的候选。", false],
    ["降低试错", `观察强度参考 ${position}，以等待和复盘为主。`, false],
    ["等温度回升", "VIX、利率和信用压力缓和后，再扩大复盘范围。", false],
  ];
};

const normalizeTemperaturePayload = (payload) => {
  const sourceOverall = payload?.overall || payload?.status || {};
  const rawScore = Number(sourceOverall.score);
  const scoreFromPressure = payload?.status && !payload?.overall && Number.isFinite(rawScore)
    ? 100 - Math.max(0, Math.min(100, rawScore))
    : rawScore;
  const score = Number.isFinite(scoreFromPressure) ? Math.round(Math.max(0, Math.min(100, scoreFromPressure))) : 50;
  const rawLabel = sourceOverall.label || (score >= 70 ? "偏强" : score >= 50 ? "中性" : "防守观察");
  const label = rawLabel === "进攻" ? "偏积极" : rawLabel === "防守" ? "防守观察" : rawLabel;
  const summary =
    sourceOverall.summary ||
    sourceOverall.plainExplanation ||
    "市场温度数据暂时不可用，先按观察环境处理，避免因为缺少数据而做激进决定。";
  const action = readableTemperatureAction(sourceOverall.action || sourceOverall.positionAdvice, score);
  const indicators = Array.isArray(payload?.indicators)
    ? payload.indicators.map((indicator) => {
        const value = indicator.value ?? indicator.latestValue;
        const previous = indicator.previous ?? indicator.previousValue;
        const change = indicator.change;
        const riskLevel = indicator.status || indicator.riskLevel;
        const status = riskLevel === "low" ? "positive" : riskLevel === "elevated" || riskLevel === "high" ? "watch" : riskLevel || "neutral";
        return {
          key: indicator.key || indicator.id,
          name: indicator.name || indicator.id || "指标",
          value: formatIndicatorValueWithUnit(value, indicator.unit || ""),
          previous: formatIndicatorValueWithUnit(previous, indicator.unit || ""),
          change: formatIndicatorChange(change, indicator.unit || ""),
          status,
          level: indicator.level || indicator.riskLabel || "--",
          explain: indicator.explain || indicator.explanation || "",
          asOf: indicator.asOf || indicator.date,
        };
      })
    : [];
  const indicatorDates = indicators.map((indicator) => indicator.asOf || indicator.date).filter(Boolean);
  const latestIndicatorDate = indicatorDates.sort().at(-1);
  return {
    asOf: formatDisplayDate(payload?.asOf || latestIndicatorDate || payload?.generatedAt),
    overall: { score, label, summary, action },
    indicators,
  };
};

const renderMarketTemperature = (payload) => {
  state.marketTemperature = payload;
  const normalized = normalizeTemperaturePayload(payload);
  state.marketTemperature = { ...(payload || {}), ...normalized };
  const overall = normalized.overall || {};
  const score = Number.isFinite(Number(overall.score)) ? Math.max(0, Math.min(100, Number(overall.score))) : 50;
  const label = overall.label || "等待数据";
  const summary = overall.summary || "市场温度数据暂时不可用，先按观察环境处理，避免因为缺少数据而做激进决定。";
  const action = overall.action || "先观察，等数据更新";
  const className = temperatureClassFromScore(score);
  const position = score >= 70 ? "70%-85%" : score >= 50 ? "45%-65%" : "20%-40%";

  const readableConclusion =
    score >= 70
      ? "结论：市场环境偏友好，强势股和事件共振线索的复盘优先级更高。"
      : score >= 50
        ? "结论：市场环境中性，先保持观察，等价格和成交额确认。"
        : "结论：市场环境偏防守，高波动线索降级观察。";

  setText("#temperatureAsOf", normalized.asOf || "--");
  setText("#marketRegimeLabel", label);
  setText("#marketRegimeSummary", summary);
  setText("#dashboardTemperatureScore", String(score));
  setText("#dashboardTemperatureLabel", label);
  setText("#dashboardTemperatureCopy", summary);
  setText("#temperatureTitle", label === "等待数据" ? "等待温度数据" : `${score}分 · ${label}环境`);
  setText("#temperatureSummary", readableConclusion);
  setText("#temperatureAction", `观察重点：${action}`);
  setText("#temperatureScore", String(score));
  setText("#temperatureScoreLabel", `${label}环境。满分 100，分数越高，说明市场环境越偏积极。`);
  setText("#dashboardRiskBudget", position);
  setText("#dashboardRiskNote", summary);
  setText("#riskBudgetValue", position);
  setText("#riskBudgetNote", `当前观察强度参考 ${position}，其余留给确认后的线索。`);
  setText("#riskRegimeValue", label);
  setText("#riskRegimeNote", readableConclusion.replace(/^结论：/, ""));
  setText("#riskActionValue", action);
  setText("#riskActionNote", "先用温度判断复盘强度，再查看强弱榜和事件观察里的具体线索。");

  const needle = document.querySelector("#temperatureNeedle");
  if (needle) needle.style.left = `${score}%`;
  document.querySelectorAll(".temperature-hero, .temperature-mini").forEach((item) => {
    item.classList.remove("is-hot", "is-warm", "is-cool");
    item.classList.add(className);
  });

  const indicators = normalized.indicators;
  renderMacroPressure(indicators);
  const grid = document.querySelector("#riskSignalGrid");
  if (grid) {
    const macroRows = macroPressureRows(indicators);
    grid.innerHTML = macroRows.length
      ? macroAssetImpactRows(macroRows, score)
          .map(({ asset, stateLabel, driver, note, stateClass }) => `
            <tr class="${escapeHtml(stateClass)}">
              <td>${escapeHtml(asset)}</td>
              <td><strong>${escapeHtml(stateLabel)}</strong></td>
              <td>${escapeHtml(driver)}</td>
              <td>${escapeHtml(note)}</td>
            </tr>
          `)
          .join("")
      : '<tr><td colspan="4">温度数据生成前，页面保持可用，不影响其他工具。</td></tr>';
  }

  const ruleTimeline = document.querySelector("#riskRuleTimeline");
  if (ruleTimeline) {
    ruleTimeline.innerHTML = temperatureWatchPlan(score, label, position)
      .map(
        ([title, note, done], index) => `
          <div class="${done ? "is-done" : ""}">
            <span>${String(index + 1).padStart(2, "0")}</span>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(note)}</p>
          </div>
        `,
      )
      .join("");
  }
  renderDashboardFocus();
};

const getStrengthRows = () => {
  if (!state.strength || !Array.isArray(state.strength.rows)) return [];
  const query = state.strengthQuery.trim().toLowerCase();
  return state.strength.rows.filter((row) => {
    const matchesBucket = row.bucket === state.strengthBucket;
    const matchesQuery =
      !query ||
      row.symbol.toLowerCase().includes(query) ||
      row.name.toLowerCase().includes(query) ||
      row.label.includes(query) ||
      row.primaryFactor.includes(query) ||
      row.sectorProxy.includes(query);
    const matchesLabel = state.strengthLabelFilter === "all" || row.label === state.strengthLabelFilter;
    const matchesFactor = state.strengthFactorFilter === "all" || row.primaryFactor === state.strengthFactorFilter;
    return matchesBucket && matchesQuery && matchesLabel && matchesFactor;
  });
};

const scoreClass = (score) => {
  if (score >= 75) return "is-strong";
  if (score <= 35) return "is-weak";
  return "is-neutral";
};

const strengthStateLabel = (row) => {
  if (!row) return "--";
  if (row.bucket === "weakest") return "偏弱";
  if (row.bucket === "watchlist") return row.crowding && row.crowding.score >= 72 ? "偏热" : "观察";
  if (row.crowding && row.crowding.score >= 72) return "强但热";
  return "领先";
};

const crowdingLabel = (score) => {
  const value = Number(score) || 0;
  if (value >= 72) return "偏热，等分歧";
  if (value >= 52) return "热度上升";
  return "不算拥挤";
};

const breakoutLabel = (row) => {
  const score = Number(row && row.breakout && row.breakout.score) || 0;
  const distance = row && row.breakout ? row.breakout.distanceToHigh : "--";
  if (score >= 72) return `接近新高 · ${distance}`;
  if (score >= 52) return `趋势修复 · ${distance}`;
  return `尚未突破 · ${distance}`;
};

const renderStrengthFilterOptions = () => {
  if (!state.strength || !Array.isArray(state.strength.rows)) return;
  const labelSelect = document.querySelector("#strengthLabelFilter");
  const factorSelect = document.querySelector("#strengthFactorFilter");
  if (!labelSelect || !factorSelect) return;
  const labels = Array.from(new Set(state.strength.rows.map((row) => row.label))).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const factors = Array.from(new Set(state.strength.rows.map((row) => row.primaryFactor))).sort((a, b) => a.localeCompare(b, "zh-CN"));
  labelSelect.innerHTML = '<option value="all">全部标签</option>' + labels.map((label) => `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`).join("");
  factorSelect.innerHTML = '<option value="all">全部原因</option>' + factors.map((factor) => `<option value="${escapeHtml(factor)}">${escapeHtml(factor)}</option>`).join("");
};

const renderStrengthHero = (row) => {
  if (!row) return;
  setText("#strengthHeroSymbol", row.symbol);
  setText("#strengthHeroName", row.name);
  setText("#strengthHeroScore", strengthStateLabel(row));
  setText("#strengthHeroSpy", row.relative && row.relative.spy);
  setText("#strengthHeroQqq", row.relative && row.relative.qqq);
  setText("#strengthHeroSector", row.relative && row.relative.sector);
  setText("#strengthHeroCrowding", row.crowding ? crowdingLabel(row.crowding.score) : "--");
  const tags = document.querySelector("#strengthHeroTags");
  if (tags) {
    tags.innerHTML = `
      <span>${escapeHtml(row.label)}</span>
      <span>${escapeHtml(row.sectorProxy)}</span>
      <span>${escapeHtml(row.primaryFactor)}</span>
      <span>${escapeHtml(row.onBoard ? row.onBoard.label : "今日新上榜")}</span>
    `;
  }
};

const renderStrengthThemes = (themes) => {
  const grid = document.querySelector("#strengthThemeGrid");
  if (!grid) return;
  const rows = themes && Array.isArray(themes.leaders) ? themes.leaders.slice(0, 6) : [];
  setText("#strengthThemeSummary", themes && themes.summary ? "已整理主线" : "等待数据");
  if (!rows.length) {
    grid.innerHTML = "<article><span>等待数据</span><strong>--</strong><p>刷新后显示最强方向。</p></article>";
    return;
  }
  grid.innerHTML = rows
    .map(
      (item) => `
        <article class="${item.status === "热度偏高" ? "is-hot" : item.status === "整体落后" ? "is-weak" : ""}">
          <span>${escapeHtml(item.status)}</span>
          <strong>${escapeHtml(item.name)}</strong>
          <p>${escapeHtml(item.action)}</p>
          <div>
            <b>${escapeHtml(item.symbols)}</b>
            <em>相对大盘 ${escapeHtml(item.vsMarket)} · 强势 ${escapeHtml(item.strongCount)} 只</em>
          </div>
        </article>
      `,
    )
    .join("");
};

const renderStrengthPremiumSections = () => {
  const container = document.querySelector("#strengthPremiumThemes");
  const action = document.querySelector("#strengthPremiumAction");
  const row = document.querySelector(".theme-paid-row");
  if (!container) return;

  const themes = (state.strength && state.strength.themes) || {};
  const risk = Array.isArray(themes.risk) ? themes.risk.slice(0, 2) : [];
  const hot = Array.isArray(themes.hot) ? themes.hot.slice(0, 2) : [];
  const cards = [
    ...risk.map((item) => ({ ...item, type: "is-risk", kicker: "少碰方向" })),
    ...hot.map((item) => ({ ...item, type: "is-hot", kicker: "过热方向" })),
  ].slice(0, 4);

  container.innerHTML = cards.length
    ? cards
        .map(
          (item) => `
            <article class="${escapeHtml(item.type)}">
              <span>${escapeHtml(item.kicker)}</span>
              <strong>${escapeHtml(item.name)}</strong>
              <p>${escapeHtml(item.action)} ${escapeHtml(item.symbols ? `代表：${item.symbols}` : "")}</p>
            </article>
          `,
        )
        .join("")
    : `
      <article>
        <span>当前扩展</span>
        <strong>当前没有明显需要额外提醒的方向</strong>
        <p>先按上方主线和名单继续观察。</p>
      </article>
    `;
  if (action) {
    action.textContent = cards.length ? "今日已更新" : "暂无额外提醒";
    action.disabled = true;
  }
  if (row) row.classList.add("is-ready");
};

const renderStrengthInsightGrid = () => {
  const grid = document.querySelector("#strengthInsightGrid");
  if (!grid || !state.strength || !Array.isArray(state.strength.rows)) return;
  const rows = state.strength.rows;
  const summary = state.strength.summary || {};
  const strongest = rows.find((row) => row.bucket === "strongest") || rows[0];
  const weakest = rows.find((row) => row.bucket === "weakest");
  const watch = rows.find((row) => row.bucket === "watchlist");
  const theme = state.strength.themes?.leaders?.[0];
  grid.innerHTML = `
    <article>
      <span>当前怎么看</span>
      <strong>${escapeHtml(summary.leader ? `先看 ${summary.leader}` : "先看相对强弱")}</strong>
      <p>${escapeHtml(strongest ? `${strongest.symbol} 当前${strongest.label}，相对大盘 ${strongest.relative?.spy || "--"}。` : "优先从强于大盘、强于行业的股票里找可复盘标的。")}</p>
    </article>
    <article>
      <span>为什么入选</span>
      <strong>${escapeHtml(strongest?.primaryFactor || "价格和成交确认")}</strong>
      <p>${escapeHtml(strongest?.action || "短线太热时不急着下结论，等待分歧或回踩后再复盘。")}</p>
    </article>
    <article>
      <span>风险提醒</span>
      <strong>${escapeHtml(weakest ? `少看 ${weakest.symbol}` : "避开明显落后")}</strong>
      <p>${escapeHtml(weakest?.action || "走势持续落后的股票，先从自选里降级。")}</p>
    </article>
    <article>
      <span>下一步</span>
      <strong>${escapeHtml(theme ? `主线：${theme.name}` : "加入自选")}</strong>
      <p>${escapeHtml(watch ? `${watch.symbol} 更适合等回踩确认；自选只放熟悉、流动性好的股票。` : "只把熟悉、流动性好的股票加入自选，再等确认。")}</p>
    </article>
  `;
};

const renderStrengthScanner = (strength) => {
  if (!strength) return;
  state.strength = strength;
  const summary = strength.summary || {};
  const universe = strength.universe || {};
  const strongest = strength.rows.find((row) => row.bucket === "strongest");

  setText("#strengthAsOf", strength.asOf);
  setText("#strengthUniverse", universe.total == null ? "--" : `${universe.total}只`);
  setText("#strengthUniverseNote", universe.minAdv ? `已过滤低流动性和高噪音股票，最低20日成交额 ${universe.minAdv}。` : undefined);
  setText("#strengthLeader", summary.leader || "--");
  setText("#strengthLeaderNote", strength.benchmarks ? `近20个交易日：大盘 ${strength.benchmarks.spy20d}，纳指 ${strength.benchmarks.qqq20d}。` : undefined);
  setText("#strengthWeakest", summary.weakest || "--");
  setText("#strengthCrowdingCount", summary.hotCrowdingCount == null ? "--" : `${summary.hotCrowdingCount}只`);
  renderStrengthHero(strongest);
  renderStrengthThemes(strength.themes);
  renderStrengthFilterOptions();
  renderStrengthInsightGrid();

  const review = state.strengthReview || strength.review || {};
  const reviewList = document.querySelector("#strengthReviewList");
  const reviewItems = [...(review.buckets || []), ...(review.labels || []), ...(review.factors || [])].slice(0, 7);
  const reviewCard = document.querySelector('[data-module="strength-review"]');
  if (reviewCard) {
    reviewCard.classList.toggle("is-hidden", !reviewItems.length);
  }
  setText(
    "#strengthReviewSummary",
    reviewItems.length ? "这些是历史记录里更需要继续跟踪的结论。" : "",
  );
  if (reviewList) {
    reviewList.innerHTML = reviewItems.length
      ? reviewItems
          .map(
            (item) => `
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <span>${escapeHtml(item.hitRate || item.winRate ? `历史正向占比 ${item.hitRate || item.winRate}` : item.horizon || "入选原因")} · ${escapeHtml(item.count || item.sample)} 次 · 相对SPY ${escapeHtml(item.vsSpy || item.avgExcess)}</span>
              </div>
            `,
          )
          .join("")
      : "";
  }

  const methodList = document.querySelector("#strengthMethodList");
  if (methodList) {
    methodList.innerHTML = `
      <div>先看“重点观察”前 10，只挑你熟悉、流动性好的股票继续研究。</div>
      <div>看到“强但偏热”，默认等回踩或分歧，不把它当成立刻行动信号。</div>
      <div>“风险回避”里的股票，除非有新的基本面变化，否则只做低频复盘。</div>
    `;
  }
  renderStrengthPremiumSections();
  renderStrengthTable();
  renderDashboardFocus();
};

const renderStrengthTable = () => {
  const rows = getStrengthRows();
  const body = document.querySelector("#strengthBody");
  const summary = document.querySelector("#strengthResultSummary");
  if (!body || !summary) return;
  const bucketLabel = state.strengthBucket === "strongest" ? "重点观察" : state.strengthBucket === "weakest" ? "风险回避" : "等回踩";
  summary.textContent = `${bucketLabel} · ${rows.length} 只股票`;

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="9">没有符合条件的股票</td></tr>';
    return;
  }

  body.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td class="rank-cell">${row.rank}</td>
          <td class="on-board-cell">
            <strong>${escapeHtml(row.onBoard ? row.onBoard.label : "今日新上榜")}</strong>
            <span>${escapeHtml(row.onBoard && row.onBoard.firstSeen ? `本轮 ${row.onBoard.firstSeen}` : "")}</span>
          </td>
          <td class="symbol-cell">
            <strong>${escapeHtml(row.symbol)}</strong>
            <span>${escapeHtml(row.name)}</span>
            <div class="inline-action-row">
              <button class="inline-stock-link" type="button" data-stock-open="${escapeHtml(row.symbol)}">完整画像</button>
              <button class="inline-stock-link" type="button" data-watchlist-toggle="${escapeHtml(row.symbol)}" data-watchlist-source="强弱榜">${isInWatchlist(row.symbol) ? "已加入" : "加入自选"}</button>
            </div>
          </td>
          <td class="strength-action-cell">
            <strong>${escapeHtml(row.label)}</strong>
            <span>${escapeHtml(row.action)}</span>
          </td>
          <td class="strength-mini-metrics">
            <span>大盘 ${escapeHtml(row.relative.spy)}</span>
            <span>纳指 ${escapeHtml(row.relative.qqq)}</span>
            <span>行业 ${escapeHtml(row.relative.sector)}</span>
          </td>
          <td class="strength-mini-metrics">
            <span>1D ${escapeHtml(row.periods["1d"])}</span>
            <span>5D ${escapeHtml(row.periods["5d"])}</span>
            <span>20D ${escapeHtml(row.periods["20d"])}</span>
            <span>63D ${escapeHtml(row.periods["63d"])}</span>
          </td>
          <td class="strength-mini-metrics">
            <strong>${escapeHtml(breakoutLabel(row))}</strong>
            <span>${escapeHtml(row.primaryFactor)}</span>
          </td>
          <td class="strength-mini-metrics">
            <strong>${escapeHtml(crowdingLabel(row.crowding.score))}</strong>
            <span>成交额 ${escapeHtml(row.crowding.volumeRatio)}</span>
          </td>
          <td>${escapeHtml(row.liquidity)}</td>
        </tr>
      `,
    )
    .join("");
};

const getQualityBoard = () => {
  const board = state.earningsQuality &&
    state.earningsQuality.boards &&
    state.earningsQuality.boards[state.qualityBoard]
    ? state.earningsQuality.boards[state.qualityBoard]
    : { title: "--", subtitle: "--", rows: [] };
  if (state.qualityBoard === "quality") {
    return { ...board, title: "财报观察", subtitle: "按财报质量、预期上修、近期走势和流动性排序。" };
  }
  if (state.qualityBoard === "confluence") {
    return { ...board, title: "机构也在看", subtitle: "财报改善后，再看分析师覆盖、目标价空间和价格确认。" };
  }
  return board;
};

const getQualityRows = () => {
  const board = getQualityBoard();
  const query = state.qualityQuery.trim().toLowerCase();
  const rows = Array.isArray(board.rows) ? board.rows : [];
  if (!query) return rows;
  return rows.filter((row) => {
    const haystack = [
      row.ticker,
      row.name,
      row.companyName,
      row.userAngle,
      row.userReason,
      row.userRisk,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
};

const qualityMetric = (label, value, className = "") => `
  <div class="${className}">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value == null ? "--" : value)}</strong>
  </div>
`;

const qualityRiskFlag = (row) => {
  const riskText = String(row?.userRisk || "");
  const return20d = Number(row?.return20dPct);
  return /短线|涨幅|高热度|波动|回撤|成交|流动性|谨慎|风险/.test(riskText) || (Number.isFinite(return20d) && return20d >= 30);
};

const qualityRiskSummary = (row) => {
  const return20d = Number(row?.return20dPct);
  if (Number.isFinite(return20d) && return20d >= 50) return "短期涨幅很大";
  if (Number.isFinite(return20d) && return20d >= 30) return "短期涨幅偏大";
  const text = String(row?.userRisk || "").trim();
  if (!text || /暂无明显负面/.test(text)) return "暂无明显负面事件";
  if (/追高/.test(text)) return "追高风险";
  if (/流动性|成交/.test(text)) return "成交额需观察";
  if (/波动|回撤/.test(text)) return "波动需观察";
  return text.length > 18 ? `${text.slice(0, 18)}...` : text;
};

const qualityConclusion = (row) => {
  if (!row) return "暂无候选";
  const score = Number(row.score);
  if (qualityRiskFlag(row)) return "可观察，但先控制节奏";
  if (Number.isFinite(score) && score >= 3) return "复盘优先级高";
  if (Number.isFinite(score) && score >= 2) return "可以继续观察";
  return "先放入候选池";
};

const qualityRevisionText = (row) => {
  const eps = row?.epsRevisionPct == null ? "--" : formatSignedPct(row.epsRevisionPct);
  const revenue = row?.revenueRevisionPct == null ? "--" : formatSignedPct(row.revenueRevisionPct);
  const epsSurprise = row?.epsSurprisePct == null ? "--" : formatSignedPct(row.epsSurprisePct);
  return { main: `EPS ${eps}`, sub: `收入 ${revenue} / 超预期 ${epsSurprise}` };
};

const qualityPriceText = (row) => ({
  main: row?.return20dPct == null ? "--" : formatSignedPct(row.return20dPct),
  sub: `20日成交额 ${formatCompactMoney(row?.dollarVolume20d)}`,
  className: Number(row?.return20dPct) >= 0 ? "is-positive" : "is-negative",
});

const qualityInstitutionText = (row) => {
  const heat = row?.analystHeatScore == null ? "--" : `${Number(row.analystHeatScore).toFixed(1)}分`;
  const target = row?.avgPriceTargetUpsidePct == null ? "目标价待补" : `目标价空间 ${formatSignedPct(row.avgPriceTargetUpsidePct)}`;
  return {
    main: heat,
    sub: `${row?.firms30d == null ? "暂无机构覆盖" : `${row.firms30d}家机构`} / ${target}`,
  };
};

const qualityNextReview = (row) => {
  if (!row) return "有新候选后，先看财报、预期、股价和成交额是否同时确认。";
  if (qualityRiskFlag(row)) return "先看财报后价格是否站稳，成交额是否连续确认；如果快速回落，就降低观察频率。";
  if (Number(row.analystHeatScore) >= 70 || Number(row.firms30d) >= 5) return "继续看机构观点是否跟进，同时观察目标价空间和价格承接。";
  return "继续看下一份财报前的预期变化、成交额变化，以及股价是否保持相对强势。";
};

const qualityDetailPreview = (row) => {
  const ticker = normalizeStockSymbol(row?.ticker || row?.symbol);
  const market = findMarketRow(ticker);
  const day = getBoardRow("day", ticker);
  const week = getBoardRow("week", ticker);
  const month = getBoardRow("month", ticker);
  const volume = getBoardRow("volume", ticker);
  const strength = findStrengthRow(ticker);
  const eventRow = findEventRow(ticker);
  const signal = signalStateForSymbol(ticker);
  const sources = stockDataSources({ market, day, week, month, volume, strength, quality: row, eventRow, signal })
    .filter(([, active]) => active)
    .map(([label]) => label);
  return {
    sources: sources.length ? sources.join(" / ") : "财报线索",
    title: `${row?.userAngle || "财报观察"} · ${sources.length || 1}项依据`,
    note: row?.userReason || qualityNextReview(row),
  };
};

const renderQualityFocusGrid = (rows) => {
  const top = rows
    .map((row) => ({ row, priority: reviewPriorityForQualityRow(row) }))
    .sort((a, b) => b.priority.score - a.priority.score)[0]?.row || rows[0];
  const ticker = normalizeStockSymbol(top?.ticker || top?.symbol);
  const preview = top ? qualityDetailPreview(top) : null;
  const priority = top ? reviewPriorityForQualityRow(top) : null;
  const riskRows = rows.filter(qualityRiskFlag);
  setText("#qualityFocusLeader", top ? `${ticker} · ${top.userAngle || "财报观察"}` : "暂无候选");
  setText(
    "#qualityFocusLeaderNote",
    top ? `${top.companyName || top.name || ticker}：复盘分 ${priority.score}，${priority.reason}。` : "先看财报、预期和价格同时改善的股票。",
  );
  setText("#qualityFocusReason", top ? qualityConclusion(top) : "暂无理由");
  setText(
    "#qualityFocusReasonNote",
    top?.userReason || "这里会把财报、预期和价格变化翻译成容易理解的观察理由。",
  );
  setText("#qualityFocusRisk", rows.length ? `${riskRows.length} 只需谨慎` : "先看确认");
  setText(
    "#qualityFocusRiskNote",
    riskRows.length
      ? "有短线涨幅、波动或成交提醒的股票，先降低观察频率。"
      : "当前筛选下风险提醒较少，但仍要看价格和成交是否继续确认。",
  );
  setText("#qualityFocusDetail", preview ? preview.title : "依据汇总");
  setText(
    "#qualityFocusDetailNote",
    preview ? `详情页会汇总：${preview.sources}。` : "股票详情会把财报、行情、强弱和自选状态放在一起看。",
  );
};

const renderQualityDetail = (row) => {
  const panel = document.querySelector("#qualityDetailPanel");
  if (!panel) return;
  if (!row) {
    panel.innerHTML = `
      <div class="empty-detail">
        <strong>点击榜单股票查看详情</strong>
        <p>这里会集中显示上榜理由、财报日期、预期上调幅度、目标价空间和主要风险。</p>
      </div>
    `;
    return;
  }

  const heatLabel = row.analystHeatScore == null
    ? "暂无"
    : `${Number(row.analystHeatScore).toFixed(1)} 分`;
  const targetLabel = row.avgPriceTargetUpsidePct == null ? "--" : formatSignedPct(row.avgPriceTargetUpsidePct);
  const preview = qualityDetailPreview(row);
  const priority = reviewPriorityForQualityRow(row);
  panel.innerHTML = `
    <div class="quality-detail-head">
      <div>
        <span>${escapeHtml(row.userAngle || "财报后走强")}</span>
        <h2>${escapeHtml(row.ticker)}</h2>
        <p>${escapeHtml(row.companyName || row.name || "")}</p>
      </div>
      <div class="quality-head-actions">
        ${watchlistActionButton(row.ticker, "财报观察")}
        <button class="ghost-action" type="button" data-stock-open="${escapeHtml(row.ticker)}">完整画像</button>
      </div>
    </div>
    <div class="quality-score-block">
      <div>
        <span>复盘分</span>
        <strong>${escapeHtml(String(priority.score))}</strong>
      </div>
      <div>
        <span>财报分</span>
        <strong>${escapeHtml(row.score == null ? "--" : Number(row.score).toFixed(2))}</strong>
      </div>
    </div>
    <section class="quality-reason-box">
      <span>复盘分依据</span>
      <p>${escapeHtml(priority.reason)}</p>
    </section>
    <section class="quality-reason-box">
      <span>为什么上榜</span>
      <p>${escapeHtml(row.userReason || "--")}</p>
    </section>
    <section class="quality-risk-box">
      <span>主要风险</span>
      <p>${escapeHtml(row.userRisk || "--")}</p>
    </section>
    <section class="quality-reason-box">
      <span>交叉验证</span>
      <p>${escapeHtml(preview.sources)}</p>
    </section>
    <section class="quality-reason-box">
      <span>复盘动作</span>
      <p>${escapeHtml(qualityNextReview(row))}</p>
    </section>
    <div class="quality-detail-grid">
      ${qualityMetric("公司上调预期", `${row.guidanceUpCount || 0} 次`)}
      ${qualityMetric("财报超预期", `${row.earningsBeatCount || 0} 次`)}
      ${qualityMetric("每股收益预期上调", row.epsRevisionPct == null ? "--" : formatSignedPct(row.epsRevisionPct), "is-positive")}
      ${qualityMetric("收入预期上调", row.revenueRevisionPct == null ? "--" : formatSignedPct(row.revenueRevisionPct), "is-positive")}
      ${qualityMetric("每股收益超预期", row.epsSurprisePct == null ? "--" : formatSignedPct(row.epsSurprisePct), "is-positive")}
      ${qualityMetric("收入超预期", row.revenueSurprisePct == null ? "--" : formatSignedPct(row.revenueSurprisePct), "is-positive")}
      ${qualityMetric("20日表现", row.return20dPct == null ? "--" : formatSignedPct(row.return20dPct), Number(row.return20dPct) >= 0 ? "is-positive" : "is-negative")}
      ${qualityMetric("分析师目标价空间", targetLabel, Number(row.avgPriceTargetUpsidePct) >= 0 ? "is-positive" : "is-negative")}
      ${qualityMetric("分析师热度", heatLabel)}
      ${qualityMetric("覆盖机构", row.firms30d == null ? "--" : `${row.firms30d} 家`)}
      ${qualityMetric("20日成交额", formatCompactMoney(row.dollarVolume20d))}
      ${qualityMetric("财报日期", row.latestEarningsDate || "--")}
    </div>
  `;
};

const renderQualityInsightGrid = () => {
  const grid = document.querySelector("#qualityInsightGrid");
  if (!grid || !state.earningsQuality) return;
  const qualityRows = state.earningsQuality.boards?.quality?.rows || [];
  const confluenceRows = state.earningsQuality.boards?.confluence?.rows || [];
  const rows = qualityRows.slice(0, 80);
  const topRows = rows.slice(0, 8);
  const maxScore = Math.max(...topRows.map((row) => Number(row.score) || 0), 1);
  const total = Math.max(1, rows.length);
  const eventStats = [
    ["预期上修", rows.filter((row) => Number(row.guidanceUpCount) > 0).length],
    ["财报超预期", rows.filter((row) => Number(row.earningsBeatCount) > 0).length],
    ["机构覆盖", rows.filter((row) => Number(row.firms30d) > 0 || Number(row.analystHeatScore) > 0).length],
    ["短期涨幅大", rows.filter((row) => Number(row.return20dPct) >= 30).length],
  ];
  const returnBuckets = [
    ["30%以上", rows.filter((row) => Number(row.return20dPct) >= 30).length],
    ["10%-30%", rows.filter((row) => Number(row.return20dPct) >= 10 && Number(row.return20dPct) < 30).length],
    ["0%-10%", rows.filter((row) => Number(row.return20dPct) >= 0 && Number(row.return20dPct) < 10).length],
    ["回落", rows.filter((row) => Number(row.return20dPct) < 0).length],
  ];
  const confluenceTop = confluenceRows.slice(0, 5);
  grid.innerHTML = `
    <article class="quality-chart-card quality-score-chart">
      <div class="quality-chart-head">
        <span>复盘分 Top 8</span>
        <strong>${escapeHtml(topRows[0]?.ticker || "--")}</strong>
      </div>
      <div class="quality-bar-rank">
        ${topRows.map((row) => {
          const score = Number(row.score) || 0;
          return `
            <div>
              <b>${escapeHtml(row.ticker || "--")}</b>
              <i><em style="width:${Math.max(4, (score / maxScore) * 100).toFixed(1)}%"></em></i>
              <strong>${escapeHtml(score.toFixed(1))}</strong>
            </div>
          `;
        }).join("")}
      </div>
    </article>
    <article class="quality-chart-card">
      <div class="quality-chart-head">
        <span>线索构成</span>
        <strong>${escapeHtml(`${rows.length}只`)}</strong>
      </div>
      <div class="quality-share-bars">
        ${eventStats.map(([label, count]) => `
          <div>
            <span>${escapeHtml(label)}</span>
            <i><em style="width:${((count / total) * 100).toFixed(1)}%"></em></i>
            <strong>${escapeHtml(String(count))}</strong>
          </div>
        `).join("")}
      </div>
    </article>
    <article class="quality-chart-card">
      <div class="quality-chart-head">
        <span>20日表现分布</span>
        <strong>${escapeHtml(`${returnBuckets[0][1]}只高位`)}</strong>
      </div>
      <div class="quality-bucket-row">
        ${returnBuckets.map(([label, count], index) => `
          <div class="bucket-${index}">
            <strong>${escapeHtml(String(count))}</strong>
            <span>${escapeHtml(label)}</span>
          </div>
        `).join("")}
      </div>
    </article>
    <article class="quality-chart-card">
      <div class="quality-chart-head">
        <span>机构共振</span>
        <strong>${escapeHtml(confluenceTop[0]?.ticker || "--")}</strong>
      </div>
      <div class="quality-confluence-list">
        ${confluenceTop.map((row) => `
          <div>
            <b>${escapeHtml(row.ticker || "--")}</b>
            <span>${escapeHtml(row.firms30d == null ? "机构数据待补" : `${row.firms30d}家 · ${row.avgPriceTargetUpsidePct == null ? "目标价待补" : formatSignedPct(row.avgPriceTargetUpsidePct)}`)}</span>
          </div>
        `).join("")}
      </div>
    </article>
  `;
};

const renderQualityTable = () => {
  const rows = getQualityRows();
  const board = getQualityBoard();
  const body = document.querySelector("#qualityBody");
  const summary = document.querySelector("#qualityResultSummary");
  if (!body || !summary) return;

  setText("#qualityBoardTitle", board.title);
  setText("#qualityBoardSubtitle", board.subtitle);
  summary.textContent = `${board.title} · ${rows.length} 只股票`;
  renderQualityFocusGrid(rows);

  if (!state.selectedQualitySymbol && rows.length) {
    state.selectedQualitySymbol = rows[0].ticker;
  }
  if (state.selectedQualitySymbol && !rows.some((row) => row.ticker === state.selectedQualitySymbol)) {
    state.selectedQualitySymbol = rows[0] ? rows[0].ticker : "";
  }

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7">没有符合条件的股票</td></tr>';
    renderQualityDetail(null);
    return;
  }

  body.innerHTML = rows
    .map((row) => {
      const selected = row.ticker === state.selectedQualitySymbol;
      const priority = reviewPriorityForQualityRow(row);
      const revision = qualityRevisionText(row);
      const price = qualityPriceText(row);
      const institution = qualityInstitutionText(row);
      return `
        <tr class="quality-row ${selected ? "is-selected" : ""}" data-quality-symbol="${escapeHtml(row.ticker)}">
          <td class="rank-cell" data-label="排名">${escapeHtml(row.rank)}</td>
          <td class="symbol-cell" data-label="股票">
            <strong>${escapeHtml(row.ticker)}</strong>
            <span>${escapeHtml(row.companyName || row.name || "")}</span>
            <div class="inline-action-row">
              <button class="inline-stock-link" type="button" data-stock-open="${escapeHtml(row.ticker)}">详情</button>
              <button class="inline-stock-link" type="button" data-watchlist-toggle="${escapeHtml(row.ticker)}" data-watchlist-source="财报观察">${isInWatchlist(row.ticker) ? "已自选" : "加入自选"}</button>
            </div>
          </td>
          <td class="quality-angle-cell" data-label="财报事实">
            <strong>${escapeHtml(row.userAngle || "--")}</strong>
            <span>${escapeHtml(`${row.latestEarningsDate || "--"} · 上调 ${row.guidanceUpCount || 0} 次 / 超预期 ${row.earningsBeatCount || 0} 次`)}</span>
          </td>
          <td class="quality-mini-cell" data-label="预期变化">
            <strong>${escapeHtml(revision.main)}</strong>
            <span>${escapeHtml(revision.sub)}</span>
          </td>
          <td class="quality-mini-cell ${price.className}" data-label="价格 / 成交">
            <strong>${escapeHtml(price.main)}</strong>
            <span>${escapeHtml(price.sub)}</span>
          </td>
          <td class="quality-mini-cell" data-label="机构">
            <strong>${escapeHtml(institution.main)}</strong>
            <span>${escapeHtml(institution.sub)}</span>
          </td>
          <td class="quality-risk-cell" data-label="风险 / 动作">
            <strong>${escapeHtml(String(priority.score))} · ${escapeHtml(qualityConclusion(row))}</strong>
            <span class="quality-risk-text">${escapeHtml(`${qualityRiskSummary(row)}；${priority.reason}`)}</span>
          </td>
        </tr>
      `;
    })
    .join("");

  renderQualityDetail(rows.find((row) => row.ticker === state.selectedQualitySymbol) || rows[0]);
};

const renderEarningsQuality = (payload) => {
  if (!payload) return;
  state.earningsQuality = payload;
  const summary = payload.summary || {};
  setText("#earningsAsOf", formatDisplayDate(payload.asOf || payload.generatedAt));
  setText("#qualityCoreCount", summary.coreCount == null ? "--" : `${summary.coreCount}只`);
  setText("#qualityCoreLeader", summary.coreLeader || "--");
  setText("#qualityConfluenceLeader", summary.confluenceLeader || "--");
  setText("#qualityCoreReason", summary.coreDefinition || "财报和未来预期同时变好。");
  setText("#qualityUserAngle", "财报季选股");
  const rows = getQualityRows();
  state.selectedQualitySymbol = rows[0] ? rows[0].ticker : "";
  renderQualityInsightGrid();
  renderQualityTable();
};

const eventBoardFallbacks = {
  all: { title: "股票事件总览", subtitle: "汇总业绩预期变好、财报超预期、机构观点和空头压力变化，用于找到值得复盘的股票。" },
  guidance_up: { title: "业绩预期变好", subtitle: "公司或市场开始认为后续收入、利润或订单可能比之前想得更好，先看价格和成交是否确认。" },
  earnings_beat: { title: "财报超预期观察", subtitle: "业绩明显好于市场预期后，观察资金是否继续确认。" },
  analyst_positive: { title: "机构观点变化", subtitle: "目标价、评级或观点明显转好时，先看股价是否同步确认。" },
  short_squeeze: { title: "空头压力变化", subtitle: "空头比例较高且价格开始转强，波动会更大，确认条件要更严格。" },
};

const eventTermTips = {
  analyst_positive: "机构观点变化指券商或研究机构上调评级、目标价，或给出更积极观点。重点看市场是否真的用价格和成交额投票。",
  guidance_up: "业绩预期变好，就是公司自己或市场开始觉得这家公司后面可能比之前想得更好，比如收入、利润、订单或毛利率预期被上调。",
  earnings_beat: "财报超预期指实际业绩比市场原本预期更好。后续要看好消息是否已经被股价提前反映。",
  short_squeeze: "空头挤压指做空的人被迫回补，容易带来快速拉升，也容易快速回落，需要更严格的确认条件。",
  liquidity: "流动性可以理解成成交额。成交额越高，通常越容易进出；太低时滑点和波动会更明显。",
  score: "分数是排序辅助，用来帮你先看更需要研究的股票，不构成交易建议。",
  return20d: "20日表现约等于过去一个月的涨跌，用来判断事件后是否有资金继续跟进。",
};

const getEventBoard = () => {
  if (state.eventBoard === "all") {
    return {
      ...eventBoardFallbacks.all,
      rows: allEventRows().sort((a, b) => Number(b.signalScore || 0) - Number(a.signalScore || 0)),
    };
  }
  const fallback = eventBoardFallbacks[state.eventBoard] || eventBoardFallbacks.analyst_positive;
  const board = state.eventOpportunities?.boards?.[state.eventBoard];
  if (!board) return { ...fallback, rows: [] };
  return {
    ...board,
    title: displayEventLabel(board.title || fallback.title, fallback.title),
    subtitle: state.eventBoard === "guidance_up" ? fallback.subtitle : board.subtitle || fallback.subtitle,
  };
};

const syncEventPageChrome = () => {
  const board = eventBoardFallbacks[state.eventBoard];
  const isBoardRoute = window.location.hash.startsWith(`#stock-events/${state.eventBoard}`);
  setText("#stockEventsEyebrow", "股票事件");
  setText("#stockEventsPageTitle", isBoardRoute && board ? board.title.replace(/观察$/, "") : "股票事件");
  setText(
    "#stockEventsPageSubtitle",
    isBoardRoute && board
      ? board.subtitle
      : "把财报、业绩预期、机构观点和空头压力翻译成可复盘的股票名单。",
  );
  document.querySelectorAll(".event-tab").forEach((item) => {
    const active = item.dataset.eventBoard === state.eventBoard;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-pressed", active ? "true" : "false");
  });
};

const eventImpactLabel = (impact) => {
  if (impact === "high") return "高";
  if (impact === "medium") return "中";
  if (impact === "low") return "低";
  return "待确认";
};

const eventTypeLabel = (type) => {
  if (type === "macro") return "宏观";
  if (type === "earnings") return "财报";
  if (type === "manual") return "人工";
  if (type === "policy") return "政策";
  if (type === "core_signal") return "核心信号";
  return type || "事件";
};

const defaultCalendarImpactRules = [
  {
    trigger: "通胀数据",
    effect: "先看 10Y 美债和美元是否上行，再判断成长股估值压力。",
    modules: ["市场温度", "指数估值", "股票库"],
  },
  {
    trigger: "利率会议",
    effect: "先看政策措辞和长端利率，再决定复盘范围是否收缩。",
    modules: ["市场温度", "市场与资金"],
  },
  {
    trigger: "公司财报",
    effect: "进入个股工作台，确认预期、成交额、同板块扩散和价格承接。",
    modules: ["股票库", "个股详情"],
  },
];

const calendarEventSort = (a, b) =>
  parseEventDateValue(a.date) - parseEventDateValue(b.date) || String(a.time || "").localeCompare(String(b.time || ""));

const isFutureCalendarEvent = (item) => {
  const eventTime = parseEventDateValue(item?.date);
  if (!Number.isFinite(eventTime)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return eventTime >= today.getTime();
};

const calendarDaysUntil = (item) => {
  const eventTime = parseEventDateValue(item?.date);
  if (!Number.isFinite(eventTime)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((eventTime - today.getTime()) / 86_400_000);
};

const calendarDayDistanceLabel = (item) => {
  const days = calendarDaysUntil(item);
  if (!Number.isFinite(days)) return item?.time || "";
  if (days < 0) return `${Math.abs(days)}天前`;
  if (days === 0) return item?.time ? `今天 ${item.time}` : "今天";
  if (days === 1) return item?.time ? `明天 ${item.time}` : "明天";
  return item?.time ? `${days}天后 · ${item.time}` : `${days}天后`;
};

const compactCalendarDate = (item) => {
  const date = formatDisplayDate(item?.date) || "--";
  return `${date}${item?.time ? ` ${item.time}` : ""}`;
};

const calendarEventDateOnly = (item) => formatDisplayDate(item?.date) || "--";

const calendarEventTimeOnly = (item) => item?.time || "--";

const calendarEarningsSearchText = (item) => [
  item.title,
  item.summary,
  item.sourceName,
  ...splitReferenceList(item.relatedAssets),
  ...splitReferenceList(item.relatedModules),
].filter(Boolean).join(" ").toUpperCase();

const getFilteredCalendarEarnings = (events) => {
  const query = normalizeStockSymbol(state.calendarEarningsQuery || "") || String(state.calendarEarningsQuery || "").trim().toUpperCase();
  const windowValue = state.calendarEarningsWindow || "45";
  const impactFilter = state.calendarEarningsImpact || "all";
  const dayLimit = windowValue === "all" ? null : Number(windowValue);
  return events.filter((item) => {
    if (impactFilter !== "all" && item.impact !== impactFilter) return false;
    const days = calendarDaysUntil(item);
    if (Number.isFinite(dayLimit) && Number.isFinite(days) && days > dayLimit) return false;
    if (Number.isFinite(dayLimit) && days == null) return false;
    if (query && !calendarEarningsSearchText(item).includes(query)) return false;
    return true;
  });
};

const renderCalendarEarningsSummary = (filteredEvents, allEvents) => {
  const next = filteredEvents[0] || null;
  const windowLabel = state.calendarEarningsWindow === "all" ? "全部时间" : `未来${state.calendarEarningsWindow}天`;
  const impactLabel = state.calendarEarningsImpact === "all" ? "全部影响" : `${eventImpactLabel(state.calendarEarningsImpact)}影响`;
  const queryLabel = state.calendarEarningsQuery ? ` · ${state.calendarEarningsQuery.trim()}` : "";
  setText("#calendarEarningsMeta", `${windowLabel} · ${impactLabel}${queryLabel} · ${filteredEvents.length}/${allEvents.length}`);
  setText(
    "#calendarEarningsLead",
    next
      ? `下一项：${formatDisplayDate(next.date)} · ${next.title || "财报日期"}`
      : allEvents.length ? "当前筛选下没有财报日期。" : "等待财报日期数据接入。",
  );
};

const calendarScopeText = (item) => {
  const relatedAssets = (item.relatedAssets || []).slice(0, 4).join(" / ");
  const relatedModules = (item.relatedModules || []).filter((label) => label !== "财经日历").slice(0, 3).join(" / ");
  return relatedAssets || relatedModules || item.sourceName || eventTypeLabel(item.type);
};

const calendarSourceText = (item) => `${eventTypeLabel(item.type)}${item.sourceName ? ` · ${item.sourceName}` : ""}`;

const calendarEarningsEstimate = (item) => {
  const summary = String(item.summary || "");
  const epsMatch = summary.match(/EPS\s*([+-]?\d+(?:\.\d+)?)/i);
  const revenueMatch = summary.match(/收入\s*([0-9,.]+)/);
  const pieces = [];
  if (epsMatch) pieces.push(`EPS ${epsMatch[1]}`);
  if (revenueMatch) pieces.push(`收入 ${formatCompactMoney(Number(revenueMatch[1].replace(/,/g, "")))}`);
  return pieces.join(" / ") || summary || item.sourceName || "等待预估";
};

const calendarEarningsSymbol = (item) =>
  normalizeStockSymbol((item.relatedAssets || [])[0] || item.symbol || item.ticker || String(item.title || "").replace(/\s*财报.*/, ""));

const renderCalendarMacroRows = (events) =>
  events.map((item) => {
    const impactClass = item.impact === "high" ? "is-high" : item.impact === "medium" ? "is-medium" : "";
    return `
      <tr class="calendar-event-row is-macro">
        <td class="calendar-date-cell">
          <strong>${escapeHtml(calendarEventDateOnly(item))}</strong>
          <span>${escapeHtml(calendarDayDistanceLabel(item))}</span>
        </td>
        <td class="calendar-time-cell">${escapeHtml(calendarEventTimeOnly(item))}</td>
        <td class="calendar-title-cell">
          <strong>${escapeHtml(item.title || "--")}</strong>
          <p>${escapeHtml(item.summary || "")}</p>
        </td>
        <td class="calendar-source-cell">
          <strong>${escapeHtml(item.sourceName || "--")}</strong>
          <span>${escapeHtml(eventTypeLabel(item.type))}</span>
        </td>
        <td class="calendar-related-cell">
          <strong>${escapeHtml(calendarScopeText(item) || "--")}</strong>
        </td>
        <td class="calendar-impact-cell"><em class="calendar-impact ${impactClass}">${escapeHtml(eventImpactLabel(item.impact))}</em></td>
      </tr>
    `;
  }).join("");

const renderCalendarEarningsRows = (events) =>
  events.map((item) => {
    const impactClass = item.impact === "high" ? "is-high" : item.impact === "medium" ? "is-medium" : "";
    const symbol = calendarEarningsSymbol(item);
    return `
      <tr class="calendar-event-row is-earnings">
        <td class="calendar-date-cell">
          <strong>${escapeHtml(calendarEventDateOnly(item))}</strong>
          <span>${escapeHtml(calendarDayDistanceLabel(item))}</span>
        </td>
        <td class="calendar-symbol-cell">
          <strong>${escapeHtml(symbol || "--")}</strong>
        </td>
        <td class="calendar-title-cell">
          <strong>${escapeHtml(item.title || "财报日期")}</strong>
          <p>${escapeHtml(calendarScopeText(item))}</p>
        </td>
        <td class="calendar-related-cell">
          <strong>${escapeHtml(calendarEarningsEstimate(item))}</strong>
        </td>
        <td class="calendar-source-cell">
          <strong>${escapeHtml(item.sourceName || "--")}</strong>
          <span>${escapeHtml(calendarSourceText(item))}</span>
        </td>
        <td class="calendar-impact-cell"><em class="calendar-impact ${impactClass}">${escapeHtml(eventImpactLabel(item.impact))}</em></td>
      </tr>
    `;
  }).join("");

const renderCalendarTimeline = (events) => {
  const timeline = document.querySelector("#calendarTimeline");
  if (!timeline) return;
  const rows = events.slice(0, 7);
  timeline.innerHTML = rows.length
    ? rows
        .map((item) => {
          const typeClass = item.type === "earnings" ? "is-earnings" : item.type === "manual" ? "is-manual" : "is-macro";
          return `
            <article class="${typeClass}">
              <time>${escapeHtml(compactCalendarDate(item))}</time>
              <strong>${escapeHtml(item.title || "--")}</strong>
              <span>${escapeHtml(`${eventTypeLabel(item.type)} · ${calendarDayDistanceLabel(item)}`)}</span>
            </article>
          `;
        })
        .join("")
    : `
      <article>
        <time>--</time>
        <strong>暂无未来财经日历</strong>
        <span>宏观、财报和人工日志会分开展示</span>
      </article>
    `;
};

const calendarImpactFacts = (events, manualEvents, rules) => {
  const macro = events.find((item) => item.type === "macro" || item.type === "policy");
  const earnings = events.find((item) => item.type === "earnings");
  const facts = [
    macro
      ? {
          trigger: "下一条宏观事件",
          effect: `${compactCalendarDate(macro)} · ${macro.title}。先看利率、美元和指数承接，不直接把事件当结论。`,
          modules: ["市场温度", "市场与资金"],
        }
      : null,
    earnings
      ? {
          trigger: "下一条财报日期",
          effect: `${compactCalendarDate(earnings)} · ${earnings.title}。进入个股工作台看预估、成交额和同板块对比。`,
          modules: ["股票库", "个股详情"],
        }
      : null,
    {
      trigger: "人工财经日志",
      effect: manualEvents.length ? "人工维护内容单独列出，不混入宏观日历或财报日期。" : "暂无人工日志；等真实内容接入后会单独显示在人工财经日志表。",
      modules: ["财经日历"],
    },
  ].filter(Boolean);
  return facts.length ? facts : rules;
};

const renderEventsCalendar = (payload) => {
  if (Array.isArray(payload?.rows)) {
    payload = {
      ...(state.eventsCalendar || {}),
      events: payload.rows.map(normalizeProductCalendarRow),
    };
  }
  state.eventsCalendar = payload || state.eventsCalendar;
  const data = state.eventsCalendar || {};
  const events = Array.isArray(data.events) ? data.events : [];
  const rules = Array.isArray(data.impactRules) && data.impactRules.length ? data.impactRules : defaultCalendarImpactRules;
  const scheduledEvents = events.filter((item) => item.type !== "manual").sort(calendarEventSort);
  const manualEvents = events.filter((item) => item.type === "manual").sort(calendarEventSort);
  const body = document.querySelector("#calendarEventBody");
  const earningsBody = document.querySelector("#calendarEarningsBody");
  const manualPanel = document.querySelector("#calendarManualPanel");
  const manualBody = document.querySelector("#calendarManualBody");
  const impactList = document.querySelector("#calendarImpactList");
  setText("#eventsAsOf", formatDisplayDate(data.asOf || data.generatedAt || state.eventOpportunities?.asOf));
  const futureScheduledEvents = scheduledEvents.filter(isFutureCalendarEvent);
  const displayScheduledEvents = futureScheduledEvents.length ? futureScheduledEvents : scheduledEvents;
  const highEvents = displayScheduledEvents.filter((item) => item.impact === "high");
  const first = highEvents[0] || displayScheduledEvents[0];
  const macroEvents = displayScheduledEvents.filter((item) => item.type === "macro" || item.type === "policy");
  const allEarningsEvents = displayScheduledEvents.filter((item) => item.type === "earnings");
  const earningsEvents = getFilteredCalendarEarnings(allEarningsEvents);
  const macroCount = macroEvents.length;
  const earningsCount = allEarningsEvents.length;
  const timelineEvents = displayScheduledEvents.slice().sort(calendarEventSort);
  renderCalendarTimeline(timelineEvents);
  setText("#calendarHeroTitle", first ? `${compactCalendarDate(first)} · ${first.title}` : "未来事件总览");
  setText(
    "#calendarHeroLead",
    first
      ? `${eventTypeLabel(first.type)} · ${first.summary || "先看日期、影响范围和相关资产。"}`
      : "宏观事件、财报日期和人工财经日志按来源分开展示。",
  );
  setText("#calendarMacroStatus", macroCount ? `${macroCount}项` : "暂无");
  setText("#calendarEarningsStatus", earningsCount ? `${earningsCount}项` : "暂无");
  setText("#calendarHighImpactStatus", highEvents.length ? `${highEvents.length}项` : "暂无");
  setText("#calendarManualStatus", manualEvents.length ? `${manualEvents.length}条` : "待接入");
  renderCalendarEarningsSummary(earningsEvents, allEarningsEvents);
  if (body) {
    body.innerHTML = macroEvents.length
      ? renderCalendarMacroRows(macroEvents)
      : '<tr class="calendar-empty-row"><td colspan="6"><strong>暂无未来宏观事件</strong><p>当前宏观日历源没有更多未来事件。数据接入后会按时间、来源、影响和相关市场展示。</p></td></tr>';
  }
  if (earningsBody) {
    earningsBody.innerHTML = earningsEvents.length
      ? renderCalendarEarningsRows(earningsEvents)
      : allEarningsEvents.length
        ? '<tr class="calendar-empty-row"><td colspan="6"><strong>当前筛选下没有财报</strong><p>可以放宽时间窗、影响级别，或直接输入股票代码搜索具体公司。</p></td></tr>'
        : '<tr class="calendar-empty-row"><td colspan="6"><strong>公司财报日期待接入</strong><p>当前数据库还没有未来财报日期源。后续接入后会展示公司、日期、来源和影响等级。</p></td></tr>';
  }
  if (manualPanel && manualBody) {
    manualPanel.hidden = false;
    manualBody.innerHTML = manualEvents.length
      ? `<div class="table-wrap calendar-table-wrap">
          <table class="calendar-table data-table">
            <thead><tr><th>日期</th><th>标题</th><th>来源</th><th>影响</th></tr></thead>
            <tbody>${manualEvents.map((item) => {
              const impactClass = item.impact === "high" ? "is-high" : item.impact === "medium" ? "is-medium" : "";
              return `
                <tr class="calendar-event-row is-manual">
                  <td class="calendar-date-cell"><strong>${escapeHtml(calendarEventDateOnly(item))}</strong><span>${escapeHtml(calendarDayDistanceLabel(item))}</span></td>
                  <td class="calendar-title-cell"><strong>${escapeHtml(item.title || "--")}</strong><p>${escapeHtml(item.summary || "")}</p></td>
                  <td class="calendar-source-cell"><strong>${escapeHtml(item.sourceName || "手动维护")}</strong><span>${escapeHtml(calendarScopeText(item))}</span></td>
                  <td class="calendar-impact-cell"><em class="calendar-impact ${impactClass}">${escapeHtml(eventImpactLabel(item.impact))}</em></td>
                </tr>
              `;
            }).join("")}</tbody>
          </table>
        </div>`
      : '<strong>暂无人工财经日志</strong><p>这里不会放系统生成的占位内容；等你提供真实周报、交易前事项或复盘备注后，再单独进入这里。</p>';
  }
  if (impactList) {
    const facts = calendarImpactFacts(timelineEvents, manualEvents, rules);
    impactList.innerHTML = facts.length
      ? facts.map((rule) => `
        <article>
          <strong>${escapeHtml(rule.trigger || "--")}</strong>
          <p>${escapeHtml(rule.effect || "")}</p>
          <span>${escapeHtml((rule.modules || []).join(" / ") || "财经日历")}</span>
        </article>
      `).join("")
      : "<p>暂无影响映射。</p>";
  }
  renderDashboardVisualBoard();
  renderDashboardIntelligence();
  renderDataStatus();
};

const getEventRows = () => {
  const rows = getEventBoard().rows;
  const query = normalizeStockSymbol(state.eventQuery || "");
  const scoreFilter = state.eventScoreFilter || "all";
  const riskFilter = state.eventRiskFilter || "all";
  const styleFilter = state.eventStyleFilter || "all";
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const ticker = normalizeStockSymbol(row.ticker || row.symbol);
    const haystack = `${ticker} ${row.companyName || row.name || ""} ${row.reason || ""} ${row.eventLabel || ""}`.toUpperCase();
    if (query && !haystack.includes(query)) return false;
    const score = Number(row.signalScore);
    if (scoreFilter === "high" && !(score >= 1.2)) return false;
    if (scoreFilter === "mid" && !(score >= 0.8 && score < 1.2)) return false;
    if (scoreFilter === "low" && !(score < 0.8)) return false;
    const riskText = String(row.risk || "");
    const isWatchRisk = /短期涨幅|高热度|低频|流动性|低价|空头|波动|谨慎/.test(riskText);
    if (riskFilter === "watch" && !isWatchRisk) return false;
    if (riskFilter === "normal" && isWatchRisk) return false;
    const return20d = Number(row.return20dPct);
    const reasonText = `${row.reason || ""} ${row.risk || ""} ${row.eventLabel || ""}`;
    const liquidityText = String(row.liquidity || "");
    if (styleFilter === "steady" && (isWatchRisk || score < 1.1 || return20d < 0)) return false;
    if (styleFilter === "elastic" && !(return20d >= 20 || /波动|弹性|空头|挤压|严格确认/.test(reasonText))) return false;
    if (styleFilter === "institutional" && !/分析师|机构|评级|目标价|关注度|热度/.test(reasonText)) return false;
    if (styleFilter === "speculative" && !/小盘|波动|流动性|空头|挤压|低价/.test(`${reasonText} ${liquidityText}`)) return false;
    return true;
  });
};

const eventTermTip = (row) => eventTermTips[row?.eventType] || eventTermTips[state.eventBoard] || "先看线索为什么出现，再看价格和成交额有没有确认。";

const eventDateLabel = (row) => {
  const type = row?.eventType || state.eventBoard;
  if (type === "earnings_beat") return "财报日期";
  if (type === "guidance_up") return "财报日期";
  if (type === "analyst_positive") return "机构观点日期";
  if (type === "short_squeeze") return "空头数据日期";
  return "事件日期";
};

const eventTypeFieldLabel = (row) => {
  const type = row?.eventType || state.eventBoard;
  if (type === "earnings_beat") return "财报类型";
  if (type === "guidance_up") return "预期类型";
  if (type === "analyst_positive") return "机构观点";
  if (type === "short_squeeze") return "空头状态";
  return "事件类型";
};

const eventReasonForUser = (row) => {
  const raw = String(row?.reason || "").replace(/\s+/g, " ").trim();
  const ticker = normalizeStockSymbol(row?.ticker || row?.symbol);
  const name = row?.companyName || row?.name || ticker || "该公司";
  const target = raw.match(/price target of\s+\$?([\d,.]+)/i)?.[1];
  const targetCopy = target ? `，并给出目标价 $${target}` : "";
  if (/upgraded/i.test(raw)) return `机构上调 ${name} 的评级${targetCopy}；后续重点看价格和成交额是否继续确认。`;
  if (/initiated coverage/i.test(raw)) return `机构首次覆盖 ${name}${targetCopy}；这类线索先看市场是否用价格和成交额确认。`;
  if (/maintained|reiterated/i.test(raw)) return `机构维持对 ${name} 的积极观点${targetCopy}；继续观察观点变化后股价是否有持续反馈。`;
  if (row?.eventType === "analyst_positive" && /[A-Za-z]{4,}/.test(raw)) {
    return `机构观点出现积极变化；后续重点看价格、成交额和大盘环境是否配合。`;
  }
  if (row?.eventType === "guidance_up" && !raw) {
    return "公司上调未来预期，说明经营层面对后续更有信心；后续看股价和成交额是否同步确认。";
  }
  if (row?.eventType === "earnings_beat" && !raw) {
    return "财报结果好于市场原本预期；后续看好消息是否已经被股价提前反映。";
  }
  return raw || eventNextReview(row);
};

const eventDecisionCopy = (rows) => {
  if (!rows.length) return ["等待数据", "当前筛选下没有候选，放宽筛选或切换榜单。"];
  const highScore = rows.filter((row) => Number(row.signalScore) >= 1.2).length;
  const watchRisk = rows.filter((row) => /短期涨幅|高热度|低频|流动性|低价|空头|波动|谨慎/.test(String(row.risk || ""))).length;
  if (highScore >= Math.max(1, Math.ceil(rows.length * 0.25))) {
    return ["先看高分", `当前有 ${highScore} 只高分候选，优先检查价格和成交是否继续确认。`];
  }
  if (watchRisk >= Math.ceil(rows.length * 0.5)) {
    return ["降低节奏", "当前波动提醒较多，适合先加入自选，等待更多确认。"];
  }
  return ["逐只确认", "先看进入原因，再看20日表现和流动性是否支持继续跟踪。"];
};

const eventMetric = (label, value, className = "") => `
  <div class="${className}">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value == null || value === "" ? "--" : value)}</strong>
  </div>
`;

const eventHistoryEvidence = (eventType) => {
  const stats = state.validationCenter?.historicalBenchmarkStats || [];
  const stat = stats.find((item) => item.signal === eventType && item.horizon === "20d")
    || stats.find((item) => item.signal === eventType)
    || stats.find((item) => item.signal === "guidance_up" && item.horizon === "20d")
    || stats.find((item) => item.signal === "guidance_up")
    || {};
  return {
    count: stat.count,
    positiveRate: stat.winRatePct,
    strongerSpyRate: stat.beatSpyRatePct,
    median: stat.medianPct,
    stableAverage: stat.trimmedMeanPct,
  };
};

const eventRiskFlag = (row) => /短期涨幅|高热度|低频|流动性|低价|空头|波动|谨慎/.test(String(row?.risk || ""));

const eventRiskSummary = (row) => {
  const text = String(row?.risk || "").trim();
  if (!text) return "--";
  if (/短期涨幅|高热度/.test(text)) return "短期涨幅偏大";
  if (/流动性|低频|低价/.test(text)) return "流动性需观察";
  if (/空头|挤压/.test(text)) return "波动可能较大";
  if (/波动|回撤/.test(text)) return "波动需观察";
  if (/估值/.test(text)) return "估值需确认";
  return text.length > 18 ? `${text.slice(0, 18)}...` : text;
};

const eventConclusion = (row) => {
  const score = Number(row?.signalScore);
  const evidence = eventHistoryEvidence(row?.eventType || state.eventBoard);
  if (eventRiskFlag(row)) return "可观察，但需要更严格风控";
  if (!Number.isFinite(Number(evidence.count)) || Number(evidence.count) < 30) return "样本不足，先小心观察";
  if (Number.isFinite(score) && score >= 1.2) return "复盘优先级高";
  if (Number.isFinite(score) && score >= 0.8) return "可以继续观察";
  return "先放低优先级";
};

const eventNextReview = (row) => {
  if (eventRiskFlag(row)) return "先看价格是否站稳，成交额是否连续放大；如果次日快速回落，就降低观察频率。";
  if (row?.eventType === "short_squeeze") return "重点看回补行情是否延续，若成交缩小且价格回落，先不要提高优先级。";
  if (row?.eventType === "earnings_beat") return "看财报后的价格承接和分析师后续调整，避免只因为单次财报超预期就提高优先级。";
  if (row?.eventType === "analyst_positive") return "看机构观点变化后价格是否继续确认，单日拉升后等回踩更稳。";
  return "看业绩预期变好后价格和成交是否继续确认，再决定是否加入长期跟踪。";
};

const eventCurrentPosition = (row) => {
  const return20d = row?.return20dPct == null ? "--" : formatSignedPct(row.return20dPct);
  const fwd20d = row?.fwd20dPct == null ? "--" : formatSignedPct(row.fwd20dPct);
  return `近20日表现 ${return20d}，历史观察窗口参考 ${fwd20d}。`;
};

const eventScoreText = (row, priority) => ({
  main: `${row?.signalScore == null ? "--" : Number(row.signalScore).toFixed(1)} / ${priority.score}`,
  sub: priority.reason,
});

const eventPriceText = (row) => ({
  main: row?.return20dPct == null ? "--" : formatSignedPct(row.return20dPct),
  sub: `5日 ${row?.fwd5dPct == null ? "--" : formatSignedPct(row.fwd5dPct)} / 20日 ${row?.fwd20dPct == null ? "--" : formatSignedPct(row.fwd20dPct)}`,
  className: Number(row?.return20dPct) >= 0 ? "is-positive" : "is-negative",
});

const eventDetailPreview = (row) => {
  const ticker = normalizeStockSymbol(row?.ticker || row?.symbol);
  const market = findMarketRow(ticker);
  const day = getBoardRow("day", ticker);
  const week = getBoardRow("week", ticker);
  const month = getBoardRow("month", ticker);
  const volume = getBoardRow("volume", ticker);
  const strength = findStrengthRow(ticker);
  const quality = findQualityRow(ticker);
  const signal = signalStateForSymbol(ticker);
  const sources = stockDataSources({ market, day, week, month, volume, strength, quality, eventRow: row, signal })
    .filter(([, active]) => active)
    .map(([label]) => label);
  return {
    sources: sources.length ? sources.join(" / ") : "线索",
    title: `${displayEventLabel(row)} · ${sources.length || 1}项依据`,
    note: eventReasonForUser(row),
  };
};

const renderEventFocusGrid = (rows) => {
  const top = rows
    .map((row) => ({ row, priority: reviewPriorityForEventRow(row) }))
    .sort((a, b) => b.priority.score - a.priority.score)[0]?.row || rows[0];
  const ticker = normalizeStockSymbol(top?.ticker || top?.symbol);
  const preview = top ? eventDetailPreview(top) : null;
  const priority = top ? reviewPriorityForEventRow(top) : null;
  const riskRows = rows.filter(eventRiskFlag);
  setText("#eventFocusLeader", top ? `${ticker} · ${displayEventLabel(top)}` : "暂无线索");
  setText(
    "#eventFocusLeaderNote",
    top ? `${top.companyName || top.name || ticker}：复盘分 ${priority.score}，${priority.reason}。` : "先看理由清楚、价格已经确认、流动性够用的股票。",
  );
  setText("#eventFocusReason", top ? eventConclusion(top) : "暂无理由");
  setText(
    "#eventFocusReasonNote",
    top ? eventReasonForUser(top) : "这里会把专业事件翻译成普通投资者能看懂的观察理由。",
  );
  setText("#eventFocusRisk", rows.length ? `${riskRows.length} 只需谨慎` : "先看确认");
  setText(
    "#eventFocusRiskNote",
    riskRows.length
      ? "有短线涨幅、流动性或波动提醒的股票，先降低观察频率。"
      : "当前筛选下风险提醒较少，但仍要看成交额和价格确认。",
  );
  setText("#eventFocusDetail", preview ? preview.title : "依据汇总");
  setText(
    "#eventFocusDetailNote",
    preview ? `详情页会汇总：${preview.sources}。` : "股票详情会把事件、行情、强弱、财报和自选状态放在一起看。",
  );
};

const renderExpectationEvidence = () => {
  const decision = (state.validationCenter?.productDecisions || []).find((item) => item.signal === "guidance_up") || {};
  const sample = state.validationCenter?.historicalSample || {};
  const count = decision.count || sample.rows;
  const rows = getEventRows();
  const asOf = state.eventOpportunities?.asOf || state.eventOpportunities?.generatedAt;
  setText("#expectationCandidateCount", rows.length ? `${rows.length}只` : "--");
  setText("#expectationCandidateNote", rows.length ? "当前筛选后的股票名单" : "当前筛选暂无结果");
  setText("#expectationDataDate", formatDisplayDate(asOf));
  setText("#expectationSampleCount", count ? formatNumber(count) : "--");
  setText(
    "#expectationSampleRange",
    sample.start && sample.end ? `${formatDisplayDate(sample.start)} 至 ${formatDisplayDate(sample.end)}` : "等待历史样本",
  );
  setText("#expectationPositiveRate", formatEvidencePct(decision.winRatePct, decision.count));
  setText("#expectationSpyRate", formatEvidencePct(decision.beatSpyRatePct, decision.count));
  setText("#expectationStableAvg", formatEvidenceSignedPct(decision.trimmedMeanPct, decision.count));

  const overall = state.marketTemperature?.overall || {};
  const score = Number(overall.score);
  setText("#expectationTemperatureScore", Number.isFinite(score) ? String(score) : "--");
  setText("#expectationTemperatureLabel", overall.label ? `${overall.label}环境` : "暂无环境数据");
  setText("#expectationTemperatureAction", overall.action || "市场环境只用于辅助判断观察频率。");
  setText(
    "#expectationHeroTitle",
    rows.length
      ? `${eventBoardFallbacks[state.eventBoard]?.title || "观察名单"} · ${rows.length} 只候选`
      : "股票事件：等待更清晰的确认信号",
  );
  setText(
    "#expectationHeroLead",
    rows.length
      ? "这里把事件落到可复盘股票，先看理由，再看价格、成交和市场环境是否确认。"
      : "股票事件等待数据生成后再进入复盘；财经日历只保留事件时间和影响范围。",
  );
};

const renderEventDetail = (row) => {
  const panel = document.querySelector("#eventDetailPanel");
  if (!panel) return;
  if (!row) {
    panel.innerHTML = `
      <div class="empty-detail">
        <strong>点击榜单股票查看详情</strong>
        <p>这里会显示事件日期、事件类型、核心理由、主要风险和复盘窗口。</p>
      </div>
    `;
    return;
  }

  const ticker = normalizeStockSymbol(row.ticker || row.symbol);
  const evidence = eventHistoryEvidence(row.eventType || state.eventBoard);
  const conclusion = eventConclusion(row);
  const priority = reviewPriorityForEventRow(row);
  panel.innerHTML = `
    <div class="event-detail-head">
      <div>
        <span>${escapeHtml(displayEventLabel(row))}</span>
        <h2>${escapeHtml(ticker)}</h2>
        <p>${escapeHtml(row.companyName || row.name || "")}</p>
      </div>
      <div class="quality-head-actions">
        ${watchlistActionButton(ticker, "股票事件")}
        <button class="ghost-action" type="button" data-stock-open="${escapeHtml(ticker)}">股票详情</button>
      </div>
    </div>
    <div class="event-score-block">
      <div>
        <span>复盘分</span>
        <strong>${escapeHtml(String(priority.score))}</strong>
      </div>
      <div>
        <span>事件分</span>
        <strong>${escapeHtml(row.signalScore == null ? "--" : Number(row.signalScore).toFixed(1))}</strong>
      </div>
    </div>
    <section class="event-report-box">
      <span>复盘分依据</span>
      <strong>${escapeHtml(priority.reason)}</strong>
      <p>分数只用于排序和复盘优先级，不代表确定性结果。</p>
    </section>
    <section class="event-report-box">
      <span>当前结论</span>
      <strong>${escapeHtml(conclusion)}</strong>
      <p>${escapeHtml(eventCurrentPosition(row))}</p>
    </section>
    <section class="quality-reason-box">
      <span>为什么进入观察</span>
      <p>${escapeHtml(eventReasonForUser(row))}</p>
    </section>
    <section class="event-report-box">
      <span>历史同类样本</span>
      <strong>${escapeHtml(evidence.count ? `${formatNumber(evidence.count)} 条样本` : "样本不足")}</strong>
      <p>20日正向占比 ${escapeHtml(formatEvidencePct(evidence.positiveRate, evidence.count))}；强于SPY占比 ${escapeHtml(formatEvidencePct(evidence.strongerSpyRate, evidence.count))}；中位表现 ${escapeHtml(formatEvidenceSignedPct(evidence.median, evidence.count))}。</p>
    </section>
    <section class="quality-risk-box">
      <span>主要风险</span>
      <p>${escapeHtml(row.risk || "这类线索波动可能较大，先看价格和成交额是否继续确认。")}</p>
    </section>
    <section class="event-report-box">
      <span>下一步复盘</span>
      <strong>${escapeHtml(eventNextReview(row))}</strong>
      <p>按价格确认、成交变化和市场温度变化继续复盘。</p>
    </section>
    <div class="event-detail-grid">
      ${eventMetric(eventDateLabel(row), row.eventDate || "--")}
      ${eventMetric(eventTypeFieldLabel(row), displayEventLabel(row, "--"))}
      ${eventMetric("20日表现", row.return20dPct == null ? "--" : formatSignedPct(row.return20dPct), Number(row.return20dPct) >= 0 ? "is-positive" : "is-negative")}
      ${eventMetric("5日后观察", row.fwd5dPct == null ? "--" : formatSignedPct(row.fwd5dPct), Number(row.fwd5dPct) >= 0 ? "is-positive" : "is-negative")}
      ${eventMetric("20日后观察", row.fwd20dPct == null ? "--" : formatSignedPct(row.fwd20dPct), Number(row.fwd20dPct) >= 0 ? "is-positive" : "is-negative")}
      ${eventMetric("60日后观察", row.fwd60dPct == null ? "--" : formatSignedPct(row.fwd60dPct), Number(row.fwd60dPct) >= 0 ? "is-positive" : "is-negative")}
      ${eventMetric("目标价空间", row.priceTargetUpsidePct == null ? "--" : formatSignedPct(row.priceTargetUpsidePct), Number(row.priceTargetUpsidePct) >= 0 ? "is-positive" : "is-negative")}
      ${eventMetric("流动性", row.liquidity || "--")}
      ${eventMetric("空头比例", row.shortInterest == null ? "--" : `${row.shortInterest}`)}
      ${eventMetric("回补天数", row.daysToCover == null ? "--" : `${row.daysToCover}`)}
    </div>
    <div class="event-lock-row event-workbench-row">
      <article>
        <span>历史样本</span>
        <strong>${escapeHtml(evidence.count ? `${formatNumber(evidence.count)}条` : "样本不足")}</strong>
        <p>正向占比 ${escapeHtml(formatEvidencePct(evidence.positiveRate, evidence.count))}，中位表现 ${escapeHtml(formatEvidenceSignedPct(evidence.median, evidence.count))}。</p>
      </article>
      <article>
        <span>价格确认</span>
        <strong>${escapeHtml(row.return20dPct == null ? "--" : formatSignedPct(row.return20dPct))}</strong>
        <p>先看事件后价格是否继续站稳，再结合成交额判断资金是否确认。</p>
      </article>
      <article>
        <span>复盘动作</span>
        <strong>${escapeHtml(eventRiskFlag(row) ? "降低频率" : "加入候选")}</strong>
        <p>${escapeHtml(eventNextReview(row))}</p>
      </article>
    </div>
  `;
};

const renderEventTable = () => {
  syncEventPageChrome();
  renderExpectationEvidence();
  const board = getEventBoard();
  const rows = getEventRows();
  const totalRows = Array.isArray(board.rows) ? board.rows.length : 0;
  const body = document.querySelector("#eventBody");
  const cardGrid = document.querySelector("#eventCardGrid");
  const summary = document.querySelector("#eventResultSummary");
  if (!body || !summary) return;

  setText("#eventBoardTitle", board.title || eventBoardFallbacks[state.eventBoard]?.title || "--");
  setText(
    "#eventBoardSubtitle",
    board.subtitle || eventBoardFallbacks[state.eventBoard]?.subtitle || "这里是独立的股票事件页面，不属于财经日历。",
  );
  setText("#eventActiveTitle", board.title || "--");
  setText("#eventActiveSubtitle", board.subtitle || "加载后显示当前线索口径。");
  const [decisionValue, decisionNote] = eventDecisionCopy(rows);
  setText("#eventDecisionValue", decisionValue);
  setText("#eventDecisionNote", decisionNote);
  renderEventFocusGrid(rows);
  summary.textContent = `${board.title || "事件榜"} · ${rows.length}/${totalRows} 只股票`;

  if (!state.selectedEventSymbol && rows.length) state.selectedEventSymbol = normalizeStockSymbol(rows[0].ticker || rows[0].symbol);
  if (state.selectedEventSymbol && !rows.some((row) => normalizeStockSymbol(row.ticker || row.symbol) === state.selectedEventSymbol)) {
    state.selectedEventSymbol = rows[0] ? normalizeStockSymbol(rows[0].ticker || rows[0].symbol) : "";
  }

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8">这张榜单暂时没有数据，生成后会自动显示。</td></tr>';
    if (cardGrid) {
      cardGrid.innerHTML = `
        <article class="event-observation-card">
          <span>暂无符合条件的股票</span>
          <strong>可以放宽筛选或切换线索类型</strong>
          <p>先从“全部观察风格”开始，再逐步缩小到稳一点、弹性大、机构关注或小盘高波动。</p>
        </article>
      `;
    }
    renderEventDetail(null);
    return;
  }

  if (cardGrid) {
    cardGrid.innerHTML = rows.slice(0, 8).map((row) => {
      const ticker = normalizeStockSymbol(row.ticker || row.symbol);
      const selected = ticker === state.selectedEventSymbol;
      const conclusion = eventConclusion(row);
      const priority = reviewPriorityForEventRow(row);
      const price = eventPriceText(row);
      return `
        <article class="event-observation-card ${selected ? "is-selected" : ""}" data-event-symbol="${escapeHtml(ticker)}">
          <div class="event-card-head">
            <div>
              <span>${escapeHtml(displayEventLabel(row))}</span>
              <strong>${escapeHtml(ticker)}</strong>
              <p>${escapeHtml(row.companyName || row.name || "")}</p>
            </div>
            <em>${escapeHtml(conclusion)}</em>
          </div>
          <div class="event-card-metrics">
            <div><span>复盘分</span><strong>${escapeHtml(String(priority.score))}</strong></div>
            <div><span>20日表现</span><strong class="${price.className}">${escapeHtml(price.main)}</strong></div>
            <div><span>流动性</span><strong>${escapeHtml(row.liquidity || "--")}</strong></div>
          </div>
          <p class="event-card-brief">${escapeHtml(eventReasonForUser(row))}</p>
          <div class="event-card-actions">
            <button class="ghost-action" type="button" data-stock-open="${escapeHtml(ticker)}">股票详情</button>
            ${watchlistActionButton(ticker, "股票事件")}
          </div>
        </article>
      `;
    }).join("");
  }

  body.innerHTML = rows
    .map((row, index) => {
      const ticker = normalizeStockSymbol(row.ticker || row.symbol);
      const selected = ticker === state.selectedEventSymbol;
      const priority = reviewPriorityForEventRow(row);
      const scoreText = eventScoreText(row, priority);
      const price = eventPriceText(row);
      return `
        <tr class="event-row ${selected ? "is-selected" : ""}" data-event-symbol="${escapeHtml(ticker)}">
          <td class="rank-cell" data-label="排名">${escapeHtml(row.rank || index + 1)}</td>
          <td class="symbol-cell" data-label="股票">
            <div class="event-symbol-card">
              <strong>${escapeHtml(ticker)}</strong>
              <span>${escapeHtml(row.companyName || row.name || "")}</span>
              <div class="inline-action-row">
                <button class="inline-stock-link" type="button" data-stock-open="${escapeHtml(ticker)}">详情</button>
                <button class="inline-stock-link" type="button" data-watchlist-toggle="${escapeHtml(ticker)}" data-watchlist-source="股票事件">${isInWatchlist(ticker) ? "已自选" : "加入自选"}</button>
              </div>
            </div>
          </td>
          <td class="event-type-cell" data-label="线索">
            <div class="event-label-stack">
              <strong>
                ${escapeHtml(displayEventLabel(row, "--"))}
                <button class="info-tip" type="button" aria-label="${escapeHtml(displayEventLabel(row, "线索"))}解释" data-tip="${escapeHtml(eventTermTip(row))}">?</button>
              </strong>
              <span>${escapeHtml(eventDateLabel(row))} ${escapeHtml(formatDisplayDate(row.eventDate))}</span>
            </div>
          </td>
          <td class="event-reason-cell" data-label="进入原因"><span class="event-reason-text">${escapeHtml(eventReasonForUser(row))}</span></td>
          <td class="quality-score-cell" data-label="事件 / 复盘分">
            <div class="event-score-stack">
              <strong>${escapeHtml(scoreText.main)}</strong>
              <small class="macro-rank-reason">${escapeHtml(scoreText.sub)}</small>
            </div>
          </td>
          <td class="event-mini-cell ${price.className}" data-label="价格确认">
            <strong>${escapeHtml(price.main)}</strong>
            <span>${escapeHtml(price.sub)}</span>
          </td>
          <td class="event-mini-cell" data-label="流动性">${escapeHtml(row.liquidity || "--")}</td>
          <td class="quality-risk-cell" data-label="风险 / 动作">
            <strong>${escapeHtml(eventRiskFlag(row) ? "降低频率" : "继续跟踪")}</strong>
            <span class="event-risk-text">${escapeHtml(`${eventRiskSummary(row)}；${eventNextReview(row)}`)}</span>
          </td>
        </tr>
      `;
    })
    .join("");

  renderEventDetail(rows.find((row) => normalizeStockSymbol(row.ticker || row.symbol) === state.selectedEventSymbol) || rows[0]);
};

const renderEventOpportunities = (payload) => {
  state.eventOpportunities = payload;
  const guidanceRows = payload?.boards?.guidance_up?.rows || [];
  const rows = guidanceRows.length ? guidanceRows : allEventRows();
  const first = rows[0];
  const stats = Array.isArray(payload?.forwardStats) ? payload.forwardStats : [];
  setText("#stockEventsAsOf", formatDisplayDate(payload?.asOf));
  renderEventsCalendar(state.eventsCalendar);
  setText("#eventTotalCount", rows.length ? `${rows.length}只` : "--");
  setText("#eventTopSymbol", first ? normalizeStockSymbol(first.ticker || first.symbol) : "--");
  setText("#eventTopReason", first ? eventReasonForUser(first) : "有数据后显示当前更需要进一步研究的线索。");
  setText("#dashboardEventLeader", first ? normalizeStockSymbol(first.ticker || first.symbol) : "等待数据");
  setText("#dashboardEventCount", rows.length ? `${rows.length}` : "--");
  setText("#dashboardEventCopy", first ? eventReasonForUser(first) : "业绩预期变好、财报和机构观点变化会集中展示。");
  setText("#dashboardEventNote", first ? displayEventLabel(first) : "适合先加入自选，再看价格是否确认。");
  setText("#eventForwardSummary", stats.length ? `${stats.length}组记录` : "样本待补");
  renderEventTable();
  renderDashboardFocus();
};

const validationClass = (winRate) => {
  const value = Number(winRate);
  if (!Number.isFinite(value)) return "";
  if (value >= 55) return "is-positive";
  if (value < 50) return "is-negative";
  return "is-neutral";
};

const validationEvidenceClass = (value, count, minCount = 30) => {
  const sample = Number(count);
  if (!Number.isFinite(sample) || sample < minCount) return "is-neutral";
  return validationClass(value);
};

const renderValidationCenter = (payload) => {
  state.validationCenter = payload;
  renderExpectationEvidence();
  const summary = payload?.summary || {};
  const best = Array.isArray(summary.bestSignals) ? summary.bestSignals[0] : null;
  setText("#validationAsOf", formatDisplayDate(payload?.asOf));
  setText("#validationVerdict", summary.verdict || "--");
  setText("#validationConclusion", summary.conclusion || "等待验证数据生成。");
  setText("#validationBestSignal", best ? `${best.label} ${formatPlainPct(best.winRatePct)}` : "--");
  setText("#validationBestNote", best ? `20日样本 ${formatNumber(best.count)} 条，历史均值 ${formatEvidenceSignedPct(best.meanPct, best.count)}。` : "先找样本量、正向占比和相对指数表现都更稳的方向。");
  const historicalSample = payload?.historicalSample || {};
  setText("#validationSampleSize", historicalSample.rows ? `${formatNumber(historicalSample.rows)} 条` : "--");
  setText(
    "#validationSampleNote",
    historicalSample.start && historicalSample.end
      ? `${formatDisplayDate(historicalSample.start)} 至 ${formatDisplayDate(historicalSample.end)}，覆盖 ${formatNumber(historicalSample.symbols || 0)} 个标的。`
      : summary.sampleNote || "已接入事件级历史样本、指数对照和市场环境分层。"
  );

  const decisionBody = document.querySelector("#validationDecisionBody");
  if (decisionBody) {
    const rows = Array.isArray(payload?.productDecisions) ? payload.productDecisions : [];
    decisionBody.innerHTML = rows.length
      ? rows
          .map((row) => {
            const statusClass = row.status === "重点观察" ? "is-positive" : row.status === "只作背景" ? "is-negative" : "is-neutral";
            return `
              <tr>
                <td><strong>${escapeHtml(row.label || row.signal || "--")}</strong></td>
                <td class="${statusClass}">${escapeHtml(row.status || "--")}</td>
                <td>${escapeHtml(formatNumber(row.count || 0))}</td>
                <td class="${validationEvidenceClass(row.winRatePct, row.count)}">${escapeHtml(formatEvidencePct(row.winRatePct, row.count))}</td>
                <td class="${validationEvidenceClass(row.beatSpyRatePct, row.count)}">${escapeHtml(formatEvidencePct(row.beatSpyRatePct, row.count))}</td>
                <td class="${Number(row.trimmedMeanPct) >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatEvidenceSignedPct(row.trimmedMeanPct, row.count))}</td>
              </tr>
            `;
          })
          .join("")
      : '<tr><td colspan="6">等待历史回测数据。</td></tr>';
  }

  const basketBody = document.querySelector("#validationBasketBody");
  if (basketBody) {
    const rows = Array.isArray(payload?.rollingBaskets) ? payload.rollingBaskets : [];
    basketBody.innerHTML = rows.length
      ? rows
          .slice(0, 8)
          .map((row) => `
            <tr>
              <td><strong>${escapeHtml(row.label || row.signal || "--")}</strong></td>
              <td>${escapeHtml(formatNumber(row.days || 0))}</td>
              <td>${escapeHtml(row.avgPicks == null ? "--" : Number(row.avgPicks).toFixed(1))}</td>
              <td class="${Number(row.medianPct) >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatEvidenceSignedPct(row.medianPct, row.count))}</td>
              <td class="${validationEvidenceClass(row.winRatePct, row.count)}">${escapeHtml(formatEvidencePct(row.winRatePct, row.count))}</td>
              <td class="${validationEvidenceClass(row.beatSpyRatePct, row.count)}">${escapeHtml(formatEvidencePct(row.beatSpyRatePct, row.count))}</td>
            </tr>
          `)
          .join("")
      : '<tr><td colspan="6">等待滚动名单验证。</td></tr>';
  }

  const historyBenchmarkBody = document.querySelector("#validationHistoryBenchmarkBody");
  if (historyBenchmarkBody) {
    const rows = Array.isArray(payload?.historicalBenchmarkStats) ? payload.historicalBenchmarkStats : [];
    historyBenchmarkBody.innerHTML = rows.length
      ? rows
          .filter((row) => row.horizon === "20d" || row.horizon === "60d")
          .map((row) => `
            <tr>
              <td><strong>${escapeHtml(row.label || row.signal || "--")}</strong></td>
              <td>${escapeHtml(row.horizon || "--")}</td>
              <td>${escapeHtml(formatNumber(row.count || 0))}</td>
              <td class="${Number(row.medianPct) >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatEvidenceSignedPct(row.medianPct, row.count))}</td>
              <td class="${validationEvidenceClass(row.winRatePct, row.count)}">${escapeHtml(formatEvidencePct(row.winRatePct, row.count))}</td>
              <td class="${validationEvidenceClass(row.beatSpyRatePct, row.count)}">${escapeHtml(formatEvidencePct(row.beatSpyRatePct, row.count))}</td>
              <td class="${Number(row.meanExcessSpyPct) >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatEvidenceSignedPct(row.meanExcessSpyPct, row.count))}</td>
              <td class="${validationEvidenceClass(row.beatQqqRatePct, row.count)}">${escapeHtml(formatEvidencePct(row.beatQqqRatePct, row.count))}</td>
            </tr>
          `)
          .join("")
      : '<tr><td colspan="8">等待全历史指数对照。</td></tr>';
  }

  const eventBody = document.querySelector("#validationEventBody");
  if (eventBody) {
    const rows = Array.isArray(payload?.eventTypeStats) ? payload.eventTypeStats : [];
    eventBody.innerHTML = rows.length
      ? rows
          .map((row) => `
            <tr>
              <td><strong>${escapeHtml(row.label || row.signal || "--")}</strong></td>
              <td>${escapeHtml(row.horizon || "--")}</td>
              <td>${escapeHtml(row.count || "--")}</td>
              <td class="${Number(row.meanPct) >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatSignedPct(row.meanPct))}</td>
              <td class="${Number(row.medianPct) >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatSignedPct(row.medianPct))}</td>
              <td class="${validationEvidenceClass(row.winRatePct, row.count)}">${escapeHtml(formatEvidencePct(row.winRatePct, row.count))}</td>
            </tr>
          `)
          .join("")
      : '<tr><td colspan="6">等待验证数据生成。</td></tr>';
  }

  const scoreBody = document.querySelector("#validationScoreBody");
  if (scoreBody) {
    const rows = Array.isArray(payload?.scoreBuckets) ? payload.scoreBuckets : [];
    scoreBody.innerHTML = rows.length
      ? rows
          .map((row) => `
            <tr>
              <td><strong>${escapeHtml(row.boardLabel || row.board || "--")}</strong></td>
              <td>${escapeHtml(row.bucketLabel || "--")}</td>
              <td>${escapeHtml(row.count || "--")}</td>
              <td>${escapeHtml(row.avgScore == null ? "--" : Number(row.avgScore).toFixed(2))}</td>
              <td class="${Number(row.meanPct) >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatSignedPct(row.meanPct))}</td>
              <td class="${validationEvidenceClass(row.winRatePct, row.count)}">${escapeHtml(formatEvidencePct(row.winRatePct, row.count))}</td>
            </tr>
          `)
          .join("")
      : '<tr><td colspan="6">等待分数组验证。</td></tr>';
  }

  const benchmarkBody = document.querySelector("#validationBenchmarkBody");
  if (benchmarkBody) {
    const rows = Array.isArray(payload?.benchmarkTests) ? payload.benchmarkTests : [];
    benchmarkBody.innerHTML = rows.length
      ? rows
          .map((row) => {
            const spy = row.spy || {};
            const qqq = row.qqq || {};
            return `
              <tr>
                <td><strong>${escapeHtml(row.boardLabel || row.board || "--")}</strong></td>
                <td>${escapeHtml(row.horizon || "--")}</td>
                <td>${escapeHtml(spy.count || "--")}</td>
                <td class="${validationEvidenceClass(spy.beatRatePct, spy.count)}">${escapeHtml(formatEvidencePct(spy.beatRatePct, spy.count))}</td>
                <td class="${Number(spy.meanExcessPct) >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatEvidenceSignedPct(spy.meanExcessPct, spy.count))}</td>
                <td class="${validationEvidenceClass(qqq.beatRatePct, qqq.count)}">${escapeHtml(formatEvidencePct(qqq.beatRatePct, qqq.count))}</td>
                <td class="${Number(qqq.meanExcessPct) >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatEvidenceSignedPct(qqq.meanExcessPct, qqq.count))}</td>
              </tr>
            `;
          })
          .join("")
      : '<tr><td colspan="7">等待指数对照数据。</td></tr>';
  }

  const temperatureBody = document.querySelector("#validationTemperatureBody");
  if (temperatureBody) {
    const rows = Array.isArray(payload?.temperatureStats) ? payload.temperatureStats : [];
    temperatureBody.innerHTML = rows.length
      ? rows
          .map((row) => `
            <tr>
              <td><strong>${escapeHtml(row.regime || "--")}</strong></td>
              <td>${escapeHtml(row.horizon || "--")}</td>
              <td>${escapeHtml(row.count || "--")}</td>
              <td class="${Number(row.meanPct) >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatSignedPct(row.meanPct))}</td>
              <td class="${validationEvidenceClass(row.winRatePct, row.count)}">${escapeHtml(formatEvidencePct(row.winRatePct, row.count))}</td>
              <td class="${validationEvidenceClass(row.beatSpyRatePct, row.count)}">${escapeHtml(formatEvidencePct(row.beatSpyRatePct, row.count))}</td>
              <td class="${Number(row.meanExcessSpyPct) >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatEvidenceSignedPct(row.meanExcessSpyPct, row.count))}</td>
            </tr>
          `)
          .join("")
      : '<tr><td colspan="7">等待温度分层数据。</td></tr>';
  }

  const currentGrid = document.querySelector("#validationCurrentGrid");
  if (currentGrid) {
    const rows = Array.isArray(payload?.currentTests) ? payload.currentTests : [];
    currentGrid.innerHTML = rows.length
      ? rows
          .map((row) => {
            const five = row.fiveDay || {};
            const twenty = row.twentyDay || {};
            return `
              <article>
                <span>${escapeHtml(row.boardLabel || row.board || "--")}</span>
                <strong>${escapeHtml(row.sampleCount || 0)} 条</strong>
                <p>5日正向占比 ${escapeHtml(formatEvidencePct(five.winRatePct, five.count))}，均值 ${escapeHtml(formatEvidenceSignedPct(five.meanPct, five.count))}。</p>
                <p>20日正向占比 ${escapeHtml(formatEvidencePct(twenty.winRatePct, twenty.count))}，均值 ${escapeHtml(formatEvidenceSignedPct(twenty.meanPct, twenty.count))}。</p>
              </article>
            `;
          })
          .join("")
      : '<article><span>等待数据</span><strong>暂无</strong><p>生成验证数据后显示当前榜单体检。</p></article>';
  }
};

const setupInfoTips = () => {
  if (document.querySelector("#globalInfoTip")) return;
  document.body.classList.add("has-global-tip");
  const tip = document.createElement("div");
  tip.id = "globalInfoTip";
  tip.className = "global-info-tip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  let activeButton = null;

  const showTip = (button) => {
    const text = button?.dataset?.tip;
    if (!text) return;
    activeButton = button;
    tip.textContent = text;
    tip.classList.add("is-visible");
    const rect = button.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 28);
    const left = Math.max(14, Math.min(window.innerWidth - width - 14, rect.left + rect.width / 2 - width / 2));
    tip.style.width = `${width}px`;
    tip.style.left = `${left}px`;
    const placeBelow = rect.top < 96;
    const top = placeBelow ? rect.bottom + 10 : rect.top - tip.offsetHeight - 10;
    tip.style.top = `${Math.max(12, top)}px`;
  };

  const hideTip = () => {
    activeButton = null;
    tip.classList.remove("is-visible");
  };

  const handleEnter = (event) => {
    const button = event.target.closest(".info-tip");
    if (button) showTip(button);
  };

  const handleLeave = (event) => {
    const button = event.target.closest(".info-tip");
    if (!button || button !== activeButton) return;
    const nextTarget = event.relatedTarget;
    if (nextTarget && button.contains(nextTarget)) return;
    hideTip();
  };

  document.addEventListener("pointerover", handleEnter);
  document.addEventListener("mouseover", handleEnter);
  document.addEventListener("pointerout", handleLeave);
  document.addEventListener("mouseout", handleLeave);
  document.addEventListener("focusin", (event) => {
    const button = event.target.closest(".info-tip");
    if (button) showTip(button);
  });
  document.addEventListener("focusout", (event) => {
    if (event.target.closest(".info-tip")) hideTip();
  });
  window.addEventListener("scroll", hideTip, { passive: true });
  window.addEventListener("resize", hideTip);
};

const bindEvents = () => {
  setupInfoTips();
  document.querySelectorAll(".sidebar-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      setSidebarCollapsed(!document.body.classList.contains("is-sidebar-collapsed"));
    });
  });
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.setAttribute("aria-current", item.classList.contains("is-active") ? "page" : "false");
  });
  document.querySelectorAll(".board-tab").forEach((tab) => {
    tab.setAttribute("aria-pressed", tab.classList.contains("is-active") ? "true" : "false");
  });

  const syncPageFromLocation = () => {
    showPage(getPageFromHash(), { syncHash: false });
  };
  window.addEventListener("popstate", syncPageFromLocation);
  window.addEventListener("hashchange", syncPageFromLocation);

  const globalSearchInput = document.querySelector("#globalSearchInput");
  const globalSearchResultsPanel = document.querySelector("#globalSearchResults");
  if (globalSearchInput) {
    globalSearchInput.addEventListener("input", renderGlobalSearchResults);
    globalSearchInput.addEventListener("focus", () => {
      if (globalSearchInput.value.trim()) renderGlobalSearchResults();
    });
    globalSearchInput.addEventListener("keydown", (event) => {
      const items = flattenGlobalResults();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!items.length) renderGlobalSearchResults();
        setGlobalSearchActive(state.globalSearchIndex + 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setGlobalSearchActive(state.globalSearchIndex <= 0 ? items.length - 1 : state.globalSearchIndex - 1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        openGlobalResult(items[state.globalSearchIndex] || items[0]);
        return;
      }
      if (event.key === "Escape") {
        closeGlobalSearch();
      }
    });
  }
  if (globalSearchResultsPanel) {
    globalSearchResultsPanel.addEventListener("mousedown", (event) => {
      const item = event.target.closest("[data-global-search-result]");
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
    });
    globalSearchResultsPanel.addEventListener("click", (event) => {
      const item = event.target.closest("[data-global-search-result]");
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      openGlobalResult(item);
    });
  }
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".global-search")) closeGlobalSearch();
  });

  document.querySelectorAll("[data-page]").forEach((item) => {
    item.addEventListener("click", () => {
      if (item.dataset.disabled === "true" || item.disabled) return;
      showPage(item.dataset.page);
    });
  });

  document.querySelectorAll('a[data-disabled="true"]').forEach((item) => {
    item.addEventListener("click", (event) => event.preventDefault());
  });

  document.addEventListener("click", (event) => {
    const pageLink = event.target.closest("[data-page-link]");
    if (pageLink) {
      event.preventDefault();
      if (pageLink.dataset.disabled === "true" || pageLink.getAttribute("aria-disabled") === "true") return;
      if (pageLink.dataset.eventBoardLink) {
        state.eventBoard = pageLink.dataset.eventBoardLink;
        showPage("stock-events", { hash: `#stock-events/${state.eventBoard}` });
        const target = document.querySelector(".page-view.is-active .event-layout");
        if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
        return;
      }
      showPage(pageLink.dataset.pageLink);
      return;
    }
    const stockPreset = event.target.closest("[data-stocks-preset]");
    if (stockPreset) {
      event.preventDefault();
      state.stocksPresetFilter = stockPreset.dataset.stocksPreset || "all";
      const select = document.querySelector("#stocksPresetFilter");
      if (select) select.value = state.stocksPresetFilter;
      renderStocksPage();
      return;
    }
    const stockClear = event.target.closest("[data-stocks-clear]");
    if (stockClear) {
      event.preventDefault();
      state.stocksQuery = "";
      state.stocksPresetFilter = "all";
      state.stocksSectorFilter = "all";
      state.stocksCapFilter = "all";
      state.stocksSort = "dollarVolume";
      const queryInput = document.querySelector("#stocksSearchInput");
      const preset = document.querySelector("#stocksPresetFilter");
      const sector = document.querySelector("#stocksSectorFilter");
      const cap = document.querySelector("#stocksCapFilter");
      const sort = document.querySelector("#stocksSortFilter");
      if (queryInput) queryInput.value = "";
      if (preset) preset.value = "all";
      if (sector) sector.value = "all";
      if (cap) cap.value = "all";
      if (sort) sort.value = "dollarVolume";
      renderStocksPage();
      return;
    }
    const stockSortColumn = event.target.closest(".stocks-terminal-table th[data-sort-column]");
    if (stockSortColumn) {
      event.preventDefault();
      setStocksSort(stockSortColumn.dataset.sortColumn);
      return;
    }
    const marketVisualMode = event.target.closest("[data-market-visual-mode]");
    if (marketVisualMode) {
      event.preventDefault();
      state.marketVisualMode = marketVisualMode.dataset.marketVisualMode || "overview";
      state.marketWorkspaceSection = state.marketVisualMode === "sectors"
        ? "sectors"
        : state.marketVisualMode === "heatmap"
          ? "heatmap"
          : "movers";
      syncMarketWorkspaceTabs();
      renderMarketVisualBoard(getFilteredRows());
      return;
    }
    const marketSection = event.target.closest("[data-market-section]");
    if (marketSection) {
      event.preventDefault();
      const section = marketSection.dataset.marketSection || "movers";
      state.marketWorkspaceSection = section;
      if (section === "flows") {
        state.marketVisualMode = "overview";
        showPage("market", { hash: "#flows" });
        return;
      }
      state.marketVisualMode = section === "sectors" ? "sectors" : section === "heatmap" ? "heatmap" : "overview";
      showPage("market", { hash: section === "sectors" ? "#market/sectors" : section === "heatmap" ? "#market/heatmap" : "#market" });
      return;
    }
    const marketSectorFocus = event.target.closest("[data-market-sector-focus]");
    if (marketSectorFocus) {
      event.preventDefault();
      state.selectedMarketSector = marketSectorFocus.dataset.marketSectorFocus || "";
      state.marketWorkspaceSection = "sectors";
      state.marketVisualMode = "sectors";
      syncMarketWorkspaceTabs();
      renderMarketVisualBoard(getFilteredRows());
      renderMarketSectionContext();
      return;
    }
    const dashboardSectorOpen = event.target.closest("[data-dashboard-sector-open]");
    if (dashboardSectorOpen) {
      event.preventDefault();
      state.selectedMarketSector = dashboardSectorOpen.dataset.dashboardSectorOpen || "";
      state.marketWorkspaceSection = "sectors";
      state.marketVisualMode = "sectors";
      showPage("market", { hash: "#market/sectors" });
      renderMarketVisualBoard();
      return;
    }
    const marketSectorPick = event.target.closest("[data-market-sector-pick]");
    if (marketSectorPick) {
      event.preventDefault();
      state.selectedMarketSector = marketSectorPick.dataset.marketSectorPick || "";
      renderMarketVisualBoard();
      renderMarketSectionContext();
      return;
    }
    const sectorOpen = event.target.closest("[data-sector-open]");
    if (sectorOpen) {
      event.preventDefault();
      state.sectorFilter = sectorOpen.dataset.sectorOpen || "all";
      const sector = document.querySelector("#sectorFilter");
      if (sector) sector.value = state.sectorFilter;
      state.marketVisualMode = "overview";
      state.marketWorkspaceSection = "movers";
      if (!document.querySelector('[data-view="market"]').classList.contains("is-active")) {
        showPage("market");
        return;
      }
      syncMarketWorkspaceTabs();
      renderTable();
      return;
    }
    const flowSectorOpen = event.target.closest("[data-flow-sector-open]");
    if (flowSectorOpen) {
      event.preventDefault();
      state.selectedMarketSector = flowSectorOpen.dataset.flowSectorOpen || "";
      state.marketVisualMode = "sectors";
      state.marketWorkspaceSection = "sectors";
      showPage("market", { hash: "#market/sectors" });
      renderMarketVisualBoard();
      return;
    }
    const macroSeriesRange = event.target.closest("[data-macro-series-range]");
    if (macroSeriesRange) {
      event.preventDefault();
      state.macroSeriesRange = macroSeriesRange.dataset.macroSeriesRange || "1y";
      renderMacroSeries(state.macroSeries);
      return;
    }
    const valuationMetric = event.target.closest("[data-valuation-metric]");
    if (valuationMetric) {
      event.preventDefault();
      state.valuationMetric = valuationMetric.dataset.valuationMetric || "pe";
      renderIndexValuation(state.indexValuation);
      return;
    }
    const valuationIndex = event.target.closest("[data-valuation-index]");
    if (valuationIndex) {
      event.preventDefault();
      state.valuationIndex = String(valuationIndex.dataset.valuationIndex || "QQQ").toUpperCase();
      renderIndexValuation(state.indexValuation);
      return;
    }
    const valuationRange = event.target.closest("[data-valuation-range]");
    if (valuationRange) {
      event.preventDefault();
      state.valuationRange = valuationRange.dataset.valuationRange || "3m";
      renderIndexValuation(state.indexValuation);
      return;
    }
    const macroPoolTrigger = event.target.closest("[data-macro-pool-open]");
    if (macroPoolTrigger) {
      event.preventDefault();
      event.stopPropagation();
      applyMacroPoolFilter(macroPoolTrigger.dataset.macroPoolOpen);
      return;
    }
    const macroClearTrigger = event.target.closest("[data-clear-macro-filter]");
    if (macroClearTrigger) {
      event.preventDefault();
      clearMacroPoolFilter();
      return;
    }
    const stockTrigger = event.target.closest("[data-stock-open]");
    if (stockTrigger) {
      event.preventDefault();
      event.stopPropagation();
      openStockHub(stockTrigger.dataset.stockOpen);
      return;
    }
    const backTrigger = event.target.closest("[data-stock-back]");
    if (backTrigger) {
      event.preventDefault();
      showPage(state.stockBackPage || "market");
      return;
    }
    const watchlistToggle = event.target.closest("[data-watchlist-toggle]");
    if (watchlistToggle) {
      event.preventDefault();
      event.stopPropagation();
      const symbol = watchlistToggle.dataset.watchlistToggle;
      if (isInWatchlist(symbol)) removeFromWatchlist(symbol);
      else addToWatchlist(symbol, watchlistToggle.dataset.watchlistSource || "手动加入");
      return;
    }
    const watchlistRemove = event.target.closest("[data-watchlist-remove]");
    if (watchlistRemove) {
      event.preventDefault();
      event.stopPropagation();
      removeFromWatchlist(watchlistRemove.dataset.watchlistRemove);
      return;
    }
    const watchlistReview = event.target.closest("[data-watchlist-review]");
    if (watchlistReview) {
      event.preventDefault();
      event.stopPropagation();
      updateWatchlistReview(watchlistReview.dataset.watchlistSymbol, watchlistReview.dataset.watchlistReview);
    }
  });

  const signalStateTable = document.querySelector("#signalStateTable");
  if (signalStateTable) {
    signalStateTable.addEventListener("click", (event) => {
      const row = event.target.closest("[data-signal-symbol]");
      if (!row) return;
      state.selectedSignalSymbol = row.dataset.signalSymbol;
      renderSignalDashboard();
    });
  }

  const authButton = document.querySelector("#authButton");
  if (authButton) authButton.addEventListener("click", async () => {
    if (!state.auth.authenticated) {
      openAuthModal("登录后可查看订阅状态。付费用户可解锁交割记录和完整复盘。");
      return;
    }
    if (window.confirm("是否退出当前账号？")) {
      await apiFetch("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => null);
      window.location.reload();
    }
  });

  document.querySelectorAll("[data-auth-close]").forEach((item) => {
    item.addEventListener("click", closeAuthModal);
  });

  const authForm = document.querySelector("#authForm");
  if (authForm) authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.querySelector("#authEmail").value;
    const password = document.querySelector("#authPassword").value;
    setText("#authError", "");
    try {
      const payload = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      state.auth = {
        authenticated: Boolean(payload.authenticated),
        user: payload.user,
        entitlements: payload.entitlements || { paid: false, pro: false, proPlus: false, admin: false },
      };
      renderAuthState();
      closeAuthModal();
      if (state.auth.entitlements.admin) {
        loadAdminUsers().catch(() => null);
      }
    } catch (error) {
      setText("#authError", error.message || "登录失败");
    }
  });

  const adminCreateForm = document.querySelector("#adminCreateForm");
  if (adminCreateForm) adminCreateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(adminCreateForm);
    const payload = {
      email: form.get("email"),
      password: form.get("password"),
      role: form.get("role"),
      plan: form.get("plan"),
      subscriptionExpiresAt: form.get("subscriptionExpiresAt"),
      isActive: form.get("isActive") === "on",
    };
    setText("#adminCreateMsg", "");
    try {
      await apiFetch("/api/admin/users/create", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      adminCreateForm.reset();
      adminCreateForm.querySelector('[name="isActive"]').checked = true;
      setText("#adminCreateMsg", "用户已创建，并已记录创建人业绩归属。");
      await loadAdminUsers();
    } catch (error) {
      setText("#adminCreateMsg", error.message || "创建失败");
    }
  });

  const adminRefreshUsers = document.querySelector("#adminRefreshUsers");
  if (adminRefreshUsers) adminRefreshUsers.addEventListener("click", () => {
    loadAdminUsers().catch((error) => setText("#adminCreateMsg", error.message || "刷新失败"));
  });

  const adminUsersBody = document.querySelector("#adminUsersBody");
  if (adminUsersBody) adminUsersBody.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-admin-action]");
    if (!button) return;
    const row = button.closest("[data-admin-user-id]");
    const userId = Number(row.dataset.adminUserId);
    if (button.dataset.adminAction === "save") {
      const getField = (name) => row.querySelector(`[data-admin-field="${name}"]`);
      const payload = {
        userId,
        role: getField("role").value,
        plan: getField("plan").value,
        subscriptionExpiresAt: getField("subscriptionExpiresAt").value,
        isActive: getField("isActive").checked,
      };
      button.disabled = true;
      try {
        await apiFetch("/api/admin/users/update-plan", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        await loadAdminUsers();
      } catch (error) {
        window.alert(error.message || "保存失败");
      } finally {
        button.disabled = false;
      }
    }
    if (button.dataset.adminAction === "reset-password") {
      const password = window.prompt("输入新密码，至少 8 位");
      if (!password) return;
      try {
        await apiFetch("/api/admin/users/reset-password", {
          method: "POST",
          body: JSON.stringify({ userId, password }),
        });
        window.alert("密码已更新");
      } catch (error) {
        window.alert(error.message || "改密失败");
      }
    }
  });

  document.querySelectorAll("[data-gated-action='trade-records']").forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      unlockTradeRecords();
    });
  });

  const clearWatchlistButton = document.querySelector("#clearWatchlistButton");
  if (clearWatchlistButton) {
    clearWatchlistButton.addEventListener("click", () => {
      if (!state.watchlist.length) return;
      if (window.confirm("确定清空自选吗？")) clearWatchlist();
    });
  }

  const watchlistSearchInput = document.querySelector("#watchlistSearchInput");
  if (watchlistSearchInput) watchlistSearchInput.addEventListener("input", (event) => {
    state.watchlistQuery = event.target.value;
    renderWatchlist();
  });

  const watchlistViewFilter = document.querySelector("#watchlistViewFilter");
  if (watchlistViewFilter) watchlistViewFilter.addEventListener("change", (event) => {
    state.watchlistViewFilter = event.target.value;
    renderWatchlist();
  });

  const watchlistSourceFilter = document.querySelector("#watchlistSourceFilter");
  if (watchlistSourceFilter) watchlistSourceFilter.addEventListener("change", (event) => {
    state.watchlistSourceFilter = event.target.value;
    renderWatchlist();
  });

  document.querySelectorAll(".board-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.classList.contains("strength-tab") || tab.classList.contains("quality-tab") || tab.classList.contains("event-tab")) return;
      state.activeBoard = tab.dataset.board;
      state.rows = state.boards[state.activeBoard];
      state.selectedMarketSymbol = state.rows[0] ? state.rows[0].symbol : "";
      state.sectorFilter = "all";
      state.capFilter = "all";
      state.riskFilter = "all";
      state.directionFilter = "all";
      state.macroFilter = "all";
      document.querySelector("#sectorFilter").value = "all";
      document.querySelector("#capFilter").value = "all";
      document.querySelector("#riskFilter").value = "all";
      document.querySelector("#directionFilter").value = "all";
      document.querySelectorAll(".board-tab").forEach((item) => {
        item.classList.toggle("is-active", item === tab);
        item.setAttribute("aria-pressed", item === tab ? "true" : "false");
      });
      renderSectorOptions();
      renderStats();
      renderLeader(state.rows[0], state.meta[state.activeBoard].updatedAt);
      renderTable();
    });
  });

  document.querySelector("#searchInput").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderTable();
  });

  document.querySelector("#capFilter").addEventListener("change", (event) => {
    state.capFilter = event.target.value;
    renderTable();
  });

  document.querySelector("#sectorFilter").addEventListener("change", (event) => {
    state.sectorFilter = event.target.value;
    renderTable();
  });

  document.querySelector("#riskFilter").addEventListener("change", (event) => {
    state.riskFilter = event.target.value;
    renderTable();
  });

  document.querySelector("#directionFilter").addEventListener("change", (event) => {
    state.directionFilter = event.target.value;
    renderTable();
  });

  const gainersBody = document.querySelector("#gainersBody");
  if (gainersBody) {
    gainersBody.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      const row = event.target.closest("[data-market-symbol]");
      if (!row) return;
      state.selectedMarketSymbol = row.dataset.marketSymbol;
      renderTable();
    });
  }

  const marketCardGrid = document.querySelector("#marketCardGrid");
  if (marketCardGrid) {
    marketCardGrid.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      const row = event.target.closest("[data-market-symbol]");
      if (!row) return;
      state.selectedMarketSymbol = row.dataset.marketSymbol;
      renderTable();
    });
  }

  document.querySelectorAll(".strength-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.strengthBucket = tab.dataset.strengthBucket;
      document.querySelectorAll(".strength-tab").forEach((item) => {
        item.classList.toggle("is-active", item === tab);
        item.setAttribute("aria-pressed", item === tab ? "true" : "false");
      });
      const leader = state.strength && state.strength.rows.find((row) => row.bucket === state.strengthBucket);
      renderStrengthHero(leader);
      renderStrengthTable();
    });
  });

  const strengthSearchInput = document.querySelector("#strengthSearchInput");
  if (strengthSearchInput) strengthSearchInput.addEventListener("input", (event) => {
    state.strengthQuery = event.target.value;
    renderStrengthTable();
  });

  const strengthLabelFilter = document.querySelector("#strengthLabelFilter");
  if (strengthLabelFilter) strengthLabelFilter.addEventListener("change", (event) => {
    state.strengthLabelFilter = event.target.value;
    renderStrengthTable();
  });

  const strengthFactorFilter = document.querySelector("#strengthFactorFilter");
  if (strengthFactorFilter) strengthFactorFilter.addEventListener("change", (event) => {
    state.strengthFactorFilter = event.target.value;
    renderStrengthTable();
  });

  const strengthClear = document.querySelector("[data-strength-clear]");
  if (strengthClear) strengthClear.addEventListener("click", () => {
    state.strengthQuery = "";
    state.strengthLabelFilter = "all";
    state.strengthFactorFilter = "all";
    const search = document.querySelector("#strengthSearchInput");
    const label = document.querySelector("#strengthLabelFilter");
    const factor = document.querySelector("#strengthFactorFilter");
    if (search) search.value = "";
    if (label) label.value = "all";
    if (factor) factor.value = "all";
    renderStrengthTable();
  });

  const stocksSearchInput = document.querySelector("#stocksSearchInput");
  if (stocksSearchInput) stocksSearchInput.addEventListener("input", (event) => {
    state.stocksQuery = event.target.value;
    renderStocksPage();
  });

  const stocksPresetFilter = document.querySelector("#stocksPresetFilter");
  if (stocksPresetFilter) stocksPresetFilter.addEventListener("change", (event) => {
    state.stocksPresetFilter = event.target.value;
    renderStocksPage();
  });

  const stocksSectorFilter = document.querySelector("#stocksSectorFilter");
  if (stocksSectorFilter) stocksSectorFilter.addEventListener("change", (event) => {
    state.stocksSectorFilter = event.target.value;
    renderStocksPage();
  });

  const stocksCapFilter = document.querySelector("#stocksCapFilter");
  if (stocksCapFilter) stocksCapFilter.addEventListener("change", (event) => {
    state.stocksCapFilter = event.target.value;
    renderStocksPage();
  });

  const stocksSortFilter = document.querySelector("#stocksSortFilter");
  if (stocksSortFilter) stocksSortFilter.addEventListener("change", (event) => {
    state.stocksSort = event.target.value;
    renderStocksPage();
  });

  const calendarEarningsSearchInput = document.querySelector("#calendarEarningsSearchInput");
  if (calendarEarningsSearchInput) calendarEarningsSearchInput.addEventListener("input", (event) => {
    state.calendarEarningsQuery = event.target.value;
    renderEventsCalendar(state.eventsCalendar);
  });

  const calendarEarningsWindowFilter = document.querySelector("#calendarEarningsWindowFilter");
  if (calendarEarningsWindowFilter) calendarEarningsWindowFilter.addEventListener("change", (event) => {
    state.calendarEarningsWindow = event.target.value;
    renderEventsCalendar(state.eventsCalendar);
  });

  const calendarEarningsImpactFilter = document.querySelector("#calendarEarningsImpactFilter");
  if (calendarEarningsImpactFilter) calendarEarningsImpactFilter.addEventListener("change", (event) => {
    state.calendarEarningsImpact = event.target.value;
    renderEventsCalendar(state.eventsCalendar);
  });

  document.querySelectorAll(".quality-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.qualityBoard = tab.dataset.qualityBoard;
      state.qualityQuery = "";
      const input = document.querySelector("#qualitySearchInput");
      if (input) input.value = "";
      document.querySelectorAll(".quality-tab").forEach((item) => {
        item.classList.toggle("is-active", item === tab);
        item.setAttribute("aria-pressed", item === tab ? "true" : "false");
      });
      const rows = getQualityRows();
      state.selectedQualitySymbol = rows[0] ? rows[0].ticker : "";
      renderQualityTable();
    });
  });

  const qualitySearchInput = document.querySelector("#qualitySearchInput");
  if (qualitySearchInput) qualitySearchInput.addEventListener("input", (event) => {
    state.qualityQuery = event.target.value;
    renderQualityTable();
  });

  const qualityClear = document.querySelector("[data-quality-clear]");
  if (qualityClear) qualityClear.addEventListener("click", () => {
    state.qualityQuery = "";
    const input = document.querySelector("#qualitySearchInput");
    if (input) input.value = "";
    const rows = getQualityRows();
    state.selectedQualitySymbol = rows[0] ? rows[0].ticker : "";
    renderQualityTable();
  });

  const qualityBody = document.querySelector("#qualityBody");
  if (qualityBody) {
    qualityBody.addEventListener("click", (event) => {
      const row = event.target.closest("[data-quality-symbol]");
      if (!row) return;
      state.selectedQualitySymbol = row.dataset.qualitySymbol;
      renderQualityTable();
    });
  }

  document.querySelectorAll(".event-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.eventBoard = tab.dataset.eventBoard;
      if (window.location.hash.startsWith("#stock-events")) {
        window.history.pushState(null, "", state.eventBoard === "all" ? "#stock-events" : `#stock-events/${state.eventBoard}`);
      }
      document.querySelectorAll(".event-tab").forEach((item) => {
        item.classList.toggle("is-active", item === tab);
        item.setAttribute("aria-pressed", item === tab ? "true" : "false");
      });
      const rows = getEventRows();
      state.selectedEventSymbol = rows[0] ? normalizeStockSymbol(rows[0].ticker || rows[0].symbol) : "";
      renderEventTable();
    });
  });

  const eventSearchInput = document.querySelector("#eventSearchInput");
  if (eventSearchInput) {
    eventSearchInput.addEventListener("input", () => {
      state.eventQuery = eventSearchInput.value.trim();
      const rows = getEventRows();
      state.selectedEventSymbol = rows[0] ? normalizeStockSymbol(rows[0].ticker || rows[0].symbol) : "";
      renderEventTable();
    });
  }

  const eventScoreFilter = document.querySelector("#eventScoreFilter");
  if (eventScoreFilter) {
    eventScoreFilter.addEventListener("change", () => {
      state.eventScoreFilter = eventScoreFilter.value;
      const rows = getEventRows();
      state.selectedEventSymbol = rows[0] ? normalizeStockSymbol(rows[0].ticker || rows[0].symbol) : "";
      renderEventTable();
    });
  }

  const eventRiskFilter = document.querySelector("#eventRiskFilter");
  if (eventRiskFilter) {
    eventRiskFilter.addEventListener("change", () => {
      state.eventRiskFilter = eventRiskFilter.value;
      const rows = getEventRows();
      state.selectedEventSymbol = rows[0] ? normalizeStockSymbol(rows[0].ticker || rows[0].symbol) : "";
      renderEventTable();
    });
  }

  const eventStyleFilter = document.querySelector("#eventStyleFilter");
  if (eventStyleFilter) {
    eventStyleFilter.addEventListener("change", () => {
      state.eventStyleFilter = eventStyleFilter.value;
      const rows = getEventRows();
      state.selectedEventSymbol = rows[0] ? normalizeStockSymbol(rows[0].ticker || rows[0].symbol) : "";
      renderEventTable();
    });
  }

  const eventClear = document.querySelector("[data-event-clear]");
  if (eventClear) {
    eventClear.addEventListener("click", () => {
      state.eventQuery = "";
      state.eventScoreFilter = "all";
      state.eventRiskFilter = "all";
      state.eventStyleFilter = "all";
      const search = document.querySelector("#eventSearchInput");
      const score = document.querySelector("#eventScoreFilter");
      const risk = document.querySelector("#eventRiskFilter");
      const style = document.querySelector("#eventStyleFilter");
      if (search) search.value = "";
      if (score) score.value = "all";
      if (risk) risk.value = "all";
      if (style) style.value = "all";
      const rows = getEventRows();
      state.selectedEventSymbol = rows[0] ? normalizeStockSymbol(rows[0].ticker || rows[0].symbol) : "";
      renderEventTable();
    });
  }

  const eventBody = document.querySelector("#eventBody");
  if (eventBody) {
    eventBody.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      const row = event.target.closest("[data-event-symbol]");
      if (!row) return;
      state.selectedEventSymbol = row.dataset.eventSymbol;
      renderEventTable();
    });
  }

  const eventCardGrid = document.querySelector("#eventCardGrid");
  if (eventCardGrid) {
    eventCardGrid.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      const row = event.target.closest("[data-event-symbol]");
      if (!row) return;
      state.selectedEventSymbol = row.dataset.eventSymbol;
      renderEventTable();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAuthModal();
    const stockSortColumn = event.target.closest?.(".stocks-terminal-table th[data-sort-column]");
    if (stockSortColumn && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      setStocksSort(stockSortColumn.dataset.sortColumn);
    }
  });
};

const init = async () => {
  const bootstrap = await productApiJson("/bootstrap");
  if (!bootstrap?.ytd || !bootstrap?.movers) {
    throw new Error("产品数据库启动数据不可用");
  }
  const ytdData = bootstrap.ytd;
  const moversData = bootstrap.movers;
  state.watchlist = safeReadJson(WATCHLIST_STORAGE_KEY, []);
  initSidebarState();
  state.productMeta = bootstrap.meta || null;
  state.core = bootstrap.core;
  state.strength = bootstrap.strength;
  state.strengthReview = bootstrap.strengthReview;
  state.sectorFlow = bootstrap.sectorFlow;
  state.marketTemperature = bootstrap.marketTemperature;
  const knownRows = [
    ...ytdData.rows,
    ...moversData.boards.day.rows,
    ...moversData.boards.week.rows,
    ...(moversData.boards.month?.rows || []),
    ...(moversData.boards.volume?.rows || []),
  ];
  const nameMap = Object.fromEntries(knownRows.map((row) => [row.symbol, row]));
  const strengthRows = state.strength && Array.isArray(state.strength.rows) ? state.strength.rows : [];
  const monthRows = strengthRows
    .map((row) => enrichMarketRow(row, nameMap))
    .sort((a, b) => getChange(b) - getChange(a));
  const uniqueMonthRows = uniqueBySymbol(monthRows)
    .slice(0, 80)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  const volumeRows = strengthRows
    .map((row) => ({ ...enrichMarketRow(row, nameMap), change: parseSignedPercent(row.periods && row.periods["1d"]) }))
    .sort((a, b) => parseRatio(b.volumeRatio) - parseRatio(a.volumeRatio));
  const uniqueVolumeRows = uniqueBySymbol(volumeRows)
    .slice(0, 80)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  state.boards = {
    ytd: ytdData.rows.map((row) => ({ ...row, change: row.changeYtd })),
    day: moversData.boards.day.rows,
    week: moversData.boards.week.rows,
    month: moversData.boards.month?.rows || uniqueMonthRows,
    volume: moversData.boards.volume?.rows || uniqueVolumeRows,
  };
  state.meta = {
    ytd: {
      title: "美股年内涨幅榜",
      subtitle: "按今年以来累计涨幅排序，适合快速找强势股、高波动股和风险释放后的候选。",
      badge: "年内涨幅第一",
      periodLabel: "年内",
      referenceLabel: "年初估算价",
      updatedAt: ytdData.updatedAt,
    },
    day: {
      ...moversData.boards.day,
      subtitle: "同时看上一交易日大涨和大跌，快速识别异动、风险释放和短线情绪。",
      badge: "1D 最大上涨",
      updatedAt: moversData.updatedAt,
    },
    week: {
      ...moversData.boards.week,
      subtitle: "按近一周涨跌幅排序，适合发现连续走强、连续杀跌和反转候选。",
      badge: "周涨幅第一",
      updatedAt: moversData.updatedAt,
    },
    month: {
      ...(moversData.boards.month || {}),
      title: "美股近一月涨跌幅榜",
      subtitle: "按近 20 个交易日涨跌幅排序，适合观察中短期趋势是否已经走出来。",
      badge: "近一月涨幅第一",
      periodLabel: "近一月",
      referenceLabel: "月初估算价",
      updatedAt: moversData.updatedAt || state.strength?.asOf,
    },
    volume: {
      ...(moversData.boards.volume || {}),
      title: "美股成交额异动榜",
      subtitle: "按成交额相对平时的放大倍数排序，适合发现资金突然聚集的标的。",
      badge: "成交额异动第一",
      periodLabel: "1D",
      referenceLabel: "成交额",
      volumeLabel: "成交额倍数",
      multipleLabel: "成交额倍数",
      referenceMode: "volume",
      multipleMode: "volumeRatio",
      updatedAt: moversData.updatedAt || state.strength?.asOf,
    },
  };
  state.rows = state.boards[state.activeBoard];
  renderSectorOptions();
  renderStats();
  renderLeader(state.rows[0], state.meta[state.activeBoard].updatedAt);
  renderTable();
  renderCoreSignals(state.core);
  renderMarketTemperature(state.marketTemperature);
  renderDashboardVisualBoard();
  renderDashboardIntelligence();
  renderDashboardRegimeRadar();
  renderLeader(state.rows[0], state.meta[state.activeBoard].updatedAt);
  renderTable();
  renderStrengthScanner(state.strength);
  renderWatchlist();
  renderModuleGrid();
  renderDataStatus();
  bindEvents();
  const globalSearchInput = document.querySelector("#globalSearchInput");
  if (globalSearchInput?.value.trim()) renderGlobalSearchResults();
  await refreshAuth();
  showPage(getPageFromHash(), { syncHash: false });
  window.setTimeout(() => {
    loadProductSectors().then(() => {
      renderDashboardIntelligence();
      if (state.marketWorkspaceSection === "flows") renderFlowsPage();
    });
    loadLazyDataset("eventOpportunities");
    loadProductCalendar().then((calendar) => {
      if (calendar) renderEventsCalendar(calendar);
      else loadLazyDataset("eventsCalendar");
    });
  }, 300);
};

init().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  document.querySelector("#gainersBody").innerHTML = `
    <tr>
      <td colspan="11">数据加载失败：${error.message}</td>
    </tr>
  `;
});

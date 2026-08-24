import { Fragment, lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from "react";
import {
  api,
  AuthStatus,
  BootstrapPayload,
  CalendarEvent,
  CryptoEtfFlowPayload,
  CourseSeries,
  FundingScannerRow,
  KeyLevel,
  IndexValuationIndex,
  IndexValuationMetric,
  IndexValuationPayload,
  MacroSeriesIndicator,
  MacroSeriesPayload,
  MarketRow,
  MarketTemperaturePayload,
  OpenPortfolioPayload,
  Opinion,
  PriceHistoryPoint,
  SectorFlowPayload,
  SignalState,
  StrengthRow,
  StrengthScannerPayload,
  TemperatureIndicator,
  TrackingKeyLevels,
  SymbolDetailPayload,
  SymbolRow,
  WatchlistItem
} from "./api";
import { calculatePositionSizing, type PositionDirection, type PositionSizingResult } from "./positionSizing";
import type { CryptoEtfAssetKey, CryptoEtfInterval } from "./CryptoEtfChart";
import { ReversalDcaPage, ValueDcaPage } from "./DcaStrategyPages";
import RollingToolPage from "./RollingToolPage";
import RetailSentimentView from "./RetailSentimentView";
import {
  legacyMigrationNavItems,
  memberToolNavItems,
  pageAccessRules,
  pageLabels,
  primaryNavItems,
  secondaryNavItems,
  toolDataPageNavItems,
  validPageKeys,
  type AccessLevel,
  type NavItem,
  type PageKey
} from "./productConfig";
import {
  LockedStockName,
  SignalDirectionBadge,
  compactMoney,
  exactMoney,
  exactPercent,
  formatDate,
  formatDateTime,
  formatStoredDateTime,
  inputMoneyNumber,
  isBlankValue,
  marketCapDisplay,
  money,
  moneyNumber,
  priceDisplay,
  ratioDisplay,
  signed,
  signedClass,
  signedExactMoney,
  trackingDirection,
  trackingDirectionClass
} from "./shared";

type AuthMode = "login" | "register" | "forgot" | "reset";
type StockSource = "stocks" | "tracking" | "watchlist" | "search";
type SharedDataSource = "bootstrap" | "opinions" | "calendar" | "signals";

const CryptoEtfChart = lazy(() => import("./CryptoEtfChart"));
const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const superAdminLoginName = "admin";
const volumeRatioHelp = "当前成交额相对近20日平均成交额的倍数，越高代表成交越活跃。";
const keyLevelsHelp = "根据近120个交易日的价格拐点、波动区间和均线自动计算，仅作观察参考。";
const marketTemperatureHelp = "市场温度怎么看\n分数越高，市场整体越强；分数越低，市场风险越高。\n70–100 偏强：市场较强，可以积极找机会，但不要盲目追高\n50–69 中性：方向不清，等走势更明确再操作\n0–49 防守：风险较高，少追涨、控制仓位\n根据恐慌指数、利率、通胀、美元、原油及标普和纳指趋势综合计算，仅用于判断市场环境，不代表未来一定上涨或下跌。";
const marketTemperatureAdvice: Record<string, string> = {
  偏强: "市场较强，可重点观察强势股",
  中性: "方向不清，等待走势确认",
  防守: "风险较高，少追涨、控仓位",
  待更新: "数据更新中",
};

type RouteState = {
  page: PageKey;
  opinionId: string;
  symbol: string;
  stockSource: StockSource;
  courseId: string;
  resetToken: string;
};

function InfoTip({ text, focusable = false }: { text: string; focusable?: boolean }) {
  return (
    <span className="infoTip" aria-label={text} tabIndex={focusable ? 0 : undefined}>
      <span className="infoTipIcon" aria-hidden="true">i</span>
      <span className="infoTipBubble" role="tooltip">{text}</span>
    </span>
  );
}

function VolumeRatioLabel() {
  return <>成交倍数<InfoTip text={volumeRatioHelp} /></>;
}

function readRouteState(): RouteState {
  const params = new URLSearchParams(window.location.search);
  const pageParam = params.get("page") as PageKey | null;
  const sourceParam = params.get("source");
  return {
    page: params.get("page") === "bottom" ? "dca2" : pageParam && validPageKeys.has(pageParam) ? pageParam : "home",
    opinionId: params.get("opinion") || "",
    symbol: (params.get("symbol") || "").trim().toUpperCase(),
    stockSource: sourceParam === "tracking" || sourceParam === "watchlist" || sourceParam === "search" ? sourceParam : "stocks",
    courseId: params.get("course") || "",
    resetToken: params.get("resetToken") || ""
  };
}

function pushRouteState(route: Partial<RouteState> & { page: PageKey }) {
  const url = new URL(window.location.href);
  url.search = "";
  if (route.page !== "home") url.searchParams.set("page", route.page);
  if (route.page === "opinions" && route.opinionId) url.searchParams.set("opinion", route.opinionId);
  if (route.page === "stocks" && route.symbol) {
    url.searchParams.set("symbol", route.symbol);
    if (route.stockSource && route.stockSource !== "stocks") url.searchParams.set("source", route.stockSource);
  }
  if (route.page === "courses" && route.courseId) url.searchParams.set("course", route.courseId);
  window.history.pushState(null, "", url);
}

const trackingSymbols = [
  "AAPL",
  "AMD",
  "ARM",
  "ASML",
  "AVGO",
  "AXTI",
  "DRAM",
  "IBM",
  "INTC",
  "LITE",
  "MU",
  "NVDA",
  "QQQ",
  "RKLB",
  "SNDK",
  "SOXL",
  "SPCX",
  "SPX",
  "SPY",
  "STX",
  "TSM",
  "WDC",
  "MRVL",
  "DELL",
  "AMAT",
  "000660",
  "005930"
];

const trackingSymbolNames: Record<string, string> = {
  AAPL: "Apple Inc.",
  AMD: "Advanced Micro Devices",
  ARM: "Arm Holdings",
  ASML: "ASML Holding",
  AVGO: "Broadcom Inc.",
  AXTI: "AXT Inc.",
  DRAM: "Global X DRAM ETF",
  IBM: "International Business Machines",
  INTC: "Intel Corp",
  LITE: "Lumentum Holdings",
  MU: "Micron Technology",
  NVDA: "NVIDIA Corp",
  QQQ: "Invesco QQQ Trust",
  RKLB: "Rocket Lab",
  SNDK: "Sandisk",
  SOXL: "Direxion Daily Semiconductor Bull 3X",
  SPCX: "SPAC and New Issue ETF",
  SPX: "S&P 500 Index",
  SPY: "SPDR S&P 500 ETF",
  STX: "Seagate Technology",
  TSM: "Taiwan Semiconductor",
  WDC: "Western Digital",
  MRVL: "Marvell Technology",
  DELL: "Dell Technologies",
  AMAT: "Applied Materials",
  "000660": "SK Hynix",
  "005930": "Samsung Electronics"
};

const sectionLabels: Record<string, string> = {
  weekly: "周度前瞻",
  crypto: "加密相关",
  premarket: "盘前前瞻",
  daily: "个股观点",
  research: "研报解析",
  postmarket: "盘后复盘",
  journal: "交易日记"
};

function opinionSectionLabel(item?: Pick<Opinion, "section" | "sectionLabel"> | null) {
  if (!item) return pageLabels.opinions;
  return sectionLabels[item.section] || item.sectionLabel || pageLabels.opinions;
}

function isHomepageOpinion(item: Opinion) {
  if (!sectionLabels[item.section]) return false;
  if ((item.title || "").trim().length < 2) return false;
  return item.status === "published";
}

function dayDistanceLabel(value?: string | null) {
  if (isBlankValue(value)) return "--";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return formatDate(value);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  if (days === -1) return "昨天";
  return days > 0 ? `${days}天后` : `${Math.abs(days)}天前`;
}

function isFutureOrToday(value?: string | null) {
  if (isBlankValue(value)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return false;
  return target.getTime() >= today.getTime();
}

function isFutureDate(value?: string | null) {
  if (isBlankValue(value)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return false;
  return target.getTime() > today.getTime();
}

function weekdayLabel(value?: string | null) {
  if (isBlankValue(value)) return "--";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "--";
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
}

function eventTypeLabel(type?: string) {
  if (type === "macro") return "宏观";
  if (type === "earnings") return "财报";
  return "事件";
}

function calendarTitle(title?: string | null) {
  if (isBlankValue(title)) return "--";
  const text = String(title || "").trim();
  if (!text) return "--";
  if (/employment situation/i.test(text) || text.includes("非农")) return "美国非农就业";
  if (/fomc/i.test(text)) return "FOMC 议息会议";
  return text;
}

function impactLabel(impact?: string) {
  if (impact === "high") return "高";
  if (impact === "medium") return "中";
  return "低";
}

function impactClass(impact?: string) {
  if (impact === "high") return "impactHigh";
  if (impact === "medium") return "impactMedium";
  return "impactLow";
}

function calendarTime24(time?: string | null) {
  if (isBlankValue(time)) return "时间待定";
  const value = String(time || "").trim();
  if (!value || value === "time-not-supplied") return "时间待定";
  if (/before market open/i.test(value)) return "盘前";
  if (/after market close/i.test(value)) return "盘后";
  if (value.includes("ET")) {
    const match = value.match(/(\d{2}):(\d{2})/);
    if (!match) return value.replace(" ET", "");
    return `${String((Number(match[1]) + 12) % 24).padStart(2, "0")}:${match[2]}:00`;
  }
  const match = value.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) return `${match[1]}:${match[2]}:${match[3] || "00"}`;
  return value.replace("至 ", "至 ");
}

function calendarSummaryText(event: CalendarEvent) {
  const summary = cleanCalendarSummary(event.summary);
  const actual = isFutureDate(event.date) ? "" : calendarValue(event.actualLabel, event.actualValue);
  const forecast = calendarValue(event.forecastLabel, event.forecastValue);
  const previous = calendarValue(event.previousLabel, event.previousValue);
  if (actual) {
    return `实际 ${actual}${forecast ? ` / 预期 ${forecast}` : ""}${previous ? ` / 前值 ${previous}` : ""}`;
  }
  if (forecast || previous) {
    return `${forecast ? `预期 ${forecast}` : ""}${previous ? ` / 前值 ${previous}` : ""}`.replace(/^ \/ /, "");
  }
  return summary;
}

function cleanCalendarSummary(summary?: string | null) {
  return String(summary || "")
    .replace(/；?状态\s+confirmed。?/gi, "")
    .replace(/；?状态\s+\w+。?/gi, "")
    .replace(/\s+/g, " ")
    .replace(/。$/, "")
    .trim();
}

function calendarSummaryParts(event: CalendarEvent) {
  const parts = cleanCalendarSummary(event.summary).split(/[；;]/).map((part) => part.trim()).filter(Boolean);
  return { lead: parts[0] || "", detail: parts.slice(1).join(" / ") };
}

function calendarEventSubtext(event: CalendarEvent) {
  if (event.type !== "earnings") return "";
  return calendarSummaryParts(event).lead;
}

function calendarDataText(event: CalendarEvent) {
  const actual = isFutureDate(event.date) ? "" : calendarValue(event.actualLabel, event.actualValue);
  const forecast = calendarValue(event.forecastLabel, event.forecastValue);
  const previous = calendarValue(event.previousLabel, event.previousValue);
  const metricText = [
    actual ? `实际 ${actual}` : "",
    forecast ? `预期 ${forecast}` : "",
    previous ? `前值 ${previous}` : ""
  ].filter(Boolean).join(" / ");
  if (metricText) return metricText;
  const parts = calendarSummaryParts(event);
  if (parts.detail) return parts.detail;
  if (event.type === "earnings" && parts.lead.includes("：")) return parts.lead.split("：").slice(1).join("：");
  return parts.lead;
}

function calendarValue(label?: string | number | null, value?: string | number | null) {
  if (!isBlankValue(label)) return String(label).trim();
  if (isBlankValue(value)) return "";
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? String(value).trim() : "";
}

function macroResultValue(event: CalendarEvent, label?: string | number | null, value?: string | number | null) {
  const display = calendarValue(label, value);
  if (!display || event.resultKind !== "jobs") return display;
  const numeric = Number(String(value ?? display).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(numeric)) return display;
  const wan = numeric / 10;
  return `${Number.isInteger(wan) ? wan.toFixed(0) : wan.toFixed(1)}万`;
}

type CoreMacroKind = "cpi" | "jobs" | "rate";

const coreMacroTabs: Array<{ key: CoreMacroKind; label: string }> = [
  { key: "cpi", label: "CPI" },
  { key: "jobs", label: "非农" },
  { key: "rate", label: "FOMC" }
];

function coreMacroKind(event?: CalendarEvent | null): CoreMacroKind | null {
  if (!event) return null;
  if (event.resultKind === "cpi" || event.resultKind === "jobs" || event.resultKind === "rate") return event.resultKind;
  const title = String(event.title || "").toLowerCase();
  if (title.includes("cpi") || title.includes("consumer price")) return "cpi";
  if (title.includes("非农") || title.includes("employment situation") || title.includes("nonfarm") || title.includes("payroll")) return "jobs";
  if (title.includes("fomc") || title.includes("利率决议")) return "rate";
  return null;
}

function macroChangeText(event?: CalendarEvent | null, kind?: CoreMacroKind | null) {
  if (!event || event.actualValue == null || event.previousValue == null || !kind) return "--";
  const actual = kind === "cpi" ? Number(Number(event.actualValue).toFixed(1)) : Number(event.actualValue);
  const previous = kind === "cpi" ? Number(Number(event.previousValue).toFixed(1)) : Number(event.previousValue);
  const change = actual - previous;
  if (!Number.isFinite(change)) return "--";
  if (Math.abs(change) < 1e-9) return "不变";
  if (kind === "jobs") {
    const wan = Math.abs(change) / 10;
    const value = Number.isInteger(wan) ? wan.toFixed(0) : wan.toFixed(1);
    return `${change > 0 ? "增加" : "减少"} ${value}万`;
  }
  const value = Math.abs(change).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${change > 0 ? "上升" : "下降"} ${value}个百分点`;
}

function macroDateTime(event?: CalendarEvent | null, short = false) {
  if (!event) return "--";
  const day = formatDate(event.date);
  return `${short ? day.slice(5) : day} ${calendarTime24(event.time)}`;
}

function compactText(value?: string | null, max = 88) {
  if (isBlankValue(value)) return "";
  const text = String(value || "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/(^|\s)\d+[.)]\s*/g, " ")
    .replace(/[#>*_`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function formatOpinionTime(value?: string | null) {
  if (isBlankValue(value)) return "--";
  const text = String(value || "").trim();
  if (!text) return "--";
  if (/\b00:00(?::00)?$/.test(text)) return formatDate(text);
  return /\d{2}:\d{2}/.test(text) ? formatDateTime(text) : formatDate(text);
}

function normalizeImageUrl(url: string) {
  const clean = url.trim();
  if (clean.startsWith("/api/uploads/")) {
    return `/api/upload?path=${encodeURIComponent(clean.replace(/^\/api\/uploads\//, ""))}`;
  }
  return clean;
}

function richBodyNodes(markdown?: string | null) {
  const source = String(markdown || "").trim();
  if (!source) return [];
  const imageRegex = /!\[([^\]]*)]\(([^)]+)\)/g;
  const nodes: ReactNode[] = [];
  const blocks = source.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  blocks.forEach((block, blockIndex) => {
    if (/^#{1,3}\s+/.test(block)) {
      nodes.push(<h2 key={`h-${blockIndex}`}>{block.replace(/^#{1,3}\s+/, "").trim()}</h2>);
      return;
    }
    const lines = block.split(/\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length && lines.every((line) => /^[-*]\s+/.test(line))) {
      const items = lines.map((line) => line.replace(/^[-*]\s+/, "").trim()).filter(Boolean);
      nodes.push(
        <ul key={`ul-${blockIndex}`}>
          {items.map((item, itemIndex) => <li key={`${blockIndex}-${itemIndex}`}>{item}</li>)}
        </ul>
      );
      return;
    }
    if (lines.length && lines.every((line) => /^\d+[.)]\s*/.test(line))) {
      const items = lines.map((line) => line.replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean);
      nodes.push(
        <ol key={`ol-${blockIndex}`}>
          {items.map((item, itemIndex) => <li key={`${blockIndex}-${itemIndex}`}>{item}</li>)}
        </ol>
      );
      return;
    }
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let localIndex = 0;
    imageRegex.lastIndex = 0;
    while ((match = imageRegex.exec(block))) {
      const text = block.slice(lastIndex, match.index).trim();
      if (text) nodes.push(<p key={`p-${blockIndex}-${localIndex}`}>{text}</p>);
      nodes.push(
        <figure key={`img-${blockIndex}-${localIndex}`} className="readerFigure">
          <img src={normalizeImageUrl(match[2])} alt={match[1] || "观点配图"} loading="lazy" />
        </figure>
      );
      lastIndex = match.index + match[0].length;
      localIndex += 1;
    }
    const rest = block.slice(lastIndex).trim();
    if (rest) nodes.push(<p key={`p-${blockIndex}-rest`}>{rest}</p>);
  });
  return nodes;
}

function firstReadableParagraph(markdown?: string | null, fallback?: string | null) {
  if (isBlankValue(markdown) && isBlankValue(fallback)) return "";
  const source = String(markdown || fallback || "").trim();
  if (!source) return "";
  const blocks = source.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const paragraph = blocks.find((block) => {
    if (/^#{1,6}\s+/.test(block)) return false;
    if (/!\[[^\]]*]\([^)]*\)/.test(block)) return false;
    return block.replace(/[#>*_`-]/g, "").trim().length > 8;
  });
  const text = String(paragraph || fallback || source)
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function richCourseSummary(summary: string, fallback: string) {
  const nodes = richBodyNodes(summary);
  return nodes.length ? nodes : <p>{fallback}</p>;
}

function courseProgressLabel(status?: CourseSeries["progressStatus"]) {
  return status === "finished" ? "已完结" : "更新中";
}

function coursePriceText(value?: string) {
  const text = String(value || "").trim();
  if (!text) return "";
  const clean = text.replace(/^[$￥¥]\s*/, "");
  return /^\d/.test(clean) ? `$${clean.replace(/u$/i, "")}` : clean;
}

function courseDiscountBlock(course: CourseSeries, className = "courseDiscountBlock") {
  const current = coursePriceText(course.discountPrice);
  const original = coursePriceText(course.originalPrice);
  const label = String(course.discountLabel || "").trim();
  if (!current && !original && !label) return null;
  return (
    <div className={className}>
      <p>
        {current ? <strong>{current}</strong> : null}
        {original ? <em>{original}</em> : null}
        {label ? <span>{label}</span> : null}
      </p>
    </div>
  );
}

function courseGrantText(course: CourseSeries) {
  if (!course.unlocked) return "联系开通";
  return course.grantExpiresAt ? `到期 ${formatDate(course.grantExpiresAt)}` : "已授权";
}

function opinionDisplayTitle(item?: Opinion | null, max = 56) {
  if (!item) return "--";
  const sectionLabel = opinionSectionLabel(item);
  let title = isBlankValue(item.title) ? "" : String(item.title).trim();
  if (sectionLabel && title.startsWith(sectionLabel)) title = title.slice(sectionLabel.length).trim();
  title = title.replace(/#[^\s#]+/g, "").replace(/\s+/g, " ").trim();
  if (!title || title === sectionLabel || Object.values(sectionLabels).includes(title)) {
    title = firstReadableParagraph(item.body, item.summary) || sectionLabel || pageLabels.opinions;
  }
  return title.length > max ? `${title.slice(0, max)}...` : title;
}

function signalBatchDate(signal: SignalState) {
  return String(signal.updatedAt || "").match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
}

function latestSignalBatchDate(states: SignalState[]) {
  return states.reduce((latest, item) => {
    const date = signalBatchDate(item);
    return date > latest ? date : latest;
  }, "");
}

function latestSignalStates(states: SignalState[]) {
  const latest = latestSignalBatchDate(states);
  return latest ? states.filter((item) => signalBatchDate(item) === latest) : [];
}

type TrackingSortKey = "symbol" | "currentPrice" | "oneMonth" | "oneDay" | "oneWeek" | "volume" | "marketCap" | "signal" | "signalFirstSeen";
type StockSortKey = "symbol" | "dayChange" | "weekChange" | "monthChange" | "ytdChange" | "dollarVolume" | "marketCap";
type SortDir = "asc" | "desc";

function trackingSortValue(row: ReturnType<typeof mergedTrackingRows>[number], key: TrackingSortKey) {
  if (key === "symbol") return row.symbol;
  if (key === "currentPrice") return Number(row.currentPrice);
  if (key === "oneMonth") return numericPercent(row.oneMonth);
  if (key === "oneDay") return numericPercent(row.oneDay);
  if (key === "oneWeek") return numericPercent(row.oneWeek);
  if (key === "volume") return Number(String(row.volume || "").replace("x", ""));
  if (key === "marketCap") return row.marketCapValue ?? moneyNumber(row.marketCap);
  if (key === "signal") return trackingDirection(row);
  if (key === "signalFirstSeen") return Date.parse(row.signalFirstSeen || "");
  return "";
}

function compareTrackingRows(a: ReturnType<typeof mergedTrackingRows>[number], b: ReturnType<typeof mergedTrackingRows>[number], key: TrackingSortKey, dir: SortDir) {
  const av = trackingSortValue(a, key);
  const bv = trackingSortValue(b, key);
  const missingA = av === "" || (typeof av === "number" && !Number.isFinite(av));
  const missingB = bv === "" || (typeof bv === "number" && !Number.isFinite(bv));
  if (missingA || missingB) return missingA === missingB ? 0 : missingA ? 1 : -1;
  const result = typeof av === "number" && typeof bv === "number"
    ? av - bv
    : String(av).localeCompare(String(bv), "zh-CN");
  return dir === "asc" ? result : -result;
}

function getSectorRows(bootstrap: BootstrapPayload | null) {
  return bootstrap?.sectorFlow?.rows || bootstrap?.sectorFlow?.sectors || [];
}

function isDisplaySector(sector?: string | null) {
  const value = String(sector || "").trim().toUpperCase();
  return !!value && value !== "未分类" && value !== "ETF";
}

function treemapRects(items: Array<{ value: number }>) {
  const layouts: Array<{ x: number; y: number; w: number; h: number }> = [];
  const split = (entries: Array<{ index: number; value: number }>, x: number, y: number, w: number, h: number) => {
    if (!entries.length) return;
    if (entries.length === 1) {
      layouts[entries[0].index] = { x, y, w, h };
      return;
    }
    const total = entries.reduce((sum, item) => sum + item.value, 0);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < entries.length - 1; i += 1) {
      if (Math.abs(total / 2 - (acc + entries[i].value)) <= Math.abs(total / 2 - acc)) {
        acc += entries[i].value;
        cut = i + 1;
      }
    }
    const ratio = acc / total;
    const head = entries.slice(0, cut);
    const tail = entries.slice(cut);
    if (w >= h) {
      split(head, x, y, w * ratio, h);
      split(tail, x + w * ratio, y, w * (1 - ratio), h);
    } else {
      split(head, x, y, w, h * ratio);
      split(tail, x, y + h * ratio, w, h * (1 - ratio));
    }
  };
  split(items.map((item, index) => ({ ...item, index })).sort((a, b) => b.value - a.value), 0, 0, 100, 100);
  return layouts;
}

function numericPercent(value?: number | string | null) {
  if (isBlankValue(value)) return NaN;
  if (typeof value === "number") return value;
  return Number(String(value).replace("%", "").replace("+", ""));
}

function stockCompany(row?: SymbolRow | null) {
  if (!row) return "--";
  return !isBlankValue(row.company) ? row.company! : !isBlankValue(row.chineseName) ? row.chineseName! : row.symbol;
}

function planLabel(auth: AuthStatus | null) {
  if (!auth?.authenticated) return "登录";
  if (auth.entitlements?.admin) return auth.user?.role === "super_admin" ? "超级管理员" : "管理员";
  if (!auth.entitlements?.paid) return "免费账号";
  const plan = auth.user?.plan === "yearly" ? "年度会员" : auth.user?.plan === "monthly" ? "月度会员" : "付费会员";
  const expire = auth.user?.subscriptionExpiresAt ? `${formatDate(auth.user.subscriptionExpiresAt)} 到期` : "未设置到期";
  return `${plan} · ${expire}`;
}

function accountName(auth: AuthStatus | null) {
  if (auth?.entitlements?.admin) return "懂币猫";
  return auth?.user?.email || "账号";
}

function accessRank(auth: AuthStatus | null) {
  if (!auth?.authenticated) return 0;
  if (auth.entitlements?.admin) return 2;
  if (!auth.entitlements?.paid && !auth.entitlements?.pro && !auth.entitlements?.proPlus) return 0;
  if (auth.entitlements?.yearly || auth.user?.plan === "yearly" || auth.user?.plan === "paid") return 2;
  return 1;
}

function requiredRank(level?: AccessLevel) {
  if (level === "yearly") return 2;
  if (level === "monthly") return 1;
  return 0;
}

function hasPageAccess(auth: AuthStatus | null, page: PageKey) {
  if (pageAccessRules[page]?.level === "registered") return Boolean(auth?.authenticated);
  return accessRank(auth) >= requiredRank(pageAccessRules[page]?.level);
}

function pageNeedsBootstrap(page: PageKey) {
  return page === "home" || page === "tracking" || page === "market";
}

function bootstrapLimitForPage(page: PageKey) {
  return page === "market" ? 500 : 4;
}

function pageNeedsOpinions(page: PageKey) {
  return page === "home" || page === "opinions";
}

function pageNeedsCalendar(page: PageKey) {
  return page === "home" || page === "calendar";
}

function pageNeedsSignals(page: PageKey) {
  return page === "home" || page === "tracking" || page === "stocks";
}

function rowName(row?: MarketRow | StrengthRow | null) {
  if (!row) return "--";
  const company = "company" in row ? row.company : "";
  const chineseName = "chineseName" in row ? row.chineseName : "";
  const name = "name" in row ? row.name : "";
  const fallbackName = trackingSymbolNames[row.symbol || ""];
  return company || chineseName || name || fallbackName || row.symbol || "--";
}

function mergedTrackingRows(bootstrap: BootstrapPayload | null, signalStates: SignalState[] = []) {
  if (!bootstrap) return [];
  const signalMap = new Map(latestSignalStates(signalStates).map((item) => [item.symbol, item]));
  const dayMap = new Map((bootstrap.movers?.boards?.day?.rows || []).map((row) => [row.symbol, row]));
  const weekMap = new Map((bootstrap.movers?.boards?.week?.rows || []).map((row) => [row.symbol, row]));
  const monthMap = new Map((bootstrap.movers?.boards?.month?.rows || []).map((row) => [row.symbol, row]));
  const ytdMap = new Map((bootstrap.ytd?.rows || []).map((row) => [row.symbol, row]));
  const strengthMap = new Map((bootstrap.strength?.rows || []).map((row) => [row.symbol, row]));
  return trackingSymbols
    .map((symbol) => {
      const dayMarket = dayMap.get(symbol);
      const weekMarket = weekMap.get(symbol);
      const monthMarket = monthMap.get(symbol);
      const ytdMarket = ytdMap.get(symbol);
      const market = monthMarket || dayMarket || weekMarket || ytdMarket;
      const strength = strengthMap.get(symbol);
      const signal = signalMap.get(symbol);
      const month = strength?.periods?.["20d"] ?? signed(monthMarket?.change);
      const day = strength?.periods?.["1d"] ?? signed(dayMarket?.change);
      const week = strength?.periods?.["5d"] ?? signed(weekMarket?.change);
      return {
        symbol,
        name: rowName(strength || market || { symbol }),
        sector: strength?.sectorProxy || strength?.sector || market?.sector || "--",
        status: strength?.label || "--",
        action: strength?.action || "--",
        primaryFactor: strength?.primaryFactor || "--",
        onBoard: strength?.onBoard?.label || "",
        firstSeen: strength?.onBoard?.firstSeen || "",
        signalDirection: signal?.direction || "",
        signalDirectionText: signal?.directionText || "",
        signalFirstSeen: signal?.firstSignalAt || "",
        currentPrice: signal?.livePrice || signal?.price || strength?.price || market?.price || "",
        oneDay: day,
        oneWeek: week,
        oneMonth: month,
        volume: ratioDisplay(strength?.crowding?.volumeRatio || dayMarket?.volumeRatio || monthMarket?.volumeRatio),
        liquidity: strength?.liquidity || money(dayMarket?.dollarVolume || monthMarket?.dollarVolume),
        marketCap: strength?.marketCap || market?.marketCap || "--",
        marketCapValue: market?.marketCapValue ?? null,
        keyLevels: dayMarket?.keyLevels,
        priceHistory: dayMarket?.priceHistory || [],
        scoreValue: Number(String(month).replace("%", "").replace("+", "")) || -999
      };
    })
    .sort((a, b) => b.scoreValue - a.scoreValue);
}

function App() {
  const initialRoute = useMemo(() => readRouteState(), []);
  const [page, setPage] = useState<PageKey>(initialRoute.page);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authFailed, setAuthFailed] = useState(false);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [bootstrapLimit, setBootstrapLimit] = useState(0);
  const [opinions, setOpinions] = useState<Opinion[]>([]);
  const [calendar, setCalendar] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [bootstrapLoading, setBootstrapLoading] = useState(pageNeedsBootstrap(initialRoute.page));
  const [opinionsLoading, setOpinionsLoading] = useState(pageNeedsOpinions(initialRoute.page));
  const [opinionsLoaded, setOpinionsLoaded] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(pageNeedsCalendar(initialRoute.page));
  const [calendarLoaded, setCalendarLoaded] = useState(false);
  const [signalStates, setSignalStates] = useState<SignalState[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(pageNeedsSignals(initialRoute.page));
  const [signalsLoaded, setSignalsLoaded] = useState(false);
  const [sharedDataFailures, setSharedDataFailures] = useState<Partial<Record<SharedDataSource, boolean>>>({});
  const [selectedOpinion, setSelectedOpinion] = useState<string>(initialRoute.opinionId);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(initialRoute.symbol);
  const [selectedCourse, setSelectedCourse] = useState<string>(initialRoute.courseId);
  const [selectedSymbolSource, setSelectedSymbolSource] = useState<StockSource>(initialRoute.stockSource);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>(initialRoute.resetToken ? "reset" : "login");
  const [resetToken, setResetToken] = useState(initialRoute.resetToken);
  const [globalSearch, setGlobalSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavCloseRef = useRef<HTMLButtonElement>(null);

  const refreshAuth = useCallback(() => {
    setAuthFailed(false);
    return api.auth()
      .then((payload) => {
        setAuth(payload);
        return payload;
      })
      .catch((error) => {
        setAuthFailed(true);
        throw error;
      });
  }, []);

  const setSharedDataFailure = useCallback((source: SharedDataSource, failed: boolean) => {
    setSharedDataFailures((current) => current[source] === failed ? current : { ...current, [source]: failed });
  }, []);

  const refreshBootstrap = useCallback((limit: number) => {
    setBootstrapLoading(true);
    setSharedDataFailure("bootstrap", false);
    return api.bootstrap(limit, trackingSymbols)
      .then((payload) => {
        setBootstrap(payload);
        setBootstrapLimit(limit);
      })
      .catch(() => setSharedDataFailure("bootstrap", true))
      .finally(() => setBootstrapLoading(false));
  }, [setSharedDataFailure]);

  const refreshOpinions = useCallback(() => {
    setOpinionsLoading(true);
    setSharedDataFailure("opinions", false);
    return api.opinions(12)
      .then((payload) => {
        setOpinions(payload.rows || []);
        setOpinionsLoaded(true);
      })
      .catch(() => setSharedDataFailure("opinions", true))
      .finally(() => setOpinionsLoading(false));
  }, [setSharedDataFailure]);

  const refreshCalendar = useCallback(() => {
    setCalendarLoading(true);
    setSharedDataFailure("calendar", false);
    return Promise.allSettled([
      api.calendar({ limit: 4, windowDays: "45", type: "macro" }),
      api.calendar({ limit: 4, windowDays: "45", type: "earnings" })
    ])
      .then(([macro, earnings]) => {
        const rows = [macro, earnings].flatMap((result) => result.status === "fulfilled" ? result.value.rows || [] : []);
        if (!rows.length && macro.status === "rejected" && earnings.status === "rejected") throw macro.reason;
        setCalendar(rows);
        setCalendarLoaded(true);
      })
      .catch(() => setSharedDataFailure("calendar", true))
      .finally(() => setCalendarLoading(false));
  }, [setSharedDataFailure]);

  const refreshSignals = useCallback(() => {
    setSignalsLoading(true);
    setSharedDataFailure("signals", false);
    return api.signals()
      .then((payload) => {
        setSignalStates(payload.states || []);
        setSignalsLoaded(true);
      })
      .catch(() => setSharedDataFailure("signals", true))
      .finally(() => setSignalsLoading(false));
  }, [setSharedDataFailure]);

  const openAuth = useCallback((mode: AuthMode = "login") => {
    setAuthMode(mode);
    setAuthModalOpen(true);
  }, []);
  const requestUnlock = useCallback(() => {
    if (!auth?.authenticated) {
      openAuth("register");
      return;
    }
    setUnlockModalOpen(true);
  }, [auth?.authenticated, openAuth]);

  useEffect(() => {
    if (!initialRoute.resetToken) return;
    setAuthMode("reset");
    setAuthModalOpen(true);
  }, [initialRoute.resetToken]);

  const requireLogin = useCallback(() => {
    if (auth?.authenticated) return true;
    openAuth("register");
    return false;
  }, [auth?.authenticated, openAuth]);

  useEffect(() => {
    void refreshAuth()
      .catch(() => undefined)
      .finally(() => setLoading(false));
    if (pageNeedsBootstrap(initialRoute.page)) void refreshBootstrap(bootstrapLimitForPage(initialRoute.page));
    if (pageNeedsOpinions(initialRoute.page)) {
      void refreshOpinions().then(() => setSelectedOpinion((current) => current || initialRoute.opinionId || ""));
    }
    if (pageNeedsCalendar(initialRoute.page)) void refreshCalendar();
    if (pageNeedsSignals(initialRoute.page)) void refreshSignals();
  }, [initialRoute.opinionId, initialRoute.page, refreshAuth, refreshBootstrap, refreshCalendar, refreshOpinions, refreshSignals]);

  useEffect(() => {
    const requiredLimit = bootstrapLimitForPage(page);
    if (!pageNeedsBootstrap(page) || bootstrapLimit >= requiredLimit || bootstrapLoading || sharedDataFailures.bootstrap) return;
    void refreshBootstrap(requiredLimit);
  }, [bootstrapLimit, bootstrapLoading, page, refreshBootstrap, sharedDataFailures.bootstrap]);

  useEffect(() => {
    if (!pageNeedsOpinions(page) || opinionsLoaded || opinionsLoading || sharedDataFailures.opinions) return;
    void refreshOpinions();
  }, [opinionsLoaded, opinionsLoading, page, refreshOpinions, sharedDataFailures.opinions]);

  useEffect(() => {
    if (!pageNeedsCalendar(page) || calendarLoaded || calendarLoading || sharedDataFailures.calendar) return;
    void refreshCalendar();
  }, [calendarLoaded, calendarLoading, page, refreshCalendar, sharedDataFailures.calendar]);

  useEffect(() => {
    if (!pageNeedsSignals(page) || signalsLoaded || signalsLoading || sharedDataFailures.signals) return;
    void refreshSignals();
  }, [page, refreshSignals, sharedDataFailures.signals, signalsLoaded, signalsLoading]);

  useEffect(() => {
    const onPopState = () => {
      const route = readRouteState();
      setPage(route.page);
      setSelectedOpinion(route.opinionId);
      setSelectedSymbol(route.symbol);
      setSelectedCourse(route.courseId);
      setSelectedSymbolSource(route.stockSource);
      setMobileNavOpen(false);
      setMobileSearchOpen(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return;
    window.requestAnimationFrame(() => mobileNavCloseRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    document.body.classList.add("mobileNavLocked");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("mobileNavLocked");
      window.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
    };
  }, [mobileNavOpen]);

  const navigatePage = useCallback((nextPage: PageKey) => {
    if (!requireLogin()) return;
    setMobileNavOpen(false);
    setMobileSearchOpen(false);
    setPage(nextPage);
    setSelectedOpinion("");
    setSelectedSymbol("");
    setSelectedCourse("");
    setSelectedSymbolSource("stocks");
    pushRouteState({ page: nextPage });
    void api.analyticsEvent("nav_click", nextPage).catch(() => {});
    if (pageNeedsOpinions(nextPage)) void refreshOpinions();
    if (pageNeedsCalendar(nextPage)) void refreshCalendar();
    if (pageNeedsSignals(nextPage)) void refreshSignals();
  }, [refreshCalendar, refreshOpinions, refreshSignals, requireLogin]);

  const clearOpinion = useCallback(() => {
    if (!requireLogin()) return;
    setSelectedOpinion("");
    pushRouteState({ page: "opinions" });
  }, [requireLogin]);

  const selectOpinion = useCallback((id: string) => {
    if (!requireLogin()) return;
    setSelectedOpinion(id);
    pushRouteState({ page: "opinions", opinionId: id });
  }, [requireLogin]);

  const selectOpinionItem = useCallback((item: Opinion) => {
    if (!requireLogin()) return;
    setOpinions((current) => {
      if (current.some((opinion) => opinion.id === item.id)) return current;
      return [item, ...current];
    });
    selectOpinion(item.id);
  }, [requireLogin, selectOpinion]);

  const selectSymbol = useCallback((symbol: string, source: StockSource = "stocks") => {
    if (!requireLogin()) return;
    const nextSymbol = symbol.trim().toUpperCase();
    setSelectedSymbol(nextSymbol);
    setSelectedSymbolSource(source);
    setPage("stocks");
    pushRouteState({ page: "stocks", symbol: nextSymbol, stockSource: source });
  }, [requireLogin]);

  const selectCourse = useCallback((courseId: string) => {
    if (!requireLogin()) return;
    setPage("courses");
    setSelectedCourse(courseId);
    pushRouteState({ page: "courses", courseId });
  }, [requireLogin]);

  const clearCourse = useCallback(() => {
    if (!requireLogin()) return;
    setSelectedCourse("");
    pushRouteState({ page: "courses" });
  }, [requireLogin]);

  const submitGlobalSearch = (event: FormEvent) => {
    event.preventDefault();
    if (!requireLogin()) return;
    const nextSymbol = globalSearch.trim().toUpperCase();
    if (!nextSymbol) return;
    setSelectedSymbol(nextSymbol);
    setSelectedSymbolSource("search");
    setPage("stocks");
    setMobileNavOpen(false);
    setMobileSearchOpen(false);
    pushRouteState({ page: "stocks", symbol: nextSymbol, stockSource: "search" });
  };

  const trackingRows = useMemo(() => mergedTrackingRows(bootstrap, signalStates), [bootstrap, signalStates]);
  const latestOpinion = opinions[0];
  const selected = opinions.find((item) => item.id === selectedOpinion) || latestOpinion;
  const gatedRule = page === "opinions" || page === "tracking" || page === "dca1" || page === "dca2" ? undefined : pageAccessRules[page];
  const pageUnlocked = hasPageAccess(auth, page);
  const onboardingOpen = Boolean(
    auth?.authenticated &&
    auth.user?.role === "user" &&
    !auth.user?.onboardingSeenAt
  );
  const opinionsLocked = page === "opinions" && !pageUnlocked;
  const homeOpinionsLocked = !hasPageAccess(auth, "opinions");
  const homeTrackingLocked = !hasPageAccess(auth, "tracking");
  const activeNavPage = page === "stocks" && selectedSymbol
    ? selectedSymbolSource === "tracking" ? "tracking" : selectedSymbolSource === "watchlist" ? "watchlist" : "stocks"
    : page;
  const gateGuestClick = useCallback((event: MouseEvent<HTMLElement>) => {
    if (auth?.authenticated) return;
    const target = event.target as HTMLElement | null;
    if (!target || target.closest(".authOverlay, .accountButton, .mobileNavigationControl, .appDataError, .requestRetry")) return;
    const interactive = target.closest("button, a, input, select, textarea, tr, [role='button']");
    if (!interactive) return;
    event.preventDefault();
    event.stopPropagation();
    openAuth("register");
  }, [auth?.authenticated, openAuth]);
  const pageDataLoading =
    page !== "home" && (
      (pageNeedsBootstrap(page) && bootstrapLimit < bootstrapLimitForPage(page) && !sharedDataFailures.bootstrap) ||
      (pageNeedsOpinions(page) && !opinionsLoaded && !sharedDataFailures.opinions) ||
      (pageNeedsCalendar(page) && !calendarLoaded && !sharedDataFailures.calendar) ||
      (pageNeedsSignals(page) && !signalsLoaded && !sharedDataFailures.signals)
    );
  const pageDataFailed =
    (pageNeedsBootstrap(page) && bootstrapLimit < bootstrapLimitForPage(page) && sharedDataFailures.bootstrap) ||
    (pageNeedsOpinions(page) && sharedDataFailures.opinions) ||
    (pageNeedsCalendar(page) && sharedDataFailures.calendar) ||
    (pageNeedsSignals(page) && sharedDataFailures.signals);
  const retryPageData = () => {
    if (pageNeedsBootstrap(page) && bootstrapLimit < bootstrapLimitForPage(page) && sharedDataFailures.bootstrap) {
      void refreshBootstrap(bootstrapLimitForPage(page));
    }
    if (pageNeedsOpinions(page) && sharedDataFailures.opinions) void refreshOpinions();
    if (pageNeedsCalendar(page) && sharedDataFailures.calendar) void refreshCalendar();
    if (pageNeedsSignals(page) && sharedDataFailures.signals) void refreshSignals();
  };
  const renderNavItems = (items: NavItem[]) => items.map((item) => (
    <button
      type="button"
      key={item.key}
      className={`${activeNavPage === item.key ? "active" : ""} ${item.disabled ? "disabled" : ""}`}
      disabled={item.disabled}
      onClick={() => navigatePage(item.key)}
    >
      <span>{item.label}</span>
      {item.status ? <em>{item.status}</em> : null}
    </button>
  ));

  return (
    <main className="terminalShell" onClickCapture={gateGuestClick}>
      <aside className={`sideRail ${mobileNavOpen ? "mobileOpen" : ""}`} aria-label="网站导航">
        <div className="sideRailHeader">
          <a className="brand" href="/" onClick={() => setMobileNavOpen(false)}>
            <img src="/assets/dongbimao-logo.png?v=20260824" alt="" width="38" height="38" />
            <span>
              <strong>懂币猫</strong>
              <small>美股投研</small>
            </span>
          </a>
          <button ref={mobileNavCloseRef} type="button" className="mobileNavClose mobileNavigationControl" aria-label="关闭菜单" onClick={() => setMobileNavOpen(false)}>×</button>
        </div>
        <nav>{renderNavItems(primaryNavItems)}</nav>
        <div className="navToolGroup">
          <p className="navGroupTitle">其他</p>
          {renderNavItems(secondaryNavItems)}
        </div>
        <div className="navToolGroup">
          <p className="navGroupTitle">会员工具</p>
          {renderNavItems(memberToolNavItems)}
        </div>
        {auth?.entitlements?.admin ? (
          <div className="navToolGroup">
            <p className="navGroupTitle">管理员工具</p>
              {renderNavItems(toolDataPageNavItems)}
              {legacyMigrationNavItems.map((item) => (
                <a key={item.href} href={item.href} onClick={() => setMobileNavOpen(false)}>{item.label}</a>
              ))}
          </div>
        ) : null}
        <div className="mobileDrawerAccount">
          {auth?.authenticated && auth.user ? (
            <>
              <span><strong>{accountName(auth)}</strong><small>{planLabel(auth)}</small></span>
              <button type="button" className="accountButton" onClick={() => { setMobileNavOpen(false); void api.logout().then(refreshAuth); }}>退出</button>
            </>
          ) : (
            <button type="button" className="accountButton" onClick={() => { setMobileNavOpen(false); openAuth("login"); }}>登录 / 注册</button>
          )}
        </div>
        <div className="sideSlogan" aria-label="品牌标语">
          <strong>市场永远不缺机会，缺的是等到机会时还活着的本金。</strong>
          <span>The market never runs out of opportunities.</span>
        </div>
      </aside>
      <button type="button" tabIndex={-1} className={`mobileNavBackdrop mobileNavigationControl ${mobileNavOpen ? "visible" : ""}`} aria-label="关闭菜单" onClick={() => setMobileNavOpen(false)} />

      <section className="workspace" inert={mobileNavOpen}>
        <header className="mobileShellBar">
          <a className="mobileShellBrand" href="/">
            <img src="/assets/dongbimao-logo.png?v=20260824" alt="" width="34" height="34" />
            <span><strong>懂币猫</strong><small>美股投研</small></span>
          </a>
          <div>
            <button type="button" className="mobileShellButton mobileSearchButton mobileNavigationControl" aria-label={mobileSearchOpen ? "关闭搜索" : "搜索"} aria-expanded={mobileSearchOpen} onClick={() => setMobileSearchOpen((value) => !value)}><span /></button>
            <button ref={mobileMenuButtonRef} type="button" className="mobileShellButton mobileMenuButton mobileNavigationControl" aria-label="打开菜单" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}><span /></button>
          </div>
        </header>
        {mobileSearchOpen ? (
          <form className="mobileGlobalSearch" onSubmit={submitGlobalSearch}>
            <input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="搜索股票代码" aria-label="搜索股票代码" autoFocus />
          </form>
        ) : null}
        <header className={`topbar ${page === "home" ? "homeTopbar" : ""} ${page === "calendar" ? "calendarTopbar" : ""}`}>
          {page !== "calendar" ? (
            <form className="globalSearch" onSubmit={submitGlobalSearch}>
              <input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="搜索股票代码" aria-label="搜索股票代码" />
            </form>
          ) : null}
          {auth?.authenticated && auth.user ? (
            <details className="accountMenu">
              <summary className="accountButton">{accountName(auth)}</summary>
              <div className="accountPanel">
                <strong>{accountName(auth)}</strong>
                <span>UID {auth.user.uid || "--"}</span>
                {auth.entitlements?.admin ? <span>ID {auth.user.id}</span> : null}
                <span>{planLabel(auth)}</span>
                <button type="button" onClick={() => api.logout().then(refreshAuth)}>退出</button>
              </div>
            </details>
          ) : (
            <button className="accountButton" onClick={() => openAuth("login")}>登录</button>
          )}
        </header>

        {loading || (!loading && pageDataLoading) ? <div className="loading" /> : null}
        {!loading && authFailed ? (
          <div className="marketToolError compact appDataError authStatusError" role="alert">
            <span>登录状态加载失败</span>
            <button type="button" className="requestRetry" onClick={() => void refreshAuth().catch(() => undefined)}>重新加载</button>
          </div>
        ) : null}
        {!loading && pageDataFailed ? (
          <div className="marketToolError compact appDataError" role="alert">
            <span>页面数据加载失败</span>
            <button type="button" className="requestRetry" onClick={retryPageData}>重新加载</button>
          </div>
        ) : null}
        {!loading && !pageDataLoading ? (
          <GatedPage rule={gatedRule} unlocked={pageUnlocked} authenticated={Boolean(auth?.authenticated)} onAuth={openAuth} onUnlock={requestUnlock}>
            {page === "home" ? (
              <HomePage bootstrap={bootstrap} opinions={opinions} calendar={calendar} trackingRows={trackingRows} opinionsLocked={homeOpinionsLocked} trackingLocked={homeTrackingLocked} authenticated={Boolean(auth?.authenticated)} onAuth={openAuth} onUnlock={requestUnlock} onPage={navigatePage} />
            ) : null}
            {page === "opinions" ? (
              <OpinionsPage
                opinions={opinions}
                selected={selected}
                selectedId={selectedOpinion}
                onSelect={selectOpinionItem}
                onBack={clearOpinion}
                locked={opinionsLocked}
                authenticated={Boolean(auth?.authenticated)}
                onAuth={openAuth}
                onUnlock={requestUnlock}
              />
            ) : null}
            {page === "tracking" ? <TrackingPage rows={trackingRows} asOf={bootstrap?.strength?.asOf || bootstrap?.meta?.generatedAt} locked={!pageUnlocked} authenticated={Boolean(auth?.authenticated)} onAuth={openAuth} onUnlock={requestUnlock} onOpenStock={selectSymbol} /> : null}
            {page === "market" ? <MarketPage bootstrap={bootstrap} onPage={navigatePage} /> : null}
            {page === "risk" ? <MarketTemperaturePage enabled={pageUnlocked} /> : null}
            {page === "strength" ? <MarketStrengthPage enabled={pageUnlocked} onOpenStock={selectSymbol} /> : null}
            {page === "valuation" ? <IndexValuationPage enabled={pageUnlocked} /> : null}
            {page === "stocks" && selectedSymbol ? (
              <StockDetailPage
                symbol={selectedSymbol}
                rows={trackingRows}
                backLabel={selectedSymbolSource === "tracking" ? pageLabels.tracking : selectedSymbolSource === "watchlist" ? pageLabels.watchlist : pageLabels.stocks}
                onBack={() => navigatePage(selectedSymbolSource === "tracking" ? "tracking" : selectedSymbolSource === "watchlist" ? "watchlist" : "stocks")}
                onOpenStock={(nextSymbol) => selectSymbol(nextSymbol, selectedSymbolSource)}
              />
            ) : null}
            {page === "stocks" && !selectedSymbol ? <StocksPage signalStates={signalStates} onSelectSymbol={(nextSymbol) => selectSymbol(nextSymbol, "stocks")} /> : null}
            {page === "calendar" ? <CalendarPage initialEvents={calendar} /> : null}
            {page === "open" ? <OpenPortfolioPage enabled={pageUnlocked} /> : null}
            {page === "watchlist" ? <WatchlistPage enabled={pageUnlocked} onOpenStock={selectSymbol} /> : null}
            {page === "dca1" ? <ValueDcaPage unlocked={pageUnlocked} authenticated={Boolean(auth?.authenticated)} onAuth={() => openAuth("login")} onUnlock={requestUnlock} /> : null}
            {page === "dca2" ? <ReversalDcaPage unlocked={pageUnlocked} authenticated={Boolean(auth?.authenticated)} onAuth={() => openAuth("login")} onUnlock={requestUnlock} /> : null}
            {page === "position" ? <PositionSizingPage /> : null}
            {page === "rolling" && pageUnlocked ? <RollingToolPage /> : null}
            {page === "funding" ? <FundingArbitragePage isAdmin={Boolean(auth?.entitlements?.admin)} /> : null}
            {page === "forum" ? <ComingSoonPage title="论坛讨论区" /> : null}
            {page === "courses" ? <CoursesPage enabled={pageUnlocked} viewerKey={auth?.user?.id || 0} courseId={selectedCourse} onCourse={selectCourse} onBack={clearCourse} onUnlock={requestUnlock} /> : null}
          </GatedPage>
        ) : null}
        <AuthModal
          mode={authMode}
          resetToken={resetToken}
          open={authModalOpen}
          onMode={setAuthMode}
          onClose={() => setAuthModalOpen(false)}
          onResetDone={() => {
            setResetToken("");
            window.history.replaceState(null, "", window.location.pathname);
          }}
          onDone={() => void refreshAuth().catch(() => undefined).finally(() => setAuthModalOpen(false))}
        />
        <UnlockContactModal open={unlockModalOpen} onClose={() => setUnlockModalOpen(false)} />
        <OnboardingModal
          open={onboardingOpen}
          onDone={() => api.markOnboardingSeen().then((payload) => setAuth(payload))}
        />
      </section>
    </main>
  );
}

function GatedPage({
  rule,
  unlocked,
  authenticated,
  onAuth,
  onUnlock,
  children
}: {
  rule?: { level: AccessLevel; title: string; text: string };
  unlocked: boolean;
  authenticated: boolean;
  onAuth: (mode: AuthMode) => void;
  onUnlock: () => void;
  children: ReactNode;
}) {
  if (!rule || unlocked) return <>{children}</>;
  const registeredOnly = rule.level === "registered";
  return (
    <div className="gatedPage">
      <div className="gatedPreview" aria-hidden="true">{children}</div>
	      <section className="membershipGate" aria-live="polite">
	        <span aria-hidden="true" />
	        <strong>{registeredOnly ? "注册后查看" : "开通查看完整内容"}</strong>
	        <button type="button" onClick={() => authenticated ? onUnlock() : onAuth("register")}>
	          {authenticated ? "联系管理员开通" : registeredOnly ? "注册 / 登录" : "注册后开通"}
	        </button>
	      </section>
    </div>
  );
}

function UnlockContactModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value);
  };
  return (
    <div className="unlockOverlay" role="dialog" aria-modal="true" aria-label="开通联系方式">
      <section className="unlockPanel">
        <div className="unlockHead">
          <div>
            <h2>开通查看完整内容</h2>
            <p>添加小助理，备注注册邮箱。</p>
          </div>
          <button type="button" className="unlockClose" onClick={onClose}>×</button>
        </div>
        <div className="unlockBody">
          <article className="unlockContactCard">
            <img src="/assets/unlock-telegram.jpg" alt="Telegram 二维码" />
            <div className="unlockContactMeta">
              <div><span>Telegram</span><strong>@dongbimaozhuli</strong></div>
              <button type="button" onClick={() => copy("@dongbimaozhuli")}>复制</button>
            </div>
          </article>
          <article className="unlockContactCard">
            <img src="/assets/unlock-qq.jpg" alt="QQ 二维码" />
            <div className="unlockContactMeta">
              <div><span>QQ</span><strong>2450855628</strong></div>
              <button type="button" onClick={() => copy("2450855628")}>复制</button>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

function OnboardingModal({ open, onDone }: { open: boolean; onDone: () => Promise<unknown> }) {
  const [saving, setSaving] = useState(false);
  if (!open) return null;
  const done = () => {
    setSaving(true);
    onDone().finally(() => setSaving(false));
  };
  return (
    <div className="onboardingOverlay" role="dialog" aria-modal="true" aria-label="风险免责声明">
      <section className="onboardingPanel">
        <div className="onboardingHead">
          <span>使用前请确认</span>
          <h2>风险免责声明</h2>
        </div>
        <div className="onboardingSteps riskNoticeBody">
          <article>
            <strong>信息用途</strong>
            <p>本平台提供的市场信息、观点内容、数据整理、工具计算和持仓记录，仅供学习交流与研究参考使用，不构成任何投资、法律、税务、会计或其他专业建议。</p>
          </article>
          <article>
            <strong>非投资建议</strong>
            <p>本平台内容不构成对任何股票、ETF、期权、数字资产或其他金融产品的买入、卖出、持有、申购、赎回或配置建议，也不构成任何收益承诺。</p>
          </article>
          <article>
            <strong>用户独立判断</strong>
            <p>本平台内容未针对你的个人财务状况、投资目标、交易经验、风险承受能力或账户条件进行定制。你应基于自身情况独立判断，并在必要时咨询持牌专业人士。</p>
          </article>
          <article>
            <strong>信息准确性</strong>
            <p>本平台会尽力保证信息的及时性和准确性，但不保证所有内容、数据、价格、计算结果或展示记录完整、准确、及时或持续可用。相关信息可能存在延迟、遗漏、错误或过期。</p>
          </article>
          <article>
            <strong>交易风险</strong>
            <p>股票、ETF、期权、数字资产、保证金交易、做空、杠杆交易及套利策略均存在风险。市场波动、流动性不足、滑点、交易限制、强制平仓、交易所或券商规则变化等情况，可能导致损失扩大；部分交易可能造成超过本金的损失。</p>
          </article>
          <article>
            <strong>工具与记录</strong>
            <p>本平台的扫描器、仓位工具、资金曲线、Open 持仓参考和历史交易记录，仅按现有数据和输入条件进行展示或估算，不代表真实账户结果，不保证适合实际交易，也不应作为交易依据。</p>
          </article>
          <article>
            <strong>确认继续</strong>
            <p>点击“同意并继续”即表示你已阅读、理解并接受以上风险提示，并确认后续基于本平台内容作出的任何判断、交易或操作，均由你自行承担相应风险和结果。</p>
          </article>
        </div>
        <p className="riskAgreeText">点击同意表示你已阅读并理解以上内容，确认继续使用本站。</p>
        <button type="button" onClick={done} disabled={saving}>{saving ? "处理中" : "同意并继续"}</button>
      </section>
    </div>
  );
}

function AuthModal({
  open,
  mode,
  resetToken,
  onMode,
  onClose,
  onResetDone,
  onDone
}: {
  open: boolean;
  mode: AuthMode;
  resetToken: string;
  onMode: (mode: AuthMode) => void;
  onClose: () => void;
  onResetDone: () => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  if (!open) return null;
  const isRegister = mode === "register";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    const cleanEmail = email.trim();
    if (!isReset && (!cleanEmail || cleanEmail.length > 254)) {
      setError(mode === "login" ? "账号或密码不正确" : "请输入正确邮箱");
      return;
    }
    if (!isReset && !emailPattern.test(cleanEmail) && !(mode === "login" && cleanEmail.toLowerCase() === superAdminLoginName)) {
      setError(mode === "login" ? "账号或密码不正确" : "请输入正确邮箱");
      return;
    }
    if (isRegister || isReset) {
      if (password.length < 8) {
        setError("密码至少 8 位");
        return;
      }
      if (password.length > 128) {
        setError("密码不能超过 128 位");
        return;
      }
      if (password !== confirmPassword) {
        setError("两次密码不一致");
        return;
      }
    }
    setSubmitting(true);
    const request = isForgot
      ? api.forgotPassword(cleanEmail)
      : isReset
        ? api.resetPassword(resetToken, password)
        : (isRegister ? api.register(cleanEmail, password) : api.login(cleanEmail, password));
    request
      .then((payload) => {
        if (isForgot) {
          setSuccess((payload as { message?: string }).message || "如果邮箱存在，我们会发送重置链接。");
          return;
        }
        if (isReset) {
          onResetDone();
          setSuccess("密码已重置，请登录");
          onMode("login");
          return;
        }
        onDone();
      })
      .catch((err) => {
        setSuccess("");
        const message = err instanceof Error ? err.message.trim() : "";
        const technicalFailure = !message || /failed to fetch|load failed|networkerror|请求失败/i.test(message);
        setError(technicalFailure
          ? isRegister ? "暂时无法注册，请稍后重试" : isReset ? "暂时无法重置，请稍后重试" : isForgot ? "暂时无法发送，请稍后重试" : "暂时无法登录，请稍后重试"
          : message);
      })
      .finally(() => setSubmitting(false));
  };
  const title = isRegister ? "注册账号" : isForgot ? "找回密码" : isReset ? "设置新密码" : "登录账号";
  return (
    <div className="authOverlay" role="dialog" aria-modal="true">
      <form className="authPanel" onSubmit={submit}>
	        <button className="authClose" type="button" onClick={onClose}>×</button>
	        <h2>{title}</h2>
	        {!isReset ? <label>
	          邮箱
	          <input type="text" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoComplete={isRegister || isForgot ? "email" : "username"} maxLength={254} autoFocus required />
	        </label> : null}
	        {!isForgot ? <label>
	          密码
	          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={isRegister ? "至少 8 位密码" : "请输入密码"} autoComplete={isRegister ? "new-password" : "current-password"} minLength={8} maxLength={128} required />
	        </label> : null}
	        {isRegister || isReset ? (
	          <label>
	            确认密码
	            <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入密码" autoComplete="new-password" minLength={8} maxLength={128} required />
	          </label>
	        ) : null}
        {error ? <p className="authError">{error}</p> : null}
        {success ? <p className="authSuccess">{success}</p> : null}
        <button className="authSubmit" type="submit" disabled={submitting}>{submitting ? "处理中" : isForgot ? "发送重置邮件" : isReset ? "确认重置" : isRegister ? "注册" : "登录"}</button>
        {!isRegister && !isForgot && !isReset ? <button className="authSwitch" type="button" onClick={() => onMode("forgot")}>忘记密码？</button> : null}
        <button className="authSwitch" type="button" onClick={() => onMode(isRegister || isForgot || isReset ? "login" : "register")}>
          {isRegister || isForgot || isReset ? "返回登录" : "还没有账号？注册"}
        </button>
      </form>
    </div>
  );
}

function HomePage({
  bootstrap,
  opinions,
  calendar,
  trackingRows,
  opinionsLocked,
  trackingLocked,
  authenticated,
  onAuth,
  onUnlock,
  onPage
}: {
  bootstrap: BootstrapPayload | null;
  opinions: Opinion[];
  calendar: CalendarEvent[];
  trackingRows: ReturnType<typeof mergedTrackingRows>;
  opinionsLocked: boolean;
  trackingLocked: boolean;
  authenticated: boolean;
  onAuth: (mode: AuthMode) => void;
  onUnlock: () => void;
  onPage: (page: PageKey) => void;
}) {
  const [temperature, setTemperature] = useState<MarketTemperaturePayload | null>(null);

  useEffect(() => {
    if (!authenticated) {
      setTemperature(null);
      return;
    }
    let active = true;
    api.marketTemperature()
      .then((payload) => { if (active) setTemperature(payload); })
      .catch(() => { if (active) setTemperature(null); });
    return () => { active = false; };
  }, [authenticated]);

  const opinionRows = opinions.filter(isHomepageOpinion);
  const latest = opinionRows.find((item) => item.featured) || opinionRows.find((item) => (item.summary || item.body || "").length > 40) || opinionRows[0];
  const focusRows = trackingRows
    .filter((row) => row.oneMonth !== "--")
    .slice(0, 4)
    .map((row) => ({
      ...row,
      displayName: row.name && row.name !== row.symbol ? row.name : trackingSymbolNames[row.symbol] || row.name || row.symbol
    }));
  const sectorRows = getSectorRows(bootstrap)
    .filter((row) => isDisplaySector(row.sector))
    .slice(0, 4);
  const stockRows = (bootstrap?.movers?.boards?.day?.rows || [])
    .filter((row) => row.symbol)
    .sort((a, b) => Number(b.change ?? b.changeYtd ?? -Infinity) - Number(a.change ?? a.changeYtd ?? -Infinity))
    .slice(0, 4);
  const eventRows = calendar
    .filter((item) => isFutureOrToday(item.date))
    .sort((a, b) => {
      const aHigh = a.impact === "high" ? 0 : 1;
      const bHigh = b.impact === "high" ? 0 : 1;
      const dateCompare = String(a.date || "").localeCompare(String(b.date || ""));
      return dateCompare || aHigh - bHigh || String(a.time || "").localeCompare(String(b.time || ""));
    });
  const macroEvent = eventRows.find((item) => item.type === "macro");
  const earningsRows = eventRows.filter((item) => item.type === "earnings").slice(0, 2);
  const pressureIndicator = temperature?.indicators?.find((item) => item.status === "watch") || null;
  const hasMacroSignal = Boolean(macroEvent && !isBlankValue(macroEvent.title) && !isBlankValue(macroEvent.date));
  const hasPressureSignal = Boolean(pressureIndicator && !isBlankValue(pressureIndicator.name) && !isBlankValue(pressureIndicator.value));
  const leadSector = sectorRows.find((row) => !isBlankValue(row.sector) && Number.isFinite(Number(row.netFlowProxy)) && Number(row.netFlowProxy) !== 0);
  const hasSectorSignal = Boolean(leadSector);
  const marketSignalCount = Number(hasMacroSignal) + Number(hasPressureSignal) + Number(hasSectorSignal);
  const trackingUpdatedAt = bootstrap?.strength?.asOf || bootstrap?.meta?.generatedAt;
  const sectorUpdatedAt = bootstrap?.sectorFlow?.asOf;
  const stocksUpdatedAt = bootstrap?.movers?.updatedAt;
  return (
    <div className="frontHomePage">
      {marketSignalCount ? (
        <section
          className="frontHomeMarketStrip"
          aria-label="今日市场"
          style={{ "--front-home-market-count": marketSignalCount } as CSSProperties}
        >
          {hasMacroSignal && macroEvent ? (
            <button type="button" onClick={() => onPage("calendar")}>
              <span>下个重点</span>
              <strong>{calendarTitle(macroEvent.title)}</strong>
              <small>{dayDistanceLabel(macroEvent.date)} · {calendarTime24(macroEvent.time)}</small>
            </button>
          ) : null}
          {hasPressureSignal && pressureIndicator ? (
            <button type="button" onClick={() => onPage("risk")}>
              <span>主要压力</span>
              <strong>{pressureIndicator.name}</strong>
              <small>{pressureIndicator.value}</small>
            </button>
          ) : null}
          {hasSectorSignal && leadSector ? (
            <button type="button" onClick={() => onPage("market")}>
              <span>资金领先</span>
              <strong>{leadSector.sector}</strong>
              <small className={signedClass(leadSector.netFlowProxy)}>{money(leadSector.netFlowProxy)}</small>
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="frontHomeBoard">
        <article className="frontLeadPanel">
          <div className="frontLeadMeta">
            <span>猫言猫语</span>
            {latest?.tradeDate ? <time>更新于 {formatOpinionTime(latest.tradeDate)}</time> : null}
          </div>
          <h1>{latest?.title || pageLabels.opinions}</h1>
          <div className={opinionsLocked ? "frontLeadPreview locked" : "frontLeadPreview"}>
            <p>{latest?.summary || compactText(latest?.body, 110) || "--"}</p>
          </div>
          <div className="frontLeadActions">
            {opinionsLocked ? <span>会员可见</span> : null}
            <button type="button" onClick={() => onPage("opinions")}>{opinionsLocked ? "查看完整观点" : `进入${pageLabels.opinions}`}</button>
          </div>
        </article>

        <aside className="frontQuickPanel">
          <div className="frontPanelHead">
            <strong>{pageLabels.calendar}</strong>
            <button type="button" onClick={() => onPage("calendar")}>查看日历</button>
          </div>
          {macroEvent ? (
            <button type="button" className="frontCalendarFeature" onClick={() => onPage("calendar")}>
              <span>宏观重点</span>
              <strong>{calendarTitle(macroEvent.title)}</strong>
              <small>{dayDistanceLabel(macroEvent.date)} {calendarTime24(macroEvent.time)}</small>
            </button>
          ) : null}
          {earningsRows.length ? <div className="frontCalendarSectionLabel">近期财报</div> : null}
          {earningsRows.map((item) => (
            <button type="button" key={item.id} className={`frontCalendarEvent ${item.impact === "high" ? "highImpact" : ""}`} onClick={() => onPage("calendar")}>
              <span>{dayDistanceLabel(item.date)} {calendarTime24(item.time)}</span>
              <strong>{calendarTitle(item.title).replace(/\s*财报$/, "")}</strong>
              <em className={impactClass(item.impact)}>{impactLabel(item.impact)}</em>
            </button>
          ))}
        </aside>
      </section>

      <section className="frontHomeStrengthPanel">
        <div className="frontPanelHead">
          <div className="frontPanelTitle">
            <strong>{pageLabels.tracking}</strong>
            {trackingUpdatedAt ? <time>更新 {formatStoredDateTime(trackingUpdatedAt)}</time> : null}
          </div>
          <button type="button" onClick={() => onPage("tracking")}>查看机会</button>
        </div>
        <div className={trackingLocked ? "frontHomeLockedTable" : ""}>
          <div className="frontHomeDesktopTable">
            <table className="frontHomeTable frontHomeStrengthTable">
              <thead>
                <tr>
                  <th>股票</th>
                  <th>现价</th>
                  <th>近1天</th>
                  <th>近1周</th>
                  <th>近1月</th>
                  <th>成交额</th>
                  <th>趋势策略方向</th>
                  <th className="frontHomeKeyLevelsHead">关键点位</th>
                </tr>
              </thead>
              <tbody>
                {focusRows.map((row) => (
                  <tr key={row.symbol} onClick={() => !trackingLocked && onPage("tracking")}>
                    <td>
                      <strong>{row.symbol}</strong>
                      <span>{row.displayName}</span>
                    </td>
                    <td>{priceDisplay(row.currentPrice)}</td>
                    <td className={signedClass(row.oneDay)}>{signed(row.oneDay)}</td>
                    <td className={signedClass(row.oneWeek)}>{signed(row.oneWeek)}</td>
                    <td className={signedClass(row.oneMonth)}>{signed(row.oneMonth)}</td>
                    <td>{isBlankValue(row.liquidity) ? "--" : row.liquidity}</td>
                    <td><SignalDirectionBadge label={trackingDirection(row)} /></td>
                    <td className="frontHomeKeyLevelsData">
                      <TrackingKeyLevelsCell levels={row.keyLevels} locked={trackingLocked} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="frontHomeMobileList">
            {focusRows.map((row) => (
              <button type="button" key={row.symbol} className="frontHomeMobileRow" disabled={trackingLocked} onClick={() => onPage("tracking")}>
                <span className="frontHomeMobileStock">
                  <span>
                    <strong>{row.symbol}</strong>
                    <small>{row.displayName}</small>
                  </span>
                  <b>{priceDisplay(row.currentPrice)}</b>
                </span>
                <span className="frontHomeMobileMetrics">
                  <span><small>近1天</small><strong className={signedClass(row.oneDay)}>{signed(row.oneDay)}</strong></span>
                  <span><small>近1周</small><strong className={signedClass(row.oneWeek)}>{signed(row.oneWeek)}</strong></span>
                  <span><small>近1月</small><strong className={signedClass(row.oneMonth)}>{signed(row.oneMonth)}</strong></span>
                </span>
                <span className="frontHomeMobileMeta">
                  <small>成交额 {isBlankValue(row.liquidity) ? "--" : row.liquidity}</small>
                  <SignalDirectionBadge label={trackingDirection(row)} />
                </span>
                {row.keyLevels?.status === "ready" && (row.keyLevels.support || row.keyLevels.resistance) ? (
                  <span className="frontHomeMobileKeyLevels">
                    <span>
                      <strong>关键点位</strong>
                      <small>{row.keyLevels.positionText || ""}{keyLevelDistance(row.keyLevels)}</small>
                    </span>
                    <span>
                      {row.keyLevels.support ? <b>支撑 {priceDisplay(row.keyLevels.support.center)} <em className={keyLevelStrengthClass(row.keyLevels.support)}>{row.keyLevels.support.strengthText || "--"}</em></b> : null}
                      {row.keyLevels.resistance ? <b>阻力 {priceDisplay(row.keyLevels.resistance.center)} <em className={keyLevelStrengthClass(row.keyLevels.resistance)}>{row.keyLevels.resistance.strengthText || "--"}</em></b> : null}
                    </span>
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {trackingLocked ? (
            <div className="frontHomeMemberBar">
              <span>完整榜单会员可见</span>
              <button type="button" onClick={() => authenticated ? onUnlock() : onAuth("register")}>查看完整榜单</button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="frontHomeBottomGrid">
        <article className="frontMiniPanel">
          <div className="frontPanelHead">
            <div className="frontPanelTitle">
              <strong>热门股票板块</strong>
              {sectorUpdatedAt ? <time>更新 {formatStoredDateTime(sectorUpdatedAt)}</time> : null}
            </div>
            <button type="button" onClick={() => onPage("market")}>查看资金</button>
          </div>
          <div className="frontSectorList">
            {sectorRows.map((row) => (
              <button type="button" key={row.sector} onClick={() => onPage("market")}>
                <strong>{row.sector}</strong>
                <i aria-hidden="true"><span style={{ width: `${Math.max(8, Math.min(100, Number(row.breadthPct) || 0))}%` }} /></i>
                <b className={signedClass(row.netFlowProxy)}>{money(row.netFlowProxy)}</b>
                <small>{(row.leaders || []).slice(0, 3).map((item) => item.symbol).join(" / ")}</small>
              </button>
            ))}
          </div>
        </article>

        <article className="frontMiniPanel">
          <div className="frontPanelHead">
            <div className="frontPanelTitle">
              <strong>{pageLabels.stocks}精选</strong>
              {stocksUpdatedAt ? <time>更新 {formatStoredDateTime(stocksUpdatedAt)}</time> : null}
            </div>
            <button type="button" onClick={() => onPage("stocks")}>打开{pageLabels.stocks}</button>
          </div>
          <div className="frontStockList">
            {stockRows.map((row) => (
              <button type="button" key={row.symbol} onClick={() => onPage("stocks")}>
                <strong>{row.symbol}<small>{row.company || row.chineseName || row.sector || "--"}</small></strong>
                <b className={signedClass(row.change ?? row.changeYtd)}>{signed(row.change ?? row.changeYtd)}</b>
                <em>{money(row.dollarVolume || undefined)}</em>
              </button>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}

function OpinionsPage({
  opinions,
  selected,
  selectedId,
  onSelect,
  onBack,
  locked,
  authenticated,
  onAuth,
  onUnlock
}: {
  opinions: Opinion[];
  selected?: Opinion;
  selectedId: string;
  onSelect: (item: Opinion) => void;
  onBack: () => void;
  locked: boolean;
  authenticated: boolean;
  onAuth: (mode: AuthMode) => void;
  onUnlock: () => void;
}) {
  const pageSize = 8;
  const [section, setSection] = useState("all");
  const [pageIndex, setPageIndex] = useState(0);
  const [rows, setRows] = useState<Opinion[]>(opinions.slice(0, pageSize));
  const [total, setTotal] = useState(opinions.length);
  const [loading, setLoading] = useState(false);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const sectionOptions = [
    { key: "all", label: "最新" },
    ...Object.entries(sectionLabels).map(([key, label]) => ({ key, label }))
  ];

  useEffect(() => {
    setLoading(true);
    api.opinions(pageSize, {
      offset: pageIndex * pageSize,
      section: section === "all" ? "" : section
    })
      .then((payload) => {
        const nextRows = payload.rows || [];
        setRows(nextRows);
        setTotal(payload.total ?? nextRows.length);
      })
      .finally(() => setLoading(false));
  }, [pageIndex, section]);

  const changeSection = (nextSection: string) => {
    setSection(nextSection);
    setPageIndex(0);
    setRows([]);
    setTotal(0);
  };
  const selectedTags = [...(selected?.symbols || []), ...(selected?.topics || [])].slice(0, 8);
  const sectionRows = opinions.filter((item) => !selected?.section || item.section === selected.section);
  const selectedIndex = sectionRows.findIndex((item) => item.id === selected?.id);
  const previousItem = selectedIndex >= 0 ? sectionRows[selectedIndex + 1] : null;
  const nextItem = selectedIndex > 0 ? sectionRows[selectedIndex - 1] : null;
  const displayRows = rows;
  const groupedRows = displayRows.reduce<Array<{ date: string; rows: Opinion[] }>>((groups, item) => {
    const date = formatDate(item.tradeDate);
    const current = groups[groups.length - 1];
    if (current?.date === date) current.rows.push(item);
    else groups.push({ date, rows: [item] });
    return groups;
  }, []);

  if (!selectedId) {
    return (
      <div className="opinionProductPage">
        <div className="opinionProductTabs">
          {sectionOptions.map((item) => (
            <button key={item.key} type="button" className={item.key === section ? "active" : ""} onClick={() => changeSection(item.key)}>
              {item.label}
            </button>
          ))}
        </div>

        <section className="opinionProductLayout single">
          <article className="opinionProductFeed">
            {loading ? <div className="opinionLoading">正在加载</div> : null}
            {!loading && !displayRows.length ? <div className="opinionEmpty">该栏目暂时没有内容</div> : null}
            {!loading ? groupedRows.map((group) => (
              <Fragment key={group.date}>
                <div className="opinionProductDay">{group.date}</div>
                {group.rows.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => onSelect(item)}
                  >
                    <div className="opinionProductItem">
                      <div className="opinionProductTitle">
                        <b>{opinionSectionLabel(item)}</b>
                        <strong>{opinionDisplayTitle(item)}</strong>
                      </div>
                      <div className="opinionListPreview">
                        <p>{compactText(item.summary || item.body, 96)}</p>
                      </div>
                      <div className="opinionProductTags compact">
                        {[...(item.symbols || []), ...(item.topics || [])].slice(0, 5).map((tag) => <b key={tag}>{tag}</b>)}
                      </div>
                    </div>
                    <span className="opinionRowChevron" aria-hidden="true">›</span>
                  </button>
                ))}
              </Fragment>
            )) : null}
            {pageCount > 1 ? (
              <div className="opinionPager">
                <button type="button" disabled={pageIndex <= 0 || loading} onClick={() => setPageIndex((value) => Math.max(0, value - 1))}>上一页</button>
                <span>{pageIndex + 1} / {pageCount}</span>
                <button type="button" disabled={pageIndex >= pageCount - 1 || loading} onClick={() => setPageIndex((value) => Math.min(pageCount - 1, value + 1))}>下一页</button>
              </div>
            ) : null}
          </article>

        </section>
      </div>
    );
  }

  return (
    <div className="opinionReaderPage">
      <article className="readerPanel articleReaderPanel">
        <div className="readerTop">
          <button type="button" onClick={onBack}>返回列表</button>
        </div>
        <div className="readerShell opinionReaderSingle">
          <main className="readerMain">
            <div className="readerHeader">
              <div className="readerMetaLine">
                <span>{opinionSectionLabel(selected)}</span>
                <time>{formatOpinionTime(selected?.tradeDate)}</time>
              </div>
              <h1>{opinionDisplayTitle(selected, 72)}</h1>
              <div className={locked ? "tagLine lockedTagLine" : "tagLine"}>
                {selectedTags.map((tag) => (
                  <b key={tag}>{tag}</b>
                ))}
              </div>
            </div>
            <div className={locked ? "readerLockedArea readerFadePaywall" : ""}>
              {locked ? (
                <div className="readerBody articleProse locked">
                  {richBodyNodes(selected?.body || selected?.summary)}
                </div>
              ) : (
                <div className="readerBody articleProse">
                  {richBodyNodes(selected?.body || selected?.summary)}
                </div>
              )}
              {locked ? (
                <div className="readerMemberPreview">
                  <span>查看完整观点</span>
                  <button type="button" onClick={() => authenticated ? onUnlock() : onAuth("register")}>开通会员</button>
                </div>
              ) : null}
            </div>
            {(previousItem || nextItem) ? (
              <nav className="readerArticleNav" aria-label="同栏目文章">
                {previousItem ? (
                  <button type="button" onClick={() => onSelect(previousItem)}>
                    <span>上一篇</span>
                    {opinionDisplayTitle(previousItem)}
                  </button>
                ) : null}
                {nextItem ? (
                  <button type="button" onClick={() => onSelect(nextItem)}>
                    <span>下一篇</span>
                    {opinionDisplayTitle(nextItem)}
                  </button>
                ) : null}
              </nav>
            ) : null}
          </main>
        </div>
      </article>
    </div>
  );
}

function keyLevelStrengthClass(level?: KeyLevel | null) {
  return `levelStrength ${level?.strength || "weak"}`;
}

function keyLevelZone(level?: KeyLevel | null) {
  if (!level || !Number.isFinite(level.lower) || !Number.isFinite(level.upper)) return "--";
  return `${priceDisplay(level.lower)} – ${priceDisplay(level.upper)}`;
}

function keyLevelDistance(levels?: TrackingKeyLevels) {
  if (!levels) return "";
  const support = levels.supportDistancePct;
  const resistance = levels.resistanceDistancePct;
  if (levels.position === "at_support" || levels.position === "at_resistance") return "";
  if (levels.position === "near_support" && Number.isFinite(support)) return ` · 距支撑 ${support}%`;
  if (levels.position === "near_resistance" && Number.isFinite(resistance)) return ` · 距阻力 ${resistance}%`;
  return "";
}

function keyLevelPositionSummary(levels?: TrackingKeyLevels) {
  const messages: Record<string, string> = {
    at_support: "先看支撑区能否守住",
    near_support: "先看支撑区能否守住",
    at_resistance: "先看阻力区能否突破",
    near_resistance: "先看阻力区能否突破",
    above_resistance: "关注突破后能否站稳",
    below_support: "先看能否收回支撑区",
    middle: "价格位于支撑与阻力之间"
  };
  return messages[levels?.position || "middle"] || messages.middle;
}

function keyLevelNextFocus(levels?: TrackingKeyLevels) {
  const support = levels?.support;
  const resistance = levels?.resistance;
  if (levels?.position === "at_support" || levels?.position === "near_support") {
    return support?.lower ? `守住 ${priceDisplay(support.lower)}，再看反弹力度` : "观察支撑区能否守住";
  }
  if (levels?.position === "at_resistance" || levels?.position === "near_resistance") {
    return resistance?.upper ? `突破 ${priceDisplay(resistance.upper)}，再看能否站稳` : "观察阻力区能否突破";
  }
  if (levels?.position === "above_resistance") {
    return resistance?.upper ? `回踩 ${priceDisplay(resistance.upper)} 附近，关注能否站稳` : "关注突破后的回踩表现";
  }
  if (levels?.position === "below_support") {
    return support?.lower ? `先看能否收回 ${priceDisplay(support.lower)}` : "先看能否收回支撑区";
  }
  if (support?.center && resistance?.center) {
    return `关注 ${priceDisplay(support.center)} 支撑与 ${priceDisplay(resistance.center)} 阻力`;
  }
  return "等待接近关键位置";
}

function sameKeyLevel(left?: KeyLevel | null, right?: KeyLevel | null) {
  return Number.isFinite(left?.center) && Number.isFinite(right?.center)
    && Math.abs(Number(left?.center) - Number(right?.center)) < 0.01;
}

function breakoutDecision(levels?: TrackingKeyLevels) {
  const confirmation = levels?.breakoutConfirmation;
  if (!confirmation?.level) return null;
  const copy = {
    breakout_watch: {
      title: "突破观察",
      summary: "价格刚越过阻力区，先看能否站稳。",
      focusLabel: "回踩观察区",
      focusNote: "回到这里时，重点看能否守住。"
    },
    awaiting_retest: {
      title: "等待回踩",
      summary: "价格已站上阻力区，等回踩确认。",
      focusLabel: "回踩观察区",
      focusNote: "回到这里时，重点看能否守住。"
    },
    confirmed_support: {
      title: "支撑已确认",
      summary: "回踩后守住该区域，现作为支撑观察。",
      focusLabel: "确认支撑",
      focusNote: "后续跌回区域下方，需重新评估。"
    },
    breakout_failed: {
      title: "突破失效",
      summary: "价格重新回到原阻力区下方，暂不按突破处理。",
      focusLabel: "重新站上",
      focusNote: "重新站上该区域后再观察。"
    }
  }[confirmation.status || ""];
  return copy ? { ...copy, confirmation } : null;
}

function TrackingKeyLevelsCell({
  levels,
  locked
}: {
  levels?: TrackingKeyLevels;
  locked: boolean;
}) {
  if (locked) {
    return <div className="trackingKeyLevelsCell locked"><strong>会员可见</strong></div>;
  }
  if (levels?.status === "insufficient") {
    return (
      <div className="trackingKeyLevelsCell unavailable">
        <strong>暂时无法计算</strong>
      </div>
    );
  }
  if (!levels || levels.status !== "ready" || (!levels.support && !levels.resistance)) {
    return <div className="trackingKeyLevelsCell unavailable"><strong>暂不可用</strong></div>;
  }
  return (
    <div className="trackingKeyLevelsCell">
      <div>
        <span>支撑</span>
        <b>{priceDisplay(levels.support?.center)}</b>
        <em className={keyLevelStrengthClass(levels.support)}>{levels.support?.strengthText || "--"}</em>
      </div>
      <div>
        <span>阻力</span>
        <b>{priceDisplay(levels.resistance?.center)}</b>
        <em className={keyLevelStrengthClass(levels.resistance)}>{levels.resistance?.strengthText || "--"}</em>
      </div>
      <small>{levels.positionText || "区间中部"}{keyLevelDistance(levels)}</small>
    </div>
  );
}

function TrackingPriceChart({
  points,
  levels
}: {
  points: PriceHistoryPoint[];
  levels: TrackingKeyLevels;
}) {
  const visible = points.filter((point) => Number.isFinite(point.close)).slice(-60);
  if (visible.length < 2) return <div className="trackingDetailEmpty compact">暂无走势数据</div>;
  const width = 760;
  const height = 280;
  const margin = { top: 18, right: 76, bottom: 34, left: 52 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const candidate = levels.breakoutConfirmation?.level;
  const candidateIsSupport = sameKeyLevel(candidate, levels.support);
  const candidateIsResistance = sameKeyLevel(candidate, levels.resistance);
  const levelValues = [
    levels.support?.lower,
    levels.support?.upper,
    levels.resistance?.lower,
    levels.resistance?.upper,
    candidate?.lower,
    candidate?.upper
  ]
    .filter((value): value is number => Number.isFinite(value));
  const values = [...visible.map((point) => point.close), ...levelValues];
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max((rawMax - rawMin) * 0.08, rawMax * 0.005, 1);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const x = (index: number) => margin.left + (index / (visible.length - 1)) * plotWidth;
  const y = (value: number) => margin.top + ((max - value) / (max - min)) * plotHeight;
  const path = visible.map((point, index) => `${index ? "L" : "M"} ${x(index)} ${y(point.close)}`).join(" ");
  const zone = (level: KeyLevel | null | undefined, className: string, label: string) => {
    if (!level || !Number.isFinite(level.lower) || !Number.isFinite(level.upper)) return null;
    const top = y(Number(level.upper));
    const bottom = y(Number(level.lower));
    return (
      <g className={className}>
        <rect x={margin.left} y={top} width={plotWidth} height={Math.max(3, bottom - top)} />
        <text x={width - margin.right + 6} y={(top + bottom) / 2 + 4}>{label}</text>
      </g>
    );
  };
  const dateIndexes = [0, Math.floor((visible.length - 1) / 2), visible.length - 1];
  const priceTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => max - (max - min) * ratio);
  const last = visible.at(-1)!;

  return (
    <div className="trackingPriceChart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="近60个交易日价格走势与关键点位">
        {priceTicks.map((value, index) => {
          const ratio = index / (priceTicks.length - 1);
          const gridY = margin.top + ratio * plotHeight;
          return (
            <g key={value}>
              <line className="chartGridLine" x1={margin.left} x2={width - margin.right} y1={gridY} y2={gridY} />
              <text className="chartPriceLabel" x={margin.left - 8} y={gridY + 4} textAnchor="end">{priceDisplay(value)}</text>
            </g>
          );
        })}
        {!candidateIsResistance ? zone(levels.resistance, "resistanceZone", "阻力区") : null}
        {candidate && !candidateIsSupport
          ? zone(candidate, "candidateZone", levels.breakoutConfirmation?.status === "breakout_failed" ? "原阻力区" : "观察区")
          : null}
        {zone(levels.support, "supportZone", "支撑区")}
        <path className="trackingPriceLine" d={path} />
        <line className="currentPriceLine" x1={margin.left} x2={width - margin.right} y1={y(last.close)} y2={y(last.close)} />
        <circle className="currentPriceDot" cx={x(visible.length - 1)} cy={y(last.close)} r="4" />
        <text
          className="currentPriceLabel"
          x={width - margin.right - 8}
          y={Math.max(margin.top + 12, y(last.close) - 8)}
          textAnchor="end"
        >
          {priceDisplay(last.close)}
        </text>
        {dateIndexes.map((index) => (
          <text
            key={index}
            className="chartDateLabel"
            x={x(index)}
            y={height - 10}
            textAnchor={index === 0 ? "start" : index === visible.length - 1 ? "end" : "middle"}
          >
            {formatDate(visible[index].date)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function TrackingPage({
  rows,
  asOf,
  locked,
  authenticated,
  onAuth,
  onUnlock,
  onOpenStock
}: {
  rows: ReturnType<typeof mergedTrackingRows>;
  asOf?: string;
  locked: boolean;
  authenticated: boolean;
  onAuth: (mode: AuthMode) => void;
  onUnlock: () => void;
  onOpenStock: (symbol: string, source?: StockSource) => void;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [sortKey, setSortKey] = useState<TrackingSortKey>("oneMonth");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const pageSize = 12;
  const sortHeader = (key: TrackingSortKey, label: ReactNode) => (
    <button
      type="button"
      className={`tableSortButton ${sortKey === key ? "active" : ""}`}
      onClick={() => {
        setPageIndex(0);
        setSortKey((current) => {
          if (current === key) setSortDir((dir) => dir === "asc" ? "desc" : "asc");
          else setSortDir(key === "symbol" ? "asc" : "desc");
          return key;
        });
      }}
    >
      {label}<span className="tableSortIndicator">{sortKey === key ? (sortDir === "asc" ? "↑" : "↓") : ""}</span>
    </button>
  );
  const visibleRows = useMemo(() => {
    return rows
      .filter((row) => row.oneMonth !== "--" || row.volume !== "--" || row.marketCap !== "--")
      .sort((a, b) => compareTrackingRows(a, b, sortKey, sortDir));
  }, [rows, sortDir, sortKey]);
  const pagedRows = visibleRows.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize);
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const openTrackingRow = (symbol: string) => {
    if (!locked) {
      onOpenStock(symbol, "tracking");
      return;
    }
    if (authenticated) {
      onUnlock();
      return;
    }
    onAuth("register");
  };

  return (
    <div className="trackingPage">
      <section className="screenerCard">
        <div className="trackingDataAsOf">
          <time>更新 {formatStoredDateTime(asOf)}</time>
        </div>
        <div className={locked ? "screenerTableWrap trackingLockedTable trackingDesktopTable" : "screenerTableWrap trackingDesktopTable"}>
          <table className="screenerTable">
            <thead>
              <tr>
                <th>#</th>
                <th>{sortHeader("symbol", "股票")}</th>
                <th>{sortHeader("currentPrice", "现价")}</th>
                <th>{sortHeader("oneMonth", "近1月")}</th>
                <th>{sortHeader("oneDay", "近1天")}</th>
                <th>{sortHeader("oneWeek", "近1周")}</th>
                <th>{sortHeader("volume", <VolumeRatioLabel />)}</th>
                <th>{sortHeader("signal", "趋势策略方向")}</th>
                <th className="trackingKeyLevelsHead">
                  <span>关键点位</span>
                  <InfoTip text={keyLevelsHelp} focusable />
                </th>
                <th className="trackingActionCell">操作</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row, index) => {
                const directionLabel = trackingDirection(row);
                const visibleName = row.name && row.name !== row.symbol ? row.name : trackingSymbolNames[row.symbol] || row.name || row.symbol;
                return (
                  <tr key={row.symbol}>
                    <td>{pageIndex * pageSize + index + 1}</td>
                    <td>
                      {locked ? (
                        <LockedStockName symbol={row.symbol} name={visibleName} />
                      ) : (
                        <>
                          <strong>{row.symbol}</strong>
                          <span>{visibleName}</span>
                        </>
                      )}
                    </td>
                    <td>{priceDisplay(row.currentPrice)}</td>
                    <td className={signedClass(row.oneMonth)}>{signed(row.oneMonth)}</td>
                    <td className={signedClass(row.oneDay)}>{signed(row.oneDay)}</td>
                    <td className={signedClass(row.oneWeek)}>{signed(row.oneWeek)}</td>
                    <td>{row.volume || "--"}</td>
                    <td><SignalDirectionBadge label={directionLabel} /></td>
                    <td className="trackingKeyLevelsData"><TrackingKeyLevelsCell levels={row.keyLevels} locked={locked} /></td>
                    <td className="trackingActionCell">
                      <button
                        type="button"
                        className="screenerLink"
                        onClick={() => openTrackingRow(row.symbol)}
                      >
                        详情
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="trackingMobileList">
          {pagedRows.map((row) => {
            const directionLabel = trackingDirection(row);
            const visibleName = row.name && row.name !== row.symbol ? row.name : trackingSymbolNames[row.symbol] || row.name || row.symbol;
            return (
              <article className="trackingMobileRow" key={row.symbol}>
                <div className="trackingMobileHead">
                  <div>
                    {locked ? <LockedStockName symbol={row.symbol} name={visibleName} /> : <><strong>{row.symbol}</strong><span>{visibleName}</span></>}
                  </div>
                  <div>
                    <strong>{priceDisplay(row.currentPrice)}</strong>
                    <SignalDirectionBadge label={directionLabel} />
                  </div>
                </div>
                <div className="trackingMobileMetrics">
                  <div><span>近1月</span><strong className={signedClass(row.oneMonth)}>{signed(row.oneMonth)}</strong></div>
                  <div><span>近1周</span><strong className={signedClass(row.oneWeek)}>{signed(row.oneWeek)}</strong></div>
                  <div><span>成交倍数</span><strong>{row.volume || "--"}</strong></div>
                </div>
                <div className="trackingMobileFoot">
                  <TrackingKeyLevelsCell levels={row.keyLevels} locked={locked} />
                  <button type="button" className="screenerLink" onClick={() => openTrackingRow(row.symbol)}>查看详情</button>
                </div>
              </article>
            );
          })}
        </div>
        <div className="pager">
          <button disabled={pageIndex <= 0} onClick={() => setPageIndex((value) => Math.max(0, value - 1))}>上一页</button>
          <span>第 {pageIndex + 1} 页</span>
          <button disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((value) => Math.min(pageCount - 1, value + 1))}>下一页</button>
        </div>
      </section>
    </div>
  );
}

function StockDetailPage({
  symbol,
  rows,
  backLabel,
  onBack,
  onOpenStock
}: {
  symbol: string;
  rows: ReturnType<typeof mergedTrackingRows>;
  backLabel: string;
  onBack: () => void;
  onOpenStock: (symbol: string) => void;
}) {
  const [detail, setDetail] = useState<SymbolDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const activeSymbol = symbol.trim().toUpperCase();
  const row = rows.find((item) => item.symbol === activeSymbol) || null;
  const profile = detail?.profile;
  const dayRow = detail?.marketRows.find((item) => item.board === "day");
  const weekRow = detail?.marketRows.find((item) => item.board === "week");
  const monthRow = detail?.marketRows.find((item) => item.board === "month");
  const ytdRow = detail?.marketRows.find((item) => item.board === "ytd");
  const keyLevels = dayRow?.keyLevels || row?.keyLevels;
  const priceHistory = dayRow?.priceHistory || row?.priceHistory || [];
  const displayName = profile?.company || profile?.chineseName || row?.name || activeSymbol || "--";
  const currentPrice = row?.currentPrice ?? keyLevels?.currentPrice ?? dayRow?.price ?? profile?.price;
  const oneDay = row?.oneDay ?? dayRow?.changePct ?? dayRow?.change ?? profile?.dayChange;
  const oneWeek = row?.oneWeek ?? weekRow?.changePct ?? weekRow?.change ?? profile?.weekChange;
  const oneMonth = row?.oneMonth ?? monthRow?.changePct ?? monthRow?.change ?? profile?.monthChange;
  const yearChange = ytdRow?.changePct ?? ytdRow?.change ?? dayRow?.changeYtd ?? profile?.ytdChange;
  const detailDollarVolume = compactMoney(dayRow?.dollarVolume ?? profile?.dollarVolume);
  const dollarVolume = detailDollarVolume !== "--" ? detailDollarVolume : row?.liquidity || "--";
  const detailVolumeRatio = ratioDisplay(dayRow?.volumeRatio ?? profile?.volumeRatio);
  const volumeRatio = detailVolumeRatio !== "--" ? detailVolumeRatio : row?.volume || "--";
  const breakout = breakoutDecision(keyLevels);
  const candidate = breakout?.confirmation.level;
  const resistanceIsCandidate = sameKeyLevel(candidate, keyLevels?.resistance);
  const existingSupport = breakout?.confirmation.status === "confirmed_support"
    ? keyLevels?.secondarySupport
    : keyLevels?.support;
  const peers = detail?.peers?.length
    ? detail.peers.slice(0, 3).map((item) => ({
        symbol: item.symbol,
        name: stockCompany(item),
        oneMonth: item.monthChange,
        direction: item.strengthLabel || "--"
      }))
    : rows.filter((item) => item.symbol !== activeSymbol).slice(0, 3).map((item) => ({
        symbol: item.symbol,
        name: item.name && item.name !== item.symbol ? item.name : trackingSymbolNames[item.symbol] || item.symbol,
        oneMonth: item.oneMonth,
        direction: trackingDirection(item)
      }));

  useEffect(() => {
    if (!activeSymbol) return;
    let cancelled = false;
    setDetail(null);
    setLoading(true);
    api.symbolDetail(activeSymbol)
      .then((payload) => {
        if (!cancelled) setDetail(payload);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSymbol, reload]);

  if (!profile && !row && loading) return <div className="trackingDetailPage"><div className="loading" /></div>;
  if (!profile && !row) return <div className="trackingDetailPage"><button type="button" className="trackingDetailBack" onClick={onBack}>返回{backLabel}</button><div className="trackingDetailEmpty"><strong>股票详情加载失败</strong><button type="button" className="trackingDetailBack requestRetry" onClick={() => setReload((value) => value + 1)}>重新加载</button></div></div>;

  return (
    <div className="trackingDetailPage">
      <button type="button" className="trackingDetailBack" onClick={onBack}>返回{backLabel}</button>

      <section className="trackingDetailQuote">
        <div className="trackingDetailIdentity">
          <h1>{activeSymbol}</h1>
          <p>{displayName}</p>
        </div>
        <div className="trackingDetailPrice"><span>现价</span><strong>{priceDisplay(currentPrice)}</strong></div>
        <div><span>近1天</span><strong className={signedClass(oneDay)}>{signed(oneDay)}</strong></div>
        <div><span>近1周</span><strong className={signedClass(oneWeek)}>{signed(oneWeek)}</strong></div>
        <div><span>近1月</span><strong className={signedClass(oneMonth)}>{signed(oneMonth)}</strong></div>
        <div><span>成交额</span><strong>{dollarVolume || "--"}</strong></div>
        <div><span>成交倍数</span><strong>{volumeRatio || "--"}</strong></div>
        <AddToWatchlistButton symbol={activeSymbol} />
      </section>

      {keyLevels?.status === "ready" && (keyLevels.support || keyLevels.resistance || keyLevels.breakoutConfirmation?.level) ? (
        <section className="trackingDetailMain">
          <article className="trackingDetailChartPanel">
            <header><strong>价格与关键点位</strong><time>{keyLevels.asOf ? `更新 ${formatDate(keyLevels.asOf)}` : ""}</time></header>
            <TrackingPriceChart points={priceHistory} levels={keyLevels} />
            <div className="trackingDetailLegend">
              <span><i className="price" />价格</span>
              {keyLevels.support ? <span><i className="support" />支撑区</span> : null}
              {keyLevels.resistance && !resistanceIsCandidate ? <span><i className="resistance" />阻力区</span> : null}
              {candidate && !sameKeyLevel(candidate, keyLevels.support) ? (
                <span><i className="candidate" />{breakout?.confirmation.status === "breakout_failed" ? "原阻力区" : "观察区"}</span>
              ) : null}
            </div>
          </article>
          <aside className={`trackingDetailDecision ${keyLevels.position || "middle"} ${breakout?.confirmation.status || ""}`}>
            <div className="trackingDetailPosition">
              <span>当前位置</span>
              <h2>{breakout?.title || keyLevels.positionText || "区间中部"}</h2>
              <p>{breakout?.summary || keyLevelPositionSummary(keyLevels)}</p>
            </div>
            {breakout ? (
              <>
                <div className="trackingDetailFocus">
                  <span>{breakout.focusLabel}</span>
                  <strong>{keyLevelZone(candidate)}</strong>
                  <small>{breakout.focusNote}</small>
                </div>
                {!resistanceIsCandidate && keyLevels.resistance ? (
                  <div className="trackingDetailLevel"><span>下一阻力</span><strong>{keyLevelZone(keyLevels.resistance)}</strong><em className={keyLevelStrengthClass(keyLevels.resistance)}>{keyLevels.resistance.strengthText || "--"}</em></div>
                ) : null}
                {existingSupport ? (
                  <div className="trackingDetailLevel"><span>现有支撑</span><strong>{keyLevelZone(existingSupport)}</strong><em className={keyLevelStrengthClass(existingSupport)}>{existingSupport.strengthText || "--"}</em></div>
                ) : null}
              </>
            ) : (
              <>
                <div className="trackingDetailLevel"><span>支撑区</span><strong>{keyLevelZone(keyLevels.support)}</strong><em className={keyLevelStrengthClass(keyLevels.support)}>{keyLevels.support?.strengthText || "--"}</em></div>
                <div className="trackingDetailLevel"><span>阻力区</span><strong>{keyLevelZone(keyLevels.resistance)}</strong><em className={keyLevelStrengthClass(keyLevels.resistance)}>{keyLevels.resistance?.strengthText || "--"}</em></div>
                <div className="trackingDetailNext"><span>接下来关注</span><strong>{keyLevelNextFocus(keyLevels)}</strong></div>
              </>
            )}
          </aside>
        </section>
      ) : (
        <section className="trackingDetailEmpty">
          <strong>{keyLevels?.status === "insufficient" ? "暂时无法计算" : "关键点位暂不可用"}</strong>
        </section>
      )}

      <section className="trackingDetailBottom">
        <article className="trackingDetailPanel">
          <header><strong>当前表现</strong><span>趋势：{keyLevels?.trendText || "--"}</span></header>
          <div className="trackingDetailFacts">
            <div><span>MA20</span><strong>{priceDisplay(keyLevels?.ma20)}</strong></div>
            <div><span>MA60</span><strong>{priceDisplay(keyLevels?.ma60)}</strong></div>
            <div><span>ATR14</span><strong>{priceDisplay(keyLevels?.atr14)}</strong></div>
            <div><span>今年以来</span><strong className={signedClass(yearChange)}>{signed(yearChange)}</strong></div>
          </div>
        </article>
        <article className="trackingDetailPanel">
          <header><strong>同榜对比</strong><span>近1月</span></header>
          <div className="trackingDetailPeers">
            {peers.map((item) => (
              <button type="button" key={item.symbol} onClick={() => onOpenStock(item.symbol)}>
                <strong>{item.symbol}</strong>
                <small>{item.name}</small>
                <b className={signedClass(item.oneMonth)}>{signed(item.oneMonth)}</b>
                <span>{item.direction}</span>
              </button>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}

type StrengthBucket = "watch" | "hot" | "neutral" | "avoid";
type StrengthView = StrengthBucket | "all";
type StrengthSort = "score" | "return20d" | "relative" | "crowding";

function numericValue(value?: string | number | null) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[,%+$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function temperatureTone(status?: string) {
  if (status === "watch") return "negative";
  if (status === "positive") return "positive";
  return "neutral";
}

const marketPressureThresholds: Record<string, number> = {
  vixcls: 28,
  dgs10: 4.8,
  dgs30: 5,
  dxy: 105,
  dcoilwtico: 105,
  dcoilbrenteu: 105,
  cpiaucsl: 3.2
};

function formatSeriesValue(value: number, unit?: string) {
  const number = Math.abs(value).toFixed(2);
  if (unit === "$") return `${value < 0 ? "-$" : "$"}${number}`;
  return `${value < 0 ? "-" : ""}${number}${unit || ""}`;
}

function marketSectorName(value?: string) {
  return (value || "").replace(/^[A-Z]{2,6}\s+/, "") || "--";
}

const monthlyIndicatorKeys = new Set(["fedfunds", "cpiaucsl", "unrate"]);

function indicatorFrequency(item: Pick<TemperatureIndicator, "key" | "frequency">) {
  return item.frequency || (monthlyIndicatorKeys.has(item.key.toLowerCase()) ? "monthly" : "daily");
}

function businessDayLag(value?: string, reference?: string) {
  if (!value || !reference) return null;
  const start = new Date(`${value.slice(0, 10)}T00:00:00`);
  const end = new Date(`${reference.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) return 0;
  let lag = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) lag += 1;
  }
  return lag;
}

function indicatorIsStale(item: TemperatureIndicator, reference?: string) {
  if (typeof item.stale === "boolean") return item.stale;
  if (indicatorFrequency(item) === "monthly") return false;
  return (businessDayLag(item.asOf, reference) ?? 0) > 2;
}

function indicatorPeriodLabel(item: TemperatureIndicator) {
  if (!item.asOf) return "--";
  if (indicatorFrequency(item) === "monthly") {
    const month = Number(item.asOf.slice(5, 7));
    return Number.isFinite(month) && month ? `${month}月数据` : formatDate(item.asOf);
  }
  return formatDate(item.asOf);
}

function valuationValue(value?: number | null, unit?: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value.toFixed(2)}${unit === "x" ? "倍" : unit || ""}`;
}

function valuationQuantile(values: number[], ratio: number) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const position = (ordered.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.min(ordered.length - 1, lower + 1);
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

type ValuationRange = 5 | 10 | "all";

function valuationRangePoints(metric: IndexValuationMetric | undefined, range: ValuationRange) {
  const points = (metric?.trend || []).filter((point) => Number.isFinite(point.value));
  if (range === "all" || !points.length) return points;
  const cutoff = new Date(`${points.at(-1)!.date}T00:00:00`);
  cutoff.setFullYear(cutoff.getFullYear() - range);
  return points.filter((point) => new Date(`${point.date}T00:00:00`) >= cutoff);
}

function valuationRangePercentile(metric: IndexValuationMetric | undefined, range: ValuationRange) {
  if (metric?.value === null || metric?.value === undefined) return null;
  const points = valuationRangePoints(metric, range);
  return points.length ? 100 * points.filter((point) => point.value <= metric.value!).length / points.length : null;
}

function valuationRangeLevel(pePercentile: number | null, pbPercentile: number | null, fallback?: string) {
  if (pePercentile === null || pbPercentile === null) return fallback;
  if (pePercentile < 30 && pbPercentile < 30) return "偏低";
  if (pePercentile >= 70 || pbPercentile >= 70) return "偏高";
  return "适中";
}

type MarketChartReference = { label: string; value: number; tone: "low" | "middle" | "high" };

function MarketLineChart({ item, years, references = [], showStats = true, fillArea = false }: { item: MacroSeriesIndicator; years: 1 | 3 | 5 | 10 | "all"; references?: MarketChartReference[]; showStats?: boolean; fillArea?: boolean }) {
  const points = (item.points || []).filter((point) => Number.isFinite(point.value));
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  useEffect(() => setHoverIndex(null), [item.key, years]);
  if (points.length < 2) return <div className="marketToolEmpty compact">暂无走势数据</div>;
  const lastDate = new Date(`${points.at(-1)?.date || ""}T00:00:00`);
  const cutoff = new Date(lastDate);
  if (years !== "all") cutoff.setFullYear(cutoff.getFullYear() - years);
  const visible = years === "all" ? points : points.filter((point) => new Date(`${point.date}T00:00:00`) >= cutoff);
  const values = visible.map((point) => point.value);
  const referenceValues = references.map((reference) => reference.value).filter(Number.isFinite);
  const threshold = marketPressureThresholds[item.key.toLowerCase()];
  const dataMin = Math.min(...values, ...referenceValues, Number.isFinite(threshold) ? threshold : Infinity);
  const dataMax = Math.max(...values, ...referenceValues, Number.isFinite(threshold) ? threshold : -Infinity);
  const dataSpan = Math.max(0.1, dataMax - dataMin);
  const min = dataMin - dataSpan * 0.08;
  const max = dataMax + dataSpan * 0.12;
  const width = 780;
  const height = 308;
  const plot = { left: 58, right: 18, top: 18, bottom: 38 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const xFor = (index: number) => plot.left + (index / Math.max(1, visible.length - 1)) * plotWidth;
  const yFor = (value: number) => plot.top + (1 - (value - min) / Math.max(0.0001, max - min)) * plotHeight;
  const coordinates = visible.map((point, index) => `${xFor(index).toFixed(1)},${yFor(point.value).toFixed(1)}`).join(" ");
  const yTicks = Array.from({ length: 5 }, (_, index) => max - (index / 4) * (max - min));
  const dateIndexes = Array.from(new Set(Array.from({ length: 5 }, (_, index) => Math.round(index / 4 * (visible.length - 1)))));
  const activeIndex = hoverIndex ?? visible.length - 1;
  const active = visible[activeIndex];
  const activeX = xFor(activeIndex);
  const activeY = yFor(active.value);
  const tooltipX = activeX > width - 170 ? activeX - 128 : activeX + 10;
  const tooltipY = Math.max(plot.top + 4, activeY - 48);
  const periodChange = visible.at(-1)!.value - visible[0].value;
  const thresholdY = Number.isFinite(threshold) ? yFor(threshold) : null;
  return (
    <div className="marketLineChart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${item.name}走势`}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const relativeX = (event.clientX - rect.left) / rect.width * width;
          const ratio = Math.max(0, Math.min(1, (relativeX - plot.left) / plotWidth));
          setHoverIndex(Math.round(ratio * (visible.length - 1)));
        }}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {thresholdY !== null ? <g className="marketPressureZone"><rect x={plot.left} y={plot.top} width={plotWidth} height={Math.max(0, thresholdY - plot.top)} /><line x1={plot.left} y1={thresholdY} x2={width - plot.right} y2={thresholdY} /><text x={plot.left + 8} y={Math.max(plot.top + 13, thresholdY - 6)}>压力区</text></g> : null}
        {yTicks.map((tick) => <g className="marketChartGrid" key={tick}><line x1={plot.left} y1={yFor(tick)} x2={width - plot.right} y2={yFor(tick)} /><text x={plot.left - 8} y={yFor(tick) + 4}>{formatSeriesValue(tick, item.unit)}</text></g>)}
        {references.map((reference) => <line className={`marketChartReference ${reference.tone}`} key={reference.label} x1={plot.left} y1={yFor(reference.value)} x2={width - plot.right} y2={yFor(reference.value)} />)}
        {dateIndexes.map((index) => <text className="marketChartDate" key={visible[index].date} x={xFor(index)} y={height - 12} style={{ textAnchor: index === 0 ? "start" : index === visible.length - 1 ? "end" : "middle" }}>{visible[index].date.slice(0, 7)}</text>)}
        {fillArea ? <polygon className="marketChartArea" points={`${plot.left},${height - plot.bottom} ${coordinates} ${width - plot.right},${height - plot.bottom}`} /> : null}
        <polyline className="marketChartPath" points={coordinates} />
        <line className="marketChartCrosshair" x1={activeX} y1={plot.top} x2={activeX} y2={height - plot.bottom} />
        <circle className="marketChartPoint" cx={activeX} cy={activeY} r="4" />
        <g className="marketChartTooltip" transform={`translate(${tooltipX}, ${tooltipY})`}>
          <rect width="118" height="40" rx="4" />
          <text x="9" y="15">{active.date}</text>
          <text x="9" y="31">{formatSeriesValue(active.value, item.unit)}</text>
        </g>
      </svg>
      {showStats ? <div className="marketChartStats">
        <span>区间最低<strong>{formatSeriesValue(Math.min(...values), item.unit)}</strong></span>
        <span>区间最高<strong>{formatSeriesValue(Math.max(...values), item.unit)}</strong></span>
        <span>区间变化<strong className={signedClass(periodChange)}>{periodChange > 0 ? "+" : ""}{formatSeriesValue(periodChange, item.unit)}</strong></span>
        <span>最新日期<strong>{visible.at(-1)?.date}</strong></span>
      </div> : null}
    </div>
  );
}

function MarketTemperaturePage({ enabled }: { enabled: boolean }) {
  const [payload, setPayload] = useState<MarketTemperaturePayload | null>(null);
  const [series, setSeries] = useState<MacroSeriesPayload | null>(null);
  const [years, setYears] = useState<1 | 3 | 5>(1);
  const [selectedKey, setSelectedKey] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState("loading");
    Promise.all([api.marketTemperature(), api.macroSeries()])
      .then(([temperature, macro]) => {
        if (!active) return;
        setPayload(temperature);
        setSeries(macro);
        setState("idle");
      })
      .catch(() => active && setState("error"));
    return () => { active = false; };
  }, [enabled, reload]);

  const indicators = (payload?.indicators || []).filter((item) => !indicatorIsStale(item, payload?.asOf));
  const priority = [...indicators].sort((a, b) => {
    const order: Record<string, number> = { watch: 0, neutral: 1, positive: 2 };
    return (order[a.status || "neutral"] ?? 1) - (order[b.status || "neutral"] ?? 1);
  });
  const seriesItems = (series?.indicators || []).filter((item) => !indicatorIsStale(item, payload?.asOf || series?.asOf));
  const selectedSeries = seriesItems.find((item) => item.key === selectedKey) || seriesItems[0];
  useEffect(() => {
    if (!seriesItems.length || seriesItems.some((item) => item.key === selectedKey)) return;
    const firstPressure = priority.find((indicator) => seriesItems.some((item) => item.key === indicator.key));
    setSelectedKey(firstPressure?.key || seriesItems[0].key);
  }, [selectedKey, seriesItems, priority]);
  const hasScore = typeof payload?.overall?.score === "number" && Number.isFinite(payload.overall.score);
  const score = hasScore ? Math.max(0, Math.min(100, payload.overall?.score ?? 0)) : 0;
  const scoreTone = temperatureTone(payload?.overall?.label === "偏强" ? "positive" : payload?.overall?.label === "防守" ? "watch" : "neutral");
  const temperatureAdvice = marketTemperatureAdvice[payload?.overall?.label || ""] || (hasScore ? "" : marketTemperatureAdvice.待更新);
  const freshness = indicators.reduce((result, item) => {
    if (indicatorFrequency(item) === "monthly") result.monthly += 1;
    else result.current += 1;
    return result;
  }, { current: 0, monthly: 0 });

  return (
    <div className="marketToolPage marketTemperaturePage" data-testid="market-temperature-page">
      {!enabled ? <div className="marketToolSkeleton" /> : state === "loading" ? <div className="marketToolLoading">正在加载市场数据...</div> : state === "error" ? (
        <div className="marketToolError"><span>市场数据加载失败</span><button type="button" onClick={() => setReload((value) => value + 1)}>重新加载</button></div>
      ) : !payload ? <div className="marketToolEmpty">暂无市场温度数据</div> : (
        <>
          <section className="temperatureSnapshot">
            <article className="temperatureScore">
              <span className="temperatureScoreLabel">市场温度<InfoTip text={marketTemperatureHelp} focusable /></span><strong>{hasScore ? score : "--"}{hasScore ? <small>/100</small> : null}</strong><b className={scoreTone}>{payload.overall?.label || "--"}</b>
              <div className="temperatureScale"><i /><i /><i />{hasScore ? <em style={{ left: `${score}%` }} /> : null}</div>
              {temperatureAdvice ? <small className="temperatureAdvice">{temperatureAdvice}</small> : null}
            </article>
            <div className="temperaturePressureList"><span>主要压力</span>{priority.slice(0, 3).map((item) => <button type="button" key={item.key} onClick={() => setSelectedKey(item.key)}><i className={temperatureTone(item.status)} /><strong>{item.name}</strong><em>{item.value || "--"}</em><small>{indicatorPeriodLabel(item)}</small></button>)}</div>
            <article className="temperatureFreshness"><span>数据状态</span><strong>{freshness.current} 项正常</strong><small>{freshness.monthly} 项月度</small></article>
          </section>
          <section className="marketToolPanel temperatureChartPanel">
            <div className="marketToolPanelHead"><div><h2>指标走势</h2><span>{selectedSeries?.name || "--"}</span></div><div className="marketToolRange">{([1, 3, 5] as const).map((range) => <button key={range} className={years === range ? "active" : ""} onClick={() => setYears(range)}>{range}年</button>)}</div></div>
            <div className="temperatureChartLayout">
              <nav className="temperatureIndicatorNav" aria-label="市场指标">{seriesItems.map((item) => <button type="button" key={item.key} className={selectedSeries?.key === item.key ? "active" : ""} onClick={() => setSelectedKey(item.key)}><span>{item.name}</span><strong>{item.value || item.current || "--"}</strong><small>{indicatorPeriodLabel(item)}</small></button>)}</nav>
              <div className="temperatureChartStage">{selectedSeries ? <MarketLineChart item={selectedSeries} years={years} /> : <div className="marketToolEmpty compact">暂无走势数据</div>}</div>
            </div>
          </section>
          <section className="marketToolPanel temperatureTablePanel">
            <div className="marketToolPanelHead"><h2>全部指标</h2><span>{indicators.length} 项</span></div>
            <div className="marketToolTable"><table><thead><tr><th>因子</th><th>数据周期</th><th>当前读数</th><th>变化</th><th>压力</th><th>主要影响</th></tr></thead><tbody>
              {indicators.map((item: TemperatureIndicator) => <tr key={item.key}><td><strong>{item.name}</strong></td><td>{indicatorPeriodLabel(item)}</td><td>{item.value || "--"}</td><td className={signedClass(item.change)}>{item.change || "--"}</td><td><b className={`toolStatus ${temperatureTone(item.status)}`}>{item.level || "--"}</b></td><td>{item.impact || item.explain || "--"}</td></tr>)}
            </tbody></table></div>
          </section>
        </>
      )}
    </div>
  );
}

function IndexValuationPage({ enabled }: { enabled: boolean }) {
  const [payload, setPayload] = useState<IndexValuationPayload | null>(null);
  const [symbol, setSymbol] = useState("QQQ");
  const [metricKey, setMetricKey] = useState("pe");
  const [years, setYears] = useState<ValuationRange>(5);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState("loading");
    api.indexValuation()
      .then((value) => { if (active) { setPayload(value); setState("idle"); } })
      .catch(() => active && setState("error"));
    return () => { active = false; };
  }, [enabled, reload]);

  const indices = payload?.indices || [];
  const selected = indices.find((item) => item.index?.symbol === symbol) || indices[0];
  const currentMetrics = (selected?.metrics || []).filter((item) => ["pe", "pb", "roe"].includes(item.key) && item.value !== null && item.value !== undefined);
  const selectedMetric = currentMetrics.find((item) => item.key === metricKey) || currentMetrics[0];
  const peMetric = currentMetrics.find((item) => item.key === "pe");
  const pbMetric = currentMetrics.find((item) => item.key === "pb");
  const roeMetric = currentMetrics.find((item) => item.key === "roe");
  const summary = selected?.valuationSummary;

  useEffect(() => {
    if (selectedMetric || !currentMetrics.length) return;
    setMetricKey(currentMetrics[0].key);
  }, [currentMetrics, selectedMetric]);

  const chartItem: MacroSeriesIndicator | null = selectedMetric ? {
    key: `valuation-${selected?.index?.symbol || "index"}-${selectedMetric.key}`,
    name: `${selected?.index?.symbol || ""} ${selectedMetric.label || selectedMetric.key}`.trim(),
    current: selectedMetric.value ?? undefined,
    value: valuationValue(selectedMetric.value, selectedMetric.unit),
    unit: selectedMetric.unit === "x" ? "倍" : selectedMetric.unit,
    asOf: selected?.asOf,
    points: selectedMetric.trend
  } : null;
  const historyReady = (selectedMetric?.trend?.length || 0) > 1;
  const rangePoints = valuationRangePoints(selectedMetric, years);
  const rangeValues = rangePoints.map((point) => point.value).filter(Number.isFinite);
  const p30 = valuationQuantile(rangeValues, 0.3);
  const median = valuationQuantile(rangeValues, 0.5);
  const p70 = valuationQuantile(rangeValues, 0.7);
  const rangePercentile = valuationRangePercentile(selectedMetric, years);
  const chartReferences: MarketChartReference[] = [
    { label: "30分位", value: p30, tone: "low" },
    { label: "中位值", value: median, tone: "middle" },
    { label: "70分位", value: p70, tone: "high" }
  ].filter((item): item is MarketChartReference => item.value !== null);
  const pePercentile = valuationRangePercentile(peMetric, years);
  const pbPercentile = valuationRangePercentile(pbMetric, years);
  const valuationLevel = valuationRangeLevel(pePercentile, pbPercentile, summary?.level);
  const rangeLabel = years === "all" ? "全部历史" : `近${years}年`;
  const indexLabel = selected?.index?.symbol === "QQQ" ? "纳指100" : selected?.index?.symbol === "SPY" ? "标普500" : selected?.index?.name || "指数";
  const peRangePoints = valuationRangePoints(peMetric, years);
  const sampleStart = peRangePoints[0]?.date.slice(0, 7);
  const sampleEnd = peRangePoints.at(-1)?.date.slice(0, 7);
  const valuationConclusion = pePercentile === null || pbPercentile === null
    ? "历史位置暂不可用"
    : `PE位于${rangeLabel}${pePercentile.toFixed(2)}%分位，PB位于${pbPercentile.toFixed(2)}%分位。`;
  const valuationAction = valuationLevel === "偏高"
    ? "估值安全边际偏低，不宜仅凭估值追高，新增资金更适合分批。"
    : valuationLevel === "偏低"
      ? "估值进入相对低位，可作为分批关注区间。"
      : valuationLevel === "适中"
        ? "估值处于中间区域，可结合趋势和盈利变化分批观察。"
        : "";
  const headlineStats = [
    { label: "PE", value: valuationValue(peMetric?.value, peMetric?.unit) },
    { label: "PE 历史分位", value: pePercentile === null ? "--" : `${pePercentile.toFixed(2)}%` },
    { label: "PB", value: valuationValue(pbMetric?.value, pbMetric?.unit) },
    { label: "PB 历史分位", value: pbPercentile === null ? "--" : `${pbPercentile.toFixed(2)}%` }
  ];
  const overviewStats = [
    { label: "ROE", value: valuationValue(roeMetric?.value, roeMetric?.unit) },
    ...(summary?.dividendYield === null || summary?.dividendYield === undefined ? [] : [{ label: "股息率", value: valuationValue(summary.dividendYield, "%") }]),
    ...(summary?.peg === null || summary?.peg === undefined ? [] : [{ label: "预测 PEG", value: valuationValue(summary.peg, "x") }]),
    { label: "样本区间", value: sampleStart && sampleEnd ? `${sampleStart} 至 ${sampleEnd}` : "--" },
    { label: "估值状态", value: valuationLevel ? `${valuationLevel}区间` : "--" }
  ];

  return (
    <div className="marketToolPage indexValuationPage" data-testid="index-valuation-page">
      {!enabled ? <div className="marketToolSkeleton" /> : state === "loading" ? <div className="marketToolLoading">正在加载估值数据...</div> : state === "error" ? (
        <div className="marketToolError"><span>估值数据加载失败</span><button type="button" onClick={() => setReload((value) => value + 1)}>重新加载</button></div>
      ) : !selected ? <div className="marketToolEmpty">暂无指数估值数据</div> : (
        <section className="marketToolPanel valuationPanel">
          <div className="valuationPanelHead">
            <div><h2>{indexLabel}估值观察</h2><span>{formatDate(summary?.asOf || selected?.asOf)}</span></div>
            <div className="valuationRange" role="tablist" aria-label="选择历史区间">
              {([5, 10, "all"] as const).map((range) => <button type="button" key={range} className={years === range ? "active" : ""} onClick={() => setYears(range)}>{range === "all" ? "全部历史" : `近${range}年`}</button>)}
            </div>
          </div>
          <div className="valuationIndexBar">
            <div className="valuationIndexTabs" role="tablist" aria-label="选择指数">
              {indices.map((item: IndexValuationIndex) => <button type="button" key={item.index?.symbol} className={selected?.index?.symbol === item.index?.symbol ? "active" : ""} onClick={() => { setSymbol(item.index?.symbol || "QQQ"); setMetricKey("pe"); setYears(5); }}>{item.index?.symbol === "QQQ" ? "纳指100" : item.index?.symbol === "SPY" ? "标普500" : item.index?.name}</button>)}
            </div>
          </div>
          <div className="valuationOverview">
            <article className="valuationLead">
              <span>当前结论</span>
              <strong className={`valuationLevel ${valuationLevel === "偏低" ? "low" : valuationLevel === "适中" ? "middle" : "high"}`}>估值{valuationLevel || "--"}</strong>
              <p>{valuationConclusion}{valuationAction ? ` ${valuationAction}` : ""}</p>
            </article>
            <div className="valuationHeadlineStats">{headlineStats.map((item) => <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong></article>)}</div>
          </div>
          <div className="valuationOverviewStats">{overviewStats.map((item) => <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong></article>)}</div>
          <div className="valuationMetricTabs" role="tablist" aria-label="选择估值指标">
            {currentMetrics.map((item: IndexValuationMetric) => <button type="button" key={item.key} className={selectedMetric?.key === item.key ? "active" : ""} onClick={() => setMetricKey(item.key)}>{item.label || item.key.toUpperCase()}走势</button>)}
          </div>
          <div className="valuationChartStage">
            <div className="valuationChartTitle"><div><h2>{selectedMetric?.label || "估值"}历史走势</h2><span>{rangePercentile === null ? "--" : `当前处于${rangeLabel}${rangePercentile.toFixed(2)}%分位`}</span></div></div>
            <div className="valuationChartLayout">
              {historyReady && chartItem ? <MarketLineChart item={chartItem} years={years} references={chartReferences} showStats={false} fillArea /> : <div className="marketToolEmpty compact">暂无历史估值数据</div>}
              <aside className="valuationReferenceCards">
                {[...chartReferences].reverse().map((item) => <span className={item.tone} key={item.label}>{item.label}<b>{valuationValue(item.value, selectedMetric?.unit)}</b></span>)}
                <span className="current">当前{selectedMetric?.label}<b>{valuationValue(selectedMetric?.value, selectedMetric?.unit)}</b></span>
              </aside>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function strengthBucket(row: StrengthRow): StrengthBucket {
  const score = row.score || 0;
  const heat = row.crowding?.score || 0;
  if (score >= 75 && heat < 72) return "watch";
  if (score >= 75 && heat >= 72) return "hot";
  if (score < 55) return "avoid";
  return "neutral";
}

function strengthTone(row: StrengthRow) {
  const bucket = strengthBucket(row);
  if (bucket === "avoid") return "negative";
  if (bucket === "watch") return "positive";
  return "neutral";
}

function StrengthFilterFields({
  query,
  sector,
  heat,
  sort,
  sectors,
  className = "",
  onQuery,
  onSector,
  onHeat,
  onSort
}: {
  query: string;
  sector: string;
  heat: string;
  sort: StrengthSort;
  sectors: string[];
  className?: string;
  onQuery: (value: string) => void;
  onSector: (value: string) => void;
  onHeat: (value: string) => void;
  onSort: (value: StrengthSort) => void;
}) {
  return (
    <div className={`strengthFilters ${className}`.trim()}>
      <label><span>股票</span><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="输入股票代码或名称" /></label>
      <label><span>板块</span><select value={sector} onChange={(event) => onSector(event.target.value)}><option value="all">全部板块</option>{sectors.map((item) => <option key={item} value={item}>{marketSectorName(item)}</option>)}</select></label>
      <label><span>成交热度</span><select value={heat} onChange={(event) => onHeat(event.target.value)}><option value="all">全部热度</option><option value="normal">正常</option><option value="rising">升温</option><option value="hot">偏热</option></select></label>
      <label><span>排序</span><select value={sort} onChange={(event) => onSort(event.target.value as StrengthSort)}><option value="score">按强度</option><option value="return20d">按近20日</option><option value="relative">按相对大盘</option><option value="crowding">按热度</option></select></label>
    </div>
  );
}

function MarketStrengthPage({ enabled, onOpenStock }: { enabled: boolean; onOpenStock: (symbol: string, source?: StockSource) => void }) {
  const [payload, setPayload] = useState<StrengthScannerPayload | null>(null);
  const [view, setView] = useState<StrengthView>("watch");
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("all");
  const [heat, setHeat] = useState("all");
  const [sort, setSort] = useState<StrengthSort>("score");
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"idle" | "loading" | "refreshing" | "error">("idle");
  const [reload, setReload] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const filterCloseRef = useRef<HTMLButtonElement>(null);
  const filterSheetRef = useRef<HTMLElement>(null);
  const pageSize = 20;
  const deferredQuery = useDeferredValue(query.trim());

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState(payload ? "refreshing" : "loading");
    api.strengthScanner({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      bucket: view,
      q: deferredQuery,
      sector,
      heat,
      sort
    }).then((value) => {
      if (!active) return;
      setPayload(value);
      setState("idle");
    }).catch(() => active && setState("error"));
    return () => { active = false; };
  }, [deferredQuery, enabled, heat, page, reload, sector, sort, view]);

  const visibleRows = payload?.rows || [];
  const sectors = payload?.sectors || [];
  useEffect(() => {
    if (!filterOpen) return;
    window.requestAnimationFrame(() => filterCloseRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFilterOpen(false);
      if (event.key !== "Tab") return;
      const focusable = Array.from(filterSheetRef.current?.querySelectorAll<HTMLElement>("button, input, select, [tabindex]:not([tabindex='-1'])") || []).filter((element) => !element.hasAttribute("disabled"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const onResize = () => {
      if (window.innerWidth > 1100) setFilterOpen(false);
    };
    document.body.classList.add("strengthFilterLocked");
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.body.classList.remove("strengthFilterLocked");
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      window.requestAnimationFrame(() => filterTriggerRef.current?.focus());
    };
  }, [filterOpen]);
  const total = payload?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const themes = [...(payload?.themes?.leaders || []).slice(0, 3), ...(payload?.themes?.risk || []).slice(0, 3)];
  const maxTheme = Math.max(1, ...themes.map((item) => Math.abs(numericValue(item.vsMarket))));
  const bucketCount = (bucket: StrengthView) => payload?.counts?.[bucket] ?? 0;
  const activeFilterCount = Number(Boolean(query.trim())) + Number(sector !== "all") + Number(heat !== "all") + Number(sort !== "score");
  const changeView = (value: StrengthView) => { setView(value); setPage(1); };
  const changeQuery = (value: string) => { setQuery(value); setPage(1); };
  const changeSector = (value: string) => { setSector(value); setPage(1); };
  const changeHeat = (value: string) => { setHeat(value); setPage(1); };
  const changeSort = (value: StrengthSort) => { setSort(value); setPage(1); };
  const resetFilters = () => {
    setQuery("");
    setSector("all");
    setHeat("all");
    setSort("score");
    setPage(1);
  };

  return (
    <div className="marketToolPage marketStrengthPage" data-testid="market-strength-page">
      {!enabled ? <div className="marketToolSkeleton" /> : state === "loading" ? <div className="marketToolLoading">正在加载强弱数据...</div> : state === "error" && !payload ? (
        <div className="marketToolError"><span>强弱数据加载失败</span><button type="button" onClick={() => setReload((value) => value + 1)}>重新加载</button></div>
      ) : !payload ? <div className="marketToolEmpty">暂无行业板块强弱数据</div> : (
        <>
          <section className="strengthMetrics">
            <article><span>市场中位强度</span><strong>{payload.summary?.medianScore ?? "--"}</strong></article>
            <article><span>领先板块</span><strong>{marketSectorName(payload.themes?.leaders?.[0]?.name)}</strong></article>
            <article><span>强但偏热</span><strong>{bucketCount("hot")}</strong></article>
            <article><span>落后板块</span><strong>{marketSectorName(payload.themes?.risk?.[0]?.name)}</strong></article>
          </section>
          <div className="strengthTopGrid">
            <section className="marketToolPanel"><div className="marketToolPanelHead"><h2>行业强弱</h2><span>相对大盘</span></div><div className="sectorStrengthBars">{themes.map((item) => { const value = numericValue(item.vsMarket); const barWidth = Math.max(2, Math.abs(value) / maxTheme * 50); return <div key={`${item.name}-${item.vsMarket}`}><strong>{marketSectorName(item.name)}</strong><span><i className={value >= 0 ? "positive" : "negative"} style={{ left: `${value >= 0 ? 50 : 50 - barWidth}%`, width: `${barWidth}%` }} /></span><em className={signedClass(value)}>{item.vsMarket || "--"}</em></div>; })}</div></section>
            <section className="marketToolPanel"><div className="marketToolPanelHead"><h2>今日先看</h2></div><div className="strengthFocusList">
              <button onClick={() => changeView("watch")}><span>值得观察</span><strong>{bucketCount("watch")} 只</strong></button>
              <button onClick={() => changeView("hot")}><span>强势但偏热</span><strong>{bucketCount("hot")} 只</strong></button>
              <button onClick={() => changeView("avoid")}><span>降低优先级</span><strong>{bucketCount("avoid")} 只</strong></button>
            </div></section>
          </div>
          {state === "error" ? <div className="marketToolError compact"><span>更新失败，当前显示上次结果</span><button type="button" onClick={() => setReload((value) => value + 1)}>重新加载</button></div> : null}
          <section className="marketToolPanel">
            <div className="marketToolPanelHead strengthListHead">
              <div className="marketToolTabs">{([["watch", "值得观察"], ["hot", "强但偏热"], ["avoid", "风险回避"], ["all", "全部股票"]] as const).map(([key, label]) => <button key={key} className={view === key ? "active" : ""} onClick={() => changeView(key)}>{label}<small>{bucketCount(key)}</small></button>)}</div>
              <StrengthFilterFields query={query} sector={sector} heat={heat} sort={sort} sectors={sectors} className="strengthDesktopFilters" onQuery={changeQuery} onSector={changeSector} onHeat={changeHeat} onSort={changeSort} />
              <div className="strengthMobileControls">
                <input value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="搜索股票" aria-label="搜索股票" />
                <button ref={filterTriggerRef} type="button" onClick={() => setFilterOpen(true)}>筛选{activeFilterCount ? <b>{activeFilterCount}</b> : null}</button>
              </div>
            </div>
            <div className="marketToolTable strengthTable" aria-busy={state === "refreshing"}><table><thead><tr><th>强度</th><th>股票</th><th>板块</th><th>近20日</th><th>相对大盘</th><th>成交热度</th><th>状态</th><th>观察建议</th></tr></thead><tbody>
              {state !== "refreshing" ? visibleRows.map((row) => <tr key={row.symbol} onClick={() => onOpenStock(row.symbol, "stocks")}><td><strong>{row.score ?? "--"}</strong></td><td><strong>{row.symbol}</strong><small>{row.name || ""}</small></td><td>{marketSectorName(row.sectorProxy || row.sector)}</td><td className={signedClass(row.periods?.["20d"])}>{row.periods?.["20d"] || "--"}</td><td className={signedClass(row.relative?.spy)}>{row.relative?.spy || "--"}</td><td>{ratioDisplay(row.crowding?.volumeRatio)}</td><td><b className={`toolStatus ${strengthTone(row)}`}>{row.label || "--"}</b></td><td>{row.action || "--"}</td></tr>) : null}
              {state === "refreshing" ? <tr><td colSpan={8}><div className="marketToolLoading compact">正在更新...</div></td></tr> : null}
              {state !== "refreshing" && !visibleRows.length ? <tr><td colSpan={8}><div className="marketToolEmpty compact">当前筛选下没有标的</div></td></tr> : null}
            </tbody></table></div>
            <div className="strengthMobileList">
              {state !== "refreshing" ? visibleRows.map((row) => (
                <button type="button" className="strengthMobileRow" key={row.symbol} onClick={() => onOpenStock(row.symbol, "stocks")}>
                  <strong className="strengthMobileScore">{row.score ?? "--"}</strong>
                  <span className="strengthMobileIdentity"><strong>{row.symbol}</strong><small>{row.name || marketSectorName(row.sectorProxy || row.sector)}</small><b className={`toolStatus ${strengthTone(row)}`}>{row.label || "--"}</b></span>
                  <span className="strengthMobileDatum"><small>近20日</small><strong className={signedClass(row.periods?.["20d"])}>{row.periods?.["20d"] || "--"}</strong></span>
                  <span className="strengthMobileDatum"><small>相对大盘</small><strong className={signedClass(row.relative?.spy)}>{row.relative?.spy || "--"}</strong></span>
                </button>
              )) : <div className="marketToolLoading compact">正在更新...</div>}
              {state !== "refreshing" && !visibleRows.length ? <div className="marketToolEmpty compact">当前筛选下没有标的</div> : null}
            </div>
            {total ? <footer className="strengthPagination"><span>共 {total.toLocaleString("zh-CN")} 只，每页 {pageSize} 只</span><div><button type="button" aria-label="上一页" disabled={currentPage <= 1 || state === "refreshing"} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button><strong>{currentPage} / {pageCount}</strong><button type="button" aria-label="下一页" disabled={currentPage >= pageCount || state === "refreshing"} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>›</button></div></footer> : null}
          </section>
          {filterOpen ? (
            <div className="strengthFilterOverlay" role="presentation" onMouseDown={() => setFilterOpen(false)}>
              <section ref={filterSheetRef} className="strengthFilterSheet" role="dialog" aria-modal="true" aria-label="筛选股票" onMouseDown={(event) => event.stopPropagation()}>
                <header><strong>筛选股票</strong><button ref={filterCloseRef} type="button" aria-label="关闭筛选" onClick={() => setFilterOpen(false)}>×</button></header>
                <StrengthFilterFields query={query} sector={sector} heat={heat} sort={sort} sectors={sectors} className="strengthSheetFilters" onQuery={changeQuery} onSector={changeSector} onHeat={changeHeat} onSort={changeSort} />
                <footer><button type="button" className="strengthFilterReset" onClick={resetFilters}>重置</button><button type="button" className="strengthFilterApply" onClick={() => setFilterOpen(false)}>查看 {total.toLocaleString("zh-CN")} 只股票</button></footer>
              </section>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function cryptoEtfMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  const absolute = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  if (absolute >= 1_000_000_000) return `${sign}$${(absolute / 1_000_000_000).toFixed(2)}B`;
  return `${sign}$${(absolute / 1_000_000).toFixed(1)}M`;
}

function cryptoEtfStreak(history: CryptoEtfFlowPayload["assets"]["BTC"]["history"]) {
  const latest = history.at(-1)?.flowUsd || 0;
  if (!latest) return "持平";
  const direction = latest > 0 ? 1 : -1;
  let count = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const flow = history[index].flowUsd;
    if ((flow > 0 ? 1 : flow < 0 ? -1 : 0) !== direction) break;
    count += 1;
  }
  return `连续 ${count} 日净${direction > 0 ? "流入" : "流出"}`;
}

function CryptoEtfFlowView() {
  const [payload, setPayload] = useState<CryptoEtfFlowPayload | null>(null);
  const [asset, setAsset] = useState<CryptoEtfAssetKey>("BTC");
  const [interval, setInterval] = useState<CryptoEtfInterval>("day");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [tableAsset, setTableAsset] = useState<"all" | CryptoEtfAssetKey>("all");
  const [tablePage, setTablePage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState(0);
  const dateRangeRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    api.cryptoEtfFlows()
      .then((data) => {
        if (alive) setPayload(data);
      })
      .catch(() => {
        if (alive) setError("加密 ETF 数据加载失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [requestId]);
  useEffect(() => setTablePage(0), [tableAsset]);

  if (loading) return <div className="cryptoEtfState">加载中</div>;
  if (error || !payload?.assets?.BTC || !payload?.assets?.ETH) {
    return <div className="cryptoEtfState"><span>{error || "加密 ETF 数据暂不可用"}</span><button type="button" className="requestRetry" onClick={() => setRequestId((value) => value + 1)}>重新加载</button></div>;
  }

  const rangeInvalid = Boolean(startDate && endDate && startDate > endDate);
  const firstDate = payload.history[0]?.date || "";
  const latestDate = payload.history.at(-1)?.date || payload.asOf;
  const recentRows = payload.history.slice(-20).reverse();
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(recentRows.length / pageSize));
  const tableRows = recentRows.slice(tablePage * pageSize, (tablePage + 1) * pageSize);
  const tableValue = (row: CryptoEtfFlowPayload["history"][number]) => tableAsset === "BTC"
    ? row.btcFlowUsd
    : tableAsset === "ETH"
      ? row.ethFlowUsd
      : row.totalFlowUsd;
  return (
    <div className="cryptoEtfView">
      <section className="cryptoEtfOverview">
        <div className="cryptoEtfPanelHead"><strong>资金概览</strong><span>数据截至 {payload.asOf}</span></div>
        <div className="cryptoEtfTableScroll">
          <table>
            <thead><tr><th>资产</th><th>最近交易日</th><th>近1周</th><th>近1月</th><th>连续方向</th></tr></thead>
            <tbody>{(["BTC", "ETH"] as const).map((key) => {
              const item = payload.assets[key];
              const streak = cryptoEtfStreak(item.history);
              return (
                <tr key={key}>
                  <td><div className="cryptoEtfAsset"><i className={key.toLowerCase()}>{key === "BTC" ? "₿" : "◆"}</i><span><strong>{key}</strong><small>{key === "BTC" ? "比特币现货 ETF" : "以太坊现货 ETF"}</small></span></div></td>
                  <td className={signedClass(item.latestFlowUsd)}>{cryptoEtfMoney(item.latestFlowUsd)}</td>
                  <td className={signedClass(item.flow5dUsd)}>{cryptoEtfMoney(item.flow5dUsd)}</td>
                  <td className={signedClass(item.flow21dUsd)}>{cryptoEtfMoney(item.flow21dUsd)}</td>
                  <td><span className={`cryptoEtfDirection ${signedClass(item.latestFlowUsd)}`}>{streak}</span></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </section>

      <section className="cryptoEtfChartPanel">
        <header className="cryptoEtfPanelHead">
          <div className="cryptoEtfPanelTitle"><strong>资金趋势</strong><div className="marketSegment" role="group" aria-label="图表资产"><button type="button" className={asset === "BTC" ? "active" : ""} aria-pressed={asset === "BTC"} onClick={() => setAsset("BTC")}>BTC</button><button type="button" className={asset === "ETH" ? "active" : ""} aria-pressed={asset === "ETH"} onClick={() => setAsset("ETH")}>ETH</button></div></div>
          <div className="cryptoEtfChartTools">
            <div className="marketSegment" role="group" aria-label="时间粒度">
              {([['day', '单日'], ['week', '单周'], ['month', '单月']] as const).map(([value, label]) => <button type="button" key={value} className={interval === value ? "active" : ""} aria-pressed={interval === value} onClick={() => setInterval(value)}>{label}</button>)}
            </div>
            <details ref={dateRangeRef} className="cryptoEtfDateRange">
              <summary className={startDate || endDate ? "active" : ""}>日期范围</summary>
              <div>
                <label>开始日期<input type="date" min={firstDate} max={latestDate} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
                <label>结束日期<input type="date" min={firstDate} max={latestDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
                {rangeInvalid ? <small>开始日期不能晚于结束日期</small> : null}
                <footer><button type="button" onClick={() => { setStartDate(""); setEndDate(""); }}>重置</button><button type="button" disabled={rangeInvalid} onClick={() => { if (dateRangeRef.current) dateRangeRef.current.open = false; }}>完成</button></footer>
              </div>
            </details>
          </div>
        </header>
        <Suspense fallback={<div className="cryptoEtfChartLoading">加载图表</div>}>
          <CryptoEtfChart payload={payload} asset={asset} interval={interval} startDate={rangeInvalid ? "" : startDate} endDate={rangeInvalid ? "" : endDate} />
        </Suspense>
      </section>

      <section className="cryptoEtfHistory">
        <div className="cryptoEtfPanelHead"><strong>资金明细</strong><div className="marketSegment" role="group" aria-label="明细资产"><button type="button" className={tableAsset === "BTC" ? "active" : ""} aria-pressed={tableAsset === "BTC"} onClick={() => setTableAsset("BTC")}>BTC</button><button type="button" className={tableAsset === "ETH" ? "active" : ""} aria-pressed={tableAsset === "ETH"} onClick={() => setTableAsset("ETH")}>ETH</button><button type="button" className={tableAsset === "all" ? "active" : ""} aria-pressed={tableAsset === "all"} onClick={() => setTableAsset("all")}>全部</button></div></div>
        <div className="cryptoEtfTableScroll"><table>
          <thead><tr><th>日期</th>{tableAsset === "all" || tableAsset === "BTC" ? <th>BTC净流量</th> : null}{tableAsset === "all" || tableAsset === "ETH" ? <th>ETH净流量</th> : null}{tableAsset === "all" ? <th>合计</th> : null}<th>资金方向</th></tr></thead>
          <tbody>{tableRows.map((row) => {
            const value = tableValue(row);
            return (
              <tr key={row.date}>
                <td>{row.date}</td>
                {tableAsset === "all" || tableAsset === "BTC" ? <td className={signedClass(row.btcFlowUsd)}>{cryptoEtfMoney(row.btcFlowUsd)}</td> : null}
                {tableAsset === "all" || tableAsset === "ETH" ? <td className={signedClass(row.ethFlowUsd)}>{cryptoEtfMoney(row.ethFlowUsd)}</td> : null}
                {tableAsset === "all" ? <td className={signedClass(row.totalFlowUsd)}>{cryptoEtfMoney(row.totalFlowUsd)}</td> : null}
                <td className={signedClass(value)}>{Number(value || 0) > 0 ? "净流入" : Number(value || 0) < 0 ? "净流出" : "持平"}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
        {pageCount > 1 ? <footer className="cryptoEtfPagination"><button type="button" title="上一页" aria-label="上一页" disabled={tablePage === 0} onClick={() => setTablePage((page) => Math.max(0, page - 1))}>←</button><span>{tablePage + 1} / {pageCount}</span><button type="button" title="下一页" aria-label="下一页" disabled={tablePage >= pageCount - 1} onClick={() => setTablePage((page) => Math.min(pageCount - 1, page + 1))}>→</button></footer> : null}
      </section>
    </div>
  );
}

function MarketPage({ bootstrap, onPage }: { bootstrap: BootstrapPayload | null; onPage: (page: PageKey) => void }) {
  const [marketView, setMarketView] = useState<"sectors" | "crypto" | "sentiment">("sectors");
  const [sectorRange, setSectorRange] = useState<"day" | "week" | "month">("day");
  const [sectorPayload, setSectorPayload] = useState<SectorFlowPayload | null>(null);
  const [sectorState, setSectorState] = useState<"loading" | "idle" | "error">("loading");
  const [sectorReload, setSectorReload] = useState(0);
  const activeSectorPayload = sectorPayload?.board === sectorRange ? sectorPayload : null;
  const sectors = useMemo(() => {
    const rows = activeSectorPayload?.rows?.length
      ? activeSectorPayload.rows
      : sectorRange === "day" && !sectorPayload
        ? getSectorRows(bootstrap)
        : [];
    return rows.filter((item) => isDisplaySector(item.sector));
  }, [activeSectorPayload, bootstrap, sectorPayload, sectorRange]);
  const [viewMode, setViewMode] = useState<"rank" | "map">("map");
  const [selectedSector, setSelectedSector] = useState(sectors[0]?.sector || "");
  const [heatTooltip, setHeatTooltip] = useState<{
    sector: string;
    change: string;
    flow: string;
    changeClass: string;
    flowClass: string;
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    setSectorPayload(null);
    setSelectedSector("");
    setSectorState("loading");
    api.sectors({ board: sectorRange, limit: 30 })
      .then((payload) => {
        if (!alive) return;
        setSectorPayload(payload);
        setSectorState("idle");
      })
      .catch(() => {
        if (!alive) return;
        setSectorPayload(null);
        setSectorState("error");
      });
    return () => {
      alive = false;
    };
  }, [sectorRange, sectorReload]);
  useEffect(() => {
    if (!sectors.length) return;
    if (!selectedSector || !sectors.some((item) => item.sector === selectedSector)) {
      setSelectedSector(sectors[0].sector);
    }
  }, [sectors, selectedSector]);
  const selected = sectors.find((item) => item.sector === selectedSector) || sectors[0];
  const volumeRows = (bootstrap?.movers?.boards?.volume?.rows || []).slice(0, 8);
  const sectorChange = (sector?: typeof sectors[number]) => Number(sector?.avgChangePct ?? sector?.avgChange ?? 0);
  const sectorFlowTone = (sector?: typeof sectors[number]) => sectorChange(sector) >= 0 ? "up" : "down";
  const sectorFlowLabel = (sector?: typeof sectors[number]) => Number(sector?.netFlowProxy || 0) >= 0 ? "资金流入" : "资金流出";
  const showHeatTooltip = (target: HTMLButtonElement, sector: typeof sectors[number]) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const rect = target.getBoundingClientRect();
    setHeatTooltip({
      sector: sector.sector,
      change: signed(sectorChange(sector)),
      flow: money(sector.netFlowProxy),
      changeClass: signedClass(sectorChange(sector)),
      flowClass: signedClass(sector.netFlowProxy),
      x: Math.max(116, Math.min(window.innerWidth - 116, rect.left + rect.width / 2)),
      y: Math.max(96, rect.top - 8)
    });
  };
  const heatTiles = useMemo(() => {
    const rawValues = sectors.map((sector) => ({
      value: Math.max(1, Math.abs(Number(sector.netFlowProxy || 0)) || Number(sector.activeValue || 0))
    }));
    const max = Math.max(1, ...rawValues.map((item) => item.value));
    // Keep the smallest sectors readable and tappable without changing their order.
    const values = rawValues.map((item) => ({ value: Math.max(item.value, max * 0.03) }));
    const rects = treemapRects(values);
    return sectors.map((sector, index) => {
      const rect = rects[index] || { x: 0, y: 0, w: 100, h: 100 };
      const ratio = values[index].value / max;
      const area = rect.w * rect.h;
      const style: CSSProperties = {
        left: `calc(${rect.x}% + 1px)`,
        top: `calc(${rect.y}% + 1px)`,
        width: `calc(${rect.w}% - 2px)`,
        height: `calc(${rect.h}% - 2px)`
      };
      return {
        sector,
        style,
        sizeClass: area > 1500 ? "heatLarge" : area > 650 ? "heatMedium" : "heatSmall",
        contentClass: area > 500 && rect.w >= 14 && rect.h >= 10
          ? "heatFull"
          : area > 180 && rect.w >= 9 && rect.h >= 7
            ? "heatCompact"
            : "heatLabelOnly",
        strengthClass: ratio > 0.58 || Math.abs(sectorChange(sector)) >= 2 ? "heatStrong" : ratio > 0.25 || Math.abs(sectorChange(sector)) >= 0.8 ? "heatMid" : "heatSoft"
      };
    });
  }, [sectors]);
  return (
    <div className="marketPageV3">
      <div className="marketViewTabs" role="tablist" aria-label={`${pageLabels.market}分类`}>
        <button type="button" role="tab" aria-selected={marketView === "sectors"} className={marketView === "sectors" ? "active" : ""} onClick={() => setMarketView("sectors")}>板块资金</button>
        <button type="button" role="tab" aria-selected={marketView === "crypto"} className={marketView === "crypto" ? "active" : ""} onClick={() => setMarketView("crypto")}>加密 ETF</button>
        <button type="button" role="tab" aria-selected={marketView === "sentiment"} className={marketView === "sentiment" ? "active" : ""} onClick={() => setMarketView("sentiment")}>散户情绪</button>
      </div>
      {marketView === "sectors" ? (
      <>
      <section className="marketWorkbenchV3">
        <div className="marketToolbarV3">
          <div className="marketToolGroupV3">
            <span>视图</span>
            <div className="marketSegmentV3">
              <button type="button" className={viewMode === "map" ? "active" : ""} onClick={() => setViewMode("map")}>热力图</button>
              <button type="button" className={viewMode === "rank" ? "active" : ""} onClick={() => setViewMode("rank")}>排行</button>
            </div>
          </div>
          <div className="marketToolGroupV3">
            <span>周期</span>
            <div className="marketSegmentV3">
              <button type="button" className={sectorRange === "day" ? "active" : ""} onClick={() => setSectorRange("day")}>当日</button>
              <button type="button" className={sectorRange === "week" ? "active" : ""} onClick={() => setSectorRange("week")}>近1周</button>
              <button type="button" className={sectorRange === "month" ? "active" : ""} onClick={() => setSectorRange("month")}>近1月</button>
            </div>
          </div>
        </div>
        {sectorState === "error" && sectors.length ? (
          <div className="marketInlineStateV3">
            <span>板块数据更新失败，当前显示已有数据</span>
            <button type="button" onClick={() => setSectorReload((value) => value + 1)}>重新加载</button>
          </div>
        ) : null}
        <div className="marketBoardV3" aria-busy={sectorState === "loading"}>
          <div className="marketMainV3">
            {viewMode === "rank" ? (
              <div className="marketRankV3">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>板块</th>
                      <th>资金方向</th>
                      <th>上涨广度</th>
                      <th>成交活跃</th>
                      <th>均涨跌</th>
                      <th>代表股票</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectors.map((sector, index) => (
                      <tr
                        key={sector.sector}
                        className={sector.sector === selected?.sector ? "selected" : ""}
                        onClick={() => setSelectedSector(sector.sector)}
                      >
                        <td>{String(index + 1).padStart(2, "0")}</td>
                        <td><strong>{sector.sector}</strong></td>
                        <td className={signedClass(sector.netFlowProxy)}>{money(sector.netFlowProxy)}</td>
                        <td>{Number.isFinite(sector.breadthPct) ? `${sector.upCount || 0}涨 / ${sector.downCount || 0}跌` : "--"}</td>
                        <td>{sector.activeValueLabel || compactMoney(sector.activeValue)}</td>
                        <td className={signedClass(sectorChange(sector))}>{signed(sectorChange(sector))}</td>
                        <td>{(sector.leaders || []).slice(0, 4).map((leader) => leader.symbol).join(" / ") || "--"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="marketRankMobileV3">
                  {sectors.map((sector, index) => (
                    <button
                      type="button"
                      key={sector.sector}
                      className={sector.sector === selected?.sector ? "selected" : ""}
                      onClick={() => setSelectedSector(sector.sector)}
                    >
                      <span><small>{String(index + 1).padStart(2, "0")}</small><strong>{sector.sector}</strong></span>
                      <span><small>资金方向</small><strong className={signedClass(sector.netFlowProxy)}>{money(sector.netFlowProxy)}</strong></span>
                      <span><small>均涨跌</small><strong className={signedClass(sectorChange(sector))}>{signed(sectorChange(sector))}</strong></span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="marketHeatmapV3">
                {heatTiles.map((tile) => {
                  const { sector } = tile;
                  const leaders = (sector.leaders || []).slice(0, 3).map((leader) => leader.symbol).join(" / ");
                  return (
                    <button
                      type="button"
                      key={sector.sector}
                      className={`${sectorFlowTone(sector)} ${tile.sizeClass} ${tile.contentClass} ${tile.strengthClass} ${sector.sector === selected?.sector ? "selected" : ""}`}
                      style={tile.style}
                      aria-label={`${sector.sector} ${signed(sectorChange(sector))} ${money(sector.netFlowProxy)}`}
                      aria-describedby={heatTooltip?.sector === sector.sector ? "market-heat-tooltip" : undefined}
                      onMouseEnter={(event) => showHeatTooltip(event.currentTarget, sector)}
                      onMouseLeave={() => setHeatTooltip(null)}
                      onFocus={(event) => showHeatTooltip(event.currentTarget, sector)}
                      onBlur={() => setHeatTooltip(null)}
                      onClick={() => setSelectedSector(sector.sector)}
                    >
                      {tile.contentClass !== "heatBlank" ? <strong>{sector.sector}</strong> : null}
                      {tile.contentClass === "heatCompact" || tile.contentClass === "heatFull" ? <em>{signed(sectorChange(sector))}</em> : null}
                      {tile.contentClass === "heatFull" ? <span>{money(sector.netFlowProxy)}</span> : null}
                      {tile.contentClass === "heatFull" ? <small>{leaders}</small> : null}
                    </button>
                  );
                })}
                {!sectors.length ? (
                  <div className="marketStateV3">
                    {sectorState === "loading" ? <span>正在加载板块数据...</span> : sectorState === "error" ? <><span>板块数据加载失败</span><button type="button" onClick={() => setSectorReload((value) => value + 1)}>重新加载</button></> : <span>暂无板块数据</span>}
                  </div>
                ) : null}
              </div>
            )}
            {viewMode === "map" && heatTooltip ? (
              <div
                id="market-heat-tooltip"
                className="marketHeatTooltipV3"
                role="tooltip"
                style={{ left: heatTooltip.x, top: heatTooltip.y }}
              >
                <strong>{heatTooltip.sector}</strong>
                <span>均涨跌 <b className={heatTooltip.changeClass}>{heatTooltip.change}</b></span>
                <span>资金方向 <b className={heatTooltip.flowClass}>{heatTooltip.flow}</b></span>
              </div>
            ) : null}
          </div>
          <aside className="marketDetailV3">
            {selected ? (
              <>
                <header><strong>{selected.sector}</strong><span className={Number(selected.netFlowProxy || 0) >= 0 ? "positive" : "negative"}>{sectorFlowLabel(selected)}</span></header>
                <div className="marketFactsV3">
                  <article><span>资金方向</span><strong className={signedClass(selected.netFlowProxy)}>{money(selected.netFlowProxy)}</strong></article>
                  <article><span>均涨跌</span><strong className={signedClass(sectorChange(selected))}>{signed(sectorChange(selected))}</strong></article>
                  <article><span>上涨广度</span><strong>{`${selected.upCount || 0}涨 / ${selected.downCount || 0}跌`}</strong></article>
                  <article><span>成交活跃</span><strong>{selected.activeValueLabel || compactMoney(selected.activeValue)}</strong></article>
                </div>
                <h2>代表股票</h2>
                <div className="marketLeadersV3">
                  {(selected.leaders || []).slice(0, 4).map((leader) => (
                    <button key={leader.symbol} type="button" onClick={() => onPage("stocks")}>
                      <span><b>{leader.symbol}</b><small>{leader.name || "--"}</small></span>
                      <span><b>{compactMoney(moneyNumber(leader.liquidity))}</b><em className={signedClass(leader.changePct ?? leader.change)}>{signed(leader.changePct ?? leader.change)}</em></span>
                    </button>
                  ))}
                </div>
              </>
            ) : <div className="marketStateV3"><span>{sectorState === "loading" ? "正在加载..." : "暂无板块数据"}</span></div>}
          </aside>
        </div>
      </section>

      <section className="marketVolumeV3">
        <header><strong>成交异动</strong><span>按成交倍数排序</span></header>
        <table className="marketVolumeTableV3">
          <thead>
            <tr>
              <th>#</th>
              <th>股票</th>
              <th>板块</th>
              <th>涨跌</th>
              <th><VolumeRatioLabel /></th>
              <th>成交额</th>
              <th>市值</th>
            </tr>
          </thead>
          <tbody>
            {volumeRows.map((row, index) => (
              <tr key={row.symbol}>
                <td>{String(index + 1).padStart(2, "0")}</td>
                <td><strong>{row.symbol}</strong><span>{row.company || row.chineseName || "--"}</span></td>
                <td>{row.sector || "--"}</td>
                <td className={signedClass(row.change)}>{signed(row.change)}</td>
                <td>{ratioDisplay(row.volumeRatio)}</td>
                <td>{money(row.dollarVolume)}</td>
                <td>{marketCapDisplay(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="marketVolumeMobileV3">
          {volumeRows.map((row) => (
            <button type="button" key={row.symbol} onClick={() => onPage("stocks")}>
              <span><strong>{row.symbol}</strong><small>{row.sector || "--"} · {row.company || row.chineseName || "--"}</small></span>
              <span><strong className={signedClass(row.change)}>{signed(row.change)}</strong><small>涨跌</small></span>
              <span><strong>{ratioDisplay(row.volumeRatio)}</strong><small>成交倍数</small></span>
            </button>
          ))}
          {!volumeRows.length ? <div className="marketStateV3"><span>暂无成交异动</span></div> : null}
        </div>
      </section>
      </>
      ) : marketView === "crypto" ? <CryptoEtfFlowView /> : <RetailSentimentView />}
    </div>
  );
}

function AddToWatchlistButton({ symbol }: { symbol: string }) {
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setActive(false);
    setLoading(true);
    setError("");
    api.watchlist()
      .then((payload) => {
        if (!cancelled) setActive(payload.rows.some((item) => item.symbol === symbol));
      })
      .catch(() => {
        if (!cancelled) setError("自选状态加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [symbol, reload]);

  const add = async () => {
    setBusy(true);
    setError("");
    try {
      await api.addWatchlist(symbol, "股票详情");
      setActive(true);
    } catch {
      setError("添加失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="stockPreviewWatchlist">
      {error ? (
        <button type="button" className="requestRetry" onClick={() => setReload((value) => value + 1)}>重新加载</button>
      ) : (
        <button type="button" disabled={active || busy || loading} onClick={() => void add()}>{active ? "已在自选" : busy ? "添加中" : loading ? "读取中" : "加入自选"}</button>
      )}
      {error ? <em role="alert">{error}</em> : null}
    </span>
  );
}

function StocksPage({
  signalStates,
  onSelectSymbol
}: {
  signalStates: SignalState[];
  onSelectSymbol: (symbol: string) => void;
}) {
  const pageSize = 20;
  const [rows, setRows] = useState<SymbolRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [preset, setPreset] = useState("all");
  const [sector, setSector] = useState("all");
  const [cap, setCap] = useState("all");
  const [sort, setSort] = useState<StockSortKey>("dollarVolume");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [sectorOptions, setSectorOptions] = useState<Array<{ sector: string; count: number }>>([]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const latestSignals = useMemo(() => latestSignalStates(signalStates), [signalStates]);
  const signalMap = useMemo(() => new Map(latestSignals.map((item) => [item.symbol, item])), [latestSignals]);
  const stockSortHeader = (key: StockSortKey, label: string) => (
    <button
      type="button"
      className={`tableSortButton ${sort === key ? "active" : ""}`}
      onClick={() => {
        setPageIndex(0);
        setSort((current) => {
          if (current === key) setSortDir((dir) => dir === "asc" ? "desc" : "asc");
          else setSortDir(key === "symbol" ? "asc" : "desc");
          return key;
        });
      }}
    >
      {label}<span>{sort === key ? (sortDir === "asc" ? "↑" : "↓") : ""}</span>
    </button>
  );
  const changeStockSort = (key: StockSortKey) => {
    setSort(key);
    setSortDir(key === "symbol" ? "asc" : "desc");
  };
  const changeStockPreset = (value: string) => {
    setPreset(value);
    if (value === "mag7") changeStockSort("monthChange");
  };
  const resetStockFilters = () => {
    setQuery("");
    setPreset("all");
    setSector("all");
    setCap("all");
    setSort("dollarVolume");
    setSortDir("desc");
  };

  useEffect(() => {
    api.symbolMeta()
      .then((payload) => setSectorOptions(payload.sectors || []))
      .catch(() => setSectorOptions([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoadingRows(true);
      setError(false);
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(pageIndex * pageSize),
        sort,
        dir: sortDir
      });
      if (query.trim()) params.set("query", query.trim());
      if (preset !== "all") params.set("preset", preset);
      if (sector !== "all") params.set("sector", sector);
      if (cap !== "all") params.set("cap", cap);
      api.symbols(params)
        .then((payload) => {
          if (cancelled) return;
          setRows(payload.rows || []);
          setTotal(payload.total || 0);
        })
        .catch(() => {
          if (cancelled) return;
          setRows([]);
          setTotal(0);
          setError(true);
        })
        .finally(() => {
          if (!cancelled) setLoadingRows(false);
        });
    }, query.trim() ? 260 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cap, pageIndex, preset, query, retry, sector, sort, sortDir]);

  useEffect(() => {
    setPageIndex(0);
  }, [cap, preset, query, sector, sort, sortDir]);

  return (
    <div className="stocksPage">
      <section className="stockLibraryWorkbench" aria-busy={loadingRows}>
        <div className="stockLibraryPresetRow">
          <div className="stockLibraryTabs">
          {[
            ["all", "全部"],
            ["mag7", "科技七姐妹"],
            ["liquid", "高成交"],
            ["strength", "强趋势"],
            ["event", "有事件"],
            ["etf", "ETF"]
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={preset === value ? "active" : ""}
              onClick={() => changeStockPreset(value)}
            >
              {label}
            </button>
          ))}
          </div>
          <span>{loadingRows ? "加载中..." : `共 ${total} 只`}</span>
        </div>
        <div className="stockLibraryToolbar">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索股票代码或公司" />
          <select value={sector} onChange={(event) => setSector(event.target.value)}>
            <option value="all">全部板块</option>
            {sectorOptions.map((item) => <option key={item.sector} value={item.sector}>{item.sector}</option>)}
          </select>
          <select value={cap} onChange={(event) => setCap(event.target.value)}>
            <option value="all">全部市值</option>
            <option value="large">大市值</option>
            <option value="mid">中市值</option>
            <option value="small">小市值</option>
          </select>
          <select value={sort} onChange={(event) => changeStockSort(event.target.value as StockSortKey)}>
            <option value="dollarVolume">按成交额</option>
            <option value="marketCap">按市值</option>
            <option value="dayChange">按1天</option>
            <option value="weekChange">按1周</option>
            <option value="monthChange">按1月</option>
            <option value="ytdChange">按年初至今</option>
            <option value="symbol">按代码</option>
          </select>
          <button type="button" className="stockLibraryReset" onClick={resetStockFilters}>重置</button>
        </div>

        <article className="stockLibraryTablePanel">
          {error ? (
            <div className="marketToolError compact stockLibraryError" role="alert">
              <span>股票数据加载失败</span>
              <button type="button" className="requestRetry" onClick={() => setRetry((value) => value + 1)}>重新加载</button>
            </div>
          ) : null}
          <div className="stockLibraryDesktopTable">
            <table className="stockLibraryTable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{stockSortHeader("symbol", "股票")}</th>
                  <th>板块</th>
                  <th>现价</th>
                  <th>{stockSortHeader("dayChange", "近1天")}</th>
                  <th>{stockSortHeader("weekChange", "近1周")}</th>
                  <th>{stockSortHeader("monthChange", "近1月")}</th>
                  <th>{stockSortHeader("ytdChange", "年初至今")}</th>
                  <th>{stockSortHeader("dollarVolume", "成交")}</th>
                  <th>{stockSortHeader("marketCap", "市值")}</th>
                  <th>趋势</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const signal = signalMap.get(row.symbol);
                  const direction = trackingDirection({ signalDirection: signal?.direction, signalDirectionText: signal?.directionText });
                  const volumeRatio = ratioDisplay(row.volumeRatio);
                  return (
                    <tr key={row.symbol} onClick={() => onSelectSymbol(row.symbol)}>
                      <td>{pageIndex * pageSize + index + 1}</td>
                      <td><strong>{row.symbol}</strong><span>{stockCompany(row)}</span></td>
                      <td>{row.sector || "--"}</td>
                      <td>{priceDisplay(row.price)}</td>
                      <td className={signedClass(row.dayChange)}>{signed(row.dayChange)}</td>
                      <td className={signedClass(row.weekChange)}>{signed(row.weekChange)}</td>
                      <td className={signedClass(row.monthChange)}>{signed(row.monthChange)}</td>
                      <td className={signedClass(row.ytdChange)}>{signed(row.ytdChange)}</td>
                      <td>{compactMoney(row.dollarVolume)}{volumeRatio !== "--" ? <span>{volumeRatio}</span> : null}</td>
                      <td>{marketCapDisplay(row)}</td>
                      <td><SignalDirectionBadge label={direction} /></td>
                      <td><button type="button" className="stockLibraryView" onClick={(event) => { event.stopPropagation(); onSelectSymbol(row.symbol); }}>查看</button></td>
                    </tr>
                  );
                })}
                {loadingRows && !rows.length ? <tr><td className="stockLibraryEmpty" colSpan={12}>正在加载股票...</td></tr> : null}
                {!loadingRows && !error && !rows.length ? <tr><td className="stockLibraryEmpty" colSpan={12}>没有符合条件的股票</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="stockLibraryMobileList">
            {rows.map((row) => {
              const signal = signalMap.get(row.symbol);
              const direction = trackingDirection({ signalDirection: signal?.direction, signalDirectionText: signal?.directionText });
              return (
                <article className="stockLibraryMobileRow" key={row.symbol}>
                  <div className="stockLibraryMobileHead">
                    <div><strong>{row.symbol}</strong><span>{stockCompany(row)}</span></div>
                    <div><strong>{priceDisplay(row.price)}</strong><span>{row.sector || "--"} · {direction}</span></div>
                  </div>
                  <div className="stockLibraryMobileMetrics">
                    <div><span>近1天</span><strong className={signedClass(row.dayChange)}>{signed(row.dayChange)}</strong></div>
                    <div><span>近1周</span><strong className={signedClass(row.weekChange)}>{signed(row.weekChange)}</strong></div>
                    <div><span>近1月</span><strong className={signedClass(row.monthChange)}>{signed(row.monthChange)}</strong></div>
                  </div>
                  <div className="stockLibraryMobileFoot">
                    <span>成交额 {compactMoney(row.dollarVolume)} · 市值 {marketCapDisplay(row)}</span>
                    <button type="button" onClick={() => onSelectSymbol(row.symbol)}>查看详情</button>
                  </div>
                </article>
              );
            })}
            {loadingRows && !rows.length ? <div className="stockLibraryEmpty">正在加载股票...</div> : null}
            {!loadingRows && !error && !rows.length ? <div className="stockLibraryEmpty">没有符合条件的股票</div> : null}
          </div>
          <div className="pager">
            <button disabled={pageIndex <= 0 || loadingRows} onClick={() => setPageIndex((value) => Math.max(0, value - 1))}>上一页</button>
            <span>第 {pageIndex + 1} / {pageCount} 页</span>
            <button disabled={pageIndex >= pageCount - 1 || loadingRows} onClick={() => setPageIndex((value) => Math.min(pageCount - 1, value + 1))}>下一页</button>
          </div>
        </article>
      </section>
    </div>
  );
}

function CalendarPage({ initialEvents }: { initialEvents: CalendarEvent[] }) {
  const pageSize = 30;
  const [windowDays, setWindowDays] = useState("7");
  const [impact, setImpact] = useState("all");
  const [pageIndex, setPageIndex] = useState(0);
  const [showAllEarnings, setShowAllEarnings] = useState(false);
  const [macroRows, setMacroRows] = useState<CalendarEvent[]>(initialEvents.filter((event) => event.type === "macro"));
  const [earningsRows, setEarningsRows] = useState<CalendarEvent[]>(initialEvents.filter((event) => event.type === "earnings"));
  const [resultRows, setResultRows] = useState<CalendarEvent[]>([]);
  const [total, setTotal] = useState(initialEvents.filter((event) => event.type === "earnings").length);
  const [macroLoading, setMacroLoading] = useState(false);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [macroError, setMacroError] = useState(false);
  const [earningsError, setEarningsError] = useState(false);
  const [macroRetry, setMacroRetry] = useState(0);
  const [earningsRetry, setEarningsRetry] = useState(0);
  const [resultLoading, setResultLoading] = useState(true);
  const [resultError, setResultError] = useState(false);
  const [resultRetry, setResultRetry] = useState(0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const featuredEarnings = earningsRows.filter((event) => event.impact === "high").slice(0, 3);
  const showEarningsTable = showAllEarnings || impact !== "all";

  useEffect(() => {
    setPageIndex(0);
  }, [impact, windowDays]);

  useEffect(() => {
    let cancelled = false;
    setResultLoading(true);
    setResultError(false);
    api.calendar({ limit: 200, type: "macro", resultsOnly: true }).then((payload) => {
      if (!cancelled) setResultRows(payload.rows || []);
    }).catch(() => {
      if (!cancelled) setResultError(true);
    }).finally(() => {
      if (!cancelled) setResultLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [resultRetry]);

  useEffect(() => {
    let cancelled = false;
    setMacroLoading(true);
    setMacroError(false);
    api.calendar({
      limit: 50,
      windowDays,
      type: "macro"
    }).then((payload) => {
      if (!cancelled) setMacroRows(payload.rows || []);
    }).catch(() => {
      if (!cancelled) setMacroError(true);
    }).finally(() => {
      if (!cancelled) setMacroLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [macroRetry, windowDays]);

  useEffect(() => {
    let cancelled = false;
    setEarningsLoading(true);
    setEarningsError(false);
    api.calendar({
      limit: pageSize,
      offset: pageIndex * pageSize,
      windowDays,
      impact,
      type: "earnings"
    }).then((payload) => {
      if (cancelled) return;
      setEarningsRows(payload.rows || []);
      setTotal(payload.total || 0);
    }).catch(() => {
      if (!cancelled) setEarningsError(true);
    }).finally(() => {
      if (!cancelled) setEarningsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [earningsRetry, impact, pageIndex, windowDays]);

  const otherMacroRows = macroRows.filter((event) => !coreMacroKind(event) && (impact === "all" || event.impact === impact));

  return (
    <div className="calendarPage calendarV3">
      <section className="calendarWorkbench">
        <CoreMacroTracker
          upcomingRows={macroRows}
          resultRows={resultRows}
          windowDays={windowDays}
          impact={impact}
          loading={macroLoading || resultLoading}
          error={macroError || resultError}
          onWindowDaysChange={setWindowDays}
          onImpactChange={setImpact}
          onRetry={() => {
            setMacroRetry((value) => value + 1);
            setResultRetry((value) => value + 1);
          }}
        />
        {macroLoading || macroError || otherMacroRows.length ? (
          <section className="calendarSection calendarOtherMacroSection">
            <div className="calendarSectionHead">
              <h2>其它宏观</h2>
            </div>
            <CalendarEventsTable
              kind="macro"
              rows={otherMacroRows}
              loading={macroLoading}
              error={macroError}
              onRetry={() => setMacroRetry((value) => value + 1)}
            />
          </section>
        ) : null}
        <section className="calendarSection calendarEarningsSection">
          <div className="calendarSectionHead">
            <h2>{showEarningsTable ? "财报日历" : "近期高影响财报"}</h2>
            {impact === "all" ? (
              <button type="button" className="calendarSectionAction" onClick={() => setShowAllEarnings((value) => !value)}>
                {showAllEarnings ? "收起" : "查看全部"}
              </button>
            ) : null}
          </div>
          {showEarningsTable ? (
            <>
              <CalendarEventsTable
                kind="earnings"
                rows={earningsRows}
                loading={earningsLoading}
                error={earningsError}
                onRetry={() => setEarningsRetry((value) => value + 1)}
              />
              <div className="calendarPager">
                <span>第 {pageIndex + 1} 页</span>
                <div>
                  <button type="button" disabled={pageIndex <= 0 || earningsLoading} onClick={() => setPageIndex((page) => Math.max(0, page - 1))}>上一页</button>
                  <button type="button" disabled={pageIndex >= pageCount - 1 || earningsLoading} onClick={() => setPageIndex((page) => Math.min(pageCount - 1, page + 1))}>下一页</button>
                </div>
              </div>
            </>
          ) : earningsLoading && !featuredEarnings.length ? (
            <div className="calendarState calendarStateLoading" aria-label="正在加载" />
          ) : earningsError && !featuredEarnings.length ? (
            <div className="calendarState">
              <span>加载失败</span>
              <button type="button" onClick={() => setEarningsRetry((value) => value + 1)}>重新加载</button>
            </div>
          ) : featuredEarnings.length ? (
            <div className={`calendarEarningsPreview ${earningsLoading ? "isLoading" : ""}`}>
              {featuredEarnings.map((event) => {
                const summary = calendarSummaryParts(event).lead;
                const [company, detail] = summary.split("：", 2);
                return (
                  <article key={event.id}>
                    <strong>{calendarTitle(event.title).replace(/\s*财报$/, "")}</strong>
                    <div><b>{company || calendarTitle(event.title)}</b><small>{detail || calendarDataText(event)}</small></div>
                    <time>{formatDate(event.date).slice(5)} {calendarTime24(event.time).slice(0, 5)}</time>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="calendarState">这段时间暂无高影响财报</div>
          )}
        </section>
      </section>
    </div>
  );
}

function CoreMacroTracker({
  upcomingRows,
  resultRows,
  windowDays,
  impact,
  loading,
  error,
  onWindowDaysChange,
  onImpactChange,
  onRetry
}: {
  upcomingRows: CalendarEvent[];
  resultRows: CalendarEvent[];
  windowDays: string;
  impact: string;
  loading: boolean;
  error: boolean;
  onWindowDaysChange: (value: string) => void;
  onImpactChange: (value: string) => void;
  onRetry: () => void;
}) {
  const coreResults = resultRows.filter((event) => coreMacroKind(event));
  const publishedIds = new Set(coreResults.map((event) => event.id));
  const coreUpcoming = upcomingRows.filter((event) => coreMacroKind(event) && !publishedIds.has(event.id) && (impact === "all" || event.impact === impact));
  const nextCore = coreUpcoming[0] || null;
  const [selectedKind, setSelectedKind] = useState<CoreMacroKind | null>(null);
  const activeKind = selectedKind || coreMacroKind(nextCore) || coreMacroKind(coreResults[0]) || "cpi";
  const selectedUpcoming = coreUpcoming.filter((event) => coreMacroKind(event) === activeKind);
  const selectedResults = coreResults.filter((event) => coreMacroKind(event) === activeKind);
  const nextSelected = selectedUpcoming[0] || null;
  const latestResult = selectedResults[0] || null;
  const latestConclusion = latestResult?.resultHeadline && latestResult?.resultMeaning ? latestResult : null;
  const timeline = [...selectedUpcoming, ...selectedResults]
    .filter((event, index, rows) => rows.findIndex((candidate) => candidate.id === event.id) === index)
    .slice(0, 8);

  return (
    <section className="calendarCoreMacro">
      <div className="calendarCoreToolbar">
        <div className="calendarFilterControls">
          <div className="calendarWindowTabs">
            {[
              ["7", "未来7天"],
              ["30", "未来30天"],
              ["45", "未来45天"]
            ].map(([value, label]) => (
              <button key={value} type="button" className={windowDays === value ? "active" : ""} onClick={() => onWindowDaysChange(value)}>
                {label}
              </button>
            ))}
          </div>
          <select value={impact} aria-label="影响级别" onChange={(event) => onImpactChange(event.target.value)}>
            <option value="all">全部影响</option>
            <option value="high">高影响</option>
            <option value="medium">中影响</option>
            <option value="low">低影响</option>
          </select>
        </div>
      </div>
      <div className="calendarNextEvent">
        <div>
          <span>下一项重点</span>
          <strong>{nextCore ? macroDateTime(nextCore, true) : "近期暂无"}</strong>
        </div>
        <div>
          <strong>{nextCore ? calendarTitle(nextCore.title) : "暂无核心宏观事件"}</strong>
          <span>{nextCore ? "等待公布" : ""}</span>
        </div>
        <div>
          <span>市场预期</span>
          <strong>{nextCore ? macroResultValue(nextCore, nextCore.forecastLabel, nextCore.forecastValue) || "--" : "--"}</strong>
        </div>
        <div>
          <span>前值</span>
          <strong>{nextCore ? macroResultValue(nextCore, nextCore.previousLabel, nextCore.previousValue) || "--" : "--"}</strong>
        </div>
        {nextCore ? <em className={impactClass(nextCore.impact)}>{impactLabel(nextCore.impact)}影响</em> : null}
      </div>
      <div className="calendarMacroTabs" role="tablist" aria-label="核心宏观指标">
        {coreMacroTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeKind === tab.key}
            className={activeKind === tab.key ? "active" : ""}
            onClick={() => setSelectedKind(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        <span>最近结果与历史变化</span>
      </div>
      {error ? (
        <div className="calendarInlineError">
          <span>核心宏观数据加载失败</span>
          <button type="button" onClick={onRetry}>重新加载</button>
        </div>
      ) : null}
      {loading && timeline.length === 0 ? <div className="calendarState calendarStateLoading" aria-label="正在加载" /> : null}
      {!loading && !error && timeline.length === 0 ? <div className="calendarState">暂无可展示数据</div> : null}
      {timeline.length ? (
        <>
          <div className="calendarMacroSummary">
            <div><span>下一次公布</span><strong className={nextSelected ? "pending" : ""}>{nextSelected ? macroDateTime(nextSelected) : "--"}</strong></div>
            <div><span>最近结果</span><strong>{latestResult ? macroResultValue(latestResult, latestResult.actualLabel, latestResult.actualValue) || "--" : "--"}</strong></div>
            <div><span>较前次</span><strong>{macroChangeText(latestResult, activeKind)}</strong></div>
          </div>
          {latestConclusion ? (
            <div className={`calendarMacroConclusion ${latestConclusion.resultTone || "neutral"}`}>
              <span>最近结论</span>
              <strong>{latestConclusion.resultHeadline}</strong>
              <p>{latestConclusion.resultMeaning}</p>
            </div>
          ) : null}
          <div className="calendarMacroTimelineHead">
            <span>公布时间</span><span>实际值</span><span>市场预期</span><span>前值</span><span>变化</span>
          </div>
          <div className={`calendarMacroTimeline ${loading ? "isLoading" : ""}`}>
            {timeline.map((event) => {
              const actual = publishedIds.has(event.id) ? macroResultValue(event, event.actualLabel, event.actualValue) : "";
              return (
                <article key={event.id} className={!actual ? "isFuture" : ""}>
                  <span data-label="公布时间">{macroDateTime(event)}</span>
                  <strong data-label="实际值" className={!actual ? "pending" : ""}>{actual || "待公布"}</strong>
                  <span data-label="市场预期">{macroResultValue(event, event.forecastLabel, event.forecastValue) || "--"}</span>
                  <span data-label="前值">{macroResultValue(event, event.previousLabel, event.previousValue) || "--"}</span>
                  <span data-label="变化"><em>{actual ? macroChangeText(event, activeKind) : "等待公布"}</em></span>
                </article>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}

function CalendarEventsTable({
  kind,
  rows,
  loading,
  error,
  onRetry
}: {
  kind: "macro" | "earnings";
  rows: CalendarEvent[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  if (!rows.length) {
    if (loading) return <div className="calendarState calendarStateLoading" aria-label="正在加载" />;
    if (error) {
      return (
        <div className="calendarState">
          <span>加载失败</span>
          <button type="button" onClick={onRetry}>重新加载</button>
        </div>
      );
    }
    return <div className="calendarState">{kind === "macro" ? "这段时间暂无重点宏观事件" : "这段时间暂无财报安排"}</div>;
  }

  return (
    <section className={`calendarTablePanel ${kind === "macro" ? "calendarMacroTable" : "calendarEarningsTable"}`}>
      {error ? (
        <div className="calendarInlineError">
          <span>更新失败，当前显示上次结果</span>
          <button type="button" onClick={onRetry}>重新加载</button>
        </div>
      ) : null}
      <div className="calendarTableHead">
        <span>时间</span>
        <span>事件</span>
        <span>类型</span>
        <span>公司/财期</span>
        <span>数据</span>
        <span>影响</span>
      </div>
      <div className={`calendarTableBody ${loading ? "isLoading" : ""}`}>
        {rows.map((event, index) => {
          const dataText = calendarDataText(event) || calendarSummaryText(event);
          const subtext = calendarEventSubtext(event);
          const mobileMeta = [
            eventTypeLabel(event.type),
            subtext,
            dataText && dataText !== subtext && !subtext.includes(dataText) ? dataText : ""
          ].filter(Boolean).join(" · ");
          const showDate = formatDate(event.date) !== formatDate(rows[index - 1]?.date);
          const dateCount = rows.filter((row) => formatDate(row.date) === formatDate(event.date)).length;
          const rowClassName = [
            event.impact === "high" ? "highImpact" : "",
            event.type === "macro" ? "macroEvent" : ""
          ].filter(Boolean).join(" ");
          return (
            <Fragment key={event.id}>
              {showDate ? (
                <div className="calendarDateDivider">
                  <strong>{formatDate(event.date).slice(5)}　{weekdayLabel(event.date)}</strong>
                  <span>{dateCount} 项</span>
                </div>
              ) : null}
              <article className={rowClassName} key={event.id}>
                <span className="calendarTimeCell">{calendarTime24(event.time)}</span>
                <div className="calendarEventCell">
                  <strong>{calendarTitle(event.title)}</strong>
                  {mobileMeta ? <small className="calendarMobileMeta">{mobileMeta}</small> : null}
                </div>
                <span className={`calendarType ${event.type === "macro" ? "macro" : ""}`}>{eventTypeLabel(event.type)}</span>
                <div className="calendarEventCell">
                  {subtext ? <small>{subtext}</small> : null}
                </div>
                <span className="calendarTextCell calendarDataCell">{dataText || ""}</span>
                <span className={impactClass(event.impact)}>{impactLabel(event.impact)}</span>
              </article>
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}

type PositionHistoryItem = {
  id: string;
  symbol: string;
  direction: PositionDirection;
  accountSize: number;
  riskPercent: number;
  shares: number;
  entryPrice: number;
  stopPrice: number;
  actualRisk: number;
  positionAmount: number;
  createdAt: string;
};

const positionHistoryKey = "dongbimao_position_sizing_history_v2";
const positionAccountKey = "dongbimao_position_sizing_account";
const positionRiskKey = "dongbimao_position_sizing_risk";

const legacyWatchlistStorageKey = "meigu_strategy_watchlist_v1";
const watchlistImportDismissedKey = "watchlist_import_dismissed_v1";

function watchlistIsDue(item: WatchlistItem) {
  if (!item.nextReviewAt) return false;
  const timestamp = new Date(item.nextReviewAt).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function watchlistTrend(row?: SymbolRow) {
  const month = Number(row?.monthChange);
  const week = Number(row?.weekChange);
  if (Number.isFinite(month) && month >= 5 && (!Number.isFinite(week) || week >= 0)) return { label: "偏强", className: "positive" };
  if (Number.isFinite(month) && month <= -5) return { label: "转弱", className: "negative" };
  return { label: "无明确信号", className: "neutral" };
}

function WatchlistPage({ enabled, onOpenStock }: { enabled: boolean; onOpenStock: (symbol: string, source?: StockSource) => void }) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [profiles, setProfiles] = useState<Record<string, SymbolRow>>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [newSymbol, setNewSymbol] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState("");
  const [removeSymbol, setRemoveSymbol] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [legacyItems, setLegacyItems] = useState<Array<Record<string, unknown>>>([]);

  const refresh = useCallback(async () => {
    const payload = await api.watchlist();
    setItems(payload.rows);
    if (!payload.rows.length) {
      setProfiles({});
      return;
    }
    const params = new URLSearchParams({
      preset: "watchlist",
      watchlist: payload.rows.map((item) => item.symbol).join(","),
      limit: "200",
      sort: "dollarVolume",
      dir: "desc"
    });
    const symbols = await api.symbols(params);
    setProfiles(Object.fromEntries(symbols.rows.map((row) => [row.symbol, row])));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setLoadFailed(false);
    return refresh()
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, [refresh]);

  const refreshAfterSave = async (successText: string) => {
    setMessage({ tone: "ok", text: successText });
    try {
      await refresh();
    } catch {
      setLoadFailed(true);
    }
  };

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void load();
    if (localStorage.getItem(watchlistImportDismissedKey)) return;
    try {
      const parsed = JSON.parse(localStorage.getItem(legacyWatchlistStorageKey) || "[]");
      if (Array.isArray(parsed)) {
        setLegacyItems(parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && "symbol" in item)));
      }
    } catch {
      localStorage.removeItem(legacyWatchlistStorageKey);
    }
  }, [enabled, load]);

  const stats = useMemo(() => ({
    due: items.filter(watchlistIsDue).length,
    following: items.filter((item) => item.reviewAction === "continue").length,
    lower: items.filter((item) => item.reviewAction === "lower").length
  }), [items]);

  const rows = useMemo(() => items.filter((item) => {
    const profile = profiles[item.symbol];
    const needle = query.trim().toLowerCase();
    if (needle && ![item.symbol, profile?.company, profile?.chineseName].some((value) => String(value || "").toLowerCase().includes(needle))) return false;
    if (filter === "due") return watchlistIsDue(item);
    if (filter === "continue") return item.reviewAction === "continue";
    if (filter === "lower") return item.reviewAction === "lower";
    return true;
  }), [filter, items, profiles, query]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const symbol = newSymbol.trim().toUpperCase();
    if (!symbol) return;
    setBusy(symbol);
    setMessage(null);
    try {
      await api.addWatchlist(symbol);
      setNewSymbol("");
      setAdding(false);
      await refreshAfterSave(`${symbol} 已加入自选`);
    } catch {
      setMessage({ tone: "error", text: "添加失败，请重试" });
    } finally {
      setBusy("");
    }
  };

  const review = async (symbol: string, action: "reviewed" | "continue" | "lower") => {
    setBusy(symbol);
    setMessage(null);
    try {
      await api.reviewWatchlist(symbol, action);
      await refreshAfterSave(`${symbol} 复盘状态已更新`);
    } catch {
      setMessage({ tone: "error", text: "更新失败，请重试" });
    } finally {
      setBusy("");
    }
  };

  const remove = async (symbol: string) => {
    setBusy(symbol);
    setMessage(null);
    try {
      await api.removeWatchlist(symbol);
      setRemoveSymbol("");
      await refreshAfterSave(`${symbol} 已移除`);
    } catch {
      setMessage({ tone: "error", text: "移除失败，请重试" });
    } finally {
      setBusy("");
    }
  };

  const importLegacy = async () => {
    setBusy("import");
    setMessage(null);
    try {
      const payload = legacyItems.map((item) => ({ ...item, source: String(item.source || "旧版导入") }));
      const result = await api.importWatchlist(payload);
      localStorage.setItem(watchlistImportDismissedKey, "1");
      setLegacyItems([]);
      await refreshAfterSave(`已导入 ${result.saved} 只旧版自选${result.skipped ? `，${result.skipped} 只代码已失效` : ""}`);
    } catch {
      setMessage({ tone: "error", text: "导入失败，请重试" });
    } finally {
      setBusy("");
    }
  };

  const dismissImport = () => {
    localStorage.setItem(watchlistImportDismissedKey, "1");
    setLegacyItems([]);
  };

  if (loading) {
    return <section className="watchlistPage compactProductPage"><div className="marketToolLoading compact">加载中</div></section>;
  }
  if (loadFailed) {
    return (
      <section className="watchlistPage compactProductPage">
        <div className="marketToolError compact watchlistDataError" role="alert">
          <span>{message?.tone === "ok" ? `${message.text}，请重新加载列表` : "自选数据加载失败"}</span>
          <button type="button" className="requestRetry" onClick={() => void load()}>重新加载</button>
        </div>
      </section>
    );
  }

  return (
    <section className="watchlistPage compactProductPage">
      <div className="watchlistToolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索股票代码或公司" aria-label="搜索自选" />
        <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="筛选自选状态">
          <option value="all">全部状态</option>
          <option value="due">待复盘</option>
          <option value="continue">继续跟踪</option>
          <option value="lower">降低关注</option>
        </select>
        <button type="button" className="primaryButton" onClick={() => setAdding((value) => !value)}>添加股票</button>
      </div>

      {adding ? (
        <form className="watchlistAddForm" onSubmit={add}>
          <input autoFocus value={newSymbol} onChange={(event) => setNewSymbol(event.target.value.toUpperCase())} placeholder="输入股票代码，如 NVDA" />
          <button type="submit" className="primaryButton" disabled={!newSymbol.trim() || Boolean(busy)}>确认添加</button>
          <button type="button" onClick={() => setAdding(false)}>取消</button>
        </form>
      ) : null}

      {legacyItems.length ? (
        <div className="watchlistImport" role="status">
          <span>发现本机有 {legacyItems.length} 只旧版自选，导入后会同步到当前账号。</span>
          <div><button type="button" className="primaryButton" disabled={busy === "import"} onClick={() => void importLegacy()}>导入账号</button><button type="button" onClick={dismissImport}>暂不导入</button></div>
        </div>
      ) : null}

      {message ? <div className={`watchlistMessage ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</div> : null}

      <div className="watchlistStats" aria-label="自选概况">
        <article><span>全部自选</span><strong>{items.length}</strong><small>已同步账号</small></article>
        <article><span>待复盘</span><strong>{stats.due}</strong><small>需要重新检查</small></article>
        <article><span>继续跟踪</span><strong>{stats.following}</strong><small>保持观察</small></article>
        <article><span>降低关注</span><strong>{stats.lower}</strong><small>等待新变化</small></article>
      </div>

      <div className="watchlistTablePanel">
        <div className="watchlistTableHeader"><strong>复盘队列</strong><span>按复盘日期排序</span></div>
        {rows.length ? (
          <div className="tableScroll">
            <table className="productTable watchlistTable">
              <thead><tr><th>#</th><th>股票</th><th>当前状态</th><th>趋势</th><th>主要线索</th><th>下次复盘</th><th>操作</th></tr></thead>
              <tbody>
                {rows.map((item, index) => {
                  const profile = profiles[item.symbol];
                  const trend = watchlistTrend(profile);
                  const due = watchlistIsDue(item);
                  const status = due ? "待复盘" : item.reviewAction === "lower" ? "降低关注" : item.reviewAction === "continue" ? "继续跟踪" : item.reviewAction === "reviewed" ? "已复盘" : "待设置";
                  const clue = profile?.eventLabel || profile?.strengthLabel || item.source;
                  return (
                    <tr key={item.symbol}>
                      <td>{String(index + 1).padStart(2, "0")}</td>
                      <td><button type="button" className="stockLink" onClick={() => onOpenStock(item.symbol, "watchlist")}><strong>{item.symbol}</strong><span>{profile?.chineseName || profile?.company || "--"}</span></button></td>
                      <td><span className={`watchlistStatus ${due ? "due" : item.reviewAction || "unset"}`}>{status}</span></td>
                      <td><span className={trend.className}>{trend.label}</span></td>
                      <td>{clue || "--"}</td>
                      <td>{formatDate(item.nextReviewAt)}</td>
                      <td>
                        <div className="watchlistActions">
                          <button type="button" disabled={busy === item.symbol} onClick={() => void review(item.symbol, "reviewed")}>已复盘</button>
                          <button type="button" disabled={busy === item.symbol} onClick={() => void review(item.symbol, "continue")}>继续</button>
                          <button type="button" className="iconButton" aria-label={`移除 ${item.symbol}`} disabled={busy === item.symbol} onClick={() => setRemoveSymbol(item.symbol)}>×</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="watchlistEmpty"><strong>{items.length ? "没有符合条件的股票" : "还没有自选"}</strong><span>{items.length ? "调整搜索或筛选条件" : "添加股票后会同步到当前账号"}</span></div>}
      </div>
      {removeSymbol ? (
        <div className="watchlistConfirmOverlay" role="dialog" aria-modal="true" aria-labelledby="watchlistRemoveTitle" onMouseDown={() => setRemoveSymbol("")}>
          <section onMouseDown={(event) => event.stopPropagation()}>
            <strong id="watchlistRemoveTitle">移出自选</strong>
            <p>确定移出 {removeSymbol}？该股票的复盘记录也会删除。</p>
            <div><button type="button" onClick={() => setRemoveSymbol("")}>取消</button><button type="button" className="dangerButton" disabled={busy === removeSymbol} onClick={() => void remove(removeSymbol)}>确认移出</button></div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function PositionSizingPage() {
  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<PositionDirection>("long");
  const [accountSize, setAccountSize] = useState(() => window.localStorage.getItem(positionAccountKey) || "100,000");
  const [riskPercent, setRiskPercent] = useState(() => window.localStorage.getItem(positionRiskKey) || "1");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [latestPrice, setLatestPrice] = useState<number | null>(null);
  const [priceStatus, setPriceStatus] = useState("");
  const [formError, setFormError] = useState("");
  const [copyStatus, setCopyStatus] = useState("复制");
  const [saveStatus, setSaveStatus] = useState("保存计划");
  const [history, setHistory] = useState<PositionHistoryItem[]>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(positionHistoryKey) || "[]").slice(0, 5);
    } catch {
      return [];
    }
  });
  const normalizedSymbol = symbol.trim().toUpperCase();
  const accountNumber = inputMoneyNumber(accountSize);
  const riskPercentNumber = inputMoneyNumber(riskPercent);
  const riskAmount = accountNumber * riskPercentNumber / 100;
  const hasCoreInput = accountSize.trim() && riskPercent.trim() && entryPrice.trim() && stopPrice.trim();
  const calculation = useMemo<{ result: PositionSizingResult | null; error: string }>(() => {
    if (!hasCoreInput) return { result: null, error: "" };
    try {
      return {
        result: calculatePositionSizing({
          direction,
          accountSize: accountNumber,
          riskAmount,
          entryPrice: inputMoneyNumber(entryPrice),
          stopPrice: inputMoneyNumber(stopPrice)
        }),
        error: ""
      };
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : "请检查输入。" };
    }
  }, [accountNumber, direction, entryPrice, hasCoreInput, riskAmount, stopPrice]);
  const result = calculation.result;

  useEffect(() => {
    setCopyStatus("复制");
    setSaveStatus("保存计划");
  }, [accountSize, direction, entryPrice, normalizedSymbol, riskPercent, stopPrice]);

  useEffect(() => {
    if (accountNumber > 0) window.localStorage.setItem(positionAccountKey, accountSize);
    if (riskPercentNumber > 0) window.localStorage.setItem(positionRiskKey, riskPercent);
  }, [accountNumber, accountSize, riskPercent, riskPercentNumber]);

  useEffect(() => {
    if (!normalizedSymbol) {
      setLatestPrice(null);
      setPriceStatus("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLatestPrice(null);
      setPriceStatus("读取中");
      api.symbolDetail(normalizedSymbol)
        .then((payload) => {
          if (cancelled) return;
          const price = moneyNumber(payload.profile?.price);
          if (price > 0) {
            setLatestPrice(price);
            setPriceStatus(`最新价 ${exactMoney(price)}`);
          } else {
            setPriceStatus("未找到最新价");
          }
        })
        .catch(() => {
          if (!cancelled) setPriceStatus("行情暂时不可用");
        });
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [normalizedSymbol]);

  function applyRiskPreset(percent: number) {
    setFormError("");
    setRiskPercent(String(percent));
  }

  function saveCalculation(event?: FormEvent) {
    event?.preventDefault();
    if (!result) {
      setFormError(calculation.error || "请先填写买入价和止损价。");
      return;
    }
    const item: PositionHistoryItem = {
      id: String(Date.now()),
      symbol: normalizedSymbol || "--",
      direction,
      accountSize: accountNumber,
      riskPercent: riskPercentNumber,
      shares: result.shares,
      entryPrice: inputMoneyNumber(entryPrice),
      stopPrice: inputMoneyNumber(stopPrice),
      actualRisk: result.actualRisk,
      positionAmount: result.positionAmount,
      createdAt: formatDateTime(new Date().toISOString())
    };
    const next = [item, ...history].slice(0, 5);
    setHistory(next);
    window.localStorage.setItem(positionHistoryKey, JSON.stringify(next));
    setFormError("");
    setSaveStatus("已保存");
  }

  function updateHistory(next: PositionHistoryItem[]) {
    setHistory(next);
    window.localStorage.setItem(positionHistoryKey, JSON.stringify(next));
  }

  function restoreCalculation(item: PositionHistoryItem) {
    setSymbol(item.symbol === "--" ? "" : item.symbol);
    setDirection(item.direction);
    setAccountSize(item.accountSize.toLocaleString("en-US", { maximumFractionDigits: 2 }));
    setRiskPercent(String(item.riskPercent));
    setEntryPrice(String(item.entryPrice));
    setStopPrice(String(item.stopPrice));
    setFormError("");
  }

  function copyPlan() {
    if (!result) return;
    const plan = `${normalizedSymbol || "交易计划"} ${direction === "long" ? "做多" : "做空"} · 入场 ${exactMoney(inputMoneyNumber(entryPrice))} · 止损 ${exactMoney(inputMoneyNumber(stopPrice))} · ${result.shares.toLocaleString("en-US")} 股 · 最大亏损 ${exactMoney(result.actualRisk)}`;
    if (!navigator.clipboard) {
      setCopyStatus("复制失败");
      return;
    }
    void navigator.clipboard.writeText(plan)
      .then(() => setCopyStatus("已复制"))
      .catch(() => setCopyStatus("复制失败"));
  }

  function clearTrade() {
    setSymbol("");
    setDirection("long");
    setEntryPrice("");
    setStopPrice("");
    setLatestPrice(null);
    setPriceStatus("");
    setFormError("");
    setCopyStatus("复制");
  }

  return (
    <div className="positionSizingPage" data-testid="position-sizing-page">
      <header className="positionSizingHead">
        <div>
          <h1>以损定仓</h1>
          <p>先定能亏多少，再算该买多少。</p>
        </div>
        <span>美股 · 整股 · 默认无杠杆</span>
      </header>

      <section className="positionSizingGrid">
        <form className="positionSizingPanel positionSizingForm" onSubmit={saveCalculation}>
          <div className="panelHead">
            <strong>交易计划</strong>
            <span>结果自动计算</span>
          </div>
          <div className="positionFormBody">
            <div className="positionFieldGrid">
              <label>
                <span>股票代码 <em>可选</em></span>
                <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="例如 NVDA" />
                <small>
                  {priceStatus}
                  {latestPrice ? <button type="button" onClick={() => setEntryPrice(String(latestPrice))}>设为入场价</button> : null}
                </small>
              </label>
              <label>
                <span>交易方向</span>
                <span className="positionSegment">
                  <button type="button" className={`long ${direction === "long" ? "active" : ""}`} onClick={() => setDirection("long")}>做多</button>
                  <button type="button" className={`short ${direction === "short" ? "active" : ""}`} onClick={() => setDirection("short")}>做空</button>
                </span>
              </label>
            </div>

            <div className="positionFieldGrid">
              <label>
                <span>账户资金</span>
                <span className="positionInput"><i>$</i><input data-testid="position-account" inputMode="decimal" value={accountSize} onChange={(event) => setAccountSize(event.target.value)} placeholder="例如 100,000" /></span>
              </label>
              <label>
                <span>单笔风险</span>
                <span className="positionRiskInput">
                  <span className="positionInput"><input data-testid="position-risk" inputMode="decimal" value={riskPercent} onChange={(event) => setRiskPercent(event.target.value)} placeholder="1" /><i>%</i></span>
                  <span className="positionPresetRow">
                    {[0.5, 1, 2].map((percent) => (
                      <button type="button" className={riskPercentNumber === percent ? "active" : ""} key={percent} onClick={() => applyRiskPreset(percent)}>{percent}%</button>
                    ))}
                  </span>
                </span>
              </label>
            </div>
            <p className="positionDerivedRisk">本次最多亏损 <strong>{accountNumber > 0 && riskPercentNumber > 0 ? exactMoney(riskAmount) : "--"}</strong></p>

            <div className="positionFieldGrid">
              <label>
                <span>{direction === "long" ? "计划买入价" : "计划卖出价"}</span>
                <span className="positionInput"><i>$</i><input data-testid="position-entry" inputMode="decimal" value={entryPrice} onChange={(event) => setEntryPrice(event.target.value)} placeholder="例如 100.00" /></span>
              </label>
              <label>
                <span>止损价</span>
                <span className="positionInput"><i>$</i><input data-testid="position-stop" inputMode="decimal" value={stopPrice} onChange={(event) => setStopPrice(event.target.value)} placeholder={direction === "long" ? "低于买入价" : "高于卖出价"} /></span>
              </label>
            </div>

            {calculation.error || formError ? <p className="positionError">{formError || calculation.error}</p> : null}
            <div className="positionFormFoot">
              <span>止损应设在交易逻辑失效的位置，再由系统反推仓位。</span>
              <button type="button" onClick={clearTrade}>清空</button>
            </div>
          </div>
        </form>

        <aside className="positionSizingPanel positionResultPanel">
          <div className="panelHead">
            <strong>结果</strong>
            <span>{direction === "long" ? "做多" : "做空"}</span>
          </div>
          <div className="positionResultHero">
            <span>{direction === "long" ? "建议买入" : "建议卖出"}</span>
            <strong data-testid="position-result-shares">{result ? result.shares.toLocaleString("en-US") : "--"} <i>股</i></strong>
            <em>{result ? <>预计占用资金 <b>{exactMoney(result.positionAmount)}</b></> : "填入账户、风险和价格后自动计算"}</em>
          </div>
          {result && (result.cashLimited || riskPercentNumber > 2 || result.stopDistancePct < 0.5) ? (
            <div className="positionWarnings" data-testid="position-warnings">
              {result.cashLimited ? <p>风险公式得出 {result.riskBasedShares.toLocaleString("en-US")} 股，已按账户资金下调。</p> : null}
              {riskPercentNumber > 2 ? <p>单笔风险超过账户资金的 2%，请确认风险预算。</p> : null}
              {result.stopDistancePct < 0.5 ? <p>止损距离较小，请确认止损位置不是误填。</p> : null}
            </div>
          ) : null}
          <div className="positionMetricList">
            <div><span>仓位占比</span><strong>{exactPercent(result?.positionPct)}</strong></div>
            <div><span>止损最大亏损</span><strong className="negative">{result ? `-${exactMoney(result.actualRisk)}` : "--"}</strong></div>
            <div><span>实际账户风险</span><strong>{exactPercent(result?.riskPct)}</strong></div>
            <div><span>每股风险 / 止损距离</span><strong>{result ? `${exactMoney(result.perShareRisk)} / ${exactPercent(result.stopDistancePct)}` : "--"}</strong></div>
            <div><span>1R / 2R 参考价</span><strong className="positive">{result ? `${exactMoney(result.oneRPrice)} / ${exactMoney(result.twoRPrice)}` : "--"}</strong></div>
          </div>
          <p className="positionPlanSummary">
            {result ? `${normalizedSymbol || "交易计划"} ${direction === "long" ? "做多" : "做空"} · 入场 ${exactMoney(inputMoneyNumber(entryPrice))} · 止损 ${exactMoney(inputMoneyNumber(stopPrice))} · ${result.shares.toLocaleString("en-US")} 股 · 最大亏损 ${exactMoney(result.actualRisk)}` : "--"}
          </p>
          <div className="positionResultActions">
            <button className="positionPrimaryButton" data-testid="position-save" type="button" disabled={!result} onClick={() => saveCalculation()}>{saveStatus}</button>
            <button type="button" disabled={!result} onClick={copyPlan}>{copyStatus}</button>
          </div>
          <p className="positionDisclaimer">按止损价成交测算；跳空、滑点和费用可能使实际亏损高于计划值。做空未计算券商保证金和借券限制。</p>
        </aside>
      </section>

      <section className="positionSizingPanel positionHistoryPanel">
        <div className="panelHead">
          <strong>最近计算</strong>
          {history.length ? <button type="button" onClick={() => updateHistory([])}>全部清空</button> : <span />}
        </div>
        <div className="positionHistoryTable">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>标的</th>
                <th>方向</th>
                <th>股数</th>
                <th>价格</th>
                <th>风险</th>
                <th>仓位</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id}>
                  <td>{item.createdAt}</td>
                  <td><button className="positionHistorySymbol" type="button" onClick={() => restoreCalculation(item)}>{item.symbol}</button></td>
                  <td>{item.direction === "long" ? "做多" : "做空"}</td>
                  <td>{item.shares.toLocaleString("en-US")}</td>
                  <td>{exactMoney(item.entryPrice)} / {exactMoney(item.stopPrice)}</td>
                  <td>{exactMoney(item.actualRisk)}</td>
                  <td>{exactMoney(item.positionAmount)}</td>
                  <td><button className="positionHistoryDelete" type="button" onClick={() => updateHistory(history.filter((row) => row.id !== item.id))}>删除</button></td>
                </tr>
              ))}
              {!history.length ? <tr><td className="positionHistoryEmpty" colSpan={8}>暂无最近计算</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
      {result ? <div className="positionMobileResult"><span>建议 {result.shares.toLocaleString("en-US")} 股</span><strong>{exactMoney(result.positionAmount)}</strong></div> : null}
    </div>
  );
}

// ponytail: hidden by product decision; replace with a real setting only if this needs per-user/env control.
const showOpenPortfolioDetails = false;
const openSectorColors = ["#2f80ed", "#7bb3ff", "#70c3a3", "#f6b75f", "#9aa8c7"];

function openMoney(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  return `${(Number(value) / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}万`;
}

function openSignedMoney(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${openMoney(Math.abs(value))}`;
}

function openQuantity(value?: number | null, step?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  const stepText = step ? String(step) : "";
  const digits = !step || step >= 1 ? 0 : stepText.includes("e-") ? Number(stepText.split("e-")[1]) || 0 : stepText.split(".")[1]?.length || 0;
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function openCurvePath(points: OpenPortfolioPayload["curve"]) {
  const width = 900;
  const height = 260;
  if (points.length <= 1) return { line: `M0,${height} L${width},${height}`, area: `M0,${height} L${width},${height} L${width},${height} L0,${height} Z` };
  const values = points.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const line = points.map((item, index) => {
    const x = (index / Math.max(1, points.length - 1)) * width;
    const y = height - ((item.value - min) / span) * (height - 24) - 12;
    return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return { line, area: `${line} L${width},${height} L0,${height} Z` };
}

function OpenPortfolioPage({ enabled }: { enabled: boolean }) {
  const [data, setData] = useState<OpenPortfolioPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const curve = useMemo(() => showOpenPortfolioDetails ? openCurvePath(data?.curve || []) : { line: "", area: "" }, [data?.curve]);
  const holdings = data?.holdings || [];
  const totalPositionPct = holdings.reduce((sum, row) => sum + (Number(row.positionPct) || 0), 0);
  const sectorRows = useMemo(() => {
    const sectors = new Map<string, { name: string; pct: number; symbols: string[] }>();
    holdings.forEach((row) => {
      const name = row.sector?.trim() || "其他";
      const current = sectors.get(name) || { name, pct: 0, symbols: [] };
      current.pct += Number(row.positionPct) || 0;
      current.symbols.push(row.symbol);
      sectors.set(name, current);
    });
    return Array.from(sectors.values())
      .sort((a, b) => b.pct - a.pct)
      .map((row, index) => ({
        ...row,
        color: openSectorColors[index % openSectorColors.length],
        share: totalPositionPct > 0 ? (row.pct / totalPositionPct) * 100 : 0,
      }));
  }, [holdings, totalPositionPct]);
  const pieStyle = useMemo<CSSProperties>(() => {
    let cursor = 0;
    const stops = sectorRows.map((row) => {
      const start = cursor;
      cursor += row.share;
      return `${row.color} ${start}% ${cursor}%`;
    });
    return { background: stops.length ? `conic-gradient(${stops.join(", ")})` : "#eaf1f8" };
  }, [sectorRows]);
  const historyPageSize = 10;
  const historyTotalPages = Math.max(1, Math.ceil((data?.trades.length || 0) / historyPageSize));
  const historyRows = (data?.trades || []).slice((historyPage - 1) * historyPageSize, historyPage * historyPageSize);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api.openPortfolio()
      .then((payload) => {
        setData(payload);
        setError("");
        setHistoryPage(1);
      })
      .catch(() => setError("Open 持仓加载失败"))
      .finally(() => setLoading(false));
  }, [enabled, loadVersion]);

  if (loading) {
    return <div className="openPortfolioPage"><div className="marketToolLoading compact">加载中</div></div>;
  }
  if (error) {
    return (
      <div className="openPortfolioPage">
        <div className="marketToolError compact openPortfolioError" role="alert">
          <span>{error}</span>
          <button type="button" className="requestRetry" onClick={() => setLoadVersion((value) => value + 1)}>重新加载</button>
        </div>
      </div>
    );
  }

  return (
    <div className="openPortfolioPage">
      {showOpenPortfolioDetails ? (
        <>
          <section className="openMetricGrid">
            <article><span>初始资金</span><strong>{openMoney(data?.initialCapital)}</strong></article>
            <article><span>当前资金</span><strong>{openMoney(data?.equity)}</strong></article>
            <article><span>已实现收益</span><strong className={signedClass(data?.realizedPnl)}>{openSignedMoney(data?.realizedPnl)}</strong></article>
            <article><span>收益率</span><strong className={signedClass(data?.realizedReturnPct)}>{data ? signed(data.realizedReturnPct) : "--"}</strong></article>
            <article><span>当前持仓</span><strong>{data?.holdings.length ?? "--"} 只</strong></article>
            <article><span>交易记录</span><strong>{data?.trades.length ?? "--"} 笔</strong></article>
          </section>

          <section className="openChartPanel">
            <div className="panelHead"><strong>资金曲线</strong><span>只按买卖记录更新</span></div>
            <div className="openCurve">
              <svg viewBox="0 0 900 260" preserveAspectRatio="none" aria-label="资金曲线">
                <defs>
                  <linearGradient id="openCurveFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#1677ff" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#1677ff" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <line x1="0" y1="64" x2="900" y2="64" />
                <line x1="0" y1="130" x2="900" y2="130" />
                <line x1="0" y1="196" x2="900" y2="196" />
                <path className="openCurveArea" d={curve.area} />
                <path className="openCurveLine" d={curve.line} />
              </svg>
            </div>
          </section>

        </>
      ) : null}

      <section className="openPanel openPositionPanel">
        <div className="panelHead"><strong>当前持仓</strong></div>
        <div className="openPositionLayout">
          <aside className="openSectorCard">
            <div className="openSectorPie" style={pieStyle}>
              <div>
                <span>持仓合计</span>
                <strong>{exactPercent(totalPositionPct)}</strong>
              </div>
            </div>
            <div className="openSectorLegend">
              {sectorRows.map((row) => (
                <div className="openSectorLegendItem" key={row.name}>
                  <i style={{ background: row.color }} />
                  <strong>{row.name}</strong>
                  <em>{exactPercent(row.pct)}</em>
                  <span>{row.symbols.join(" / ")}</span>
                </div>
              ))}
            </div>
          </aside>
          <div className="openPositionList">
            {holdings.map((row) => (
              <div className="openPositionRow" key={row.symbol}>
                <strong>{row.symbol}</strong>
                <span>{row.sector?.trim() || "其他"}</span>
                <div><i style={{ width: `${Math.max(2, Math.min(100, Number(row.positionPct) || 0))}%` }} /></div>
                <em>{exactPercent(row.positionPct)}</em>
              </div>
            ))}
          </div>
          {!data?.holdings.length ? <div className="openEmpty">暂无持仓</div> : null}
        </div>
      </section>

      <section className="openPanel">
        <div className="panelHead"><strong>交易历史</strong><span>按时间倒序</span></div>
        <table className="openTable openHistoryTable">
          <thead>
            <tr>
              <th>日期</th>
              <th>标的</th>
              <th>方向</th>
              <th>价格</th>
              <th>交易逻辑</th>
            </tr>
          </thead>
          <tbody>
            {historyRows.map((row) => (
              <tr key={row.id}>
                <td>{formatDate(row.tradeTime)}</td>
                <td><strong>{row.symbol}</strong></td>
                <td><span className={`openSideBadge ${row.side}`}>{row.side === "buy" ? "买入" : "卖出"}</span></td>
                <td>{priceDisplay(row.price)}</td>
                <td>{row.note?.trim() || ""}</td>
              </tr>
            ))}
            {!data?.trades.length ? <tr><td colSpan={5}>暂无交易记录</td></tr> : null}
          </tbody>
        </table>
        {data && data.trades.length > historyPageSize ? (
          <div className="openPager">
            <button type="button" disabled={historyPage <= 1} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}>上一页</button>
            <span>{historyPage} / {historyTotalPages}</span>
            <button type="button" disabled={historyPage >= historyTotalPages} onClick={() => setHistoryPage((page) => Math.min(historyTotalPages, page + 1))}>下一页</button>
          </div>
        ) : null}
      </section>

      <p className="openRiskText">仅作记录展示，不构成投资建议或收益承诺。</p>
    </div>
  );
}

function CoursesPage({ enabled, viewerKey, courseId, onCourse, onBack, onUnlock }: { enabled: boolean; viewerKey: number; courseId: string; onCourse: (courseId: string) => void; onBack: () => void; onUnlock: () => void }) {
  const [series, setSeries] = useState<CourseSeries[]>([]);
  const [activeLessonId, setActiveLessonId] = useState<number | null>(null);
  const [courseView, setCourseView] = useState<"mine" | "more">("mine");
  const [loadVersion, setLoadVersion] = useState(0);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoType, setVideoType] = useState<"file" | "hls">("file");
  const [videoExpiresAt, setVideoExpiresAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [playLoading, setPlayLoading] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [manualPlayRequired, setManualPlayRequired] = useState(false);
  const [playError, setPlayError] = useState("");
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<import("hls.js").default | null>(null);
  const playRequestRef = useRef(0);
  const playAbortRef = useRef<AbortController | null>(null);
  const pendingLessonRef = useRef<number | null>(null);
  const playbackResumeRef = useRef<{ lessonId: number; currentTime: number; shouldPlay: boolean } | null>(null);
  const autoRenewAttemptedRef = useRef(false);
  const reportedPlaybackErrorsRef = useRef(new Set<string>());
  const reportedPlaybackMetricsRef = useRef(new Set<string>());
  const playbackObservationRef = useRef<{ lessonId: number; startedAt: number; ready: boolean; hasPlayed: boolean } | null>(null);
  const selected = courseId ? series.find((item) => String(item.id) === courseId || item.slug === courseId) || null : null;
  const activeLesson = selected?.unlocked ? selected.lessons.find((lesson) => lesson.id === activeLessonId) || selected.lessons[0] || null : null;
  const unlockedSeries = useMemo(() => series.filter((item) => item.unlocked).sort((left, right) => right.sortOrder - left.sortOrder), [series]);
  const lockedSeries = useMemo(() => series.filter((item) => !item.unlocked).sort((left, right) => right.sortOrder - left.sortOrder), [series]);
  const visibleSeries = courseView === "mine" ? unlockedSeries : lockedSeries;

  const reportPlaybackError = useCallback((lessonId: number, reason: "url" | "renew" | "source" | "play" | "unsupported") => {
    const eventKey = `${lessonId}:${reason}`;
    if (reportedPlaybackErrorsRef.current.has(eventKey)) return;
    reportedPlaybackErrorsRef.current.add(eventKey);
    void api.analyticsEvent("course_video_error", eventKey, "/courses/playback").catch(() => {});
  }, []);

  const reportPlaybackMetric = useCallback((eventType: "course_video_url_ready" | "course_video_ready" | "course_video_buffer", eventKey: string) => {
    const dedupeKey = `${eventType}:${eventKey.split(":", 1)[0]}`;
    if (reportedPlaybackMetricsRef.current.has(dedupeKey)) return;
    reportedPlaybackMetricsRef.current.add(dedupeKey);
    void api.analyticsEvent(eventType, eventKey, "/courses/playback").catch(() => {});
  }, []);

  function playbackLatencyBucket(elapsedMs: number) {
    if (elapsedMs < 1000) return "lt1";
    if (elapsedMs < 3000) return "1to3";
    if (elapsedMs < 8000) return "3to8";
    return "gte8";
  }

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    api.courses()
      .then((payload) => {
        if (cancelled) return;
        const rows = payload.series || [];
        setSeries(rows);
        setCourseView(rows.some((item) => item.unlocked) ? "mine" : "more");
      })
      .catch((err) => {
        if (!cancelled) setError("课程暂时加载失败，请稍后刷新");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, loadVersion, viewerKey]);

  const stopCurrentVideo = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    setVideoUrl("");
    setVideoType("file");
    setVideoExpiresAt(0);
    setIsVideoPlaying(false);
    setManualPlayRequired(false);
  }, []);

  function handlePlayFailure(video: HTMLVideoElement, err: unknown) {
    if (videoRef.current !== video) return;
    if (err instanceof DOMException && err.name === "AbortError") return;
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      setManualPlayRequired(true);
      return;
    }
    setManualPlayRequired(false);
    setPlayError("播放失败，请重试");
    if (activeLessonId) reportPlaybackError(activeLessonId, "play");
  }

  async function resumeCurrentVideo() {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      if (videoRef.current !== video) return;
      setManualPlayRequired(false);
      setPlayError("");
    } catch (err) {
      handlePlayFailure(video, err);
    }
  }

  function recoverPlaybackSource() {
    setIsVideoPlaying(false);
    setManualPlayRequired(false);
    if (activeLesson && pendingLessonRef.current === activeLesson.id) return;
    if (activeLesson && !autoRenewAttemptedRef.current) {
      autoRenewAttemptedRef.current = true;
      void playLesson(activeLesson.id, true);
      return;
    }
    setPlayError("播放失败，请重试");
    if (activeLesson) reportPlaybackError(activeLesson.id, "source");
  }

  async function playLesson(lessonId: number, forceRefresh = false, preservePaused = false) {
    if (!forceRefresh && pendingLessonRef.current === lessonId) return;
    if (!forceRefresh && activeLessonId === lessonId && videoUrl) {
      await resumeCurrentVideo();
      return;
    }

    const requestId = playRequestRef.current + 1;
    playRequestRef.current = requestId;
    playAbortRef.current?.abort();
    const controller = new AbortController();
    playAbortRef.current = controller;
    pendingLessonRef.current = lessonId;

    const currentVideo = videoRef.current;
    const refreshingCurrentVideo = Boolean(forceRefresh && activeLessonId === lessonId && videoUrl && currentVideo);
    playbackResumeRef.current = refreshingCurrentVideo && currentVideo
      ? {
          lessonId,
          currentTime: Number.isFinite(currentVideo.currentTime) ? currentVideo.currentTime : 0,
          shouldPlay: preservePaused ? !currentVideo.paused && !currentVideo.ended : true
        }
      : null;
    if (!refreshingCurrentVideo) stopCurrentVideo();
    playbackObservationRef.current = { lessonId, startedAt: performance.now(), ready: false, hasPlayed: false };
    setActiveLessonId(lessonId);
    setPlayLoading(true);
    setPlayError("");
    try {
      const payload = await api.coursePlayUrl(lessonId, controller.signal);
      if (playRequestRef.current !== requestId) return;
      const observation = playbackObservationRef.current;
      if (observation?.lessonId === lessonId) {
        reportPlaybackMetric("course_video_url_ready", `${lessonId}:${playbackLatencyBucket(performance.now() - observation.startedAt)}`);
      }
      if (refreshingCurrentVideo) stopCurrentVideo();
      setVideoType(payload.type);
      setVideoExpiresAt(Date.now() + Math.max(60, payload.expiresIn) * 1000);
      setVideoUrl(payload.url);
    } catch (err) {
      if (controller.signal.aborted || playRequestRef.current !== requestId) return;
      playbackResumeRef.current = null;
      reportPlaybackError(lessonId, forceRefresh ? "renew" : "url");
      if (!preservePaused) setPlayError("播放失败，请重试");
    } finally {
      if (playRequestRef.current === requestId) {
        playAbortRef.current = null;
        pendingLessonRef.current = null;
        setPlayLoading(false);
      }
    }
  }

  useEffect(() => {
    playRequestRef.current += 1;
    playAbortRef.current?.abort();
    playAbortRef.current = null;
    pendingLessonRef.current = null;
    stopCurrentVideo();
    setPlayLoading(false);
    setPlayError("");
    autoRenewAttemptedRef.current = false;
    playbackResumeRef.current = null;
    playbackObservationRef.current = null;
    setActiveLessonId(selected?.unlocked ? selected.lessons?.[0]?.id || null : null);
  }, [selected?.id, selected?.unlocked, selected?.lessons, stopCurrentVideo]);

  useEffect(() => {
    if (!videoUrl || !videoRef.current) return;
    const video = videoRef.current;
    const startPlayback = () => {
      const resume = playbackResumeRef.current;
      const finish = () => {
        if (resume?.lessonId === activeLessonId && resume.currentTime > 0) {
          video.currentTime = Math.min(resume.currentTime, Number.isFinite(video.duration) ? video.duration : resume.currentTime);
        }
        playbackResumeRef.current = null;
        if (!resume || resume.shouldPlay) void video.play().catch((err) => handlePlayFailure(video, err));
      };
      if (resume?.lessonId === activeLessonId && video.readyState < 1) {
        video.addEventListener("loadedmetadata", finish, { once: true });
      } else {
        finish();
      }
    };

    if (videoType === "hls") {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = videoUrl;
        video.load();
        startPlayback();
        return;
      }
      let cancelled = false;
      void import("hls.js")
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            setPlayError("当前浏览器暂不支持播放");
            if (activeLessonId) reportPlaybackError(activeLessonId, "unsupported");
            return;
          }
          const hls = new Hls({ enableWorker: true });
          hlsRef.current = hls;
          hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(videoUrl));
          hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
          hls.on(Hls.Events.ERROR, (_, data) => {
            if (!data.fatal || hlsRef.current !== hls) return;
            recoverPlaybackSource();
          });
          hls.attachMedia(video);
        })
        .catch(() => {
          if (!cancelled) {
            setPlayError("播放失败，请重试");
            if (activeLessonId) reportPlaybackError(activeLessonId, "source");
          }
        });
      return () => {
        cancelled = true;
        hlsRef.current?.destroy();
        hlsRef.current = null;
      };
    }

    video.src = videoUrl;
    video.load();
    startPlayback();
  }, [videoType, videoUrl]);

  useEffect(() => {
    if (!videoUrl || !videoExpiresAt || !activeLessonId) return;
    const delay = Math.max(1000, videoExpiresAt - Date.now() - 120_000);
    const timer = window.setTimeout(() => {
      void playLesson(activeLessonId, true, true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [activeLessonId, videoExpiresAt, videoUrl]);

  useEffect(() => () => {
    playRequestRef.current += 1;
    playAbortRef.current?.abort();
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }, []);

  if (loading) return <div className="coursesPage"><div className="loading" /></div>;

  if (courseId) {
    if (error) {
      return (
        <div className="coursesPage">
          <button type="button" className="courseBackButton" onClick={onBack}>返回课程</button>
          <div className="courseError" role="alert"><span>{error}</span><button type="button" onClick={() => setLoadVersion((version) => version + 1)}>重新加载</button></div>
        </div>
      );
    }
    if (!selected) {
      return (
        <div className="coursesPage">
          <button type="button" className="courseBackButton" onClick={onBack}>返回课程</button>
          <section className="coursesEmpty">实战课程不存在</section>
        </div>
      );
    }

    const courseIntro = selected.intro || selected.summary;
    const lessonCount = selected.lessonCount || selected.lessons?.length || 0;

    return (
      <div className="coursesPage">
        <button type="button" className="courseBackButton" onClick={onBack}>{selected.unlocked ? "返回我的课程" : "返回更多课程"}</button>

        {selected.unlocked ? (
          <>
            <section className="courseLearningHead">
              <div><h1>{selected.title}</h1><span>当前课时：{activeLesson?.title || "请选择课时"}</span></div>
              {selected.grantExpiresAt ? <em>授权到期 {formatDate(selected.grantExpiresAt)}</em> : <em>已授权</em>}
            </section>
            <section className="coursePlayLayout">
              <article className="coursePlayer">
                <div className="courseVideoBox">
                  {videoUrl ? (
                    <>
                      <video
                        ref={videoRef}
                        key={videoUrl}
                        controls
                        controlsList="nodownload"
                        preload="metadata"
                        playsInline
                        onPlay={() => { autoRenewAttemptedRef.current = false; setIsVideoPlaying(true); setManualPlayRequired(false); setPlayError(""); }}
                        onCanPlay={() => {
                          const observation = playbackObservationRef.current;
                          if (!observation || observation.lessonId !== activeLessonId || observation.ready) return;
                          observation.ready = true;
                          reportPlaybackMetric("course_video_ready", `${observation.lessonId}:${playbackLatencyBucket(performance.now() - observation.startedAt)}`);
                        }}
                        onPlaying={() => {
                          const observation = playbackObservationRef.current;
                          if (observation?.lessonId === activeLessonId) observation.hasPlayed = true;
                        }}
                        onWaiting={(event) => {
                          const observation = playbackObservationRef.current;
                          if (!observation?.hasPlayed || observation.lessonId !== activeLessonId || event.currentTarget.seeking) return;
                          reportPlaybackMetric("course_video_buffer", String(observation.lessonId));
                        }}
                        onPause={() => setIsVideoPlaying(false)}
                        onEnded={() => setIsVideoPlaying(false)}
                        onError={(event) => {
                          if (!event.currentTarget.currentSrc) return;
                          recoverPlaybackSource();
                        }}
                      />
                      {playError ? (
                        <div className="courseVideoState" role="alert"><span>播放失败</span><button type="button" onClick={() => { autoRenewAttemptedRef.current = false; if (activeLesson) void playLesson(activeLesson.id, true); }}>重试</button></div>
                      ) : manualPlayRequired ? (
                        <button type="button" className="courseVideoResume" onClick={resumeCurrentVideo}>继续播放</button>
                      ) : null}
                    </>
                  ) : playLoading ? (
                    <div className="courseVideoState"><i aria-hidden="true" /><span>正在加载</span></div>
                  ) : playError ? (
                    <div className="courseVideoState" role="alert"><span>播放失败</span><button type="button" onClick={() => { autoRenewAttemptedRef.current = false; if (activeLesson) void playLesson(activeLesson.id, true); }}>重试</button></div>
                  ) : (
                    <button type="button" className="courseVideoPlayButton" disabled={!activeLesson} onClick={() => activeLesson && playLesson(activeLesson.id)} aria-label="播放当前课时">
                      <span />
                    </button>
                  )}
                </div>
              </article>

              <aside className="courseLessonList">
                <div className="panelHead"><strong>课程目录 · {lessonCount} 节</strong><span>{courseProgressLabel(selected.progressStatus)}</span></div>
                {(selected.lessons || []).map((lesson, index) => (
                  <button key={lesson.id} type="button" className={activeLesson?.id === lesson.id ? "active" : ""} onClick={() => playLesson(lesson.id)}>
                    <b>{index + 1}</b>
                    <span><strong>{lesson.title}</strong>{lesson.durationLabel ? <em>{lesson.durationLabel}</em> : null}</span>
                    <i>{activeLesson?.id === lesson.id && playLoading ? "加载中" : activeLesson?.id === lesson.id && isVideoPlaying ? "播放中" : "播放"}</i>
                  </button>
                ))}
              </aside>
            </section>
          </>
        ) : (
          <>
            <section className="courseDetailHero">
              <div className="courseDetailCover">{selected.coverUrl ? <img src={selected.coverUrl} alt="" decoding="async" fetchPriority="high" /> : null}</div>
              <div className="courseDetailText">
                <h1>{selected.title}</h1>
                <div className="courseMetaPills"><span>{lessonCount ? `${lessonCount} 节视频` : "即将上线"}</span>{lessonCount ? <span>{courseProgressLabel(selected.progressStatus)}</span> : null}</div>
                <div className="courseSummaryRich articleProse">{richCourseSummary(selected.summary, `${lessonCount} 节视频`)}</div>
                {courseDiscountBlock(selected, "courseDiscountBlock detailDiscount")}
                <button type="button" className="courseDetailUnlock" onClick={onUnlock}>联系开通</button>
                <span className="courseDetailNote">开通后可播放完整视频</span>
              </div>
            </section>
            <section className="courseDetailBody">
              <article className="courseIntroPanel">
                <h2>课程介绍</h2>
                <div className="courseSummaryRich articleProse">{richCourseSummary(courseIntro, selected.summary)}</div>
              </article>
              <aside className="courseOutlinePanel">
                <h2>课程目录</h2>
                {selected.lessons.length ? <div className="courseLockedLessons">{selected.lessons.map((lesson, index) => <div key={lesson.id}><span>{index + 1}</span><strong>{lesson.title}</strong>{lesson.durationLabel ? <em>{lesson.durationLabel}</em> : null}</div>)}</div> : <p>即将上线</p>}
              </aside>
            </section>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="coursesPage">
      <nav className="courseTabs" aria-label="课程分类">
        {unlockedSeries.length ? <button type="button" className={courseView === "mine" ? "active" : ""} onClick={() => setCourseView("mine")}>我的课程</button> : null}
        {lockedSeries.length ? <button type="button" className={courseView === "more" ? "active" : ""} onClick={() => setCourseView("more")}>更多课程</button> : null}
      </nav>

      {error ? <div className="courseError"><span>{error}</span><button type="button" onClick={() => setLoadVersion((version) => version + 1)}>重新加载</button></div> : null}
      {!error && !series.length ? <section className="coursesEmpty">暂无课程</section> : null}

      {series.length ? (
          <section className="courseCardGrid">
            {visibleSeries.map((item, index) => {
              const lessonCount = item.lessonCount || item.lessons?.length || 0;
              return (
              <article
                key={item.id}
                className="courseCatalogCard"
                role="button"
                tabIndex={0}
                aria-label={`${item.unlocked ? "进入" : "查看"}${item.title}`}
                onClick={() => onCourse(String(item.id))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onCourse(String(item.id));
                  }
                }}
              >
                <div className="courseThumb">
                  {item.coverCardUrl || item.coverUrl ? <img src={item.coverCardUrl || item.coverUrl} alt="" loading={index < 4 ? "eager" : "lazy"} decoding="async" fetchPriority={index < 4 ? "high" : "auto"} /> : null}
                </div>
                <section>
                  <h2>{item.title}</h2>
                  <p>{compactText(item.summary, 82) || (lessonCount ? `${lessonCount} 节视频` : "即将上线")}</p>
                  <div className="courseCardMeta">
                    {lessonCount ? (
                      <>
                        <span>{lessonCount} 节视频</span>
                        <span className={`courseStatusBadge ${item.progressStatus === "finished" ? "finished" : "updating"}`}>{courseProgressLabel(item.progressStatus)}</span>
                      </>
                    ) : null}
                  </div>
                  <footer>
                    {item.unlocked ? <em>{courseGrantText(item)}</em> : courseDiscountBlock(item) || <span className="courseCatalogActionText">查看目录</span>}
                    <span className="courseCardArrow" aria-hidden="true">→</span>
                  </footer>
                </section>
              </article>
              );
            })}
          </section>
      ) : null}
    </div>
  );
}

const fundingDefaults = {
  notional: "1000",
  safety: "0.5",
  maxGapPct: "1",
  minNet: "0",
  binanceSpotFeePct: "0.10",
  binancePerpFeePct: "0.04",
  bitgetSpotFeePct: "0.10",
  bitgetPerpFeePct: "0.06"
};

function scannerNumber(value: string) {
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : NaN;
}

function scannerUsdt(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)} USDT`;
}

function scannerPlainUsdt(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  return `${value.toFixed(2)} USDT`;
}

function scannerPercent(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  return `${(value * 100).toFixed(4)}%`;
}

function scannerGap(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  return `${(value / 100).toFixed(2)}%`;
}

function scannerMinutes(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  return `${Math.max(0, Math.round(value))} 分钟`;
}

function scannerExchangeLabel(value: string) {
  return value === "binance" ? "Binance" : value === "bitget" ? "Bitget" : value;
}

function scannerSignalText(value: string) {
  return value === "ENTER" ? "可进场" : "等待";
}

function FundingArbitragePage({ isAdmin }: { isAdmin: boolean }) {
  const [settings, setSettings] = useState(fundingDefaults);
  const [exchange, setExchange] = useState("all");
  const [onlyReady, setOnlyReady] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [rows, setRows] = useState<FundingScannerRow[]>([]);
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [stale, setStale] = useState(false);

  const updateSetting = (key: keyof typeof fundingDefaults, value: string) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const scannerQuery = useCallback((cached = false) => {
    const values = {
      notional: scannerNumber(settings.notional),
      safety: scannerNumber(settings.safety),
      maxGapPct: scannerNumber(settings.maxGapPct),
      minNet: scannerNumber(settings.minNet),
      binanceSpotFeePct: scannerNumber(settings.binanceSpotFeePct),
      binancePerpFeePct: scannerNumber(settings.binancePerpFeePct),
      bitgetSpotFeePct: scannerNumber(settings.bitgetSpotFeePct),
      bitgetPerpFeePct: scannerNumber(settings.bitgetPerpFeePct)
    };
    if (Object.values(values).some((value) => !Number.isFinite(value))) {
      setError("参数不是数字");
      return null;
    }
    return {
      notional_usdt: values.notional,
      safety_buffer_usdt: values.safety,
      max_basis_bps: values.maxGapPct * 100,
      min_expected_net_usdt: values.minNet,
      binance_spot_fee_bps: values.binanceSpotFeePct * 100,
      binance_perp_fee_bps: values.binancePerpFeePct * 100,
      bitget_spot_fee_bps: values.bitgetSpotFeePct * 100,
      bitget_perp_fee_bps: values.bitgetPerpFeePct * 100,
      exchange,
      cached
    };
  }, [exchange, settings]);

  const applyScannerPayload = (payload: Awaited<ReturnType<typeof api.fundingScanner>>) => {
    setRows(payload.rows || []);
    setUpdatedAt(payload.updated_at);
    setStale(Boolean(payload.stale));
  };

  const refresh = useCallback(() => {
    if (!isAdmin) return;
    const query = scannerQuery(false);
    if (!query) return;
    setLoading(true);
    setError("");
    api.fundingScanner(query)
      .then((payload) => {
        applyScannerPayload(payload);
      })
      .catch(() => setError("扫描暂时不可用，请稍后重试"))
      .finally(() => setLoading(false));
  }, [isAdmin, scannerQuery]);

  useEffect(() => {
    if (!isAdmin || loadedOnce) return;
    setLoadedOnce(true);
    const query = scannerQuery(true);
    if (query) {
      api.fundingScanner(query)
        .then((payload) => {
          if ((payload.rows || []).length) applyScannerPayload(payload);
        })
        .catch(() => undefined);
    }
    refresh();
  }, [loadedOnce, refresh, scannerQuery]);

  useEffect(() => {
    if (!autoRefresh || !isAdmin) return;
    const timer = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, isAdmin, refresh]);

  if (!isAdmin) {
    return (
      <div className="fundingScannerPage">
        <section className="fundingLockedPanel">
          <h1>资金费套利扫描</h1>
          <p>当前账号暂未开通该工具。</p>
        </section>
      </div>
    );
  }

  const visibleRows = rows.filter((row) => !onlyReady || row.signal === "ENTER");
  const readyCount = rows.filter((row) => row.signal === "ENTER").length;
  const best = rows.reduce<FundingScannerRow | undefined>((winner, row) => {
    if (typeof row.expected_net_usdt !== "number") return winner;
    if (!winner || typeof winner.expected_net_usdt !== "number") return row;
    return row.expected_net_usdt > winner.expected_net_usdt ? row : winner;
  }, undefined);
  return (
    <div className="fundingScannerPage">
      <header className="fundingScannerTop">
        <div>
          <h1>资金费套利扫描</h1>
          <span>只读扫描器，不连接账户</span>
        </div>
        <strong className={loading ? "loading" : stale ? "stale" : ""}>{loading ? "扫描中" : stale ? "数据可能过期" : "已更新"} · {formatStoredDateTime(updatedAt)}</strong>
      </header>

      <section className="fundingScannerPanel">
        <div className="fundingScannerControls">
          <label>每笔金额<input value={settings.notional} onChange={(event) => updateSetting("notional", event.target.value)} inputMode="decimal" /></label>
          <label>预留成本<input value={settings.safety} onChange={(event) => updateSetting("safety", event.target.value)} inputMode="decimal" /></label>
          <label>最大价差 %<input value={settings.maxGapPct} onChange={(event) => updateSetting("maxGapPct", event.target.value)} inputMode="decimal" /></label>
          <label>最低到手收益<input value={settings.minNet} onChange={(event) => updateSetting("minNet", event.target.value)} inputMode="decimal" /></label>
          <label>交易所<select value={exchange} onChange={(event) => setExchange(event.target.value)}><option value="all">全部</option><option value="binance">Binance</option><option value="bitget">Bitget</option></select></label>
          <button type="button" className={autoRefresh ? "active" : ""} onClick={() => setAutoRefresh((value) => !value)}>{autoRefresh ? "自动刷新" : "手动刷新"}</button>
          <button type="button" onClick={refresh} disabled={loading}>刷新</button>
        </div>
        <div className="fundingFeeControls">
          <label>Binance 现货手续费 %<input value={settings.binanceSpotFeePct} onChange={(event) => updateSetting("binanceSpotFeePct", event.target.value)} inputMode="decimal" /></label>
          <label>Binance 合约手续费 %<input value={settings.binancePerpFeePct} onChange={(event) => updateSetting("binancePerpFeePct", event.target.value)} inputMode="decimal" /></label>
          <label>Bitget 现货手续费 %<input value={settings.bitgetSpotFeePct} onChange={(event) => updateSetting("bitgetSpotFeePct", event.target.value)} inputMode="decimal" /></label>
          <label>Bitget 合约手续费 %<input value={settings.bitgetPerpFeePct} onChange={(event) => updateSetting("bitgetPerpFeePct", event.target.value)} inputMode="decimal" /></label>
        </div>
        <div className="fundingScannerStats">
          <article><span>扫描结果</span><strong>{rows.length}</strong><em>{readyCount} 个可进场</em></article>
          <article><span>刷新频率</span><strong>{autoRefresh ? "30 秒" : "手动"}</strong><em>盘口快照</em></article>
          <article><span>最高扣费后收益</span><strong className={signedClass(best?.expected_net_usdt)}>{scannerUsdt(best?.expected_net_usdt)}</strong><em>按当前参数</em></article>
        </div>
      </section>

      {error ? <p className="fundingScannerError">{error}</p> : null}

      <section className="fundingScannerPanel">
        <div className="fundingScannerTableHead">
          <div>
            <button type="button" className={!onlyReady ? "active" : ""} onClick={() => setOnlyReady(false)}>全部</button>
            <button type="button" className={onlyReady ? "active" : ""} onClick={() => setOnlyReady(true)}>只看可进场</button>
          </div>
          <span>按本期费率从高到低</span>
        </div>
        <div className="fundingScannerTable">
          <table>
            <thead>
              <tr>
                <th>平台</th>
                <th>标的</th>
                <th>本期费率</th>
                <th>预计收入</th>
                <th>手续费</th>
                <th>滑点</th>
                <th>预留成本</th>
                <th>扣费后收益</th>
                <th>现货/合约价差</th>
                <th>剩余时间</th>
                <th>状态</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={`${row.exchange}-${row.spot_symbol}-${row.perp_symbol}`}>
                  <td><span className="fundingExchange">{scannerExchangeLabel(row.exchange)}</span></td>
                  <td><strong>{row.ticker}</strong><small>{row.spot_symbol} / {row.perp_symbol}</small></td>
                  <td className={signedClass((row.funding_rate || 0) * 100)}>{scannerPercent(row.funding_rate)}</td>
                  <td className={signedClass(row.funding_income_usdt)}>{scannerPlainUsdt(row.funding_income_usdt)}</td>
                  <td>{scannerPlainUsdt(row.fee_usdt)}</td>
                  <td>{scannerPlainUsdt(row.slippage_usdt)}</td>
                  <td>{scannerPlainUsdt(row.safety_buffer_usdt)}</td>
                  <td className={signedClass(row.expected_net_usdt)}><strong>{scannerUsdt(row.expected_net_usdt)}</strong></td>
                  <td>{scannerGap(row.basis_bps)}</td>
                  <td>{scannerMinutes(row.minutes_to_funding)}</td>
                  <td><span className={`fundingSignal ${row.signal === "ENTER" ? "ready" : "wait"}`}>{scannerSignalText(row.signal)}</span></td>
                  <td className={row.signal === "ENTER" ? "positive" : "negative"}>{row.reason || "--"}</td>
                </tr>
              ))}
              {!visibleRows.length ? (
                <tr><td colSpan={12} className="fundingScannerEmpty">{loading ? "正在扫描..." : error ? "扫描未完成" : "没有符合条件的结果"}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fundingScannerRisk">
        <span>只读扫描器，不自动下单</span>
        <span>资金费临结算前可能变化</span>
        <span>盘口滑点只是当前快照</span>
        <span>股票代币不等于真实美股</span>
      </section>
    </div>
  );
}

function ComingSoonPage({ title }: { title: string }) {
  return (
    <div className="comingSoonPage">
      <section>
        <span>待上线</span>
        <h1>{title}</h1>
      </section>
    </div>
  );
}

export default App;

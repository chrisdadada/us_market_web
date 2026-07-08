import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from "react";
import {
  api,
  AuthStatus,
  BootstrapPayload,
  CalendarEvent,
  CourseSeries,
  FundingScannerRow,
  MarketRow,
  OpenPortfolioPayload,
  Opinion,
  SectorFlowPayload,
  SignalState,
  StrengthRow,
  SymbolDetailPayload,
  SymbolRow
} from "./api";
import { calculatePositionSizing, type PositionDirection, type PositionSizingResult } from "./positionSizing";
import {
  LockedStockName,
  MaskedValue,
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

type PageKey = "home" | "opinions" | "tracking" | "market" | "stocks" | "calendar" | "open" | "position" | "funding" | "forum" | "courses";
type AccessLevel = "free" | "monthly" | "yearly";
type AuthMode = "login" | "register" | "forgot" | "reset";

const navItems: Array<{ key: PageKey; label: string; status?: string; disabled?: boolean }> = [
  { key: "home", label: "首页" },
  { key: "opinions", label: "美股热点风向标" },
  { key: "tracking", label: "股票机会跟踪榜单" },
  { key: "stocks", label: "股票库" },
  { key: "calendar", label: "美股重点财经前瞻" },
  { key: "market", label: "市场与资金" },
  { key: "courses", label: "交易实战课程" },
  { key: "open", label: "Open 持仓参考" },
  { key: "forum", label: "论坛讨论区", status: "待开放", disabled: true }
];

const toolDataNavItems = [
  { href: "/legacy/#risk", label: "市场温度计" },
  { href: "/legacy/#strength", label: "全市场强弱" },
  { href: "/legacy/#valuation", label: "指数估值" },
  { href: "/legacy/#options", label: "期权流向" },
  { href: "/legacy/#signals", label: "趋势信号" },
  { href: "/legacy/#stock-events", label: "股票事件" },
  { href: "/legacy/#earnings", label: "财报观察" },
  { href: "/legacy/#watchlist", label: "自选" }
];

const memberToolNavItems: Array<{ key: PageKey; label: string }> = [
  { key: "position", label: "以损定仓" }
];

const toolDataPageNavItems: Array<{ key: PageKey; label: string }> = [
  { key: "funding", label: "资金费套利扫描" }
];

const allPageNavItems = [...navItems, ...memberToolNavItems, ...toolDataPageNavItems];
const validPageKeys = new Set<PageKey>(allPageNavItems.map((item) => item.key));
const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const superAdminLoginName = "admin";
const volumeRatioHelp = "当前成交额相对近20日平均成交额的倍数，越高代表成交越活跃。";

type RouteState = {
  page: PageKey;
  opinionId: string;
  symbol: string;
  courseId: string;
  resetToken: string;
};

function VolumeRatioLabel() {
  return <>成交倍数<span className="metricHelp" title={volumeRatioHelp} aria-label={volumeRatioHelp}>?</span></>;
}

function readRouteState(): RouteState {
  const params = new URLSearchParams(window.location.search);
  const pageParam = params.get("page") as PageKey | null;
  return {
    page: pageParam && validPageKeys.has(pageParam) ? pageParam : "home",
    opinionId: params.get("opinion") || "",
    symbol: (params.get("symbol") || "").trim().toUpperCase(),
    courseId: params.get("course") || "",
    resetToken: params.get("resetToken") || ""
  };
}

function pushRouteState(route: Partial<RouteState> & { page: PageKey }) {
  const url = new URL(window.location.href);
  url.search = "";
  if (route.page !== "home") url.searchParams.set("page", route.page);
  if (route.page === "opinions" && route.opinionId) url.searchParams.set("opinion", route.opinionId);
  if (route.page === "stocks" && route.symbol) url.searchParams.set("symbol", route.symbol);
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

const trackingAddedSymbols = ["SOXL", "DRAM", "MRVL", "SPCX", "DELL", "AMAT", "000660", "005930"];

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
  premarket: "盘前前瞻",
  daily: "每日个股行情观点",
  research: "研报解析",
  postmarket: "盘后复盘延展",
  journal: "交易日记"
};

function opinionSectionLabel(item?: Pick<Opinion, "section" | "sectionLabel"> | null) {
  if (!item) return "美股热点风向标";
  return sectionLabels[item.section] || item.sectionLabel || "美股热点风向标";
}

function isHomepageOpinion(item: Opinion) {
  if (!sectionLabels[item.section]) return false;
  if ((item.title || "").trim().length < 2) return false;
  return item.status === "published";
}

const pageAccessRules: Partial<Record<PageKey, { level: AccessLevel; title: string; text: string }>> = {
  opinions: {
    level: "monthly",
    title: "会员可看完整美股热点风向标",
    text: "免费账号可预览最新方向，完整正文、历史观点和栏目内容开通后查看。"
  },
  tracking: {
    level: "monthly",
    title: "会员可看完整股票机会跟踪榜单",
    text: "免费账号可看到涨幅和强弱线索，标的名称开通后查看。"
  },
  market: {
    level: "monthly",
    title: "会员可看市场与资金",
    text: "开通后查看板块排行、资金方向和热门股票板块。"
  },
  open: {
    level: "yearly",
    title: "年度会员可看 Open 持仓参考",
    text: "开通后查看完整持仓、收益分布和交割记录。"
  },
  position: {
    level: "monthly",
    title: "会员可用以损定仓",
    text: "开通后按买入价、止损价和单笔最大亏损计算建议仓位。"
  }
};

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
          {match[1] && match[1] !== "image" ? <figcaption>{match[1]}</figcaption> : null}
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

function opinionDisplayTitle(item?: Opinion | null, max = 56) {
  if (!item) return "--";
  const sectionLabel = opinionSectionLabel(item);
  let title = isBlankValue(item.title) ? "" : String(item.title).trim();
  if (sectionLabel && title.startsWith(sectionLabel)) title = title.slice(sectionLabel.length).trim();
  title = title.replace(/#[^\s#]+/g, "").replace(/\s+/g, " ").trim();
  if (!title || title === sectionLabel || Object.values(sectionLabels).includes(title)) {
    title = firstReadableParagraph(item.body, item.summary) || sectionLabel || "美股热点风向标";
  }
  return title.length > max ? `${title.slice(0, max)}...` : title;
}

function signalForSymbol(states: SignalState[], symbol?: string | null) {
  return states.find((item) => item.symbol === symbol) || null;
}

type TrackingSortKey = "symbol" | "currentPrice" | "oneMonth" | "oneDay" | "oneWeek" | "volume" | "marketCap" | "signal" | "signalFirstSeen";
type StockSortKey = "symbol" | "dayChange" | "weekChange" | "monthChange" | "dollarVolume" | "marketCap";
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

function barWidth(value?: number | string | null, max = 100) {
  const n = Math.abs(numericPercent(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(6, Math.min(100, (n / max) * 100));
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
  return accessRank(auth) >= requiredRank(pageAccessRules[page]?.level);
}

function pageNeedsBootstrap(page: PageKey) {
  return page === "home" || page === "tracking" || page === "market";
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
  const signalMap = new Map(signalStates.map((item) => [item.symbol, item]));
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
        scoreValue: Number(String(month).replace("%", "").replace("+", "")) || -999
      };
    })
    .sort((a, b) => b.scoreValue - a.scoreValue);
}

function App() {
  const initialRoute = useMemo(() => readRouteState(), []);
  const [page, setPage] = useState<PageKey>(initialRoute.page);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
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
  const [selectedOpinion, setSelectedOpinion] = useState<string>(initialRoute.opinionId);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(initialRoute.symbol);
  const [selectedCourse, setSelectedCourse] = useState<string>(initialRoute.courseId);
  const [selectedSymbolSource, setSelectedSymbolSource] = useState<"stocks" | "tracking" | "search">("stocks");
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>(initialRoute.resetToken ? "reset" : "login");
  const [resetToken, setResetToken] = useState(initialRoute.resetToken);
  const [globalSearch, setGlobalSearch] = useState("");

  const refreshAuth = () => api.auth().then((payload) => {
    setAuth(payload);
    return payload;
  });

  const refreshBootstrap = useCallback(() => {
    setBootstrapLoading(true);
    return api.bootstrap(500, trackingSymbols)
      .then((payload) => setBootstrap(payload))
      .finally(() => setBootstrapLoading(false));
  }, []);

  const refreshOpinions = useCallback(() => {
    setOpinionsLoading(true);
    return api.opinions(12)
      .then((payload) => {
        setOpinions(payload.rows || []);
        setOpinionsLoaded(true);
      })
      .finally(() => setOpinionsLoading(false));
  }, []);

  const refreshCalendar = useCallback(() => {
    setCalendarLoading(true);
    return api.calendar({ limit: 8, windowDays: "45" })
      .then((payload) => {
        setCalendar(payload.rows || []);
        setCalendarLoaded(true);
      })
      .finally(() => setCalendarLoading(false));
  }, []);

  const refreshSignals = useCallback(() => {
    setSignalsLoading(true);
    return api.signals()
      .then((payload) => {
        setSignalStates(payload.states || []);
        setSignalsLoaded(true);
      })
      .finally(() => setSignalsLoading(false));
  }, []);

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
    const tasks: Array<Promise<unknown>> = [
      api.auth().then((authPayload) => setAuth(authPayload))
    ];
    if (pageNeedsBootstrap(initialRoute.page)) tasks.push(refreshBootstrap());
    if (pageNeedsOpinions(initialRoute.page)) {
      tasks.push(refreshOpinions().then(() => setSelectedOpinion((current) => current || initialRoute.opinionId || "")));
    }
    if (pageNeedsCalendar(initialRoute.page)) tasks.push(refreshCalendar());
    if (pageNeedsSignals(initialRoute.page)) tasks.push(refreshSignals());
    Promise.all(tasks)
      .finally(() => {
        setBootstrapLoading(false);
        setOpinionsLoading(false);
        setCalendarLoading(false);
        setSignalsLoading(false);
        setLoading(false);
      });
  }, [initialRoute.opinionId, initialRoute.page, refreshBootstrap, refreshCalendar, refreshOpinions, refreshSignals]);

  useEffect(() => {
    if (!pageNeedsBootstrap(page) || bootstrap || bootstrapLoading) return;
    void refreshBootstrap();
  }, [bootstrap, bootstrapLoading, page, refreshBootstrap]);

  useEffect(() => {
    if (!pageNeedsOpinions(page) || opinionsLoaded || opinionsLoading) return;
    void refreshOpinions();
  }, [opinionsLoaded, opinionsLoading, page, refreshOpinions]);

  useEffect(() => {
    if (!pageNeedsCalendar(page) || calendarLoaded || calendarLoading) return;
    void refreshCalendar();
  }, [calendarLoaded, calendarLoading, page, refreshCalendar]);

  useEffect(() => {
    if (!pageNeedsSignals(page) || signalsLoaded || signalsLoading) return;
    void refreshSignals();
  }, [page, refreshSignals, signalsLoaded, signalsLoading]);

  useEffect(() => {
    const onPopState = () => {
      const route = readRouteState();
      setPage(route.page);
      setSelectedOpinion(route.opinionId);
      setSelectedSymbol(route.symbol);
      setSelectedCourse(route.courseId);
      setSelectedSymbolSource("stocks");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigatePage = useCallback((nextPage: PageKey) => {
    if (!requireLogin()) return;
    setPage(nextPage);
    setSelectedOpinion("");
    setSelectedSymbol("");
    setSelectedCourse("");
    setSelectedSymbolSource("stocks");
    pushRouteState({ page: nextPage });
    if (pageNeedsBootstrap(nextPage)) void refreshBootstrap();
    if (pageNeedsOpinions(nextPage)) void refreshOpinions();
    if (pageNeedsCalendar(nextPage)) void refreshCalendar();
    if (pageNeedsSignals(nextPage)) void refreshSignals();
  }, [refreshBootstrap, refreshCalendar, refreshOpinions, refreshSignals, requireLogin]);

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

  const selectSymbol = useCallback((symbol: string, source: "stocks" | "tracking" | "search" = "stocks") => {
    if (!requireLogin()) return;
    const nextSymbol = symbol.trim().toUpperCase();
    setSelectedSymbol(nextSymbol);
    setSelectedSymbolSource(source);
    setPage("stocks");
    pushRouteState({ page: "stocks", symbol: nextSymbol });
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
    pushRouteState({ page: "stocks", symbol: nextSymbol });
  };

  const trackingRows = useMemo(() => mergedTrackingRows(bootstrap, signalStates), [bootstrap, signalStates]);
  const latestOpinion = opinions[0];
  const selected = opinions.find((item) => item.id === selectedOpinion) || latestOpinion;
  const gatedRule = page === "opinions" || page === "tracking" ? undefined : pageAccessRules[page];
  const pageUnlocked = hasPageAccess(auth, page);
  const onboardingOpen = Boolean(
    auth?.authenticated &&
    auth.user?.role === "user" &&
    !auth.user?.onboardingSeenAt
  );
  const opinionsLocked = page === "opinions" && !pageUnlocked;
  const homeOpinionsLocked = !hasPageAccess(auth, "opinions");
  const homeTrackingLocked = !hasPageAccess(auth, "tracking");
  const activeNavPage = page === "stocks" && selectedSymbolSource === "tracking" ? "tracking" : page;
  const gateGuestClick = useCallback((event: MouseEvent<HTMLElement>) => {
    if (auth?.authenticated) return;
    const target = event.target as HTMLElement | null;
    if (!target || target.closest(".authOverlay, .accountButton")) return;
    const interactive = target.closest("button, a, input, select, textarea, tr, [role='button']");
    if (!interactive) return;
    event.preventDefault();
    event.stopPropagation();
    openAuth("register");
  }, [auth?.authenticated, openAuth]);
  const pageDataLoading =
    page !== "home" && (
      (pageNeedsBootstrap(page) && !bootstrap) ||
      (pageNeedsOpinions(page) && !opinionsLoaded) ||
      (pageNeedsCalendar(page) && !calendarLoaded) ||
      (pageNeedsSignals(page) && !signalsLoaded)
    );

  return (
    <main className="terminalShell" onClickCapture={gateGuestClick}>
      <aside className="sideRail">
        <a className="brand" href="/">
          <img src="/assets/dongbimao-logo.png" alt="" width="38" height="38" />
          <span>
            <strong>懂币猫</strong>
            <small>美股投研</small>
          </span>
        </a>
        <nav>
          {navItems.map((item) => (
            <div key={item.key}>
              <button
                className={`${activeNavPage === item.key ? "active" : ""} ${item.disabled ? "disabled" : ""}`}
                disabled={item.disabled}
                onClick={() => navigatePage(item.key)}
              >
                <span>{item.label}</span>
                {item.status ? <em>{item.status}</em> : null}
              </button>
            </div>
          ))}
        </nav>
        <div className="navToolGroup">
          <p className="navGroupTitle">会员工具</p>
          {memberToolNavItems.map((item) => (
            <button key={item.key} className={activeNavPage === item.key ? "active" : ""} onClick={() => navigatePage(item.key)}>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        {auth?.entitlements?.admin ? (
          <div className="navToolGroup">
            <p className="navGroupTitle">工具数据</p>
            {toolDataPageNavItems.map((item) => (
              <button key={item.key} className={activeNavPage === item.key ? "active" : ""} onClick={() => navigatePage(item.key)}>
                <span>{item.label}</span>
              </button>
            ))}
            {toolDataNavItems.map((item) => (
              <a key={item.href} href={item.href}>{item.label}</a>
            ))}
          </div>
        ) : null}
        <div className="sideSlogan" aria-label="品牌标语">
          <strong>市场永远不缺机会，缺的是等到机会时还活着的本金。</strong>
          <span>The market never runs out of opportunities.</span>
        </div>
      </aside>

      <section className="workspace">
        <header className={`topbar ${page === "home" ? "homeTopbar" : ""} ${page === "calendar" ? "calendarTopbar" : ""}`}>
          {page !== "calendar" ? (
            <form className="globalSearch" onSubmit={submitGlobalSearch}>
              <input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="搜索股票、观点、财报、页面" />
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
                onPage={navigatePage}
                locked={opinionsLocked}
                authenticated={Boolean(auth?.authenticated)}
                onAuth={openAuth}
                onUnlock={requestUnlock}
              />
            ) : null}
            {page === "tracking" ? <TrackingPage rows={trackingRows} asOf={bootstrap?.strength?.asOf || bootstrap?.meta?.generatedAt} locked={!pageUnlocked} authenticated={Boolean(auth?.authenticated)} onAuth={openAuth} onUnlock={requestUnlock} onOpenStock={selectSymbol} /> : null}
            {page === "market" ? <MarketPage bootstrap={bootstrap} onPage={navigatePage} /> : null}
            {page === "stocks" && selectedSymbolSource === "tracking" ? <TrackingStockDetailPage symbol={selectedSymbol} rows={trackingRows} onBack={() => navigatePage("tracking")} onStocks={() => navigatePage("stocks")} onOpenStock={selectSymbol} /> : null}
            {page === "stocks" && selectedSymbolSource !== "tracking" ? <StocksPage selectedSymbol={selectedSymbol} signalStates={signalStates} onSelectSymbol={selectSymbol} /> : null}
            {page === "calendar" ? <CalendarPage initialEvents={calendar} /> : null}
            {page === "open" ? <OpenPortfolioPage /> : null}
            {page === "position" ? <PositionSizingPage /> : null}
            {page === "funding" ? <FundingArbitragePage isAdmin={Boolean(auth?.entitlements?.admin)} /> : null}
            {page === "forum" ? <ComingSoonPage title="论坛讨论区" /> : null}
            {page === "courses" ? <CoursesPage courseId={selectedCourse} onCourse={selectCourse} onBack={clearCourse} onUnlock={requestUnlock} /> : null}
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
          onDone={() => refreshAuth().finally(() => setAuthModalOpen(false))}
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
  return (
    <div className="gatedPage">
      <div className="gatedPreview" aria-hidden="true">{children}</div>
	      <section className="membershipGate" aria-live="polite">
	        <span aria-hidden="true" />
	        <strong>开通查看完整内容</strong>
	        <button type="button" onClick={() => authenticated ? onUnlock() : onAuth("register")}>
	          {authenticated ? "联系管理员开通" : "注册后开通"}
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
  const [submitting, setSubmitting] = useState(false);
  if (!open) return null;
  const isRegister = mode === "register";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
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
          setError((payload as { message?: string }).message || "如果邮箱存在，我们会发送重置链接。");
          return;
        }
        if (isReset) {
          onResetDone();
          setError("密码已重置，请登录");
          onMode("login");
          return;
        }
        onDone();
      })
      .catch((err) => setError(err?.message || (isRegister ? "注册失败" : isReset ? "重置失败" : isForgot ? "发送失败" : "登录失败")))
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
  const opinionRows = opinions.filter(isHomepageOpinion);
  const latest = opinionRows.find((item) => item.featured) || opinionRows.find((item) => (item.summary || item.body || "").length > 40) || opinionRows[0];
  const focusRows = trackingRows.filter((row) => row.oneMonth !== "--").slice(0, 4);
  const sectorRows = getSectorRows(bootstrap)
    .filter((row) => isDisplaySector(row.sector))
    .slice(0, 4);
  const stockRows = (bootstrap?.movers?.boards?.day?.rows || [])
    .filter((row) => row.symbol)
    .sort((a, b) => Number(b.change ?? b.changeYtd ?? -Infinity) - Number(a.change ?? a.changeYtd ?? -Infinity))
    .slice(0, 4);
  const eventRows = [...calendar]
    .sort((a, b) => {
      const aHigh = a.impact === "high" ? 0 : 1;
      const bHigh = b.impact === "high" ? 0 : 1;
      const dateCompare = String(a.date || "").localeCompare(String(b.date || ""));
      return dateCompare || aHigh - bHigh || String(a.time || "").localeCompare(String(b.time || ""));
    })
    .slice(0, 3);
  return (
    <div className="frontHomePage">
      <section className="frontHomeBoard">
        <article className="frontLeadPanel">
          <span>最新观点</span>
          <h1>{latest?.title || "美股热点风向标"}</h1>
          <div className={opinionsLocked ? "frontLeadPreview locked" : "frontLeadPreview"}>
            <p>{latest?.summary || compactText(latest?.body, 110) || "--"}</p>
            {opinionsLocked ? <span className="frontInlineLock" aria-label="会员内容"><i aria-hidden="true" /></span> : null}
          </div>
          <div className="frontLeadActions">
            <button type="button" onClick={() => onPage("opinions")}>进入美股热点风向标</button>
          </div>
        </article>

        <aside className="frontQuickPanel">
          <div className="frontPanelHead">
            <strong>美股重点财经前瞻</strong>
            <button type="button" onClick={() => onPage("calendar")}>查看日历</button>
          </div>
          {eventRows.map((item) => (
            <button type="button" key={item.id} className={`frontCalendarEvent ${item.impact === "high" ? "highImpact" : ""}`} onClick={() => onPage("calendar")}>
              <span>{dayDistanceLabel(item.date)} {calendarTime24(item.time)}</span>
              <strong>{calendarTitle(item.title)}</strong>
              <small>{(item.relatedAssets || []).slice(0, 3).join(" / ") || eventTypeLabel(item.type)}</small>
              <em className={impactClass(item.impact)}>{impactLabel(item.impact)}</em>
            </button>
          ))}
        </aside>
      </section>

      <section className="frontHomeStrengthPanel">
        <div className="frontPanelHead">
          <strong>股票机会跟踪榜单</strong>
          <button type="button" onClick={() => onPage("tracking")}>查看机会</button>
        </div>
        <div className={trackingLocked ? "frontHomeLockedTable" : ""}>
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
              </tr>
            </thead>
            <tbody>
              {focusRows.map((row) => (
                <tr key={row.symbol} onClick={() => !trackingLocked && onPage("tracking")}>
                  <td>
                    {trackingLocked ? (
                      <MaskedValue value={`${row.symbol} ${row.name && row.name !== row.symbol ? row.name : trackingSymbolNames[row.symbol] || row.name || row.symbol}`} />
                    ) : (
                      <>
                        <strong>{row.symbol}</strong>
                        <span>{row.name && row.name !== row.symbol ? row.name : trackingSymbolNames[row.symbol] || row.name || row.symbol}</span>
                      </>
                    )}
                  </td>
                  <td>{priceDisplay(row.currentPrice)}</td>
                  <td className={signedClass(row.oneDay)}>{signed(row.oneDay)}</td>
                  <td className={signedClass(row.oneWeek)}>{signed(row.oneWeek)}</td>
                  <td className={signedClass(row.oneMonth)}>{signed(row.oneMonth)}</td>
                  <td>{isBlankValue(row.liquidity) ? "--" : row.liquidity}</td>
                  <td>
                    <SignalDirectionBadge label={trackingDirection(row)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {trackingLocked ? (
            <button type="button" className="frontHomeTableLock" onClick={() => authenticated ? onUnlock() : onAuth("register")}>
              <i aria-hidden="true" />
              <span>开通查看股票机会跟踪榜单</span>
            </button>
          ) : null}
        </div>
      </section>

      <section className="frontHomeBottomGrid">
        <article className="frontMiniPanel">
          <div className="frontPanelHead">
            <strong>热门股票板块</strong>
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
            <strong>股票库精选</strong>
            <button type="button" onClick={() => onPage("stocks")}>打开股票库</button>
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
  onPage,
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
  onPage: (page: PageKey) => void;
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
            {!loading && !displayRows.length ? <div className="opinionLoading">--</div> : null}
            {!loading ? displayRows.map((item) => (
              <button type="button" key={item.id} onClick={() => onSelect(item)}>
                <p className="opinionProductMeta"><time>{formatOpinionTime(item.tradeDate)}</time><b>{opinionSectionLabel(item)}</b></p>
                <div>
                  <strong>{opinionDisplayTitle(item)}</strong>
                  <div className={locked ? "opinionLockedExcerpt opinionListPreview" : "opinionListPreview"}>
                    <p>{compactText(item.summary || item.body, 96)}</p>
                    {locked ? <span className="opinionInlineLock" aria-label="会员内容"><i aria-hidden="true" /></span> : null}
                  </div>
                  <div className="opinionProductTags compact">
                    {[...(item.symbols || []), ...(item.topics || [])].slice(0, 5).map((tag) => <b key={tag}>{tag}</b>)}
                  </div>
                </div>
              </button>
            )) : null}
            <div className="opinionPager">
              <button type="button" disabled={pageIndex <= 0 || loading} onClick={() => setPageIndex((value) => Math.max(0, value - 1))}>上一页</button>
              <span>{pageIndex + 1} / {pageCount}</span>
              <button type="button" disabled={pageIndex >= pageCount - 1 || loading} onClick={() => setPageIndex((value) => Math.min(pageCount - 1, value + 1))}>下一页</button>
            </div>
          </article>

        </section>
      </div>
    );
  }

  return (
    <div className="opinionReaderPage">
      <article className="readerPanel articleReaderPanel">
        <div className="readerTop">
          <button type="button" onClick={onBack}>返回美股热点风向标</button>
          <button type="button" onClick={() => onPage("home")}>返回首页</button>
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
                <button type="button" className="readerLockPanel" onClick={() => authenticated ? onUnlock() : onAuth("register")}>
                  <i aria-hidden="true" />
                  <strong>开通查看完整内容</strong>
                </button>
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
  onOpenStock: (symbol: string, source?: "stocks" | "tracking" | "search") => void;
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
      {label}<span>{sortKey === key ? (sortDir === "asc" ? "↑" : "↓") : ""}</span>
    </button>
  );
  const visibleRows = useMemo(() => {
    return rows
      .filter((row) => row.oneMonth !== "--" || row.volume !== "--" || row.marketCap !== "--")
      .sort((a, b) => compareTrackingRows(a, b, sortKey, sortDir));
  }, [rows, sortDir, sortKey]);
  const pagedRows = visibleRows.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize);
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / pageSize));

  return (
    <div className="trackingPage">
      <section className="screenerCard">
        <div className="trackingAddStrip">
          <span>本次新增</span>
          <div>
            {trackingAddedSymbols.map((symbol) => (
              locked ? <LockedStockName key={symbol} symbol={symbol} name={trackingSymbolNames[symbol] || symbol} /> : <b key={symbol}>{symbol}</b>
            ))}
          </div>
          <time>更新 {formatStoredDateTime(asOf)}</time>
        </div>
        <div className={locked ? "screenerTableWrap trackingLockedTable" : "screenerTableWrap"}>
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
                <th>{sortHeader("marketCap", "市值")}</th>
                <th>{sortHeader("signal", "趋势策略方向")}</th>
                <th>{sortHeader("signalFirstSeen", "信号时间")}</th>
                <th>操作</th>
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
                    <td>{marketCapDisplay(row)}</td>
                    <td><SignalDirectionBadge label={directionLabel} /></td>
                    <td>{row.signalFirstSeen ? formatStoredDateTime(row.signalFirstSeen) : "未发出"}</td>
                    <td>
                      <button
                        type="button"
                        className="screenerLink"
                        onClick={() => {
                          if (!locked) {
                            onOpenStock(row.symbol, "tracking");
                            return;
                          }
                          if (authenticated) {
                            onUnlock();
                            return;
                          }
                          onAuth("register");
                        }}
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
        <div className="pager">
          <button disabled={pageIndex <= 0} onClick={() => setPageIndex((value) => Math.max(0, value - 1))}>上一页</button>
          <span>第 {pageIndex + 1} 页</span>
          <button disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((value) => Math.min(pageCount - 1, value + 1))}>下一页</button>
        </div>
      </section>
    </div>
  );
}

function TrackingStockDetailPage({
  symbol,
  rows,
  onBack,
  onStocks,
  onOpenStock
}: {
  symbol: string;
  rows: ReturnType<typeof mergedTrackingRows>;
  onBack: () => void;
  onStocks: () => void;
  onOpenStock: (symbol: string, source?: "stocks" | "tracking" | "search") => void;
}) {
  const [detail, setDetail] = useState<SymbolDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const activeSymbol = symbol || rows[0]?.symbol || "";
  const row = rows.find((item) => item.symbol === activeSymbol) || rows[0] || null;
  const profile = detail?.profile;
  const displayName = profile?.company || profile?.chineseName || row?.name || row?.symbol || "--";
  const direction = trackingDirection(row || undefined);
  const sameList = rows
    .filter((item) => item.symbol !== activeSymbol)
    .slice(0, 5);
  const rankBy = (score: (item: typeof rows[number]) => number) => {
    const ranked = rows
      .map((item) => ({ symbol: item.symbol, value: score(item) }))
      .filter((item) => Number.isFinite(item.value))
      .sort((a, b) => b.value - a.value);
    const index = ranked.findIndex((item) => item.symbol === activeSymbol);
    return index >= 0 ? index + 1 : null;
  };
  const rankRows: Array<[string, string | null | undefined, number | null]> = [
    ["近1月强度", row?.oneMonth, rankBy((item) => numericPercent(item.oneMonth))],
    ["近1周表现", row?.oneWeek, rankBy((item) => numericPercent(item.oneWeek))],
    ["成交额", row?.liquidity, rankBy((item) => moneyNumber(item.liquidity))]
  ];

  useEffect(() => {
    if (!activeSymbol) return;
    let cancelled = false;
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
  }, [activeSymbol]);

  if (!row && loading) return <div className="trackingStockDetailPage"><div className="loading" /></div>;
  if (!row) return <div className="trackingStockDetailPage"><div className="loading">--</div></div>;

  return (
    <div className="trackingStockDetailPage">
      <section className="trackingStockHero">
        <button type="button" className="detailBackLink" onClick={onBack}>返回股票机会跟踪榜单</button>
        <div className="trackingStockHead">
          <div>
            <h1>{row.symbol}</h1>
            <p>{displayName}</p>
          </div>
          <div className="trackingStockBadges">
            <SignalDirectionBadge label={direction} />
            <span>信号发出 {row.signalFirstSeen ? formatStoredDateTime(row.signalFirstSeen) : "未发出"}</span>
          </div>
        </div>
        <div className="trackingStockMetrics">
          <div><span>近1天</span><strong className={signedClass(row.oneDay)}>{signed(row.oneDay)}</strong></div>
          <div><span>近1周</span><strong className={signedClass(row.oneWeek)}>{signed(row.oneWeek)}</strong></div>
          <div><span>近1月</span><strong className={signedClass(row.oneMonth)}>{signed(row.oneMonth)}</strong></div>
          <div><span>成交额</span><strong>{row.liquidity || compactMoney(profile?.dollarVolume)}</strong></div>
          <div><span>市值</span><strong>{marketCapDisplay(profile || row)}</strong></div>
        </div>
        <div className="trackingStockActions">
          <button type="button" onClick={onStocks}>查看股票库</button>
        </div>
      </section>

      <div className="trackingStockGrid">
        <section className="trackingStockPanel">
          <h2>榜单位置</h2>
          <table>
            <thead><tr><th>维度</th><th>位置</th><th>当前值</th></tr></thead>
            <tbody>
              {rankRows.map(([label, value, rank]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td><b>{rank ? `第 ${rank}` : "--"}</b><span><i style={{ width: `${rank ? Math.max(10, 100 - (rank - 1) * 6) : 0}%` }} /></span></td>
                  <td className={label === "成交额" ? "" : signedClass(value)}>{label === "成交额" ? value || "--" : signed(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="trackingStockPanel">
          <h2>同榜对比</h2>
          <div className="trackingPeerList">
            {sameList.map((item) => (
                <button type="button" key={item.symbol} onClick={() => onOpenStock(item.symbol, "tracking")}>
                <strong>{item.symbol}</strong>
                <small>{item.name && item.name !== item.symbol ? item.name : trackingSymbolNames[item.symbol] || item.symbol}</small>
                <span className={signedClass(item.oneMonth)}>{signed(item.oneMonth)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function MarketPage({ bootstrap, onPage }: { bootstrap: BootstrapPayload | null; onPage: (page: PageKey) => void }) {
  const [sectorRange, setSectorRange] = useState<"day" | "week" | "month">("day");
  const [sectorPayload, setSectorPayload] = useState<SectorFlowPayload | null>(null);
  const [sectorLoading, setSectorLoading] = useState(false);
  const activeSectorPayload = sectorPayload?.board === sectorRange ? sectorPayload : null;
  const sectors = useMemo(() => {
    const rows = activeSectorPayload?.rows?.length
      ? activeSectorPayload.rows
      : sectorRange === "day" && !sectorPayload
        ? getSectorRows(bootstrap)
        : [];
    return rows.filter((item) => isDisplaySector(item.sector));
  }, [activeSectorPayload, bootstrap, sectorPayload, sectorRange]);
  const [viewMode, setViewMode] = useState<"rank" | "map">("rank");
  const [selectedSector, setSelectedSector] = useState(sectors[0]?.sector || "");
  useEffect(() => {
    let alive = true;
    setSectorPayload(null);
    setSelectedSector("");
    setSectorLoading(true);
    api.sectors({ board: sectorRange, limit: 30 })
      .then((payload) => {
        if (alive) setSectorPayload(payload);
      })
      .catch(() => {
        if (alive) setSectorPayload(null);
      })
      .finally(() => {
        if (alive) setSectorLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sectorRange]);
  useEffect(() => {
    if (!sectors.length) return;
    if (!selectedSector || !sectors.some((item) => item.sector === selectedSector)) {
      setSelectedSector(sectors[0].sector);
    }
  }, [sectors, selectedSector]);
  const selected = sectors.find((item) => item.sector === selectedSector) || sectors[0];
  const volumeRows = (bootstrap?.movers?.boards?.volume?.rows || []).slice(0, 8);
  const sectorDate = formatStoredDateTime(activeSectorPayload?.asOf || (sectorRange === "day" ? bootstrap?.movers?.updatedAt || bootstrap?.sectorFlow?.asOf : ""));
  const sectorChange = (sector?: typeof sectors[number]) => Number(sector?.avgChangePct ?? sector?.avgChange ?? 0);
  const sectorFlowTone = (sector?: typeof sectors[number]) => sectorChange(sector) >= 0 ? "up" : "down";
  const heatTiles = useMemo(() => {
    const values = sectors.map((sector) => ({
      value: Math.max(1, Math.abs(Number(sector.netFlowProxy || 0)) || Number(sector.activeValue || 0))
    }));
    const max = Math.max(1, ...values.map((item) => item.value));
    const rects = treemapRects(values);
    return sectors.map((sector, index) => {
      const rect = rects[index] || { x: 0, y: 0, w: 100, h: 100 };
      const ratio = values[index].value / max;
      const area = rect.w * rect.h;
      const style: CSSProperties = {
        left: `calc(${rect.x}% + 3px)`,
        top: `calc(${rect.y}% + 3px)`,
        width: `calc(${rect.w}% - 6px)`,
        height: `calc(${rect.h}% - 6px)`
      };
      return {
        sector,
        style,
        sizeClass: area > 1500 ? "heatLarge" : area > 650 ? "heatMedium" : "heatSmall",
        strengthClass: ratio > 0.58 || Math.abs(sectorChange(sector)) >= 2 ? "heatStrong" : ratio > 0.25 || Math.abs(sectorChange(sector)) >= 0.8 ? "heatMid" : "heatSoft"
      };
    });
  }, [sectors]);
  return (
    <div className="marketPage">
      <div className="marketToolbar">
        <div className="marketSegment">
          <button type="button" className={viewMode === "rank" ? "active" : ""} onClick={() => setViewMode("rank")}>排行</button>
          <button type="button" className={viewMode === "map" ? "active" : ""} onClick={() => setViewMode("map")}>热力图</button>
        </div>
        <div className="marketSegment">
          <button type="button" className={sectorRange === "day" ? "active" : ""} onClick={() => setSectorRange("day")}>当日</button>
          <button type="button" className={sectorRange === "week" ? "active" : ""} onClick={() => setSectorRange("week")}>近1周</button>
          <button type="button" className={sectorRange === "month" ? "active" : ""} onClick={() => setSectorRange("month")}>近1月</button>
        </div>
        <span className="marketDate">{sectorDate}</span>
      </div>

      <section className="marketFundsWorkspace benchmark">
        <div className="marketFundsBoard benchmark">
          <div className="marketFundsMain">
            <div className="marketPanelHead"><strong>板块</strong></div>
            {viewMode === "rank" ? (
              <div className="marketSectorTable benchmark">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>板块</th>
                    <th>资金方向</th>
                    <th>上涨广度</th>
                    <th>成交活跃</th>
                    <th>均涨跌</th>
                    <th>代表标的</th>
                  </tr>
                </thead>
                <tbody>
                  {sectors.map((sector, index) => (
                    <tr
                      key={sector.sector}
                      className={sector.sector === selected?.sector ? "selectedRow" : ""}
                      onClick={() => setSelectedSector(sector.sector)}
                    >
                      <td>{String(index + 1).padStart(2, "0")}</td>
                      <td><strong>{sector.sector}</strong></td>
                      <td className={signedClass(sector.netFlowProxy)}>{money(sector.netFlowProxy)}</td>
                      <td>
                        {Number.isFinite(sector.breadthPct) ? `${sector.upCount || 0}涨 / ${sector.downCount || 0}跌` : "--"}
                        <i><b style={{ width: `${Math.max(8, Math.min(100, Number(sector.breadthPct) || 0))}%` }} /></i>
                      </td>
                      <td>{sector.activeValueLabel || compactMoney(sector.activeValue)}</td>
                      <td className={signedClass(sectorChange(sector))}>{signed(sectorChange(sector))}</td>
                      <td>{(sector.leaders || []).slice(0, 4).map((leader) => leader.symbol).join(" / ") || "--"}</td>
                    </tr>
                  ))}
                  {!sectors.length ? <tr><td colSpan={7}>{sectorLoading ? "加载中" : "--"}</td></tr> : null}
                </tbody>
              </table>
              </div>
            ) : (
              <div className="marketSectorHeatmap">
                {heatTiles.map((tile) => {
                  const { sector } = tile;
                  const leaders = (sector.leaders || []).slice(0, 3).map((leader) => leader.symbol).join(" / ");
                  return (
                    <button
                      type="button"
                      key={sector.sector}
                      className={`${sectorFlowTone(sector)} ${tile.sizeClass} ${tile.strengthClass} ${sector.sector === selected?.sector ? "selected" : ""}`}
                      style={tile.style}
                      aria-label={`${sector.sector} ${signed(sectorChange(sector))} ${money(sector.netFlowProxy)}`}
                      onClick={() => setSelectedSector(sector.sector)}
                    >
                      <strong>{sector.sector}</strong>
                      <em>{signed(sectorChange(sector))}</em>
                      {tile.sizeClass !== "heatSmall" ? <span>{money(sector.netFlowProxy)}</span> : null}
                      {tile.sizeClass === "heatLarge" ? <small>{leaders}</small> : null}
                    </button>
                  );
                })}
                {!sectors.length ? <div className="marketEmpty">{sectorLoading ? "加载中" : "--"}</div> : null}
              </div>
            )}
          </div>
          <aside className="marketFundsSide">
            {selected ? (
              <>
                <section>
                  <div className="marketPanelHead"><strong>{selected.sector}</strong></div>
                  <div className="marketSectorFacts">
                    <article><span>资金方向</span><strong className={signedClass(selected.netFlowProxy)}>{money(selected.netFlowProxy)}</strong></article>
                    <article><span>均涨跌</span><strong className={signedClass(sectorChange(selected))}>{signed(sectorChange(selected))}</strong></article>
                    <article><span>上涨广度</span><strong>{`${selected.upCount || 0}涨 / ${selected.downCount || 0}跌`}</strong></article>
                    <article><span>成交活跃</span><strong>{selected.activeValueLabel || compactMoney(selected.activeValue)}</strong></article>
                  </div>
                </section>
                <section>
                  <div className="marketPanelHead"><strong>前排标的</strong></div>
                  <div className="marketLeaderList">
                    {(selected.leaders || []).slice(0, 5).map((leader) => (
                      <button key={leader.symbol} type="button" onClick={() => onPage("stocks")}>
                        <b>{leader.symbol}</b>
                        <span>{leader.name || "--"}</span>
                        <small>{leader.liquidity || "--"}</small>
                        <em className={signedClass(leader.changePct ?? leader.change)}>{signed(leader.changePct ?? leader.change)}</em>
                      </button>
                    ))}
                  </div>
                </section>
              </>
            ) : <section><div className="marketEmpty">{sectorLoading ? "加载中" : "--"}</div></section>}
          </aside>
        </div>
      </section>

      <section className="marketVolumePanel">
        <div className="marketPanelHead"><strong>成交异动</strong></div>
        <table>
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
      </section>
    </div>
  );
}

function StocksPage({
  selectedSymbol,
  signalStates,
  onSelectSymbol
}: {
  selectedSymbol: string;
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
  const [error, setError] = useState("");
  const [sectorOptions, setSectorOptions] = useState<Array<{ sector: string; count: number }>>([]);
  const [detail, setDetail] = useState<SymbolDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const selectedRow = rows.find((row) => row.symbol === selectedSymbol) || null;
  const activeRow = selectedRow || rows[0] || null;
  const activeSymbol = activeRow?.symbol || "";
  const mostActive = useMemo(() => [...rows].sort((a, b) => Number(b.dollarVolume || 0) - Number(a.dollarVolume || 0))[0], [rows]);
  const strongestMonth = useMemo(() => [...rows].sort((a, b) => Number(b.monthChange || -Infinity) - Number(a.monthChange || -Infinity))[0], [rows]);
  const signalMap = useMemo(() => new Map(signalStates.map((item) => [item.symbol, item])), [signalStates]);
  const firstSignal = useMemo(() => signalStates.find((signal) => rows.some((row) => row.symbol === signal.symbol)), [rows, signalStates]);
  const firstEvent = useMemo(() => rows.find((row) => row.hasEvent || row.eventLabel), [rows]);
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

  useEffect(() => {
    api.symbolMeta()
      .then((payload) => setSectorOptions(payload.sectors || []))
      .catch(() => setSectorOptions([]));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoadingRows(true);
      setError("");
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
          setRows(payload.rows || []);
          setTotal(payload.total || 0);
        })
        .catch((err) => setError(err?.message || "股票库加载失败"))
        .finally(() => setLoadingRows(false));
    }, query.trim() ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [cap, pageIndex, preset, query, sector, sort, sortDir]);

  useEffect(() => {
    setPageIndex(0);
  }, [cap, preset, query, sector, sort, sortDir]);

  useEffect(() => {
    if (!activeSymbol) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    api.symbolDetail(activeSymbol)
      .then((payload) => setDetail(payload))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [activeSymbol]);

  return (
    <div className="stocksPage">
      <section className="stocksTerminalLayout">
        <div className="screenerCard stocksScreenerCard">
        <div className="stocksSignalStrip">
          <button type="button" disabled={!mostActive} onClick={() => mostActive && onSelectSymbol(mostActive.symbol)}>
            <span>成交最活跃</span>
            <strong>{mostActive ? `${mostActive.symbol} · ${compactMoney(mostActive.dollarVolume)}` : "--"}</strong>
          </button>
          <button type="button" disabled={!strongestMonth} onClick={() => strongestMonth && onSelectSymbol(strongestMonth.symbol)}>
            <span>近1月最强</span>
            <strong className={signedClass(strongestMonth?.monthChange)}>{strongestMonth ? `${strongestMonth.symbol} ${signed(strongestMonth.monthChange)}` : "--"}</strong>
          </button>
          <button type="button" disabled={!firstSignal} onClick={() => firstSignal && onSelectSymbol(firstSignal.symbol)}>
            <span>趋势信号</span>
            <strong className={trackingDirectionClass(trackingDirection({ signalDirection: firstSignal?.direction, signalDirectionText: firstSignal?.directionText }))}>
              {firstSignal ? `${firstSignal.symbol} ${trackingDirection({ signalDirection: firstSignal.direction, signalDirectionText: firstSignal.directionText })}` : "--"}
            </strong>
          </button>
          <button type="button" disabled={!firstEvent} onClick={() => firstEvent && onSelectSymbol(firstEvent.symbol)}>
            <span>最近事件</span>
            <strong>{firstEvent ? `${firstEvent.symbol} ${firstEvent.eventLabel || "事件"}` : "--"}</strong>
          </button>
        </div>
        <div className="screenerTabs">
          {[
            ["all", "全部"],
            ["liquid", "高成交"],
            ["strength", "强趋势"],
            ["event", "有事件"],
            ["etf", "ETF"]
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={preset === value ? "active" : ""}
              onClick={() => setPreset(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="stocksToolbar">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索代码 / 公司" />
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
            <option value="symbol">按代码</option>
          </select>
        </div>

        <article className="stocksTablePanel">
          {error ? <div className="tableError">{error}</div> : null}
          <div className="screenerTableWrap">
            <table className="screenerTable stocksListTable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{stockSortHeader("symbol", "股票")}</th>
                  <th>板块</th>
                  <th>{stockSortHeader("dayChange", "近1天")}</th>
                  <th>{stockSortHeader("weekChange", "近1周")}</th>
                  <th>{stockSortHeader("monthChange", "近1月")}</th>
                  <th>{stockSortHeader("dollarVolume", "成交")}</th>
                  <th>{stockSortHeader("marketCap", "市值")}</th>
                  <th>趋势策略方向</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const signal = signalMap.get(row.symbol);
                  const direction = trackingDirection({ signalDirection: signal?.direction, signalDirectionText: signal?.directionText });
                  return (
                    <tr key={row.symbol} className={row.symbol === activeSymbol ? "selectedRow" : ""} onClick={() => onSelectSymbol(row.symbol)}>
                      <td>{pageIndex * pageSize + index + 1}</td>
                      <td><strong>{row.symbol}</strong><span>{stockCompany(row)}</span></td>
                      <td>{row.sector || "--"}</td>
                      <td className={signedClass(row.dayChange)}>{signed(row.dayChange)}</td>
                      <td className={signedClass(row.weekChange)}>{signed(row.weekChange)}</td>
                      <td className={signedClass(row.monthChange)}>{signed(row.monthChange)}</td>
                      <td>{compactMoney(row.dollarVolume)}<span>{ratioDisplay(row.volumeRatio)}</span></td>
                      <td>{marketCapDisplay(row)}</td>
                      <td><SignalDirectionBadge label={direction} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button disabled={pageIndex <= 0 || loadingRows} onClick={() => setPageIndex((value) => Math.max(0, value - 1))}>上一页</button>
            <span>第 {pageIndex + 1} 页</span>
            <button disabled={pageIndex >= pageCount - 1 || loadingRows} onClick={() => setPageIndex((value) => Math.min(pageCount - 1, value + 1))}>下一页</button>
          </div>
        </article>
        </div>
        <StockPreviewPanel row={activeRow} detail={detail} loading={detailLoading} signal={signalForSymbol(signalStates, activeSymbol)} />
      </section>
    </div>
  );
}

function StockPreviewPanel({ row, detail, loading, signal }: { row: SymbolRow | null; detail: SymbolDetailPayload | null; loading: boolean; signal: SignalState | null }) {
  const profile = detail?.profile || row;
  const marketRows = detail?.marketRows || [];
  const peers = detail?.peers || [];
  const events = detail?.events || [];
  const dayRow = marketRows.find((item) => item.board === "day");
  const weekRow = marketRows.find((item) => item.board === "week");
  const monthRow = marketRows.find((item) => item.board === "month");
  const ytdRow = marketRows.find((item) => item.board === "ytd");
  const dayChange = dayRow?.changePct ?? dayRow?.change ?? row?.dayChange;
  const weekChange = weekRow?.changePct ?? weekRow?.change ?? row?.weekChange;
  const monthChange = monthRow?.changePct ?? monthRow?.change ?? row?.monthChange;
  const ytdChange = ytdRow?.changePct ?? ytdRow?.change ?? row?.ytdChange;
  const dollarVolume = profile?.dollarVolume ?? marketRows.find((item) => item.dollarVolume)?.dollarVolume;
  const volumeRatio = profile?.volumeRatio ?? marketRows.find((item) => item.volumeRatio)?.volumeRatio;
  const signalLabel = trackingDirection({ signalDirection: signal?.direction, signalDirectionText: signal?.directionText });

  if (loading && !profile) {
    return <aside className="stocksPreviewPanel"><section className="stockPreviewCard"><div className="loading" /></section></aside>;
  }

  if (!profile) {
    return <aside className="stocksPreviewPanel"><section className="stockPreviewCard"><div className="loading">--</div></section></aside>;
  }

  return (
    <aside className="stocksPreviewPanel">
      <section className="stockPreviewCard profile">
        <div className="stockPreviewTop">
          <div>
            <span>{profile.sector || "--"}</span>
            <h2>{profile.symbol}</h2>
            <p>{stockCompany(profile)}</p>
          </div>
          <div>
            <strong>{Number.isFinite(Number(profile.price)) ? `$${Number(profile.price).toFixed(2)}` : "--"}</strong>
            <em className={signedClass(dayChange)}>{signed(dayChange)}</em>
          </div>
        </div>
        <dl className="stockPreviewMetrics">
          <div><dt>市值</dt><dd>{marketCapDisplay(profile)}</dd></div>
          <div><dt>成交额</dt><dd>{compactMoney(dollarVolume)}</dd></div>
          <div><dt><VolumeRatioLabel /></dt><dd>{ratioDisplay(volumeRatio)}</dd></div>
          <div><dt>趋势信号</dt><dd><SignalDirectionBadge label={signalLabel} /></dd></div>
        </dl>
      </section>

      <section className="stockPreviewCard">
        <h3>区间表现</h3>
        {[
          ["1天", dayChange],
          ["1周", weekChange],
          ["1月", monthChange],
          ["今年", ytdChange]
        ].map(([label, value]) => (
          <div className="previewBarRow" key={label}>
            <span>{label}</span>
            <div><b style={{ width: `${barWidth(value as number | string | null, 120)}%` }} /></div>
            <strong className={signedClass(value as number | string | null)}>{signed(value as number | string | null)}</strong>
          </div>
        ))}
      </section>

      <section className="stockPreviewCard">
        <h3>近期事件</h3>
        {events.slice(0, 2).map((event) => (
          <div className="previewFact" key={`${event.eventDate}-${event.eventLabel}`}>
            <span>{formatStoredDateTime(event.eventDate)}</span>
            <strong>{event.eventLabel || event.eventType || "--"}</strong>
          </div>
        ))}
        {!events.length ? <div className="previewFact"><span>--</span><strong>--</strong></div> : null}
      </section>

      <section className="stockPreviewCard">
        <h3>同板块</h3>
        <table className="previewPeerTable">
          <thead><tr><th>股票</th><th>市值</th><th>成交额</th></tr></thead>
          <tbody>
            {peers.slice(0, 4).map((peer) => (
              <tr key={peer.symbol}>
                <td>{peer.symbol}</td>
                <td>{marketCapDisplay(peer)}</td>
                <td>{compactMoney(peer.dollarVolume)}</td>
              </tr>
            ))}
            {!peers.length ? <tr><td colSpan={3}>--</td></tr> : null}
          </tbody>
        </table>
      </section>
    </aside>
  );
}

function CalendarPage({ initialEvents }: { initialEvents: CalendarEvent[] }) {
  const pageSize = 30;
  const [windowDays, setWindowDays] = useState("7");
  const [impact, setImpact] = useState("all");
  const [pageIndex, setPageIndex] = useState(0);
  const [macroRows, setMacroRows] = useState<CalendarEvent[]>(initialEvents.filter((event) => event.type === "macro"));
  const [earningsRows, setEarningsRows] = useState<CalendarEvent[]>(initialEvents.filter((event) => event.type === "earnings"));
  const [total, setTotal] = useState(initialEvents.filter((event) => event.type === "earnings").length);
  const [macroLoading, setMacroLoading] = useState(false);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setPageIndex(0);
  }, [impact, windowDays]);

  useEffect(() => {
    let cancelled = false;
    setMacroLoading(true);
    api.calendar({
      limit: 50,
      windowDays,
      impact,
      type: "macro"
    }).then((payload) => {
      if (!cancelled) setMacroRows(payload.rows || []);
    }).finally(() => {
      if (!cancelled) setMacroLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [impact, windowDays]);

  useEffect(() => {
    let cancelled = false;
    setEarningsLoading(true);
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
    }).finally(() => {
      if (!cancelled) setEarningsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [impact, pageIndex, windowDays]);

	  return (
	    <div className="calendarPage calendarV3">
	      <section className="calendarWorkbench">
	        <div className="calendarFilters">
          <div className="calendarWindowTabs">
            {[
              ["7", "未来7天"],
              ["30", "未来30天"],
              ["45", "未来45天"]
            ].map(([value, label]) => (
              <button key={value} type="button" className={windowDays === value ? "active" : ""} onClick={() => setWindowDays(value)}>
                {label}
              </button>
            ))}
          </div>
          <select value={impact} onChange={(event) => setImpact(event.target.value)}>
            <option value="all">全部影响</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
        </div>
        <section className="calendarBlock">
          <div className="calendarBlockHead">
            <h2>宏观重点</h2>
            <span>优先看利率、通胀、就业</span>
          </div>
          <MacroEventsTable rows={macroRows} loading={macroLoading} />
        </section>
        <section className="calendarBlock">
          <div className="calendarBlockHead">
            <h2>财报日历</h2>
            <span>按日期分组展示</span>
          </div>
          <EarningsEventsTable rows={earningsRows} loading={earningsLoading} />
          <div className="calendarPager">
            <span>第 {pageIndex + 1} 页</span>
            <div>
              <button type="button" disabled={pageIndex <= 0 || earningsLoading} onClick={() => setPageIndex((page) => Math.max(0, page - 1))}>上一页</button>
              <button type="button" disabled={pageIndex >= pageCount - 1 || earningsLoading} onClick={() => setPageIndex((page) => Math.min(pageCount - 1, page + 1))}>下一页</button>
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}

function MacroEventsTable({ rows, loading }: { rows: CalendarEvent[]; loading: boolean }) {
  return (
    <section className="calendarMacroPanel">
      {rows.map((event) => (
        <article className={event.impact === "high" ? "highImpact" : ""} key={event.id}>
          <div className="calendarMacroDate">
            <strong>{formatDate(event.date).slice(5)}</strong>
            <span>{weekdayLabel(event.date)}</span>
          </div>
          <span className="calendarTimeCell">{calendarTime24(event.time)}</span>
          <div className="calendarEventCell">
            <strong>{calendarTitle(event.title)}</strong>
          </div>
          <span className="calendarTextCell calendarDataCell">{calendarDataText(event) || calendarSummaryText(event) || "--"}</span>
          <span className={impactClass(event.impact)}>{impactLabel(event.impact)}</span>
        </article>
      ))}
      {!loading && rows.length === 0 ? <div className="calendarEmpty">--</div> : null}
      {loading && rows.length === 0 ? <div className="calendarEmpty" /> : null}
    </section>
  );
}

function EarningsEventsTable({ rows, loading }: { rows: CalendarEvent[]; loading: boolean }) {
  return (
    <section className="calendarTablePanel">
      <div className="calendarTableHead">
        <span>时间</span>
        <span>事件</span>
        <span>类型</span>
        <span>公司/财期</span>
        <span>数据</span>
        <span>影响</span>
      </div>
      <div className="calendarTableBody">
        {rows.map((event, index) => {
          const dataText = calendarDataText(event) || calendarSummaryText(event) || "--";
          const subtext = calendarEventSubtext(event);
          const showDate = formatDate(event.date) !== formatDate(rows[index - 1]?.date);
          const rowClassName = [
            event.impact === "high" ? "highImpact" : "",
            event.type === "macro" ? "macroEvent" : ""
          ].filter(Boolean).join(" ");
          return (
            <Fragment key={event.id}>
              {showDate ? <div className="calendarDateDivider">{formatDate(event.date).slice(5)} <span>{weekdayLabel(event.date)}</span></div> : null}
              <article className={rowClassName} key={event.id}>
                <span className="calendarTimeCell">{calendarTime24(event.time)}</span>
                <div className="calendarEventCell">
                  <strong>{calendarTitle(event.title)}</strong>
                </div>
                <span className="calendarType">{eventTypeLabel(event.type)}</span>
                <div className="calendarEventCell">
                  {subtext ? <small>{subtext}</small> : null}
                </div>
                <span className="calendarTextCell calendarDataCell">{dataText}</span>
                <span className={impactClass(event.impact)}>{impactLabel(event.impact)}</span>
              </article>
            </Fragment>
          );
        })}
        {!loading && rows.length === 0 ? <div className="calendarEmpty">--</div> : null}
        {loading && rows.length === 0 ? <div className="calendarEmpty" /> : null}
      </div>
    </section>
  );
}

type PositionHistoryItem = {
  id: string;
  symbol: string;
  direction: PositionDirection;
  shares: number;
  entryPrice: number;
  stopPrice: number;
  actualRisk: number;
  positionAmount: number;
  createdAt: string;
};

const positionHistoryKey = "dongbimao_position_sizing_history_v1";

function PositionSizingPage() {
  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<PositionDirection>("long");
  const [accountSize, setAccountSize] = useState("100,000");
  const [riskAmount, setRiskAmount] = useState("1,000");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [latestPrice, setLatestPrice] = useState("");
  const [priceStatus, setPriceStatus] = useState("");
  const [formError, setFormError] = useState("");
  const [history, setHistory] = useState<PositionHistoryItem[]>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(positionHistoryKey) || "[]").slice(0, 5);
    } catch {
      return [];
    }
  });
  const normalizedSymbol = symbol.trim().toUpperCase();
  const hasCoreInput = accountSize.trim() && riskAmount.trim() && entryPrice.trim() && stopPrice.trim();
  const calculation = useMemo<{ result: PositionSizingResult | null; error: string }>(() => {
    if (!hasCoreInput) return { result: null, error: "" };
    try {
      return {
        result: calculatePositionSizing({
          direction,
          accountSize: inputMoneyNumber(accountSize),
          riskAmount: inputMoneyNumber(riskAmount),
          entryPrice: inputMoneyNumber(entryPrice),
          stopPrice: inputMoneyNumber(stopPrice),
          latestPrice: latestPrice.trim() ? inputMoneyNumber(latestPrice) : null
        }),
        error: ""
      };
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : "请检查输入。" };
    }
  }, [accountSize, direction, entryPrice, hasCoreInput, latestPrice, riskAmount, stopPrice]);
  const result = calculation.result;

  useEffect(() => {
    if (!normalizedSymbol) {
      setPriceStatus("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPriceStatus("读取中");
      api.symbolDetail(normalizedSymbol)
        .then((payload) => {
          if (cancelled) return;
          const price = moneyNumber(payload.profile?.price);
          if (price > 0) {
            setLatestPrice(String(price));
            setPriceStatus(`最新价 ${exactMoney(price)}`);
          } else {
            setPriceStatus("未找到最新价");
          }
        })
        .catch(() => {
          if (!cancelled) setPriceStatus("未找到最新价");
        });
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [normalizedSymbol]);

  function applyRiskPreset(percent: number) {
    const account = inputMoneyNumber(accountSize);
    if (!Number.isFinite(account) || account <= 0) {
      setFormError("请先填写账户资金。");
      return;
    }
    setFormError("");
    setRiskAmount((account * percent / 100).toLocaleString("en-US", {
      maximumFractionDigits: 2
  }));
}

  function saveCalculation(event: FormEvent) {
    event.preventDefault();
    if (!result) {
      setFormError(calculation.error || "请先填写买入价和止损价。");
      return;
    }
    const item: PositionHistoryItem = {
      id: String(Date.now()),
      symbol: normalizedSymbol || "--",
      direction,
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
  }

  return (
    <div className="positionSizingPage">
      <section className="positionSizingHero">
        <div>
          <span>会员工具</span>
          <h1>以损定仓</h1>
          <p>先定能亏多少，再算该买多少。</p>
        </div>
        <strong>{result ? `${result.shares.toLocaleString("en-US")} 股` : "--"}</strong>
      </section>

      <section className="positionSizingGrid">
        <form className="positionSizingPanel positionSizingForm" onSubmit={saveCalculation}>
          <div className="panelHead">
            <strong>输入</strong>
            <span>{priceStatus}</span>
          </div>
          <div className="positionFieldGrid">
            <label>
              <span>标的</span>
              <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="例如 NVDA" />
            </label>
            <label>
              <span>账户资金</span>
              <input inputMode="decimal" value={accountSize} onChange={(event) => setAccountSize(event.target.value)} placeholder="例如 100,000" />
            </label>
            <label>
              <span>单笔最大亏损</span>
              <input inputMode="decimal" value={riskAmount} onChange={(event) => setRiskAmount(event.target.value)} placeholder="例如 1,000" />
            </label>
            <label>
              <span>最新价</span>
              <input inputMode="decimal" value={latestPrice} onChange={(event) => setLatestPrice(event.target.value)} placeholder="可自动读取，也可手动填" />
            </label>
          </div>

          <div className="positionSegment">
            <button type="button" className={`long ${direction === "long" ? "active" : ""}`} onClick={() => setDirection("long")}>做多</button>
            <button type="button" className={`short ${direction === "short" ? "active" : ""}`} onClick={() => setDirection("short")}>做空</button>
          </div>

          <div className="positionFieldGrid two">
            <label>
              <span>{direction === "long" ? "买入价" : "卖出价"}</span>
              <input inputMode="decimal" value={entryPrice} onChange={(event) => setEntryPrice(event.target.value)} placeholder="例如 100.00" />
            </label>
            <label>
              <span>止损价</span>
              <input inputMode="decimal" value={stopPrice} onChange={(event) => setStopPrice(event.target.value)} placeholder={direction === "long" ? "低于买入价" : "高于卖出价"} />
            </label>
          </div>

          <div className="positionPresetRow">
            {[0.5, 1, 2].map((percent) => (
              <button type="button" key={percent} onClick={() => applyRiskPreset(percent)}>{percent}%</button>
            ))}
          </div>

          {calculation.error || formError ? <p className="positionError">{formError || calculation.error}</p> : null}
          <button className="positionPrimaryButton" type="submit">保存本次计算</button>
        </form>

        <aside className="positionSizingPanel positionResultPanel">
          <div className="panelHead">
            <strong>结果</strong>
            <span>{direction === "long" ? "做多" : "做空"}</span>
          </div>
          <div className="positionResultHero">
            <span>建议股数</span>
            <strong>{result ? result.shares.toLocaleString("en-US") : "--"}</strong>
            <em>{result ? `实际风险 ${exactMoney(result.actualRisk)}` : "填入价格后计算"}</em>
          </div>
          <div className="positionMetricGrid">
            <div><span>仓位金额</span><strong>{exactMoney(result?.positionAmount)}</strong></div>
            <div><span>账户风险</span><strong>{exactPercent(result?.riskPct)}</strong></div>
            <div><span>单股风险</span><strong>{exactMoney(result?.perShareRisk)}</strong></div>
            <div><span>止损距离</span><strong>{exactPercent(result?.stopDistancePct)}</strong></div>
            <div><span>盈亏平衡</span><strong>{exactMoney(result?.breakevenPrice)}</strong></div>
            <div><span>1R / 2R</span><strong>{result ? `${exactMoney(result.oneRPrice)} / ${exactMoney(result.twoRPrice)}` : "--"}</strong></div>
          </div>
          <div className="positionLivePnl">
            <span>按最新价</span>
            <strong className={signedClass(result?.latestPnl ?? undefined)}>{signedExactMoney(result?.latestPnl)}</strong>
          </div>
        </aside>
      </section>

      <section className="positionSizingPanel positionHistoryPanel">
        <div className="panelHead">
          <strong>最近计算</strong>
          <span>{history.length ? `${history.length} 条` : ""}</span>
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
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id}>
                  <td>{item.createdAt}</td>
                  <td><strong>{item.symbol}</strong></td>
                  <td>{item.direction === "long" ? "做多" : "做空"}</td>
                  <td>{item.shares.toLocaleString("en-US")}</td>
                  <td>{exactMoney(item.entryPrice)} / {exactMoney(item.stopPrice)}</td>
                  <td>{exactMoney(item.actualRisk)}</td>
                  <td>{exactMoney(item.positionAmount)}</td>
                </tr>
              ))}
              {!history.length ? <tr><td colSpan={7}>--</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
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

function OpenPortfolioPage() {
  const [data, setData] = useState<OpenPortfolioPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
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
    setLoading(true);
    api.openPortfolio()
      .then((payload) => {
        setData(payload);
        setError("");
        setHistoryPage(1);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "读取失败"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="openPortfolioPage">
      {error ? <p className="openNotice">{error}</p> : null}
      {loading ? <p className="openNotice">读取中</p> : null}

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
                  <em>{exactPercent(row.share)}</em>
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
              <th>备注</th>
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

function CoursesPage({ courseId, onCourse, onBack, onUnlock }: { courseId: string; onCourse: (courseId: string) => void; onBack: () => void; onUnlock: () => void }) {
  const [series, setSeries] = useState<CourseSeries[]>([]);
  const [activeLessonId, setActiveLessonId] = useState<number | null>(null);
  const [courseTab, setCourseTab] = useState<"all" | "unlocked" | "locked">("all");
  const [courseQuery, setCourseQuery] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const selected = courseId ? series.find((item) => String(item.id) === courseId || item.slug === courseId) || null : null;
  const activeLesson = selected?.unlocked ? selected.lessons.find((lesson) => lesson.id === activeLessonId) || selected.lessons[0] || null : null;
  const filteredSeries = useMemo(() => {
    const query = courseQuery.trim().toLowerCase();
    return series.filter((item) => {
      if (courseTab === "unlocked" && !item.unlocked) return false;
      if (courseTab === "locked" && item.unlocked) return false;
      if (!query) return true;
      return `${item.title} ${item.summary} ${item.intro}`.toLowerCase().includes(query);
    });
  }, [courseQuery, courseTab, series]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.courses()
      .then((payload) => {
        if (cancelled) return;
        const rows = payload.series || [];
        setSeries(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "交易实战课程加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function playLesson(lessonId: number) {
    setPlaying(true);
    setError("");
    try {
      const payload = await api.coursePlayUrl(lessonId);
      setActiveLessonId(lessonId);
      setVideoUrl(payload.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "播放失败");
    } finally {
      setPlaying(false);
    }
  }

  function submitCourseSearch(event: FormEvent) {
    event.preventDefault();
  }

  useEffect(() => {
    setVideoUrl("");
    setError("");
    setActiveLessonId(selected?.unlocked ? selected.lessons?.[0]?.id || null : null);
  }, [selected?.id, selected?.unlocked, selected?.lessons]);

  if (loading) return <div className="coursesPage"><div className="loading" /></div>;

  if (courseId) {
    if (!selected) {
      return (
        <div className="coursesPage">
          <button type="button" className="courseBackButton" onClick={onBack}>返回交易实战课程</button>
          <section className="coursesEmpty">交易实战课程不存在</section>
        </div>
      );
    }

    const courseIntro = selected.intro || selected.summary;

    return (
      <div className="coursesPage">
        <section className="courseDetailHero">
          <button type="button" className="courseBackButton" onClick={onBack}>返回交易实战课程</button>
          <div className="courseDetailCover">
            {selected.coverUrl ? <img src={selected.coverUrl} alt="" /> : null}
          </div>
          <div className="courseDetailText">
            <h1>{selected.title}</h1>
            <div className="courseSummaryRich articleProse">
              {richCourseSummary(selected.summary, `${selected.lessonCount || selected.lessons?.length || 0} 节视频`)}
            </div>
            {courseDiscountBlock(selected, "courseDiscountBlock detailDiscount")}
            <div className="courseMetaPills">
              <span className={selected.unlocked ? "unlocked" : "locked"}>{selected.unlocked ? "已解锁" : "待开通"}</span>
              <span>{courseProgressLabel(selected.progressStatus)}</span>
              <span>{selected.lessonCount || selected.lessons?.length || 0} 节视频</span>
              {activeLesson ? <span>当前播放：{activeLesson.title}</span> : null}
            </div>
          </div>
        </section>

        {selected.unlocked ? (
          <section className="coursePlayLayout">
            <article className="coursePlayer">
              <div className="coursePlayerTop">
                <strong>{activeLesson?.title || selected.title}</strong>
                <span>{selected.title}</span>
              </div>
              <div className="courseVideoBox">
                {videoUrl ? (
                  <video key={videoUrl} src={videoUrl} controls controlsList="nodownload" />
                ) : (
                  <button type="button" disabled={!activeLesson || playing} onClick={() => activeLesson && playLesson(activeLesson.id)}>
                    <span />
                  </button>
                )}
              </div>
            </article>

            <aside className="courseLessonList">
              <div className="panelHead">
                <strong>交易实战课程目录</strong>
                <span>{selected.lessons?.length || 0} 节</span>
              </div>
              {(selected.lessons || []).map((lesson, index) => (
                <button key={lesson.id} type="button" className={activeLesson?.id === lesson.id ? "active" : ""} onClick={() => playLesson(lesson.id)}>
                  <b>{index + 1}</b>
                  <span className="lessonCoverSlot">{lesson.coverUrl ? <img src={lesson.coverUrl} alt="" /> : null}</span>
                  <span><strong>{lesson.title}</strong>{lesson.durationLabel ? <em>{lesson.durationLabel}</em> : null}</span>
                  <i>{activeLesson?.id === lesson.id && videoUrl ? "播放中" : "播放"}</i>
                </button>
              ))}
            </aside>
          </section>
        ) : (
          <section className="courseLockedDetail">
            <h2>{selected.title}</h2>
            <div className="courseSummaryRich articleProse">
              {richCourseSummary(courseIntro, "交易实战课程暂未开通权限。")}
            </div>
            <button type="button" onClick={onUnlock}>联系开通</button>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="coursesPage">
      <section className="coursesTopbar">
        <div>
          <h1>交易实战课程</h1>
        </div>
        <form className="courseSearch" onSubmit={submitCourseSearch}>
          <input value={courseQuery} onChange={(event) => setCourseQuery(event.target.value)} placeholder="搜索交易实战课程" />
        </form>
      </section>

      {error ? <p className="courseError">{error}</p> : null}
      {!series.length ? <section className="coursesEmpty">暂无交易实战课程</section> : null}

      {series.length ? (
        <>
          <section className="courseToolbar">
            <div>
              <button type="button" className={courseTab === "all" ? "active" : ""} onClick={() => setCourseTab("all")}>全部</button>
              <button type="button" className={courseTab === "unlocked" ? "active" : ""} onClick={() => setCourseTab("unlocked")}>已解锁</button>
              <button type="button" className={courseTab === "locked" ? "active" : ""} onClick={() => setCourseTab("locked")}>待开通</button>
            </div>
            <span>{filteredSeries.length} 个系列</span>
          </section>

          <section className="courseCardGrid">
            {filteredSeries.map((item) => (
              <article key={item.id} className={selected?.id === item.id ? "active" : ""}>
                <div className="courseThumb">
                  {item.coverUrl ? <img src={item.coverUrl} alt="" /> : null}
                  <span className={item.progressStatus === "finished" ? "unlocked" : "locked"}>{courseProgressLabel(item.progressStatus)}</span>
                </div>
                <section>
                  <h2>{item.title}</h2>
                  <p>{compactText(item.summary, 82) || `${item.lessons?.length || 0} 节视频`}</p>
                  {courseDiscountBlock(item)}
                  <div><span>{item.lessonCount || item.lessons?.length || 0} 节视频 ·</span><span>{item.unlocked ? "可学习" : "交易实战课程介绍"}</span></div>
                  <footer>
                    <button type="button" className={item.unlocked ? "primary" : ""} onClick={() => onCourse(String(item.id))}>
                      {item.unlocked ? "开始学习" : "查看详情"}
                    </button>
                    <em>{item.unlocked ? "已授权" : "联系开通"}</em>
                  </footer>
                </section>
              </article>
            ))}
            {!filteredSeries.length ? <div className="coursesEmpty">暂无匹配交易实战课程</div> : null}
          </section>
        </>
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
      .catch((err) => setError(err?.message || "扫描失败"))
      .finally(() => setLoading(false));
  }, [isAdmin, scannerQuery]);

  useEffect(() => {
    if (loadedOnce) return;
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
    return <ComingSoonPage title="无权限" />;
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
                <tr><td colSpan={12} className="fundingScannerEmpty">没有符合条件的结果</td></tr>
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

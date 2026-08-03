export type AuthStatus = {
  authenticated: boolean;
  user: null | {
    id: number;
    uid?: string;
    email: string;
    role: string;
    plan?: string;
    subscriptionExpiresAt?: string | null;
    onboardingSeenAt?: string | null;
  };
  entitlements?: {
    paid: boolean;
    pro: boolean;
    proPlus: boolean;
    admin: boolean;
    yearly?: boolean;
  };
};

export type KeyLevel = {
  center?: number | null;
  lower?: number | null;
  upper?: number | null;
  strength?: "strong" | "medium" | "weak" | "converting" | string;
  strengthText?: string;
  touches?: number;
  basis?: string;
  lastConfirmedAt?: string;
};

export type TrackingKeyLevels = {
  status?: "ready" | "insufficient" | "unavailable" | string;
  asOf?: string;
  availableBars?: number;
  requiredBars?: number;
  currentPrice?: number | null;
  support?: KeyLevel | null;
  secondarySupport?: KeyLevel | null;
  resistance?: KeyLevel | null;
  position?: string;
  positionText?: string;
  supportDistancePct?: number | null;
  resistanceDistancePct?: number | null;
  atr14?: number | null;
  atrPct?: number | null;
  ma20?: number | null;
  ma60?: number | null;
  trend?: string;
  trendText?: string;
};

export type PriceHistoryPoint = {
  date: string;
  close: number;
};

export type MarketRow = {
  rank?: number;
  symbol: string;
  tradeDate?: string;
  company?: string;
  chineseName?: string;
  sector?: string;
  price?: number | string;
  change?: number;
  changeYtd?: number;
  volumeRatio?: string | number;
  dollarVolume?: number;
  marketCap?: string;
  marketCapValue?: number;
  keyLevels?: TrackingKeyLevels;
  priceHistory?: PriceHistoryPoint[];
};

export type StrengthRow = {
  rank?: number;
  symbol: string;
  name?: string;
  sector?: string;
  sectorProxy?: string;
  price?: number | string | null;
  marketCap?: string;
  liquidity?: string;
  label?: string;
  action?: string;
  primaryFactor?: string;
  periods?: Record<string, string>;
  score?: number;
  relative?: { spy?: string; qqq?: string; sector?: string };
  crowding?: { score?: number; volumeRatio?: string | number };
  onBoard?: {
    label?: string;
    firstSeen?: string;
    days?: number;
    streak?: number;
    totalDays?: number;
  };
};

export type TemperatureIndicator = {
  key: string;
  name: string;
  value?: string;
  previous?: string;
  change?: string;
  level?: string;
  status?: "positive" | "neutral" | "watch" | string;
  impact?: string;
  explain?: string;
  asOf?: string;
};

export type MarketTemperaturePayload = {
  asOf?: string;
  overall?: { score?: number | null; label?: string; summary?: string; action?: string };
  indicators?: TemperatureIndicator[];
};

export type MacroSeriesIndicator = TemperatureIndicator & {
  current?: number;
  unit?: string;
  points?: Array<{ date: string; value: number }>;
};

export type MacroSeriesPayload = {
  asOf?: string;
  indicators?: MacroSeriesIndicator[];
};

export type StrengthTheme = {
  name?: string;
  return20d?: string;
  vsMarket?: string;
  symbols?: string;
};

export type StrengthScannerPayload = {
  asOf?: string;
  summary?: {
    hotCrowdingCount?: number;
    leader?: string;
    leaderScore?: number;
    medianScore?: number;
    weakest?: string;
    weakestScore?: number;
  };
  themes?: { leaders?: StrengthTheme[]; risk?: StrengthTheme[]; hot?: StrengthTheme[] };
  counts?: { all?: number; watch?: number; hot?: number; neutral?: number; avoid?: number };
  sectors?: string[];
  rows?: StrengthRow[];
  total?: number;
  limit?: number;
  offset?: number;
  bucket?: "all" | "watch" | "hot" | "neutral" | "avoid";
};

export type BootstrapPayload = {
  meta: {
    generatedAt?: string;
    counts?: Record<string, number>;
  };
  ytd: { updatedAt?: string; rows: MarketRow[] };
  movers: {
    updatedAt?: string;
    boards: Record<string, { rows: MarketRow[] }>;
  };
  strength?: { asOf?: string; rows?: StrengthRow[] };
  sectorFlow?: {
    asOf?: string;
    rows?: Array<{
      sector: string;
      status?: string;
      rank?: number;
      count?: number;
      upCount?: number;
      downCount?: number;
      breadthPct?: number;
      netFlowProxy?: number;
      netFlowLabel?: string;
      activeValue?: number;
      activeValueLabel?: string;
      avgChange?: number;
      avgChangePct?: number;
      leaders?: Array<{ symbol: string; change?: number; changePct?: number; liquidity?: string; name?: string }>;
    }>;
    sectors?: Array<{
      sector: string;
      status?: string;
      rank?: number;
      count?: number;
      upCount?: number;
      downCount?: number;
      breadthPct?: number;
      netFlowProxy?: number;
      netFlowLabel?: string;
      activeValue?: number;
      activeValueLabel?: string;
      avgChange?: number;
      avgChangePct?: number;
      leaders?: Array<{ symbol: string; change?: number; changePct?: number; liquidity?: string; name?: string }>;
    }>;
  };
};

export type Opinion = {
  id: string;
  section: string;
  sectionLabel: string;
  title: string;
  tradeDate: string;
  status: "published" | "draft";
  featured?: boolean;
  summary?: string;
  symbols?: string[];
  topics?: string[];
  highlights?: string[];
  body?: string;
};

export type OpinionPayload = {
  rows: Opinion[];
  total?: number;
  limit?: number;
  offset?: number;
  section?: string;
};

export type CalendarEvent = {
  id: string;
  date: string;
  time?: string;
  title: string;
  type?: string;
  impact?: "high" | "medium" | "low";
  sourceName?: string;
  actualValue?: number | null;
  actualLabel?: string | null;
  forecastValue?: number | null;
  forecastLabel?: string | null;
  previousValue?: number | null;
  previousLabel?: string | null;
  resultUpdatedAt?: string | null;
  relatedModules?: string[];
  relatedAssets?: string[];
  summary?: string;
};

export type CalendarPayload = {
  rows: CalendarEvent[];
  total: number;
  limit: number;
  offset: number;
};

export type SymbolRow = {
  symbol: string;
  company?: string;
  chineseName?: string;
  sector?: string;
  marketCap?: string;
  marketCapValue?: number | null;
  price?: number | string | null;
  dollarVolume?: number | null;
  volumeRatio?: number | string | null;
  updatedAt?: string;
  dayChange?: number | null;
  weekChange?: number | null;
  monthChange?: number | null;
  ytdChange?: number | null;
  eventLabel?: string | null;
  eventDate?: string | null;
  hasEvent?: boolean;
  strengthLabel?: string | null;
  strengthScore?: number | null;
};

export type SymbolSearchPayload = {
  rows: SymbolRow[];
  total: number;
  limit: number;
  offset: number;
  sort: string;
  dir?: string;
};

export type SymbolMetaPayload = {
  total: number;
  sectors: Array<{ sector: string; count: number }>;
};

export type MarketBoardRow = {
  board: string;
  rank?: number;
  symbol: string;
  tradeDate?: string;
  company?: string;
  chineseName?: string;
  sector?: string | null;
  price?: number | null;
  changePct?: number | null;
  change?: number | null;
  changeYtd?: number | null;
  volume?: string | null;
  dollarVolume?: number | null;
  volumeRatio?: number | null;
  marketCap?: string | null;
  keyLevels?: TrackingKeyLevels;
  priceHistory?: PriceHistoryPoint[];
};

export type MarketBoardPayload = {
  board: string;
  rows: MarketBoardRow[];
  total: number;
  limit: number;
  offset: number;
};

export type SectorFlowPayload = {
  rows: NonNullable<BootstrapPayload["sectorFlow"]>["sectors"];
  total: number;
  limit: number;
  offset: number;
  asOf?: string;
  board?: string;
};

export type CryptoEtfAsset = {
  latestDate: string;
  latestFlowUsd: number;
  flow5dUsd: number;
  flow21dUsd: number;
  history: Array<{ date: string; flowUsd: number }>;
};

export type CryptoEtfFlowPayload = {
  asOf: string;
  generatedAt?: string;
  source?: { name?: string; url?: string; providerUpdatedAt?: string };
  assets: { BTC: CryptoEtfAsset; ETH: CryptoEtfAsset };
  history: Array<{
    date: string;
    btcFlowUsd: number | null;
    ethFlowUsd: number | null;
    totalFlowUsd: number;
  }>;
};

export type StockEventRow = {
  board?: string;
  rank?: number;
  symbol: string;
  companyName?: string;
  eventDate?: string;
  eventType?: string;
  eventLabel?: string;
  reason?: string;
  risk?: string;
  signalScore?: number | null;
  return20dPct?: number | null;
};

export type EarningsRow = {
  board?: string;
  rank?: number;
  symbol: string;
  companyName?: string;
  score?: number | null;
  qualityScore?: number | null;
  confluenceScore?: number | null;
  userAngle?: string | null;
  userReason?: string | null;
  userRisk?: string | null;
  return20dPct?: number | null;
  latestEarningsDate?: string | null;
  latestGuidanceDate?: string | null;
};

export type StockStrength = {
  rank?: number;
  symbol: string;
  company?: string;
  sector?: string;
  price?: number | null;
  score?: number | null;
  label?: string | null;
  action?: string | null;
  primaryFactor?: string | null;
  liquidity?: string | null;
  marketCap?: string | null;
  periods?: Record<string, string>;
  relative?: Record<string, string>;
};

export type SymbolDetailPayload = {
  profile: SymbolRow;
  marketRows: MarketBoardRow[];
  peers: SymbolRow[];
  events: StockEventRow[];
  earnings: EarningsRow[];
  strength?: StockStrength | null;
};

export type SignalState = {
  symbol: string;
  direction?: string | null;
  directionText?: string | null;
  price?: string | null;
  livePrice?: string | null;
  firstSignalAt?: string | null;
  signalAge?: string | null;
  updatedAt?: string | null;
};

export type SignalPayload = {
  states: SignalState[];
};

export type CourseLesson = {
  id: number;
  seriesId: number;
  title: string;
  sortOrder: number;
  durationLabel: string;
  coverUrl: string;
  videoStatus: "processing" | "ready" | "failed";
  status: "published" | "draft";
};

export type CourseSeries = {
  id: number;
  slug: string;
  title: string;
  summary: string;
  intro: string;
  progressStatus: "updating" | "finished";
  originalPrice: string;
  discountPrice: string;
  discountLabel: string;
  coverUrl: string;
  coverCardUrl: string;
  sortOrder: number;
  status: "published" | "draft";
  unlocked?: boolean;
  grantExpiresAt?: string | null;
  lessonCount: number;
  grantCount: number;
  lessons: CourseLesson[];
};

export type FundingScannerRow = {
  exchange: "binance" | "bitget" | string;
  ticker: string;
  spot_symbol: string;
  perp_symbol: string;
  spot_mid?: number | null;
  perp_mid?: number | null;
  basis_bps?: number | null;
  funding_rate?: number | null;
  funding_income_usdt?: number | null;
  fee_usdt?: number | null;
  slippage_usdt?: number | null;
  safety_buffer_usdt?: number | null;
  expected_net_usdt?: number | null;
  next_funding_time?: string | null;
  minutes_to_funding?: number | null;
  depth_ok?: boolean | null;
  signal: "ENTER" | "WAIT" | string;
  reason: string;
};

export type FundingScannerPayload = {
  updated_at: string;
  params: Record<string, number>;
  rows: FundingScannerRow[];
  stale?: boolean;
  sort?: string;
  max_pairs?: number;
};

export type FundingScannerQuery = {
  notional_usdt: number;
  safety_buffer_usdt: number;
  max_basis_bps: number;
  min_expected_net_usdt: number;
  binance_spot_fee_bps: number;
  binance_perp_fee_bps: number;
  bitget_spot_fee_bps: number;
  bitget_perp_fee_bps: number;
  exchange: string;
  cached?: boolean;
};

export type OpenPortfolioTrade = {
  id: number;
  tradeTime: string;
  symbol: string;
  side: "buy" | "sell";
  price: number;
  positionPct: number;
  amount: number;
  quantity: number;
  quantityStep: number;
  realizedPnl: number;
  equityAfter: number;
  note?: string;
};

export type OpenPortfolioPayload = {
  initialCapital: number;
  equity: number;
  availableCash: number;
  realizedPnl: number;
  realizedReturnPct: number;
  holdings: Array<{
    symbol: string;
    quantity: number;
    quantityStep: number;
    avgCost: number;
    cost: number;
    positionPct: number;
    sector?: string;
  }>;
  trades: OpenPortfolioTrade[];
  curve: Array<{ time: string; value: number }>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload as T;
}

export const api = {
  auth: () => request<AuthStatus>("/api/auth/status"),
  login: (email: string, password: string) =>
    request<AuthStatus>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }),
  register: (email: string, password: string) =>
    request<AuthStatus>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }),
  forgotPassword: (email: string) =>
    request<{ ok: boolean; message?: string }>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email })
    }),
  resetPassword: (token: string, password: string) =>
    request<{ ok: boolean }>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password })
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: "{}" }),
  markOnboardingSeen: () => request<AuthStatus>("/api/auth/onboarding-seen", { method: "POST", body: "{}" }),
  analyticsEvent: (eventType: string, eventKey: string, path = window.location.pathname + window.location.search) =>
    request<{ ok: boolean }>("/api/analytics/event", { method: "POST", body: JSON.stringify({ eventType, eventKey, path }) }),
  bootstrap: (limit = 500, symbols?: string[]) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (symbols?.length) params.set("symbols", symbols.join(","));
    return request<BootstrapPayload>(`/api/product/bootstrap?${params.toString()}`);
  },
  marketTemperature: () => request<MarketTemperaturePayload>("/api/product/raw/market-temperature"),
  macroSeries: () => request<MacroSeriesPayload>("/api/product/raw/macro-series"),
  cryptoEtfFlows: () => request<CryptoEtfFlowPayload>("/api/product/raw/crypto-etf-flows"),
  strengthScanner: (options?: { limit?: number; offset?: number; bucket?: string; q?: string; sector?: string; heat?: string; sort?: string }) => {
    const params = new URLSearchParams({
      limit: String(options?.limit || 20),
      offset: String(options?.offset || 0),
      bucket: options?.bucket || "watch",
      heat: options?.heat || "all",
      sort: options?.sort || "score"
    });
    if (options?.q) params.set("q", options.q);
    if (options?.sector && options.sector !== "all") params.set("sector", options.sector);
    return request<StrengthScannerPayload>(`/api/product/strength?${params.toString()}`);
  },
  opinions: (limit = 60, options?: { offset?: number; section?: string }) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (options?.offset) params.set("offset", String(options.offset));
    if (options?.section) params.set("section", options.section);
    return request<OpinionPayload>(`/api/product/opinions?${params.toString()}`);
  },
  calendar: (options?: { limit?: number; offset?: number; windowDays?: string; impact?: string; type?: string; q?: string; resultsOnly?: boolean }) => {
    const params = new URLSearchParams({
      limit: String(options?.limit || 12),
      offset: String(options?.offset || 0)
    });
    if (options?.windowDays) params.set("windowDays", options.windowDays);
    if (options?.impact && options.impact !== "all") params.set("impact", options.impact);
    if (options?.type && options.type !== "all") params.set("type", options.type);
    if (options?.q) params.set("q", options.q);
    if (options?.resultsOnly) params.set("resultsOnly", "true");
    return request<CalendarPayload>(`/api/product/calendar?${params.toString()}`);
  },
  marketBoard: (options?: { board?: string; limit?: number; offset?: number; sector?: string }) => {
    const params = new URLSearchParams({
      board: options?.board || "day",
      limit: String(options?.limit || 50),
      offset: String(options?.offset || 0)
    });
    if (options?.sector) params.set("sector", options.sector);
    return request<MarketBoardPayload>(`/api/product/market?${params.toString()}`);
  },
  sectors: (options?: { limit?: number; offset?: number; includeUnknown?: boolean; board?: string }) => {
    const params = new URLSearchParams({
      limit: String(options?.limit || 20),
      offset: String(options?.offset || 0)
    });
    if (options?.includeUnknown) params.set("includeUnknown", "true");
    if (options?.board) params.set("board", options.board);
    return request<SectorFlowPayload>(`/api/product/sectors?${params.toString()}`);
  },
  symbolMeta: () => request<SymbolMetaPayload>("/api/product/symbols/meta"),
  symbols: (params: URLSearchParams) => request<SymbolSearchPayload>(`/api/product/symbols?${params.toString()}`),
  symbolDetail: (symbol: string) => request<SymbolDetailPayload>(`/api/product/symbols/${encodeURIComponent(symbol)}`),
  signals: () => request<SignalPayload>("/api/signals"),
  openPortfolio: () => request<OpenPortfolioPayload>("/api/open-portfolio"),
  fundingScanner: (options: FundingScannerQuery) => {
    const params = new URLSearchParams();
    Object.entries(options).forEach(([key, value]) => params.set(key, String(value)));
    return request<FundingScannerPayload>(`/api/tools/funding-arbitrage?${params.toString()}`);
  },
  courses: () => request<{ series: CourseSeries[] }>("/api/courses"),
  coursePlayUrl: (lessonId: number, signal?: AbortSignal) => request<{ url: string; expiresIn: number; type: "file" | "hls" }>(
    `/api/courses/lessons/${encodeURIComponent(lessonId)}/play`,
    { signal }
  )
};

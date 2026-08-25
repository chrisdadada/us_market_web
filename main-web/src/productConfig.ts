export type PageKey = "home" | "opinions" | "tracking" | "market" | "risk" | "strength" | "valuation" | "stocks" | "calendar" | "open" | "position" | "rolling" | "watchlist" | "dca1" | "dca2" | "funding" | "forum" | "courses";
export type AccessLevel = "free" | "registered" | "monthly" | "yearly";
export type NavItem = { key: PageKey; label: string; status?: string; disabled?: boolean };

export const pageLabels: Record<PageKey, string> = {
  home: "首页",
  opinions: "猫言猫语",
  calendar: "重点财经前瞻",
  tracking: "机会跟踪榜单",
  stocks: "美股行情",
  market: "市场资金走向",
  risk: "市场活跃指数",
  strength: "行业板块强弱",
  valuation: "指数估值",
  courses: "实战课程",
  open: "Open 持仓参考",
  forum: "论坛讨论区",
  position: "以损定仓",
  rolling: "滚仓工具",
  watchlist: "自选",
  dca1: "纳指定投 1 号",
  dca2: "纳指定投 2 号",
  funding: "资金费套利扫描"
};

export const primaryNavItems: NavItem[] = [
  { key: "home", label: pageLabels.home },
  { key: "opinions", label: pageLabels.opinions },
  { key: "calendar", label: pageLabels.calendar },
  { key: "tracking", label: pageLabels.tracking },
  { key: "stocks", label: pageLabels.stocks },
  { key: "market", label: pageLabels.market },
  { key: "risk", label: pageLabels.risk },
  { key: "strength", label: pageLabels.strength },
  { key: "valuation", label: pageLabels.valuation },
  { key: "courses", label: pageLabels.courses },
  { key: "watchlist", label: pageLabels.watchlist },
  { key: "dca1", label: pageLabels.dca1 },
  { key: "dca2", label: pageLabels.dca2 }
];

export const secondaryNavItems: NavItem[] = [
  { key: "open", label: pageLabels.open },
  { key: "forum", label: pageLabels.forum, status: "待开放", disabled: true }
];

// Remove each route when its useful behavior reaches the white frontend.
export const legacyMigrationNavItems: Array<{ href: string; label: string }> = [
  { href: "/legacy/#options", label: "期权流向" },
  { href: "/legacy/#signals", label: "趋势信号" },
  { href: "/legacy/#stock-events", label: "股票事件" },
  { href: "/legacy/#earnings", label: "财报观察" }
];

export const memberToolNavItems: NavItem[] = [
  { key: "position", label: pageLabels.position },
  { key: "rolling", label: pageLabels.rolling }
];

export const toolDataPageNavItems: NavItem[] = [
  { key: "funding", label: pageLabels.funding }
];

export const allPageNavItems = [...primaryNavItems, ...secondaryNavItems, ...memberToolNavItems, ...toolDataPageNavItems];
export const validPageKeys = new Set<PageKey>(allPageNavItems.map((item) => item.key));

export const pageAccessRules: Partial<Record<PageKey, { level: AccessLevel; title: string; text: string }>> = {
  opinions: {
    level: "monthly",
    title: `会员可看完整${pageLabels.opinions}`,
    text: "免费账号可预览最新方向，完整正文、历史观点和栏目内容开通后查看。"
  },
  tracking: {
    level: "monthly",
    title: `会员可看完整${pageLabels.tracking}`,
    text: "免费账号可看到涨幅和强弱线索，标的名称开通后查看。"
  },
  market: {
    level: "monthly",
    title: `会员可看${pageLabels.market}`,
    text: "开通后查看板块排行、资金方向和热门股票板块。"
  },
  open: {
    level: "yearly",
    title: "年度会员可看 Open 持仓参考",
    text: "开通后查看完整持仓、收益分布和交割记录。"
  },
  watchlist: {
    level: "registered",
    title: "登录后使用自选",
    text: "登录后保存和同步自选股票。"
  },
  position: {
    level: "monthly",
    title: "会员可用以损定仓",
    text: "开通后按买入价、止损价和单笔最大亏损计算建议仓位。"
  },
  rolling: {
    level: "yearly",
    title: "年度会员可用滚仓工具",
    text: "开通年度会员后，可使用实时行情创建并运行滚仓计划。"
  },
  risk: {
    level: "registered",
    title: `注册后查看${pageLabels.risk}`,
    text: "登录后查看完整市场温度与指标走势。"
  },
  strength: {
    level: "monthly",
    title: `会员可看${pageLabels.strength}`,
    text: "月度和年度会员可查看完整榜单。"
  },
  valuation: {
    level: "registered",
    title: `注册后查看${pageLabels.valuation}`,
    text: "登录后查看指数估值和走势。"
  },
  courses: {
    level: "registered",
    title: `注册后查看${pageLabels.courses}`,
    text: "登录后查看课程和学习进度。"
  },
  dca1: {
    level: "monthly",
    title: "会员可看纳指定投 1 号",
    text: "开通后查看今日阶段和行动建议。"
  },
  dca2: {
    level: "monthly",
    title: "会员可看纳指定投 2 号",
    text: "开通后查看今日阶段和行动建议。"
  }
};

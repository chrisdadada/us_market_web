import { ClipboardEvent, FormEvent, ReactElement, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, AdminMetrics, AdminUser, AuthStatus, CourseGrant, CourseLesson, CourseSeries, MarketOpinion, OpenPortfolioPayload, OpenPortfolioTrade, OpinionStatus, UserEvent } from "./api";

type PageKey = "home" | "users" | "content" | "open" | "courses" | "events" | "admins";

const navItems: Array<{ key: PageKey; label: string }> = [
  { key: "home", label: "首页" },
  { key: "users", label: "用户管理" },
  { key: "content", label: "内容管理" },
  { key: "open", label: "Open 持仓" },
  { key: "courses", label: "课程管理" },
  { key: "events", label: "操作记录" },
  { key: "admins", label: "管理员" }
];

const planLabels: Record<string, string> = {
  free: "免费",
  paid: "付费",
  monthly: "月度",
  yearly: "年度"
};

const usStockCourseTitles = new Set(["美股定投课程", "美股投资框架课"]);

const roleLabels: Record<string, string> = {
  user: "普通用户",
  admin: "管理员",
  super_admin: "超级管理员"
};

const opinionSections = [
  { value: "weekly", label: "周度前瞻" },
  { value: "premarket", label: "盘前前瞻" },
  { value: "daily", label: "每日个股行情观点" },
  { value: "research", label: "研报解析" },
  { value: "postmarket", label: "盘后复盘延展" },
  { value: "journal", label: "交易日记" }
];

const newOpinionId = "__new__";
const contentPageSize = 12;
const userPageSize = 20;
const courseGrantPageSize = 12;

const eventActionOptions = [
  { value: "all", label: "全部操作" },
  { value: "self_register", label: "用户注册" },
  { value: "update_user", label: "修改用户/会员" },
  { value: "grant_course", label: "课程授权" },
  { value: "revoke_course", label: "取消课程授权" }
];

const beijingFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

function beijingParts(value?: string | null) {
  const raw = String(value || "").trim();
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return null;
  const date = new Date(raw.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(beijingFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}:${parts.second}`
  };
}

function formatTime(value?: string | null) {
  if (!value) return "--";
  const parts = beijingParts(value);
  if (parts) return `${parts.date} ${parts.time}`;
  const text = value.replace("T", " ").replace(/\.\d+Z?$/, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text} 00:00:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) return `${text}:00`;
  return text.slice(0, 19);
}

function formatDate(value?: string | null) {
  if (!value) return "--";
  const parts = beijingParts(value);
  if (parts) return parts.date;
  return String(value).slice(0, 10);
}

function adminMoney(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  return `${(Number(value) / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}万`;
}

function adminPrice(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function adminPercent(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  return `${Number(value).toFixed(2)}%`;
}

function signedMoney(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${adminMoney(Math.abs(value))}`;
}

type AdminToastPayload = { title: string; detail?: string; tone?: "success" | "error" } | null;

function AdminToast({ toast }: { toast: AdminToastPayload }) {
  if (!toast) return null;
  return (
    <div className={`adminToast ${toast.tone === "error" ? "error" : ""}`} role="status">
      <strong>{toast.title}</strong>
      {toast.detail ? <span>{toast.detail}</span> : null}
    </div>
  );
}

type AdminInlineMessagePayload = { detail: string; tone?: "success" | "error" } | null;

function AdminInlineMessage({ message }: { message: AdminInlineMessagePayload }) {
  if (!message) return null;
  return (
    <p className={`inlineMessage ${message.tone === "error" ? "error" : ""}`} role={message.tone === "error" ? "alert" : "status"}>
      {message.detail}
    </p>
  );
}

function openAvailableCashAt(data: OpenPortfolioPayload | null, tradeDate?: string) {
  if (!data) return null;
  const target = formatDate(tradeDate);
  if (!target || target === "--") return data.availableCash;
  let cash = Number(data.initialCapital || 0);
  [...data.trades]
    .sort((a, b) => formatDate(a.tradeTime).localeCompare(formatDate(b.tradeTime)) || a.id - b.id)
    .forEach((trade) => {
      if (formatDate(trade.tradeTime) > target) return;
      const amount = Number(trade.amount || 0);
      cash += trade.side === "sell" ? amount : -amount;
    });
  return cash;
}

function quantityDigits(step?: number | null) {
  if (!step || step >= 1) return 0;
  const text = String(step);
  if (text.includes("e-")) return Number(text.split("e-")[1]) || 0;
  return text.split(".")[1]?.length || 0;
}

function formatTradeQuantity(value?: number | null, step?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: quantityDigits(step)
  });
}

function floorTradeQuantity(value: number, step?: number | null) {
  const safeStep = step && step > 0 ? step : 1;
  const digits = quantityDigits(safeStep);
  return Number((Math.floor((value + Number.EPSILON) / safeStep) * safeStep).toFixed(digits));
}

function daysUntil(value?: string | null) {
  if (!value) return null;
  const end = new Date(`${String(value).slice(0, 10)}T23:59:59`);
  if (Number.isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - Date.now()) / 86400000);
}

function membershipState(user: AdminUser) {
  if (user.role !== "user") return { label: "后台账号", className: "", tone: "", detail: "--" };
  const days = daysUntil(user.subscriptionExpiresAt);
  if (!user.isActive) return { label: "已停用", className: "dangerBg", tone: "dangerText", detail: "账号不可用" };
  if (!user.hasPaidAccess) {
    if (user.subscriptionStatus === "expired") return { label: "已过期", className: "dangerBg", tone: "dangerText", detail: formatDate(user.subscriptionExpiresAt) };
    return { label: "免费", className: "", tone: "", detail: "未开通会员" };
  }
  if (days !== null && days <= 7) return { label: "即将到期", className: "warningBg", tone: "warning", detail: `${days} 天后到期` };
  return { label: planLabels[user.plan] || "付费", className: "positiveBg", tone: "positive", detail: `${formatDate(user.subscriptionExpiresAt)} 到期` };
}

function dateAfterMonths(months: number, base?: string | null) {
  const today = new Date();
  const current = base ? new Date(base) : today;
  const start = current > today ? current : today;
  start.setMonth(start.getMonth() + months);
  return start.toISOString().slice(0, 10);
}

function dateAfterDays(days: number, base?: string | null) {
  const today = new Date();
  const current = base ? new Date(base) : today;
  const start = current > today ? current : today;
  start.setDate(start.getDate() + days);
  return start.toISOString().slice(0, 10);
}

function padTimePart(value: number) {
  return String(value).padStart(2, "0");
}

function localDateTimeInputValue(value?: string | null) {
  if (value) {
    const text = formatTime(value).replace(" ", "T");
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) return text;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return `${text}:00`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00`;
  }
  const now = new Date();
  return `${now.getFullYear()}-${padTimePart(now.getMonth() + 1)}-${padTimePart(now.getDate())}T${padTimePart(now.getHours())}:${padTimePart(now.getMinutes())}:${padTimePart(now.getSeconds())}`;
}

function localDateInputValue(value?: string | null) {
  if (value) return String(value).slice(0, 10);
  const now = new Date();
  return `${now.getFullYear()}-${padTimePart(now.getMonth() + 1)}-${padTimePart(now.getDate())}`;
}

function isLocalDateInputValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(`${value}T00:00:00`);
  return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day;
}

function grantExpiryPreset(days: 30 | 180 | 365, base?: string | null) {
  return days === 365 ? dateAfterMonths(12, base) : dateAfterDays(days, base);
}

function normalizeDateTimeInput(value: string) {
  return formatTime(value.replace("T", " "));
}

function LoginScreen({ onLogin }: { onLogin: (status: AuthStatus) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const status = await api.login(email, password);
      if (status.user?.role !== "admin" && status.user?.role !== "super_admin") {
        setError("当前账号没有后台权限");
        return;
      }
      onLogin(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="loginPage">
      <form className="loginPanel" onSubmit={submit}>
        <div className="brandMark">懂</div>
        <h1>懂币猫后台</h1>
        <label>
          邮箱
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="username" />
        </label>
        <label>
          密码
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
          />
        </label>
        {error ? <p className="formError">{error}</p> : null}
        <button type="submit" disabled={loading}>{loading ? "登录中" : "登录"}</button>
      </form>
    </main>
  );
}

function StatCard({ label, value, note, tone }: { label: string; value: string | number; note?: string; tone?: string }) {
  return (
    <section className="statCard">
      <p>{label}</p>
      <strong className={tone || ""}>{value}</strong>
      {note ? <span>{note}</span> : null}
    </section>
  );
}

const frontPageLabels: Record<string, string> = {
  dashboard: "首页",
  home: "首页",
  "market-opinion": "美股热点风向标",
  opinions: "美股热点风向标",
  tracking: "股票机会跟踪榜单",
  stocks: "股票库",
  calendar: "美股重点财经前瞻",
  events: "美股重点财经前瞻",
  market: "市场与资金",
  courses: "交易实战课程",
  open: "Open 持仓参考",
  position: "以损定仓",
  funding: "资金费套利扫描",
  forum: "论坛讨论区",
  options: "期权数据",
  stock: "个股详情",
  subscription: "会员权限",
  watchlist: "关注列表"
};

function navPageLabel(page: string) {
  return frontPageLabels[page] || "未命名入口";
}

type MetricsTab = "nav" | "retention";
type MetricsRange = "7" | "30" | "90" | "all" | "custom";

type UserActivityGroup = {
  userId: number;
  email: string;
  events: UserEvent[];
};

function groupUserActivities(events: UserEvent[]) {
  const groups: UserActivityGroup[] = [];
  [...events]
    .filter((event) => event.target.id && event.target.email)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .forEach((event) => {
      const previous = groups[groups.length - 1];
      const previousTime = previous ? Date.parse(previous.events[previous.events.length - 1].createdAt) : 0;
      const eventTime = Date.parse(event.createdAt);
      if (previous && previous.userId === event.target.id && previousTime - eventTime <= 5 * 60 * 1000) {
        previous.events.push(event);
        return;
      }
      groups.push({ userId: event.target.id as number, email: event.target.email as string, events: [event] });
    });
  return groups.slice(0, 5);
}

function activityTime(group: UserActivityGroup) {
  const latest = formatTime(group.events[0].createdAt);
  const earliest = formatTime(group.events[group.events.length - 1].createdAt);
  if (latest === earliest) return latest;
  return `${earliest.slice(0, 10)} ${earliest.slice(11)} - ${latest.slice(11)}`;
}

function MetricsRangeControls({
  range,
  dateFrom,
  dateTo,
  onRangeChange,
  onDateChange
}: {
  range: MetricsRange;
  dateFrom: string;
  dateTo: string;
  onRangeChange: (range: MetricsRange) => void;
  onDateChange: (dateFrom: string, dateTo: string) => void;
}) {
  return (
    <div className="metricsRangeControls">
      {(["7", "30", "90", "all"] as MetricsRange[]).map((value) => (
        <button type="button" className={range === value ? "active" : ""} key={value} onClick={() => onRangeChange(value)}>
          {value === "all" ? "累计" : `${value} 天`}
        </button>
      ))}
      {range === "custom" ? (
        <div className="metricsDateRange">
          <input aria-label="开始日期" type="date" value={dateFrom} onChange={(event) => onDateChange(event.target.value, dateTo)} />
          <span>至</span>
          <input aria-label="结束日期" type="date" value={dateTo} onChange={(event) => onDateChange(dateFrom, event.target.value)} />
        </div>
      ) : (
        <button type="button" onClick={() => onRangeChange("custom")}>选择日期</button>
      )}
    </div>
  );
}

function HomePage({
  users,
  events,
  metrics,
  onOpenUser,
  onOpenUsers
}: {
  users: AdminUser[];
  events: UserEvent[];
  metrics: AdminMetrics | null;
  onOpenUser: (userId: number) => void;
  onOpenUsers: () => void;
}) {
  const [tab, setTab] = useState<MetricsTab>("nav");
  const [navRange, setNavRange] = useState<MetricsRange>("30");
  const [retentionRange, setRetentionRange] = useState<MetricsRange>("30");
  const [navDateFrom, setNavDateFrom] = useState("");
  const [navDateTo, setNavDateTo] = useState("");
  const [retentionDateFrom, setRetentionDateFrom] = useState("");
  const [retentionDateTo, setRetentionDateTo] = useState("");
  const [filteredMetrics, setFilteredMetrics] = useState<AdminMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState("");
  const stats = useMemo(() => {
    const normalUsers = users.filter((user) => user.role === "user");
    const paidUsers = normalUsers.filter((user) => user.hasPaidAccess);
    const monthly = normalUsers.filter((user) => user.plan === "monthly" && user.hasPaidAccess).length;
    const yearly = normalUsers.filter((user) => user.plan === "yearly" && user.hasPaidAccess).length;
    const metricPaid = metrics ? metrics.users.monthlyPaid + metrics.users.yearlyPaid : null;
    return {
      total: metrics?.users.total ?? normalUsers.length,
      paid: metricPaid ?? paidUsers.length,
      monthly: metrics?.users.monthlyPaid ?? monthly,
      yearly: metrics?.users.yearlyPaid ?? yearly,
      active3: metrics?.active.d3 ?? 0,
      active7: metrics?.active.d7 ?? 0,
      active30: metrics?.active.d30 ?? 0
    };
  }, [metrics, users]);
  const activityGroups = useMemo(() => groupUserActivities(events), [events]);
  const customRangeReady =
    (navRange !== "custom" || (navDateFrom && navDateTo)) &&
    (retentionRange !== "custom" || (retentionDateFrom && retentionDateTo));
  const visibleMetrics = filteredMetrics || metrics;

  useEffect(() => {
    if (!customRangeReady) {
      setMetricsLoading(false);
      return;
    }
    const isDefault = navRange === "30" && retentionRange === "30";
    if (isDefault) {
      setFilteredMetrics(null);
      setMetricsError("");
      return;
    }
    let cancelled = false;
    setMetricsLoading(true);
    setMetricsError("");
    api.metrics({ navRange, navDateFrom, navDateTo, retentionRange, retentionDateFrom, retentionDateTo })
      .then((payload) => {
        if (!cancelled) setFilteredMetrics(payload);
      })
      .catch((error) => {
        if (!cancelled) setMetricsError(error instanceof Error ? error.message : "读取统计失败");
      })
      .finally(() => {
        if (!cancelled) setMetricsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customRangeReady, navDateFrom, navDateTo, navRange, retentionDateFrom, retentionDateTo, retentionRange]);

  const activeRange = tab === "nav" ? navRange : retentionRange;
  const activeDateFrom = tab === "nav" ? navDateFrom : retentionDateFrom;
  const activeDateTo = tab === "nav" ? navDateTo : retentionDateTo;
  const activeCustomReady = activeRange !== "custom" || (activeDateFrom && activeDateTo);

  function setActiveRange(nextRange: MetricsRange) {
    if (tab === "nav") setNavRange(nextRange);
    else setRetentionRange(nextRange);
  }

  function setActiveDates(dateFrom: string, dateTo: string) {
    if (tab === "nav") {
      setNavDateFrom(dateFrom);
      setNavDateTo(dateTo);
      setNavRange("custom");
    } else {
      setRetentionDateFrom(dateFrom);
      setRetentionDateTo(dateTo);
      setRetentionRange("custom");
    }
  }

  return (
    <div className="pageStack">
      <section className="panel homeSummary">
        <div><span>用户</span><strong>{stats.total}</strong></div>
        <div><span>有效会员</span><strong>{stats.paid}</strong><em>月度 {stats.monthly} · 年度 {stats.yearly}</em></div>
        <div><span>近 3 日访问用户</span><strong>{stats.active3}</strong><em>7 日 {stats.active7} · 30 日 {stats.active30}</em></div>
      </section>

      <section className="panel homeActivityPanel">
        <div className="panelHeader"><h2>用户动态</h2><button type="button" className="textButton" onClick={onOpenUsers}>全部用户</button></div>
        <table className="adminTable homeActivityTable">
          <thead><tr><th>时间</th><th>用户</th><th>记录</th><th>操作人</th></tr></thead>
          <tbody>
            {activityGroups.map((group) => {
              const actions = [...group.events].reverse().map((event) => actionLabel(event.action)).filter((value, index, values) => values.indexOf(value) === index);
              const actors = [...group.events].reverse().map((event) => event.actor.email || "用户本人").filter((value, index, values) => values.indexOf(value) === index);
              const actionText = actions.join("、");
              const actorText = actors.join("、");
              return <tr key={`${group.userId}-${group.events[0].id}`} tabIndex={0} onClick={() => onOpenUser(group.userId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpenUser(group.userId); }}><td title={activityTime(group)}>{activityTime(group)}</td><td className="homeUserLink" title={group.email}>{group.email}</td><td title={actionText}>{actionText}</td><td title={actorText}>{actorText}</td></tr>;
            })}
            {!activityGroups.length ? <tr><td colSpan={4}>暂无用户动态</td></tr> : null}
          </tbody>
        </table>
      </section>

      <section className="panel homeMetricsPanel">
        <div className="homeMetricsHeader">
          <div className="homeMetricsTabs">
            <button type="button" className={tab === "nav" ? "active" : ""} onClick={() => setTab("nav")}>访问页面</button>
            <button type="button" className={tab === "retention" ? "active" : ""} onClick={() => setTab("retention")}>注册留存</button>
          </div>
          <MetricsRangeControls range={activeRange} dateFrom={activeDateFrom} dateTo={activeDateTo} onRangeChange={setActiveRange} onDateChange={setActiveDates} />
        </div>
        {metricsError ? <p className="homeMetricsError">{metricsError}</p> : null}
        {metricsLoading ? <p className="homeMetricsLoading">正在更新</p> : null}
        <table className="adminTable">
          <thead>
            {tab === "nav" ? <tr><th>页面</th><th>点击次数</th><th>点击用户</th></tr> : <tr><th>注册日期</th><th>注册用户</th><th>3 日</th><th>7 日</th><th>30 日</th></tr>}
          </thead>
          <tbody>
            {!activeCustomReady ? <tr><td colSpan={tab === "nav" ? 3 : 5}>请选择开始和结束日期</td></tr> : null}
            {activeCustomReady && tab === "nav" && visibleMetrics?.navClicks.slice(0, 5).map((row) => <tr key={row.page}><td>{navPageLabel(row.page)}</td><td>{row.clicks}</td><td>{row.users}</td></tr>)}
            {activeCustomReady && tab === "retention" && visibleMetrics?.retention.map((row) => <tr key={row.cohortDay}><td>{row.cohortDay}</td><td>{row.registered}</td><td>{row.registered ? `${Math.round((row.retained3d / row.registered) * 100)}%` : "--"}</td><td>{row.registered ? `${Math.round((row.retained7d / row.registered) * 100)}%` : "--"}</td><td>{row.registered ? `${Math.round((row.retained30d / row.registered) * 100)}%` : "--"}</td></tr>)}
            {activeCustomReady && tab === "nav" && !visibleMetrics?.navClicks.length ? <tr><td colSpan={3}>暂无数据</td></tr> : null}
            {activeCustomReady && tab === "retention" && !visibleMetrics?.retention.length ? <tr><td colSpan={5}>暂无数据</td></tr> : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function UserEditModal({
  selected,
  open,
  currentUser,
  onRefresh,
  onClose,
  title = "用户设置",
  mode = "account"
}: {
  selected: AdminUser | null;
  open: boolean;
  currentUser?: AuthStatus["user"];
  onRefresh: () => Promise<void>;
  onClose: () => void;
  title?: string;
  mode?: "account" | "member";
}) {
  const [form, setForm] = useState({
    plan: "free" as AdminUser["plan"],
    role: "user" as AdminUser["role"],
    subscriptionExpiresAt: "",
    isActive: true
  });
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const isProtectedSuperAdmin = selected?.role === "super_admin";
  const selectedState = selected ? membershipState(selected) : null;
  const canEditRole = mode === "account";
  const canEditMembership = mode === "member" && form.role === "user";
  const canResetPassword = mode === "account" && currentUser?.role === "super_admin" && selected?.role !== "super_admin";
  const canDeleteUser = mode === "account" && currentUser?.role === "super_admin" && selected?.role !== "super_admin";

  useEffect(() => {
    if (!selected) return;
    setForm({
      plan: selected.plan,
      role: selected.role,
      subscriptionExpiresAt: selected.subscriptionExpiresAt ? selected.subscriptionExpiresAt.slice(0, 10) : "",
      isActive: selected.isActive
    });
    setMessage("");
    setNewPassword("");
    setDeleteConfirmOpen(false);
  }, [selected?.id, open]);

  async function savePlan(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (isProtectedSuperAdmin) {
      setMessageTone("error");
      setMessage("超级管理员为系统保留账号，不可编辑");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const result = await api.updateUserPlan({
        userId: selected.id,
        role: canEditRole ? form.role : selected.role,
        plan: form.role === "user" ? form.plan : "free",
        subscriptionExpiresAt: form.role === "user" ? form.subscriptionExpiresAt || null : null,
        isActive: form.isActive
      });
      setForm({
        plan: result.user.plan,
        role: result.user.role,
        subscriptionExpiresAt: result.user.subscriptionExpiresAt ? result.user.subscriptionExpiresAt.slice(0, 10) : "",
        isActive: result.user.isActive
      });
      setMessageTone("success");
      setMessage("已保存设置");
      await onRefresh();
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword() {
    if (!selected || !newPassword.trim()) return;
    setResetting(true);
    setMessage("");
    try {
      await api.resetUserPassword({ userId: selected.id, password: newPassword });
      setNewPassword("");
      setMessageTone("success");
      setMessage("密码已重置");
      await onRefresh();
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "重置失败");
    } finally {
      setResetting(false);
    }
  }

  async function deleteUser() {
    if (!selected) return;
    setDeleting(true);
    setMessage("");
    try {
      await api.deleteUser(selected.id);
      await onRefresh();
      setDeleteConfirmOpen(false);
      onClose();
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  if (!open || !selected) {
    return null;
  }

  return (
    <div className="modalBackdrop modalBackdropTop" role="presentation" onMouseDown={onClose}>
      <section className="modalPanel userEditModal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <h2>{title}</h2>
            <p>{mode === "member" ? "只修改这个用户的会员类型和到期时间，课程授权不受影响。" : "基本设置、重置密码、删除账号分开操作。"}</p>
          </div>
          <button type="button" className="iconButton" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <form className="editForm" onSubmit={savePlan}>
          <div className="selectedUser">
            <strong>{selected.email}</strong>
            <span>{roleLabels[selected.role] || selected.role}</span>
          </div>
          <div className="memberSnapshot">
            {canEditMembership ? (
              <>
                <div>
                  <span>当前会员</span>
                  <strong>{planLabels[selected.plan] || selected.plan}</strong>
                </div>
                <div>
                  <span>会员状态</span>
                  <strong className={selectedState?.tone || ""}>{selectedState?.label}</strong>
                  <em>{selectedState?.detail}</em>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>账号身份</span>
                  <strong>{roleLabels[selected.role] || selected.role}</strong>
                </div>
                <div>
                  <span>账号状态</span>
                  <strong className={selected.isActive ? "positive" : "dangerText"}>{selected.isActive ? "启用" : "停用"}</strong>
                </div>
              </>
            )}
            <div>
              <span>最后登录</span>
              <strong>{formatTime(selected.lastLoginAt)}</strong>
            </div>
          </div>
          {canEditMembership ? (
            <>
              <p className="formHint">当前：{planLabels[selected.plan] || selected.plan}，{formatDate(selected.subscriptionExpiresAt)} 到期。</p>
              <label>
                会员类型
                <select
                  value={form.plan}
                  onChange={(event) => setForm({ ...form, plan: event.target.value as AdminUser["plan"] })}
                >
                  <option value="free">免费</option>
                  <option value="monthly">月度</option>
                  <option value="yearly">年度</option>
                </select>
              </label>
              <label>
                自定义到期日期
                <input
                  type="date"
                  value={form.subscriptionExpiresAt}
                  onChange={(event) => setForm({ ...form, subscriptionExpiresAt: event.target.value })}
                />
              </label>
              <div className="quickActions">
                <button type="button" onClick={() => setForm({ ...form, subscriptionExpiresAt: grantExpiryPreset(30, form.subscriptionExpiresAt) })}>30天</button>
                <button type="button" onClick={() => setForm({ ...form, subscriptionExpiresAt: grantExpiryPreset(180, form.subscriptionExpiresAt) })}>180天</button>
                <button type="button" onClick={() => setForm({ ...form, subscriptionExpiresAt: grantExpiryPreset(365, form.subscriptionExpiresAt) })}>1年</button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, plan: "free", subscriptionExpiresAt: "" })}
                >
                  清空会员
                </button>
              </div>
            </>
          ) : null}
          {mode === "account" ? (
            <>
              <section className="settingsBlock">
                <h3>基本设置</h3>
                <label>
                  身份
                  <select
                    value={form.role}
                    disabled={isProtectedSuperAdmin}
                    onChange={(event) => setForm({ ...form, role: event.target.value as AdminUser["role"] })}
                  >
                    <option value="user">普通用户</option>
                    <option value="admin">管理员</option>
                    <option value="super_admin">超级管理员</option>
                  </select>
                </label>
                <label className="checkboxLine">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    disabled={isProtectedSuperAdmin}
                    onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
                  />
                  账号启用
                </label>
                <div className="modalActions compactActions">
                  <button type="submit" className="primaryButton" disabled={saving || isProtectedSuperAdmin}>{saving ? "保存中" : "保存账号设置"}</button>
                </div>
              </section>
              {canResetPassword ? (
                <section className="settingsBlock">
                  <h3>重置密码</h3>
                  <div className="passwordResetBox">
                    <label>
                      新密码
                      <input
                        type="password"
                        value={newPassword}
                        minLength={8}
                        maxLength={128}
                        autoComplete="new-password"
                        onChange={(event) => setNewPassword(event.target.value)}
                        placeholder="至少 8 位"
                      />
                    </label>
                    <button type="button" className="ghostButton" disabled={resetting || newPassword.length < 8} onClick={resetPassword}>
                      {resetting ? "重置中" : "确认重置"}
                    </button>
                  </div>
                </section>
              ) : null}
              {canDeleteUser ? (
                <section className="settingsBlock dangerZone">
                  <h3>危险操作</h3>
                  <p>删除后账号、权限和操作记录都无法恢复。</p>
                  <button type="button" className="dangerButton" disabled={deleting} onClick={() => setDeleteConfirmOpen(true)}>
                    删除用户
                  </button>
                </section>
              ) : null}
            </>
          ) : null}
          <AdminInlineMessage message={message ? { detail: message, tone: messageTone } : null} />
          {mode === "member" ? (
            <div className="modalActions">
              <button type="button" className="ghostButton" onClick={onClose}>取消</button>
              <button type="submit" className="primaryButton" disabled={saving || isProtectedSuperAdmin}>{saving ? "保存中" : "保存设置"}</button>
            </div>
          ) : null}
        </form>
      </section>
      {deleteConfirmOpen ? (
        <div className="modalBackdrop modalBackdropTop accountDeleteBackdrop" role="presentation" onMouseDown={(event) => { event.stopPropagation(); setDeleteConfirmOpen(false); }}>
          <section className="modalPanel accountDeleteConfirmModal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <h2>删除用户</h2>
              <button type="button" className="iconButton" onClick={() => setDeleteConfirmOpen(false)} aria-label="关闭">×</button>
            </div>
            <div className="selectedUser">
              <strong>{selected.email}</strong>
              <span>{selected.uid}</span>
            </div>
            <p className="accountDeleteCopy">删除后账号、权限和操作记录都无法恢复。</p>
            <div className="modalActions">
              <button type="button" className="ghostButton" onClick={() => setDeleteConfirmOpen(false)}>取消</button>
              <button type="button" className="dangerButton" disabled={deleting} onClick={() => void deleteUser()}>{deleting ? "删除中" : "确认删除"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function MemberCell({ user }: { user: AdminUser }) {
  const state = membershipState(user);
  return (
    <div className="memberCell">
      <span className={`status ${state.className}`}>{state.label}</span>
      <small>{state.detail}</small>
    </div>
  );
}

function RoleCell({ user }: { user: AdminUser }) {
  const className = user.role === "super_admin" ? "roleSuper" : user.role === "admin" ? "roleAdmin" : "roleUser";
  return <span className={`roleBadge ${className}`}>{roleLabels[user.role] || user.role}</span>;
}

function UserIdentityCell({ user }: { user: AdminUser }) {
  return (
    <div className="userIdentityCell">
      <strong>{user.email}</strong>
      <span>注册 {formatTime(user.createdAt)}</span>
    </div>
  );
}

function LastUserEventCell({ event, compact = false }: { event?: UserEvent; compact?: boolean }) {
  if (!event) return <span className="tableMuted">暂无操作</span>;
  return (
    <div className="lastEventCell">
      <strong>{eventSummary(event)}</strong>
      {!compact ? <span>{event.actor.email || "用户本人"} · {formatTime(event.createdAt)}</span> : null}
    </div>
  );
}

function UserStatusCell({ user }: { user: AdminUser }) {
  return <span className={`status ${user.isActive ? "positiveBg" : "dangerBg"}`}>{user.isActive ? "启用" : "停用"}</span>;
}

function userDayDistance(value?: string | null) {
  if (!value) return 9999;
  const today = new Date(`${localDateInputValue()}T00:00:00`);
  const day = new Date(`${formatDate(value)}T00:00:00`);
  if (Number.isNaN(day.getTime())) return 9999;
  return Math.floor((today.getTime() - day.getTime()) / 86400000);
}

function UserCourseCell({ grants }: { grants: CourseGrant[] }) {
  const active = grants.filter((grant) => grant.active !== false);
  if (!active.length) return <span className="tableMuted">无</span>;
  const expiring = active.filter((grant) => {
    const days = daysUntil(grant.expiresAt);
    return days !== null && days >= 0 && days <= 7;
  }).length;
  return <span className={`status ${expiring ? "warningBg" : "positiveBg"}`}>{active.length} 门课程{expiring ? ` / ${expiring} 门将到期` : ""}</span>;
}

function UserDetailModal({
  user,
  events,
  grants,
  seriesById,
  onClose,
  onEditAccount,
  onEditMember,
  onGrantCourses,
  canGrantUsStock
}: {
  user: AdminUser | null;
  events: UserEvent[];
  grants: CourseGrant[];
  seriesById: Map<number, CourseSeries>;
  onClose: () => void;
  onEditAccount: () => void;
  onEditMember: () => void;
  onGrantCourses: (scope: "all" | "us_stock") => void;
  canGrantUsStock: boolean;
}) {
  if (!user) return null;
  const state = membershipState(user);
  const selectedEvents = events.filter((event) => event.target.id === user.id);
  const activeGrants = grants.filter((grant) => grant.active !== false);
  const expiringGrants = activeGrants.filter((grant) => {
    const days = daysUntil(grant.expiresAt);
    return days !== null && days >= 0 && days <= 7;
  });
  const membershipDays = daysUntil(user.subscriptionExpiresAt);
  const hasMemberAlert = membershipDays !== null && user.hasPaidAccess && membershipDays >= 0 && membershipDays <= 7;
  return (
    <div className="modalBackdrop userDetailBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="modalPanel userDetailModal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="userDetailHead">
          <div>
            <h2>{user.email}</h2>
            <p>{user.uid} · 注册于 {formatTime(user.createdAt)}</p>
          </div>
          <div className="userDetailTopActions">
            <button type="button" className="primaryButton" onClick={onEditMember}>设置会员</button>
            {user.role === "user" && canGrantUsStock ? <button type="button" className="ghostButton" onClick={() => onGrantCourses("us_stock")}>授权美股课程</button> : null}
            {user.role === "user" ? <button type="button" className="ghostButton" onClick={() => onGrantCourses("all")}>授权全部课程</button> : null}
            <button type="button" className="ghostButton" onClick={onEditAccount}>账号操作</button>
            <button type="button" className="iconButton" onClick={onClose} aria-label="关闭">×</button>
          </div>
        </div>
        <div className="userDetailContent">
          <div className="userSummaryGrid">
            <div><span>会员到期</span><strong>{formatDate(user.subscriptionExpiresAt)}</strong><em>{planLabels[user.plan] || state.label}</em></div>
            <div><span>课程授权</span><strong>{activeGrants.length} 门</strong><em>{expiringGrants.length ? `${expiringGrants.length} 门 7 天内到期` : "暂无课程到期提醒"}</em></div>
            <div><span>最后登录</span><strong>{formatDate(user.lastLoginAt)}</strong><em>{formatTime(user.lastLoginAt).slice(11)}</em></div>
            <div><span>账号状态</span><strong>{user.isActive ? "启用" : "停用"}</strong><em>{roleLabels[user.role] || user.role}</em></div>
          </div>
          <div className="userDetailPanels">
            <section className="userDetailBlock">
              <h3>会员与课程</h3>
              <table className="adminTable">
                <thead><tr><th>类型</th><th>状态</th><th>到期时间</th></tr></thead>
                <tbody>
                  <tr><td>会员权限<small>会员内容访问</small></td><td><span className={`status ${state.className}`}>{state.label}</span></td><td>{formatDate(user.subscriptionExpiresAt)}</td></tr>
                  <tr><td>交易实战课程<small>课程播放权限</small></td><td>{activeGrants.length ? <span className="status positiveBg">{activeGrants.length} 门有效</span> : <span className="tableMuted">无授权</span>}</td><td>{expiringGrants.length ? `${formatDate(expiringGrants[0].expiresAt)} 等` : "--"}</td></tr>
                </tbody>
              </table>
            </section>
            <section className="userDetailBlock">
              <h3>需要注意</h3>
              {hasMemberAlert ? (
                <div className="userAlert"><strong>会员将在 {membershipDays === 0 ? "今天" : `${membershipDays} 天后`} 到期</strong><span>到期后不能访问会员内容；课程是否能学看课程授权到期时间。</span><em>{formatDate(user.subscriptionExpiresAt)}</em></div>
              ) : null}
              {expiringGrants.map((grant) => (
                <div className="userAlert" key={grant.id}><strong>{seriesById.get(grant.seriesId)?.title || "交易实战课程"} 即将到期</strong><span>去课程管理里修改到期时间或取消授权。</span><em>{formatDate(grant.expiresAt)}</em></div>
              ))}
              {!hasMemberAlert && !expiringGrants.length ? <p>暂无需要处理的提醒</p> : null}
              <h3 className="userRecentTitle">最近操作</h3>
              <div className="userEventList">
                {selectedEvents.slice(0, 3).map((event) => (
                  <div key={event.id}><span>{formatTime(event.createdAt)}</span><strong>{eventSummary(event)}</strong><em>{event.actor.email || "用户本人"}</em></div>
                ))}
                {!selectedEvents.length ? <p>暂无记录</p> : null}
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

function EventPersonCell({ email, label }: { email?: string | null; label?: string }) {
  return (
    <div className="eventPersonCell">
      <strong>{email || "--"}</strong>
      {label ? <span>{label}</span> : null}
    </div>
  );
}

function UsersPage({
  users,
  events,
  metrics,
  courseSeries,
  courseGrants,
  currentUser,
  onRefresh,
  selectedUserId,
  onSelectedUserOpened
}: {
  users: AdminUser[];
  events: UserEvent[];
  metrics: AdminMetrics | null;
  courseSeries: CourseSeries[];
  courseGrants: CourseGrant[];
  currentUser: AuthStatus["user"];
  onRefresh: () => Promise<void>;
  selectedUserId?: number | null;
  onSelectedUserOpened?: () => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [courseFilter, setCourseFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [pageIndex, setPageIndex] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"account" | "member">("member");
  const [grantAllOpen, setGrantAllOpen] = useState(false);
  const [grantScope, setGrantScope] = useState<"all" | "us_stock">("all");
  const [grantAllExpiresAt, setGrantAllExpiresAt] = useState(localDateInputValue());
  const [grantAllMessage, setGrantAllMessage] = useState("");
  const [grantAllDateError, setGrantAllDateError] = useState("");
  const [grantAllSaving, setGrantAllSaving] = useState(false);
  const [grantAllToast, setGrantAllToast] = useState<{ title: string; detail: string; tone: "success" | "error" } | null>(null);
  const selected = users.find((user) => user.id === selectedId) || null;
  const normalUsers = users.filter((user) => user.role === "user");
  const today = localDateInputValue();
  const seriesById = useMemo(() => new Map(courseSeries.map((item) => [item.id, item])), [courseSeries]);
  const usStockCourseCount = courseSeries.filter((item) => usStockCourseTitles.has(item.title)).length;
  const grantsByUser = useMemo(() => {
    const map = new Map<number, CourseGrant[]>();
    courseGrants.forEach((grant) => {
      map.set(grant.user.id, [...(map.get(grant.user.id) || []), grant]);
    });
    return map;
  }, [courseGrants]);
  const stats = {
    total: normalUsers.length,
    today: normalUsers.filter((user) => formatDate(user.createdAt) === today).length,
    active3: metrics?.active.d3 ?? normalUsers.filter((user) => userDayDistance(user.lastLoginAt) < 3).length,
    paid: normalUsers.filter((user) => user.hasPaidAccess).length,
    expiring: normalUsers.filter((user) => {
      const days = daysUntil(user.subscriptionExpiresAt);
      return days !== null && days >= 0 && days <= 7;
    }).length,
    disabled: normalUsers.filter((user) => !user.isActive).length
  };
  const filtered = normalUsers.filter((user) => {
    const userGrants = grantsByUser.get(user.id) || [];
    const hasActiveGrant = userGrants.some((grant) => grant.active !== false);
    const hasExpiringGrant = userGrants.some((grant) => {
      const days = daysUntil(grant.expiresAt);
      return grant.active !== false && days !== null && days >= 0 && days <= 7;
    });
    const normalizedKeyword = keyword.trim().toLowerCase();
    const hitKeyword = !normalizedKeyword || `${user.email} ${user.uid}`.toLowerCase().includes(normalizedKeyword);
    const hitPlan =
      planFilter === "all" ||
      ((planFilter === "paid" && user.hasPaidAccess) ||
      (planFilter === "expired" && user.subscriptionStatus === "expired") ||
      user.plan === planFilter);
    const hitCourse =
      courseFilter === "all" ||
      (courseFilter === "granted" && hasActiveGrant) ||
      (courseFilter === "expiring" && hasExpiringGrant) ||
      (courseFilter === "none" && !hasActiveGrant);
    const hitAccount =
      accountFilter === "all" ||
      (accountFilter === "active" && user.isActive) ||
      (accountFilter === "disabled" && !user.isActive);
    return hitKeyword && hitPlan && hitCourse && hitAccount;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / userPageSize));
  const pageRows = filtered.slice((pageIndex - 1) * userPageSize, pageIndex * userPageSize);

  useEffect(() => {
    setPageIndex(1);
  }, [accountFilter, courseFilter, keyword, planFilter]);

  useEffect(() => {
    if (pageIndex > totalPages) setPageIndex(totalPages);
  }, [pageIndex, totalPages]);

  useEffect(() => {
    if (!grantAllToast) return;
    const timer = window.setTimeout(() => setGrantAllToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [grantAllToast]);

  useEffect(() => {
    if (!selectedUserId) return;
    setSelectedId(selectedUserId);
    onSelectedUserOpened?.();
  }, [onSelectedUserOpened, selectedUserId]);

  function setGrantAllPreset(days: 30 | 180 | 365) {
    setGrantAllExpiresAt(grantExpiryPreset(days, grantAllExpiresAt));
    setGrantAllDateError("");
    setGrantAllMessage("");
  }

  async function submitGrantAllCourses(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (!grantAllExpiresAt) {
      setGrantAllDateError("请选择到期日");
      setGrantAllMessage("");
      return;
    }
    if (grantScope === "all" && !courseSeries.length) {
      setGrantAllDateError("");
      setGrantAllMessage("未找到可授权的课程");
      return;
    }
    setGrantAllSaving(true);
    setGrantAllDateError("");
    setGrantAllMessage("");
    try {
      await api.grantAllCourses({ user: selected.email, expiresAt: grantAllExpiresAt, scope: grantScope });
      setGrantAllOpen(false);
      setGrantAllExpiresAt(localDateInputValue());
      await onRefresh();
      setGrantAllToast({ title: "已授权", detail: `${selected.email} 已开通${grantScope === "us_stock" ? "美股课程" : "全部课程"}`, tone: "success" });
    } catch (err) {
      setGrantAllMessage(err instanceof Error ? err.message : "没有授权成功，请稍后再试");
    } finally {
      setGrantAllSaving(false);
    }
  }

  return (
    <div className="pageStack userPage">
      <AdminToast toast={grantAllToast} />

      <div className="statsGrid userStatsGrid">
        <StatCard label="总用户" value={stats.total} note={`有效 ${normalUsers.filter((user) => user.isActive).length}`} />
        <StatCard label="今日注册" value={stats.today} note={`列表共 ${filtered.length}`} />
        <StatCard label="3日活跃" value={stats.active3} note={`7日 ${metrics?.active.d7 ?? "--"} / 30日 ${metrics?.active.d30 ?? "--"}`} tone="positive" />
        <StatCard label="付费用户" value={stats.paid} note="月度 / 年度" tone="positive" />
        <StatCard label="即将到期" value={stats.expiring} note="未来 7 天" tone={stats.expiring ? "warning" : ""} />
        <StatCard label="已停用" value={stats.disabled} note="账号不可用" tone={stats.disabled ? "dangerText" : ""} />
      </div>

      <section className="toolbarPanel userToolbar">
        <label>
          搜索
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="邮箱 / UID" />
        </label>
        <label>
          会员
          <select value={planFilter} onChange={(event) => setPlanFilter(event.target.value)}>
            <option value="all">全部会员</option>
            <option value="paid">付费会员</option>
            <option value="monthly">月度</option>
            <option value="yearly">年度</option>
            <option value="free">免费</option>
            <option value="expired">已过期</option>
          </select>
        </label>
        <label>
          课程授权
          <select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}>
            <option value="all">全部课程</option>
            <option value="granted">已授权课程</option>
            <option value="expiring">课程将到期</option>
            <option value="none">无课程授权</option>
          </select>
        </label>
        <label>
          账号
          <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
            <option value="all">全部账号</option>
            <option value="active">启用</option>
            <option value="disabled">停用</option>
          </select>
        </label>
      </section>

      <section className="panel tablePanel">
          <table className="adminTable">
            <thead>
              <tr>
                <th>用户</th>
                <th>注册时间</th>
                <th>最后活跃</th>
                <th>会员</th>
                <th>课程授权</th>
                <th>账号</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((user) => (
                <tr key={user.id} className={selectedId === user.id ? "selectedRow" : ""}>
                  <td><UserIdentityCell user={user} /></td>
                  <td>{formatTime(user.createdAt)}</td>
                  <td>{formatTime(user.lastLoginAt)}</td>
                  <td><MemberCell user={user} /></td>
                  <td><UserCourseCell grants={grantsByUser.get(user.id) || []} /></td>
                  <td><UserStatusCell user={user} /></td>
                  <td>
                    <button type="button" className="tableAction" onClick={() => setSelectedId(user.id)}>查看</button>
                  </td>
                </tr>
              ))}
              {!filtered.length ? <tr><td colSpan={7}>暂无用户</td></tr> : null}
            </tbody>
          </table>
          {filtered.length > userPageSize ? (
            <div className="adminPager">
              <button type="button" disabled={pageIndex <= 1} onClick={() => setPageIndex((page) => Math.max(1, page - 1))}>上一页</button>
              <span>第 {pageIndex} / {totalPages} 页 · 共 {filtered.length} 个用户</span>
              <button type="button" disabled={pageIndex >= totalPages} onClick={() => setPageIndex((page) => Math.min(totalPages, page + 1))}>下一页</button>
            </div>
          ) : null}
      </section>
      <UserDetailModal
        user={selected}
        events={events}
        grants={selected ? grantsByUser.get(selected.id) || [] : []}
        seriesById={seriesById}
        onClose={() => setSelectedId(null)}
        onEditAccount={() => {
          setEditorMode("account");
          setEditorOpen(true);
        }}
        onEditMember={() => {
          setEditorMode("member");
          setEditorOpen(true);
        }}
        onGrantCourses={(scope) => {
          setGrantScope(scope);
          setGrantAllExpiresAt(localDateInputValue());
          setGrantAllDateError("");
          setGrantAllMessage("");
          setGrantAllToast(null);
          setGrantAllOpen(true);
        }}
        canGrantUsStock={usStockCourseCount > 0}
      />
      <UserEditModal selected={selected} open={editorOpen} currentUser={currentUser} onRefresh={onRefresh} onClose={() => setEditorOpen(false)} mode={editorMode} title={editorMode === "member" ? "设置会员" : "账号操作"} />
      {grantAllOpen && selected ? (
        <div className="modalOverlay">
          <form className="adminModal courseModal courseGrantModal" onSubmit={submitGrantAllCourses}>
            <div className="modalHeader">
              <h2>{grantScope === "us_stock" ? "授权美股课程" : "授权全部课程"}</h2>
              <button type="button" onClick={() => setGrantAllOpen(false)} aria-label="关闭">×</button>
            </div>
            <p className="grantAllSummary">
              <span>用户</span>
              <strong>{selected.email}</strong>
              <em>{grantScope === "us_stock" ? `美股课程 ${usStockCourseCount} 门` : `全部 ${courseSeries.length} 门课程`}</em>
            </p>
            <label className={grantAllDateError ? "fieldInvalid" : ""}>
              到期日期
              <input
                type="date"
                value={grantAllExpiresAt}
                onChange={(event) => {
                  setGrantAllExpiresAt(event.target.value);
                  setGrantAllDateError("");
                  setGrantAllMessage("");
                }}
              />
              {grantAllDateError ? <small className="fieldError">{grantAllDateError}</small> : null}
            </label>
            <div className="grantQuickActions">
              <button type="button" onClick={() => setGrantAllPreset(30)}>30天</button>
              <button type="button" onClick={() => setGrantAllPreset(180)}>180天</button>
              <button type="button" onClick={() => setGrantAllPreset(365)}>1年</button>
            </div>
            <p className="grantAllNote">{grantScope === "us_stock" ? "包含：美股定投课程、美股投资框架课。" : "已有授权会更新到这个日期。"}</p>
            <AdminInlineMessage message={grantAllMessage ? { detail: grantAllMessage, tone: "error" } : null} />
            <div className="modalActions">
              <button type="button" className="ghostButton" onClick={() => setGrantAllOpen(false)}>取消</button>
              <button type="submit" className="primaryButton" disabled={grantAllSaving}>{grantAllSaving ? "授权中" : "确认授权"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

type CourseSeriesForm = {
  id?: number;
  title: string;
  summary: string;
  intro: string;
  progressStatus: CourseSeries["progressStatus"];
  originalPrice: string;
  discountPrice: string;
  discountLabel: string;
  coverUrl: string;
  sortOrder: string;
  status: CourseSeries["status"];
};

type CourseLessonForm = {
  id?: number;
  title: string;
  sortOrder: string;
  coverUrl: string;
  videoKey: string;
  status: CourseLesson["status"];
};

const emptyCourseSeriesForm = (): CourseSeriesForm => ({ title: "", summary: "", intro: "", progressStatus: "updating", originalPrice: "", discountPrice: "", discountLabel: "", coverUrl: "", sortOrder: "", status: "draft" });
const emptyCourseLessonForm = (): CourseLessonForm => ({ title: "", sortOrder: "", coverUrl: "", videoKey: "", status: "published" });

function CoursesPage({ users }: { users: AdminUser[] }) {
  const coverFileRef = useRef<HTMLInputElement | null>(null);
  const lessonCoverFileRef = useRef<HTMLInputElement | null>(null);
  const videoFileRef = useRef<HTMLInputElement | null>(null);
  const [series, setSeries] = useState<CourseSeries[]>([]);
  const [grants, setGrants] = useState<CourseGrant[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [lessonOpen, setLessonOpen] = useState(false);
  const [courseView, setCourseView] = useState<"list" | "detail">("list");
  const [courseTab, setCourseTab] = useState<"basic" | "lessons" | "grants">("basic");
  const [courseMoreOpen, setCourseMoreOpen] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantUser, setGrantUser] = useState("");
  const [grantExpiresAt, setGrantExpiresAt] = useState("");
  const [confirmAction, setConfirmAction] = useState<{ kind: "series" | "lesson" | "grant"; id: number } | null>(null);
  const [grantQuery, setGrantQuery] = useState("");
  const [grantStatus, setGrantStatus] = useState("all");
  const [grantPage, setGrantPage] = useState(1);
  const [courseQuery, setCourseQuery] = useState("");
  const [courseStatus, setCourseStatus] = useState("all");
  const [courseProgress, setCourseProgress] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [courseToast, setCourseToast] = useState<{ title: string; detail: string } | null>(null);
  const [seriesForm, setSeriesForm] = useState<CourseSeriesForm>(emptyCourseSeriesForm);
  const [lessonForm, setLessonForm] = useState<CourseLessonForm>(emptyCourseLessonForm);
  const selected = series.find((item) => item.id === selectedId) || series[0] || null;
  const selectedGrants = selected ? grants.filter((grant) => grant.seriesId === selected.id) : [];
  const filteredGrants = selectedGrants.filter((grant) => {
    const query = grantQuery.trim().toLowerCase();
    const state = grantState(grant).key;
    if (query && !`${grant.user.email} ${grant.user.uid}`.toLowerCase().includes(query)) return false;
    return grantStatus === "all" || state === grantStatus;
  });
  const grantTotalPages = Math.max(1, Math.ceil(filteredGrants.length / courseGrantPageSize));
  const grantRows = filteredGrants.slice((grantPage - 1) * courseGrantPageSize, grantPage * courseGrantPageSize);
  const grantableUsers = users.filter((user) => user.role === "user");
  const confirmSeries = confirmAction?.kind === "series" ? series.find((item) => item.id === confirmAction.id) || null : null;
  const confirmLesson = confirmAction?.kind === "lesson" && selected ? selected.lessons?.find((item) => item.id === confirmAction.id) || null : null;
  const confirmGrant = confirmAction?.kind === "grant" ? grants.find((item) => item.id === confirmAction.id) || null : null;
  const visibleSeries = series.filter((item) => {
    const query = courseQuery.trim().toLowerCase();
    if (query && !`${item.title} ${item.slug}`.toLowerCase().includes(query)) return false;
    if (courseStatus !== "all" && item.status !== courseStatus) return false;
    if (courseProgress !== "all" && item.progressStatus !== courseProgress) return false;
    return true;
  });
  const courseStats = {
    total: series.length,
    published: series.filter((item) => item.status === "published").length,
    grants: grants.filter((grant) => grant.active !== false).length,
    expiring: series.reduce((sum, item) => sum + (item.expiringCount || 0), 0)
  };

  async function loadCourses() {
    setError("");
    setLoading(true);
    try {
      const payload = await api.courses();
      setSeries(payload.series || []);
      setGrants(payload.grants || []);
      setSelectedId((current) => current || payload.series?.[0]?.id || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "交易实战课程读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCourses();
  }, []);

  useEffect(() => {
    setGrantPage(1);
  }, [grantQuery, grantStatus, selected?.id]);

  useEffect(() => {
    if (grantPage > grantTotalPages) setGrantPage(grantTotalPages);
  }, [grantPage, grantTotalPages]);

  useEffect(() => {
    if (!courseToast) return;
    const timer = window.setTimeout(() => setCourseToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [courseToast]);

  async function submitSeries(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const sortOrder = seriesForm.sortOrder.trim();
      const payload = await api.saveCourseSeries({
        ...seriesForm,
        sortOrder: sortOrder ? Number(sortOrder) : undefined
      });
      setSeriesOpen(false);
      setSeriesForm(emptyCourseSeriesForm());
      await loadCourses();
      setSelectedId(payload.series.id);
      setCourseToast({ title: "已保存", detail: `${payload.series.title} 已更新` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function submitLesson(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const sortOrder = lessonForm.sortOrder.trim();
      await api.saveCourseLesson({
        id: lessonForm.id,
        seriesId: selected.id,
        title: lessonForm.title,
        coverUrl: lessonForm.coverUrl,
        videoKey: lessonForm.videoKey,
        status: lessonForm.status,
        sortOrder: sortOrder ? Number(sortOrder) : undefined
      });
      setLessonOpen(false);
      setLessonForm(emptyCourseLessonForm());
      await loadCourses();
      setCourseToast({ title: "已保存", detail: `${lessonForm.title || "视频"} 已更新` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function submitGrant(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      await api.grantCourse({ seriesId: selected.id, user: grantUser, expiresAt: grantExpiresAt || null });
      setGrantUser("");
      setGrantExpiresAt("");
      setGrantOpen(false);
      await loadCourses();
      setCourseToast({ title: "已授权", detail: `${selected.title} 授权已保存` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "授权失败");
    } finally {
      setSaving(false);
    }
  }

  async function revokeGrant(id: number) {
    setSaving(true);
    setError("");
    try {
      await api.revokeCourseGrant(id);
      await loadCourses();
      setCourseToast({ title: "已取消", detail: "课程授权已取消" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "取消授权失败");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSeries(item: CourseSeries) {
    setSaving(true);
    setError("");
    try {
      await api.deleteCourseSeries(item.id);
      setSelectedId(null);
      await loadCourses();
      setCourseToast({ title: "已删除", detail: `${item.title} 已删除` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSaving(false);
    }
  }

  async function deleteLesson(lesson: CourseLesson) {
    setSaving(true);
    setError("");
    try {
      await api.deleteCourseLesson(lesson.id);
      await loadCourses();
      setCourseToast({ title: "已删除", detail: `${lesson.title} 已删除` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSaving(false);
    }
  }

  async function runConfirmAction() {
    if (!confirmAction) return;
    const action = confirmAction;
    setConfirmAction(null);
    if (action.kind === "series") {
      const item = series.find((row) => row.id === action.id);
      if (item) await deleteSeries(item);
    } else if (action.kind === "lesson" && selected) {
      const item = selected.lessons?.find((row) => row.id === action.id);
      if (item) await deleteLesson(item);
    } else if (action.kind === "grant") {
      await revokeGrant(action.id);
    }
  }

  async function uploadCover(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("请选择图片文件");
      return;
    }
    setCoverUploading(true);
    setError("");
    try {
      const payload = await api.uploadCourseImage(file);
      setSeriesForm((current) => ({ ...current, coverUrl: payload.image.url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "封面上传失败");
    } finally {
      setCoverUploading(false);
    }
  }

  async function uploadLessonCover(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("请选择图片文件");
      return;
    }
    setCoverUploading(true);
    setError("");
    try {
      const payload = await api.uploadCourseImage(file);
      setLessonForm((current) => ({ ...current, coverUrl: payload.image.url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "封面上传失败");
    } finally {
      setCoverUploading(false);
    }
  }

  async function uploadLessonVideo(file: File) {
    if (!selected) return;
    if (file.type && !file.type.startsWith("video/")) {
      setError("请选择视频文件");
      return;
    }
    setVideoUploading(true);
    setVideoUploadProgress(0);
    setError("");
    try {
      const payload = await api.uploadCourseVideo(file, setVideoUploadProgress);
      const title = lessonForm.title || file.name.replace(/\.[^.]+$/, "");
      const sortOrder = lessonForm.sortOrder.trim();
      await api.saveCourseLesson({
        id: lessonForm.id,
        seriesId: selected.id,
        title,
        coverUrl: lessonForm.coverUrl,
        videoKey: payload.video.key,
        status: lessonForm.status,
        sortOrder: sortOrder ? Number(sortOrder) : undefined
      });
      setLessonOpen(false);
      setLessonForm(emptyCourseLessonForm());
      await loadCourses();
      setCourseToast({ title: "已上传", detail: `${title} 已保存` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "视频上传失败");
    } finally {
      setVideoUploading(false);
      setVideoUploadProgress(0);
    }
  }

  function openNewSeries() {
    setSeriesForm(emptyCourseSeriesForm());
    setSeriesOpen(true);
  }

  function openEditSeries(item: CourseSeries) {
    setSeriesForm({
      id: item.id,
      title: item.title,
      summary: item.summary || "",
      intro: item.intro || item.summary || "",
      progressStatus: item.progressStatus || "updating",
      originalPrice: item.originalPrice || "",
      discountPrice: item.discountPrice || "",
      discountLabel: item.discountLabel || "",
      coverUrl: item.coverUrl || "",
      sortOrder: String(item.sortOrder || ""),
      status: item.status
    });
    setSeriesOpen(true);
  }

  function openNewLesson() {
    setLessonForm(emptyCourseLessonForm());
    setLessonOpen(true);
  }

  function openEditLesson(lesson: CourseLesson) {
    setLessonForm({
      id: lesson.id,
      title: lesson.title,
      sortOrder: String(lesson.sortOrder || ""),
      coverUrl: lesson.coverUrl || "",
      videoKey: lesson.videoKey || "",
      status: lesson.status
    });
    setLessonOpen(true);
  }

  function openCourse(item: CourseSeries) {
    setSelectedId(item.id);
    setCourseView("detail");
    setCourseTab("basic");
    setCourseMoreOpen(false);
  }

  function openGrantModal(grant?: CourseGrant) {
    setGrantUser(grant ? grant.user.uid : "");
    setGrantExpiresAt(grant?.expiresAt ? formatDate(grant.expiresAt) : localDateInputValue());
    setGrantOpen(true);
  }

  function courseMeta(item: CourseSeries) {
    return [`优先级 ${item.sortOrder || "--"}`, item.originalPrice || item.discountPrice ? `${item.originalPrice || "--"} / ${item.discountPrice || "--"}` : ""].filter(Boolean);
  }

  function coursePrice(item: CourseSeries) {
    return item.originalPrice || item.discountPrice ? `${item.originalPrice || "--"} / ${item.discountPrice || "--"}` : "--";
  }

  function isUsStockCourse(item: CourseSeries) {
    return usStockCourseTitles.has(item.title);
  }

  function grantState(grant: CourseGrant) {
    if (!grant.expiresAt) return { key: "unset", label: "待改1年", className: "warningBg" };
    const days = daysUntil(grant.expiresAt);
    if (days !== null && days < 0) return { key: "expired", label: "已过期", className: "dangerBg" };
    if (days !== null && days <= 7) return { key: "expiring", label: "快到期", className: "warningBg" };
    return { key: "active", label: "有效", className: "positiveBg" };
  }

  return (
    <div className="pageStack">
      <div className="pageTitle">
        <div>
          <span>后台 / 课程管理</span>
          <h1>{courseView === "list" ? "课程列表" : selected?.title || "课程详情"}</h1>
        </div>
        <button type="button" className="primaryButton" onClick={openNewSeries}>新建课程</button>
      </div>

      {error ? <div className="notice inlineNotice">{error}</div> : null}
      {loading ? <div className="contentLoading inlineNotice">课程刷新中</div> : null}
      <AdminToast toast={courseToast} />

      {courseView === "list" ? (
        <section className="panel tablePanel courseListPanel">
          <div className="courseListFilters">
            <input value={courseQuery} onChange={(event) => setCourseQuery(event.target.value)} placeholder="搜索课程名称" />
            <select value={courseStatus} onChange={(event) => setCourseStatus(event.target.value)}>
              <option value="all">全部状态</option>
              <option value="published">上架</option>
              <option value="draft">草稿</option>
            </select>
            <select value={courseProgress} onChange={(event) => setCourseProgress(event.target.value)}>
              <option value="all">全部进度</option>
              <option value="updating">更新中</option>
              <option value="finished">已完结</option>
            </select>
            <button type="button" className="ghostButton" onClick={() => { setCourseQuery(""); setCourseStatus("all"); setCourseProgress("all"); }}>重置</button>
          </div>
          <div className="courseListStats">
            <div><span>课程总数</span><strong>{courseStats.total}</strong></div>
            <div><span>已上架</span><strong>{courseStats.published}</strong></div>
            <div><span>有效授权</span><strong>{courseStats.grants}</strong></div>
            <div><span>7天内到期</span><strong>{courseStats.expiring}</strong></div>
          </div>
          <table className="adminTable courseListTable">
            <thead><tr><th>课程</th><th>状态</th><th>进度</th><th>视频</th><th>有效授权</th><th>即将到期</th><th>更新时间</th><th>操作</th></tr></thead>
            <tbody>
              {visibleSeries.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="courseTitleCell">
                      <strong>{item.title}{isUsStockCourse(item) ? <span className="courseFixedTag">美股课程</span> : null}</strong>
                      <small>{courseMeta(item).join(" · ")}</small>
                    </div>
                  </td>
                  <td><span className={`status ${item.status === "published" ? "positiveBg" : ""}`}>{item.status === "published" ? "上架" : "草稿"}</span></td>
                  <td><span className={`status ${item.progressStatus === "finished" ? "positiveBg" : "warningBg"}`}>{item.progressStatus === "finished" ? "已完结" : "更新中"}</span></td>
                  <td>{item.lessonCount}</td>
                  <td>{item.grantCount}</td>
                  <td>{item.expiringCount || 0}</td>
                  <td>{formatTime(item.updatedAt)}</td>
                  <td className="courseActionCell">
                    <button type="button" className="tableAction" onClick={() => openCourse(item)}>进入详情</button>
                  </td>
                </tr>
              ))}
              {!visibleSeries.length && !loading ? <tr><td colSpan={8}>暂无交易实战课程</td></tr> : null}
            </tbody>
          </table>
        </section>
      ) : selected ? (
        <div className="courseManageLayout">
          <aside className="panel courseSidePanel">
            <div className="panelHeader">
              <h2>课程</h2>
              <button type="button" className="tableAction" onClick={() => setCourseView("list")}>返回列表</button>
            </div>
            <div className="courseSideFilters">
              <input value={courseQuery} onChange={(event) => setCourseQuery(event.target.value)} placeholder="搜索课程" />
              <select value={courseStatus} onChange={(event) => setCourseStatus(event.target.value)}>
                <option value="all">全部</option>
                <option value="published">上架</option>
                <option value="draft">草稿</option>
              </select>
            </div>
            <div className="courseSideList">
              {visibleSeries.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={item.id === selected.id ? "active" : ""}
                  onClick={() => {
                    setSelectedId(item.id);
                    setGrantPage(1);
                  }}
                >
                  <strong>{item.title}{isUsStockCourse(item) ? <span className="courseFixedTag">美股课程</span> : null}</strong>
                  <span>{item.status === "published" ? "上架" : "草稿"} · {item.progressStatus === "finished" ? "已完结" : "更新中"} · {item.lessonCount} 节视频</span>
                  <div className="courseSideMeta">
                    <em>{item.grantCount} 授权</em>
                    {item.expiringCount ? <em className="warningBg">{item.expiringCount} 快到期</em> : null}
                  </div>
                </button>
              ))}
              {!visibleSeries.length ? <p>暂无课程</p> : null}
            </div>
          </aside>
          <section className="panel courseDetailPage">
            <div className="courseDetailHero">
              <div>
                <h2>{selected.title}</h2>
                <p>
                  {selected.status === "published" ? "上架" : "草稿"} · {selected.progressStatus === "finished" ? "已完结" : "更新中"} · {selected.lessonCount} 节视频 · {selected.grantCount} 个授权 · 最近更新 {formatTime(selected.updatedAt)}
                  {selected.expiringCount ? ` · ${selected.expiringCount} 个快到期` : ""}
                </p>
              </div>
              <div className="courseDetailActions">
                <button type="button" className="tableAction" onClick={() => openEditSeries(selected)}>编辑课程</button>
                <div className="courseDetailMenu">
                  <button type="button" className="iconButton" aria-label="更多操作" onClick={() => setCourseMoreOpen((open) => !open)}>···</button>
                  {courseMoreOpen ? <button type="button" className="courseMenuDanger" disabled={saving} onClick={() => { setCourseMoreOpen(false); setConfirmAction({ kind: "series", id: selected.id }); }}>删除课程</button> : null}
                </div>
              </div>
            </div>
            <div className="courseTabs">
              <button type="button" className={courseTab === "basic" ? "active" : ""} onClick={() => setCourseTab("basic")}>课程信息</button>
              <button type="button" className={courseTab === "lessons" ? "active" : ""} onClick={() => setCourseTab("lessons")}>课时目录</button>
              <button type="button" className={courseTab === "grants" ? "active" : ""} onClick={() => setCourseTab("grants")}>授权用户</button>
            </div>

          {courseTab === "basic" ? (
            <div className="courseBasicGrid">
              <div><span>上架状态</span><strong>{selected.status === "published" ? "上架" : "草稿"}</strong></div>
              <div><span>更新进度</span><strong>{selected.progressStatus === "finished" ? "已完结" : "更新中"}</strong></div>
              <div><span>课时数量</span><strong>{selected.lessonCount} 节视频</strong></div>
              <div><span>有效授权</span><strong>{selected.grantCount} 人</strong></div>
              {selected.originalPrice || selected.discountPrice ? <div><span>价格</span><strong>{coursePrice(selected)}</strong></div> : null}
              {selected.discountLabel ? <div><span>折扣</span><strong>{selected.discountLabel}</strong></div> : null}
              {selected.summary ? <section><span>课程摘要</span><p>{selected.summary}</p></section> : null}
              {selected.intro ? <section><span>课程介绍</span><p>{selected.intro}</p></section> : null}
            </div>
          ) : null}

          {courseTab === "lessons" ? (
            <div>
              <div className="courseTabActions"><button type="button" className="primaryButton" onClick={openNewLesson}>添加视频</button></div>
              <table className="adminTable courseLessonsTable">
                <thead><tr><th>顺序</th><th>视频</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>
                  {(selected.lessons || []).map((lesson) => (
                    <tr key={lesson.id}>
                      <td>{lesson.sortOrder}</td>
                      <td><div className="courseLessonCell"><strong>{lesson.title}</strong><small>{lesson.videoKey ? "已上传视频" : "未上传视频"}</small></div></td>
                      <td><span className={`status ${lesson.status === "published" ? "positiveBg" : "warningBg"}`}>{lesson.status === "published" ? "上架" : "草稿"}</span></td>
                      <td>
                        <button type="button" className="tableAction" disabled={saving} onClick={() => openEditLesson(lesson)}>编辑</button>
                        <button type="button" className="tableAction dangerAction" disabled={saving} onClick={() => setConfirmAction({ kind: "lesson", id: lesson.id })}>删除</button>
                      </td>
                    </tr>
                  ))}
                  {!selected.lessons?.length ? <tr><td colSpan={4}>暂无视频</td></tr> : null}
                </tbody>
              </table>
            </div>
          ) : null}

          {courseTab === "grants" ? (
            <div>
              <div className="courseTabActions">
                <div className="courseGrantFilters">
                  <input value={grantQuery} onChange={(event) => setGrantQuery(event.target.value)} placeholder="搜索邮箱 / UID" />
                  <select value={grantStatus} onChange={(event) => setGrantStatus(event.target.value)}>
                    <option value="all">全部授权</option>
                    <option value="active">有效</option>
                    <option value="expiring">快到期</option>
                    <option value="expired">已过期</option>
                    <option value="unset">未设置到期</option>
                  </select>
                </div>
                <button type="button" className="primaryButton" onClick={() => openGrantModal()}>新增授权</button>
              </div>
              <table className="adminTable courseGrantsTable">
                <thead><tr><th>用户</th><th>状态</th><th>到期日期</th><th>操作</th></tr></thead>
                <tbody>
                  {grantRows.map((grant) => {
                    const state = grantState(grant);
                    return (
                      <tr key={grant.id}>
                        <td><div className="courseGrantUserCell"><strong>{grant.user.email}</strong><small>{grant.user.uid}</small></div></td>
                        <td><span className={`status ${state.className}`}>{state.label}</span></td>
                        <td>{grant.expiresAt ? formatDate(grant.expiresAt) : "未设置"}</td>
                        <td className="courseActionCell">
                          <button type="button" className="tableAction" disabled={saving} onClick={() => openGrantModal(grant)}>改到期</button>
                          <button type="button" className="tableAction dangerAction" disabled={saving} onClick={() => setConfirmAction({ kind: "grant", id: grant.id })}>取消</button>
                        </td>
                      </tr>
                    );
                  })}
                  {!filteredGrants.length ? <tr><td colSpan={4}>暂无授权用户</td></tr> : null}
                </tbody>
              </table>
              {filteredGrants.length > courseGrantPageSize ? (
                <div className="adminPager">
                  <button type="button" disabled={grantPage <= 1} onClick={() => setGrantPage((page) => Math.max(1, page - 1))}>上一页</button>
                  <span>第 {grantPage} / {grantTotalPages} 页 · 共 {filteredGrants.length} 个授权</span>
                  <button type="button" disabled={grantPage >= grantTotalPages} onClick={() => setGrantPage((page) => Math.min(grantTotalPages, page + 1))}>下一页</button>
                </div>
              ) : null}
            </div>
          ) : null}
          </section>
        </div>
      ) : null}

      {grantOpen && selected ? (
        <div className="modalOverlay courseDrawerOverlay">
          <form className="adminModal courseModal courseGrantModal courseGrantDrawer" onSubmit={submitGrant}>
            <div className="modalHeader">
              <h2>{grantUser ? "修改授权" : "新增授权"}</h2>
              <button type="button" onClick={() => setGrantOpen(false)} aria-label="关闭">×</button>
            </div>
            <div className="courseGrantCurrent"><span>当前课程</span><strong>{selected.title}</strong></div>
            <label>用户<input list="courseGrantUsers" value={grantUser} onChange={(event) => setGrantUser(event.target.value)} placeholder="邮箱或 UID" /></label>
            <datalist id="courseGrantUsers">
              {grantableUsers.map((user) => (
                <option key={user.id} value={user.uid}>{user.email}</option>
              ))}
            </datalist>
            <label>到期日期<input type="date" value={grantExpiresAt} onChange={(event) => setGrantExpiresAt(event.target.value)} required /></label>
            <p className="courseGrantDatePreview">到期：{grantExpiresAt || "--"}</p>
            <div className="grantQuickActions">
              <button type="button" onClick={() => setGrantExpiresAt(grantExpiryPreset(30, grantExpiresAt))}>30天</button>
              <button type="button" onClick={() => setGrantExpiresAt(grantExpiryPreset(180, grantExpiresAt))}>180天</button>
              <button type="button" onClick={() => setGrantExpiresAt(grantExpiryPreset(365, grantExpiresAt))}>1年</button>
              <button type="button" onClick={() => setGrantExpiresAt("")}>清空</button>
            </div>
            <div className="modalActions">
              <button type="button" className="ghostButton" onClick={() => setGrantOpen(false)}>取消</button>
              <button type="submit" className="primaryButton" disabled={saving || !grantUser.trim()}>{saving ? "保存中" : "保存授权"}</button>
            </div>
          </form>
        </div>
      ) : null}

      {seriesOpen ? (
        <div className="modalOverlay courseDrawerOverlay">
          <form className="adminModal courseModal courseEditDrawer" onSubmit={submitSeries}>
            <div className="modalHeader">
              <h2>{seriesForm.id ? "编辑课程" : "新建课程"}</h2>
              <button type="button" onClick={() => setSeriesOpen(false)} aria-label="关闭">×</button>
            </div>
            <div className="editForm courseModalBody">
              <section className="courseFormSection">
                <h3>基础信息</h3>
                <div className="courseFormGrid">
                  <label>课程名称<input value={seriesForm.title} onChange={(event) => setSeriesForm({ ...seriesForm, title: event.target.value })} placeholder="例如 财报季交易框架" /></label>
                  <label>优先级<input type="number" min="1" value={seriesForm.sortOrder} onChange={(event) => setSeriesForm({ ...seriesForm, sortOrder: event.target.value })} placeholder="留空自动，数字越大越前" /></label>
                  <label>展示状态<select value={seriesForm.progressStatus} onChange={(event) => setSeriesForm({ ...seriesForm, progressStatus: event.target.value as CourseSeries["progressStatus"] })}><option value="updating">更新中</option><option value="finished">已完结</option></select></label>
                  <label>上架状态<select value={seriesForm.status} onChange={(event) => setSeriesForm({ ...seriesForm, status: event.target.value as CourseSeries["status"] })}><option value="draft">草稿</option><option value="published">上架</option></select></label>
                </div>
              </section>
              <section className="courseFormSection">
                <h3>价格</h3>
                <div className="courseFormGrid">
                  <label>原价($)<input value={seriesForm.originalPrice} onChange={(event) => setSeriesForm({ ...seriesForm, originalPrice: event.target.value })} placeholder="99" /></label>
                  <label>折扣价($)<input value={seriesForm.discountPrice} onChange={(event) => setSeriesForm({ ...seriesForm, discountPrice: event.target.value })} placeholder="9.9" /></label>
                  <label className="fullField">折扣文案<input value={seriesForm.discountLabel} onChange={(event) => setSeriesForm({ ...seriesForm, discountLabel: event.target.value })} placeholder="限时体验价" /></label>
                </div>
              </section>
              <section className="courseFormSection">
                <h3>展示文案</h3>
                <div className="courseFormGrid">
                  <label className="fullField">转化文案<textarea rows={4} value={seriesForm.summary} onChange={(event) => setSeriesForm({ ...seriesForm, summary: event.target.value })} placeholder="用于课程卡片和详情顶部" /></label>
                  <label className="fullField">课程介绍<textarea rows={5} value={seriesForm.intro} onChange={(event) => setSeriesForm({ ...seriesForm, intro: event.target.value })} placeholder={"用于详情页下方介绍，支持 Markdown，例如：\n1. 第一条说明\n2. 第二条说明"} /></label>
                </div>
              </section>
              <section className="courseFormSection">
                <h3>封面</h3>
                <div className="courseCoverUpload">
                  <span>封面图</span>
                  <div>
                    {seriesForm.coverUrl ? <img src={seriesForm.coverUrl} alt="" /> : <em>未上传</em>}
                    <section>
                      <button type="button" className="ghostButton" disabled={coverUploading} onClick={() => coverFileRef.current?.click()}>{coverUploading ? "上传中" : "上传封面"}</button>
                      <small>{seriesForm.coverUrl || "支持 PNG、JPG、WebP、GIF"}</small>
                    </section>
                  </div>
                  <input
                    ref={coverFileRef}
                    className="hiddenFile"
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadCover(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </div>
              </section>
            </div>
            <div className="modalActions">
              <button type="button" className="ghostButton" onClick={() => setSeriesOpen(false)}>取消</button>
              <button type="submit" className="primaryButton" disabled={saving || coverUploading}>{seriesForm.id ? "保存修改" : "保存课程"}</button>
            </div>
          </form>
        </div>
      ) : null}

      {lessonOpen && selected ? (
        <div className="modalOverlay courseDrawerOverlay">
          <form className="adminModal courseModal courseEditDrawer" onSubmit={submitLesson}>
            <div className="modalHeader">
              <h2>{lessonForm.id ? "编辑视频" : "添加视频"}</h2>
              <button type="button" onClick={() => setLessonOpen(false)} aria-label="关闭">×</button>
            </div>
            <div className="editForm courseModalBody">
              <section className="courseFormSection">
                <h3>基础信息</h3>
                <div className="courseFormGrid">
                  <label>视频标题<input value={lessonForm.title} onChange={(event) => setLessonForm({ ...lessonForm, title: event.target.value })} placeholder="例如 01 交易实战课程框架" /></label>
                  <label>优先级<input type="number" min="1" value={lessonForm.sortOrder} onChange={(event) => setLessonForm({ ...lessonForm, sortOrder: event.target.value })} placeholder="留空自动，数字越大越前" /></label>
                  <label>状态<select value={lessonForm.status} onChange={(event) => setLessonForm({ ...lessonForm, status: event.target.value as CourseLesson["status"] })}><option value="published">上架</option><option value="draft">草稿</option></select></label>
                </div>
              </section>
              <section className="courseFormSection">
                <h3>封面</h3>
                <div className="courseCoverUpload">
                  <span>单节封面图</span>
                  <div>
                    {lessonForm.coverUrl ? <img src={lessonForm.coverUrl} alt="" /> : <em>未上传</em>}
                    <section>
                      <button type="button" className="ghostButton" disabled={coverUploading} onClick={() => lessonCoverFileRef.current?.click()}>{coverUploading ? "上传中" : "上传封面"}</button>
                      <small>{lessonForm.coverUrl || "支持 PNG、JPG、WebP、GIF"}</small>
                    </section>
                  </div>
                  <input
                    ref={lessonCoverFileRef}
                    className="hiddenFile"
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadLessonCover(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </div>
              </section>
              <section className="courseFormSection">
                <h3>视频文件</h3>
                <div className="courseVideoUpload">
                  <button type="button" className="ghostButton" disabled={videoUploading} onClick={() => videoFileRef.current?.click()}>{videoUploading ? "上传中" : "上传视频"}</button>
                  <span>{videoUploading ? `上传中 ${videoUploadProgress}%` : lessonForm.videoKey || "上传成功后会自动保存，也可以手动填写视频文件路径"}</span>
                  {videoUploading ? <progress value={videoUploadProgress} max={100} /> : null}
                  <input
                    ref={videoFileRef}
                    className="hiddenFile"
                    type="file"
                    accept="video/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadLessonVideo(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </div>
                <label>视频文件路径<input value={lessonForm.videoKey} onChange={(event) => setLessonForm({ ...lessonForm, videoKey: event.target.value })} placeholder="courses/earnings/lesson-01.mp4" /></label>
              </section>
            </div>
            <div className="modalActions">
              <button type="button" className="ghostButton" onClick={() => setLessonOpen(false)}>取消</button>
              <button type="submit" className="primaryButton" disabled={saving || videoUploading}>{lessonForm.id ? "保存修改" : "保存视频"}</button>
            </div>
          </form>
        </div>
      ) : null}

      {confirmAction ? (
        <div className="modalOverlay">
          <div className="adminModal courseConfirmModal">
            <div className="modalHeader">
              <h2>{confirmAction.kind === "grant" ? "取消授权" : "删除确认"}</h2>
              <button type="button" onClick={() => setConfirmAction(null)} aria-label="关闭">×</button>
            </div>
            <p>
              {confirmAction.kind === "series" && confirmSeries ? `确认删除课程「${confirmSeries.title}」？这会同时删除该课程下的视频和授权。` : null}
              {confirmAction.kind === "lesson" && confirmLesson ? `确认删除视频「${confirmLesson.title}」？` : null}
              {confirmAction.kind === "grant" && confirmGrant ? `确认取消 ${confirmGrant.user.email} 对「${series.find((item) => item.id === confirmGrant.seriesId)?.title || "当前课程"}」的播放权限？` : null}
            </p>
            <div className="modalActions">
              <button type="button" className="ghostButton" onClick={() => setConfirmAction(null)}>取消</button>
              <button type="button" className="dangerButton" disabled={saving} onClick={() => void runConfirmAction()}>{saving ? "处理中" : "确认"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OpenPortfolioPage() {
  const [data, setData] = useState<OpenPortfolioPayload | null>(null);
  const [form, setForm] = useState({
    tradeTime: localDateInputValue(),
    symbol: "",
    side: "buy" as "buy" | "sell",
    price: "",
    amount: "",
    quantity: "",
    note: ""
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [editingTradeId, setEditingTradeId] = useState<number | null>(null);
  const [deleteTradeId, setDeleteTradeId] = useState<number | null>(null);
  const [tradePage, setTradePage] = useState(1);
  const holdings = data?.holdings || [];
  const editingTrade = data?.trades.find((trade) => trade.id === editingTradeId) || null;
  const deleteTrade = data?.trades.find((trade) => trade.id === deleteTradeId) || null;
  const selectedHolding = holdings.find((item) => item.symbol === form.symbol);
  const tradeDateAvailableCash = useMemo(() => openAvailableCashAt(data, form.tradeTime), [data, form.tradeTime]);
  const enteredBuyAmount = Number(form.amount || 0);
  const enteredSellAmount = Number(form.price || 0) * Number(form.quantity || 0);
  const buyAmountPct = tradeDateAvailableCash && enteredBuyAmount > 0 ? Math.min(100, Math.max(0, (enteredBuyAmount / tradeDateAvailableCash) * 100)) : 0;
  const cashAfterTrade = tradeDateAvailableCash === null ? null : form.side === "buy" ? tradeDateAvailableCash - (Number.isFinite(enteredBuyAmount) ? enteredBuyAmount : 0) : tradeDateAvailableCash + (Number.isFinite(enteredSellAmount) ? enteredSellAmount : 0);
  const buyAmountTooHigh = form.side === "buy" && tradeDateAvailableCash !== null && enteredBuyAmount > tradeDateAvailableCash + 0.01;
  const tradePageSize = 10;
  const tradeTotalPages = Math.max(1, Math.ceil((data?.trades.length || 0) / tradePageSize));
  const tradeRows = (data?.trades || []).slice((tradePage - 1) * tradePageSize, tradePage * tradePageSize);
  const setTradeSide = (side: "buy" | "sell") => {
    setForm({ ...form, side, symbol: "", amount: "", quantity: "" });
  };
  const setSellQuantity = (ratio: number) => {
    if (!selectedHolding) return;
    setForm({ ...form, quantity: String(floorTradeQuantity(selectedHolding.quantity * ratio, selectedHolding.quantityStep)) });
  };
  const setBuyAmountRatio = (ratio: number) => {
    if (!tradeDateAvailableCash) return;
    setForm({ ...form, amount: String(Math.floor(tradeDateAvailableCash * ratio * 100) / 100) });
  };
  const openTradeNoteEditor = (trade: OpenPortfolioTrade) => {
    setNoteDrafts((current) => ({ ...current, [trade.id]: trade.note || "" }));
    setEditingTradeId(trade.id);
  };
  const closeTradeNoteEditor = () => {
    if (editingTrade) {
      setNoteDrafts((current) => ({ ...current, [editingTrade.id]: editingTrade.note || "" }));
    }
    setEditingTradeId(null);
  };

  async function loadOpenPortfolio() {
    setLoading(true);
    setToast(null);
    try {
      const payload = await api.openPortfolio();
      setData(payload);
      setTradePage(1);
      setNoteDrafts(Object.fromEntries(payload.trades.map((trade) => [trade.id, trade.note || ""])));
    } catch (err) {
      setToast({ text: err instanceof Error ? err.message : "读取失败", tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOpenPortfolio();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!isLocalDateInputValue(form.tradeTime)) {
      setToast({ text: "日期请填写 YYYY-MM-DD", tone: "error" });
      return;
    }
    const buyAmount = Number(form.amount);
    if (form.side === "buy" && tradeDateAvailableCash !== null && Number.isFinite(buyAmount) && buyAmount > tradeDateAvailableCash + 0.01) {
      setToast({ text: `${form.symbol.trim().toUpperCase() || "标的"} 买入金额超过所选日期可用资金`, tone: "error" });
      return;
    }
    setSaving(true);
    setToast(null);
    try {
      const result = await api.saveOpenTrade({
        tradeTime: form.tradeTime,
        symbol: form.symbol.trim().toUpperCase(),
        side: form.side,
        price: Number(form.price),
        amount: form.side === "buy" ? Number(form.amount) : undefined,
        quantity: form.side === "sell" ? Number(form.quantity) : undefined,
        note: form.note
      });
      setData(result);
      setNoteDrafts(Object.fromEntries(result.trades.map((trade) => [trade.id, trade.note || ""])));
      setForm({ tradeTime: localDateInputValue(), symbol: "", side: "buy", price: "", amount: "", quantity: "", note: "" });
      setTradePage(1);
      setToast({ text: "已保存", tone: "success" });
    } catch (err) {
      setToast({ text: err instanceof Error ? err.message : "保存失败", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function removeTrade(id: number) {
    setSaving(true);
    setToast(null);
    try {
      await api.deleteOpenTrade(id);
      await loadOpenPortfolio();
      setDeleteTradeId(null);
      setToast({ text: "交易已删除", tone: "success" });
    } catch (err) {
      setToast({ text: err instanceof Error ? err.message : "删除失败", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function saveTradeNote(id: number) {
    setSaving(true);
    setToast(null);
    try {
      const result = await api.updateOpenTradeNote(id, noteDrafts[id] || "");
      setData(result);
      setNoteDrafts(Object.fromEntries(result.trades.map((trade) => [trade.id, trade.note || ""])));
      setEditingTradeId(null);
      setToast({ text: "交易逻辑已保存", tone: "success" });
    } catch (err) {
      setToast({ text: err instanceof Error ? err.message : "保存交易逻辑失败", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pageStack">
      <div className="pageTitle">
        <div>
          <span>Open 持仓参考</span>
          <h1>持仓与交易</h1>
        </div>
      </div>

      <AdminToast toast={toast ? { title: toast.tone === "error" ? "操作失败" : "操作成功", detail: toast.text, tone: toast.tone } : null} />
      {loading ? <div className="contentLoading inlineNotice">读取中</div> : null}

      <div className="statsGrid openStatsGrid">
        <StatCard label="初始资金" value={adminMoney(data?.initialCapital)} />
        <StatCard label="可用资金" value={adminMoney(data?.availableCash)} />
        <StatCard label="当前资金" value={adminMoney(data?.equity)} />
        <StatCard label="已实现收益" value={signedMoney(data?.realizedPnl)} tone={(data?.realizedPnl || 0) >= 0 ? "positive" : "dangerText"} />
        <StatCard label="当前持仓" value={data?.holdings.length ?? "--"} note={`交易 ${data?.trades.length ?? "--"} 笔`} />
      </div>

      <div className="openTradeWorkspace">
        <section className="panel openTradePanel">
          <div className={`panelHeader openTradeHeader ${form.side === "sell" ? "sell" : "buy"}`}>
            <h2>{form.side === "buy" ? "新增买入" : "新增卖出"}</h2>
            <div className="tradeSideButtons">
              <button type="button" className={form.side === "buy" ? "active buy" : "buy"} onClick={() => setTradeSide("buy")}>买入</button>
              <button type="button" className={form.side === "sell" ? "active sell" : "sell"} onClick={() => setTradeSide("sell")}>卖出</button>
            </div>
          </div>
          <form className={`openTradeForm ${form.side === "sell" ? "sellForm" : ""}`} onSubmit={submit}>
            <label>日期<input type="text" inputMode="numeric" pattern="\d{4}-\d{2}-\d{2}" placeholder="YYYY-MM-DD" value={form.tradeTime} onChange={(event) => setForm({ ...form, tradeTime: event.target.value })} /></label>
            <label>标的{form.side === "sell" ? (
              <select value={form.symbol} onChange={(event) => setForm({ ...form, symbol: event.target.value })}>
                <option value="">选择持仓</option>
                {holdings.map((item) => <option value={item.symbol} key={item.symbol}>{item.symbol}</option>)}
              </select>
            ) : (
              <input value={form.symbol} onChange={(event) => setForm({ ...form, symbol: event.target.value.toUpperCase() })} placeholder="SNDK" />
            )}</label>
            <label>价格<input type="number" min="0" step="0.000001" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label>
            {form.side === "buy" ? (
              <label>
              <span className="labelMeta"><span>买入金额</span><em>所选日期可用 {adminMoney(tradeDateAvailableCash)}</em></span>
              <input type="number" min="0" max={tradeDateAvailableCash || undefined} step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="输入金额" />
              <div className="amountSlider">
                <input type="range" min="0" max="100" step="1" value={buyAmountPct} onChange={(event) => setBuyAmountRatio(Number(event.target.value) / 100)} />
                <div>
                  <button type="button" onClick={() => setBuyAmountRatio(0.25)}>25%</button>
                  <button type="button" onClick={() => setBuyAmountRatio(0.5)}>50%</button>
                  <button type="button" onClick={() => setBuyAmountRatio(0.75)}>75%</button>
                  <button type="button" onClick={() => setBuyAmountRatio(1)}>100%</button>
                </div>
              </div>
            </label>
            ) : (
              <label>
                <span className="labelMeta"><span>卖出数量</span>{selectedHolding ? <em>可卖 {formatTradeQuantity(selectedHolding.quantity, selectedHolding.quantityStep)}</em> : null}</span>
                <div className="quantityInput">
                  <input type="number" min="0" max={selectedHolding?.quantity || undefined} step={selectedHolding?.quantityStep || 1} value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} placeholder="输入数量" />
                  <button type="button" disabled={!selectedHolding} onClick={() => setSellQuantity(1 / 3)}>1/3</button>
                  <button type="button" disabled={!selectedHolding} onClick={() => setSellQuantity(1 / 2)}>半仓</button>
                  <button type="button" disabled={!selectedHolding} onClick={() => setSellQuantity(1)}>全卖</button>
                </div>
              </label>
            )}
            <label className="fullField">交易逻辑<input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="选填" /></label>
            {buyAmountTooHigh ? <div className="openTradeInlineError">{form.symbol.trim().toUpperCase() || "标的"} 买入金额超过所选日期可用资金</div> : null}
            <button className={`tradeSubmit ${form.side}`} type="submit" disabled={saving}>{saving ? "保存中" : form.side === "buy" ? "确认买入" : "确认卖出"}</button>
          </form>
        </section>

        <section className="panel openCashPanel">
          <div className="panelHeader"><h2>现金口径</h2></div>
          <div className="openCashRows">
            <div><span>当前可用</span><strong>{adminMoney(data?.availableCash)}</strong></div>
            <div><span>所选日期可用</span><strong className={buyAmountTooHigh ? "dangerText" : ""}>{adminMoney(tradeDateAvailableCash)}</strong></div>
            <div><span>{form.side === "buy" ? "本次买入" : "本次卖出回收"}</span><strong>{form.side === "buy" ? (Number.isFinite(enteredBuyAmount) && enteredBuyAmount > 0 ? adminMoney(enteredBuyAmount) : "--") : (Number.isFinite(enteredSellAmount) && enteredSellAmount > 0 ? adminMoney(enteredSellAmount) : "--")}</strong></div>
            <div><span>{form.side === "buy" ? "买入后可用" : "卖出后可用"}</span><strong className={buyAmountTooHigh ? "dangerText" : ""}>{cashAfterTrade !== null && Number.isFinite(cashAfterTrade) ? adminMoney(cashAfterTrade) : "--"}</strong></div>
          </div>
          <p>历史交易会按日期重算现金和持仓。</p>
        </section>
      </div>

      <div className="openAdminGrid">
        <section className="panel tablePanel">
          <div className="panelHeader"><h2>当前持仓</h2></div>
          <table className="adminTable">
            <thead><tr><th>标的</th><th>持仓比例</th><th>成本</th><th>均价</th><th>数量</th><th>操作</th></tr></thead>
            <tbody>
              {data?.holdings.map((row) => (
                <tr key={row.symbol}>
                  <td><strong>{row.symbol}</strong></td>
                  <td>{adminPercent(row.positionPct)}</td>
                  <td>{adminMoney(row.cost)}</td>
                  <td>{adminPrice(row.avgCost)}</td>
                  <td>{formatTradeQuantity(row.quantity, row.quantityStep)}</td>
                  <td><button type="button" className="tableAction dangerAction" onClick={() => setForm({ tradeTime: localDateInputValue(), symbol: row.symbol, side: "sell", price: "", amount: "", quantity: "", note: "" })}>卖出</button></td>
                </tr>
              ))}
              {!data?.holdings.length ? <tr><td colSpan={6}>暂无持仓</td></tr> : null}
            </tbody>
          </table>
        </section>

        <section className="panel tablePanel openHistoryAdminPanel">
          <div className="panelHeader">
            <h2>交易历史</h2>
            <span className="tableMuted">第 {tradePage} / {tradeTotalPages} 页</span>
          </div>
          <table className="adminTable">
            <colgroup>
              <col className="openTradeDateCol" />
              <col className="openTradeSymbolCol" />
              <col className="openTradeSideCol" />
              <col className="openTradePriceCol" />
              <col className="openTradeQuantityCol" />
              <col className="openTradeMoneyCol" />
              <col className="openTradePnlCol" />
              <col />
              <col className="openTradeActionCol" />
            </colgroup>
            <thead><tr><th>日期</th><th>标的</th><th>方向</th><th>价格</th><th>数量</th><th>金额</th><th>已实现</th><th>交易逻辑</th><th>操作</th></tr></thead>
            <tbody>
              {tradeRows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.tradeTime)}</td>
                  <td><strong>{row.symbol}</strong></td>
                  <td><span className={`status ${row.side === "buy" ? "positiveBg" : "dangerBg"}`}>{row.side === "buy" ? "买入" : "卖出"}</span></td>
                  <td>{adminPrice(row.price)}</td>
                  <td>{formatTradeQuantity(row.quantity, row.quantityStep)}</td>
                  <td>{adminMoney(row.amount)}</td>
                  <td className={row.realizedPnl >= 0 ? "positive" : "dangerText"}>{row.side === "sell" ? signedMoney(row.realizedPnl) : "--"}</td>
                  <td>
                    {row.note?.trim() ? <span className="tradeNoteSummary" title={row.note.trim()}>{row.note.trim()}</span> : <span className="tradeNoteEmpty">未填写</span>}
                  </td>
                  <td>
                    <div className="openHistoryActions">
                      <button type="button" className="tableAction" disabled={saving} onClick={() => openTradeNoteEditor(row)}>编辑</button>
                      <button type="button" className="tableAction dangerAction" disabled={saving} onClick={() => setDeleteTradeId(row.id)}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!data?.trades.length ? <tr><td colSpan={9}>暂无交易记录</td></tr> : null}
            </tbody>
          </table>
          {data && data.trades.length > tradePageSize ? (
            <div className="adminPager">
              <button type="button" disabled={tradePage <= 1} onClick={() => setTradePage((page) => Math.max(1, page - 1))}>上一页</button>
              <span>{tradePage} / {tradeTotalPages}</span>
              <button type="button" disabled={tradePage >= tradeTotalPages} onClick={() => setTradePage((page) => Math.min(tradeTotalPages, page + 1))}>下一页</button>
            </div>
          ) : null}
        </section>
      </div>

      {editingTrade ? (
        <div className="modalBackdrop modalBackdropTop" role="presentation" onMouseDown={closeTradeNoteEditor}>
          <form className="modalPanel openTradeNoteModal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void saveTradeNote(editingTrade.id); }}>
            <div className="modalHeader">
              <h2>编辑交易逻辑</h2>
              <button type="button" className="iconButton" onClick={closeTradeNoteEditor} aria-label="关闭">×</button>
            </div>
            <div className="openTradeNoteInfo">
              <div><span>日期</span><strong>{formatDate(editingTrade.tradeTime)}</strong></div>
              <div><span>标的</span><strong>{editingTrade.symbol}</strong></div>
              <div><span>方向</span><strong>{editingTrade.side === "buy" ? "买入" : "卖出"}</strong></div>
              <div><span>金额</span><strong>{adminMoney(editingTrade.amount)}</strong></div>
            </div>
            <label className="openTradeNoteField">
              <span>交易逻辑</span>
              <textarea value={noteDrafts[editingTrade.id] ?? editingTrade.note ?? ""} onChange={(event) => setNoteDrafts({ ...noteDrafts, [editingTrade.id]: event.target.value })} autoFocus />
            </label>
            <div className="modalActions">
              <button type="button" className="ghostButton" onClick={closeTradeNoteEditor}>取消</button>
              <button type="submit" className="primaryButton" disabled={saving || (noteDrafts[editingTrade.id] ?? "") === (editingTrade.note || "")}>{saving ? "保存中" : "保存"}</button>
            </div>
          </form>
        </div>
      ) : null}

      {deleteTrade ? (
        <div className="modalBackdrop modalBackdropTop" role="presentation" onMouseDown={() => setDeleteTradeId(null)}>
          <section className="modalPanel openTradeDeleteModal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <h2>删除交易记录</h2>
              <button type="button" className="iconButton" onClick={() => setDeleteTradeId(null)} aria-label="关闭">×</button>
            </div>
            <div className="openTradeNoteInfo">
              <div><span>日期</span><strong>{formatDate(deleteTrade.tradeTime)}</strong></div>
              <div><span>标的</span><strong>{deleteTrade.symbol}</strong></div>
              <div><span>方向</span><strong>{deleteTrade.side === "buy" ? "买入" : "卖出"}</strong></div>
              <div><span>金额</span><strong>{adminMoney(deleteTrade.amount)}</strong></div>
            </div>
            <p className="openTradeDeleteCopy">删除后会按时间顺序重算现金和持仓。</p>
            <div className="modalActions">
              <button type="button" className="ghostButton" onClick={() => setDeleteTradeId(null)}>取消</button>
              <button type="button" className="dangerButton" disabled={saving} onClick={() => void removeTrade(deleteTrade.id)}>{saving ? "删除中" : "确认删除"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function EventsPage({ events }: { events: UserEvent[] }) {
  const [action, setAction] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return events.filter((event) => {
      const day = formatDate(event.createdAt);
      const hitAction = action === "all" || event.action === action;
      const hitFrom = !dateFrom || day >= dateFrom;
      const hitTo = !dateTo || day <= dateTo;
      const haystack = [
        event.action,
        actionLabel(event.action),
        event.actor.email,
        event.actor.role,
        event.target.email
      ].join(" ").toLowerCase();
      const hitKeyword = !query || haystack.includes(query);
      return hitAction && hitFrom && hitTo && hitKeyword;
    });
  }, [action, dateFrom, dateTo, events, keyword]);

  function clearFilters() {
    setAction("all");
    setKeyword("");
    setDateFrom("");
    setDateTo("");
  }

  return (
    <div className="pageStack">
      <section className="toolbarPanel eventsToolbar">
        <label>
          操作类型
          <select value={action} onChange={(event) => setAction(event.target.value)}>
            {eventActionOptions.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label>
          开始日期
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          结束日期
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label>
          搜索
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="操作人 / 用户邮箱" />
        </label>
        <button type="button" className="ghostButton" onClick={clearFilters}>清空</button>
      </section>

      <section className="panel">
        {filtered.length === 0 ? (
          <div className="emptyPanel">没有匹配记录</div>
        ) : (
          <table className="adminTable eventsTable">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作</th>
                <th>变更内容</th>
                <th>操作人</th>
                <th>目标用户</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((event) => (
                <tr key={event.id}>
                  <td>{formatTime(event.createdAt)}</td>
                  <td><span className="status positiveBg">{actionLabel(event.action)}</span></td>
                  <td className="eventSummary"><LastUserEventCell event={event} compact /></td>
                  <td><EventPersonCell email={event.actor.email || "用户本人"} label={event.actor.role ? roleLabels[event.actor.role] || event.actor.role : ""} /></td>
                  <td><EventPersonCell email={event.target.email} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function AdminsPage({
  users,
  events
}: {
  users: AdminUser[];
  events: UserEvent[];
}) {
  const admins = users.filter((user) => user.role === "admin" || user.role === "super_admin");
  const adminEvents = events.filter((event) =>
    event.action === "update_user" &&
    (event.actor.role === "admin" || event.actor.role === "super_admin")
  );

  return (
    <div className="pageStack">
      <section className="panel">
        <div className="panelHeader">
          <h2>管理员账号</h2>
        </div>
        <table className="adminTable">
          <thead>
            <tr>
              <th>账号</th>
              <th>身份</th>
              <th>状态</th>
              <th>最后登录</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((user) => (
              <tr key={user.id}>
                <td><UserIdentityCell user={user} /></td>
                <td><RoleCell user={user} /></td>
                <td><UserStatusCell user={user} /></td>
                <td>{formatTime(user.lastLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <h2>权限变更记录</h2>
        </div>
        <table className="adminTable eventsTable">
          <thead>
            <tr>
              <th>时间</th>
              <th>动作</th>
              <th>变更内容</th>
              <th>操作人</th>
              <th>目标用户</th>
            </tr>
          </thead>
          <tbody>
            {adminEvents.slice(0, 20).map((event) => (
              <tr key={event.id}>
                <td>{formatTime(event.createdAt)}</td>
                <td><span className="status positiveBg">{actionLabel(event.action)}</span></td>
                <td className="eventSummary"><LastUserEventCell event={event} compact /></td>
                <td><EventPersonCell email={event.actor.email || "用户本人"} label={event.actor.role ? roleLabels[event.actor.role] || event.actor.role : ""} /></td>
                <td><EventPersonCell email={event.target.email} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function splitTextList(value: string) {
  return value
    .split(/[,\n/，、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function imageAlt(file: File) {
  return (file.name || "image").replace(/\.[^.]+$/, "") || "image";
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function joinTextList(value: string[] | undefined) {
  return (value || []).join(" / ");
}

function OpinionStatusBadge({ status }: { status: OpinionStatus | "new" }) {
  if (status === "published") return <em className="publishedState">已发布</em>;
  if (status === "draft") return <em className="draftState">草稿</em>;
  return <em>未保存</em>;
}

function FeaturedBadge({ featured }: { featured?: boolean }) {
  return featured ? <em className="featuredState">首页推荐</em> : null;
}

function OpinionListItemMeta({ item }: { item: MarketOpinion }) {
  const tags = [...(item.symbols || []), ...(item.topics || [])].slice(0, 4);
  return (
    <div className="contentListMeta">
      <span>{item.sectionLabel}</span>
      <span>{formatTime(item.tradeDate)}</span>
      {item.featured ? <b>首页推荐</b> : null}
      {tags.map((tag) => <b key={tag}>{tag}</b>)}
    </div>
  );
}

function renderInlineMarkdown(text: string) {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(<strong key={`${match.index}-strong`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={`${match.index}-code`}>{token.slice(1, -1)}</code>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderMarkdownPreview(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const blocks: ReactElement[] = [];
  let listItems: string[] = [];

  function flushList(index: number) {
    if (!listItems.length) return;
    blocks.push(
      <ul key={`list-${index}`}>
        {listItems.map((item, itemIndex) => (
          <li key={`${index}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>
    );
    listItems = [];
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList(index);
      return;
    }
    const image = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      flushList(index);
      blocks.push(<img key={`img-${index}`} src={image[2]} alt={image[1] || "image"} />);
      return;
    }
    if (trimmed.startsWith("- ")) {
      listItems.push(trimmed.slice(2).trim());
      return;
    }
    flushList(index);
    if (trimmed.startsWith("### ")) {
      blocks.push(<h3 key={index}>{renderInlineMarkdown(trimmed.slice(4))}</h3>);
      return;
    }
    if (trimmed.startsWith("## ")) {
      blocks.push(<h2 key={index}>{renderInlineMarkdown(trimmed.slice(3))}</h2>);
      return;
    }
    if (trimmed.startsWith("# ")) {
      blocks.push(<h1 key={index}>{renderInlineMarkdown(trimmed.slice(2))}</h1>);
      return;
    }
    if (trimmed.startsWith("> ")) {
      blocks.push(<blockquote key={index}>{renderInlineMarkdown(trimmed.slice(2))}</blockquote>);
      return;
    }
    blocks.push(<p key={index}>{renderInlineMarkdown(trimmed)}</p>);
  });
  flushList(lines.length + 1);
  return blocks.length ? blocks : <p className="previewEmpty">暂无正文</p>;
}

function emptyOpinion(): MarketOpinion {
  return {
    id: "",
    section: "daily",
    sectionLabel: "每日个股行情观点",
    title: "",
    tradeDate: normalizeDateTimeInput(localDateTimeInputValue()),
    status: "draft",
    featured: false,
    summary: "",
    symbols: [],
    topics: [],
    highlights: [],
    body: ""
  };
}

function opinionEditSnapshot(item: MarketOpinion, symbolsText: string, topicsText: string, highlightsText: string) {
  return JSON.stringify({
    id: item.id,
    section: item.section,
    title: item.title,
    tradeDate: item.tradeDate,
    status: item.status,
    featured: Boolean(item.featured),
    summary: item.summary,
    symbolsText,
    topicsText,
    highlightsText,
    body: item.body
  });
}

function ContentPage() {
  const [items, setItems] = useState<MarketOpinion[]>([]);
  const [section, setSection] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OpinionStatus>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [keyword, setKeyword] = useState("");
  const [sortMode, setSortMode] = useState<"latest" | "draftFirst" | "publishedFirst">("latest");
  const [listPage, setListPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<MarketOpinion>(emptyOpinion());
  const [symbolsText, setSymbolsText] = useState("");
  const [topicsText, setTopicsText] = useState("");
  const [highlightsText, setHighlightsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "error">("info");
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [pendingDiscardAction, setPendingDiscardAction] = useState<(() => void) | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const isCreating = selectedId === newOpinionId;
  const currentStatus = isCreating ? "未保存" : form.status === "published" ? "已发布" : "草稿";
  const currentSnapshot = opinionEditSnapshot(form, symbolsText, topicsText, highlightsText);
  const hasUnsavedChanges = Boolean(savedSnapshot) && currentSnapshot !== savedSnapshot;
  const listTotalPages = Math.max(1, Math.ceil(listTotal / contentPageSize));
  const visibleItems = items;

  function contentToastTitle() {
    if (messageTone === "error") return "操作失败";
    if (message.includes("中")) return "处理中";
    return "操作成功";
  }

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 2600);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function loadOpinions(nextSection = section, nextPage = listPage) {
    setLoading(true);
    setMessage("");
    try {
      const payload = await api.opinions({
        section: nextSection,
        status: statusFilter,
        dateFrom,
        dateTo,
        q: keyword.trim(),
        sort: sortMode,
        limit: contentPageSize,
        offset: (nextPage - 1) * contentPageSize
      });
      const rows = payload.rows || [];
      setItems(rows);
      setListTotal(payload.total || 0);
      if (!selectedId && rows[0]) {
        selectOpinion(rows[0]);
      }
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }

  function selectOpinion(item: MarketOpinion) {
    const nextSymbolsText = joinTextList(item.symbols);
    const nextTopicsText = joinTextList(item.topics);
    const nextHighlightsText = joinTextList(item.highlights);
    setSelectedId(item.id);
    setForm({ ...item });
    setSymbolsText(nextSymbolsText);
    setTopicsText(nextTopicsText);
    setHighlightsText(nextHighlightsText);
    setSavedSnapshot(opinionEditSnapshot(item, nextSymbolsText, nextTopicsText, nextHighlightsText));
    setMessageTone("info");
    setMessage("");
  }

  function startNewDraft() {
    const item = emptyOpinion();
    setListPage(1);
    setSelectedId(newOpinionId);
    setForm(item);
    setSymbolsText("");
    setTopicsText("");
    setHighlightsText("");
    setSavedSnapshot(opinionEditSnapshot(item, "", "", ""));
    setMessageTone("info");
    setMessage("");
  }

  function runWithDiscardConfirm(action: () => void) {
    if (!hasUnsavedChanges) {
      action();
      return;
    }
    setPendingDiscardAction(() => action);
    setDiscardConfirmOpen(true);
  }

  function closeDiscardConfirm() {
    setDiscardConfirmOpen(false);
    setPendingDiscardAction(null);
  }

  function confirmDiscardChanges() {
    const action = pendingDiscardAction;
    closeDiscardConfirm();
    action?.();
  }

  function createNew() {
    runWithDiscardConfirm(startNewDraft);
  }

  function clearFilters() {
    setSection("");
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
    setKeyword("");
    setSortMode("latest");
    setListPage(1);
  }

  function changeSection(nextSection: string) {
    runWithDiscardConfirm(() => {
      setListPage(1);
      setSection(nextSection);
    });
  }

  useEffect(() => {
    void loadOpinions(section, listPage);
  }, [dateFrom, dateTo, keyword, listPage, section, sortMode, statusFilter]);

  useEffect(() => {
    setListPage(1);
  }, [dateFrom, dateTo, keyword, sortMode, statusFilter]);

  useEffect(() => {
    setListPage((page) => Math.min(page, listTotalPages));
  }, [listTotalPages]);

  function validateOpinion(status: OpinionStatus) {
    if (!form.section.trim()) return "请选择栏目";
    if (!form.tradeDate.trim()) return "请选择时间";
    if (!form.title.trim()) return "请填写标题";
    if (status === "published" && !form.body.trim()) return "发布前请填写正文";
    return "";
  }

  async function save(status: OpinionStatus) {
    const validationMessage = validateOpinion(status);
    if (validationMessage) {
      setMessageTone("error");
      setMessage(validationMessage);
      return;
    }
    setSaving(true);
    setMessageTone("info");
    setMessage("");
    try {
      const sectionLabel = opinionSections.find((item) => item.value === form.section)?.label || form.sectionLabel || form.section;
      const payload = {
        ...form,
        status,
        featured: Boolean(form.featured),
        sectionLabel,
        symbols: splitTextList(symbolsText).map((item) => item.toUpperCase()),
        topics: splitTextList(topicsText),
        highlights: splitTextList(highlightsText)
      };
      const result = await api.saveOpinion(payload);
      setMessageTone("info");
      setMessage(status === "published" ? "已发布" : "已保存草稿");
      setSelectedId(result.item.id);
      await loadOpinions(section, listPage);
      selectOpinion(result.item);
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function removeConfirmed() {
    if (!form.id) return;
    setSaving(true);
    setMessageTone("info");
    setMessage("");
    try {
      await api.deleteOpinion(form.id);
      setDeleteConfirmOpen(false);
      setMessageTone("info");
      setMessage("已删除");
      startNewDraft();
      await loadOpinions(section, listPage);
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSaving(false);
    }
  }

  function insertMarkdown(text: string) {
    const textarea = bodyRef.current;
    if (!textarea) {
      setForm((current) => ({ ...current, body: `${current.body}\n\n${text}`.trim() }));
      return;
    }
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || start;
    const before = form.body.slice(0, start);
    const after = form.body.slice(end);
    const prefix = before && !before.endsWith("\n") ? "\n\n" : "";
    const suffix = after && !after.startsWith("\n") ? "\n\n" : "";
    const nextBody = `${before}${prefix}${text}${suffix}${after}`;
    const cursor = before.length + prefix.length + text.length;
    setForm((current) => ({ ...current, body: nextBody }));
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  function wrapSelection(prefix: string, suffix: string, fallback: string) {
    const textarea = bodyRef.current;
    if (!textarea) {
      insertMarkdown(`${prefix}${fallback}${suffix}`);
      return;
    }
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || start;
    const selected = form.body.slice(start, end) || fallback;
    const nextBody = `${form.body.slice(0, start)}${prefix}${selected}${suffix}${form.body.slice(end)}`;
    const cursorStart = start + prefix.length;
    const cursorEnd = cursorStart + selected.length;
    setForm((current) => ({ ...current, body: nextBody }));
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(cursorStart, cursorEnd);
    });
  }

  async function uploadImageFile(file: File) {
    if (!file.type.startsWith("image/")) {
      throw new Error("请选择图片文件");
    }
    const data = await fileToDataUrl(file);
    const payload = await api.uploadImage({ name: file.name || "image", type: file.type, data });
    insertMarkdown(`![${imageAlt(file)}](${payload.image.url})`);
  }

  async function handleImageFile(file: File) {
    setUploading(true);
    setMessageTone("info");
    setMessage("上传图片中");
    try {
      await uploadImageFile(file);
      setMessageTone("info");
      setMessage("图片已插入正文");
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "图片上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/"));
    if (!image) return;
    event.preventDefault();
    await handleImageFile(image);
  }

  return (
    <div className="pageStack">
      <section className="toolbarPanel contentToolbar">
        <label>
          栏目
          <select value={section} onChange={(event) => changeSection(event.target.value)}>
            <option value="">全部栏目</option>
            {opinionSections.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label>
          状态
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | OpinionStatus)}>
            <option value="all">全部状态</option>
            <option value="published">已发布</option>
            <option value="draft">草稿</option>
          </select>
        </label>
        <label>
          开始日期
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          结束日期
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label>
          搜索
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="标题 / 股票 / 标签" />
        </label>
        <label>
          排序
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as "latest" | "draftFirst" | "publishedFirst")}>
            <option value="latest">最新优先</option>
            <option value="draftFirst">草稿优先</option>
            <option value="publishedFirst">已发布优先</option>
          </select>
        </label>
        <button type="button" className="ghostButton" onClick={clearFilters}>清空</button>
        <button type="button" className="primaryButton" onClick={createNew}>新建内容</button>
      </section>

      <div className="contentLayout">
        <section className="panel contentListPanel">
          {loading ? <div className="emptyPanel">读取中</div> : null}
          {!loading && items.length === 0 ? <div className="emptyPanel">暂无内容</div> : null}
          {isCreating ? (
            <button type="button" className="contentListItem active draftItem">
              <div className="contentListMeta">
                <span>{form.sectionLabel}</span>
                <span>{formatTime(form.tradeDate)}</span>
              </div>
              <strong>{form.title || "未命名内容"}</strong>
              {form.summary ? <p>{form.summary}</p> : null}
              <OpinionStatusBadge status="new" />
            </button>
          ) : null}
          {visibleItems.map((item) => (
            <button
              type="button"
              className={selectedId === item.id ? "contentListItem active" : "contentListItem"}
              key={item.id}
              onClick={() => {
                runWithDiscardConfirm(() => selectOpinion(item));
              }}
            >
              <OpinionListItemMeta item={item} />
              <strong>{item.title}</strong>
              {item.summary ? <p>{item.summary}</p> : null}
              <OpinionStatusBadge status={item.status} />
            </button>
          ))}
          {!loading && listTotal > contentPageSize ? (
            <div className="contentListPager">
              <button type="button" disabled={listPage <= 1} onClick={() => setListPage((page) => Math.max(1, page - 1))}>上一页</button>
              <span>{listPage} / {listTotalPages}</span>
              <button type="button" disabled={listPage >= listTotalPages} onClick={() => setListPage((page) => Math.min(listTotalPages, page + 1))}>下一页</button>
            </div>
          ) : null}
        </section>

        <section className="panel editorPanel">
          <div className="editorMeta">
            <div>
              <span>{form.sectionLabel || "美股热点风向标"}</span>
              <strong>{form.title || "未命名内容"}</strong>
            </div>
            <div className="editorBadges">
              <FeaturedBadge featured={form.featured} />
              <OpinionStatusBadge status={currentStatus === "已发布" ? "published" : currentStatus === "草稿" ? "draft" : "new"} />
            </div>
          </div>
          <AdminToast toast={message ? { title: contentToastTitle(), detail: message, tone: messageTone === "error" ? "error" : "success" } : null} />

          <div className="editorGrid">
            <label>
              栏目
              <select value={form.section} onChange={(event) => {
                const next = event.target.value;
                setForm({
                  ...form,
                  section: next,
                  sectionLabel: opinionSections.find((item) => item.value === next)?.label || next
                });
              }}>
                {opinionSections.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label>
              时间
              <input
                type="datetime-local"
                step="1"
                value={localDateTimeInputValue(form.tradeDate)}
                onChange={(event) => setForm({ ...form, tradeDate: normalizeDateTimeInput(event.target.value) })}
              />
            </label>
          </div>

          <label className="optionLine">
            <input
              type="checkbox"
              checked={Boolean(form.featured)}
              onChange={(event) => setForm({ ...form, featured: event.target.checked })}
            />
            <span>
              首页推荐
            </span>
          </label>

          <label className="fullLabel">
            标题
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label className="fullLabel">
            摘要
            <textarea rows={3} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} />
          </label>
          <div className="editorGrid">
            <label>
              股票代码
              <input value={symbolsText} onChange={(event) => setSymbolsText(event.target.value)} placeholder="SPY / QQQ / NVDA" />
            </label>
            <label>
              标签
              <input value={topicsText} onChange={(event) => setTopicsText(event.target.value)} placeholder="半导体 / FOMC" />
            </label>
          </div>
          <label className="fullLabel">
            要点
            <textarea rows={3} value={highlightsText} onChange={(event) => setHighlightsText(event.target.value)} />
          </label>
          <section className="markdownComposer">
            <div className="markdownToolbar">
              <button type="button" onClick={() => insertMarkdown("## 小标题")}>H2</button>
              <button type="button" onClick={() => wrapSelection("**", "**", "重点文字")}>B</button>
              <button type="button" onClick={() => insertMarkdown("- 要点一\n- 要点二")}>列表</button>
              <button type="button" onClick={() => insertMarkdown("> 引用内容")}>引用</button>
              <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? "上传中" : "图片"}</button>
            </div>
            <div className="markdownWorkArea">
              <label className="fullLabel">
                正文 Markdown
                <textarea
                  ref={bodyRef}
                  className="markdownEditor"
                  value={form.body}
                  onPaste={handlePaste}
                  onChange={(event) => setForm({ ...form, body: event.target.value })}
                />
              </label>
              <div className="markdownPreview">
                <span>预览</span>
                <article>{renderMarkdownPreview(form.body)}</article>
              </div>
            </div>
          </section>

          <div className="editorActions">
            <div className="editorActionState">
              <span>{form.sectionLabel || "美股热点风向标"}</span>
              <strong>{hasUnsavedChanges ? "有未保存修改" : currentStatus}</strong>
            </div>
            <input
              ref={fileRef}
              className="hiddenFile"
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImageFile(file);
                event.currentTarget.value = "";
              }}
            />
            <button type="button" className="ghostButton" disabled={saving || uploading} onClick={() => save("draft")}>保存草稿</button>
            <button type="button" className="primaryButton" disabled={saving} onClick={() => save("published")}>发布</button>
            <button type="button" className="dangerButton" disabled={saving || !form.id} onClick={() => setDeleteConfirmOpen(true)}>删除</button>
          </div>
        </section>
      </div>

      {discardConfirmOpen ? (
        <div className="modalBackdrop modalBackdropTop" role="presentation" onMouseDown={closeDiscardConfirm}>
          <section className="modalPanel contentConfirmModal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <h2>放弃未保存修改</h2>
              <button type="button" className="iconButton" onClick={closeDiscardConfirm} aria-label="关闭">×</button>
            </div>
            <p className="contentConfirmCopy">当前内容还没保存，继续操作会丢失这些修改。</p>
            <div className="modalActions">
              <button type="button" className="ghostButton" onClick={closeDiscardConfirm}>取消</button>
              <button type="button" className="dangerButton" onClick={confirmDiscardChanges}>放弃修改</button>
            </div>
          </section>
        </div>
      ) : null}

      {deleteConfirmOpen ? (
        <div className="modalBackdrop modalBackdropTop" role="presentation" onMouseDown={() => setDeleteConfirmOpen(false)}>
          <section className="modalPanel contentConfirmModal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <h2>删除内容</h2>
              <button type="button" className="iconButton" onClick={() => setDeleteConfirmOpen(false)} aria-label="关闭">×</button>
            </div>
            <div className="selectedUser contentDeleteSummary">
              <strong>{form.title || "未命名内容"}</strong>
              <span>{formatTime(form.tradeDate)} · {form.status === "published" ? "已发布" : "草稿"}</span>
            </div>
            <p className="contentConfirmCopy">{hasUnsavedChanges ? "当前有未保存修改。" : ""}删除后内容无法恢复。</p>
            <div className="modalActions">
              <button type="button" className="ghostButton" onClick={() => setDeleteConfirmOpen(false)}>取消</button>
              <button type="button" className="dangerButton" disabled={saving} onClick={() => void removeConfirmed()}>{saving ? "删除中" : "确认删除"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    self_register: "用户注册",
    update_user: "修改用户/会员",
    reset_password: "账号操作",
    grant_course: "课程授权",
    revoke_course: "取消课程授权",
    delete_user: "删除用户"
  };
  return labels[action] || action;
}

function valueLabel(key: string, value: unknown) {
  if (key === "role") return roleLabels[String(value)] || String(value || "--");
  if (key === "plan") return planLabels[String(value)] || String(value || "--");
  if (key === "isActive") return value ? "启用" : "停用";
  if (key === "subscriptionExpiresAt") return formatDate(String(value || ""));
  return value === null || value === undefined || value === "" ? "--" : String(value);
}

function eventSummary(event: UserEvent) {
  if (event.action === "self_register") return "用户自行注册";
  if (event.action === "reset_password") return "账号安全操作";
  if (event.action === "grant_course") return "课程授权已保存";
  if (event.action === "revoke_course") return "课程授权已取消";
  const before = event.before || {};
  const after = event.after || {};
  const labels: Record<string, string> = {
    role: "身份",
    plan: "会员",
    subscriptionExpiresAt: "到期",
    isActive: "状态"
  };
  const changes = Object.keys(labels)
    .filter((key) => valueLabel(key, before[key]) !== valueLabel(key, after[key]))
    .map((key) => `${labels[key]}：${valueLabel(key, before[key])} → ${valueLabel(key, after[key])}`);
  return changes.length ? changes.join("；") : actionLabel(event.action);
}

export function App() {
  const [page, setPage] = useState<PageKey>("home");
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [events, setEvents] = useState<UserEvent[]>([]);
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [courseSeries, setCourseSeries] = useState<CourseSeries[]>([]);
  const [courseGrants, setCourseGrants] = useState<CourseGrant[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadData() {
    setError("");
    setLoading(true);
    try {
      const [userPayload, eventPayload, metricsPayload, coursePayload] = await Promise.all([api.users(), api.events(), api.metrics(), api.courses()]);
      setUsers(userPayload.users || []);
      setEvents(eventPayload.rows || []);
      setMetrics(metricsPayload);
      setCourseSeries(coursePayload.series || []);
      setCourseGrants(coursePayload.grants || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }

  function navigatePage(nextPage: PageKey) {
    setPage(nextPage);
    if (nextPage !== "content" && nextPage !== "courses") {
      void loadData();
    }
  }

  useEffect(() => {
    api.authStatus()
      .then((status) => {
        setAuth(status);
        if (status.user?.role === "admin" || status.user?.role === "super_admin") {
          return loadData();
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading && !auth) {
    return <main className="loadingPage">加载中</main>;
  }

  if (!auth?.authenticated || (auth.user?.role !== "admin" && auth.user?.role !== "super_admin")) {
    return <LoginScreen onLogin={(status) => { setAuth(status); void loadData(); }} />;
  }

  const pageLabel = navItems.find((item) => item.key === page)?.label || "首页";

  return (
    <div className="adminShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">懂</div>
          <strong>懂币猫后台</strong>
        </div>
        <nav>
          {navItems.map((item) => (
            <button
              className={page === item.key ? "active" : ""}
              key={item.key}
              type="button"
              onClick={() => navigatePage(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="accountBox">
          <span>当前账号</span>
          <strong>{auth.user?.email}</strong>
        </div>
      </aside>

      <section className="mainArea">
        <header className="topbar">
          {page === "home" ? <span /> : <h1>{pageLabel}</h1>}
          <div className="topActions">
            <button
              type="button"
              className="ghostButton"
              onClick={async () => {
                await api.logout();
                setAuth({ authenticated: false, user: null });
              }}
            >
              退出
            </button>
          </div>
        </header>
        {error ? <div className="notice">{error}</div> : null}
        {loading ? <div className="contentLoading">刷新数据中</div> : null}
        {page === "home" ? <HomePage users={users} events={events} metrics={metrics} onOpenUser={(userId) => { setSelectedUserId(userId); setPage("users"); }} onOpenUsers={() => setPage("users")} /> : null}
        {page === "users" ? <UsersPage users={users} events={events} metrics={metrics} courseSeries={courseSeries} courseGrants={courseGrants} currentUser={auth.user} onRefresh={loadData} selectedUserId={selectedUserId} onSelectedUserOpened={() => setSelectedUserId(null)} /> : null}
        {page === "content" ? <ContentPage /> : null}
        {page === "open" ? <OpenPortfolioPage /> : null}
        {page === "courses" ? <CoursesPage users={users} /> : null}
        {page === "events" ? <EventsPage events={events} /> : null}
        {page === "admins" ? <AdminsPage users={users} events={events} /> : null}
      </section>
    </div>
  );
}

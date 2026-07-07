import { ClipboardEvent, FormEvent, ReactElement, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, AdminMetrics, AdminUser, AuthStatus, CourseGrant, CourseLesson, CourseSeries, MarketOpinion, OpenPortfolioPayload, OpinionStatus, UserEvent } from "./api";

type PageKey = "home" | "users" | "members" | "content" | "open" | "courses" | "events" | "admins";

const navItems: Array<{ key: PageKey; label: string }> = [
  { key: "home", label: "首页" },
  { key: "users", label: "用户管理" },
  { key: "members", label: "会员管理" },
  { key: "content", label: "内容管理" },
  { key: "open", label: "Open 持仓" },
  { key: "courses", label: "交易实战课程管理" },
  { key: "events", label: "操作记录" },
  { key: "admins", label: "管理员" }
];

const planLabels: Record<string, string> = {
  free: "免费",
  paid: "付费",
  monthly: "月度",
  yearly: "年度"
};

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

const eventActionOptions = [
  { value: "all", label: "全部操作" },
  { value: "self_register", label: "用户注册" },
  { value: "update_user", label: "修改用户/会员" }
];

function formatTime(value?: string | null) {
  if (!value) return "--";
  const text = value.replace("T", " ").replace(/\.\d+Z?$/, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text} 00:00:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) return `${text}:00`;
  return text.slice(0, 19);
}

function formatDate(value?: string | null) {
  if (!value) return "--";
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

function padTimePart(value: number) {
  return String(value).padStart(2, "0");
}

function localDateTimeInputValue(value?: string | null) {
  if (value) {
    const text = value.replace(" ", "T");
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
  "market-opinion": "美股热点风向标",
  tracking: "股票机会跟踪榜单",
  stocks: "股票库",
  events: "美股重点财经前瞻",
  market: "市场与资金",
  options: "期权数据",
  stock: "个股详情",
  subscription: "会员权限",
  watchlist: "关注列表"
};

function HomePage({ users, events, metrics }: { users: AdminUser[]; events: UserEvent[]; metrics: AdminMetrics | null }) {
  const stats = useMemo(() => {
    const normalUsers = users.filter((user) => user.role === "user");
    const paidUsers = normalUsers.filter((user) => user.hasPaidAccess);
    const monthly = normalUsers.filter((user) => user.plan === "monthly" && user.hasPaidAccess).length;
    const yearly = normalUsers.filter((user) => user.plan === "yearly" && user.hasPaidAccess).length;
    const navClicks = metrics?.navClicks.reduce((sum, row) => sum + row.clicks, 0) || 0;
    const metricPaid = metrics ? metrics.users.monthlyPaid + metrics.users.yearlyPaid : null;
    return {
      total: metrics?.users.total ?? normalUsers.length,
      active: metrics?.users.active ?? normalUsers.filter((user) => user.isActive).length,
      paid: metricPaid ?? paidUsers.length,
      monthly: metrics?.users.monthlyPaid ?? monthly,
      yearly: metrics?.users.yearlyPaid ?? yearly,
      active3: metrics?.active.d3 ?? 0,
      active7: metrics?.active.d7 ?? 0,
      active30: metrics?.active.d30 ?? 0,
      navClicks
    };
  }, [metrics, users]);

  const recentUsers = users
    .filter((user) => user.role === "user")
    .slice()
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 5);

  return (
    <div className="pageStack">
      <div className="pageTitle">
        <div>
          <span>数据概览</span>
          <h1>用户与会员</h1>
        </div>
      </div>

      <div className="statsGrid">
        <StatCard label="注册用户" value={stats.total} note={`有效 ${stats.active}`} />
        <StatCard label="付费用户" value={stats.paid} note={`月度 ${stats.monthly} / 年度 ${stats.yearly}`} tone="positive" />
        <StatCard label="3日活跃" value={stats.active3} note={`7日 ${stats.active7} / 30日 ${stats.active30}`} />
        <StatCard label="导航点击" value={stats.navClicks} note={`30日活跃 ${stats.active30}`} />
      </div>

      <section className="panel homeTablePanel">
        <div className="panelHeader">
          <h2>导航点击率</h2>
        </div>
        <table className="adminTable">
          <thead>
            <tr>
              <th>页面</th>
              <th>点击次数</th>
              <th>点击用户</th>
              <th>占比</th>
            </tr>
          </thead>
          <tbody>
            {metrics?.navClicks.length ? metrics.navClicks.map((row) => (
              <tr key={row.page}>
                <td>{frontPageLabels[row.page] || row.page}</td>
                <td>{row.clicks}</td>
                <td>{row.users}</td>
                <td>{stats.navClicks ? `${Math.round((row.clicks / stats.navClicks) * 100)}%` : "--"}</td>
              </tr>
            )) : (
              <tr><td colSpan={4}>暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel homeTablePanel">
        <div className="panelHeader">
          <h2>用户留存</h2>
        </div>
        <table className="adminTable">
          <thead>
            <tr>
              <th>注册日期</th>
              <th>注册用户</th>
              <th>3日</th>
              <th>7日</th>
              <th>30日</th>
            </tr>
          </thead>
          <tbody>
            {metrics?.retention.length ? metrics.retention.map((row) => (
              <tr key={row.cohortDay}>
                <td>{row.cohortDay}</td>
                <td>{row.registered}</td>
                <td>{row.registered ? `${Math.round((row.retained3d / row.registered) * 100)}%` : "--"}</td>
                <td>{row.registered ? `${Math.round((row.retained7d / row.registered) * 100)}%` : "--"}</td>
                <td>{row.registered ? `${Math.round((row.retained30d / row.registered) * 100)}%` : "--"}</td>
              </tr>
            )) : (
              <tr><td colSpan={5}>暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel homeTablePanel">
        <div className="panelHeader">
          <h2>最近注册</h2>
        </div>
        <table className="adminTable">
          <thead>
            <tr>
              <th>用户</th>
              <th>会员</th>
              <th>到期时间</th>
              <th>状态</th>
              <th>最后登录</th>
            </tr>
          </thead>
          <tbody>
            {recentUsers.map((user) => (
              <tr key={user.id}>
                <td><UserIdentityCell user={user} /></td>
                <td><MemberCell user={user} /></td>
                <td>{formatDate(user.subscriptionExpiresAt)}</td>
                <td><UserStatusCell user={user} /></td>
                <td>{formatTime(user.lastLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel homeTablePanel">
        <div className="panelHeader">
          <h2>最近操作记录</h2>
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
            {events.slice(0, 10).map((event) => (
              <tr key={event.id}>
                <td>{formatTime(event.createdAt)}</td>
                <td><span className="status positiveBg">{actionLabel(event.action)}</span></td>
                <td className="eventSummary"><LastUserEventCell event={event} /></td>
                <td><EventPersonCell email={event.actor.email} label={event.actor.role ? roleLabels[event.actor.role] || event.actor.role : ""} /></td>
                <td><EventPersonCell email={event.target.email} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function UserEditModal({
  selected,
  open,
  events,
  currentUser,
  onRefresh,
  onClose,
  title = "用户设置",
  mode = "account"
}: {
  selected: AdminUser | null;
  open: boolean;
  events: UserEvent[];
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
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const selectedEvents = events.filter((event) => event.target.id === selected?.id).slice(0, 5);
  const isProtectedSuperAdmin = selected?.role === "super_admin";
  const selectedState = selected ? membershipState(selected) : null;
  const canEditRole = mode === "account";
  const canEditMembership = form.role === "user";
  const canResetPassword = currentUser?.role === "super_admin" && selected?.role !== "super_admin";
  const canDeleteUser = currentUser?.role === "super_admin" && selected?.role !== "super_admin";

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
  }, [selected?.id]);

  async function savePlan(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (isProtectedSuperAdmin) {
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
      setMessage("已保存设置");
      await onRefresh();
    } catch (err) {
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
      setMessage("密码已重置");
      await onRefresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "重置失败");
    } finally {
      setResetting(false);
    }
  }

  async function deleteUser() {
    if (!selected) return;
    if (!window.confirm(`确认删除 ${selected.email}？删除后无法恢复。`)) return;
    setDeleting(true);
    setMessage("");
    try {
      await api.deleteUser(selected.id);
      await onRefresh();
      onClose();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  if (!open || !selected) {
    return null;
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="modalPanel" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <h2>{title}</h2>
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
                到期日期
                <input
                  type="date"
                  value={form.subscriptionExpiresAt}
                  onChange={(event) => setForm({ ...form, subscriptionExpiresAt: event.target.value })}
                />
              </label>
              <div className="quickActions">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, plan: "monthly", subscriptionExpiresAt: dateAfterMonths(1, form.subscriptionExpiresAt) })}
                >
                  续月度
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, plan: "yearly", subscriptionExpiresAt: dateAfterMonths(12, form.subscriptionExpiresAt) })}
                >
                  续年度
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, plan: "free", subscriptionExpiresAt: "" })}
                >
                  清空会员
                </button>
              </div>
            </>
          ) : null}
          {canEditRole ? (
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
          ) : null}
          <label className="checkboxLine">
            <input
              type="checkbox"
              checked={form.isActive}
              disabled={isProtectedSuperAdmin}
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            />
            账号启用
          </label>
          {canResetPassword ? (
            <div className="passwordResetBox">
              <label>
                重置密码
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
                {resetting ? "重置中" : "重置密码"}
              </button>
            </div>
          ) : null}
          {message ? <p className="inlineMessage">{message}</p> : null}
          <div className="modalActions">
            {canDeleteUser ? (
              <button type="button" className="dangerButton" disabled={deleting} onClick={deleteUser}>
                {deleting ? "删除中" : "删除用户"}
              </button>
            ) : null}
            <button type="button" className="ghostButton" onClick={onClose}>取消</button>
            <button type="submit" className="primaryButton" disabled={saving || isProtectedSuperAdmin}>{saving ? "保存中" : "保存设置"}</button>
          </div>
        </form>

        <div className="modalAudit">
        <div className="panelHeader">
          <h2>该用户最近操作</h2>
        </div>
        <div className="auditList">
          {selectedEvents.length === 0 ? <div><span>暂无记录</span></div> : null}
          {selectedEvents.map((event) => (
            <div key={event.id}>
              <strong>{eventSummary(event)}</strong>
              <span>{event.actor.email || "--"} · {formatTime(event.createdAt)}</span>
            </div>
          ))}
        </div>
        </div>
      </section>
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

function LastUserEventCell({ event }: { event?: UserEvent }) {
  if (!event) return <span className="tableMuted">暂无操作</span>;
  return (
    <div className="lastEventCell">
      <strong>{eventSummary(event)}</strong>
      <span>{event.actor.email || "--"} · {formatTime(event.createdAt)}</span>
    </div>
  );
}

function UserStatusCell({ user }: { user: AdminUser }) {
  return <span className={`status ${user.isActive ? "positiveBg" : "dangerBg"}`}>{user.isActive ? "启用" : "停用"}</span>;
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
  currentUser,
  onRefresh
}: {
  users: AdminUser[];
  events: UserEvent[];
  currentUser: AuthStatus["user"];
  onRefresh: () => Promise<void>;
}) {
  const [keyword, setKeyword] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const selected = users.find((user) => user.id === selectedId) || null;
  const lastEventByUser = useMemo(() => {
    const map = new Map<number, UserEvent>();
    events.forEach((event) => {
      const targetId = event.target.id;
      if (!targetId || map.has(targetId)) return;
      map.set(targetId, event);
    });
    return map;
  }, [events]);
  const filtered = users.filter((user) => {
    const hitKeyword = !keyword.trim() || user.email.toLowerCase().includes(keyword.trim().toLowerCase());
    const hitRole = roleFilter === "all" || user.role === roleFilter;
    const hitPlan =
      planFilter === "all" ||
      (user.role === "user" && (
        (planFilter === "paid" && user.hasPaidAccess) ||
        (planFilter === "expired" && user.subscriptionStatus === "expired") ||
        user.plan === planFilter
      ));
    return hitKeyword && hitRole && hitPlan;
  });

  return (
    <div className="pageStack">
      <div className="pageTitle">
        <div>
          <span>用户管理</span>
          <h1>用户列表</h1>
        </div>
      </div>

      <section className="toolbarPanel userToolbar">
        <label>
          搜索
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="邮箱" />
        </label>
        <label>
          身份
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="all">全部身份</option>
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
            <option value="super_admin">超级管理员</option>
          </select>
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
      </section>

      <div className="memberLayout">
        <section className="panel tablePanel">
          <table className="adminTable">
            <thead>
              <tr>
                <th>用户</th>
                <th>身份</th>
                <th>会员</th>
                <th>到期时间</th>
                <th>最近操作</th>
                <th>最后登录</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.id}>
                  <td><UserIdentityCell user={user} /></td>
                  <td><RoleCell user={user} /></td>
                  <td><MemberCell user={user} /></td>
                  <td>{user.role === "user" ? formatDate(user.subscriptionExpiresAt) : <span className="tableMuted">--</span>}</td>
                  <td><LastUserEventCell event={lastEventByUser.get(user.id)} /></td>
                  <td>{formatTime(user.lastLoginAt)}</td>
                  <td>
                    {user.role === "super_admin" ? (
                      <span className="tableMuted">不可编辑</span>
                    ) : (
                      <button
                        type="button"
                        className="tableAction"
                        onClick={() => {
                          setSelectedId(user.id);
                          setEditorOpen(true);
                      }}
                    >
                        设置账号
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <UserEditModal selected={selected} open={editorOpen} events={events} currentUser={currentUser} onRefresh={onRefresh} onClose={() => setEditorOpen(false)} />
    </div>
  );
}

function MembersPage({
  users,
  events,
  onRefresh
}: {
  users: AdminUser[];
  events: UserEvent[];
  onRefresh: () => Promise<void>;
}) {
  const [keyword, setKeyword] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const normalUsers = users.filter((user) => user.role === "user");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const selected = normalUsers.find((user) => user.id === selectedId) || null;
  const lastEventByUser = useMemo(() => {
    const map = new Map<number, UserEvent>();
    events.forEach((event) => {
      const targetId = event.target.id;
      if (!targetId || map.has(targetId)) return;
      map.set(targetId, event);
    });
    return map;
  }, [events]);

  const filtered = normalUsers.filter((user) => {
    const hitKeyword = !keyword.trim() || user.email.toLowerCase().includes(keyword.trim().toLowerCase());
    const hitPlan =
      planFilter === "all" ||
      (planFilter === "paid" && user.hasPaidAccess) ||
      (planFilter === "expired" && user.subscriptionStatus === "expired") ||
      user.plan === planFilter;
    return hitKeyword && hitPlan;
  });

  return (
    <div className="pageStack">
      <div className="pageTitle">
        <div>
          <span>会员管理</span>
          <h1>用户会员</h1>
        </div>
      </div>

      <section className="toolbarPanel">
        <label>
          搜索
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="邮箱" />
        </label>
        <label>
          会员
          <select value={planFilter} onChange={(event) => setPlanFilter(event.target.value)}>
            <option value="all">全部</option>
            <option value="paid">付费会员</option>
            <option value="monthly">月度</option>
            <option value="yearly">年度</option>
            <option value="free">免费</option>
            <option value="expired">已过期</option>
          </select>
        </label>
      </section>

      <div className="memberLayout">
        <section className="panel tablePanel">
          <table className="adminTable">
            <thead>
              <tr>
                <th>用户</th>
                <th>会员</th>
                <th>到期时间</th>
                <th>状态</th>
                <th>最近操作</th>
                <th>最后登录</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.id}>
                  <td><UserIdentityCell user={user} /></td>
                  <td><MemberCell user={user} /></td>
                  <td>{formatDate(user.subscriptionExpiresAt)}</td>
                  <td><UserStatusCell user={user} /></td>
                  <td><LastUserEventCell event={lastEventByUser.get(user.id)} /></td>
                  <td>{formatTime(user.lastLoginAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="tableAction"
                      onClick={() => {
                        setSelectedId(user.id);
                        setEditorOpen(true);
                      }}
                    >
                      设置会员
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <UserEditModal selected={selected} open={editorOpen} events={events} onRefresh={onRefresh} onClose={() => setEditorOpen(false)} title="会员设置" mode="member" />
    </div>
  );
}

type CourseSeriesForm = {
  id?: number;
  title: string;
  summary: string;
  intro: string;
  progressStatus: CourseSeries["progressStatus"];
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

const emptyCourseSeriesForm = (): CourseSeriesForm => ({ title: "", summary: "", intro: "", progressStatus: "updating", coverUrl: "", sortOrder: "", status: "draft" });
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
  const [grantUser, setGrantUser] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [seriesForm, setSeriesForm] = useState<CourseSeriesForm>(emptyCourseSeriesForm);
  const [lessonForm, setLessonForm] = useState<CourseLessonForm>(emptyCourseLessonForm);
  const selected = series.find((item) => item.id === selectedId) || series[0] || null;
  const selectedGrants = selected ? grants.filter((grant) => grant.seriesId === selected.id) : [];
  const grantableUsers = users.filter((user) => user.role === "user");

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
      await api.grantCourse({ seriesId: selected.id, user: grantUser });
      setGrantUser("");
      await loadCourses();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "取消授权失败");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSeries(item: CourseSeries) {
    if (!window.confirm(`删除交易实战课程系列「${item.title}」？该系列下的视频和授权也会一起删除。`)) return;
    setSaving(true);
    setError("");
    try {
      await api.deleteCourseSeries(item.id);
      setSelectedId(null);
      await loadCourses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSaving(false);
    }
  }

  async function deleteLesson(lesson: CourseLesson) {
    if (!window.confirm(`删除视频「${lesson.title}」？`)) return;
    setSaving(true);
    setError("");
    try {
      await api.deleteCourseLesson(lesson.id);
      await loadCourses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSaving(false);
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

  return (
    <div className="pageStack">
      <div className="pageTitle">
        <div>
          <span>交易实战课程系列 / 视频 / 授权</span>
          <h1>交易实战课程管理</h1>
        </div>
        <button type="button" className="primaryButton" onClick={openNewSeries}>新建系列</button>
      </div>

      {error ? <div className="notice inlineNotice">{error}</div> : null}
      {loading ? <div className="contentLoading inlineNotice">交易实战课程刷新中</div> : null}

      <div className="courseAdminLayout">
        <section className="panel tablePanel">
          <div className="panelHeader">
            <h2>交易实战课程系列</h2>
          </div>
          <table className="adminTable">
            <thead>
              <tr>
                <th>系列</th>
                <th>优先级</th>
                <th>视频</th>
                <th>授权</th>
                <th>展示</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {series.map((item) => (
                <tr key={item.id} className={selected?.id === item.id ? "selectedRow" : ""} onClick={() => setSelectedId(item.id)}>
                  <td><strong>{item.title}</strong><small>{item.slug}</small></td>
                  <td>{item.sortOrder}</td>
                  <td>{item.lessonCount}</td>
                  <td>{item.grantCount}</td>
                  <td><span className={`status ${item.progressStatus === "finished" ? "positiveBg" : ""}`}>{item.progressStatus === "finished" ? "已完结" : "更新中"}</span></td>
                  <td><span className={`status ${item.status === "published" ? "positiveBg" : ""}`}>{item.status === "published" ? "上架" : "草稿"}</span></td>
                  <td>
                    <button
                      type="button"
                      className="tableAction"
                      disabled={saving}
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditSeries(item);
                      }}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="tableAction dangerAction"
                      disabled={saving}
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteSeries(item);
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {!series.length && !loading ? <tr><td colSpan={6}>暂无交易实战课程</td></tr> : null}
            </tbody>
          </table>
        </section>

        <section className="panel courseDetailPanel">
          <div className="panelHeader">
            <h2>{selected?.title || "交易实战课程详情"}</h2>
            <button
              type="button"
              className="tableAction"
              disabled={!selected}
              onClick={() => {
                openNewLesson();
              }}
            >
              添加视频
            </button>
          </div>
          {selected ? (
            <>
              <table className="adminTable">
                <thead>
                  <tr>
                    <th>优先级</th>
                    <th>封面</th>
                    <th>视频</th>
                    <th>COS Key</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(selected.lessons || []).map((lesson) => (
                    <tr key={lesson.id}>
                      <td>{lesson.sortOrder}</td>
                      <td>{lesson.coverUrl ? <img className="lessonCoverThumb" src={lesson.coverUrl} alt="" /> : "--"}</td>
                      <td>{lesson.title}</td>
                      <td className="courseKeyCell">{lesson.videoKey || "--"}</td>
                      <td><span className={`status ${lesson.status === "published" ? "positiveBg" : ""}`}>{lesson.status === "published" ? "上架" : "草稿"}</span></td>
                      <td>
                        <button type="button" className="tableAction" disabled={saving} onClick={() => openEditLesson(lesson)}>编辑</button>
                        <button type="button" className="tableAction dangerAction" disabled={saving} onClick={() => deleteLesson(lesson)}>删除</button>
                      </td>
                    </tr>
                  ))}
                  {!selected.lessons?.length ? <tr><td colSpan={6}>暂无视频</td></tr> : null}
                </tbody>
              </table>

              <form className="courseGrantForm" onSubmit={submitGrant}>
                <label>
                  授权用户
                  <input list="courseGrantUsers" value={grantUser} onChange={(event) => setGrantUser(event.target.value)} placeholder="邮箱或 UID" />
                </label>
                <datalist id="courseGrantUsers">
                  {grantableUsers.map((user) => (
                    <option key={user.id} value={user.uid}>{user.email}</option>
                  ))}
                </datalist>
                <button type="submit" className="primaryButton" disabled={saving || !grantUser.trim()}>保存授权</button>
              </form>
              <div className="courseGrantList">
                {selectedGrants.map((grant) => (
                  <div key={grant.id}>
                    <strong>{grant.user.email}</strong>
                    <span>{grant.user.uid}</span>
                    <button type="button" className="tableAction" disabled={saving} onClick={() => revokeGrant(grant.id)}>取消</button>
                  </div>
                ))}
                {!selectedGrants.length ? <p>暂无授权用户</p> : null}
              </div>
            </>
          ) : (
            <div className="emptyPanel">请选择交易实战课程</div>
          )}
        </section>
      </div>

      {seriesOpen ? (
        <div className="modalOverlay">
          <form className="adminModal courseModal" onSubmit={submitSeries}>
            <div className="modalHeader">
              <h2>{seriesForm.id ? "编辑交易实战课程系列" : "新建交易实战课程系列"}</h2>
              <button type="button" onClick={() => setSeriesOpen(false)}>×</button>
            </div>
            <div className="editForm courseModalBody">
              <label>系列名称<input value={seriesForm.title} onChange={(event) => setSeriesForm({ ...seriesForm, title: event.target.value })} placeholder="例如 财报季交易框架" /></label>
              <label>优先级<input type="number" min="1" value={seriesForm.sortOrder} onChange={(event) => setSeriesForm({ ...seriesForm, sortOrder: event.target.value })} placeholder="留空自动，数字越大越前" /></label>
              <label>展示状态<select value={seriesForm.progressStatus} onChange={(event) => setSeriesForm({ ...seriesForm, progressStatus: event.target.value as CourseSeries["progressStatus"] })}><option value="updating">更新中</option><option value="finished">已完结</option></select></label>
              <label>上架状态<select value={seriesForm.status} onChange={(event) => setSeriesForm({ ...seriesForm, status: event.target.value as CourseSeries["status"] })}><option value="draft">草稿</option><option value="published">上架</option></select></label>
              <label className="fullField">转化文案<textarea rows={4} value={seriesForm.summary} onChange={(event) => setSeriesForm({ ...seriesForm, summary: event.target.value })} placeholder="用于课程卡片和详情顶部" /></label>
              <label className="fullField">课程介绍<textarea rows={5} value={seriesForm.intro} onChange={(event) => setSeriesForm({ ...seriesForm, intro: event.target.value })} placeholder={"用于详情页下方介绍，支持 Markdown，例如：\n1. 第一条说明\n2. 第二条说明"} /></label>
              <div className="fullField courseCoverUpload">
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
            </div>
            <div className="modalActions">
              <button type="button" className="ghostButton" onClick={() => setSeriesOpen(false)}>取消</button>
              <button type="submit" className="primaryButton" disabled={saving || coverUploading}>{seriesForm.id ? "保存修改" : "保存系列"}</button>
            </div>
          </form>
        </div>
      ) : null}

      {lessonOpen && selected ? (
        <div className="modalOverlay">
          <form className="adminModal courseModal" onSubmit={submitLesson}>
            <div className="modalHeader">
              <h2>{lessonForm.id ? "编辑视频" : "添加视频"}</h2>
              <button type="button" onClick={() => setLessonOpen(false)}>×</button>
            </div>
            <div className="editForm courseModalBody">
              <label>视频标题<input value={lessonForm.title} onChange={(event) => setLessonForm({ ...lessonForm, title: event.target.value })} placeholder="例如 01 交易实战课程框架" /></label>
              <label>优先级<input type="number" min="1" value={lessonForm.sortOrder} onChange={(event) => setLessonForm({ ...lessonForm, sortOrder: event.target.value })} placeholder="留空自动，数字越大越前" /></label>
              <label>状态<select value={lessonForm.status} onChange={(event) => setLessonForm({ ...lessonForm, status: event.target.value as CourseLesson["status"] })}><option value="published">上架</option><option value="draft">草稿</option></select></label>
              <div className="fullField courseCoverUpload">
                <span>单节封面图</span>
                <div>
                  {lessonForm.coverUrl ? <img src={lessonForm.coverUrl} alt="" /> : <em>未上传</em>}
                  <section>
                    <button type="button" className="ghostButton" disabled={coverUploading} onClick={() => lessonCoverFileRef.current?.click()}>{coverUploading ? "上传中" : "上传封面"}</button>
                    <small>{lessonForm.coverUrl || "支持 PNG、JPG、WebP、GIF，上传到 COS"}</small>
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
              <div className="fullField courseVideoUpload">
                <button type="button" className="ghostButton" disabled={videoUploading} onClick={() => videoFileRef.current?.click()}>{videoUploading ? "上传中" : "上传视频"}</button>
                <span>{videoUploading ? `上传中 ${videoUploadProgress}%` : lessonForm.videoKey || "上传成功后自动保存视频，也可以手工粘贴 COS Key"}</span>
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
              <label className="fullField">COS Key<input value={lessonForm.videoKey} onChange={(event) => setLessonForm({ ...lessonForm, videoKey: event.target.value })} placeholder="courses/earnings/lesson-01.mp4" /></label>
            </div>
            <div className="modalActions">
              <button type="button" className="ghostButton" onClick={() => setLessonOpen(false)}>取消</button>
              <button type="submit" className="primaryButton" disabled={saving || videoUploading}>{lessonForm.id ? "保存修改" : "保存视频"}</button>
            </div>
          </form>
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
  const [message, setMessage] = useState("");
  const holdings = data?.holdings || [];
  const selectedHolding = holdings.find((item) => item.symbol === form.symbol);
  const setTradeSide = (side: "buy" | "sell") => {
    setForm({ ...form, side, symbol: side === "sell" ? holdings[0]?.symbol || "" : "", amount: "", quantity: "" });
  };
  const setSellQuantity = (ratio: number) => {
    if (!selectedHolding) return;
    setForm({ ...form, quantity: String(Math.floor(selectedHolding.quantity * ratio * 1000000) / 1000000) });
  };

  async function loadOpenPortfolio() {
    setLoading(true);
    setMessage("");
    try {
      setData(await api.openPortfolio());
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOpenPortfolio();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
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
      setForm({ tradeTime: localDateInputValue(), symbol: "", side: "buy", price: "", amount: "", quantity: "", note: "" });
      setMessage("已保存");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function removeTrade(id: number) {
    if (!window.confirm("删除这笔交易记录？")) return;
    setSaving(true);
    setMessage("");
    try {
      await api.deleteOpenTrade(id);
      await loadOpenPortfolio();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "删除失败");
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

      {message ? <div className="notice inlineNotice">{message}</div> : null}
      {loading ? <div className="contentLoading inlineNotice">读取中</div> : null}

      <div className="statsGrid">
        <StatCard label="初始资金" value={adminMoney(data?.initialCapital)} />
        <StatCard label="当前资金" value={adminMoney(data?.equity)} />
        <StatCard label="已实现收益" value={signedMoney(data?.realizedPnl)} tone={(data?.realizedPnl || 0) >= 0 ? "positive" : "dangerText"} />
        <StatCard label="当前持仓" value={data?.holdings.length ?? "--"} note={`交易 ${data?.trades.length ?? "--"} 笔`} />
      </div>

      <section className="panel">
        <div className={`panelHeader openTradeHeader ${form.side === "sell" ? "sell" : "buy"}`}>
          <h2>{form.side === "buy" ? "买入" : "卖出"}</h2>
          <div className="tradeSideButtons">
            <button type="button" className={form.side === "buy" ? "active buy" : "buy"} onClick={() => setTradeSide("buy")}>买入</button>
            <button type="button" className={form.side === "sell" ? "active sell" : "sell"} onClick={() => setTradeSide("sell")}>卖出</button>
          </div>
        </div>
        <form className={`openTradeForm ${form.side === "sell" ? "sellForm" : ""}`} onSubmit={submit}>
          <label>日期<input type="date" value={form.tradeTime} onChange={(event) => setForm({ ...form, tradeTime: event.target.value })} /></label>
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
            <label>买入金额<input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="2000000" /></label>
          ) : (
            <label>卖出数量
              <div className="quantityInput">
                <input type="number" min="0" max={selectedHolding?.quantity || undefined} step="0.000001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} placeholder={selectedHolding ? String(selectedHolding.quantity) : ""} />
                <button type="button" onClick={() => setSellQuantity(1 / 3)}>1/3</button>
                <button type="button" onClick={() => setSellQuantity(1 / 2)}>半仓</button>
                <button type="button" onClick={() => setSellQuantity(1)}>全卖</button>
              </div>
            </label>
          )}
          <label>备注<input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
          <button className={`tradeSubmit ${form.side}`} type="submit" disabled={saving}>{saving ? "保存中" : form.side === "buy" ? "确认买入" : "确认卖出"}</button>
        </form>
      </section>

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
                  <td>{row.quantity.toLocaleString("zh-CN", { maximumFractionDigits: 6 })}</td>
                  <td><button type="button" className="tableAction dangerAction" onClick={() => setForm({ tradeTime: localDateInputValue(), symbol: row.symbol, side: "sell", price: "", amount: "", quantity: "", note: "" })}>卖出</button></td>
                </tr>
              ))}
              {!data?.holdings.length ? <tr><td colSpan={6}>暂无持仓</td></tr> : null}
            </tbody>
          </table>
        </section>

        <section className="panel tablePanel">
          <div className="panelHeader"><h2>交易历史</h2></div>
          <table className="adminTable">
            <thead><tr><th>日期</th><th>标的</th><th>方向</th><th>价格</th><th>数量</th><th>金额</th><th>已实现</th><th>操作</th></tr></thead>
            <tbody>
              {data?.trades.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.tradeTime)}</td>
                  <td><strong>{row.symbol}</strong></td>
                  <td><span className={`status ${row.side === "buy" ? "positiveBg" : "dangerBg"}`}>{row.side === "buy" ? "买入" : "卖出"}</span></td>
                  <td>{adminPrice(row.price)}</td>
                  <td>{row.quantity.toLocaleString("zh-CN", { maximumFractionDigits: 6 })}</td>
                  <td>{adminMoney(row.amount)}</td>
                  <td className={row.realizedPnl >= 0 ? "positive" : "dangerText"}>{row.side === "sell" ? signedMoney(row.realizedPnl) : "--"}</td>
                  <td><button type="button" className="tableAction dangerAction" disabled={saving} onClick={() => removeTrade(row.id)}>删除</button></td>
                </tr>
              ))}
              {!data?.trades.length ? <tr><td colSpan={8}>暂无交易记录</td></tr> : null}
            </tbody>
          </table>
        </section>
      </div>
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
      const day = (event.createdAt || "").slice(0, 10);
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
      <div className="pageTitle">
        <div>
          <span>后台</span>
          <h1>操作记录</h1>
        </div>
      </div>

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
                  <td className="eventSummary"><LastUserEventCell event={event} /></td>
                  <td><EventPersonCell email={event.actor.email} label={event.actor.role ? roleLabels[event.actor.role] || event.actor.role : ""} /></td>
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
      <div className="pageTitle">
        <div>
          <span>后台</span>
          <h1>管理员权限</h1>
        </div>
      </div>

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
                <td className="eventSummary"><LastUserEventCell event={event} /></td>
                <td><EventPersonCell email={event.actor.email} label={event.actor.role ? roleLabels[event.actor.role] || event.actor.role : ""} /></td>
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
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const isCreating = selectedId === newOpinionId;
  const currentStatus = isCreating ? "未保存" : form.status === "published" ? "已发布" : "草稿";
  const currentSnapshot = opinionEditSnapshot(form, symbolsText, topicsText, highlightsText);
  const hasUnsavedChanges = Boolean(savedSnapshot) && currentSnapshot !== savedSnapshot;
  const listTotalPages = Math.max(1, Math.ceil(listTotal / contentPageSize));
  const visibleItems = items;

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

  function confirmDiscardChanges() {
    if (!hasUnsavedChanges) return true;
    return window.confirm("当前内容还没保存，确定放弃修改？");
  }

  function createNew() {
    if (!confirmDiscardChanges()) return;
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
    if (!confirmDiscardChanges()) return;
    setListPage(1);
    setSection(nextSection);
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

  async function remove() {
    if (!form.id) return;
    if (hasUnsavedChanges && !window.confirm("当前内容有未保存修改，仍然删除这篇内容？")) return;
    if (!window.confirm("确认删除这篇内容？")) return;
    setSaving(true);
    setMessageTone("info");
    setMessage("");
    try {
      await api.deleteOpinion(form.id);
      setMessageTone("info");
      setMessage("已删除");
      createNew();
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
      <div className="pageTitle">
        <div>
          <span>内容管理</span>
          <h1>美股热点风向标</h1>
        </div>
        <button type="button" className="primaryButton" onClick={createNew}>新建内容</button>
      </div>

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
                if (!confirmDiscardChanges()) return;
                selectOpinion(item);
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
          {message ? <p className={`editorNotice ${messageTone === "error" ? "errorNotice" : ""}`}>{message}</p> : null}

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
            <button type="button" className="dangerButton" disabled={saving || !form.id} onClick={remove}>删除</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    self_register: "用户注册",
    update_user: "修改用户/会员",
    reset_password: "账号操作"
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadData() {
    setError("");
    setLoading(true);
    try {
      const [userPayload, eventPayload, metricsPayload] = await Promise.all([api.users(), api.events(), api.metrics()]);
      setUsers(userPayload.users || []);
      setEvents(eventPayload.rows || []);
      setMetrics(metricsPayload);
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
          <div>
            <strong>懂币猫后台</strong>
            <span>Admin Console</span>
          </div>
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
          <h1>{pageLabel}</h1>
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
        {page === "home" ? <HomePage users={users} events={events} metrics={metrics} /> : null}
        {page === "users" ? <UsersPage users={users} events={events} currentUser={auth.user} onRefresh={loadData} /> : null}
        {page === "members" ? <MembersPage users={users} events={events} onRefresh={loadData} /> : null}
        {page === "content" ? <ContentPage /> : null}
        {page === "open" ? <OpenPortfolioPage /> : null}
        {page === "courses" ? <CoursesPage users={users} /> : null}
        {page === "events" ? <EventsPage events={events} /> : null}
        {page === "admins" ? <AdminsPage users={users} events={events} /> : null}
      </section>
    </div>
  );
}

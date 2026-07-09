export function isBlankValue(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return true;
  return ["null", "undefined", "none", "nan"].includes(String(value).trim().toLowerCase());
}

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

export function formatDate(value?: string | null) {
  if (isBlankValue(value)) return "--";
  const parts = beijingParts(value);
  if (parts) return parts.date;
  return String(value).slice(0, 10);
}

export function formatDateTime(value?: string | null) {
  if (isBlankValue(value)) return "--";
  const parts = beijingParts(value);
  if (parts) return `${parts.date} ${parts.time}`;
  const text = String(value).replace("T", " ").slice(0, 19);
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text)) return text;
  const dateText = formatDate(value);
  return dateText === "--" ? "--" : `${dateText} 00:00:00`;
}

export function formatStoredDateTime(value?: string | null) {
  if (isBlankValue(value)) return "--";
  const parts = beijingParts(value);
  if (parts) return `${parts.date} ${parts.time}`;
  const text = String(value).replace("T", " ").slice(0, 19);
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(text)) return `${text}:00`;
  return formatDate(value);
}

export function signed(value?: number | string | null) {
  if (isBlankValue(value)) return "--";
  const n = typeof value === "number" ? value : Number(String(value).replace("%", "").replace("+", ""));
  if (!Number.isFinite(n)) return "--";
  return `${n > 0 ? "+" : ""}${n.toFixed(Math.abs(n) >= 10 ? 1 : 2)}%`;
}

export function signedClass(value?: number | string | null) {
  if (isBlankValue(value)) return "";
  const n = typeof value === "number" ? value : Number(String(value || "").replace("%", "").replace("+", ""));
  if (!Number.isFinite(n)) return "";
  return n >= 0 ? "positive" : "negative";
}

export function normalizeDirectionLabel(label?: string | null) {
  if (isBlankValue(label)) return "无信号";
  const raw = String(label || "").toLowerCase();
  if (raw.includes("空") || raw.includes("short")) return "空头";
  if (raw.includes("多") || raw.includes("long")) return "多头";
  return "无信号";
}

export function trackingDirection(row?: { signalDirection?: string | null; signalDirectionText?: string | null }) {
  return normalizeDirectionLabel(`${row?.signalDirectionText || ""} ${row?.signalDirection || ""}`);
}

export function trackingDirectionClass(value?: string | null) {
  const text = normalizeDirectionLabel(value);
  if (text === "多头") return "long";
  if (text === "空头") return "short";
  return "none";
}

export function SignalDirectionBadge({ label }: { label?: string | null }) {
  const text = normalizeDirectionLabel(label);
  return <span className={`signalDirectionBadge ${trackingDirectionClass(text)}`}>{text}</span>;
}

export function MaskedValue({ value }: { value?: string | number | null }) {
  return (
    <span className="frontMaskedValue" aria-label="会员内容">
      <span>{isBlankValue(value) ? "--" : value}</span>
      <i aria-hidden="true" />
    </span>
  );
}

export function LockedStockName({ symbol, name }: { symbol: string; name?: string }) {
  return (
    <span className="lockedStockName" aria-label="会员内容">
      <b>{symbol}</b>
      <small>{name || symbol}</small>
      <i aria-hidden="true" />
    </span>
  );
}

export function ratioDisplay(value?: number | string | null) {
  if (isBlankValue(value)) return "--";
  if (typeof value === "string" && value.trim().endsWith("x")) return value.trim();
  const n = typeof value === "number" ? value : Number(String(value).replace("x", ""));
  if (!Number.isFinite(n)) return "--";
  return `${n.toFixed(1)}x`;
}

export function capLabel(value?: number | null) {
  if (!Number.isFinite(value || NaN)) return "--";
  const n = Number(value);
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return String(Math.round(n));
}

export function marketCapDisplay(row?: { marketCap?: string; marketCapValue?: number | null; sector?: string }) {
  if (!row) return "--";
  if (!isBlankValue(row.marketCap) && row.marketCap !== "--") return row.marketCap;
  const valueLabel = capLabel(row.marketCapValue);
  if (valueLabel !== "--") return valueLabel;
  if (row.sector?.includes("ETF")) return "ETF";
  return "--";
}

export function money(value?: number) {
  if (!Number.isFinite(value || NaN)) return "--";
  const n = Number(value);
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function priceDisplay(value?: number | string | null) {
  if (isBlankValue(value)) return "--";
  const n = typeof value === "number" ? value : Number(String(value || "").replace("$", "").replace(",", ""));
  if (!Number.isFinite(n)) return "--";
  return `$${n.toFixed(2)}`;
}

export function compactMoney(value?: number | null) {
  if (!Number.isFinite(value || NaN)) return "--";
  const n = Number(value);
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function moneyNumber(value?: number | string | null) {
  if (typeof value === "number") return value;
  if (isBlankValue(value)) return 0;
  const raw = String(value || "").replace("$", "").replaceAll(",", "").trim();
  if (!raw || raw === "--") return 0;
  const unit = raw.slice(-1).toUpperCase();
  const n = Number(unit.match(/[BMT]/) ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(n)) return 0;
  if (unit === "T") return n * 1e12;
  if (unit === "B") return n * 1e9;
  if (unit === "M") return n * 1e6;
  return n;
}

export function inputMoneyNumber(value: string) {
  const n = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(n) ? n : NaN;
}

export function exactMoney(value?: number | null, digits = 2) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  return `$${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`;
}

export function signedExactMoney(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${exactMoney(Math.abs(value))}`;
}

export function exactPercent(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  return `${Number(value).toFixed(2)}%`;
}

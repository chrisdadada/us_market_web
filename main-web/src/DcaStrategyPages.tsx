import { useEffect, useMemo, useState } from "react";
import { api, type DcaStrategiesPayload, type DcaStrategyProduct } from "./api";
import "./dcaStrategy.css";

type ProductKey = "dca1" | "dca2";
type Point = { date: string; value: number };

const productCopy = {
  dca1: {
    title: "纳指定投 1 号",
    subtitle: "低位布局型 · 进入历史低位区后分批投入",
    phases: ["等待机会", "接近低位", "定投窗口"],
    lockedTitle: "查看是否进入定投窗口",
    method: "分批投入",
    methodNote: "覆盖一段低位区域"
  },
  dca2: {
    title: "纳指定投 2 号",
    subtitle: "反转确认型 · 等市场确认止跌后再分批投入",
    phases: ["继续等待", "接近信号", "定投窗口"],
    lockedTitle: "查看是否出现定投机会",
    method: "确认后分批",
    methodNote: "减少过早介入"
  }
} as const;

function sample<T>(points: T[], maximum = 520) {
  if (points.length <= maximum) return points;
  const step = (points.length - 1) / (maximum - 1);
  return Array.from({ length: maximum }, (_, index) => points[Math.round(index * step)]);
}

function nearest(points: Point[], date: string) {
  const target = Date.parse(date);
  if (!Number.isFinite(target) || !points.length) return null;
  return points.reduce((best, point) => Math.abs(Date.parse(point.date) - target) < Math.abs(Date.parse(best.date) - target) ? point : best);
}

function year(value?: string | null) {
  return value?.slice(0, 4) || "--";
}

function OpportunityChart({ product, kind }: { product: DcaStrategyProduct; kind: ProductKey }) {
  const chart = useMemo(() => {
    const location = sample(product.locationSeries.map((item) => ({ date: item.date, value: item.position })));
    const prices = sample(product.priceSeries || []);
    const dated = [...location, ...prices].filter((point) => Number.isFinite(Date.parse(point.date)));
    if (prices.length < 2 || (kind === "dca1" && location.length < 2)) return null;
    const start = Math.min(...dated.map((point) => Date.parse(point.date)));
    const end = Math.max(...dated.map((point) => Date.parse(point.date)));
    const span = end - start || 1;
    const width = 1000;
    const height = kind === "dca1" ? 420 : 320;
    const left = 58;
    const right = 22;
    const x = (date: string) => left + ((Date.parse(date) - start) / span) * (width - left - right);
    const priceValues = prices.map((point) => point.value);
    const priceMin = Math.min(...priceValues);
    const priceMax = Math.max(...priceValues);
    const priceSpan = priceMax - priceMin || 1;
    const priceTop = kind === "dca1" ? 250 : 32;
    const priceBottom = kind === "dca1" ? 374 : 275;
    const priceY = (value: number) => priceBottom - ((value - priceMin) / priceSpan) * (priceBottom - priceTop);
    const locationTop = 30;
    const locationBottom = 190;
    const locationY = (value: number) => locationBottom - (Math.max(0, Math.min(100, value)) / 100) * (locationBottom - locationTop);
    const path = (points: Point[], y: (value: number) => number) => points.map((point, index) => `${index ? "L" : "M"}${x(point.date).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
    const opportunityPoints = product.opportunityDates.map((date) => ({ date, price: nearest(prices, date), location: nearest(location, date) })).filter((item) => item.price);
    return { width, height, left, right, start, end, x, prices, location, priceMin, priceMax, priceY, locationY, priceTop, priceBottom, pricePath: path(prices, priceY), locationPath: path(location, locationY), opportunityPoints };
  }, [kind, product]);

  if (!chart) return <div className="dcaChartEmpty">历史位置正在更新</div>;
  const years = Array.from(new Set([year(new Date(chart.start).toISOString()), year(new Date((chart.start + chart.end) / 2).toISOString()), year(new Date(chart.end).toISOString())]));
  const boundary = product.lowBoundaryPosition;

  return (
    <div className="dcaChartScroll">
      <svg className="dcaChart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="历史机会位置">
        {kind === "dca1" ? (
          <>
            {Number.isFinite(boundary) ? <rect className="dcaLowZone" x={chart.left} y={chart.locationY(Number(boundary))} width={chart.width - chart.left - chart.right} height={190 - chart.locationY(Number(boundary))} /> : null}
            {[0, 25, 50, 75, 100].map((value) => <line key={value} className="dcaGrid" x1={chart.left} y1={chart.locationY(value)} x2={chart.width - chart.right} y2={chart.locationY(value)} />)}
            <text className="dcaAxis" x="14" y={chart.locationY(100) + 3}>高位</text>
            <text className="dcaAxis" x="14" y={chart.locationY(50) + 3}>中位</text>
            <text className="dcaAxis" x="14" y={chart.locationY(0) + 3}>低位</text>
            <path className="dcaLocationLine" d={chart.locationPath} />
            {chart.opportunityPoints.map((item) => item.location ? <circle key={`location-${item.date}`} className="dcaSignalDot" cx={chart.x(item.date)} cy={chart.locationY(item.location.value)} r="5" /> : null)}
            <line className="dcaDivider" x1={chart.left} y1="220" x2={chart.width - chart.right} y2="220" />
            <text className="dcaAxis" x="14" y="286">QQQ</text>
          </>
        ) : null}
        {[0, 0.5, 1].map((ratio) => {
          const value = chart.priceMax - (chart.priceMax - chart.priceMin) * ratio;
          const yPos = chart.priceY(value);
          return <g key={ratio}><line className="dcaGrid" x1={chart.left} y1={yPos} x2={chart.width - chart.right} y2={yPos} /><text className="dcaAxis" x="12" y={yPos + 3}>{Math.round(value)}</text></g>;
        })}
        <path className="dcaPriceLine" d={chart.pricePath} />
        {chart.opportunityPoints.map((item) => <g key={`price-${item.date}`}><circle className="dcaSignalDot" cx={chart.x(item.date)} cy={chart.priceY(item.price!.value)} r="5" /><title>{item.date}</title></g>)}
        {years.map((item, index) => {
          const position = index === 0 ? chart.left : index === years.length - 1 ? chart.width - chart.right : (chart.left + chart.width - chart.right) / 2;
          return <text key={item} className={`dcaAxis dcaDate ${index === years.length - 1 ? "end" : ""}`} x={position} y={chart.height - 10}>{item}</text>;
        })}
      </svg>
    </div>
  );
}

function StrategyPage({ kind, unlocked, authenticated, onAuth, onUnlock }: { kind: ProductKey; unlocked: boolean; authenticated: boolean; onAuth: () => void; onUnlock: () => void }) {
  const copy = productCopy[kind];
  const [payload, setPayload] = useState<DcaStrategiesPayload | null>(null);
  const [loading, setLoading] = useState(authenticated);
  const [error, setError] = useState("");

  const load = () => {
    if (!authenticated) return;
    setLoading(true);
    setError("");
    api.dcaStrategies().then(setPayload).catch((reason) => setError(reason?.message || "产品数据加载失败")).finally(() => setLoading(false));
  };

  useEffect(load, [authenticated]);
  const product = payload?.products[kind];

  if (!authenticated) return <div className="dcaPage"><div className="dcaPageState"><strong>登录后查看定投产品</strong><button type="button" onClick={onAuth}>登录 / 注册</button></div></div>;
  if (loading) return <div className="dcaPage"><div className="dcaPageState">正在加载</div></div>;
  if (error || !product) return <div className="dcaPage"><div className="dcaPageState"><span>{error || "产品数据暂不可用"}</span><button type="button" onClick={load}>重新加载</button></div></div>;

  const status = product.status;
  const opportunityDates = [...product.opportunityDates].sort();
  const firstOpportunity = opportunityDates[0];
  const lastOpportunity = opportunityDates.at(-1);
  const countLabel = product.opportunityDates.length ? `${product.opportunityDates.length} 处` : "--";

  return (
    <div className="dcaPage" data-testid={`${kind}-strategy-page`}>
      <header className="dcaHeader">
        <div><h1>{copy.title}</h1><p>{copy.subtitle}</p></div>
        <div><span>更新 {product.asOf || "--"}</span>{!unlocked ? <button type="button" onClick={onUnlock}>开通会员</button> : null}</div>
      </header>

      <section className="dcaPanel">
        <div className="dcaProgress">
          {copy.phases.map((phase, index) => <div key={phase} className={unlocked && status?.position === index ? "current" : ""}>{phase}</div>)}
        </div>
        <div className="dcaSummary">
          <div className={`dcaCurrent ${!unlocked ? "locked" : ""}`}>
            <div className="dcaCurrentContent"><small>今日状态</small><strong>{status?.headline || "状态已更新"}</strong><p>{status?.action || "当前阶段和行动建议"}</p></div>
            {!unlocked ? <div className="dcaGate"><small>今日状态已更新</small><strong>{copy.lockedTitle}</strong><button type="button" onClick={onUnlock}>开通会员查看</button></div> : null}
          </div>
          <div><small>{kind === "dca2" ? "最近机会" : "最近更新"}</small><b>{kind === "dca2" ? lastOpportunity || "--" : product.asOf || "--"}</b><p>{kind === "dca2" ? status?.key === "action" ? "当前机会已出现" : "当前等待新机会" : "交易日收盘后"}</p></div>
          <div><small>历史机会位置</small><b>{countLabel}</b><p>{firstOpportunity ? `${year(firstOpportunity)} 年至今` : "随数据持续更新"}</p></div>
          <div><small>产品方式</small><b>{copy.method}</b><p>{copy.methodNote}</p></div>
        </div>
        <div className="dcaChartHead"><strong>历史机会位置</strong><div><span>红点：历史机会</span>{kind === "dca1" ? <span>绿色：低位区域</span> : null}</div></div>
        <OpportunityChart product={product} kind={kind} />
        <div className="dcaBenefits">
          <div><small>交易日更新</small><strong>查看当前所处阶段</strong><p>状态随市场变化持续更新。</p></div>
          <div><small>会员可见</small><strong>查看今日行动建议</strong><p>知道现在该等待还是分批投入。</p></div>
          <div><small>分批执行</small><strong>覆盖一段机会区间</strong><p>用户自行决定投入金额与节奏。</p></div>
        </div>
      </section>
    </div>
  );
}

export function ValueDcaPage(props: Omit<Parameters<typeof StrategyPage>[0], "kind">) {
  return <StrategyPage {...props} kind="dca1" />;
}

export function ReversalDcaPage(props: Omit<Parameters<typeof StrategyPage>[0], "kind">) {
  return <StrategyPage {...props} kind="dca2" />;
}

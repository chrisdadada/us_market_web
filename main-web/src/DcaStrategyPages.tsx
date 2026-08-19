import { useEffect, useMemo, useState } from "react";
import { api, type DcaStrategiesPayload, type DcaStrategyProduct } from "./api";
import "./dcaStrategy.css";

type ProductKey = "dca1" | "dca2";
type Point = { date: string; value: number };
type StatusKey = NonNullable<DcaStrategyProduct["status"]>["key"];

const productCopy = {
  dca1: {
    title: "纳指定投 1 号",
    subtitle: "适合希望分批把握低位机会的人",
    phases: ["等待机会", "接近低位", "开始分批"],
    lockedTitle: "开通查看今日建议",
    chartTitle: "QQQ 走势与历史机会",
    opportunityText: "进入机会区"
  },
  dca2: {
    title: "纳指定投 2 号",
    subtitle: "适合希望等市场企稳后再分批投入的人",
    phases: ["继续等待", "接近机会", "开始分批"],
    lockedTitle: "开通查看今日建议",
    chartTitle: "QQQ 走势与确认机会",
    opportunityText: "机会确认"
  }
} as const;

const statusCopy: Record<ProductKey, Record<StatusKey, { title: string; detail: string; today: string; next: string; planNote: string; watchNote: string }>> = {
  dca1: {
    waiting: { title: "继续等待", detail: "当前尚未进入分批区间", today: "保持原有节奏", next: "等待进入机会区", planNote: "现在不用一次买入，也不需要提前猜底。", watchNote: "进入合适阶段后，再开始分批投入。" },
    near: { title: "接近低位", detail: "可以继续观察市场变化", today: "保持关注", next: "等待进入分批区", planNote: "接近低位阶段，暂时不用加快投入。", watchNote: "进入机会区后，再按计划分批投入。" },
    action: { title: "可以开始分批", detail: "当前已进入分批区间", today: "按计划分批投入", next: "控制每次投入节奏", planNote: "分批执行，不必一次买完。", watchNote: "关注后续阶段变化，避免追高。" }
  },
  dca2: {
    waiting: { title: "继续观察", detail: "市场尚未出现新的确认机会", today: "暂不加快投入", next: "等待市场确认", planNote: "市场还在等待确认，不需要提前行动。", watchNote: "确认出现后，再按计划分批投入。" },
    near: { title: "接近机会", detail: "市场正在接近确认阶段", today: "保持关注", next: "等待机会确认", planNote: "继续观察，不必提前增加投入。", watchNote: "确认出现后，再开始分批投入。" },
    action: { title: "可以开始分批", detail: "市场已经出现确认机会", today: "按计划分批投入", next: "控制每次投入节奏", planNote: "确认后分批执行，不必一次买完。", watchNote: "关注后续阶段变化，避免追高。" }
  }
};

function sample<T>(points: T[], maximum = 520) {
  if (points.length <= maximum) return points;
  const step = (points.length - 1) / (maximum - 1);
  return Array.from({ length: maximum }, (_, index) => points[Math.round(index * step)]);
}

function nearest(points: Point[], date: string) {
  const target = Date.parse(date);
  if (!Number.isFinite(target) || !points.length) return null;
  const match = points.reduce((best, point) => Math.abs(Date.parse(point.date) - target) < Math.abs(Date.parse(best.date) - target) ? point : best);
  return Math.abs(Date.parse(match.date) - target) <= 7 * 24 * 60 * 60 * 1000 ? match : null;
}

function year(value?: string | null) {
  return value?.slice(0, 4) || "--";
}

function OpportunityChart({ product, kind }: { product: DcaStrategyProduct; kind: ProductKey }) {
  const chart = useMemo(() => {
    const prices = sample((product.priceSeries || []).filter((point) => Number.isFinite(Date.parse(point.date)) && Number.isFinite(point.value)));
    if (prices.length < 2) return null;
    const start = Date.parse(prices[0].date);
    const end = Date.parse(prices.at(-1)!.date);
    const span = end - start || 1;
    const width = 1000;
    const height = 360;
    const left = 58;
    const right = 24;
    const top = 30;
    const bottom = 310;
    const x = (date: string) => left + ((Date.parse(date) - start) / span) * (width - left - right);
    const priceValues = prices.map((point) => point.value);
    const rawMin = Math.min(...priceValues);
    const rawMax = Math.max(...priceValues);
    const padding = Math.max((rawMax - rawMin) * 0.08, 1);
    const priceMin = rawMin - padding;
    const priceMax = rawMax + padding;
    const priceSpan = priceMax - priceMin || 1;
    const priceY = (value: number) => bottom - ((value - priceMin) / priceSpan) * (bottom - top);
    const pricePath = prices.map((point, index) => `${index ? "L" : "M"}${x(point.date).toFixed(1)},${priceY(point.value).toFixed(1)}`).join(" ");
    const opportunityPoints = [...product.opportunityDates]
      .sort()
      .map((date) => ({ date, price: nearest(prices, date) }))
      .filter((item): item is { date: string; price: Point } => Boolean(item.price));
    return { width, height, left, right, top, bottom, start, end, x, prices, priceMin, priceMax, priceY, pricePath, opportunityPoints };
  }, [product]);

  if (!chart) return <div className="dcaChartEmpty">暂时无法显示行情</div>;
  const years = [year(new Date(chart.start).toISOString()), year(new Date((chart.start + chart.end) / 2).toISOString()), year(new Date(chart.end).toISOString())];
  const current = chart.prices.at(-1)!;

  return (
    <div className="dcaChartScroll">
      <svg className="dcaChart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={productCopy[kind].chartTitle}>
        {chart.opportunityPoints.map((item) => (
          <rect key={`band-${item.date}`} className={`dcaOpportunityBand ${kind}`} x={Math.max(chart.left, chart.x(item.date) - 8)} y={chart.top} width="16" height={chart.bottom - chart.top} rx="3" />
        ))}
        {[0, 1 / 3, 2 / 3, 1].map((ratio) => {
          const value = chart.priceMax - (chart.priceMax - chart.priceMin) * ratio;
          const yPos = chart.priceY(value);
          return <g key={ratio}><line className="dcaGrid" x1={chart.left} y1={yPos} x2={chart.width - chart.right} y2={yPos} /><text className="dcaAxis" x="10" y={yPos + 3}>{Math.round(value)}</text></g>;
        })}
        <path className="dcaPriceLine" d={chart.pricePath} />
        {chart.opportunityPoints.map((item) => (
          <g key={`price-${item.date}`}>
            <circle className={`dcaOpportunityDot ${kind}`} cx={chart.x(item.date)} cy={chart.priceY(item.price.value)} r="6" />
            <title>{item.date}</title>
          </g>
        ))}
        <circle className="dcaCurrentDot" cx={chart.x(current.date)} cy={chart.priceY(current.value)} r="6" />
        <text className="dcaCurrentLabel" x={chart.x(current.date) - 6} y={Math.max(18, chart.priceY(current.value) - 12)}>当前</text>
        {years.map((item, index) => {
          const position = index === 0 ? chart.left : index === years.length - 1 ? chart.width - chart.right : (chart.left + chart.width - chart.right) / 2;
          return <text key={`${item}-${index}`} className={`dcaAxis dcaDate ${index === years.length - 1 ? "end" : ""}`} x={position} y={chart.height - 10}>{item}</text>;
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
    api.dcaStrategies().then(setPayload).catch(() => setError("页面暂时无法打开")).finally(() => setLoading(false));
  };

  useEffect(load, [authenticated]);
  const product = payload?.products[kind];

  if (!authenticated) return <div className="dcaPage"><div className="dcaPageState"><strong>登录后查看定投产品</strong><button type="button" onClick={onAuth}>登录 / 注册</button></div></div>;
  if (loading) return <div className="dcaPage"><div className="dcaPageState">正在加载</div></div>;
  if (error || !product) return <div className="dcaPage"><div className="dcaPageState"><span>{error || "页面暂时无法打开"}</span><button type="button" onClick={load}>重新加载</button></div></div>;

  const statusKey = product.status?.key || "waiting";
  const presentation = statusCopy[kind][statusKey];
  const opportunityDates = [...product.opportunityDates].sort();
  const lastOpportunity = opportunityDates.at(-1);
  const currentStep = unlocked ? product.status?.position ?? 0 : -1;

  return (
    <div className="dcaPage" data-testid={`${kind}-strategy-page`}>
      <header className="dcaHeader">
        <div><h1>{copy.title}</h1><p>{copy.subtitle}</p></div>
        <div><span>更新 {product.asOf || "--"}</span>{!unlocked ? <button type="button" onClick={onUnlock}>开通会员</button> : null}</div>
      </header>

      <section className={`dcaDecision ${kind}`}>
        <div className={`dcaDecisionMain ${!unlocked ? "locked" : ""}`}>
          <div className="dcaDecisionContent"><small>今日建议</small><strong>{presentation.title}</strong><p>{presentation.detail}</p></div>
          {!unlocked ? <div className="dcaGate"><small>今日状态已更新</small><strong>{copy.lockedTitle}</strong><button type="button" onClick={onUnlock}>开通会员查看</button></div> : null}
        </div>
        <div className="dcaStage">
          <small>当前阶段</small>
          <div className="dcaProgress">{copy.phases.map((phase, index) => <div key={phase} className={currentStep === index ? "current" : ""}>{phase}</div>)}</div>
          <div className="dcaStageMeta">
            <div><span>上次机会</span><strong>{lastOpportunity || "--"}</strong></div>
            <div><span>今天怎么做</span><strong>{unlocked ? presentation.today : "开通查看"}</strong></div>
            <div><span>下一步</span><strong>{unlocked ? presentation.next : "开通查看"}</strong></div>
          </div>
        </div>
      </section>

      <div className="dcaContentGrid">
        <section className="dcaPanel dcaChartPanel">
          <div className="dcaPanelHead"><strong>{copy.chartTitle}</strong><span>当前 · {product.asOf || "--"}</span></div>
          <OpportunityChart product={product} kind={kind} />
        </section>
        <section className={`dcaPanel dcaAdvice ${!unlocked ? "locked" : ""}`}>
          <div><small>今日计划</small><strong>{unlocked ? product.status?.action || presentation.today : "今日计划已更新"}</strong><p>{presentation.planNote}</p></div>
          <div><small>接下来关注</small><strong>{presentation.next}</strong><p>{presentation.watchNote}</p></div>
          {!unlocked ? <button type="button" onClick={onUnlock}>开通查看完整建议</button> : null}
        </section>
      </div>

      {opportunityDates.length ? (
        <section className={`dcaPanel dcaHistory ${kind}`}>
          <div className="dcaPanelHead"><strong>过去的机会</strong></div>
          <div className="dcaTimeline">{opportunityDates.map((date) => <div key={date}><time>{date}</time><span>{copy.opportunityText}</span></div>)}</div>
        </section>
      ) : null}
    </div>
  );
}

export function ValueDcaPage(props: Omit<Parameters<typeof StrategyPage>[0], "kind">) {
  return <StrategyPage {...props} kind="dca1" />;
}

export function ReversalDcaPage(props: Omit<Parameters<typeof StrategyPage>[0], "kind">) {
  return <StrategyPage {...props} kind="dca2" />;
}

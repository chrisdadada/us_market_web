import { useEffect, useMemo, useState } from "react";
import { api, type DcaStrategiesPayload, type DcaStrategyProduct } from "./api";
import "./dcaStrategy.css";

type ProductKey = "dca1" | "dca2";
type Point = { date: string; value: number };
type StatusKey = NonNullable<DcaStrategyProduct["status"]>["key"];

const productCopy = {
  dca1: {
    title: "纳指定投 1 号",
    subtitle: "偏低位时分批买",
    phases: ["观察中", "接近区间", "分批买入"],
    lockedTitle: "开通查看操作参考",
    chartTitle: "QQQ 走势与历史机会",
    legend: { band: "机会区", point: "机会日" },
    lastOpportunityLabel: "上次进入"
  },
  dca2: {
    title: "纳指定投 2 号",
    subtitle: "行情确认后分批买入",
    phases: ["观察中", "接近机会", "分批买入"],
    lockedTitle: "开通查看操作参考",
    chartTitle: "QQQ 走势与历史机会",
    legend: { band: "机会区", point: "机会日" },
    lastOpportunityLabel: "上次机会"
  }
} as const;

const statusCopy: Record<ProductKey, Record<StatusKey, { title: string; detail: string; action: string }>> = {
  dca1: {
    waiting: { title: "等待机会", detail: "暂不买入", action: "暂不买入" },
    near: { title: "接近分批区", detail: "暂不买入", action: "暂不买入" },
    action: { title: "可以开始分批", detail: "按计划分批买入", action: "分批买入" }
  },
  dca2: {
    waiting: { title: "等待确认", detail: "暂不买入", action: "暂不买入" },
    near: { title: "接近机会", detail: "暂不买入", action: "暂不买入" },
    action: { title: "可以开始分批", detail: "按计划分批买入", action: "分批买入" }
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

function percent(value?: number | null) {
  if (!Number.isFinite(value)) return "--";
  return `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(1)}%`;
}

function metricTone(value?: number | null) {
  if (!Number.isFinite(value)) return "pending";
  if (Number(value) > 0) return "positive";
  if (Number(value) < 0) return "negative";
  return "neutral";
}

function HistorySection({ history }: { history: DcaStrategyProduct["history"] }) {
  if (!history?.totalOpportunities || !history.records.length) return null;
  const show30 = history.records.some((record) => Number.isFinite(record.max30Pct));
  const show60 = history.records.some((record) => Number.isFinite(record.max60Pct));
  const show180 = history.records.some((record) => Number.isFinite(record.end180Pct));
  const summaryCount = 1 + Number(Number.isFinite(history.max60MedianPct)) + Number(Number.isFinite(history.end180MedianPct));

  return (
    <section className="dcaHistory" data-testid="dca-history">
      <div className="dcaHistoryHead"><strong>历史数据</strong></div>
      <div className={`dcaHistorySummary count${summaryCount}`}>
        <div><span>历史机会</span><strong>{history.totalOpportunities} 次</strong><small>{history.sinceYear ? `${history.sinceYear} 年至今` : ""}</small></div>
        {Number.isFinite(history.max60MedianPct) ? <div><span>60 日内最高涨幅</span><strong className={metricTone(history.max60MedianPct)}>{percent(history.max60MedianPct)}</strong><small>中位数</small></div> : null}
        {Number.isFinite(history.end180MedianPct) ? <div><span>180 日后涨幅</span><strong className={metricTone(history.end180MedianPct)}>{percent(history.end180MedianPct)}</strong><small>中位数</small></div> : null}
      </div>
      <div className="dcaHistoryTableHead">机会记录</div>
      <div className="dcaHistoryTableWrap">
        <table className={show30 || show60 || show180 ? "withMetrics" : ""}>
          <thead><tr><th>日期</th>{show30 ? <th>30 日内最高</th> : null}{show60 ? <th>60 日内最高</th> : null}{show180 ? <th>180 日后</th> : null}</tr></thead>
          <tbody>{history.records.map((record) => <tr key={record.opportunityDate}><td>{record.opportunityDate}</td>{show30 ? <td className={metricTone(record.max30Pct)}>{percent(record.max30Pct)}</td> : null}{show60 ? <td className={metricTone(record.max60Pct)}>{percent(record.max60Pct)}</td> : null}{show180 ? <td className={metricTone(record.end180Pct)}>{Number.isFinite(record.end180Pct) ? percent(record.end180Pct) : "观察中"}</td> : null}</tr>)}</tbody>
        </table>
      </div>
    </section>
  );
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
    const opportunityWindows = (product.opportunityWindows?.length
      ? product.opportunityWindows
      : product.opportunityDates.map((date) => ({ startDate: date, endDate: date })))
      .filter((window) => Date.parse(window.startDate) <= end && Date.parse(window.endDate) >= start);
    return { width, height, left, right, top, bottom, start, end, x, prices, priceMin, priceMax, priceY, pricePath, opportunityPoints, opportunityWindows };
  }, [product]);

  if (!chart) return <div className="dcaChartEmpty">暂时无法显示行情</div>;
  const years = [year(new Date(chart.start).toISOString()), year(new Date((chart.start + chart.end) / 2).toISOString()), year(new Date(chart.end).toISOString())];
  const current = chart.prices.at(-1)!;

  return (
    <div className="dcaChartScroll">
      <svg className="dcaChart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={productCopy[kind].chartTitle}>
        {chart.opportunityWindows.map((window) => {
          const startX = Math.max(chart.left, chart.x(window.startDate));
          const endX = Math.min(chart.width - chart.right, chart.x(window.endDate));
          return <rect key={`band-${window.startDate}`} className={`dcaOpportunityBand ${kind}`} x={Math.max(chart.left, startX - 4)} y={chart.top} width={Math.max(12, endX - startX + 8)} height={chart.bottom - chart.top} rx="3"><title>{window.startDate === window.endDate ? window.startDate : `${window.startDate} 至 ${window.endDate}`}</title></rect>;
        })}
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
  if (product.available === false) return <div className="dcaPage"><div className="dcaPageState"><strong>数据更新中</strong><span>请稍后再看</span></div></div>;

  const statusKey = product.status?.key || "waiting";
  const presentation = statusCopy[kind][statusKey];
  const opportunityDates = [...product.opportunityDates].sort();
  const lastOpportunity = product.currentCycleStart || opportunityDates.at(-1);
  const currentStep = unlocked ? product.status?.position ?? 0 : -1;

  return (
    <div className="dcaPage" data-testid={`${kind}-strategy-page`}>
      <header className="dcaHeader">
        <div><h1>{copy.title}</h1><p>{copy.subtitle}</p></div>
        <div><span>更新 {product.asOf || "--"}</span>{!unlocked ? <button type="button" onClick={onUnlock}>开通会员</button> : null}</div>
      </header>

      <section className={`dcaDecision ${kind}`}>
        <div className={`dcaDecisionMain ${!unlocked ? "locked" : ""}`}>
          <div className="dcaDecisionContent"><small>当前状态</small><strong>{presentation.title}</strong><p>{presentation.detail}</p></div>
          {!unlocked ? <div className="dcaGate"><small>最新状态</small><strong>{copy.lockedTitle}</strong><button type="button" onClick={onUnlock}>开通会员查看</button></div> : null}
        </div>
        <div className="dcaStage">
          <small>当前阶段</small>
          <div className="dcaProgress">{copy.phases.map((phase, index) => <div key={phase} className={currentStep === index ? "current" : ""}>{phase}</div>)}</div>
          <div className="dcaStageMeta">
            <div><span>{copy.lastOpportunityLabel}</span><strong>{lastOpportunity || "--"}</strong></div>
            <div><span>操作参考</span><strong>{unlocked ? presentation.action : "开通查看"}</strong></div>
            <div><span>下次更新</span><strong>{unlocked ? "下一交易日收盘后" : "开通查看"}</strong></div>
          </div>
        </div>
      </section>

      <section className="dcaPanel dcaChartPanel">
        <div className="dcaPanelHead">
          <div className="dcaPanelTitle">
            <strong>{copy.chartTitle}</strong>
            <div className="dcaChartLegend" data-testid="dca-chart-legend">
              {copy.legend.band ? <span><i className={`dcaLegendBand ${kind}`} />{copy.legend.band}</span> : null}
              <span><i className={`dcaLegendDot ${kind}`} />{copy.legend.point}</span>
            </div>
          </div>
          <span>更新 {product.asOf || "--"}</span>
        </div>
        <OpportunityChart product={product} kind={kind} />
        <HistorySection history={unlocked ? product.history : null} />
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

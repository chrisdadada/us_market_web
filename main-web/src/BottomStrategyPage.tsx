import { useEffect, useMemo, useRef, useState } from "react";
import { api, type BottomStrategyMarket, type BottomStrategyPayload, type BottomStrategyRecord } from "./api";
import "./bottomStrategy.css";

const horizons = [10, 30, 60, 180];

function pct(value?: number | null) {
  if (!Number.isFinite(value)) return "--";
  return `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(1)}%`;
}

function tone(value?: number | null) {
  if (!Number.isFinite(value)) return "muted";
  return Number(value) >= 0 ? "positive" : "negative";
}

function StrategyChart({ market }: { market: BottomStrategyMarket }) {
  const chart = useMemo(() => {
    const points = market.priceSeries || [];
    if (points.length < 2) return null;
    const width = 1000;
    const height = 300;
    const pad = { left: 54, right: 20, top: 22, bottom: 34 };
    const values = points.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const x = (index: number) => pad.left + (index / (points.length - 1)) * (width - pad.left - pad.right);
    const y = (value: number) => pad.top + (1 - (value - min) / span) * (height - pad.top - pad.bottom);
    const path = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
    const byDate = new Map(points.map((point, index) => [point.date, { ...point, index }]));
    const signals = market.records
      .map((record) => ({ record, point: byDate.get(record.signalDate) }))
      .filter((item): item is { record: BottomStrategyRecord; point: { date: string; value: number; index: number } } => Boolean(item.point));
    return { width, height, pad, min, max, path, points, x, y, signals };
  }, [market]);

  if (!chart) return <div className="bottomStrategyEmpty">暂无信号位置数据</div>;
  const first = chart.points[0];
  const last = chart.points[chart.points.length - 1];
  return (
    <div className="bottomStrategyChart">
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`${market.name}历史价格与抄底信号位置`}>
        {[0, 0.5, 1].map((ratio) => {
          const value = chart.max - (chart.max - chart.min) * ratio;
          const y = chart.y(value);
          return <g key={ratio}><line x1={chart.pad.left} y1={y} x2={chart.width - chart.pad.right} y2={y} /><text x={chart.pad.left - 10} y={y + 4}>{value.toFixed(0)}</text></g>;
        })}
        <path d={chart.path} />
        {chart.signals.map(({ record, point }) => (
          <g key={record.signalDate} className="bottomStrategySignalPoint">
            <circle cx={chart.x(point.index)} cy={chart.y(point.value)} r="5" />
            <title>{`${record.signalDate} 抄底信号`}</title>
          </g>
        ))}
        <text className="date" x={chart.pad.left} y={chart.height - 8}>{first.date}</text>
        <text className="date end" x={chart.width - chart.pad.right} y={chart.height - 8}>{last.date}</text>
      </svg>
      <div><span><i />抄底信号</span><em>信号在日线收盘后确认</em></div>
    </div>
  );
}

function RecordsTable({ records }: { records: BottomStrategyRecord[] }) {
  return (
    <div className="bottomStrategyRecords">
      <table>
        <thead><tr><th>信号日期</th><th>10日内最高</th><th>30日内最高</th><th>60日内最高</th><th>180日结果</th></tr></thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.signalDate}>
              <td><strong>{record.signalDate}</strong><small>{record.status === "observing" ? "观察中" : "已走完"}</small></td>
              {[10, 30, 60].map((horizon) => <td key={horizon} className={tone(record.performance[String(horizon)]?.maxPct)}>{pct(record.performance[String(horizon)]?.maxPct)}</td>)}
              <td className={tone(record.performance["180"]?.endPct)}>{record.status === "observing" ? "观察中" : pct(record.performance["180"]?.endPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BottomStrategyPage({ unlocked, onUnlock }: { unlocked: boolean; onUnlock: () => void }) {
  const [payload, setPayload] = useState<BottomStrategyPayload | null>(null);
  const [selected, setSelected] = useState("QQQ");
  const [view, setView] = useState<"performance" | "signals">("performance");
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const recordsRef = useRef<HTMLDivElement>(null);

  const load = () => {
    setLoading(true);
    setError("");
    api.bottomStrategy()
      .then(setPayload)
      .catch((reason) => setError(reason?.message || "策略数据加载失败"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  const market = payload?.markets[selected] || Object.values(payload?.markets || {})[0];

  if (loading) return <div className="bottomStrategyPage"><div className="bottomStrategyState">正在加载策略数据</div></div>;
  if (error || !market) return <div className="bottomStrategyPage"><div className="bottomStrategyState"><span>{error || "策略数据暂不可用"}</span><button type="button" onClick={load}>重新加载</button></div></div>;

  const summary = market.summary;
  const completeHeadline = `${summary.recentCount}次全部走出上涨行情`;
  const viewRecords = showAll ? market.records : market.recentRecords;
  const openRecords = () => {
    if (!unlocked) {
      onUnlock();
      return;
    }
    setShowAll((value) => !value);
    window.requestAnimationFrame(() => recordsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  return (
    <div className="bottomStrategyPage" data-testid="bottom-strategy-page">
      <div className="bottomStrategyTitle">抄底策略</div>
      <section className="bottomStrategyStatusPanel">
        <div className="bottomStrategyHead">
          <div className="bottomStrategyMarketSwitch" aria-label="选择指数">
            {Object.values(payload?.markets || {}).map((item) => <button key={item.symbol} type="button" className={selected === item.symbol ? "active" : ""} onClick={() => { setSelected(item.symbol); setShowAll(false); }}>{item.name}</button>)}
          </div>
          <span>数据截至 {market.asOf}</span>
        </div>
        <div className="bottomStrategyStatusBody">
          <div className={`bottomStrategyCurrent ${market.status.key}`}>
            <span>当前状态</span>
            <strong>{market.status.title}</strong>
            <p>{market.status.message}</p>
          </div>
          <div className="bottomStrategyPosition">
            <span>市场位置</span>
            <div>{["现在正常", "接近低位", "可以分批"].map((label, index) => <b key={label} className={market.status.position === index ? "active" : ""}>{label}</b>)}</div>
            <small style={{ left: `${16.67 + market.status.position * 33.33}%` }}>当前位置</small>
          </div>
          <button type="button" className="bottomStrategyAction" onClick={() => recordsRef.current?.scrollIntoView({ behavior: "smooth" })}>查看历史信号</button>
        </div>
        <div className="bottomStrategyActionLine"><span>信号出现后</span><strong>开始分批定投</strong><em>底部是一段区域，不必等待最低点</em></div>
      </section>

      <section className="bottomStrategyResults" ref={recordsRef}>
        <header>
          <strong>历史信号表现</strong>
          <div><button type="button" className={view === "performance" ? "active" : ""} onClick={() => setView("performance")}>阶段表现</button><button type="button" className={view === "signals" ? "active" : ""} onClick={() => setView("signals")}>信号位置</button></div>
          <span>{market.name} · 日线收盘信号</span>
        </header>
        {view === "signals" ? <StrategyChart market={market} /> : (
          <div className="bottomStrategyResultsGrid">
            <div className="bottomStrategySummary">
              <span>最近{summary.recentCount}次已走完的信号</span>
              <h1>{completeHeadline}</h1>
              <p>信号次日开始观察，持有约9个月</p>
              <div className="bottomStrategyHeroNumber">
                <span>180个交易日后，历史涨幅中间值</span>
                <strong>{pct(summary.end180MedianPct)}</strong>
                <div><b>最近{summary.recentCount}次均为上涨</b><small>最高一次 {pct(summary.bestEnd180Pct)}</small></div>
              </div>
              <div className="bottomStrategyStagesHead"><strong>信号出现后，历史上涨空间</strong><span>区间最高涨幅中间值</span></div>
              <div className="bottomStrategyStages">{horizons.map((horizon) => <article key={horizon}><span>{horizon}个交易日内</span><strong>{pct(summary.stageMaxMedianPct[String(horizon)])}</strong></article>)}</div>
            </div>
            <aside className="bottomStrategyRecent">
              <div><strong>{showAll ? `全部${summary.totalSignals}次记录` : `最近${summary.recentCount}次最终结果`}</strong><span>约9个月后</span></div>
              {viewRecords.length ? viewRecords.slice(0, showAll ? summary.totalSignals : summary.recentCount).map((record) => <p key={record.signalDate}><span>{record.signalDate}</span><strong className={tone(record.performance["180"]?.endPct)}>{record.status === "observing" ? "观察中" : pct(record.performance["180"]?.endPct)}</strong></p>) : <div className="bottomStrategyRecentEmpty">开通后查看逐次记录</div>}
              <button type="button" onClick={openRecords}>{unlocked ? showAll ? "收起完整记录" : `查看全部${summary.totalSignals}次信号` : "开通查看完整记录"}</button>
            </aside>
          </div>
        )}
        {showAll && unlocked && view === "performance" ? <RecordsTable records={market.records} /> : null}
      </section>
      <footer className="bottomStrategyFoot"><span>历史信号按次日开盘测算，未计交易成本；历史表现不代表未来。</span>{!unlocked ? <button type="button" onClick={onUnlock}>查看会员权益</button> : null}</footer>
    </div>
  );
}

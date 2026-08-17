import { useEffect, useMemo, useState } from "react";
import { api, type BottomStrategyMarket, type BottomStrategyPayload, type BottomStrategyRecord } from "./api";
import "./bottomStrategy.css";

function pct(value?: number | null) {
  if (!Number.isFinite(value)) return "--";
  return `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(1)}%`;
}

function tone(value?: number | null) {
  if (!Number.isFinite(value)) return "muted";
  return Number(value) >= 0 ? "positive" : "negative";
}

function HistoricalPathChart({ market }: { market: BottomStrategyMarket }) {
  const chart = useMemo(() => {
    const points = market.medianPath || [];
    if (points.length < 2) return null;
    const width = 720;
    const height = 225;
    const pad = { left: 44, right: 26, top: 22, bottom: 38 };
    const values = points.map((point) => point.pct);
    const min = Math.min(0, ...values);
    const max = Math.max(1, ...values);
    const span = max - min || 1;
    const x = (day: number) => pad.left + (day / 180) * (width - pad.left - pad.right);
    const y = (value: number) => pad.top + (1 - (value - min) / span) * (height - pad.top - pad.bottom);
    const path = points.map((point, index) => `${index ? "L" : "M"}${x(point.day).toFixed(1)},${y(point.pct).toFixed(1)}`).join(" ");
    const zeroY = y(0);
    return { width, height, pad, min, max, x, y, path, zeroY, points };
  }, [market]);

  if (!chart) return <div className="bottomStrategyEmpty">历史路径暂不可用</div>;
  const area = `${chart.path} L${chart.x(180)},${chart.zeroY} L${chart.x(0)},${chart.zeroY} Z`;
  const ticks = [chart.max, chart.min + (chart.max - chart.min) * 0.66, chart.min + (chart.max - chart.min) * 0.33, chart.min];
  return (
    <div className="bottomStrategyPathChart">
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`${market.name}信号出现后的历史中位走势`}>
        <defs><linearGradient id="bottomStrategyArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1677ff" stopOpacity=".18" /><stop offset="1" stopColor="#1677ff" stopOpacity="0" /></linearGradient></defs>
        {ticks.map((value) => <g key={value}><line x1={chart.pad.left} y1={chart.y(value)} x2={chart.width - chart.pad.right} y2={chart.y(value)} /><text x={chart.pad.left - 9} y={chart.y(value) + 4}>{pct(value)}</text></g>)}
        <line className="zero" x1={chart.pad.left} y1={chart.zeroY} x2={chart.width - chart.pad.right} y2={chart.zeroY} />
        <path className="area" d={area} />
        <path className="line" d={chart.path} />
        <circle cx={chart.x(chart.points.at(-1)?.day || 180)} cy={chart.y(chart.points.at(-1)?.pct || 0)} r="5" />
        {[0, 30, 60, 90, 120, 180].map((day) => <text key={day} className="date" x={chart.x(day)} y={chart.height - 9}>{day ? `${day}日` : "信号日"}</text>)}
      </svg>
      <div><i />最近 {market.summary.recentCount} 次已结束信号的历史中位走势</div>
    </div>
  );
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

  if (!chart) return <div className="bottomStrategyEmpty">开通后查看全部信号位置</div>;
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
        {chart.signals.map(({ record, point }) => <g key={record.signalDate} className="bottomStrategySignalPoint"><circle cx={chart.x(point.index)} cy={chart.y(point.value)} r="5" /><title>{`${record.signalDate} 抄底信号`}</title></g>)}
        <text className="date" x={chart.pad.left} y={chart.height - 8}>{first.date}</text>
        <text className="date end" x={chart.width - chart.pad.right} y={chart.height - 8}>{last.date}</text>
      </svg>
      <div><span><i />抄底信号</span><em>日线收盘确认</em></div>
    </div>
  );
}

function RecordsTable({ records }: { records: BottomStrategyRecord[] }) {
  return (
    <div className="bottomStrategyRecords">
      <table>
        <thead><tr><th>信号日期</th><th>10日内最高</th><th>30日内最高</th><th>60日内最高</th><th>180日结果</th></tr></thead>
        <tbody>{records.map((record) => <tr key={record.signalDate}>
          <td><strong>{record.signalDate}</strong><small>{record.status === "observing" ? "观察中" : "已结束"}</small></td>
          {[10, 30, 60].map((horizon) => <td key={horizon} className={tone(record.performance[String(horizon)]?.maxPct)}>{pct(record.performance[String(horizon)]?.maxPct)}</td>)}
          <td className={tone(record.performance["180"]?.endPct)}>{record.status === "observing" ? "观察中" : pct(record.performance["180"]?.endPct)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}

export function BottomStrategyPage({ unlocked, onUnlock }: { unlocked: boolean; onUnlock: () => void }) {
  const [payload, setPayload] = useState<BottomStrategyPayload | null>(null);
  const [selected, setSelected] = useState("QQQ");
  const [view, setView] = useState<"path" | "signals" | "records">("path");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    api.bottomStrategy().then(setPayload).catch((reason) => setError(reason?.message || "策略数据加载失败")).finally(() => setLoading(false));
  };

  useEffect(load, []);
  const market = payload?.markets[selected] || Object.values(payload?.markets || {})[0];

  if (loading) return <div className="bottomStrategyPage"><div className="bottomStrategyState">正在加载策略数据</div></div>;
  if (error || !market) return <div className="bottomStrategyPage"><div className="bottomStrategyState"><span>{error || "策略数据暂不可用"}</span><button type="button" onClick={load}>重新加载</button></div></div>;

  const summary = market.summary;
  const lastSignal = market.lastSignal;
  const currentHeadline = { normal: "继续等待", near: "接近机会", action: "开始分批" }[market.status.key];
  const completedPositive = summary.completedPositiveCount ?? summary.recentPositiveCount;
  const completedNegative = summary.completedNegativeCount ?? Math.max(0, summary.completedSignals - completedPositive);
  const selectView = (next: "path" | "signals" | "records") => {
    if (!unlocked && next !== "path") {
      onUnlock();
      return;
    }
    setView(next);
  };

  return (
    <div className="bottomStrategyPage" data-testid="bottom-strategy-page">
      <div className="bottomStrategyTitle">抄底策略</div>
      <section className="bottomStrategyStatusPanel">
        <div className="bottomStrategyHead">
          <div className="bottomStrategyMarketSwitch" aria-label="选择指数">
            {Object.values(payload?.markets || {}).map((item) => <button key={item.symbol} type="button" className={selected === item.symbol ? "active" : ""} onClick={() => { setSelected(item.symbol); setView("path"); }}>{item.name}</button>)}
          </div>
          <span className={payload?.freshness?.status === "stale" ? "stale" : "current"}><i />{payload?.freshness?.status === "stale" ? "数据更新延迟" : "数据已更新"} · {market.asOf}</span>
        </div>
        <div className="bottomStrategyStatusGrid">
          <div className="bottomStrategyDecision">
            <span>现在怎么做</span>
            <h1>{currentHeadline}</h1>
            <h2>{market.status.title}</h2>
            <p>{market.status.message}</p>
            <div><span>下一步</span><strong>{market.status.key === "action" ? "制定分批计划" : "保持观察"}</strong><em>{market.status.key === "action" ? "不要一次买完" : "不需要提前猜底"}</em></div>
          </div>
          <div className="bottomStrategyPositionArea">
            <header><strong>市场位置</strong><span>日线收盘确认</span></header>
            <div className="bottomStrategyTrack">{["继续等待", "接近机会", "开始分批"].map((label, index) => <b key={label} className={market.status.position === index ? "active" : ""}>{label}</b>)}</div>
            <small style={{ marginLeft: `${16.67 + market.status.position * 33.33}%` }}><i />当前位置</small>
            <div className="bottomStrategyLastSignal">
              <div><span>上次信号</span><strong>{lastSignal?.signalDate || "--"}</strong></div>
              <div><span>观察进度</span><strong>{lastSignal ? `第 ${lastSignal.tradingDaysObserved} 个交易日` : "--"}</strong></div>
              <div><span>已结束阶段</span><strong className={tone(lastSignal?.completedEndPct)}>{lastSignal?.completedHorizon ? `${lastSignal.completedHorizon}日结果 ${pct(lastSignal.completedEndPct)}` : "观察中"}</strong></div>
            </div>
          </div>
        </div>
      </section>

      <section className={`bottomStrategyResults ${!unlocked ? "preview" : ""}`}>
        <header>
          <strong>历史信号表现</strong>
          <div>{([['path', '历史路径'], ['signals', '信号位置'], ['records', '完整记录']] as const).map(([key, label]) => <button key={key} type="button" className={view === key ? "active" : ""} onClick={() => selectView(key)}>{label}</button>)}</div>
          <span>{market.name} · 信号次日开始观察</span>
        </header>
        {view === "signals" ? <StrategyChart market={market} /> : view === "records" ? <RecordsTable records={market.records} /> : (
          <div className="bottomStrategyHistoryGrid">
            <div className="bottomStrategyHistoryMain">
              <div className="bottomStrategySummaryRow">
                <div><span>最近 {summary.recentCount} 次已结束信号</span><h2>{summary.recentPositiveCount} 次均走出上涨行情</h2><p>完整历史：{summary.completedSignals} 次已结束 · {completedPositive} 次上涨 · {completedNegative} 次下跌</p></div>
                <div><span>180个交易日后，历史涨幅中间值</span><strong>{pct(summary.end180MedianPct)}</strong></div>
              </div>
              <div className="bottomStrategyChartTitle"><strong>信号出现后的典型走势</strong><span>以信号次日为起点 · 历史中位路径</span></div>
              <HistoricalPathChart market={market} />
            </div>
            <aside className="bottomStrategyRecent">
              <div><strong>最近 {summary.recentCount} 次最终结果</strong><span>180个交易日后</span></div>
              {market.recentRecords.length ? market.recentRecords.map((record) => <p key={record.signalDate}><span>{record.signalDate}</span><strong className={tone(record.performance["180"]?.endPct)}>{pct(record.performance["180"]?.endPct)}</strong></p>) : Array.from({ length: 5 }, (_, index) => <p className="placeholder" key={index}><span /><strong /></p>)}
              <footer><span>完整历史</span><b>{summary.completedSignals}次结束 · {completedPositive}涨 · {completedNegative}跌</b></footer>
            </aside>
          </div>
        )}
        {!unlocked && view === "path" ? <div className="bottomStrategyGate"><div><strong>开通查看完整历史表现</strong><span>历史路径、逐次结果和全部信号记录</span></div><button type="button" onClick={onUnlock}>联系管理员开通</button></div> : null}
      </section>
      <footer className="bottomStrategyFoot">历史信号按次日开盘测算，未计交易成本；历史表现不代表未来。</footer>
    </div>
  );
}

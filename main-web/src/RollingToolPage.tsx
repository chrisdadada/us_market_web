import { useMemo, useState, type FormEvent } from "react";
import {
  applyMarketPrice,
  normalizePlan,
  projectNextAdd,
  startSimulation,
  type RollingDirection,
  type RollingPlan,
  type RollingSide,
  type RollingSimulationState
} from "./vendor/rolling-pro/rolling-simulator.mjs";
import { exactMoney, signedExactMoney } from "./shared";
import "./rollingTool.css";

type EntryMode = "immediate" | "conditional";
type IntervalType = "percent" | "absolute";
type SimulationEvent = { id: number; label: string; detail: string };

function numberValue(value: string) {
  return Number(value.replaceAll(",", ""));
}

function price(value: number | null | undefined) {
  return value == null ? "--" : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
}

function quantity(value: number | null | undefined) {
  return value == null ? "--" : value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function downloadName(symbol: string) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `rolling-plan-${symbol}-${stamp}.json`;
}

export default function RollingToolPage() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [side, setSide] = useState<RollingSide>("long");
  const [triggerDirection, setTriggerDirection] = useState<RollingDirection>("rise");
  const [initialNotional, setInitialNotional] = useState("1,000");
  const [leverage, setLeverage] = useState("3");
  const [entryMode, setEntryMode] = useState<EntryMode>("immediate");
  const [entryDirection, setEntryDirection] = useState<RollingDirection>("rise");
  const [entryTriggerPrice, setEntryTriggerPrice] = useState("");
  const [entryFillPrice, setEntryFillPrice] = useState("");
  const [intervalType, setIntervalType] = useState<IntervalType>("percent");
  const [intervalValue, setIntervalValue] = useState("2");
  const [addPercent, setAddPercent] = useState("50");
  const [maxAdds, setMaxAdds] = useState("4");
  const [protectionDistance, setProtectionDistance] = useState("6");
  const [marketPrice, setMarketPrice] = useState("");
  const [simulation, setSimulation] = useState<RollingSimulationState | null>(null);
  const [events, setEvents] = useState<SimulationEvent[]>([]);
  const [error, setError] = useState("");
  const [exportStatus, setExportStatus] = useState("导出方案");

  const rawPlan = useMemo(() => ({
    schemaVersion: 1,
    symbol: symbol.trim().toUpperCase(),
    side,
    triggerDirection,
    initialNotional: numberValue(initialNotional),
    leverage: numberValue(leverage),
    entry: entryMode === "conditional"
      ? { mode: entryMode, direction: entryDirection, triggerPrice: numberValue(entryTriggerPrice) }
      : { mode: entryMode },
    addInterval: { type: intervalType, value: numberValue(intervalValue) },
    addPercent: numberValue(addPercent),
    maxAdds: numberValue(maxAdds),
    protectionDistance: numberValue(protectionDistance)
  }), [addPercent, entryDirection, entryMode, entryTriggerPrice, initialNotional, intervalType, intervalValue, leverage, maxAdds, protectionDistance, side, symbol, triggerDirection]);

  const projection = simulation ? projectNextAdd(simulation) : null;
  const formLocked = simulation !== null;

  function beginSimulation(event: FormEvent) {
    event.preventDefault();
    try {
      const plan = normalizePlan(rawPlan);
      const fillPrice = entryMode === "conditional" ? numberValue(entryTriggerPrice) : numberValue(entryFillPrice);
      const next = startSimulation(plan, fillPrice);
      setSimulation(next);
      setMarketPrice(String(fillPrice));
      setEvents([{ id: Date.now(), label: "首仓成交", detail: `${plan.symbol} · ${price(fillPrice)} · ${exactMoney(plan.initialNotional)}` }]);
      setError("");
      setExportStatus("导出方案");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "请检查方案参数。");
    }
  }

  function advanceTo(nextPrice?: number | null) {
    if (!simulation) return;
    const value = nextPrice ?? numberValue(marketPrice);
    try {
      const next = applyMarketPrice(simulation, value);
      const lastEvent = next.lastEvent;
      setSimulation(next);
      setMarketPrice(String(value));
      setError("");
      if (lastEvent.type === "add") {
        setEvents((current) => [{ id: Date.now(), label: `第 ${lastEvent.addNumber} 次加仓`, detail: `${price(lastEvent.fillPrice)} · 累计 ${exactMoney(next.totalNotional)}` }, ...current]);
      }
      if (lastEvent.type === "protection_exit") {
        setEvents((current) => [{ id: Date.now(), label: "保护退出", detail: `${price(lastEvent.fillPrice)} · 模拟盈亏 ${signedExactMoney(next.estimatedPnl ?? 0)}` }, ...current]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "请输入有效的模拟价格。");
    }
  }

  function resetSimulation() {
    setSimulation(null);
    setEvents([]);
    setMarketPrice("");
    setError("");
    setExportStatus("导出方案");
  }

  function exportPlan() {
    try {
      const plan: RollingPlan = normalizePlan(rawPlan);
      const blob = new Blob([`${JSON.stringify(plan, null, 2)}\n`], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName(plan.symbol);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportStatus("已导出");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "方案导出失败。");
    }
  }

  const statusText = simulation?.status === "running"
    ? "等待加仓"
    : simulation?.status === "holding_protection"
      ? "持仓保护"
      : simulation?.status === "ended"
        ? "已结束"
        : "待开始";

  return (
    <div className="positionSizingPage rollingToolPage" data-testid="rolling-tool-page">
      <header className="positionSizingHead">
        <div>
          <h1>滚仓工具</h1>
          <p>配置滚仓方案，按价格路径模拟加仓与保护退出。</p>
        </div>
        <span>网页模拟 · 方案导出</span>
      </header>

      <section className="positionSizingGrid rollingToolGrid">
        <form className="positionSizingPanel positionSizingForm" onSubmit={beginSimulation}>
          <div className="panelHead">
            <strong>方案设置</strong>
            <span>{formLocked ? "模拟中，参数已锁定" : "填写后开始模拟"}</span>
          </div>
          <fieldset className="positionFormBody rollingToolFieldset" disabled={formLocked}>
            <div className="positionFieldGrid">
              <label>
                <span>交易标的</span>
                <input data-testid="rolling-symbol" value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="例如 BTCUSDT" />
              </label>
              <label>
                <span>持仓方向</span>
                <span className="positionSegment">
                  <button type="button" className={`long ${side === "long" ? "active" : ""}`} onClick={() => setSide("long")}>做多</button>
                  <button type="button" className={`short ${side === "short" ? "active" : ""}`} onClick={() => setSide("short")}>做空</button>
                </span>
              </label>
            </div>

            <div className="positionFieldGrid">
              <label>
                <span>首仓价值</span>
                <span className="positionInput"><i>$</i><input data-testid="rolling-initial-notional" inputMode="decimal" value={initialNotional} onChange={(event) => setInitialNotional(event.target.value)} placeholder="例如 1,000" /></span>
              </label>
              <label>
                <span>杠杆倍数</span>
                <span className="positionInput"><input inputMode="decimal" value={leverage} onChange={(event) => setLeverage(event.target.value)} placeholder="3" /><i>x</i></span>
              </label>
            </div>

            <div className="positionFieldGrid">
              <label>
                <span>首仓方式</span>
                <span className="rollingNeutralSegment">
                  <button type="button" className={entryMode === "immediate" ? "active" : ""} onClick={() => setEntryMode("immediate")}>立即模拟</button>
                  <button type="button" className={entryMode === "conditional" ? "active" : ""} onClick={() => setEntryMode("conditional")}>条件触发</button>
                </span>
              </label>
              {entryMode === "immediate" ? (
                <label>
                  <span>首仓模拟成交价</span>
                  <span className="positionInput"><i>$</i><input data-testid="rolling-entry-price" inputMode="decimal" value={entryFillPrice} onChange={(event) => setEntryFillPrice(event.target.value)} placeholder="输入模拟成交价" /></span>
                </label>
              ) : (
                <label>
                  <span>首仓触发价</span>
                  <span className="rollingTriggerInput">
                    <select aria-label="首仓触发方向" value={entryDirection} onChange={(event) => setEntryDirection(event.target.value as RollingDirection)}>
                      <option value="rise">上涨至</option>
                      <option value="fall">下跌至</option>
                    </select>
                    <input data-testid="rolling-entry-price" inputMode="decimal" value={entryTriggerPrice} onChange={(event) => setEntryTriggerPrice(event.target.value)} placeholder="价格" />
                  </span>
                </label>
              )}
            </div>

            <div className="positionFieldGrid">
              <label>
                <span>加仓触发</span>
                <span className="positionSegment">
                  <button type="button" className={`long ${triggerDirection === "rise" ? "active" : ""}`} onClick={() => setTriggerDirection("rise")}>上涨加仓</button>
                  <button type="button" className={`short ${triggerDirection === "fall" ? "active" : ""}`} onClick={() => setTriggerDirection("fall")}>下跌加仓</button>
                </span>
              </label>
              <label>
                <span>加仓间隔</span>
                <span className="rollingTriggerInput">
                  <select aria-label="加仓间隔类型" value={intervalType} onChange={(event) => setIntervalType(event.target.value as IntervalType)}>
                    <option value="percent">百分比</option>
                    <option value="absolute">固定价差</option>
                  </select>
                  <input data-testid="rolling-interval" inputMode="decimal" value={intervalValue} onChange={(event) => setIntervalValue(event.target.value)} placeholder="2" />
                </span>
              </label>
            </div>

            <div className="positionFieldGrid">
              <label>
                <span>每次加仓</span>
                <span className="positionInput"><input inputMode="decimal" value={addPercent} onChange={(event) => setAddPercent(event.target.value)} placeholder="50" /><i>% 首仓</i></span>
              </label>
              <label>
                <span>最大加仓次数</span>
                <span className="positionInput"><input inputMode="numeric" value={maxAdds} onChange={(event) => setMaxAdds(event.target.value)} placeholder="4" /><i>次</i></span>
              </label>
            </div>

            <div className="positionFieldGrid rollingLastFieldRow">
              <label>
                <span>保护距离</span>
                <span className="positionInput"><input inputMode="decimal" value={protectionDistance} onChange={(event) => setProtectionDistance(event.target.value)} placeholder="6" /><i>% 均价</i></span>
              </label>
            </div>

            <div className="rollingFormActions">
              <button className="rollingPrimaryButton" data-testid="rolling-start" type="submit">开始模拟</button>
              <button type="button" onClick={exportPlan}>{exportStatus}</button>
            </div>
          </fieldset>
        </form>

        <aside className="positionSizingPanel positionResultPanel rollingResultPanel">
          <div className="panelHead">
            <strong>模拟状态</strong>
            <span className={`rollingStatus ${simulation?.status || "idle"}`}>{statusText}</span>
          </div>

          <div className="rollingPriceControl">
            <label htmlFor="rolling-market-price">下一模拟价格</label>
            <span className="positionInput"><i>$</i><input id="rolling-market-price" data-testid="rolling-market-price" inputMode="decimal" disabled={!simulation || simulation.status === "ended"} value={marketPrice} onChange={(event) => setMarketPrice(event.target.value)} placeholder="输入价格" /></span>
            <button className="rollingPrimaryButton" data-testid="rolling-advance" type="button" disabled={!simulation || simulation.status === "ended"} onClick={() => advanceTo()}>推进价格</button>
          </div>

          {simulation?.status !== "ended" && simulation ? (
            <div className="rollingQuickActions">
              <button type="button" disabled={simulation.nextTriggerPrice == null} onClick={() => advanceTo(simulation.nextTriggerPrice)}>到下一触发价</button>
              <button type="button" onClick={() => advanceTo(simulation.protectionPrice)}>到保护价</button>
            </div>
          ) : null}

          {error ? <p className="positionError rollingError" role="alert">{error}</p> : null}

          <div className="positionMetricList rollingMetricList">
            <div><span>最新模拟价</span><strong>{price(simulation?.latestPrice)}</strong></div>
            <div><span>持仓均价</span><strong>{price(simulation?.averagePrice)}</strong></div>
            <div><span>累计仓位价值</span><strong>{simulation ? exactMoney(simulation.totalNotional) : "--"}</strong></div>
            <div><span>预计占用保证金</span><strong>{simulation ? exactMoney(simulation.estimatedInitialMargin) : "--"}</strong></div>
            <div><span>持仓数量</span><strong>{quantity(simulation?.quantity)}</strong></div>
            <div><span>加仓进度</span><strong data-testid="rolling-add-progress">{simulation ? `${simulation.addsCompleted} / ${simulation.plan.maxAdds}` : "--"}</strong></div>
            <div><span>下一触发价</span><strong className="positive">{price(simulation?.nextTriggerPrice)}</strong></div>
            <div><span>保护价</span><strong className="negative">{price(simulation?.protectionPrice)}</strong></div>
            {simulation?.status === "ended" ? <div><span>模拟盈亏</span><strong className={(simulation.estimatedPnl ?? 0) >= 0 ? "positive" : "negative"}>{signedExactMoney(simulation.estimatedPnl ?? 0)}</strong></div> : null}
          </div>

          <p className="positionPlanSummary rollingProjection">
            {projection?.blockedByProtection
              ? "下一触发价已越过保护价，推进时会先保护退出，不会加仓。"
              : projection
                ? `下一次按 ${price(projection.fillPrice)} 模拟加仓，仓位价值将变为 ${exactMoney(projection.totalNotional)}，均价约 ${price(projection.averagePrice)}。`
              : simulation
                ? "当前不再安排加仓，仅继续观察保护价。"
                : "开始模拟后，这里会显示下一次加仓和保护价。"}
          </p>
          <div className="positionResultActions rollingResultActions">
            <button className="positionPrimaryButton" type="button" onClick={exportPlan}>{exportStatus}</button>
            <button type="button" disabled={!simulation} onClick={resetSimulation}>重置</button>
          </div>
          <p className="positionDisclaimer">模拟结果按输入价格测算，不含滑点、手续费、资金费和交易所爆仓价。</p>
        </aside>
      </section>

      <section className="positionSizingPanel rollingEventsPanel">
        <div className="panelHead"><strong>模拟记录</strong><span>{events.length ? `${events.length} 条` : "价格推进后生成"}</span></div>
        {events.length ? (
          <div className="rollingEventList">
            {events.map((item) => <div key={item.id}><strong>{item.label}</strong><span>{item.detail}</span></div>)}
          </div>
        ) : <p className="rollingEmptyState">尚未开始模拟</p>}
      </section>
    </div>
  );
}

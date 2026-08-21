import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type RollingPlan, type RollingPlanInput } from "./api";
import {
  normalizePlan,
  projectNextAdd,
  type RollingDirection,
  type RollingSide,
  type RollingSimulationState
} from "./vendor/rolling-pro/rolling-simulator.mjs";
import { formatStoredDateTime } from "./shared";
import "./rollingTool.css";

type EntryMode = "immediate" | "conditional";
type IntervalType = "percent" | "absolute";

const statusLabels: Record<RollingPlan["status"], string> = {
  waiting_entry: "等待入场",
  running: "运行中",
  paused: "已暂停",
  holding_protection: "持仓保护",
  ending: "结束中",
  ended: "已结束"
};

const eventLabels: Record<string, string> = {
  waiting_entry: "计划已启动，等待首仓条件",
  entry: "首仓执行",
  add: "加仓执行",
  paused: "暂停加仓",
  resumed: "恢复运行",
  ending: "提交结束计划",
  ended: "计划已结束",
  protection_exit: "保护价触发，计划已结束"
};

function numberText(value: string | null | undefined, digits?: number) {
  if (value == null || value === "") return "--";
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  const precision = digits ?? (Math.abs(number) >= 1 ? 2 : 8);
  return number.toLocaleString("en-US", { minimumFractionDigits: Math.min(2, precision), maximumFractionDigits: precision });
}

function moneyText(value: string | null | undefined) {
  return value == null ? "--" : `${numberText(value, 2)} U`;
}

function signedMoney(value: string | null | undefined) {
  if (value == null) return "--";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${numberText(value, 2)} U`;
}

function planCode(id: string) {
  return id.slice(0, 8).toUpperCase();
}

function projectionFor(plan: RollingPlan) {
  if (plan.status !== "running" || !plan.state.averagePrice || !plan.state.fixedAddNotional || !plan.state.protectionPrice || !plan.currentPrice) return null;
  const normalized = normalizePlan({
    schemaVersion: 1,
    symbol: plan.config.symbol,
    side: plan.config.side,
    triggerDirection: plan.config.triggerDirection,
    initialNotional: Number(plan.config.initialNotional),
    leverage: Number(plan.config.leverage),
    entry: plan.config.entryMode === "conditional"
      ? { mode: "conditional", direction: plan.config.entryDirection, triggerPrice: Number(plan.config.entryTriggerPrice) }
      : { mode: "immediate" },
    addInterval: { type: plan.config.intervalType, value: Number(plan.config.intervalValue) },
    addPercent: Number(plan.config.addPercent),
    maxAdds: plan.config.maxAdds,
    protectionDistance: Number(plan.config.protectionDistance)
  });
  return projectNextAdd({
    plan: normalized,
    status: "running",
    latestPrice: Number(plan.currentPrice),
    lastFillPrice: Number(plan.state.lastFillPrice),
    totalNotional: Number(plan.state.totalNotional),
    estimatedInitialMargin: Number(plan.state.totalNotional) / Number(plan.config.leverage),
    quantity: Number(plan.state.quantity),
    averagePrice: Number(plan.state.averagePrice),
    fixedAddNotional: Number(plan.state.fixedAddNotional),
    maxNotional: Number(plan.config.initialNotional) + Number(plan.state.fixedAddNotional) * plan.config.maxAdds,
    addsCompleted: plan.state.addsCompleted,
    nextTriggerPrice: plan.state.nextTriggerPrice == null ? null : Number(plan.state.nextTriggerPrice),
    protectionPrice: Number(plan.state.protectionPrice),
    lastEvent: { type: "price", price: Number(plan.currentPrice) }
  } satisfies RollingSimulationState);
}

export default function RollingToolPage() {
  const [plans, setPlans] = useState<RollingPlan[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [marketError, setMarketError] = useState("");
  const [endOpen, setEndOpen] = useState(false);
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [side, setSide] = useState<RollingSide>("long");
  const [triggerDirection, setTriggerDirection] = useState<RollingDirection>("rise");
  const [initialNotional, setInitialNotional] = useState("1,000");
  const [leverage, setLeverage] = useState("3");
  const [entryMode, setEntryMode] = useState<EntryMode>("immediate");
  const [entryDirection, setEntryDirection] = useState<RollingDirection>("rise");
  const [entryTriggerPrice, setEntryTriggerPrice] = useState("");
  const [intervalType, setIntervalType] = useState<IntervalType>("percent");
  const [intervalValue, setIntervalValue] = useState("2");
  const [addPercent, setAddPercent] = useState("50");
  const [maxAdds, setMaxAdds] = useState("4");
  const [protectionDistance, setProtectionDistance] = useState("6");
  const [draftQuote, setDraftQuote] = useState<string | null>(null);

  async function refresh(preferredId?: string) {
    const payload = await api.rollingPlans();
    setPlans(payload.plans);
    setMarketError(payload.marketError || "");
    setSelectedId((current) => {
      const wanted = preferredId || current;
      if (wanted === "new") return wanted;
      if (payload.plans.some((plan) => plan.id === wanted)) return wanted;
      return payload.plans[0]?.id || "new";
    });
  }

  useEffect(() => {
    let active = true;
    refresh().catch((reason) => active && setError(reason instanceof Error ? reason.message : "计划读取失败")).finally(() => active && setLoading(false));
    const timer = window.setInterval(() => {
      if (active) refresh().catch(() => undefined);
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (selectedId !== "new" || !/^[A-Z0-9]{5,20}$/.test(symbol)) {
      setDraftQuote(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api.rollingQuote(symbol)
        .then((quote) => {
          setDraftQuote(quote.price);
          setMarketError("");
        })
        .catch((reason) => {
          setDraftQuote(null);
          setMarketError(reason instanceof Error ? reason.message : "Binance 行情暂时不可用");
        });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [selectedId, symbol]);

  const selected = plans.find((plan) => plan.id === selectedId) || null;
  const projection = useMemo(() => selected ? projectionFor(selected) : null, [selected]);
  const initialValue = Number(initialNotional.replaceAll(",", ""));
  const leverageValue = Number(leverage);
  const maxAddsValue = Number(maxAdds);
  const fixedAdd = initialValue * Number(addPercent) / 100;
  const maxPositionValue = initialValue + fixedAdd * maxAddsValue;
  const estimatedInitialMargin = leverageValue > 0 ? maxPositionValue / leverageValue : Number.NaN;
  const intervalNumber = Number(intervalValue);
  const intervalSummary = Number.isFinite(intervalNumber)
    ? intervalNumber.toLocaleString("en-US", { maximumFractionDigits: 8 })
    : "--";
  const leverageSummary = Number.isFinite(leverageValue) && leverageValue > 0
    ? leverageValue.toLocaleString("en-US", { maximumFractionDigits: 8 })
    : "--";
  const currentSymbol = selected?.symbol || symbol;
  const currentPrice = selected?.currentPrice || draftQuote;
  const connected = selected ? selected.marketConnected : Boolean(draftQuote);

  async function startPlan(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const normalized = normalizePlan({
        schemaVersion: 1,
        symbol: symbol.trim().toUpperCase(),
        side,
        triggerDirection,
        initialNotional: initialNotional.replaceAll(",", ""),
        leverage,
        entry: entryMode === "conditional" ? { mode: entryMode, direction: entryDirection, triggerPrice: entryTriggerPrice } : { mode: entryMode },
        addInterval: { type: intervalType, value: intervalValue },
        addPercent,
        maxAdds,
        protectionDistance
      });
      const input: RollingPlanInput = {
        symbol: normalized.symbol,
        side: normalized.side,
        triggerDirection: normalized.triggerDirection,
        initialNotional: String(normalized.initialNotional),
        leverage: String(normalized.leverage),
        entryMode: normalized.entry.mode,
        entryDirection: normalized.entry.direction || "rise",
        entryTriggerPrice: normalized.entry.triggerPrice == null ? undefined : String(normalized.entry.triggerPrice),
        intervalType: normalized.addInterval.type,
        intervalValue: String(normalized.addInterval.value),
        addPercent: String(normalized.addPercent),
        maxAdds: String(normalized.maxAdds),
        protectionDistance: String(normalized.protectionDistance)
      };
      const result = await api.createRollingPlan(input);
      await refresh(result.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "请检查方案参数");
    } finally {
      setSaving(false);
    }
  }

  async function runAction(action: "pause" | "resume" | "end") {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      await api.rollingAction(selected.id, action);
      setEndOpen(false);
      await refresh(selected.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="rollingLoading">正在读取滚仓计划...</div>;

  return (
    <div className="positionSizingPage rollingToolPage" data-testid="rolling-tool-page">
      {plans.length ? (
        <nav className="rollingPlanTabs" aria-label="我的滚仓计划">
          {plans.map((plan) => (
            <button key={plan.id} type="button" className={selectedId === plan.id ? "active" : ""} onClick={() => setSelectedId(plan.id)}>
              <span><strong>{plan.symbol} · {plan.config.side === "long" ? "做多" : "做空"}</strong><small>计划 {planCode(plan.id)}</small></span>
              <b className={plan.status}>{statusLabels[plan.status]}</b>
            </button>
          ))}
          <button type="button" className={`rollingNewPlan ${selectedId === "new" ? "active" : ""}`} onClick={() => setSelectedId("new")}>＋ 新建计划</button>
        </nav>
      ) : null}

      {marketError ? <p className="positionError rollingTopError">{marketError}，行情恢复前不会执行新的触发。</p> : null}
      {error ? <p className="positionError rollingTopError">{error}</p> : null}

      <section className={`positionSizingGrid rollingToolGrid ${selected ? "hasPlan" : "isDraft"}`}>
        <form id="rolling-plan-form" className="positionSizingPanel positionSizingForm rollingConfigPanel" onSubmit={startPlan}>
          <div className="panelHead">
            <strong>方案参数</strong>
            <div className="rollingPanelMeta">
              <span className={`rollingInlineQuote ${connected ? "connected" : ""}`}><i /><b>{currentSymbol}</b><strong>{numberText(currentPrice)}</strong><em>{connected ? "实时" : "连接中"}</em></span>
              {selected ? <span>{statusLabels[selected.status]} · 已锁定</span> : null}
            </div>
          </div>
          <fieldset className="positionFormBody rollingToolFieldset" disabled={Boolean(selected) || saving}>
            <div className="positionFieldGrid">
              <label><span>交易标的</span><input value={selected?.config.symbol || symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="例如 BTCUSDT" /></label>
              <label><span>方向</span><span className="positionSegment"><button type="button" className={`long ${(selected?.config.side || side) === "long" ? "active" : ""}`} onClick={() => setSide("long")}>做多</button><button type="button" className={`short ${(selected?.config.side || side) === "short" ? "active" : ""}`} onClick={() => setSide("short")}>做空</button></span></label>
            </div>
            <div className="positionFieldGrid">
              <label><span>首次仓位价值</span><span className="positionInput"><input value={selected?.config.initialNotional || initialNotional} onChange={(event) => setInitialNotional(event.target.value)} inputMode="decimal" placeholder="例如 1,000" /><i>U</i></span></label>
              <label><span>杠杆</span><span className="positionInput"><input value={selected?.config.leverage || leverage} onChange={(event) => setLeverage(event.target.value)} inputMode="decimal" /><i>×</i></span></label>
            </div>
            <div className="positionFieldGrid">
              <label><span>加仓触发</span><select className="rollingSelect" value={selected?.config.triggerDirection || triggerDirection} onChange={(event) => setTriggerDirection(event.target.value as RollingDirection)}><option value="rise">价格上涨时</option><option value="fall">价格下跌时</option></select></label>
              <label><span>加仓间隔</span><span className="rollingTriggerInput"><select value={selected?.config.intervalType || intervalType} onChange={(event) => setIntervalType(event.target.value as IntervalType)}><option value="percent">百分比</option><option value="absolute">固定价差</option></select><input value={selected?.config.intervalValue || intervalValue} onChange={(event) => setIntervalValue(event.target.value)} inputMode="decimal" /></span></label>
            </div>
            <div className="positionFieldGrid">
              <label><span>单次加仓比例</span><span className="positionInput"><input value={selected?.config.addPercent || addPercent} onChange={(event) => setAddPercent(event.target.value)} inputMode="decimal" /><i>%</i></span></label>
              <label><span>最大加仓次数</span><span className="positionInput"><input value={selected ? String(selected.config.maxAdds) : maxAdds} onChange={(event) => setMaxAdds(event.target.value)} inputMode="numeric" /><i>次</i></span></label>
            </div>
            <div className="positionFieldGrid">
              <label><span>保护距离</span><span className="positionInput"><input value={selected?.config.protectionDistance || protectionDistance} onChange={(event) => setProtectionDistance(event.target.value)} inputMode="decimal" /><i>%</i></span></label>
              <label><span>首仓方式</span><select className="rollingSelect" value={selected?.config.entryMode || entryMode} onChange={(event) => setEntryMode(event.target.value as EntryMode)}><option value="immediate">按实时价立即执行</option><option value="conditional">条件触发</option></select></label>
            </div>
            {(selected?.config.entryMode || entryMode) === "conditional" ? (
              <div className="positionFieldGrid rollingEntryRow"><label><span>首仓条件</span><span className="rollingTriggerInput"><select value={selected?.config.entryDirection || entryDirection} onChange={(event) => setEntryDirection(event.target.value as RollingDirection)}><option value="rise">上涨至</option><option value="fall">下跌至</option></select><input value={selected?.config.entryTriggerPrice || entryTriggerPrice} onChange={(event) => setEntryTriggerPrice(event.target.value)} inputMode="decimal" placeholder="触发价格" /></span></label></div>
            ) : null}
            {selected ? <small className="rollingLockedNote">结束当前计划后，才能修改参数并重新启动。</small> : null}
          </fieldset>
        </form>

        <aside className="positionSizingPanel rollingStatusPanel">
          <div className="panelHead"><strong>{selected ? "计划状态" : "计划摘要"}</strong><span className={`rollingStatus ${selected?.status || "draft"}`}><i />{selected ? statusLabels[selected.status] : "实时计算"}</span></div>
          {selected ? (
            <div className="rollingStatusBody">
              <div className="rollingControlBar"><span>{selected.marketConnected ? "行情自动监听，满足条件时按最新价执行。" : "行情连接中，恢复前不会执行新的触发。"}</span><div>{selected.status === "running" ? <button type="button" onClick={() => runAction("pause")} disabled={saving}>暂停加仓</button> : selected.status === "paused" ? <button type="button" onClick={() => runAction("resume")} disabled={saving}>恢复运行</button> : null}{!(["ending", "ended"] as string[]).includes(selected.status) ? <button type="button" className="danger" onClick={() => setEndOpen(true)} disabled={saving}>结束计划</button> : null}</div></div>
              <div className="rollingMetrics">
                <div><span>累计投入</span><strong>{moneyText(selected.state.totalNotional)}</strong></div>
                <div><span>当前名义价值</span><strong>{moneyText(selected.currentNotional)}</strong></div>
                <div><span>持仓均价</span><strong>{numberText(selected.state.averagePrice)}</strong></div>
                <div><span>浮动盈亏</span><strong className={Number(selected.estimatedPnl) >= 0 ? "positive" : "negative"}>{signedMoney(selected.estimatedPnl)}</strong></div>
                <div><span>加仓进度</span><strong data-testid="rolling-add-progress">已完成 {selected.state.addsCompleted} · 剩余 {Math.max(0, selected.config.maxAdds - selected.state.addsCompleted)}</strong></div>
                <div><span>预估保证金</span><strong>{moneyText(selected.estimatedMargin)}</strong></div>
              </div>
              <section className="rollingProjection"><h3>下一次加仓后估算</h3>{projection ? <div><span><small>下一触发价</small><strong>{numberText(String(projection.fillPrice))}</strong></span><span><small>仓位价值</small><strong>{moneyText(String(projection.totalNotional))}</strong></span><span><small>持仓均价</small><strong>{numberText(String(projection.averagePrice))}</strong></span><span><small>保护价</small><strong>{numberText(String(projection.protectionPrice))}</strong></span></div> : <p>{selected.status === "waiting_entry" ? "首仓成交后显示" : selected.status === "holding_protection" ? "已达到最大加仓次数" : "当前无下一次加仓"}</p>}</section>
              <section className="rollingEvents"><header><strong>执行记录</strong><span>实时行情</span></header>{selected.events.length ? selected.events.slice(0, 6).map((item) => <div key={item.id}><time>{formatStoredDateTime(item.createdAt)}</time><b>{item.type === "add" ? `第 ${String(item.detail.addNumber || "")} 次加仓执行` : eventLabels[item.type] || "计划状态更新"}</b><strong>{numberText(item.price)}</strong></div>) : <p>暂无执行记录</p>}</section>
              <p className="rollingRuntimeNote">计划按 Binance 实时行情和计划规则运行，关闭页面后仍在服务器运行。</p>
            </div>
          ) : (
            <div className="rollingPlanSummary">
              <dl>
                <div><dt>首仓</dt><dd>{Number.isFinite(initialValue) ? moneyText(String(initialValue)) : "--"}</dd></div>
                <div className="rollingSummaryRule"><dt>加仓规则</dt><dd>价格每{triggerDirection === "rise" ? "上涨" : "下跌"} {intervalSummary}{intervalType === "percent" ? "%" : ""}，固定加仓 {Number.isFinite(fixedAdd) ? moneyText(String(fixedAdd)) : "--"}</dd></div>
                <div><dt>最多加仓</dt><dd>{Number.isInteger(maxAddsValue) && maxAddsValue >= 0 ? `${maxAddsValue} 次` : "--"}</dd></div>
                <div className="rollingSummaryTotal"><dt>全部触发后</dt><dd>总仓位 {Number.isFinite(maxPositionValue) ? moneyText(String(maxPositionValue)) : "--"}</dd></div>
                <div><dt>预计占用保证金</dt><dd>{Number.isFinite(estimatedInitialMargin) ? moneyText(String(estimatedInitialMargin)) : "--"}<small>按 {leverageSummary}× 杠杆</small></dd></div>
              </dl>
              <p className="rollingRuntimeNote">按 Binance 实时行情和计划规则运行。</p>
              <button className="rollingPrimaryButton" data-testid="rolling-start" form="rolling-plan-form" type="submit" disabled={saving || !connected}>{saving ? "正在启动..." : "启动计划"}</button>
            </div>
          )}
        </aside>
      </section>

      {endOpen && selected ? <div className="rollingModal" role="dialog" aria-modal="true" aria-label="结束计划"><section><h2>结束计划？</h2><p>确认后将按下一笔 Binance 最新成交价结束计划并计算最终盈亏，结束后不可恢复。</p><div><button type="button" onClick={() => setEndOpen(false)}>取消</button><button type="button" className="danger" onClick={() => runAction("end")} disabled={saving}>确认结束</button></div></section></div> : null}
    </div>
  );
}

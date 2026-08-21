const DEFAULTS = Object.freeze({
  leverage: 3,
  entryMode: 'immediate',
  intervalType: 'percent',
  intervalValue: 2,
  addPercent: 50,
  maxAdds: 4,
  protectionDistance: 6,
})

function positive(value, name) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} 必须大于 0`)
  return number
}

function choice(value, allowed, name) {
  if (!allowed.includes(value)) throw new Error(`${name} 无效`)
  return value
}

export function normalizePlan(raw = {}) {
  if (raw.schemaVersion != null && raw.schemaVersion !== 1) throw new Error('不支持的方案版本')

  const entry = raw.entry ?? {}
  const interval = raw.addInterval ?? {}
  const plan = {
    schemaVersion: 1,
    symbol: String(raw.symbol ?? '').trim(),
    side: choice(raw.side, ['long', 'short'], '方向'),
    triggerDirection: choice(raw.triggerDirection, ['rise', 'fall'], '加仓触发方向'),
    initialNotional: positive(raw.initialNotional, '首次仓位价值'),
    leverage: positive(raw.leverage ?? DEFAULTS.leverage, '杠杆'),
    entry: {
      mode: choice(entry.mode ?? DEFAULTS.entryMode, ['immediate', 'conditional'], '首仓方式'),
    },
    addInterval: {
      type: choice(interval.type ?? DEFAULTS.intervalType, ['percent', 'absolute'], '加仓间隔类型'),
      value: positive(interval.value ?? DEFAULTS.intervalValue, '加仓间隔'),
    },
    addPercent: positive(raw.addPercent ?? DEFAULTS.addPercent, '加仓比例'),
    maxAdds: Number(raw.maxAdds ?? DEFAULTS.maxAdds),
    protectionDistance: positive(raw.protectionDistance ?? DEFAULTS.protectionDistance, '保护距离'),
  }

  if (!plan.symbol) throw new Error('交易标的不能为空')
  if (!Number.isInteger(plan.maxAdds) || plan.maxAdds < 0) throw new Error('最大加仓次数必须是非负整数')
  if (plan.triggerDirection === 'fall' && plan.addInterval.type === 'percent' && plan.addInterval.value >= 100) {
    throw new Error('下跌百分比间隔必须小于 100')
  }
  if (plan.entry.mode === 'conditional') {
    plan.entry.direction = choice(entry.direction, ['rise', 'fall'], '首仓触发方向')
    plan.entry.triggerPrice = positive(entry.triggerPrice, '首仓触发价')
  }
  return plan
}

function triggerPrice(plan, fillPrice) {
  const distance = plan.addInterval.type === 'percent'
    ? fillPrice * plan.addInterval.value / 100
    : plan.addInterval.value
  const price = plan.triggerDirection === 'rise' ? fillPrice + distance : fillPrice - distance
  if (price <= 0) throw new Error('下一触发价必须大于 0')
  return price
}

function rawProtectionPrice(plan, averagePrice) {
  const distance = averagePrice * plan.protectionDistance / 100
  const price = plan.side === 'long' ? averagePrice - distance : averagePrice + distance
  if (price <= 0) throw new Error('保护价必须大于 0')
  return price
}

function tightenProtection(side, current, candidate) {
  if (current == null) return candidate
  return side === 'long' ? Math.max(current, candidate) : Math.min(current, candidate)
}

function protectionHit(state, price) {
  return state.plan.side === 'long'
    ? price <= state.protectionPrice
    : price >= state.protectionPrice
}

function addTriggered(state, price) {
  return state.plan.triggerDirection === 'rise'
    ? price >= state.nextTriggerPrice
    : price <= state.nextTriggerPrice
}

function pnl(side, quantity, averagePrice, exitPrice) {
  return quantity * (side === 'long' ? exitPrice - averagePrice : averagePrice - exitPrice)
}

export function startSimulation(rawPlan, entryFillPrice) {
  const plan = normalizePlan(rawPlan)
  const fillPrice = positive(entryFillPrice, '首仓成交价')
  const fixedAddNotional = plan.initialNotional * plan.addPercent / 100
  const quantity = plan.initialNotional / fillPrice
  return {
    plan,
    status: plan.maxAdds === 0 ? 'holding_protection' : 'running',
    latestPrice: fillPrice,
    lastFillPrice: fillPrice,
    totalNotional: plan.initialNotional,
    estimatedInitialMargin: plan.initialNotional / plan.leverage,
    quantity,
    averagePrice: fillPrice,
    fixedAddNotional,
    maxNotional: plan.initialNotional + fixedAddNotional * plan.maxAdds,
    addsCompleted: 0,
    nextTriggerPrice: plan.maxAdds === 0 ? null : triggerPrice(plan, fillPrice),
    protectionPrice: rawProtectionPrice(plan, fillPrice),
    lastEvent: { type: 'entry', fillPrice },
  }
}

export function applyMarketPrice(state, marketPrice) {
  const price = positive(marketPrice, '执行价')
  if (state.status === 'ended') return { ...state, latestPrice: price }

  if (protectionHit(state, price)) {
    return {
      ...state,
      status: 'ended',
      latestPrice: price,
      nextTriggerPrice: null,
      exitPrice: price,
      estimatedPnl: pnl(state.plan.side, state.quantity, state.averagePrice, price),
      lastEvent: { type: 'protection_exit', fillPrice: price },
    }
  }

  if (state.status !== 'running' || !addTriggered(state, price)) {
    return { ...state, latestPrice: price, lastEvent: { type: 'price', price } }
  }

  const addedQuantity = state.fixedAddNotional / price
  const quantity = state.quantity + addedQuantity
  const totalNotional = state.totalNotional + state.fixedAddNotional
  const averagePrice = totalNotional / quantity
  const addsCompleted = state.addsCompleted + 1
  const finishedAdding = addsCompleted >= state.plan.maxAdds
  const protectionPrice = tightenProtection(
    state.plan.side,
    state.protectionPrice,
    rawProtectionPrice(state.plan, averagePrice),
  )

  return {
    ...state,
    status: finishedAdding ? 'holding_protection' : 'running',
    latestPrice: price,
    lastFillPrice: price,
    totalNotional,
    estimatedInitialMargin: totalNotional / state.plan.leverage,
    quantity,
    averagePrice,
    addsCompleted,
    nextTriggerPrice: finishedAdding ? null : triggerPrice(state.plan, price),
    protectionPrice,
    lastEvent: { type: 'add', fillPrice: price, addNumber: addsCompleted },
  }
}

export function projectNextAdd(state) {
  if (state.status !== 'running' || state.nextTriggerPrice == null) return null
  const fillPrice = state.nextTriggerPrice
  const blockedByProtection = protectionHit(state, fillPrice)
  const quantity = state.quantity + state.fixedAddNotional / fillPrice
  const totalNotional = state.totalNotional + state.fixedAddNotional
  const averagePrice = totalNotional / quantity
  return {
    fillPrice,
    blockedByProtection,
    totalNotional,
    estimatedInitialMargin: totalNotional / state.plan.leverage,
    quantity,
    averagePrice,
    protectionPrice: tightenProtection(
      state.plan.side,
      state.protectionPrice,
      rawProtectionPrice(state.plan, averagePrice),
    ),
  }
}

export function simulatePath(rawPlan, entryFillPrice, marketPrices) {
  const states = [startSimulation(rawPlan, entryFillPrice)]
  for (const price of marketPrices) {
    const next = applyMarketPrice(states.at(-1), price)
    states.push(next)
    if (next.status === 'ended') break
  }
  return states
}

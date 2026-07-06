export type PositionDirection = "long" | "short";

export type PositionSizingInput = {
  direction: PositionDirection;
  accountSize: number;
  riskAmount: number;
  entryPrice: number;
  stopPrice: number;
  latestPrice?: number | null;
};

export type PositionSizingResult = {
  perShareRisk: number;
  shares: number;
  positionAmount: number;
  actualRisk: number;
  riskPct: number;
  stopDistancePct: number;
  breakevenPrice: number;
  oneRPrice: number;
  twoRPrice: number;
  latestPnl: number | null;
};

export function calculatePositionSizing(input: PositionSizingInput): PositionSizingResult {
  const { direction, accountSize, riskAmount, entryPrice, stopPrice, latestPrice } = input;
  if (![accountSize, riskAmount, entryPrice, stopPrice].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("请填写大于 0 的账户资金、单笔最大亏损、买入价和止损价。");
  }

  const perShareRisk = direction === "long" ? entryPrice - stopPrice : stopPrice - entryPrice;
  if (perShareRisk <= 0) {
    throw new Error(direction === "long" ? "做多时止损价必须低于买入价。" : "做空时止损价必须高于卖出价。");
  }

  const shares = Math.floor(riskAmount / perShareRisk);
  if (shares < 1) {
    throw new Error("单笔最大亏损不足以买入 1 股，请放宽止损或提高风险金额。");
  }

  const positionAmount = shares * entryPrice;
  const actualRisk = shares * perShareRisk;
  const targetSign = direction === "long" ? 1 : -1;
  const cleanLatest = Number.isFinite(latestPrice || NaN) && Number(latestPrice) > 0 ? Number(latestPrice) : null;

  return {
    perShareRisk,
    shares,
    positionAmount,
    actualRisk,
    riskPct: (actualRisk / accountSize) * 100,
    stopDistancePct: (perShareRisk / entryPrice) * 100,
    breakevenPrice: entryPrice,
    oneRPrice: entryPrice + targetSign * perShareRisk,
    twoRPrice: entryPrice + targetSign * perShareRisk * 2,
    latestPnl: cleanLatest === null ? null : (cleanLatest - entryPrice) * shares * targetSign
  };
}

export type PositionDirection = "long" | "short";

export type PositionSizingInput = {
  direction: PositionDirection;
  accountSize: number;
  riskAmount: number;
  entryPrice: number;
  stopPrice: number;
};

export type PositionSizingResult = {
  perShareRisk: number;
  shares: number;
  riskBasedShares: number;
  positionAmount: number;
  positionPct: number;
  actualRisk: number;
  riskPct: number;
  stopDistancePct: number;
  oneRPrice: number;
  twoRPrice: number;
  cashLimited: boolean;
};

export function calculatePositionSizing(input: PositionSizingInput): PositionSizingResult {
  const { direction, accountSize, riskAmount, entryPrice, stopPrice } = input;
  if (![accountSize, riskAmount, entryPrice, stopPrice].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("请填写大于 0 的账户资金、单笔最大亏损、买入价和止损价。");
  }

  const perShareRisk = direction === "long" ? entryPrice - stopPrice : stopPrice - entryPrice;
  if (perShareRisk <= 0) {
    throw new Error(direction === "long" ? "做多时止损价必须低于买入价。" : "做空时止损价必须高于卖出价。");
  }

  const riskBasedShares = Math.floor(riskAmount / perShareRisk);
  if (riskBasedShares < 1) {
    throw new Error("单笔最大亏损不足以交易 1 股，请提高风险金额或调整止损位置。");
  }

  const cashBasedShares = Math.floor(accountSize / entryPrice);
  if (cashBasedShares < 1) {
    throw new Error("账户资金不足以交易 1 股。");
  }

  const shares = Math.min(riskBasedShares, cashBasedShares);
  const positionAmount = shares * entryPrice;
  const actualRisk = shares * perShareRisk;
  const targetSign = direction === "long" ? 1 : -1;

  return {
    perShareRisk,
    shares,
    riskBasedShares,
    positionAmount,
    positionPct: (positionAmount / accountSize) * 100,
    actualRisk,
    riskPct: (actualRisk / accountSize) * 100,
    stopDistancePct: (perShareRisk / entryPrice) * 100,
    oneRPrice: entryPrice + targetSign * perShareRisk,
    twoRPrice: entryPrice + targetSign * perShareRisk * 2,
    cashLimited: cashBasedShares < riskBasedShares
  };
}

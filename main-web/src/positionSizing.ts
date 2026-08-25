export type PositionDirection = "long" | "short";

export type PositionSizingInput = {
  direction: PositionDirection;
  accountSize: number;
  riskAmount: number;
  entryPrice: number;
  stopPrice: number;
  quantityStep?: number;
  leverage?: number;
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
  requiredMargin: number;
  cashLimited: boolean;
};

export function calculatePositionSizing(input: PositionSizingInput): PositionSizingResult {
  const { direction, accountSize, riskAmount, entryPrice, stopPrice, quantityStep = 1, leverage = 1 } = input;
  if (![accountSize, riskAmount, entryPrice, stopPrice].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("请填写大于 0 的账户资金、单笔最大亏损、买入价和止损价。");
  }
  if (!Number.isFinite(quantityStep) || quantityStep <= 0 || !Number.isFinite(leverage) || leverage < 1) {
    throw new Error("请检查下单精度和杠杆。");
  }

  const perShareRisk = direction === "long" ? entryPrice - stopPrice : stopPrice - entryPrice;
  if (perShareRisk <= 0) {
    throw new Error(direction === "long" ? "做多时止损价必须低于买入价。" : "做空时止损价必须高于卖出价。");
  }

  const stepText = String(quantityStep).toLowerCase();
  const stepDigits = stepText.includes("e-") ? Number(stepText.split("e-")[1]) : (stepText.split(".")[1]?.length || 0);
  const floorToStep = (value: number) => Number((Math.floor(value / quantityStep + 1e-10) * quantityStep).toFixed(Math.min(12, stepDigits)));
  const riskBasedShares = floorToStep(riskAmount / perShareRisk);
  if (riskBasedShares < quantityStep) {
    throw new Error(quantityStep === 1 ? "单笔最大亏损不足以交易 1 股，请提高风险金额或调整止损位置。" : "单笔最大亏损不足以达到最小下单数量。");
  }

  const cashBasedShares = floorToStep(accountSize * leverage / entryPrice);
  if (cashBasedShares < quantityStep) {
    throw new Error(quantityStep === 1 ? "账户资金不足以交易 1 股。" : "账户资金不足以达到最小下单数量。");
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
    requiredMargin: positionAmount / leverage,
    cashLimited: cashBasedShares < riskBasedShares
  };
}

export type RollingSide = "long" | "short";
export type RollingDirection = "rise" | "fall";
export type RollingStatus = "running" | "holding_protection" | "ended";

export type RollingPlan = {
  schemaVersion: 1;
  symbol: string;
  side: RollingSide;
  triggerDirection: RollingDirection;
  initialNotional: number;
  leverage: number;
  entry: {
    mode: "immediate" | "conditional";
    direction?: RollingDirection;
    triggerPrice?: number;
  };
  addInterval: {
    type: "percent" | "absolute";
    value: number;
  };
  addPercent: number;
  maxAdds: number;
  protectionDistance: number;
};

export type RollingEvent =
  | { type: "entry"; fillPrice: number }
  | { type: "add"; fillPrice: number; addNumber: number }
  | { type: "protection_exit"; fillPrice: number }
  | { type: "price"; price: number };

export type RollingSimulationState = {
  plan: RollingPlan;
  status: RollingStatus;
  latestPrice: number;
  lastFillPrice: number;
  totalNotional: number;
  estimatedInitialMargin: number;
  quantity: number;
  averagePrice: number;
  fixedAddNotional: number;
  maxNotional: number;
  addsCompleted: number;
  nextTriggerPrice: number | null;
  protectionPrice: number;
  exitPrice?: number;
  estimatedPnl?: number;
  lastEvent: RollingEvent;
};

export type RollingProjection = {
  fillPrice: number;
  blockedByProtection: boolean;
  totalNotional: number;
  estimatedInitialMargin: number;
  quantity: number;
  averagePrice: number;
  protectionPrice: number;
};

export function normalizePlan(raw?: unknown): RollingPlan;
export function startSimulation(rawPlan: unknown, entryFillPrice: number): RollingSimulationState;
export function applyMarketPrice(state: RollingSimulationState, marketPrice: number): RollingSimulationState;
export function projectNextAdd(state: RollingSimulationState): RollingProjection | null;
export function simulatePath(rawPlan: unknown, entryFillPrice: number, marketPrices: number[]): RollingSimulationState[];

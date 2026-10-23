import { USDT, packagePrice } from './economics-v2.js';

// Miner tokens do NOT fill the Max Profit / Max Cap bars; only USDT does.
// Their 10-cent reference value is shown to members but never deducted.
export const MINER_TOKEN_PRICE = USDT / 10n;
// Profit is paid every 30 days from activation.
export const SETTLEMENT_PERIOD_DAYS = 30;
// A member may activate investment packs up to 10× their token package price.
export const INVESTMENT_PACKAGE_MULTIPLIER = 10n;
// Every $11 of eligible volume is one Fixed Cycle.
export const FIXED_CYCLE_PRICE = 11n * USDT;
export const CANCELLATION_WINDOW_MONTHS = 2;

export const INVESTMENT_PLANS = [
  { code: 'INV110', principal: 110n, monthlyProfit: 3n, maxProfit: 300n, maxCap: 700n, fixedCycles: 10, monthlyTokens: 30n },
  { code: 'INV330', principal: 330n, monthlyProfit: 12n, maxProfit: 900n, maxCap: 2_000n, fixedCycles: 30, monthlyTokens: 100n },
  { code: 'INV1100', principal: 1_100n, monthlyProfit: 50n, maxProfit: 3_000n, maxCap: 7_000n, fixedCycles: 100, monthlyTokens: 300n },
  { code: 'INV3300', principal: 3_300n, monthlyProfit: 180n, maxProfit: 9_000n, maxCap: 20_000n, fixedCycles: 300, monthlyTokens: 1_000n },
  { code: 'INV11000', principal: 11_000n, monthlyProfit: 700n, maxProfit: 30_000n, maxCap: 70_000n, fixedCycles: 1_000, monthlyTokens: 3_000n },
] as const;

export function investmentPlan(code: string) {
  const plan = INVESTMENT_PLANS.find(item => item.code === code);
  if (!plan) throw new Error('Unknown investment plan');
  return {
    code: plan.code, principal: plan.principal * USDT, monthlyProfit: plan.monthlyProfit * USDT, monthlyTokens: plan.monthlyTokens,
    maxProfit: plan.maxProfit * USDT, maxCap: plan.maxCap * USDT, fixedCycles: plan.fixedCycles,
  };
}

/** Investment packs a token-package holder may buy: principal ≤ 10 × package price. */
export function investmentAllowed(planCode: string, packageCode: string | null | undefined) {
  if (!packageCode) return false;
  return investmentPlan(planCode).principal <= packagePrice(packageCode) * INVESTMENT_PACKAGE_MULTIPLIER;
}
export function allowedInvestmentPlans(packageCode: string | null | undefined) {
  return INVESTMENT_PLANS.filter(plan => investmentAllowed(plan.code, packageCode)).map(plan => investmentPlan(plan.code));
}

/** Binary volume and commission allocation for a purchase, mirroring packages. */
export function investmentVolume(fixedCycles: number, policy: { cycleVolume: bigint; cycleReward: bigint }) {
  const volume = BigInt(fixedCycles) * policy.cycleVolume;
  return { volume, commission: BigInt(fixedCycles) * policy.cycleReward };
}

const PERIOD_MS = SETTLEMENT_PERIOD_DAYS * 86_400_000;
export const periodKey = (index: number) => `P${String(index).padStart(4, '0')}`;

/** 30-day periods since activation that have ended and are not yet settled. */
export function dueSettlements(startedAt: Date, settledThrough: string | null, now: Date) {
  const due: Array<{ month: string; endsAt: Date }> = [];
  const ended = Math.floor((now.getTime() - startedAt.getTime()) / PERIOD_MS);
  for (let index = 1; index <= Math.min(ended, 1200); index++) {
    const key = periodKey(index);
    if (!settledThrough || key > settledThrough) due.push({ month: key, endsAt: new Date(startedAt.getTime() + index * PERIOD_MS) });
  }
  return due;
}
export const nextSettlementAt = (startedAt: Date, now: Date) =>
  new Date(startedAt.getTime() + (Math.floor((now.getTime() - startedAt.getTime()) / PERIOD_MS) + 1) * PERIOD_MS);

/**
 * One period's payout. USDT profit fills the bars and stops at Max Profit;
 * miner tokens keep coming until the Max Cap bar is full (USDT commissions
 * also fill it), then they lock too.
 */
export function monthlyPayout(investment: { monthlyProfit: bigint; monthlyTokens: bigint; maxProfit: bigint; maxCap: bigint; valueConsumed: bigint }) {
  const profitRoom = investment.maxProfit > investment.valueConsumed ? investment.maxProfit - investment.valueConsumed : 0n;
  const capRoom = investment.maxCap > investment.valueConsumed ? investment.maxCap - investment.valueConsumed : 0n;
  const profit = [investment.monthlyProfit, profitRoom, capRoom].reduce((a, b) => (a < b ? a : b));
  const tokens = capRoom > 0n ? investment.monthlyTokens : 0n;
  return { profit, tokens, value: profit, completes: investment.valueConsumed + profit >= investment.maxCap };
}

/**
 * What the next settlement(s) will pay, accrued up to now: periods already due
 * but not yet settled count in full, the running period pro rata. Rates let
 * the dashboard animate the counters between refreshes from real figures.
 */
export function accrual(investment: { startedAt: Date; settledThrough: string | null; status: string; monthlyProfit: bigint; monthlyTokens: bigint; maxProfit: bigint; maxCap: bigint; valueConsumed: bigint }, now: Date) {
  const elapsed = Math.max(0, now.getTime() - investment.startedAt.getTime());
  const next = nextSettlementAt(investment.startedAt, now);
  if (investment.status !== 'ACTIVE') return { pendingProfit: 0n, pendingTokens: 0n, profitPerDay: 0n, tokensPerDay: 0, periodStart: null, nextSettlementAt: null };
  let simulated = { ...investment };
  let pendingProfit = 0n, pendingTokens = 0n;
  for (const _due of dueSettlements(investment.startedAt, investment.settledThrough, now)) {
    const payout = monthlyPayout(simulated);
    pendingProfit += payout.profit; pendingTokens += payout.tokens;
    simulated = { ...simulated, valueConsumed: simulated.valueConsumed + payout.profit };
  }
  const full = monthlyPayout(simulated);
  const into = BigInt(elapsed % PERIOD_MS), period = BigInt(PERIOD_MS);
  pendingProfit += full.profit * into / period;
  pendingTokens += full.tokens * into / period;
  return {
    pendingProfit, pendingTokens,
    profitPerDay: full.profit / BigInt(SETTLEMENT_PERIOD_DAYS),
    tokensPerDay: Number(full.tokens) / SETTLEMENT_PERIOD_DAYS,
    periodStart: new Date(next.getTime() - PERIOD_MS),
    nextSettlementAt: next,
  };
}

export function cancellationDeadline(startedAt: Date) {
  const deadline = new Date(startedAt);
  deadline.setUTCMonth(deadline.getUTCMonth() + CANCELLATION_WINDOW_MONTHS);
  return deadline;
}

/**
 * Terms §4: within two months, the USDT profits received and the commissions
 * paid for the purchase are deducted from the principal; any remainder is
 * refunded to the in-app wallet.
 */
export function cancellationQuote(investment: { principal: bigint; profitPaid: bigint; tokensPaid: bigint; commissionAllocation: bigint; startedAt: Date; status: string }, now: Date) {
  const deadline = cancellationDeadline(investment.startedAt);
  const deductions = investment.profitPaid + investment.commissionAllocation;
  const refund = investment.principal > deductions ? investment.principal - deductions : 0n;
  return { eligible: investment.status === 'ACTIVE' && now < deadline, deadline, deductions, refund };
}

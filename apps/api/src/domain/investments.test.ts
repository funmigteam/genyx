import { describe, expect, it } from 'vitest';
import { accrual, allowedInvestmentPlans, cancellationQuote, dueSettlements, investmentAllowed, investmentPlan, investmentVolume, monthlyPayout, nextSettlementAt } from './investments.js';
import { binaryCyclePolicy, USDT } from './economics-v2.js';

describe('investment plans', () => {
  it('fills the bars with USDT only: $110 pays $3 profit + 30 tokens, $3 of progress', () => {
    const month = monthlyPayout({ ...investmentPlan('INV110'), valueConsumed: 0n });
    expect(month).toEqual({ profit: 3n * USDT, tokens: 30n, value: 3n * USDT, completes: false });
  });
  it('stops profit at Max Profit but keeps miner tokens until Max Cap', () => {
    const plan = investmentPlan('INV110');
    expect(monthlyPayout({ ...plan, valueConsumed: 299n * USDT })).toMatchObject({ profit: 1n * USDT, tokens: 30n });
    expect(monthlyPayout({ ...plan, valueConsumed: 300n * USDT })).toMatchObject({ profit: 0n, tokens: 30n, completes: false });
    expect(monthlyPayout({ ...plan, valueConsumed: 700n * USDT })).toMatchObject({ profit: 0n, tokens: 0n, completes: true });
  });
  it('generates Fixed Cycles: 10 USDT of volume per line and 1 USDT per cycle', () => {
    expect(investmentVolume(investmentPlan('INV110').fixedCycles, binaryCyclePolicy())).toEqual({ volume: 100n * USDT, commission: 10n * USDT });
  });
  it('allows packs up to 10× the token package price', () => {
    expect(allowedInvestmentPlans('BRONZE').map(p => p.code)).toEqual(['INV110']);
    expect(allowedInvestmentPlans('SILVER').map(p => p.code)).toEqual(['INV110', 'INV330']);
    expect(allowedInvestmentPlans('GOLD').map(p => p.code)).toEqual(['INV110', 'INV330', 'INV1100']);
    expect(allowedInvestmentPlans('PLATINUM').map(p => p.code)).toEqual(['INV110', 'INV330', 'INV1100', 'INV3300']);
    expect(allowedInvestmentPlans('DIAMOND')).toHaveLength(5);
    expect(investmentAllowed('INV110', null)).toBe(false);
  });
});

describe('settlement schedule', () => {
  const start = new Date('2026-10-16T00:00:00Z');
  it('pays every 30 days after activation', () => {
    expect(dueSettlements(start, null, new Date('2026-11-14T23:59:59Z'))).toEqual([]);
    expect(dueSettlements(start, null, new Date('2026-12-15T00:00:01Z')).map(d => d.month)).toEqual(['P0001', 'P0002']);
    expect(nextSettlementAt(start, new Date('2026-10-20T00:00:00Z'))).toEqual(new Date('2026-11-15T00:00:00Z'));
  });
  it('never repeats a settled period', () => {
    expect(dueSettlements(start, 'P0002', new Date('2026-12-20T00:00:00Z'))).toEqual([]);
  });
});

describe('cancellation', () => {
  const base = { ...investmentPlan('INV110'), commissionAllocation: 10n * USDT, profitPaid: 0n, tokensPaid: 0n, startedAt: new Date('2026-10-13T00:00:00Z'), status: 'ACTIVE' };
  it('refunds principal minus profits and commissions (not tokens) within two months', () => {
    const quote = cancellationQuote({ ...base, profitPaid: 3n * USDT, tokensPaid: 30n }, new Date('2026-11-20T00:00:00Z'));
    expect(quote.eligible).toBe(true);
    expect(quote.refund).toBe(97n * USDT);
  });
  it('closes after two months and never refunds a negative balance', () => {
    expect(cancellationQuote(base, new Date('2026-12-13T00:00:01Z')).eligible).toBe(false);
    expect(cancellationQuote({ ...base, profitPaid: 200n * USDT }, new Date('2026-10-20T00:00:00Z')).refund).toBe(0n);
  });
});

describe('accrual for the dashboard', () => {
  const base = { ...investmentPlan('INV110'), startedAt: new Date('2026-10-01T00:00:00Z'), settledThrough: null, status: 'ACTIVE', valueConsumed: 0n };
  it('accrues the running period pro rata with real daily rates', () => {
    const half = accrual(base, new Date('2026-10-16T00:00:00Z'));
    expect(half).toMatchObject({ pendingProfit: 1_500_000n, pendingTokens: 15n, profitPerDay: 100_000n, tokensPerDay: 1 });
    expect(half.nextSettlementAt).toEqual(new Date('2026-10-31T00:00:00Z'));
  });
  it('adds periods that are due but not yet settled, and nothing once closed', () => {
    expect(accrual(base, new Date('2026-11-15T00:00:00Z'))).toMatchObject({ pendingProfit: 4_500_000n, pendingTokens: 45n });
    expect(accrual({ ...base, valueConsumed: 300n * USDT }, new Date('2026-10-16T00:00:00Z'))).toMatchObject({ pendingProfit: 0n, pendingTokens: 15n });
    expect(accrual({ ...base, status: 'COMPLETED' }, new Date('2026-10-16T00:00:00Z'))).toMatchObject({ pendingProfit: 0n, pendingTokens: 0n, nextSettlementAt: null });
  });
});

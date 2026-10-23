import { describe, it, expect } from 'vitest';
import { USDT, PACKAGE_RULES, packagePrice, packageQuote, binarySettlement, binaryCyclePolicy, seasonDayKey, dailyWindowStart, auctionWinners } from './economics-v2.js';
describe('approved economics', () => {
  it('settles 10/10 as 1 USDT without rounding up or reusing volume', () => {
    const result = binarySettlement(10n * USDT, 10n * USDT, 0n, 100n * USDT);
    expect(result).toMatchObject({ credited: 1n * USDT, slots: 1n, vouchers: 0n, left: 0n, right: 0n });
    expect(binarySettlement(result.left, result.right, result.totalSlots, 100n * USDT).credited).toBe(0n);
    expect(binarySettlement(9_999_999n, 10n * USDT, 0n, 100n * USDT).slots).toBe(0n);
  });
  it.each(PACKAGE_RULES.map(rule => rule.code))('sells %s at full price: every $11 is one Fixed Cycle', code => {
    const quote = packageQuote(code), rule = PACKAGE_RULES.find(item => item.code === code)!;
    expect(quote.total).toBe(packagePrice(code));
    expect(quote.total).toBe(BigInt(rule.fixedCycles) * 11n * USDT);
    expect(quote.volume).toBe(BigInt(rule.fixedCycles) * binaryCyclePolicy().cycleVolume);
    expect(quote.owner + quote.binary + quote.reward).toBe(quote.total);
    expect(packageQuote(code, true)).toEqual(quote);
  });
  it('quotes the starter at 11 USDT with a 70 USDT cap', () => { const q = packageQuote('BRONZE'); expect(q.total).toBe(11n * USDT); expect(q.maxCap).toBe(70n * USDT); });
  it('uses one cycle policy: 10 USDT per line releases 1 USDT, promotion or not', () => {
    expect(binaryCyclePolicy(true)).toEqual({ cycleVolume: 10n * USDT, cycleReward: 1n * USDT });
    expect(binaryCyclePolicy(false)).toEqual(binaryCyclePolicy(true));
  });
  it('settles 60/60 as 5 USDT and one voucher', () => { expect(binarySettlement(60n * USDT, 60n * USDT, 0n, 100n * USDT)).toMatchObject({ credited: 5n * USDT, vouchers: 1n, left: 0n, right: 0n }); });
  it('carries voucher progress across runs', () => { expect(binarySettlement(10n * USDT, 10n * USDT, 5n, 100n * USDT)).toMatchObject({ credited: 0n, vouchers: 1n }); });
  it('preserves heavy volume and retains capped rewards', () => { expect(binarySettlement(70n * USDT, 60n * USDT, 0n, 2n * USDT)).toMatchObject({ credited: 2n * USDT, retained: 3n * USDT, left: 10n * USDT }); });
  it('credits one cycle for 10/25 volume and carries the rest', () => { expect(binarySettlement(10n * USDT, 25n * USDT, 0n, 100n * USDT)).toMatchObject({ credited: 1n * USDT, grossReward: 1n * USDT, left: 0n, right: 15n * USDT }); });
  it('one starter purchase on each side makes one slot', () => { const volume = packageQuote('BRONZE').volume; expect(binarySettlement(volume, volume, 0n, 100n * USDT).slots).toBe(1n); });
  it('resets at Tehran noon', () => { expect(seasonDayKey(new Date('2026-09-07T08:29:59Z'))).toBe('2026-09-06'); expect(seasonDayKey(new Date('2026-09-07T08:30:00Z'))).toBe('2026-09-07'); });
  it('opens the daily task window at Tehran noon', () => { expect(dailyWindowStart(new Date('2026-09-07T09:00:00Z')).toISOString()).toBe('2026-09-07T08:30:00.000Z'); expect(dailyWindowStart(new Date('2026-09-07T08:00:00Z')).toISOString()).toBe('2026-09-06T08:30:00.000Z'); });
  it('chooses lowest unique before doubles', () => { expect(auctionWinners([{ userId: 'a', cents: 1n }, { userId: 'b', cents: 1n }, { userId: 'c', cents: 2n }])).toEqual(['c']); });
  it('chooses two winners if no unique bid; otherwise owner pool', () => { expect(auctionWinners([{ userId: 'a', cents: 1n }, { userId: 'b', cents: 1n }])).toEqual(['a', 'b']); expect(auctionWinners(['a','b','c'].map(userId => ({ userId, cents: 1n })))).toEqual([]); });
});

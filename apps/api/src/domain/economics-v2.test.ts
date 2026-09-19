import { describe, it, expect } from 'vitest';
import { USDT, PACKAGE_RULES, packageQuote, binarySettlement, binaryCyclePolicy, seasonDayKey, seasonQuote, extendSeason, seasonPurchaseAllowed, auctionWinners } from './economics-v2.js';
describe('approved economics', () => {
  it('settles 5/5 as 1 USDT without rounding up or reusing volume', () => {
    const result = binarySettlement(5n * USDT, 5n * USDT, 0n, 100n * USDT);
    expect(result).toMatchObject({ credited: 1000000n, slots: 1n, vouchers: 0n, left: 0n, right: 0n });
    expect(binarySettlement(result.left, result.right, result.totalSlots, 100n * USDT).credited).toBe(0n);
    expect(binarySettlement(4999999n, 5n * USDT, 0n, 100n * USDT).slots).toBe(0n);
  });
  it.each(PACKAGE_RULES.map(rule => rule.code))('preserves supply and cap during opening: %s', code => {
    const normal = packageQuote(code, false), offer = packageQuote(code, true);
    expect(offer.gen).toBe(normal.gen); expect(offer.maxCap).toBe(normal.maxCap);
    expect(offer.owner).toBe(normal.owner); expect(offer.volume * 2n).toBe(normal.volume);
    expect(offer.owner + offer.binary + offer.reward).toBe(offer.total);
  });
  it('quotes starter at 6 USDT and 70 cap during opening', () => { const q = packageQuote('BRONZE', true); expect(q.total).toBe(6n * USDT); expect(q.maxCap).toBe(70n * USDT); });
  it('changes a fixed cycle from 6-USDT package economics to 11-USDT package economics after the discount', () => {
    expect(binaryCyclePolicy(true)).toEqual({ cycleVolume: 5n * USDT, cycleReward: 1n * USDT });
    expect(binaryCyclePolicy(false)).toEqual({ cycleVolume: 10n * USDT, cycleReward: 2n * USDT });
    expect(binarySettlement(10n * USDT, 10n * USDT, 0n, 100n * USDT, binaryCyclePolicy(false))).toMatchObject({ slots: 1n, credited: 2n * USDT });
  });
  it('settles 60/60 as 10 USDT and two vouchers', () => { expect(binarySettlement(60n * USDT, 60n * USDT, 0n, 100n * USDT)).toMatchObject({ credited: 10n * USDT, vouchers: 2n, left: 0n, right: 0n }); });
  it('carries voucher progress across runs', () => { expect(binarySettlement(5n * USDT, 5n * USDT, 5n, 100n * USDT)).toMatchObject({ credited: 0n, vouchers: 1n }); });
  it('preserves heavy volume and retains capped rewards', () => { expect(binarySettlement(70n * USDT, 60n * USDT, 0n, 2n * USDT)).toMatchObject({ credited: 2n * USDT, retained: 8n * USDT, left: 10n * USDT }); });
  it('credits exactly twenty percent of the weaker side for 10/25 volume', () => { expect(binarySettlement(10n * USDT, 25n * USDT, 0n, 100n * USDT)).toMatchObject({ credited: 2n * USDT, grossReward: 2n * USDT, left: 0n, right: 15n * USDT }); });
  it('one discounted starter purchase on each side makes one slot', () => { const volume = packageQuote('BRONZE', true).volume; expect(binarySettlement(volume, volume, 0n, 100n * USDT).slots).toBe(1n); });
  it('resets at Tehran noon', () => { expect(seasonDayKey(new Date('2026-09-07T08:29:59Z'))).toBe('2026-09-06'); expect(seasonDayKey(new Date('2026-09-07T08:30:00Z'))).toBe('2026-09-07'); });
  it('season one is free; later seasons split 10/90', () => { expect(seasonQuote(1).total).toBe(0n); expect(seasonQuote(2)).toEqual({ total: 9n * USDT, owner: 900000n, reward: 8100000n }); });
  it('allows time extensions but not season repurchase', () => { expect(seasonPurchaseAllowed(true)).toBe(false); expect(extendSeason(new Date('2026-09-07T00:00:00Z'), 1).toISOString()).toBe('2026-09-08T00:00:00.000Z'); });
  it('chooses lowest unique before doubles', () => { expect(auctionWinners([{ userId: 'a', cents: 1n }, { userId: 'b', cents: 1n }, { userId: 'c', cents: 2n }])).toEqual(['c']); });
  it('chooses two winners if no unique bid; otherwise owner pool', () => { expect(auctionWinners([{ userId: 'a', cents: 1n }, { userId: 'b', cents: 1n }])).toEqual(['a', 'b']); expect(auctionWinners(['a','b','c'].map(userId => ({ userId, cents: 1n })))).toEqual([]); });
});

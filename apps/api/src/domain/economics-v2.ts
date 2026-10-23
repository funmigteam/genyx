// All monetary values are atomic USDT (six decimals), never floats.
export const USDT = 1_000_000n;
// Binary commission is calculated from each completed 5-USDT match.
// Keep this as a single source of truth so every settlement uses the same rate.
export const BINARY_COMMISSION_PERCENT = 20n;
export const BINARY_POOL_PERCENT = 20n;
// Official token package table: $11/$33/$110/$330/$1,100 (owner + base),
// GEN 100 / 300+10 / 1,000+30 / 3,000+100 / 10,000+300, Max Cap and Fixed Cycles.
export const PACKAGE_RULES = [
  { code: 'BRONZE', title: 'BRONZE', maxCap: 70n, fixedCycles: 1, base: 10n, owner: 1n, gen: 100n, giftMax: 3n, xpMultiplier: 1, genMultiplier: 1, graceDays: 0, boosts: 1, resetGift: 1n },
  { code: 'SILVER', title: 'SILVER', maxCap: 200n, fixedCycles: 3, base: 30n, owner: 3n, gen: 310n, giftMax: 4n, xpMultiplier: 1, genMultiplier: 1, graceDays: 0, boosts: 2, resetGift: 1n },
  { code: 'GOLD', title: 'GOLD', maxCap: 700n, fixedCycles: 10, base: 100n, owner: 10n, gen: 1030n, giftMax: 6n, xpMultiplier: 2, genMultiplier: 1, graceDays: 0, boosts: 3, resetGift: 1n },
  { code: 'PLATINUM', title: 'PRO', maxCap: 2_000n, fixedCycles: 30, base: 300n, owner: 30n, gen: 3100n, giftMax: 8n, xpMultiplier: 2, genMultiplier: 2, graceDays: 1, boosts: 4, resetGift: 3n },
  { code: 'DIAMOND', title: 'PRO PLUS', maxCap: 7_000n, fixedCycles: 100, base: 1000n, owner: 100n, gen: 10300n, giftMax: 10n, xpMultiplier: 2, genMultiplier: 2, graceDays: 2, boosts: 5, resetGift: 5n },
] as const;
/** Price of a token package (owner + base), e.g. BRONZE = 11 USDT. */
export function packagePrice(code: string) {
  const rule = PACKAGE_RULES.find(item => item.code === code);
  return rule ? (rule.base + rule.owner) * USDT : 0n;
}
export function packageQuote(code: string, _opening = false) {
  const rule = PACKAGE_RULES.find(item => item.code === code);
  if (!rule) throw new Error('Unknown package');
  const volume = rule.base * USDT, owner = rule.owner * USDT;
  const binary = volume * BINARY_POOL_PERCENT / 100n;
  return { code, total: owner + volume, owner, binary, reward: volume - binary, volume, gen: rule.gen, maxCap: rule.maxCap * USDT, repeatable: code === 'DIAMOND' };
}
export const OPENING_CYCLE_VOLUME = 5n * USDT;
export const STANDARD_CYCLE_VOLUME = 10n * USDT;
export const OPENING_CYCLE_REWARD = 1n * USDT;
// One Fixed Cycle = $11 of package price = 10 USDT of volume per line, paying 1 USDT.
export const STANDARD_CYCLE_REWARD = 1n * USDT;
/** The opening (50% promotion) policy is retired; every cycle is 10 USDT per line → 1 USDT. */
export function binaryCyclePolicy(_opening = false) {
  return { cycleVolume: STANDARD_CYCLE_VOLUME, cycleReward: STANDARD_CYCLE_REWARD };
}
export function binarySettlement(left: bigint, right: bigint, previousSlots: bigint, allowance: bigint, policy = binaryCyclePolicy()) {
  if ([left, right, previousSlots, allowance].some(value => value < 0n)) throw new Error('Negative binary input');
  const unit = policy.cycleVolume, matched = left < right ? left : right, slots = matched / unit;
  const vouchers = (previousSlots + slots) / 6n - previousSlots / 6n;
  const grossReward = (slots - vouchers) * policy.cycleReward;
  const credited = grossReward < allowance ? grossReward : allowance;
  return { slots, vouchers, grossReward, credited, retained: grossReward - credited, left: left - slots * unit, right: right - slots * unit, totalSlots: previousSlots + slots };
}
export function seasonDayKey(now: Date) {
  // Tehran is UTC+03:30; noon reset is 08:30 UTC. No host timezone dependency.
  return new Date(now.getTime() - (8 * 60 + 30) * 60_000).toISOString().slice(0, 10);
}
/** Start of the current daily-task window (Tehran noon = 08:30 UTC). */
export function dailyWindowStart(now: Date) {
  return new Date(`${seasonDayKey(now)}T08:30:00.000Z`);
}
export function auctionWinners(bids: Array<{ userId: string; cents: bigint }>): string[] {
  if (bids.some(bid => bid.cents < 1n)) throw new Error('Bid must be at least one cent');
  const grouped = new Map<bigint, string[]>();
  for (const bid of bids) grouped.set(bid.cents, [...(grouped.get(bid.cents) ?? []), bid.userId]);
  const ordered = [...grouped.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return ordered.find(([, users]) => users.length === 1)?.[1] ?? ordered.find(([, users]) => users.length === 2)?.[1] ?? [];
}

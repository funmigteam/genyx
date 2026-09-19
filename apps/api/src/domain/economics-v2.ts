// All monetary values are atomic USDT (six decimals), never floats.
export const USDT = 1_000_000n;
// Binary commission is calculated from each completed 5-USDT match.
// Keep this as a single source of truth so every settlement uses the same rate.
export const BINARY_COMMISSION_PERCENT = 20n;
export const BINARY_POOL_PERCENT = 20n;
export const PACKAGE_RULES = [
  { code: 'BRONZE', title: 'STARTER', base: 10n, owner: 1n, gen: 100n, giftMax: 3n, xpMultiplier: 1, genMultiplier: 1, graceDays: 0, boosts: 1, resetGift: 1n },
  { code: 'SILVER', title: 'BASIC', base: 30n, owner: 3n, gen: 310n, giftMax: 4n, xpMultiplier: 1, genMultiplier: 1, graceDays: 0, boosts: 2, resetGift: 1n },
  { code: 'GOLD', title: 'ADVANCED', base: 100n, owner: 10n, gen: 1030n, giftMax: 6n, xpMultiplier: 2, genMultiplier: 1, graceDays: 0, boosts: 3, resetGift: 1n },
  { code: 'PLATINUM', title: 'PRO', base: 300n, owner: 30n, gen: 3100n, giftMax: 8n, xpMultiplier: 2, genMultiplier: 2, graceDays: 1, boosts: 4, resetGift: 3n },
  { code: 'DIAMOND', title: 'ELITE', base: 1000n, owner: 100n, gen: 10400n, giftMax: 10n, xpMultiplier: 2, genMultiplier: 2, graceDays: 2, boosts: 5, resetGift: 5n },
] as const;
export function packageQuote(code: string, opening: boolean) {
  const rule = PACKAGE_RULES.find(item => item.code === code);
  if (!rule) throw new Error('Unknown package');
  const volume = rule.base * USDT / (opening ? 2n : 1n), owner = rule.owner * USDT;
  const binary = volume * BINARY_POOL_PERCENT / 100n;
  return { code, total: owner + volume, owner, binary, reward: volume - binary, volume, gen: rule.gen, maxCap: rule.base * 7n * USDT, repeatable: code === 'DIAMOND' };
}
export const OPENING_CYCLE_VOLUME = 5n * USDT;
export const STANDARD_CYCLE_VOLUME = 10n * USDT;
export const OPENING_CYCLE_REWARD = 1n * USDT;
export const STANDARD_CYCLE_REWARD = 2n * USDT;
export function binaryCyclePolicy(opening: boolean) {
  return opening
    ? { cycleVolume: OPENING_CYCLE_VOLUME, cycleReward: OPENING_CYCLE_REWARD }
    : { cycleVolume: STANDARD_CYCLE_VOLUME, cycleReward: STANDARD_CYCLE_REWARD };
}
export function binarySettlement(left: bigint, right: bigint, previousSlots: bigint, allowance: bigint, policy = binaryCyclePolicy(true)) {
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
export function seasonPurchaseAllowed(previouslyOwned: boolean) { return !previouslyOwned; }
export function seasonQuote(season: number) {
  if (!Number.isInteger(season) || season < 1 || season > 4) throw new Error('Unknown season');
  const total = [0n, 9n, 27n, 81n][season - 1] * USDT;
  return { total, owner: total / 10n, reward: total - total / 10n };
}
export function extendSeason(deadline: Date, extraDays: number) {
  if (!Number.isSafeInteger(extraDays) || extraDays < 1 || extraDays > 365) throw new Error('Invalid extension');
  return new Date(deadline.getTime() + extraDays * 86_400_000);
}
export function auctionWinners(bids: Array<{ userId: string; cents: bigint }>): string[] {
  if (bids.some(bid => bid.cents < 1n)) throw new Error('Bid must be at least one cent');
  const grouped = new Map<bigint, string[]>();
  for (const bid of bids) grouped.set(bid.cents, [...(grouped.get(bid.cents) ?? []), bid.userId]);
  const ordered = [...grouped.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return ordered.find(([, users]) => users.length === 1)?.[1] ?? ordered.find(([, users]) => users.length === 2)?.[1] ?? [];
}

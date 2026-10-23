// Official rank table. A user's level IS their rank: claiming RISE makes
// level 1, ETERNAL is level 11, and level 0 means no rank yet. The smallest
// investment pack gives 10 Fixed Cycles, so ranks start at RISE.
export const RANKS = [
  { cycles: 10, name: 'RISE', rewardUsdt: 10 },
  { cycles: 30, name: 'WARRIOR', rewardUsdt: 20 },
  { cycles: 100, name: 'ALPHA', rewardUsdt: 70 },
  { cycles: 300, name: 'NOBLE', rewardUsdt: 200 },
  { cycles: 1_000, name: 'VANGUARD', rewardUsdt: 700 },
  { cycles: 3_000, name: 'SOVEREIGN', rewardUsdt: 2_000 },
  { cycles: 10_000, name: 'ARCHON', rewardUsdt: 7_000 },
  { cycles: 30_000, name: 'ASCENDANT', rewardUsdt: 20_000 },
  { cycles: 100_000, name: 'TITAN', rewardUsdt: 70_000 },
  { cycles: 300_000, name: 'LEGACY', rewardUsdt: 200_000 },
  { cycles: 1_000_000, name: 'ETERNAL', rewardUsdt: 1_000_000 },
] as const;
export const MAX_LEVEL = RANKS.length;

export function rankName(level: number) {
  return level >= 1 && level <= MAX_LEVEL ? RANKS[level - 1].name : 'UNRANKED';
}

/** Level card data: the next rank's cycle target drives the progress bar. */
export function levelProgress(level: number, fixedCycles: bigint) {
  const next = level < MAX_LEVEL ? RANKS[level] : null;
  return {
    level, rank: rankName(level), nextRank: next?.name ?? null,
    current: fixedCycles.toString(), required: (next ? BigInt(next.cycles) : fixedCycles).toString(),
  };
}

// Daily binary payout limit by rank: 100 USDT, 300 from NOBLE (4), 1,000 from ASCENDANT (8).
export function dailyBinaryLimitForLevel(level: number) {
  return BigInt(level <= 3 ? 100 : level <= 7 ? 300 : 1000) * 1_000_000n;
}

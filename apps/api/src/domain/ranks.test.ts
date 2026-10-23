import { expect, it } from 'vitest';
import { dailyBinaryLimitForLevel, levelProgress, MAX_LEVEL, rankName } from './ranks.js';

it('maps each level to exactly one rank, starting at RISE', () => {
  expect(MAX_LEVEL).toBe(11);
  expect([rankName(0), rankName(1), rankName(2), rankName(11)]).toEqual(['UNRANKED', 'RISE', 'WARRIOR', 'ETERNAL']);
});
it('shows progress toward the next rank in Fixed Cycles', () => {
  expect(levelProgress(0, 3n)).toEqual({ level: 0, rank: 'UNRANKED', nextRank: 'RISE', current: '3', required: '10' });
  expect(levelProgress(1, 17n)).toMatchObject({ rank: 'RISE', nextRank: 'WARRIOR', required: '30' });
  expect(levelProgress(11, 2_000_000n)).toMatchObject({ rank: 'ETERNAL', nextRank: null });
});
it('raises the daily binary limit with rank', () => {
  expect([dailyBinaryLimitForLevel(0), dailyBinaryLimitForLevel(4), dailyBinaryLimitForLevel(8)]).toEqual([100_000_000n, 300_000_000n, 1_000_000_000n]);
});

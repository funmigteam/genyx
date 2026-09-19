import { describe, it, expect } from 'vitest';
import { dailyCapForXp, levelForXp } from './progression.js';
const start = (level: number) => Array.from({ length: level - 1 }, (_, i) => 250n + BigInt(i * 100)).reduce((a, b) => a + b, 0n);
describe('withdrawal level caps', () => {
  it('uses the same progressive XP curve', () => { expect(levelForXp(249n).level).toBe(1); expect(levelForXp(250n).level).toBe(2); });
  it('changes caps at levels 11 and 16', () => {
    expect(dailyCapForXp(start(11) - 1n)).toBe(500_000_000n);
    expect(dailyCapForXp(start(11))).toBe(750_000_000n);
    expect(dailyCapForXp(start(16))).toBe(1_000_000_000n);
  });
  it('requires completing level 30 for the final cap', () => {
    expect(dailyCapForXp(start(30))).toBe(1_000_000_000n);
    expect(dailyCapForXp(start(30) + 3150n)).toBe(1_500_000_000n);
  });
});

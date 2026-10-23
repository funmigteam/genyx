import { expect, it } from 'vitest';
import { openingActive, discountedPrice } from './package-pricing.js';
it('keeps owner share fixed and discounts only base', () => {
  expect(discountedPrice(11000000n, 1000000n, true)).toBe(6000000n);
  expect(discountedPrice(33000000n, 3000000n, true)).toBe(18000000n);
  expect(discountedPrice(11000000n, 1000000n, false)).toBe(11000000n);
});
it('keeps the 50% opening promotion retired', () => {
  expect(openingActive(undefined, 0)).toBe(false);
  expect(openingActive('2026-09-01T00:00:00Z', 3650, new Date('2026-09-02T00:00:00Z'))).toBe(false);
});

import { expect, it } from 'vitest';
import { openingActive, discountedPrice } from './package-pricing.js';
it('keeps owner share fixed and discounts only base', () => {
  expect(discountedPrice(11000000n, 1000000n, true)).toBe(6000000n);
  expect(discountedPrice(33000000n, 3000000n, true)).toBe(18000000n);
  expect(discountedPrice(11000000n, 1000000n, false)).toBe(11000000n);
});
it('ends the global opening at thirty days plus extensions', () => {
  expect(openingActive(undefined, 0)).toBe(true);
  const start = '2026-09-01T00:00:00Z';
  expect(openingActive(start, 0, new Date('2026-10-01T00:00:00Z'))).toBe(false);
  expect(openingActive(start, 1, new Date('2026-10-01T00:00:00Z'))).toBe(true);
});

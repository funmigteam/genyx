import { expect, it } from 'vitest';
import { INITIAL_PACKAGE_CODES, requiresInitialPackage } from './package-access.js';

it('allows each opening package as a first package and gates only advanced packages', () => {
  expect(INITIAL_PACKAGE_CODES).toEqual(['BRONZE', 'SILVER', 'GOLD']);
  expect(requiresInitialPackage('BRONZE')).toBe(false);
  expect(requiresInitialPackage('SILVER')).toBe(false);
  expect(requiresInitialPackage('GOLD')).toBe(false);
  expect(requiresInitialPackage('PLATINUM')).toBe(true);
  expect(requiresInitialPackage('DIAMOND')).toBe(true);
});

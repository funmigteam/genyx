import { describe, it, expect } from 'vitest';
import { packageCatalogInput } from './package-catalog.js';

const item = { code: 'BRONZE', economicUsdc: '10', gen: 100 };
describe('admin package catalog', () => {
  it('keeps legacy packages enabled by default', () => expect(packageCatalogInput.parse([item])).toEqual([{ ...item, active: true }]));
  it('preserves an explicitly disabled package', () => expect(packageCatalogInput.parse([{ ...item, active: false }])[0].active).toBe(false));
  it('retains descriptions and features', () => {
    const expanded = { ...item, title: 'Starter', description: 'Full details', features: ['100 GEN'], terms: 'Payment confirmation required' };
    expect(packageCatalogInput.parse([expanded])).toEqual([{ ...expanded, active: true }]);
  });
  it('rejects duplicate codes', () => expect(packageCatalogInput.safeParse([item, item]).success).toBe(false));
  it.each(['0', '-1', 'NaN', '0.0000001', '1000001'])('rejects invalid price %s', price => expect(packageCatalogInput.safeParse([{ ...item, economicUsdc: price }]).success).toBe(false));
});

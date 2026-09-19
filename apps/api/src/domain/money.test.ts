import { it, expect } from 'vitest';
import { parseUsdt, formatUsdt } from './money.js';
it('uses exact atomic amounts', () => { expect(parseUsdt('0.000001')).toBe(1n); expect(formatUsdt(parseUsdt('1100.123456'))).toBe('1100.123456'); });
it.each(['-1', '1e3', '0.0000001', 'NaN', 'Infinity'])('rejects invalid money: %s', value => expect(() => parseUsdt(value)).toThrow());

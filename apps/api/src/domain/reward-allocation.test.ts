import { it, expect } from 'vitest';
import { allocateReward } from './reward-allocation.js';
it('credits only remaining cap and retains the excess', () => expect(allocateReward(100n, 70n, 20n, 1000n)).toEqual({ credited: 50n, retained: 50n }));
it('does not consume pool when cap is exhausted', () => expect(allocateReward(100n, 70n, 70n, 0n)).toEqual({ credited: 0n, retained: 100n }));
it('rejects an unfunded reward instead of creating debt', () => expect(() => allocateReward(50n, 70n, 0n, 49n)).toThrow());
it('requires only the capped amount to be funded', () => expect(allocateReward(100n, 70n, 20n, 50n).credited).toBe(50n));
it('rejects negative inputs', () => expect(() => allocateReward(-1n, 70n, 0n, 100n)).toThrow());

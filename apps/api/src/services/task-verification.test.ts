import { describe, it, expect, vi, afterEach } from 'vitest';
import { isChannelMember, meetsTaskTarget, checkChannelMembership } from './task-verification.js';
afterEach(() => vi.unstubAllGlobals());
describe('task verification', () => {
  it('rejects departed, banned and restricted non-members', () => {
    for (const status of ['left', 'kicked', 'restricted']) expect(isChannelMember({ status })).toBe(false);
    expect(isChannelMember({ status: 'restricted', is_member: true })).toBe(true);
    expect(isChannelMember({ status: 'administrator' })).toBe(true);
    expect(isChannelMember({ status: 'member' })).toBe(true);
  });
  it('uses accumulated XP and the existing progression formula', () => {
    expect(meetsTaskTarget('XP_REACHED', 100, 99n)).toBe(false);
    expect(meetsTaskTarget('XP_REACHED', 100, 100n)).toBe(true);
    expect(meetsTaskTarget('LEVEL_REACHED', 2, 249n)).toBe(false);
    expect(meetsTaskTarget('LEVEL_REACHED', 2, 250n)).toBe(true);
    expect(meetsTaskTarget('GAME_PLAYED', 5, 1000n, 4)).toBe(false);
    expect(meetsTaskTarget('GAME_PLAYED', 5, 0n, 5)).toBe(true);
  });
  it('fails closed on Telegram API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false }) }));
    await expect(checkChannelMembership('dummy', '@example', 1n)).rejects.toThrow('Cannot verify');
  });
});

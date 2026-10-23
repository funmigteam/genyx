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
  it('checks XP, rank-based level and game rounds', () => {
    expect(meetsTaskTarget('XP_REACHED', 100, 99n)).toBe(false);
    expect(meetsTaskTarget('XP_REACHED', 100, 100n)).toBe(true);
    expect(meetsTaskTarget('LEVEL_REACHED', 2, 10_000n, 0, 1)).toBe(false);
    expect(meetsTaskTarget('LEVEL_REACHED', 2, 0n, 0, 2)).toBe(true);
    expect(meetsTaskTarget('GAME_PLAYED', 5, 1000n, 4)).toBe(false);
    expect(meetsTaskTarget('GAME_PLAYED', 5, 0n, 5)).toBe(true);
  });
  it('fails closed on Telegram API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false }) }));
    await expect(checkChannelMembership('dummy', '@example', 1n)).rejects.toThrow('Cannot verify');
  });
});

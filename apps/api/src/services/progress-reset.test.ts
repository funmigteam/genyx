import { beforeEach, describe, expect, it, vi } from 'vitest';
const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(), user: { findUniqueOrThrow: vi.fn() },
  auditEvent: { findFirst: vi.fn(), create: vi.fn() }, taskClaim: { count: vi.fn() },
}));
vi.mock('../prisma.js', () => ({ prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }));
import { resetProgress } from './progress-reset.js';

describe('global progress reset safeguards', () => {
  beforeEach(() => { vi.resetAllMocks(); tx.user.findUniqueOrThrow.mockResolvedValue({ role: 'SUPER_ADMIN' }); tx.taskClaim.count.mockResolvedValue(0); tx.$executeRaw.mockResolvedValue(3); });
  it('rejects a non-super-admin using the current database role', async () => {
    tx.user.findUniqueOrThrow.mockResolvedValue({ role: 'CONTENT_ADMIN' });
    await expect(resetProgress('admin', 'key')).rejects.toThrow('Super admin');
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
  it('does not repeat a completed reset', async () => {
    tx.auditEvent.findFirst.mockResolvedValue({ id: 'existing' });
    expect(await resetProgress('admin', 'key')).toEqual({ replay: true });
  });
  it('blocks when approvals are pending', async () => {
    tx.taskClaim.count.mockResolvedValue(1);
    await expect(resetProgress('admin', 'key')).rejects.toThrow('pending');
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
  it('archives mission claims but never rank claims, and records an audit', async () => {
    expect(await resetProgress('admin', 'key')).toEqual({ claims: 3 });
    const archive = tx.$executeRaw.mock.calls.find(call => String(call[0]).includes('UPDATE "TaskClaim"'))!;
    expect(String(archive[0])).toContain('"rankOrder" IS NOT NULL');
    expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'GLOBAL_PROGRESS_RESET', entityId: 'key' }) }));
  });
});

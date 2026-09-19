import { beforeEach, describe, expect, it, vi } from 'vitest';
const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(), $queryRaw: vi.fn(), user: { findUniqueOrThrow: vi.fn() },
  auditEvent: { findFirst: vi.fn(), create: vi.fn() },
  systemSetting: { findUnique: vi.fn() },
  taskClaim: { count: vi.fn() }, seasonEnrollment: { findMany: vi.fn(), update: vi.fn() },
  seasonDay: { aggregate: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() }, task: { findMany: vi.fn() },
}));
vi.mock('../prisma.js', () => ({ prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }));
import { resetSeasonProgress, advanceSeasonDay } from './seasons.js';
it('restarts a missed day at day one while preserving past records',async()=>{
 vi.resetAllMocks();
 tx.seasonDay.findUniqueOrThrow.mockResolvedValue({id:'day',enrollmentId:'season',number:7,deadline:new Date('2026-01-01'),closedAt:null,claimedAt:null,graceAt:null});
 tx.seasonDay.aggregate.mockResolvedValue({_min:{number:1}});tx.task.findMany.mockResolvedValue([{id:'day-one-task'}]);
 await advanceSeasonDay('day',new Date('2026-01-02'));
 expect(tx.seasonDay.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({number:1,gift:0n,requiredTaskIds:['day-one-task']})}));
 expect(tx.seasonEnrollment.update).toHaveBeenCalledWith(expect.objectContaining({data:{currentDay:1,completedDays:0,nextGift:0n}}));
});
describe('global progress reset safeguards', () => {
 beforeEach(() => { vi.resetAllMocks(); tx.user.findUniqueOrThrow.mockResolvedValue({role:'SUPER_ADMIN'}); tx.taskClaim.count.mockResolvedValue(0); tx.seasonEnrollment.findMany.mockResolvedValue([]); tx.$executeRaw.mockResolvedValue(0); });
 it('rejects a non-super-admin using the current database role', async()=>{tx.user.findUniqueOrThrow.mockResolvedValue({role:'CONTENT_ADMIN'});await expect(resetSeasonProgress('admin','key')).rejects.toThrow('Super admin');expect(tx.seasonEnrollment.findMany).not.toHaveBeenCalled();});
 it('snapshots configured USDT, GEN and XP on newly opened days', async () => {
   tx.systemSetting.findUnique.mockResolvedValue({ value: { enabled: true, usdt: '2.5', gen: 10, xp: 25 } });
   tx.seasonEnrollment.findMany.mockResolvedValue([{ id: 'season' }]);
   tx.seasonDay.aggregate.mockResolvedValue({ _min: { number: 1 } });
   tx.task.findMany.mockResolvedValue([{ id: 'task' }]);
   await resetSeasonProgress('admin', 'configured-gift');
   expect(tx.seasonDay.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ gift: 2500000n, giftGen: 10, giftXp: 25 }) }));
 });
 it('does not repeat a completed reset', async()=>{tx.auditEvent.findFirst.mockResolvedValue({id:'existing'});expect(await resetSeasonProgress('admin','key')).toEqual({replay:true});expect(tx.seasonEnrollment.findMany).not.toHaveBeenCalled();});
 it('blocks when approvals are pending', async()=>{tx.taskClaim.count.mockResolvedValue(1);await expect(resetSeasonProgress('admin','key')).rejects.toThrow('pending');expect(tx.auditEvent.create).not.toHaveBeenCalled();});
 it('archives old days, starts day one, and records an audit', async()=>{tx.seasonEnrollment.findMany.mockResolvedValue([{id:'season'}]);tx.seasonDay.aggregate.mockResolvedValue({_min:{number:-50}});tx.task.findMany.mockResolvedValue([{id:'task'}]);await resetSeasonProgress('admin','key');expect(tx.seasonEnrollment.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({currentDay:1,completedDays:0})}));expect(tx.seasonDay.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({number:1,gift:0n,requiredTaskIds:['task']})}));expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({action:'GLOBAL_PROGRESS_RESET',entityId:'key'})}));});
});

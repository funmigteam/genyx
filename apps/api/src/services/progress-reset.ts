import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { ApiError } from '../domain/api-errors.js';

/**
 * Re-opens every completed mission for all users. Organizational-rank claims
 * are kept: they ARE the user's level, and re-opening them would pay rank
 * rewards a second time.
 */
export async function resetProgress(actorId: string, requestKey: string) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`LOCK TABLE "TaskClaim" IN EXCLUSIVE MODE`;
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (actor.role !== 'SUPER_ADMIN') throw new ApiError(403, 'SUPER_ADMIN_REQUIRED', 'Super admin required');
    if (await tx.auditEvent.findFirst({ where: { action: 'GLOBAL_PROGRESS_RESET', entityId: requestKey } })) return { replay: true };
    const pending = await tx.taskClaim.count({ where: { settledAt: null } });
    if (pending) throw new ApiError(409, 'PENDING_TASK_CLAIMS', `Resolve pending task claims before resetting progress (${pending} pending).`);
    // A new claim key allows replay while keeping original accounting references intact.
    const claims = await tx.$executeRaw`UPDATE "TaskClaim" SET "claimKey" = 'archived:' || id
      WHERE "claimKey" NOT LIKE 'archived:%' AND "taskId" NOT IN (SELECT id FROM "Task" WHERE "rankOrder" IS NOT NULL)`;
    const result = { claims };
    await tx.auditEvent.create({ data: { actorId, action: 'GLOBAL_PROGRESS_RESET', entityType: 'TaskClaim', entityId: requestKey, after: result } });
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

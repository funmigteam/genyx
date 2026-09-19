import { LedgerKind, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { PACKAGE_RULES, seasonDayKey } from '../domain/economics-v2.js';
import { creditRewardInTransaction } from './rewards.js';
import { postLedger } from './ledger.js';
import { checkChannelMembership, meetsTaskTarget } from './task-verification.js';
import { checkMetric, metricKinds } from './task-metrics.js';
import { quotedTaskXp } from '../domain/xp-boost.js';

async function settle(tx: Prisma.TransactionClient, claimId: string) {
  await tx.$queryRaw`SELECT id FROM "TaskClaim" WHERE id = ${claimId} FOR UPDATE`;
  const claim = await tx.taskClaim.findUniqueOrThrow({ where: { id: claimId } });
  if (claim.settledAt) return claim;
  if (claim.quotedGen === null || claim.quotedXp === null || claim.quotedUsdt === null) throw new Error('Historical claim requires reconciliation');
  // Nothing is credited until verified. All three assets commit or roll back together.
  if (!claim.verifiedAt) throw new Error('Task verification required');
  if (claim.quotedUsdt > 0) await creditRewardInTransaction(tx, {
    userId: claim.userId, amount: BigInt(claim.quotedUsdt), pool: 'REWARD',
    idempotencyKey: `task-usdt:${claim.id}`, referenceType: 'TaskClaim', referenceId: claim.id, kind: LedgerKind.SEASON_REWARD,
  });
  const gen = await tx.ledgerAccount.upsert({ where: { code: `USER:${claim.userId}:GEN:AVAILABLE` }, create: { code: `USER:${claim.userId}:GEN:AVAILABLE`, userId: claim.userId, currency: 'GEN', type: 'AVAILABLE' }, update: {} });
  const source = await tx.ledgerAccount.upsert({ where: { code: 'SYSTEM:GEN:REWARDS' }, create: { code: 'SYSTEM:GEN:REWARDS', currency: 'GEN', type: 'EXPENSE' }, update: {} });
  if (claim.quotedGen) await postLedger({ idempotencyKey: `task:${claim.id}`, kind: LedgerKind.GEN_CREDIT, referenceType: 'TaskClaim', referenceId: claim.id, postings: [{ accountId: source.id, debit: BigInt(claim.quotedGen) }, { accountId: gen.id, credit: BigInt(claim.quotedGen) }] }, tx);
  await tx.user.update({ where: { id: claim.userId }, data: { xp: { increment: claim.quotedXp } } });
  return tx.taskClaim.update({ where: { id: claim.id }, data: { settledAt: new Date() } });
}

export async function claimTask(userId: string, taskId: string, now = new Date(), botToken?: string) {
  // Network checks run before the accounting transaction, never on client assertions.
  const snapshot = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  if (snapshot.kind === 'CHANNEL_JOIN') {
    if (!botToken || !snapshot.channelChatId) throw new Error('Channel verification is not configured');
    const identity = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { telegramId: true } });
    if (!await checkChannelMembership(botToken, snapshot.channelChatId, identity.telegramId)) throw new Error('Join the channel first, then return and claim.');
  }
  return prisma.$transaction(async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.activePackageCode && user.role === 'USER') throw new Error('Active package required');
    const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
    if (task.updatedAt.getTime() !== snapshot.updatedAt.getTime()) throw new Error('Task changed. Please retry.');
    if (task.status !== 'PUBLISHED' || (task.dayNumber === null && (task.startsAt > now || (task.endsAt && task.endsAt <= now)))) throw new Error('Task unavailable');
    let claimKey = task.isDaily ? seasonDayKey(now) : 'once';
    let activitySince = task.startsAt;
    if (task.isDaily) {
      const day = await tx.seasonDay.findFirst({ where: { enrollment: { userId, endedAt: null }, closedAt: null }, orderBy: { opensAt: 'desc' } });
      if (day) {
        if (day.deadline <= now || day.opensAt > now || day.graceAt || day.claimedAt) throw new Error('Season day is closed');
        if (!(day.requiredTaskIds as string[]).includes(taskId)) throw new Error('Task is not in this season day');
        if (task.dayNumber !== null && task.dayNumber !== day.number) throw new Error('Task belongs to another day');
        claimKey = `season:${day.id}`;
        activitySince = day.opensAt;
      } else if (task.dayNumber !== null || await tx.seasonEnrollment.count({ where: { userId } })) {
        throw new Error('No active season day');
      }
    }
    const previous = await tx.taskClaim.findUnique({ where: { taskId_userId_claimKey: { taskId, userId, claimKey } } });
    if (previous?.settledAt) return previous;
    if (task.actionUrl) {
      const opened = await tx.auditEvent.findFirst({ where: { actorId: userId, action: 'TASK_LINK_OPENED', entityType: 'Task', entityId: task.id, createdAt: { gte: activitySince } } });
      if (!opened) throw new Error('Open the mission link before claiming this task.');
    }
    let verified = ['DAILY_CHECKIN', 'EXTERNAL_LINK', 'CHANNEL_JOIN'].includes(task.kind);
    if(metricKinds.includes(task.kind)){
      verified=await checkMetric(tx,userId,task.kind,task.targetValue);
      if(!verified)throw new Error(`Task target not reached: ${task.targetValue}`);
    }
    if (['XP_REACHED', 'LEVEL_REACHED', 'GAME_PLAYED'].includes(task.kind)) {
      if (task.kind === 'GAME_PLAYED' && task.isDaily && !claimKey.startsWith('season:')) throw new Error('An active season day is required for daily game tasks');
      const rounds = task.kind === 'GAME_PLAYED' ? (await tx.gameActivity.aggregate({ where: { userId, gameKey: task.gameKey ?? '', createdAt: { gte: activitySince, lte: now } }, _sum: { rounds: true } }))._sum.rounds ?? 0 : 0;
      verified = meetsTaskTarget(task.kind, task.targetValue, user.xp, rounds);
      if (!verified) throw new Error(`Task requirement not reached: ${task.targetValue} ${task.kind === 'GAME_PLAYED' ? 'verified game rounds' : task.kind === 'XP_REACHED' ? 'XP' : 'level'}`);
    }
    if (previous) {
      if (!verified) return previous;
      await tx.taskClaim.update({ where: { id: previous.id }, data: { verifiedAt: now } });
      return settle(tx, previous.id);
    }
    const rule = PACKAGE_RULES.find(item => item.code === user.activePackageCode);
    const boost = await tx.shopPurchase.findFirst({ where: { userId, item: { category: 'BOOST' }, createdAt: { lte: now }, activeUntil: { gt: now } } });
    const claim = await tx.taskClaim.create({ data: { taskId, userId, claimKey,
      quotedGen: task.rewardGen * (rule?.genMultiplier ?? 1), quotedXp: quotedTaskXp(task.rewardXp, rule?.xpMultiplier ?? 1, Boolean(boost)), quotedUsdt: task.rewardUsdt,
      // External links intentionally require no viewing verification under this policy.
      verifiedAt: verified ? now : null,
    } });
    return claim.verifiedAt ? settle(tx, claim.id) : claim;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function approveTaskClaim(actorId: string, claimId: string) {
  return prisma.$transaction(async tx => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (actor.role !== 'SUPER_ADMIN') throw new Error('Super admin approval required');
    await tx.$queryRaw`SELECT id FROM "TaskClaim" WHERE id = ${claimId} FOR UPDATE`;
    const before = await tx.taskClaim.findUniqueOrThrow({ where: { id: claimId } });
    if (before.settledAt) return before;
    await tx.taskClaim.update({ where: { id: claimId }, data: { verifiedAt: new Date() } });
    const result = await settle(tx, claimId);
    await tx.auditEvent.create({ data: { actorId, action: 'TASK_REWARD_APPROVED', entityType: 'TaskClaim', entityId: claimId } });
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

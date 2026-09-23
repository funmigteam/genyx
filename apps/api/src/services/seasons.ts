import { LedgerKind, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { PACKAGE_RULES } from '../domain/economics-v2.js';
import { creditRewardInTransaction } from './rewards.js';
import { postLedger } from './ledger.js';
import { ApiError } from '../domain/api-errors.js';
import { dailyGiftPolicyInput } from '../domain/daily-gift-policy.js';
import { parseUsdt } from '../domain/money.js';

export async function createSeasonIntent(userId: string, season: number, price: bigint) {
  if (!Number.isInteger(season) || season < 2 || season > 4 || price <= 0n || price > 1000000000000n) throw new Error('Invalid season price');
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.activePackageCode) throw new Error('Active package required');
    if (await tx.seasonEnrollment.findUnique({ where: { userId_season: { userId, season } } })) throw new Error('Season cannot be repurchased');
    const previous = await tx.seasonEnrollment.findUnique({ where: { userId_season: { userId, season: season - 1 } } });
    if (!previous) throw new Error('Previous season required');
    const pending = await tx.payment.findFirst({ where: { userId, purpose: 'SEASON', seasonNumber: season, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    if (pending && pending.expiresAt > new Date()) return pending;
    if (pending?.chainTxHash) throw new Error('Previous payment requires reconciliation');
    return tx.payment.create({ data: { userId, packageCode: `SEASON_${season}`, purpose: 'SEASON', seasonNumber: season, expectedAmount: price, quotedOwner: price / 10n, quotedReward: price - price / 10n, quotedBinary: 0n, quotedGen: 0n, quotedMaxCap: 0n, expiresAt: new Date(Date.now() + 1800000) } });
  });
}

export async function confirmSeasonPayment(tx: Prisma.TransactionClient, paymentId: string, now = new Date()) {
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (payment.purpose !== 'SEASON' || !payment.seasonNumber || payment.seasonNumber < 2 || payment.seasonNumber > 4) throw new Error('Invalid season payment');
  if (payment.status === 'CONFIRMED') return payment;
  if (payment.status !== 'PENDING' || !payment.chainTxHash) throw new Error('Payment confirmation required');
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${payment.userId} FOR UPDATE`;
  if (await tx.seasonEnrollment.findUnique({ where: { userId_season: { userId: payment.userId, season: payment.seasonNumber } } })) throw new Error('Season already owned; reconcile payment');
  const owner = payment.quotedOwner, reward = payment.quotedReward;
  if (owner === null || reward === null || owner < 0n || reward < 0n || payment.expectedAmount <= 0n || owner + reward !== payment.expectedAmount || payment.quotedBinary !== 0n || payment.quotedMaxCap !== 0n || payment.quotedGen !== 0n) throw new Error('Invalid season quote');
  const accounts = await Promise.all(['DEPOSITS', 'OWNER', 'REWARD'].map(name => tx.ledgerAccount.upsert({ where: { code: `SYSTEM:USDC:${name}` }, create: { code: `SYSTEM:USDC:${name}`, currency: 'USDC', type: 'RESERVE' }, update: {} })));
  await postLedger({ idempotencyKey: `season-payment:${payment.id}`, kind: LedgerKind.DEPOSIT, referenceType: 'Payment', referenceId: payment.id, postings: [{ accountId: accounts[0].id, debit: payment.expectedAmount }, { accountId: accounts[1].id, credit: owner }, { accountId: accounts[2].id, credit: reward }] }, tx);
  const active = await tx.seasonEnrollment.findFirst({ where: { userId: payment.userId, endedAt: null } });
  const enrollment = await tx.seasonEnrollment.create({ data: { userId: payment.userId, season: payment.seasonNumber, startedAt: now, deadline: new Date(now.getTime() + DAY * 30), currentDay: active ? 0 : 1 } });
  if (!active) await openDay(tx, enrollment.id, 1, now, 0n);
  await tx.user.update({ where: { id: payment.userId }, data: { totalDeposited: { increment: payment.expectedAmount } } });
  return tx.payment.update({ where: { id: payment.id }, data: { status: 'CONFIRMED', confirmedAt: now } });
}

const DAY = 86400000;
const FIRST_PACKAGE_DAILY_GIFT_MAX = PACKAGE_RULES[0].giftMax * 1_000_000n;
// Explicit super-admin action. Retain historical claims/days and all ledger records.
export async function resetSeasonProgress(actorId: string, requestKey: string) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`LOCK TABLE "SeasonEnrollment", "SeasonDay", "TaskClaim", "User" IN EXCLUSIVE MODE`;
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (actor.role !== 'SUPER_ADMIN') throw new ApiError(403, 'SUPER_ADMIN_REQUIRED', 'Super admin required');
    const previous = await tx.auditEvent.findFirst({ where: { action: 'GLOBAL_PROGRESS_RESET', entityId: requestKey } });
    if (previous) return { replay: true };
    const pending = await tx.taskClaim.count({ where: { settledAt: null } });
    if (pending) throw new ApiError(409, 'PENDING_TASK_CLAIMS', `Resolve pending task claims before resetting progress (${pending} pending).`);
    const now = new Date();
    const enrollments = await tx.seasonEnrollment.findMany({ where: { endedAt: null, currentDay: { gt: 0 } } });
    // A new claim key allows replay while keeping original accounting references intact.
    const claims = await tx.$executeRaw`UPDATE "TaskClaim" SET "claimKey" = 'archived:' || id WHERE "claimKey" NOT LIKE 'archived:%'`;
    for (const enrollment of enrollments) {
      const lowest = await tx.seasonDay.aggregate({ where: { enrollmentId: enrollment.id }, _min: { number: true } });
      const offset = Math.abs(lowest._min.number ?? 0) + 31;
      await tx.$executeRaw`UPDATE "SeasonDay" SET number = -number - ${offset}, "closedAt" = COALESCE("closedAt", ${now}) WHERE "enrollmentId" = ${enrollment.id} AND number > 0`;
      await tx.seasonEnrollment.update({ where: { id: enrollment.id }, data: { currentDay: 1, completedDays: 0, graceUsed: 0, nextGift: 0n, startedAt: now, deadline: new Date(now.getTime() + 30 * DAY) } });
      await openDay(tx, enrollment.id, 1, now, 0n);
    }
    const result = { seasons: enrollments.length, claims };
    await tx.auditEvent.create({ data: { actorId, action: 'GLOBAL_PROGRESS_RESET', entityType: 'SeasonEnrollment', entityId: requestKey, after: result } });
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}
export function nextSeasonNoon(now: Date) {
  const noon = new Date(now); noon.setUTCHours(8, 30, 0, 0);
  if (noon <= now) noon.setUTCDate(noon.getUTCDate() + 1);
  return noon;
}
async function openDay(tx: Prisma.TransactionClient, enrollmentId: string, number: number, opensAt: Date, gift: bigint) {
  const setting = await tx.systemSetting.findUnique({ where: { key: 'daily_gift_policy' } });
  const policy = setting ? dailyGiftPolicyInput.parse(setting.value) : null;
  const tasks = await tx.task.findMany({ where: { isDaily: true, status: 'PUBLISHED', AND: [{ OR: [{ dayNumber: number }, { dayNumber: null }] }, { OR: [{ dayNumber: { not: null } }, { startsAt: { lte: opensAt }, OR: [{ endsAt: null }, { endsAt: { gt: opensAt } }] }] }] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
  const scheduledGift = policy?.days[String(number)];
  const activeGift = scheduledGift?.enabled ? scheduledGift : policy?.enabled ? policy : null;
  const requestedGift = activeGift ? parseUsdt(activeGift.usdt) : gift;
  const cappedGift = requestedGift > FIRST_PACKAGE_DAILY_GIFT_MAX ? FIRST_PACKAGE_DAILY_GIFT_MAX : requestedGift;
  return tx.seasonDay.create({ data: { enrollmentId, number, opensAt, deadline: nextSeasonNoon(opensAt), gift: cappedGift, giftGen: activeGift?.gen ?? 0, giftXp: activeGift?.xp ?? 0, requiredTaskIds: tasks.map(task => task.id) } });
}
export async function enrollFreeSeason(tx: Prisma.TransactionClient, userId: string, now = new Date()) {
  const existing = await tx.seasonEnrollment.findUnique({ where: { userId_season: { userId, season: 1 } } });
  if (existing) return existing;
  const enrollment = await tx.seasonEnrollment.create({ data: { userId, season: 1, startedAt: now, deadline: new Date(now.getTime() + 30 * DAY) } });
  await openDay(tx, enrollment.id, 1, now, 0n);
  return enrollment;
}

export async function claimSeasonGift(userId: string, dayId: string, now = new Date()) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "SeasonDay" WHERE id = ${dayId} FOR UPDATE`;
    const day = await tx.seasonDay.findUniqueOrThrow({ where: { id: dayId }, include: { enrollment: true } });
    if (day.enrollment.userId !== userId) throw new Error('Season does not belong to user');
    if (day.claimedAt) return day;
    if (day.closedAt || day.graceAt || now < day.opensAt || now >= day.deadline) throw new Error('Daily gift window closed');
    const ids = day.requiredTaskIds as string[];
    if (!ids.length) throw new Error('Daily tasks are not configured');
    const completed = await tx.taskClaim.count({ where: { userId, claimKey: `season:${day.id}`, taskId: { in: ids }, settledAt: { not: null } } });
    if (completed !== ids.length) throw new Error('Complete and verify all daily tasks first');
    if (day.gift > 0n) await creditRewardInTransaction(tx, { userId, amount: day.gift, pool: 'REWARD', idempotencyKey: `season-gift:${day.id}`, referenceType: 'SeasonDay', referenceId: day.id, kind: LedgerKind.DAILY_GIFT });
    if (day.giftGen > 0) {
      const source = await tx.ledgerAccount.upsert({ where: { code: 'SYSTEM:GEN:REWARDS' }, create: { code: 'SYSTEM:GEN:REWARDS', currency: 'GEN', type: 'EXPENSE' }, update: {} });
      const target = await tx.ledgerAccount.upsert({ where: { code: `USER:${userId}:GEN:AVAILABLE` }, create: { code: `USER:${userId}:GEN:AVAILABLE`, userId, currency: 'GEN', type: 'AVAILABLE' }, update: {} });
      await postLedger({ idempotencyKey: `daily-gift-gen:${day.id}`, kind: LedgerKind.DAILY_GIFT, referenceType: 'SeasonDay', referenceId: day.id, postings: [{ accountId: source.id, debit: BigInt(day.giftGen) }, { accountId: target.id, credit: BigInt(day.giftGen) }] }, tx);
    }
    if (day.giftXp > 0) await tx.user.update({ where: { id: userId }, data: { xp: { increment: day.giftXp } } });
    await tx.seasonEnrollment.update({ where: { id: day.enrollmentId }, data: { completedDays: { increment: 1 } } });
    return tx.seasonDay.update({ where: { id: day.id }, data: { claimedAt: now } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function useSeasonGrace(userId: string, dayId: string, now = new Date()) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "SeasonDay" WHERE id = ${dayId} FOR UPDATE`;
    const day = await tx.seasonDay.findUniqueOrThrow({ where: { id: dayId }, include: { enrollment: true } });
    if (day.enrollment.userId !== userId) throw new Error('Season does not belong to user');
    if (day.graceAt) return day;
    if (day.closedAt || day.claimedAt || now < day.opensAt || now >= day.deadline) throw new Error('Grace window closed');
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const allowed = PACKAGE_RULES.find(rule => rule.code === user.activePackageCode)?.graceDays ?? 0;
    if (day.enrollment.graceUsed >= allowed) throw new Error('No Grace Days available');
    await tx.seasonEnrollment.update({ where: { id: day.enrollmentId }, data: { graceUsed: { increment: 1 }, completedDays: { increment: 1 } } });
    return tx.seasonDay.update({ where: { id: dayId }, data: { graceAt: now } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

// Invoked inside a paid shop purchase transaction: failure rolls back its debit.
export async function extendCurrentSeasonDay(tx: Prisma.TransactionClient, userId: string, now = new Date()) {
  const day = await tx.seasonDay.findFirst({ where: { enrollment: { userId, endedAt: null }, closedAt: null }, orderBy: { opensAt: 'desc' } });
  if (!day) throw new Error('No active season day');
  await tx.$queryRaw`SELECT id FROM "SeasonDay" WHERE id = ${day.id} FOR UPDATE`;
  const current = await tx.seasonDay.findUniqueOrThrow({ where: { id: day.id } });
  if (current.closedAt || current.claimedAt || current.graceAt || current.deadline <= now) throw new Error('Day cannot be extended');
  const enrollment = await tx.seasonEnrollment.findUniqueOrThrow({ where: { id: current.enrollmentId } });
  await tx.seasonDay.update({ where: { id: day.id }, data: { deadline: new Date(current.deadline.getTime() + DAY) } });
  await tx.seasonEnrollment.update({ where: { id: enrollment.id }, data: { deadline: new Date(enrollment.deadline.getTime() + DAY) } });
}

export async function advanceSeasonDay(dayId: string, now = new Date()) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "SeasonDay" WHERE id = ${dayId} FOR UPDATE`;
    const day = await tx.seasonDay.findUniqueOrThrow({ where: { id: dayId }, include: { enrollment: true } });
    if (day.closedAt || day.deadline > now) return;
    await tx.seasonDay.update({ where: { id: day.id }, data: { closedAt: day.deadline } });
    if (!day.claimedAt && !day.graceAt) {
      // Keep original day IDs and reward references; archive their display numbers.
      const lowest = await tx.seasonDay.aggregate({ where: { enrollmentId: day.enrollmentId }, _min: { number: true } });
      const offset = Math.abs(lowest._min.number ?? 0) + 31;
      await tx.$executeRaw`UPDATE "SeasonDay" SET number = -number - ${offset} WHERE "enrollmentId" = ${day.enrollmentId} AND number > 0`;
      await openDay(tx, day.enrollmentId, 1, now, 0n);
      await tx.seasonEnrollment.update({ where: { id: day.enrollmentId }, data: { currentDay: 1, completedDays: 0, nextGift: 0n } });
      return;
    }
    if (day.number >= 30) {
      await tx.seasonEnrollment.update({ where: { id: day.enrollmentId }, data: { endedAt: day.deadline } });
      const next = await tx.seasonEnrollment.findFirst({ where: { userId: day.enrollment.userId, currentDay: 0, endedAt: null }, orderBy: { season: 'asc' } });
      if (next) {
        await tx.seasonEnrollment.update({ where: { id: next.id }, data: { currentDay: 1, startedAt: day.deadline, deadline: new Date(day.deadline.getTime() + 30 * DAY) } });
        await openDay(tx, next.id, 1, day.deadline, 0n);
      }
      return;
    }
    const user = await tx.user.findUniqueOrThrow({ where: { id: day.enrollment.userId } });
    const rule = PACKAGE_RULES.find(item => item.code === user.activePackageCode);
    if (!rule) throw new Error('Package required');
    const max = FIRST_PACKAGE_DAILY_GIFT_MAX;
    const next = day.graceAt ? day.gift : day.claimedAt ? day.gift + 1000000n : rule.resetGift * 1000000n;
    const gift = next > max ? max : next;
    await openDay(tx, day.enrollmentId, day.number + 1, day.deadline, gift);
    await tx.seasonEnrollment.update({ where: { id: day.enrollmentId }, data: { currentDay: day.number + 1, nextGift: gift } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function processSeasonDays() {
  const now = new Date();
  const days = await prisma.seasonDay.findMany({ where: { closedAt: null, deadline: { lte: now } }, orderBy: { deadline: 'asc' }, take: 100 });
  let failures = 0;
  for (const day of days) { try { await advanceSeasonDay(day.id, now); } catch { failures++; } }
  if (failures) throw new Error('Season days need retry');
}

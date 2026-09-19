import { Prisma, LedgerKind } from '@prisma/client';
import { prisma } from '../prisma.js';
import { binarySettlement, binaryCyclePolicy, seasonDayKey } from '../domain/economics-v2.js';
import { levelForXp } from '../domain/progression.js';
import { creditRewardInTransaction } from './rewards.js';
import { openingActive } from './package-pricing.js';

async function cyclePolicy(tx: Prisma.TransactionClient | typeof prisma, now = new Date()) {
  const settings = await tx.systemSetting.findMany({ where: { key: { in: ['opening_started_at', 'opening_extra_days'] } } });
  const setting = (key: string) => settings.find(row => row.key === key)?.value;
  return binaryCyclePolicy(openingActive(setting('opening_started_at'), Number(setting('opening_extra_days') ?? 0), now));
}

// Placement and propagation run only within the confirmed-payment transaction.
export async function recordBinaryVolume(tx: Prisma.TransactionClient, paymentId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(718292)::text`;
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (payment.status !== 'CONFIRMED' || payment.quotedBinary === null || payment.quotedReward === null) throw new Error('Confirmed payment quote required');
  const amount = payment.quotedBinary + payment.quotedReward;
  if (amount < 0n) throw new Error('Invalid binary volume');
  async function place(userId: string, visited = new Set<string>()): Promise<void> {
    if (await tx.binaryPosition.findUnique({ where: { userId } })) return;
    if (visited.has(userId) || visited.size >= 1000) throw new Error('Invalid referral ancestry');
    visited.add(userId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.referredById) { await tx.binaryPosition.create({ data: { userId } }); return; }
    await place(user.referredById, visited);
    const sponsor = await tx.binaryPosition.findUniqueOrThrow({ where: { userId: user.referredById } });
    const children = await tx.binaryPosition.findMany({ where: { parentId: sponsor.userId } });
    let parentId = sponsor.userId;
    let side = !children.some(c => c.side === 'LEFT') ? 'LEFT' : 'RIGHT';
    if (children.length === 2) {
      // Spill over into the deepest available position in the lighter line.
      const line = sponsor.leftLifetime <= sponsor.rightLifetime ? 'LEFT' : 'RIGHT';
      let frontier = [children.find(c => c.side === line)!.userId];
      const seen = new Set<string>();
      while (frontier.length) {
        const next: string[] = [];
        for (const id of frontier.sort()) {
          if (seen.has(id)) throw new Error('Cyclic binary tree');
          seen.add(id);
          const descendants = await tx.binaryPosition.findMany({ where: { parentId: id } });
          if (descendants.length < 2) { parentId = id; side = descendants.some(c => c.side === 'LEFT') ? 'RIGHT' : 'LEFT'; }
          next.push(...descendants.map(c => c.userId));
        }
        frontier = next;
      }
    }
    await tx.binaryPosition.create({ data: { userId, parentId, side } });
  }
  await place(payment.userId);
  let node = await tx.binaryPosition.findUniqueOrThrow({ where: { userId: payment.userId } });
  const seen = new Set<string>();
  while (node.parentId) {
    if (seen.has(node.parentId)) throw new Error('Cyclic binary tree');
    seen.add(node.parentId);
    const userId = node.parentId, side = node.side!;
    const existing = await tx.binaryVolume.findUnique({ where: { paymentId_userId: { paymentId, userId } } });
    if (!existing) {
      await tx.binaryVolume.create({ data: { paymentId, userId, side, amount } });
      await tx.binaryPosition.update({ where: { userId }, data: side === 'LEFT' ? { leftVolume: { increment: amount }, leftLifetime: { increment: amount } } : { rightVolume: { increment: amount }, rightLifetime: { increment: amount } } });
    } else if (existing.amount !== amount || existing.side !== side) throw new Error('Conflicting binary volume');
    node = await tx.binaryPosition.findUniqueOrThrow({ where: { userId } });
  }
}

export async function settleBinary(userId: string, now = new Date()) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "userId" FROM "BinaryPosition" WHERE "userId" = ${userId} FOR UPDATE`;
    const position = await tx.binaryPosition.findUniqueOrThrow({ where: { userId } });
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.activePackageCode) return null;
    const day = seasonDayKey(now), level = levelForXp(user.xp).level;
    const limit = BigInt(level <= 10 ? 100 : level <= 20 ? 300 : 1000) * 1000000n;
    const sum = await tx.binaryReceipt.aggregate({ where: { userId, day }, _sum: { credited: true } });
    const allowance = limit > (sum._sum.credited ?? 0n) ? limit - (sum._sum.credited ?? 0n) : 0n;
    const result = binarySettlement(position.leftVolume, position.rightVolume, position.slots, allowance, await cyclePolicy(tx, now));
    if (!result.slots) return null;
    if (result.vouchers > 2147483647n - BigInt(user.vouchers)) throw new Error('Voucher capacity exceeded');
    const receipt = await tx.binaryReceipt.create({ data: { userId, day, slots: result.slots, vouchers: Number(result.vouchers), credited: 0n, retained: result.grossReward } });
    const reward = await creditRewardInTransaction(tx, { userId, amount: result.credited, pool: 'BINARY', idempotencyKey: `binary:${receipt.id}`, referenceType: 'BinaryReceipt', referenceId: receipt.id, kind: LedgerKind.BINARY_COMMISSION });
    await tx.binaryPosition.update({ where: { userId }, data: { leftVolume: result.left, rightVolume: result.right, slots: result.totalSlots } });
    await tx.user.update({ where: { id: userId }, data: { vouchers: { increment: Number(result.vouchers) } } });
    return tx.binaryReceipt.update({ where: { id: receipt.id }, data: { credited: reward.credited, retained: result.grossReward - reward.credited } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

let lastPosition: string | undefined;
export async function processBinaryQueue() {
  const policy = await cyclePolicy(prisma);
  const positions = await prisma.binaryPosition.findMany({ where: { leftVolume: { gte: policy.cycleVolume }, rightVolume: { gte: policy.cycleVolume }, ...(lastPosition ? { userId: { gt: lastPosition } } : {}) }, take: 100, orderBy: { userId: 'asc' } });
  // Failed/inactive accounts must not starve later pages; they retry next pass.
  lastPosition = positions.length === 100 ? positions[positions.length - 1].userId : undefined;
  let failures = 0;
  for (const position of positions) {
    try { await settleBinary(position.userId); } catch { failures++; }
  }
  if (failures) throw new Error('Binary settlements need retry');
}

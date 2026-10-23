import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { levelProgress } from '../domain/ranks.js';

type Client = Prisma.TransactionClient | typeof prisma;

/** Level = highest organizational rank whose reward the user has claimed. */
export async function rankLevel(client: Client, userId: string) {
  const claim = await client.taskClaim.findFirst({
    where: { userId, settledAt: { not: null }, task: { rankOrder: { not: null } } },
    orderBy: { task: { rankOrder: 'desc' } },
    select: { task: { select: { rankOrder: true } } },
  });
  return claim?.task.rankOrder ?? 0;
}

export async function rankLevels(client: Client, userIds: string[]) {
  const levels = new Map<string, number>(userIds.map(id => [id, 0]));
  if (!userIds.length) return levels;
  const claims = await client.taskClaim.findMany({
    where: { userId: { in: userIds }, settledAt: { not: null }, task: { rankOrder: { not: null } } },
    select: { userId: true, task: { select: { rankOrder: true } } },
  });
  for (const claim of claims) levels.set(claim.userId, Math.max(levels.get(claim.userId) ?? 0, claim.task.rankOrder ?? 0));
  return levels;
}

/** Cash Fixed Cycles: matched binary slots, excluding voucher slots. */
export async function fixedCycles(client: Client, userId: string) {
  const [position, vouchers] = await Promise.all([
    client.binaryPosition.findUnique({ where: { userId }, select: { slots: true } }),
    client.binaryReceipt.aggregate({ where: { userId }, _sum: { vouchers: true } }),
  ]);
  return (position?.slots ?? 0n) - BigInt(vouchers._sum.vouchers ?? 0);
}

export async function userLevelProgress(client: Client, userId: string) {
  const [level, cycles] = await Promise.all([rankLevel(client, userId), fixedCycles(client, userId)]);
  return levelProgress(level, cycles);
}

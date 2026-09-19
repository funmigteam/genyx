import { LedgerKind, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { postLedger } from './ledger.js';
import { allocateReward } from '../domain/reward-allocation.js';

type RewardInput = { userId: string; amount: bigint; pool: 'BINARY' | 'REWARD'; idempotencyKey: string; referenceType: string; referenceId: string; kind: LedgerKind };
// Callers with an existing transaction must pass it; never nest transactions.
export async function creditRewardInTransaction(tx: Prisma.TransactionClient, input: RewardInput) {
  // Same lock order for all reward writers: pool, then user, then receipt.
  const code = `SYSTEM:USDC:${input.pool}`;
  const pool = await tx.ledgerAccount.findUniqueOrThrow({ where: { code } });
  await tx.$queryRaw`SELECT id FROM "LedgerAccount" WHERE id = ${pool.id} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
  const previous = await tx.rewardReceipt.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (previous) {
    if (previous.userId !== input.userId || previous.pool !== input.pool || previous.requested !== input.amount || previous.referenceId !== input.referenceId || previous.referenceType !== input.referenceType) throw new Error('Conflicting reward retry');
    return previous;
  }
  const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
  const balance = await tx.ledgerEntry.aggregate({ where: { accountId: pool.id }, _sum: { credit: true, debit: true } });
  const allocation = allocateReward(input.amount, user.maxCap, user.capConsumed, (balance._sum.credit ?? 0n) - (balance._sum.debit ?? 0n));
  const receipt = await tx.rewardReceipt.create({ data: { userId: input.userId, idempotencyKey: input.idempotencyKey, pool: input.pool, requested: input.amount, ...allocation, referenceType: input.referenceType, referenceId: input.referenceId } });
  if (allocation.credited > 0n) {
    const recipient = await tx.ledgerAccount.upsert({ where: { code: `USER:${user.id}:USDC:AVAILABLE` }, create: { userId: user.id, code: `USER:${user.id}:USDC:AVAILABLE`, currency: 'USDC', type: 'AVAILABLE' }, update: {} });
    await postLedger({ idempotencyKey: `reward:${receipt.id}`, kind: input.kind, referenceType: input.referenceType, referenceId: input.referenceId, postings: [{ accountId: pool.id, debit: allocation.credited }, { accountId: recipient.id, credit: allocation.credited }] }, tx);
    await tx.user.update({ where: { id: user.id }, data: { capConsumed: { increment: allocation.credited } } });
  }
  return receipt;
}
export async function creditReward(input: RewardInput) {
  // Retry only transactions PostgreSQL rolled back, never business-rule failures.
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(tx => creditRewardInTransaction(tx, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))));
      if (!retryable || attempt >= 4) throw error;
    }
  }
}

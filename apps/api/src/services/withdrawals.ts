import { Address } from '@ton/ton';
import { dailyCapForXp } from '../domain/progression.js';
import { LedgerKind, Prisma, WithdrawalStatus } from '@prisma/client';
import { economics, payoutAutomationReady } from '../config.js';
import { prisma } from '../prisma.js';
import { postLedger } from './ledger.js';


export async function requestWithdrawal(userId: string, amount: bigint, destination: string, idempotencyKey: string) {
  destination = Address.parse(destination).toRawString();
  if (amount < economics.withdrawal.minimumUsdc) throw new Error('Withdrawal below minimum');
  const fee = amount * BigInt(economics.withdrawal.feeBps) / 10_000n;
  const netAmount = amount - fee;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const existing = await tx.withdrawal.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.userId !== userId || existing.amount !== amount || Address.parse(existing.destination).toRawString() !== destination) throw new Error('Idempotency key conflicts with another request');
      return existing;
    }
    const switchSetting = await tx.systemSetting.findUnique({ where: { key: 'withdrawals_enabled' } });
    if (switchSetting?.value === false) throw new Error('New withdrawals are temporarily disabled by the administrator.');
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet?.verifiedAt || Address.parse(wallet.address).toRawString() !== destination) throw new Error('Register and verify this wallet in Profile before withdrawing');
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const activeToday = { userId, createdAt: { gte: today }, status: { notIn: [WithdrawalStatus.REJECTED, WithdrawalStatus.CANCELLED] } };
    const count = await tx.withdrawal.count({ where: activeToday });
    if (count >= economics.withdrawal.maximumPerDay) throw new Error('Daily withdrawal limit reached');
    const [user, todayTotal] = await Promise.all([
      tx.user.findUniqueOrThrow({ where: { id: userId }, select: { xp: true } }),
      tx.withdrawal.aggregate({ where: activeToday, _sum: { amount: true } })
    ]);
    if ((todayTotal._sum.amount ?? 0n) + amount > dailyCapForXp(user.xp)) throw new Error('Daily withdrawal value cap reached for your level');
    const available = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${userId}:USDC:AVAILABLE` } });
    const hold = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${userId}:USDC:HOLD` } });
    const sum = await tx.ledgerEntry.aggregate({ where: { accountId: available.id }, _sum: { debit: true, credit: true } });
    const balance = (sum._sum.credit ?? 0n) - (sum._sum.debit ?? 0n);
    if (balance < amount) throw new Error('Insufficient available balance');
    const withdrawal = await tx.withdrawal.create({ data: { userId, amount, fee, netAmount, destination, idempotencyKey, status: payoutAutomationReady ? WithdrawalStatus.APPROVED : WithdrawalStatus.REQUESTED } });
    await postLedger({ idempotencyKey: `withdrawal-hold:${withdrawal.id}`, kind: LedgerKind.WITHDRAWAL, referenceType: 'Withdrawal', referenceId: withdrawal.id,
      postings: [{ accountId: available.id, debit: amount }, { accountId: hold.id, credit: amount }] }, tx);
    return withdrawal;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reviewWithdrawal(id: string, actorId: string | null, status: 'REVIEWING' | 'APPROVED' | 'REJECTED' | 'PAID', txHash?: string) {
  if (status === 'PAID' && actorId) {
    if (!txHash || !/^[a-fA-F0-9]{64}$/.test(txHash)) throw new Error('Enter the 64-character hexadecimal TON transaction hash');
    txHash = txHash.toLowerCase();
  }
  if (status === WithdrawalStatus.PAID && !txHash) throw new Error('A blockchain transaction hash is required before marking a withdrawal paid');
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(718291)`;
    const before = await tx.withdrawal.findUniqueOrThrow({ where: { id }, include: { payoutJob: true } });
    if (status === 'PAID' && actorId && before.payoutJob) throw new Error('Automated payouts must be confirmed by the chain verifier');
    if (before.payoutJob && before.payoutJob.status !== 'QUEUED' && status !== 'PAID') throw new Error('A payout is in flight or needs reconciliation; its hold cannot be released');
    if (status === 'PAID' && before.status !== 'APPROVED') throw new Error('Only approved withdrawals can be settled');
    if (status === 'PAID' && txHash && await tx.withdrawal.findFirst({ where: { txHash, id: { not: id } } })) throw new Error('This transaction hash was already used for another withdrawal');
    if (before.status === WithdrawalStatus.REJECTED || before.status === WithdrawalStatus.CANCELLED || before.status === WithdrawalStatus.PAID) throw new Error('This withdrawal is already final');
    if (status === WithdrawalStatus.REJECTED) {
      const available = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${before.userId}:USDC:AVAILABLE` } });
      const hold = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${before.userId}:USDC:HOLD` } });
      await postLedger({ idempotencyKey: `withdrawal-release:${before.id}`, kind: LedgerKind.ADJUSTMENT, referenceType: 'Withdrawal', referenceId: before.id, postings: [{ accountId: hold.id, debit: before.amount }, { accountId: available.id, credit: before.amount }] }, tx);
    }
    if (status === WithdrawalStatus.PAID) {
      const hold = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${before.userId}:USDC:HOLD` } });
      const paid = await tx.ledgerAccount.upsert({ where: { code: 'SYSTEM:USDC:PAYOUTS' }, create: { code: 'SYSTEM:USDC:PAYOUTS', currency: 'USDC', type: 'EXPENSE' }, update: {} });
      const fees = await tx.ledgerAccount.upsert({ where: { code: 'SYSTEM:USDC:FEES' }, create: { code: 'SYSTEM:USDC:FEES', currency: 'USDC', type: 'RESERVE' }, update: {} });
      await postLedger({ idempotencyKey: `withdrawal-settle:${id}`, kind: LedgerKind.WITHDRAWAL, referenceType: 'Withdrawal', referenceId: id, postings: [{ accountId: hold.id, debit: before.amount }, { accountId: paid.id, credit: before.netAmount }, { accountId: fees.id, credit: before.fee }] }, tx);
      await tx.user.update({ where: { id: before.userId }, data: { totalWithdrawn: { increment: before.netAmount } } });
    }
    const updated = await tx.withdrawal.update({ where: { id }, data: { status, reviewedById: actorId, ...(txHash ? { txHash } : {}) } });
    await tx.auditEvent.create({ data: { actorId, action: `WITHDRAWAL_${status}`, entityType: 'Withdrawal', entityId: id, before: { status: before.status, amount: before.amount.toString() }, after: { status, txHash: txHash ?? null } } });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

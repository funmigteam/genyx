import { LedgerKind, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';

type Posting = { accountId: string; debit?: bigint; credit?: bigint };
export async function postLedger(input: { idempotencyKey: string; kind: LedgerKind; referenceType: string; referenceId: string; metadata?: Prisma.InputJsonValue; postings: Posting[] }, client: Prisma.TransactionClient | typeof prisma = prisma) {
  const debit = input.postings.reduce((sum, p) => sum + (p.debit ?? 0n), 0n);
  const credit = input.postings.reduce((sum, p) => sum + (p.credit ?? 0n), 0n);
  if (input.postings.some(p => (p.debit ?? 0n) < 0n || (p.credit ?? 0n) < 0n || ((p.debit ?? 0n) > 0n && (p.credit ?? 0n) > 0n))) throw new Error('Invalid ledger posting');
  if (debit <= 0n || debit !== credit) throw new Error('Ledger posting must balance and be non-zero');
  const create = async (tx: Prisma.TransactionClient) => {
    const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { entries: true } });
    const signature = (entries: Posting[]) => entries.map(p => `${p.accountId}:${p.debit ?? 0n}:${p.credit ?? 0n}`).sort().join('|');
    if (existing) {
      if (existing.kind !== input.kind || existing.referenceType !== input.referenceType || existing.referenceId !== input.referenceId || signature(existing.entries) !== signature(input.postings)) throw new Error('Conflicting ledger retry');
      return existing;
    }
    const accounts = await tx.ledgerAccount.findMany({ where: { id: { in: input.postings.map(p => p.accountId) } }, select: { id: true, currency: true } });
    if (accounts.length !== new Set(input.postings.map(p => p.accountId)).size || new Set(accounts.map(a => a.currency)).size !== 1) throw new Error('Ledger accounts must exist and use one currency');
    return tx.ledgerTransaction.create({ data: {
      idempotencyKey: input.idempotencyKey, kind: input.kind, referenceType: input.referenceType, referenceId: input.referenceId, metadata: input.metadata,
      entries: { create: input.postings.map((p) => ({ accountId: p.accountId, debit: p.debit ?? 0n, credit: p.credit ?? 0n })) }
    }});
  };
  // A caller already holding a serializable transaction must pass it in so
  // the withdrawal record and its hold can never be committed separately.
  if ('$transaction' in client) return client.$transaction(create);
  return create(client);
}

export async function accountBalance(accountId: string) {
  const result = await prisma.ledgerEntry.aggregate({ where: { accountId }, _sum: { debit: true, credit: true } });
  return (result._sum.credit ?? 0n) - (result._sum.debit ?? 0n);
}

import { LedgerKind, Prisma } from '@prisma/client';
import { postLedger } from './ledger.js';

export async function settlePackagePools(tx: Prisma.TransactionClient, payment: { id: string; userId: string; expectedAmount: bigint; quotedOwner: bigint | null; quotedBinary: bigint | null; quotedReward: bigint | null; quotedMaxCap: bigint | null }) {
  const { quotedOwner: owner, quotedBinary: binary, quotedReward: reward, quotedMaxCap: cap } = payment;
  if (owner === null || binary === null || reward === null || cap === null) throw new Error('Historical payment requires pool reconciliation');
  if ([owner, binary, reward, cap].some(value => value < 0n) || owner + binary + reward !== payment.expectedAmount) throw new Error('Invalid pool allocation');
  const codes = ['SYSTEM:USDC:DEPOSITS', 'SYSTEM:USDC:OWNER', 'SYSTEM:USDC:BINARY', 'SYSTEM:USDC:REWARD'];
  const accounts = await Promise.all(codes.map(code => tx.ledgerAccount.upsert({ where: { code }, create: { code, currency: 'USDC', type: 'RESERVE' }, update: {} })));
  await postLedger({ idempotencyKey: `package-pools:${payment.id}`, kind: LedgerKind.PACKAGE_PAYMENT, referenceType: 'Payment', referenceId: payment.id, postings: [{ accountId: accounts[0].id, debit: payment.expectedAmount }, { accountId: accounts[1].id, credit: owner }, { accountId: accounts[2].id, credit: binary }, { accountId: accounts[3].id, credit: reward }] }, tx);
  await tx.user.update({ where: { id: payment.userId }, data: { maxCap: { increment: cap } } });
}

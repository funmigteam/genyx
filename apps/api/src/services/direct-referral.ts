import { LedgerKind, Prisma } from '@prisma/client';
import { PACKAGE_RULES, USDT } from '../domain/economics-v2.js';
import { INVESTMENT_PLANS } from '../domain/investments.js';
import { creditRewardInTransaction } from './rewards.js';

// 5%: 0.5 USDT for every Fixed Cycle of a direct referral's first purchase.
export const DIRECT_REFERRAL_CYCLE_COMMISSION = USDT / 2n;
export const directReferralKey = (paymentId: string) => `direct-referral:${paymentId}`;

const purchaseCycles = (purpose: string, code: string) =>
  purpose === 'PACKAGE' ? PACKAGE_RULES.find(rule => rule.code === code)?.fixedCycles ?? 0
    : purpose === 'INVESTMENT' ? INVESTMENT_PLANS.find(plan => plan.code === code)?.fixedCycles ?? 0 : 0;

/**
 * Pays the direct sponsor once for a member's FIRST confirmed Token or
 * Investment Package. Funded from the binary pool the purchase has just
 * credited; it counts toward the sponsor's Max Cap like every commission.
 * The receipt's idempotency key makes every cycle count only once.
 */
export async function payDirectReferralCommission(tx: Prisma.TransactionClient, paymentId: string) {
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (payment.status !== 'CONFIRMED' || !['PACKAGE', 'INVESTMENT'].includes(payment.purpose)) return null;
  const buyer = await tx.user.findUniqueOrThrow({ where: { id: payment.userId }, select: { referredById: true } });
  if (!buyer.referredById) return null;
  const earlier = await tx.payment.findFirst({
    where: { userId: payment.userId, id: { not: payment.id }, status: 'CONFIRMED', purpose: { in: ['PACKAGE', 'INVESTMENT'] },
      OR: [{ confirmedAt: { lt: payment.confirmedAt ?? new Date() } }, { confirmedAt: null }] },
    select: { id: true },
  });
  if (earlier) return null;
  const cycles = purchaseCycles(payment.purpose, payment.packageCode);
  if (cycles <= 0) return null;
  return creditRewardInTransaction(tx, {
    userId: buyer.referredById, amount: BigInt(cycles) * DIRECT_REFERRAL_CYCLE_COMMISSION, pool: 'BINARY',
    idempotencyKey: directReferralKey(payment.id), referenceType: 'Payment', referenceId: payment.id, kind: LedgerKind.REFERRAL_COMMISSION,
  });
}

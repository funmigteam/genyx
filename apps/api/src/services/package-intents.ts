import { prisma } from '../prisma.js';
import { INITIAL_PACKAGE_CODES, requiresInitialPackage } from '../domain/package-access.js';

type Quote = {
  packageCode: string; expectedAmount: bigint; quotedGen: bigint;
  quotedOwner: bigint; quotedBinary: bigint; quotedReward: bigint; quotedMaxCap: bigint;
};

// Opening a checkout is not a purchase. Reuse a live quote, and allow a
// replacement after expiry without modifying an order already sent to chain.
export async function getOrCreatePackageIntent(userId: string, quote: Quote, now = new Date()) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const supported = [...INITIAL_PACKAGE_CODES, 'PLATINUM', 'DIAMOND'];
    if (!supported.includes(quote.packageCode as typeof supported[number])) throw new Error('Unknown package');
    if (requiresInitialPackage(quote.packageCode) && !await tx.payment.findFirst({
      where: { userId, purpose: 'PACKAGE', packageCode: { in: [...INITIAL_PACKAGE_CODES] }, status: 'CONFIRMED' }, select: { id: true }
    })) {
      throw new Error('Purchase and confirm at least one opening package (6, 18, or 60 USDT) before this package.');
    }
    const where = { userId, packageCode: quote.packageCode, purpose: 'PACKAGE' };
    if (quote.packageCode !== 'DIAMOND' && await tx.payment.findFirst({ where: { ...where, status: 'CONFIRMED' } })) {
      throw new Error('Package already purchased and confirmed; choose another package.');
    }
    const pending = await tx.payment.findFirst({
      where: { ...where, status: 'PENDING', expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' }
    });
    if (pending) return pending;
    // A submitted transaction must finish reconciliation before issuing a
    // second bill for a non-repeatable package, even if its quote expired.
    // A submitted payment stays available for reconciliation, but it does not
    // block a fresh checkout. Confirmation remains idempotent.
    return tx.payment.create({ data: { userId, ...quote, expiresAt: new Date(now.getTime() + 30 * 60_000) } });
  });
}

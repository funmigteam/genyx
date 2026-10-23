import { AccountType, LedgerKind, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { postLedger } from './ledger.js';
import { cyclePolicy, recordBinaryVolume } from './binary.js';
import { payDirectReferralCommission } from './direct-referral.js';
import { allowedInvestmentPlans, cancellationQuote, dueSettlements, investmentAllowed, investmentPlan, investmentVolume, monthlyPayout, SETTLEMENT_PERIOD_DAYS } from '../domain/investments.js';

type Tx = Prisma.TransactionClient;
const account = (tx: Tx, code: string, currency: 'USDC' | 'GEN', type: AccountType, userId?: string) =>
  tx.ledgerAccount.upsert({ where: { code }, create: { code, currency, type, ...(userId ? { userId } : {}) }, update: {} });

// Monthly USDT profit waits here until the Max Profit bar is full.
const lockedAccount = (tx: Tx, userId: string) => account(tx, `USER:${userId}:USDC:INVESTMENT`, 'USDC', 'HOLD', userId);

async function releaseLockedProfit(tx: Tx, investment: { id: string; userId: string; profitLocked: bigint }, key: string) {
  if (investment.profitLocked <= 0n) return;
  const [locked, wallet] = await Promise.all([
    lockedAccount(tx, investment.userId),
    account(tx, `USER:${investment.userId}:USDC:AVAILABLE`, 'USDC', 'AVAILABLE', investment.userId),
  ]);
  await postLedger({ idempotencyKey: `${key}:${investment.id}`, kind: LedgerKind.INVESTMENT_PROFIT, referenceType: 'Investment', referenceId: investment.id, postings: [
    { accountId: locked.id, debit: investment.profitLocked }, { accountId: wallet.id, credit: investment.profitLocked },
  ] }, tx);
}

/** Moves the whole locked profit to the wallet once Max Profit is reached. */
export async function withdrawInvestmentProfit(userId: string, investmentId: string, now = new Date()) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Investment" WHERE id = ${investmentId} FOR UPDATE`;
    const investment = await tx.investment.findFirst({ where: { id: investmentId, userId } });
    if (!investment) throw new Error('Investment not found');
    if (investment.valueConsumed < investment.maxProfit) throw new Error('Profit unlocks when the Max Profit bar is full.');
    if (investment.profitLocked <= 0n) throw new Error('This profit was already withdrawn.');
    const amount = investment.profitLocked;
    await releaseLockedProfit(tx, investment, 'investment-release');
    await tx.auditEvent.create({ data: { actorId: userId, action: 'INVESTMENT_PROFIT_WITHDRAWN', entityType: 'Investment', entityId: investmentId, after: { amount: amount.toString() } } });
    return { investment: await tx.investment.update({ where: { id: investmentId }, data: { profitLocked: 0n, profitReleasedAt: now } }), amount };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

// quotedBinary + quotedReward is the binary volume recordBinaryVolume
// propagates; quotedBinary is the commission allocation funded from it.
async function investmentQuote(tx: Tx, plan: ReturnType<typeof investmentPlan>, now: Date) {
  const { volume, commission } = investmentVolume(plan.fixedCycles, await cyclePolicy(tx, now));
  return {
    purpose: 'INVESTMENT', packageCode: plan.code, expectedAmount: plan.principal, quotedGen: 0n,
    quotedOwner: plan.principal - volume, quotedBinary: commission, quotedReward: volume - commission, quotedMaxCap: plan.maxCap,
  };
}

// Opening a checkout is not a purchase: reuse a live quote for the same plan.
export async function getOrCreateInvestmentIntent(userId: string, planCode: string, now = new Date()) {
  const plan = investmentPlan(planCode);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { activePackageCode: true } });
    if (!user.activePackageCode) throw new Error('Buy a token package first; investment packs open after registration.');
    if (!investmentAllowed(plan.code, user.activePackageCode)) throw new Error('This pack is above 10× your token package. Upgrade your token package to unlock it.');
    const pending = await tx.payment.findFirst({ where: { userId, purpose: 'INVESTMENT', packageCode: plan.code, status: 'PENDING', expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' } });
    if (pending) return pending;
    return tx.payment.create({ data: { userId, ...await investmentQuote(tx, plan, now), expiresAt: new Date(now.getTime() + 30 * 60_000) } });
  });
}

export async function confirmInvestmentPayment(tx: Tx, paymentId: string) {
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (payment.purpose !== 'INVESTMENT' || payment.quotedBinary === null || payment.quotedReward === null) throw new Error('Investment quote required');
  const plan = investmentPlan(payment.packageCode);
  if (payment.expectedAmount !== plan.principal) throw new Error('Investment amount does not match its plan');
  const [deposits, binaryPool, investmentPool] = await Promise.all([
    account(tx, 'SYSTEM:USDC:DEPOSITS', 'USDC', 'RESERVE'),
    account(tx, 'SYSTEM:USDC:BINARY', 'USDC', 'RESERVE'),
    account(tx, 'SYSTEM:USDC:INVESTMENT', 'USDC', 'RESERVE'),
  ]);
  // The commission allocation funds the upline's cycle rewards exactly like a
  // package; the rest is held to pay monthly profits and refunds.
  await postLedger({ idempotencyKey: `investment-payment:${payment.id}`, kind: LedgerKind.INVESTMENT_PAYMENT, referenceType: 'Payment', referenceId: payment.id, postings: [
    { accountId: deposits.id, debit: payment.expectedAmount },
    { accountId: binaryPool.id, credit: payment.quotedBinary },
    { accountId: investmentPool.id, credit: payment.expectedAmount - payment.quotedBinary },
  ] }, tx);
  const confirmed = await tx.payment.update({ where: { id: payment.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
  await openInvestment(tx, confirmed);
  await payDirectReferralCommission(tx, confirmed.id);
  await tx.user.update({ where: { id: payment.userId }, data: { totalDeposited: { increment: payment.expectedAmount } } });
  return confirmed;
}

async function openInvestment(tx: Tx, payment: { id: string; userId: string; packageCode: string; quotedBinary: bigint | null }, startedAt = new Date()) {
  const plan = investmentPlan(payment.packageCode);
  const investment = await tx.investment.create({ data: {
    userId: payment.userId, paymentId: payment.id, planCode: plan.code, principal: plan.principal, monthlyProfit: plan.monthlyProfit,
    monthlyTokens: plan.monthlyTokens, maxProfit: plan.maxProfit, maxCap: plan.maxCap, fixedCycles: plan.fixedCycles, commissionAllocation: payment.quotedBinary ?? 0n, startedAt,
  } });
  await recordBinaryVolume(tx, payment.id);
  return investment;
}

/**
 * Room left for USDT income: every active investment's Max Cap (oldest first)
 * plus the token package's Max Cap. Callers must hold the user row lock.
 */
export async function incomeCapacity(tx: Tx, userId: string) {
  const [user, investments] = await Promise.all([
    tx.user.findUniqueOrThrow({ where: { id: userId }, select: { maxCap: true, capConsumed: true } }),
    tx.investment.findMany({ where: { userId, status: 'ACTIVE' }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }], select: { id: true, maxCap: true, valueConsumed: true } }),
  ]);
  const room = (cap: bigint, used: bigint) => (cap > used ? cap - used : 0n);
  const slots = investments.map(row => ({ id: row.id, room: room(row.maxCap, row.valueConsumed), maxCap: row.maxCap, valueConsumed: row.valueConsumed }));
  const packageRoom = room(user.maxCap, user.capConsumed);
  return { investments: slots, packageRoom, total: slots.reduce((sum, slot) => sum + slot.room, packageRoom) };
}

/** Counts received USDT on the bars: oldest active investment first, then the token package. */
export async function consumeCapacity(tx: Tx, userId: string, amount: bigint) {
  let left = amount;
  const capacity = await incomeCapacity(tx, userId);
  for (const slot of capacity.investments) {
    if (left <= 0n) break;
    const used = left < slot.room ? left : slot.room;
    if (used <= 0n) continue;
    left -= used;
    // A full Max Cap closes the investment: its miner tokens lock too.
    await tx.investment.update({ where: { id: slot.id }, data: { valueConsumed: { increment: used }, ...(slot.valueConsumed + used >= slot.maxCap ? { status: 'COMPLETED' } : {}) } });
  }
  if (left > 0n) await tx.user.update({ where: { id: userId }, data: { capConsumed: { increment: left } } });
}

const overflowAccount = (tx: Tx, userId: string) => account(tx, `USER:${userId}:USDC:OVERFLOW`, 'USDC', 'HOLD', userId);
const balanceOf = async (tx: Tx, accountId: string) => {
  const sum = await tx.ledgerEntry.aggregate({ where: { accountId }, _sum: { credit: true, debit: true } });
  return (sum._sum.credit ?? 0n) - (sum._sum.debit ?? 0n);
};

/**
 * Income above the Max Cap is never burned for a member who can invest: it
 * is held, the largest investment pack it covers (within the 10× rule) is
 * bought automatically, and the rest is paid out up to the new Max Cap —
 * repeating while enough remains. Less than the smallest pack stays held
 * until later overflow tops it up. Callers hold the user row lock.
 */
export async function absorbOverflow(tx: Tx, userId: string, sourceAccountId: string, amount: bigint, key: string, kind: LedgerKind, now = new Date()) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { activePackageCode: true } });
  const plans = allowedInvestmentPlans(user.activePackageCode).sort((a, b) => (a.principal > b.principal ? -1 : 1));
  if (!plans.length || amount <= 0n) return { held: 0n, invested: [] as string[], paid: 0n };
  const overflow = await overflowAccount(tx, userId);
  await postLedger({ idempotencyKey: `${key}:overflow`, kind, referenceType: 'User', referenceId: userId, postings: [
    { accountId: sourceAccountId, debit: amount }, { accountId: overflow.id, credit: amount },
  ] }, tx);
  const invested: string[] = []; let paid = 0n;
  for (let round = 0; round < 100; round++) {
    const held = await balanceOf(tx, overflow.id);
    const plan = plans.find(item => item.principal <= held);
    if (!plan) break;
    const quote = await investmentQuote(tx, plan, now);
    const payment = await tx.payment.create({ data: { userId, ...quote, status: 'CONFIRMED', confirmedAt: now, expiresAt: now } });
    const [binaryPool, investmentPool, wallet] = await Promise.all([
      account(tx, 'SYSTEM:USDC:BINARY', 'USDC', 'RESERVE'),
      account(tx, 'SYSTEM:USDC:INVESTMENT', 'USDC', 'RESERVE'),
      account(tx, `USER:${userId}:USDC:AVAILABLE`, 'USDC', 'AVAILABLE', userId),
    ]);
    await postLedger({ idempotencyKey: `investment-payment:${payment.id}`, kind: LedgerKind.INVESTMENT_PAYMENT, referenceType: 'Payment', referenceId: payment.id, postings: [
      { accountId: overflow.id, debit: plan.principal },
      { accountId: binaryPool.id, credit: quote.quotedBinary },
      { accountId: investmentPool.id, credit: plan.principal - quote.quotedBinary },
    ] }, tx);
    const investment = await openInvestment(tx, payment, now);
    invested.push(investment.id);
    await tx.auditEvent.create({ data: { action: 'INVESTMENT_AUTO_PURCHASED', entityType: 'Investment', entityId: investment.id, after: { userId, planCode: plan.code, source: key } } });
    const rest = held - plan.principal;
    const room = (await incomeCapacity(tx, userId)).total;
    const pay = rest < room ? rest : room;
    if (pay > 0n) {
      await postLedger({ idempotencyKey: `${key}:overflow-paid:${round}`, kind, referenceType: 'User', referenceId: userId, postings: [
        { accountId: overflow.id, debit: pay }, { accountId: wallet.id, credit: pay },
      ] }, tx);
      await consumeCapacity(tx, userId, pay);
      paid += pay;
    }
  }
  return { held: await balanceOf(tx, overflow.id), invested, paid };
}

/** Pays every month that has ended for one investment; safe to re-run. */
export async function settleInvestment(investmentId: string, now = new Date()) {
  return prisma.$transaction(async tx => {
    // Lock order shared with reward crediting: user, then investment.
    const owner = await tx.investment.findUniqueOrThrow({ where: { id: investmentId }, select: { userId: true } });
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${owner.userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Investment" WHERE id = ${investmentId} FOR UPDATE`;
    let investment = await tx.investment.findUniqueOrThrow({ where: { id: investmentId } });
    if (investment.status !== 'ACTIVE') return investment;
    for (const due of dueSettlements(investment.startedAt, investment.settledThrough, now)) {
      const payout = monthlyPayout(investment);
      await tx.investmentSettlement.create({ data: { investmentId, month: due.month, profit: payout.profit, tokens: payout.tokens, value: payout.value } });
      if (payout.profit > 0n) {
        const [pool, locked] = await Promise.all([
          account(tx, 'SYSTEM:USDC:INVESTMENT', 'USDC', 'RESERVE'),
          lockedAccount(tx, investment.userId),
        ]);
        await postLedger({ idempotencyKey: `investment-profit:${investmentId}:${due.month}`, kind: LedgerKind.INVESTMENT_PROFIT, referenceType: 'Investment', referenceId: investmentId, postings: [
          { accountId: pool.id, debit: payout.profit }, { accountId: locked.id, credit: payout.profit },
        ] }, tx);
      }
      if (payout.tokens > 0n) {
        const [issued, gen] = await Promise.all([
          account(tx, 'SYSTEM:GEN:INVESTMENTS', 'GEN', 'EXPENSE'),
          account(tx, `USER:${investment.userId}:GEN:AVAILABLE`, 'GEN', 'AVAILABLE', investment.userId),
        ]);
        await postLedger({ idempotencyKey: `investment-tokens:${investmentId}:${due.month}`, kind: LedgerKind.INVESTMENT_PROFIT, referenceType: 'Investment', referenceId: investmentId, postings: [
          { accountId: issued.id, debit: payout.tokens }, { accountId: gen.id, credit: payout.tokens },
        ] }, tx);
      }
      investment = await tx.investment.update({ where: { id: investmentId }, data: {
        profitPaid: { increment: payout.profit }, profitLocked: { increment: payout.profit }, tokensPaid: { increment: payout.tokens }, valueConsumed: { increment: payout.value },
        settledThrough: due.month, ...(payout.completes ? { status: 'COMPLETED' } : {}),
      } });
      if (payout.completes) break;
    }
    return investment;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function settleDueInvestments(now = new Date()) {
  const candidates = await prisma.investment.findMany({
    where: { status: 'ACTIVE', startedAt: { lte: new Date(now.getTime() - SETTLEMENT_PERIOD_DAYS * 86_400_000) } },
    select: { id: true, startedAt: true, settledThrough: true }, take: 5000,
  });
  let failures = 0;
  for (const row of candidates) {
    if (!dueSettlements(row.startedAt, row.settledThrough, now).length) continue;
    try { await settleInvestment(row.id, now); } catch { failures++; }
  }
  if (failures) throw new Error('Investment settlements need retry');
}

export async function cancelInvestment(userId: string, investmentId: string, now = new Date()) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Investment" WHERE id = ${investmentId} FOR UPDATE`;
    const investment = await tx.investment.findFirst({ where: { id: investmentId, userId } });
    if (!investment) throw new Error('Investment not found');
    const quote = cancellationQuote(investment, now);
    if (!quote.eligible) throw new Error(investment.status === 'ACTIVE' ? 'The two-month cancellation window has closed.' : 'This investment is no longer active.');
    if (quote.refund > 0n) {
      const [pool, wallet] = await Promise.all([
        account(tx, 'SYSTEM:USDC:INVESTMENT', 'USDC', 'RESERVE'),
        account(tx, `USER:${userId}:USDC:AVAILABLE`, 'USDC', 'AVAILABLE', userId),
      ]);
      await postLedger({ idempotencyKey: `investment-refund:${investmentId}`, kind: LedgerKind.INVESTMENT_REFUND, referenceType: 'Investment', referenceId: investmentId, postings: [
        { accountId: pool.id, debit: quote.refund }, { accountId: wallet.id, credit: quote.refund },
      ] }, tx);
    }
    // The refund already deducts every profit earned, so profit still locked is paid out with it.
    await releaseLockedProfit(tx, investment, 'investment-cancel-release');
    await tx.auditEvent.create({ data: { actorId: userId, action: 'INVESTMENT_CANCELLED', entityType: 'Investment', entityId: investmentId, after: { refund: quote.refund.toString(), deductions: quote.deductions.toString() } } });
    return tx.investment.update({ where: { id: investmentId }, data: { status: 'CANCELLED', cancelledAt: now, refundAmount: quote.refund, profitLocked: 0n, ...(investment.profitLocked > 0n ? { profitReleasedAt: now } : {}) } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

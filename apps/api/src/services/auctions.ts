import { LedgerKind, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { postLedger } from './ledger.js';

async function account(tx: Prisma.TransactionClient, code: string, currency = 'USDC') {
  return tx.ledgerAccount.upsert({ where: { code }, create: { code, currency, type: 'RESERVE' }, update: {} });
}
async function move(tx: Prisma.TransactionClient, from: string, to: string, amount: bigint, key: string, checkBalance = true) {
  if (amount === 0n) return;
  if (amount < 0n) throw new Error('Negative transfer');
  const source = await account(tx, from), target = await account(tx, to);
  await tx.$queryRaw`SELECT id FROM "LedgerAccount" WHERE id = ${source.id} FOR UPDATE`;
  const balance = await tx.ledgerEntry.aggregate({ where: { accountId: source.id }, _sum: { credit: true, debit: true } });
  if (checkBalance && (balance._sum.credit ?? 0n) - (balance._sum.debit ?? 0n) < amount) throw new Error('Insufficient auction funding');
  await postLedger({ idempotencyKey: key, kind: LedgerKind.LOTTERY_PRIZE, referenceType: 'Auction', referenceId: key, postings: [{ accountId: source.id, debit: amount }, { accountId: target.id, credit: amount }] }, tx);
}
export async function createAuction(actorId: string, input: { title: string; bidGen: number; prizeUsdt: bigint; prizeGen: number; prizeXp: number; endsAt: Date; remainingSeconds: number; series?: string | null; round?: number | null; entryUsdt?: bigint; autoAdvance?: boolean }) {
  if (!Number.isSafeInteger(input.remainingSeconds) || input.remainingSeconds < 1 || input.remainingSeconds > 2592000) throw new Error('Invalid bid counter');
  if (input.endsAt <= new Date() || input.prizeUsdt < 0n || ![input.bidGen, input.prizeGen, input.prizeXp].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid auction');
  return prisma.$transaction(async tx => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (actor.role !== 'SUPER_ADMIN') throw new Error('Super admin required');
    const auction = await tx.auction.create({ data: input });
    // Manual prize rooms deliberately do not reserve USDT when created.  The
    // configured amount becomes an internal payable only after a winner wins.
    await tx.auditEvent.create({ data: { actorId, action: 'AUCTION_CREATED_MANUAL_PRIZE', entityType: 'Auction', entityId: auction.id, after: { prizeUsdt: String(input.prizeUsdt) } } });
    return auction;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
/**
 * Deletes an unused room, or cancels a room that already has activity.  Used
 * rooms are kept as immutable financial history, hidden from users by their
 * CANCELLED status, and any remaining prize escrow is released.
 */
export async function deleteUnusedAuction(actorId: string, auctionId: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Auction" WHERE id = ${auctionId} FOR UPDATE`;
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (!['SUPER_ADMIN', 'CONTENT_ADMIN'].includes(actor.role)) throw new Error('Admin permission required');
    const auction = await tx.auction.findUniqueOrThrow({ where: { id: auctionId } });
    const [bidCount, awardCount] = await Promise.all([
      tx.auctionBid.count({ where: { auctionId } }),
      tx.auctionAward.count({ where: { auctionId } }),
    ]);
    const escrow = await account(tx, `AUCTION:${auction.id}`);
    const balance = await tx.ledgerEntry.aggregate({ where: { accountId: escrow.id }, _sum: { debit: true, credit: true } });
    await move(tx, escrow.code, 'SYSTEM:USDC:REWARD', (balance._sum.credit ?? 0n) - (balance._sum.debit ?? 0n), `auction-cancel:${auction.id}`);
    if (bidCount || awardCount) {
      await tx.auction.update({ where: { id: auction.id }, data: { status: 'CANCELLED' } });
      await tx.auditEvent.create({ data: { actorId, action: 'AUCTION_CANCELLED', entityType: 'Auction', entityId: auction.id, before: { title: auction.title, bidCount, awardCount } } });
      return { ok: true, cancelled: true };
    }
    await tx.auction.delete({ where: { id: auction.id } });
    await tx.auditEvent.create({ data: { actorId, action: 'AUCTION_DELETED', entityType: 'Auction', entityId: auction.id, before: { title: auction.title, prizeUsdt: String(auction.prizeUsdt), prizeGen: auction.prizeGen, prizeXp: auction.prizeXp } } });
    return { ok: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function placeAuctionBid(userId: string, auctionId: string, cents: bigint, requestKey: string, now = new Date()) {
  if (cents < 1n || cents > 1000000000000n) throw new Error('Invalid bid');
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Auction" WHERE id = ${auctionId} FOR UPDATE`;
    const prior = await tx.auctionBid.findUnique({ where: { requestKey } });
    if (prior) {
      if (prior.userId !== userId || prior.auctionId !== auctionId || prior.cents !== cents) throw new Error('Conflicting bid retry');
      const reward = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: `auction-entry-bonus:${prior.id}` }, include: { entries: true } });
      return { ...prior, entryRewardGen: String(reward?.entries.reduce((total, entry) => total + entry.credit, 0n) ?? 0n) };
    }
    const auction = await tx.auction.findUniqueOrThrow({ where: { id: auctionId } });
    if (auction.status !== 'OPEN' || auction.remainingSeconds <= 0) throw new Error('Auction closed');
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.activePackageCode) throw new Error('Active package required');
    let entryRewardGen = 0n;
    const entryScope = auction.series ?? `ROOM:${auction.id}`;
    if (auction.entryUsdt > 0n) {
      const pass = await tx.auctionEntryPass.findUnique({ where: { userId_series: { userId, series: entryScope } } });
      if (!pass) {
        const availableUsdt = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${userId}:USDC:AVAILABLE` } });
        await tx.$queryRaw`SELECT id FROM "LedgerAccount" WHERE id = ${availableUsdt.id} FOR UPDATE`;
        const balanceUsdt = await tx.ledgerEntry.aggregate({ where: { accountId: availableUsdt.id }, _sum: { debit: true, credit: true } });
        if ((balanceUsdt._sum.credit ?? 0n) - (balanceUsdt._sum.debit ?? 0n) < auction.entryUsdt) throw new Error('Insufficient USDT for hall entry');
        const reward = await account(tx, 'SYSTEM:USDC:REWARD');
        await postLedger({ idempotencyKey: `auction-entry:${entryScope}:${userId}`, kind: LedgerKind.LOTTERY_ENTRY, referenceType: 'AuctionEntryPass', referenceId: `${entryScope}:${userId}`, postings: [{ accountId: availableUsdt.id, debit: auction.entryUsdt }, { accountId: reward.id, credit: auction.entryUsdt }] }, tx);
        await tx.auctionEntryPass.create({ data: { userId, series: entryScope, entryUsdt: auction.entryUsdt } });
        entryRewardGen = auction.entryUsdt * 10n / 1000000n;
      }
    }
    const source = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${userId}:GEN:AVAILABLE` } });
    await tx.$queryRaw`SELECT id FROM "LedgerAccount" WHERE id = ${source.id} FOR UPDATE`;
    const balance = await tx.ledgerEntry.aggregate({ where: { accountId: source.id }, _sum: { debit: true, credit: true } });
    if ((balance._sum.credit ?? 0n) - (balance._sum.debit ?? 0n) < BigInt(auction.bidGen)) throw new Error('Insufficient GEN');
    const bid = await tx.auctionBid.create({ data: { userId, auctionId, cents, requestKey } });
    if (entryRewardGen > 0n) {
      const issuer = await account(tx, 'SYSTEM:GEN:ENTRY_REWARDS', 'GEN');
      await postLedger({ idempotencyKey: `auction-entry-bonus:${bid.id}`, kind: LedgerKind.GEN_CREDIT, referenceType: 'AuctionBid', referenceId: bid.id, postings: [{ accountId: issuer.id, debit: entryRewardGen }, { accountId: source.id, credit: entryRewardGen }] }, tx);
    }
    if (auction.bidGen) {
      const target = await account(tx, `AUCTION:${auctionId}:GEN`, 'GEN');
      await postLedger({ idempotencyKey: `auction-bid:${bid.id}`, kind: LedgerKind.LOTTERY_ENTRY, referenceType: 'AuctionBid', referenceId: bid.id, postings: [{ accountId: source.id, debit: BigInt(auction.bidGen) }, { accountId: target.id, credit: BigInt(auction.bidGen) }] }, tx);
      await tx.user.update({ where: { id: userId }, data: { genSpent: { increment: auction.bidGen } } });
    }
    await tx.auction.update({ where: { id: auctionId }, data: { remainingSeconds: { decrement: 1 }, ...(auction.remainingSeconds === 1 ? { endsAt: now } : {}) } });
    return { ...bid, entryRewardGen: String(entryRewardGen) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
type Candidate = { userId: string; cents: string };
async function closeIfFinished(tx: Prisma.TransactionClient, auctionId: string) {
  if (await tx.auctionAward.count({ where: { auctionId, status: 'OFFERED' } })) return;
  const escrow = await account(tx, `AUCTION:${auctionId}`);
  const balance = await tx.ledgerEntry.aggregate({ where: { accountId: escrow.id }, _sum: { debit: true, credit: true } });
  await move(tx, escrow.code, 'SYSTEM:USDC:OWNER', (balance._sum.credit ?? 0n) - (balance._sum.debit ?? 0n), `auction-unclaimed:${auctionId}`);
  const auction = await tx.auction.update({ where: { id: auctionId }, data: { status: 'CLOSED' } });
  if (!auction.autoAdvance || !auction.series || !auction.round) return;
  // An empty hall is not a completed lottery.  Previously an empty room whose
  // counter reached zero spawned its successor with the same zero counter,
  // creating an endless C1 → C2 → C3… chain.  Only a hall with real bids may
  // create the next room in its series.
  const bidCount = await tx.auctionBid.count({ where: { auctionId: auction.id } });
  if (bidCount === 0) return;
  const live = await tx.auction.count({ where: { series: auction.series, status: { in: ['OPEN', 'AWAITING'] } } });
  if (live) return;
  // The finished counter is necessarily zero.  A successor must start with a
  // fresh counter, never inherit zero from its completed predecessor.
  const nextSeconds = 86_400;
  const next = await tx.auction.create({ data: { title: `${auction.series}${auction.round + 1}`, series: auction.series, round: auction.round + 1, autoAdvance: true, entryUsdt: auction.entryUsdt, bidGen: auction.bidGen, prizeUsdt: auction.prizeUsdt, prizeGen: auction.prizeGen, prizeXp: auction.prizeXp, remainingSeconds: nextSeconds, endsAt: new Date(Date.now() + nextSeconds * 1000) } });
  await tx.auditEvent.create({ data: { action: 'AUCTION_AUTO_ADVANCED', entityType: 'Auction', entityId: next.id, after: { previousId: auction.id, series: next.series, round: next.round } } });
}
export async function advanceAuction(auctionId: string, now = new Date()) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Auction" WHERE id = ${auctionId} FOR UPDATE`;
    const auction = await tx.auction.findUniqueOrThrow({ where: { id: auctionId } });
    if (auction.status === 'CLOSED') return;
    if (auction.status === 'OPEN') {
      if (auction.remainingSeconds > 0) return;
      const bids = await tx.auctionBid.findMany({ where: { auctionId }, orderBy: [{ cents: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
      const groups = new Map<string, typeof bids>();
      for (const bid of bids) groups.set(String(bid.cents), [...(groups.get(String(bid.cents)) ?? []), bid]);
      const unique = [...groups.values()].filter(group => group.length === 1);
      const eligible = unique.length ? unique : [...groups.values()].filter(group => group.length === 2 && group[0].userId !== group[1].userId);
      const candidates: Candidate[] = eligible.flat().map(bid => ({ userId: bid.userId, cents: String(bid.cents) }));
      await tx.auction.update({ where: { id: auctionId }, data: { status: 'AWAITING', candidates } });
      const slots = unique.length ? 1 : 2;
      for (const candidate of candidates.slice(0, slots)) await tx.auctionAward.create({ data: { auctionId, userId: candidate.userId, cents: BigInt(candidate.cents), prizeUsdt: auction.prizeUsdt / BigInt(slots), prizeGen: Math.floor(auction.prizeGen / slots), prizeXp: Math.floor(auction.prizeXp / slots), expiresAt: new Date(now.getTime() + 86400000) } });
    } else {
      const awards = await tx.auctionAward.findMany({ where: { auctionId } });
      const used = new Set(awards.map(award => award.userId));
      for (const award of awards.filter(a => a.status === 'OFFERED' && a.expiresAt <= now)) {
        await tx.auctionAward.update({ where: { id: award.id }, data: { status: 'EXPIRED' } });
        const next = (auction.candidates as Candidate[]).find(candidate => !used.has(candidate.userId));
        if (next) {
          used.add(next.userId);
          await tx.auctionAward.create({ data: { auctionId, userId: next.userId, cents: BigInt(next.cents), prizeUsdt: award.prizeUsdt, prizeGen: award.prizeGen, prizeXp: award.prizeXp, expiresAt: new Date(now.getTime() + 86400000) } });
        }
      }
    }
    await closeIfFinished(tx, auctionId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function auctionPaymentIntent(userId: string, awardId: string, now = new Date()) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "AuctionAward" WHERE id = ${awardId} FOR UPDATE`;
    const award = await tx.auctionAward.findUniqueOrThrow({ where: { id: awardId } });
    if (award.userId !== userId || award.status !== 'OFFERED' || award.expiresAt <= now) throw new Error('Award unavailable');
    const previous = await tx.payment.findUnique({ where: { auctionAwardId: awardId } });
    if (previous) return previous;
    return tx.payment.create({ data: { userId, packageCode: 'AUCTION', purpose: 'AUCTION', auctionAwardId: awardId, expectedAmount: award.cents * 10000n, expiresAt: award.expiresAt } });
  });
}
/**
 * Settles the winning bid entirely inside the mini-app wallet.  The winner
 * pays the winning cents from USER:USDC:AVAILABLE, then the prize is credited
 * to that same account in the very same serializable transaction.  No second
 * Tonkeeper transfer and no user-supplied transaction hash are involved.
 */
export async function claimAuctionAward(userId: string, awardId: string, now = new Date()) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "AuctionAward" WHERE id = ${awardId} FOR UPDATE`;
    const award = await tx.auctionAward.findUniqueOrThrow({ where: { id: awardId } });
    if (award.userId !== userId || award.status !== 'OFFERED' || award.expiresAt <= now) throw new Error('Award unavailable');
    await tx.$queryRaw`SELECT id FROM "Auction" WHERE id = ${award.auctionId} FOR UPDATE`;

    const available = await tx.ledgerAccount.upsert({
      where: { code: `USER:${userId}:USDC:AVAILABLE` },
      create: { userId, code: `USER:${userId}:USDC:AVAILABLE`, currency: 'USDC', type: 'AVAILABLE' },
      update: {},
    });
    await tx.$queryRaw`SELECT id FROM "LedgerAccount" WHERE id = ${available.id} FOR UPDATE`;
    const winningBid = award.cents * 10000n;
    const balance = await tx.ledgerEntry.aggregate({ where: { accountId: available.id }, _sum: { debit: true, credit: true } });
    if ((balance._sum.credit ?? 0n) - (balance._sum.debit ?? 0n) < winningBid) throw new Error('Insufficient USDT in your in-app wallet for the winning bid');

    if (winningBid > 0n) {
      const reward = await account(tx, 'SYSTEM:USDC:REWARD');
      await postLedger({ idempotencyKey: `auction-winning-bid:${award.id}`, kind: LedgerKind.LOTTERY_ENTRY, referenceType: 'AuctionAward', referenceId: award.id, postings: [{ accountId: available.id, debit: winningBid }, { accountId: reward.id, credit: winningBid }] }, tx);
    }
    if (award.prizeUsdt) await move(tx, 'SYSTEM:USDC:OWNER', available.code, award.prizeUsdt, `auction-manual-prize:${award.id}`, false);
    if (award.prizeGen) {
      const source = await account(tx, 'SYSTEM:GEN:AUCTION_PRIZES', 'GEN');
      const target = await tx.ledgerAccount.upsert({ where: { code: `USER:${award.userId}:GEN:AVAILABLE` }, create: { code: `USER:${award.userId}:GEN:AVAILABLE`, userId: award.userId, currency: 'GEN', type: 'AVAILABLE' }, update: {} });
      await postLedger({ idempotencyKey: `auction-gen:${award.id}`, kind: LedgerKind.GEN_CREDIT, referenceType: 'AuctionAward', referenceId: award.id, postings: [{ accountId: source.id, debit: BigInt(award.prizeGen) }, { accountId: target.id, credit: BigInt(award.prizeGen) }] }, tx);
    }
    await tx.user.update({ where: { id: award.userId }, data: { xp: { increment: award.prizeXp } } });
    await tx.auctionAward.update({ where: { id: award.id }, data: { status: 'PAID' } });
    await closeIfFinished(tx, award.auctionId);
    return { awardId: award.id, status: 'PAID', chargedUsdt: winningBid, creditedUsdt: award.prizeUsdt, netUsdt: award.prizeUsdt - winningBid };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function confirmAuctionPayment(tx: Prisma.TransactionClient, paymentId: string, now = new Date()) {
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (payment.purpose !== 'AUCTION' || !payment.auctionAwardId) throw new Error('Invalid auction payment');
  if (payment.status === 'CONFIRMED') return payment;
  if (payment.status !== 'PENDING' || !payment.chainTxHash) throw new Error('Payment confirmation required');
  const award = await tx.auctionAward.findUniqueOrThrow({ where: { id: payment.auctionAwardId } });
  await tx.$queryRaw`SELECT id FROM "Auction" WHERE id = ${award.auctionId} FOR UPDATE`;
  const current = await tx.auctionAward.findUniqueOrThrow({ where: { id: award.id } });
  if (current.status !== 'OFFERED' || current.expiresAt <= now || current.userId !== payment.userId || payment.expectedAmount !== current.cents * 10000n) throw new Error('Award payment requires reconciliation');
  await move(tx, 'SYSTEM:USDC:DEPOSITS', 'SYSTEM:USDC:REWARD', payment.expectedAmount, `auction-payment:${payment.id}`, false);
  if (award.prizeUsdt) {
    const recipient = await tx.ledgerAccount.upsert({ where: { code: `USER:${award.userId}:USDC:AVAILABLE` }, create: { code: `USER:${award.userId}:USDC:AVAILABLE`, userId: award.userId, currency: 'USDC', type: 'AVAILABLE' }, update: {} });
    // A manual prize is an operator liability, intentionally not capped by the
    // current reward pool.  The user receives an internal balance and later
    // requests the normal on-chain withdrawal.
    await move(tx, 'SYSTEM:USDC:OWNER', recipient.code, award.prizeUsdt, `auction-manual-prize:${award.id}`, false);
  }
  if (award.prizeGen) {
    const source = await account(tx, 'SYSTEM:GEN:AUCTION_PRIZES', 'GEN');
    const target = await tx.ledgerAccount.upsert({ where: { code: `USER:${award.userId}:GEN:AVAILABLE` }, create: { code: `USER:${award.userId}:GEN:AVAILABLE`, userId: award.userId, currency: 'GEN', type: 'AVAILABLE' }, update: {} });
    await postLedger({ idempotencyKey: `auction-gen:${award.id}`, kind: LedgerKind.GEN_CREDIT, referenceType: 'AuctionAward', referenceId: award.id, postings: [{ accountId: source.id, debit: BigInt(award.prizeGen) }, { accountId: target.id, credit: BigInt(award.prizeGen) }] }, tx);
  }
  await tx.user.update({ where: { id: award.userId }, data: { xp: { increment: award.prizeXp }, totalDeposited: { increment: payment.expectedAmount } } });
  await tx.auctionAward.update({ where: { id: award.id }, data: { status: 'PAID' } });
  await closeIfFinished(tx, award.auctionId);
  return tx.payment.update({ where: { id: payment.id }, data: { status: 'CONFIRMED', confirmedAt: now } });
}
export async function processAuctions() {
  const now = new Date();
  const rows = await prisma.auction.findMany({ where: { OR: [{ status: 'OPEN', remainingSeconds: { lte: 0 } }, { status: 'AWAITING', awards: { some: { status: 'OFFERED', expiresAt: { lte: now } } } }] }, orderBy: { endsAt: 'asc' }, take: 100 });
  let failures = 0;
  for (const row of rows) { try { await advanceAuction(row.id); } catch { failures++; } }
  if (failures) throw new Error('Auctions require retry');
}

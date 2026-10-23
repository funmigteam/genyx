import { afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { keyPairFromSeed, sign } from '@ton/crypto';
import { WalletContractV4, beginCell, storeStateInit } from '@ton/ton';
import { walletChallenge, saveProvenWallet, proofDigest } from './wallet-proof.js';
import { LedgerKind } from '@prisma/client';
import { prisma } from '../prisma.js';
import { creditReward } from './rewards.js';
import { accountBalance, postLedger } from './ledger.js';
import { claimTask, approveTaskClaim } from './task-rewards.js';
import { recordBinaryVolume, settleBinary } from './binary.js';
import { createAuction, placeAuctionBid, advanceAuction, claimAuctionAward } from './auctions.js';

// Explicit opt-in: never use the project's configured database implicitly.
const integration = process.env.GENYX_ISOLATED_TEST_DB === 'true' ? it : it.skip;
integration('wallet registration is free; replacement charges 50 GEN atomically and cannot replay', async()=>{
  const user=await prisma.user.create({data:{telegramId:BigInt(Date.now())+987123n}});
  const make=async(seed:number)=>{
    const challenge=await walletChallenge(user.id);
    const key=keyPairFromSeed(Buffer.from(randomUUID().replaceAll('-','').padEnd(64,String(seed)).slice(0,64),'hex'));
    const wallet=WalletContractV4.create({workchain:0,publicKey:key.publicKey});
    const proof={timestamp:Math.floor(Date.now()/1000),domain:{value:'smartgenyx.com',lengthBytes:14},payload:challenge.payload,signature:''};
    proof.signature=sign(proofDigest(wallet.address,proof),key.secretKey).toString('base64');
    return {challengeId:challenge.id,address:wallet.address.toString(),network:'-239' as const,walletStateInit:beginCell().store(storeStateInit(wallet.init)).endCell().toBoc().toString('base64'),proof};
  };
  const first=await make(1);
  expect((await saveProvenWallet(user.id,first,'smartgenyx.com','-239')).chargedGen).toBe(0);
  await expect(saveProvenWallet(user.id,first,'smartgenyx.com','-239')).rejects.toThrow();
  const source=await prisma.ledgerAccount.create({data:{code:`WALLET_TEST:${randomUUID()}`,currency:'GEN',type:'EXPENSE'}});
  const available=await prisma.ledgerAccount.create({data:{code:`USER:${user.id}:GEN:AVAILABLE`,userId:user.id,currency:'GEN',type:'AVAILABLE'}});
  const next=await make(2);
  await expect(saveProvenWallet(user.id,next,'smartgenyx.com','-239')).rejects.toThrow('50 GEN');
  expect((await prisma.walletChallenge.findUniqueOrThrow({where:{id:next.challengeId}})).consumedAt).toBeNull();
  await postLedger({idempotencyKey:randomUUID(),kind:'GEN_CREDIT',referenceType:'TEST',referenceId:user.id,postings:[{accountId:source.id,debit:50n},{accountId:available.id,credit:50n}]});
  expect((await saveProvenWallet(user.id,next,'smartgenyx.com','-239')).chargedGen).toBe(50);
  await expect(saveProvenWallet(user.id,next,'smartgenyx.com','-239')).rejects.toThrow();
  expect((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).genSpent).toBe(50n);
});
integration('task conditions enforce levels, membership, game rounds and idempotency', async () => {
  const user = await prisma.user.create({ data: { telegramId: BigInt(Date.now()) + 99100n, activePackageCode: 'BRONZE', xp: 249n } });
  const level = await prisma.task.create({ data: { title: 'Level gate', kind: 'LEVEL_REACHED', targetValue: 2, status: 'PUBLISHED', startsAt: new Date(0), rewardXp: 10 } });
  await expect(claimTask(user.id, level.id)).rejects.toThrow('requirement not reached');
  expect(await prisma.taskClaim.count({ where: { userId: user.id } })).toBe(0);
  // Level is the organizational rank: XP alone never levels up; two claimed ranks make level 2.
  await prisma.user.update({ where: { id: user.id }, data: { xp: 1_000_000n } });
  await expect(claimTask(user.id, level.id)).rejects.toThrow('requirement not reached');
  await prisma.user.update({ where: { id: user.id }, data: { xp: 250n } });
  for (const rankOrder of [1, 2]) {
    const rank = await prisma.task.upsert({ where: { rankOrder }, update: {}, create: { rankOrder, title: `Rank ${rankOrder}`, kind: 'CYCLES_REACHED', targetValue: 1, isDaily: false, status: 'PUBLISHED', startsAt: new Date(0) } });
    await prisma.taskClaim.create({ data: { taskId: rank.id, userId: user.id, claimKey: 'once', settledAt: new Date() } });
  }
  const first = await claimTask(user.id, level.id);
  expect(first.settledAt).not.toBeNull();
  expect((await claimTask(user.id, level.id)).id).toBe(first.id);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).xp).toBe(260n);
  const channel = await prisma.task.create({ data: { title: 'Channel gate', kind: 'CHANNEL_JOIN', channelChatId: '@example', status: 'PUBLISHED', startsAt: new Date(0) } });
  try {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: { status: 'left' } }) }));
    await expect(claimTask(user.id, channel.id, new Date(), 'dummy')).rejects.toThrow('Join the channel');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: { status: 'member' } }) }));
    expect((await claimTask(user.id, channel.id, new Date(), 'dummy')).settledAt).not.toBeNull();
  } finally { vi.unstubAllGlobals(); }
  const game = await prisma.task.create({ data: { title: 'Game gate', kind: 'GAME_PLAYED', gameKey: 'test-game', targetValue: 3, status: 'PUBLISHED', startsAt: new Date(0) } });
  await expect(claimTask(user.id, game.id)).rejects.toThrow('requirement not reached');
  await prisma.gameActivity.create({ data: { userId: user.id, gameKey: 'test-game', rounds: 3, eventKey: randomUUID(), createdAt: new Date(Date.now() - 1000) } });
  expect((await claimTask(user.id, game.id)).settledAt).not.toBeNull();
  const video = await prisma.task.create({ data: { title: 'Video no check', kind: 'EXTERNAL_LINK', status: 'PUBLISHED', startsAt: new Date(0) } });
  expect((await claimTask(user.id, video.id)).settledAt).not.toBeNull();
});
if (process.env.GENYX_ISOLATED_TEST_DB === 'true') {
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (database.hostname !== '127.0.0.1' || database.pathname !== '/genyx_integration') {
    throw new Error('Integration tests require a dedicated local genyx_integration database');
  }
}
integration('credits once, caps rewards and leaves an unfunded request uncommitted', async () => {
  const user = await prisma.user.create({ data: { telegramId: BigInt(Date.now()), maxCap: 70000000n } });
  const pool = await prisma.ledgerAccount.upsert({ where: { code: 'SYSTEM:USDC:REWARD' }, create: { code: 'SYSTEM:USDC:REWARD', currency: 'USDC', type: 'RESERVE' }, update: {} });
  const source = await prisma.ledgerAccount.create({ data: { code: `TEST:${randomUUID()}`, currency: 'USDC', type: 'RESERVE' } });
  await postLedger({ idempotencyKey: randomUUID(), kind: LedgerKind.DEPOSIT, referenceType: 'TEST', referenceId: user.id, postings: [{ accountId: source.id, debit: 100000000n }, { accountId: pool.id, credit: 100000000n }] });
  const input = { userId: user.id, amount: 100000000n, pool: 'REWARD' as const, idempotencyKey: randomUUID(), referenceType: 'TEST', referenceId: user.id, kind: LedgerKind.DAILY_GIFT };
  const first = await creditReward(input), retry = await creditReward(input);
  expect(retry.id).toBe(first.id); expect(first.credited).toBe(70000000n); expect(first.retained).toBe(30000000n);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).capConsumed).toBe(70000000n);
  expect(await prisma.ledgerTransaction.count({ where: { idempotencyKey: `reward:${first.id}` } })).toBe(1);
  await expect(creditReward({ ...input, amount: 1n })).rejects.toThrow('Conflicting');
  const other = await prisma.user.create({ data: { telegramId: BigInt(Date.now()) + 1n, maxCap: 100_000_000_000_000n } });
  const failed = randomUUID();
  await expect(creditReward({ ...input, userId: other.id, amount: 100_000_000_000_000n, idempotencyKey: failed })).rejects.toThrow('insufficient');
  expect(await prisma.rewardReceipt.findUnique({ where: { idempotencyKey: failed } })).toBeNull();
  expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).capConsumed).toBe(0n);
});
integration('serializes concurrent retries and distinct rewards without exceeding cap', async () => {
  const user = await prisma.user.create({ data: { telegramId: BigInt(Date.now()) + 100n, maxCap: 10000000n } });
  const pool = await prisma.ledgerAccount.upsert({ where: { code: 'SYSTEM:USDC:REWARD' }, create: { code: 'SYSTEM:USDC:REWARD', currency: 'USDC', type: 'RESERVE' }, update: {} });
  const source = await prisma.ledgerAccount.create({ data: { code: `TEST:${randomUUID()}`, currency: 'USDC', type: 'RESERVE' } });
  await postLedger({ idempotencyKey: randomUUID(), kind: LedgerKind.DEPOSIT, referenceType: 'TEST', referenceId: user.id, postings: [{ accountId: source.id, debit: 10000000n }, { accountId: pool.id, credit: 10000000n }] });
  const input = { userId: user.id, amount: 6000000n, pool: 'REWARD' as const, idempotencyKey: randomUUID(), referenceType: 'TEST', referenceId: user.id, kind: LedgerKind.DAILY_GIFT };
  const results = await Promise.all([creditReward(input), creditReward(input), creditReward({ ...input, idempotencyKey: randomUUID() })]);
  expect(results[0].id).toBe(results[1].id);
  expect(await prisma.rewardReceipt.count({ where: { userId: user.id } })).toBe(2);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).capConsumed).toBe(10000000n);
  const account = await prisma.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${user.id}:USDC:AVAILABLE` } });
  const balance = await prisma.ledgerEntry.aggregate({ where: { accountId: account.id }, _sum: { credit: true, debit: true } });
  expect((balance._sum.credit ?? 0n) - (balance._sum.debit ?? 0n)).toBe(10000000n);
});
integration('task approval atomically credits snapshots, applies multipliers and cannot replay', async () => {
  const user = await prisma.user.create({ data: { telegramId: BigInt(Date.now()) + 200n, activePackageCode: 'PLATINUM', maxCap: 5000000n } });
  const admin = await prisma.user.create({ data: { telegramId: BigInt(Date.now()) + 201n, role: 'SUPER_ADMIN' } });
  const pool = await prisma.ledgerAccount.upsert({ where: { code: 'SYSTEM:USDC:REWARD' }, create: { code: 'SYSTEM:USDC:REWARD', currency: 'USDC', type: 'RESERVE' }, update: {} });
  const source = await prisma.ledgerAccount.create({ data: { code: `TEST:${randomUUID()}`, currency: 'USDC', type: 'RESERVE' } });
  await postLedger({ idempotencyKey: randomUUID(), kind: LedgerKind.DEPOSIT, referenceType: 'TEST', referenceId: user.id, postings: [{ accountId: source.id, debit: 3000000n }, { accountId: pool.id, credit: 3000000n }] });
  const task = await prisma.task.create({ data: { title: 'Integration manual', kind: 'MANUAL_REVIEW', status: 'PUBLISHED', startsAt: new Date(0), rewardGen: 10, rewardXp: 20, rewardUsdt: 3000000 } });
  const claim = await claimTask(user.id, task.id);
  expect(claim.settledAt).toBeNull();
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).xp).toBe(0n);
  await expect(approveTaskClaim(user.id, claim.id)).rejects.toThrow('Super admin');
  await prisma.task.update({ where: { id: task.id }, data: { rewardGen: 999, rewardUsdt: 999 } });
  await approveTaskClaim(admin.id, claim.id);
  await approveTaskClaim(admin.id, claim.id);
  const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(current.xp).toBe(40n); expect(current.capConsumed).toBe(3000000n);
  const receipt = await prisma.rewardReceipt.findUniqueOrThrow({ where: { idempotencyKey: `task-usdt:${claim.id}` } });
  expect(receipt.requested).toBe(3000000n);
  expect(await prisma.auditEvent.count({ where: { entityId: claim.id, action: 'TASK_REWARD_APPROVED' } })).toBe(1);
  const gen = await prisma.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${user.id}:GEN:AVAILABLE` } });
  const balance = await prisma.ledgerEntry.aggregate({ where: { accountId: gen.id }, _sum: { credit: true } });
  expect(balance._sum.credit).toBe(20n);
});
integration('confirmed purchases propagate once and settle 60/60 into $5 and one voucher', async () => {
  const root = await prisma.user.create({ data: { telegramId: BigInt(Date.now()) + 300n, activePackageCode: 'BRONZE', maxCap: 70000000n } });
  const pool = await prisma.ledgerAccount.upsert({ where: { code: 'SYSTEM:USDC:BINARY' }, create: { code: 'SYSTEM:USDC:BINARY', currency: 'USDC', type: 'RESERVE' }, update: {} });
  const source = await prisma.ledgerAccount.create({ data: { code: `TEST:${randomUUID()}`, currency: 'USDC', type: 'RESERVE' } });
  await postLedger({ idempotencyKey: randomUUID(), kind: LedgerKind.DEPOSIT, referenceType: 'TEST', referenceId: root.id, postings: [{ accountId: source.id, debit: 15000000n }, { accountId: pool.id, credit: 15000000n }] });
  for (let i = 0; i < 2; i++) {
    const user = await prisma.user.create({ data: { telegramId: BigInt(Date.now()) + BigInt(400 + i), referredById: root.id } });
    const payment = await prisma.payment.create({ data: { userId: user.id, packageCode: 'GOLD', expectedAmount: 66000000n, quotedBinary: 39000000n, quotedReward: 21000000n, status: 'CONFIRMED', expiresAt: new Date() } });
    await prisma.$transaction(tx => recordBinaryVolume(tx, payment.id));
    await prisma.$transaction(tx => recordBinaryVolume(tx, payment.id));
  }
  expect(await prisma.binaryVolume.count({ where: { userId: root.id } })).toBe(2);
  // 10 USDT per line is one cycle worth 1 USDT; every sixth cycle is a voucher.
  const receipt = await settleBinary(root.id);
  expect(receipt?.credited).toBe(5000000n); expect(receipt?.vouchers).toBe(1);
  expect(await settleBinary(root.id)).toBeNull();
  const position = await prisma.binaryPosition.findUniqueOrThrow({ where: { userId: root.id } });
  expect(position.leftVolume).toBe(0n); expect(position.rightVolume).toBe(0n);
  expect(position.leftLifetime).toBe(60000000n); expect(position.slots).toBe(6n);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: root.id } });
  expect(user.vouchers).toBe(1); expect(user.capConsumed).toBe(5000000n);
});
integration('binary daily cap flushes excess while preserving heavy-side remainder', async () => {
  const user = await prisma.user.create({ data: { telegramId: BigInt(Date.now()) + 600n, activePackageCode: 'DIAMOND', maxCap: 7000000000n } });
  await prisma.binaryPosition.create({ data: { userId: user.id, leftVolume: 1505000000n, rightVolume: 1500000000n } });
  const pool = await prisma.ledgerAccount.upsert({ where: { code: 'SYSTEM:USDC:BINARY' }, create: { code: 'SYSTEM:USDC:BINARY', currency: 'USDC', type: 'RESERVE' }, update: {} });
  const source = await prisma.ledgerAccount.create({ data: { code: `TEST:${randomUUID()}`, currency: 'USDC', type: 'RESERVE' } });
  await postLedger({ idempotencyKey: randomUUID(), kind: LedgerKind.DEPOSIT, referenceType: 'TEST', referenceId: user.id, postings: [{ accountId: source.id, debit: 100000000n }, { accountId: pool.id, credit: 100000000n }] });
  const receipt = await settleBinary(user.id);
  // 150 cycles − 25 vouchers = 125 USDT, of which the 100 USDT daily limit is paid.
  expect(receipt?.credited).toBe(100000000n); expect(receipt?.retained).toBe(25000000n); expect(receipt?.vouchers).toBe(25);
  expect((await prisma.binaryPosition.findUniqueOrThrow({ where: { userId: user.id } })).leftVolume).toBe(5000000n);
  await prisma.binaryPosition.update({ where: { userId: user.id }, data: { leftVolume: 10000000n, rightVolume: 10000000n } });
  const second = await settleBinary(user.id);
  expect(second?.credited).toBe(0n); expect(second?.retained).toBe(1000000n);
});
async function auctionFixture(remainingSeconds = 2, prizeXp = 20) {
  const admin = await prisma.user.create({ data: { telegramId: BigInt(Date.now()) + BigInt(Math.floor(Math.random() * 1000000000)), role: 'SUPER_ADMIN' } });
  const pool = await prisma.ledgerAccount.upsert({ where: { code: 'SYSTEM:USDC:REWARD' }, create: { code: 'SYSTEM:USDC:REWARD', currency: 'USDC', type: 'RESERVE' }, update: {} });
  const source = await prisma.ledgerAccount.create({ data: { code: `TEST:${randomUUID()}`, currency: 'USDC', type: 'RESERVE' } });
  await postLedger({ idempotencyKey: randomUUID(), kind: LedgerKind.DEPOSIT, referenceType: 'TEST', referenceId: admin.id, postings: [{ accountId: source.id, debit: 10000000n }, { accountId: pool.id, credit: 10000000n }] });
  const users = [];
  for (let i = 0; i < 3; i++) {
    const user = await prisma.user.create({ data: { telegramId: BigInt(Date.now()) + BigInt(Math.floor(Math.random() * 1000000000)), activePackageCode: 'BRONZE', maxCap: 5000000n } });
    const available = await prisma.ledgerAccount.create({ data: { code: `USER:${user.id}:GEN:AVAILABLE`, userId: user.id, currency: 'GEN', type: 'AVAILABLE' } });
    const issued = await prisma.ledgerAccount.create({ data: { code: `TEST:GEN:${randomUUID()}`, currency: 'GEN', type: 'EXPENSE' } });
    await postLedger({ idempotencyKey: randomUUID(), kind: LedgerKind.GEN_CREDIT, referenceType: 'TEST', referenceId: user.id, postings: [{ accountId: issued.id, debit: 100n }, { accountId: available.id, credit: 100n }] });
    users.push(user);
  }
  const auction = await createAuction(admin.id, { title: 'Integration auction', bidGen: 1, prizeUsdt: 10000000n, prizeGen: 10, prizeXp, remainingSeconds, endsAt: new Date(Date.now() + 60000) });
  return { auction, users };
}
integration('task links must be opened before claiming', async () => {
  const user = await prisma.user.create({ data: { telegramId: BigInt(Date.now()) + 998121n, activePackageCode: 'BRONZE' } });
  const task = await prisma.task.create({ data: { title: 'Open first', kind: 'EXTERNAL_LINK', actionUrl: 'https://example.com', startsAt: new Date(0), status: 'PUBLISHED' } });
  await expect(claimTask(user.id, task.id)).rejects.toThrow('Open the mission link');
  await prisma.auditEvent.create({ data: { actorId: user.id, action: 'TASK_LINK_OPENED', entityType: 'Task', entityId: task.id } });
  expect((await claimTask(user.id, task.id)).settledAt).not.toBeNull();
});
integration('auction expires to the next unique bidder, who claims the prize minus the winning bid', async () => {
  const { auction, users } = await auctionFixture();
  const key = randomUUID();
  const firstBid = await placeAuctionBid(users[0].id, auction.id, 1n, key);
  expect((await placeAuctionBid(users[0].id, auction.id, 1n, key)).id).toBe(firstBid.id);
  await placeAuctionBid(users[1].id, auction.id, 2n, randomUUID());
  expect((await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } })).remainingSeconds).toBe(0);
  await expect(placeAuctionBid(users[2].id, auction.id, 3n, randomUUID())).rejects.toThrow('Auction closed');
  await advanceAuction(auction.id, auction.endsAt);
  const first = await prisma.auctionAward.findFirstOrThrow({ where: { auctionId: auction.id, status: 'OFFERED' } });
  expect(first.userId).toBe(users[0].id);
  await advanceAuction(auction.id, first.expiresAt);
  const second = await prisma.auctionAward.findFirstOrThrow({ where: { auctionId: auction.id, status: 'OFFERED' } });
  expect(second.userId).toBe(users[1].id);
  // An empty wallet is fine: the 0.02 USDT bid comes out of the 10 USDT prize.
  const claimed = await claimAuctionAward(second.userId, second.id, first.expiresAt);
  expect(claimed).toMatchObject({ chargedUsdt: 20000n, creditedUsdt: 10000000n, netUsdt: 9980000n });
  const wallet = await prisma.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${second.userId}:USDC:AVAILABLE` } });
  expect(await accountBalance(wallet.id)).toBe(9980000n);
  await expect(claimAuctionAward(second.userId, second.id, first.expiresAt)).rejects.toThrow('unavailable');
  expect((await prisma.user.findUniqueOrThrow({ where: { id: second.userId } })).xp).toBe(20n);
  expect((await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } })).status).toBe('CLOSED');
});
integration('auction halves a double bid and sends an unqualified prize to owner', async () => {
  const { auction, users } = await auctionFixture();
  await placeAuctionBid(users[0].id, auction.id, 7n, randomUUID());
  await placeAuctionBid(users[1].id, auction.id, 7n, randomUUID());
  await advanceAuction(auction.id, auction.endsAt);
  const awards = await prisma.auctionAward.findMany({ where: { auctionId: auction.id } });
  expect(awards).toHaveLength(2); expect(awards.every(a => a.prizeUsdt === 5000000n)).toBe(true);
  const other = await auctionFixture(3);
  for (const user of other.users) await placeAuctionBid(user.id, other.auction.id, 7n, randomUUID());
  await advanceAuction(other.auction.id, other.auction.endsAt);
  expect((await prisma.auction.findUniqueOrThrow({ where: { id: other.auction.id } })).status).toBe('CLOSED');
  expect(await prisma.auctionAward.count({ where: { auctionId: other.auction.id } })).toBe(0);
});
integration('auction counter only decreases for accepted bids, not elapsed time or retries', async () => {
  const { auction, users } = await auctionFixture();
  const later = new Date(Date.now() + 7 * 86400000);
  await advanceAuction(auction.id, later);
  expect((await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } })).status).toBe('OPEN');
  const key = randomUUID();
  await placeAuctionBid(users[0].id, auction.id, 4n, key, later);
  await placeAuctionBid(users[0].id, auction.id, 4n, key, later);
  await expect(placeAuctionBid(users[0].id, auction.id, 5n, key, later)).rejects.toThrow('Conflicting');
  await advanceAuction(auction.id, later);
  const row = await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } });
  expect(row.remainingSeconds).toBe(1);
  expect(row.status).toBe('OPEN');
  expect(await prisma.auctionBid.count({ where: { auctionId: auction.id } })).toBe(1);
});
integration('auction supports a zero XP prize and selects the last-bid winner', async () => {
  const { auction, users } = await auctionFixture(1, 0);
  await placeAuctionBid(users[0].id, auction.id, 1n, randomUUID());
  await advanceAuction(auction.id);
  const award = await prisma.auctionAward.findFirstOrThrow({ where: { auctionId: auction.id } });
  expect(award.userId).toBe(users[0].id);
  expect(award.prizeXp).toBe(0);
});
integration('ledger refuses cross-currency postings and conflicting idempotency retries', async () => {
  const usdt = await prisma.ledgerAccount.create({ data: { code: `TEST:${randomUUID()}`, currency: 'USDC', type: 'RESERVE' } });
  const gen = await prisma.ledgerAccount.create({ data: { code: `TEST:${randomUUID()}`, currency: 'GEN', type: 'RESERVE' } });
  const target = await prisma.ledgerAccount.create({ data: { code: `TEST:${randomUUID()}`, currency: 'USDC', type: 'RESERVE' } });
  const key = randomUUID();
  const input = { idempotencyKey: key, kind: LedgerKind.DEPOSIT, referenceType: 'TEST', referenceId: key, postings: [{ accountId: usdt.id, debit: 10n }, { accountId: target.id, credit: 10n }] };
  const first = await postLedger(input);
  expect((await postLedger({ ...input, postings: [...input.postings].reverse() })).id).toBe(first.id);
  await expect(postLedger({ ...input, postings: [{ accountId: usdt.id, debit: 20n }, { accountId: target.id, credit: 20n }] })).rejects.toThrow('Conflicting ledger');
  await expect(postLedger({ ...input, idempotencyKey: randomUUID(), postings: [{ accountId: usdt.id, debit: 10n }, { accountId: gen.id, credit: 10n }] })).rejects.toThrow('one currency');
  await expect(postLedger({ ...input, postings: [{ accountId: usdt.id, debit: -10n }, { accountId: target.id, credit: -10n }] })).rejects.toThrow('Invalid ledger');
  expect(await prisma.ledgerTransaction.count({ where: { idempotencyKey: key } })).toBe(1);
});
afterAll(async () => { await prisma.$disconnect(); });

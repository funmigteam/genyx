import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LedgerKind } from '@prisma/client';
import { prisma } from '../prisma.js';
import { accountBalance, postLedger } from './ledger.js';
import { createAuction, placeAuctionBid, purchaseHallPack } from './auctions.js';

const enabled = process.env.GENYX_ISOLATED_TEST_DB === 'true';
if (enabled) { const url = new URL(process.env.DATABASE_URL ?? ''); if (url.hostname !== '127.0.0.1' || url.pathname !== '/genyx_integration') throw new Error('Isolated database required'); }
const integration = enabled ? it : it.skip;
afterAll(() => prisma.$disconnect());
const telegramId = () => BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12));

async function fund(code: string, currency: 'USDC' | 'GEN', amount: bigint, userId?: string) {
  const target = await prisma.ledgerAccount.upsert({ where: { code }, create: { code, currency, type: userId ? 'AVAILABLE' : 'RESERVE', ...(userId ? { userId } : {}) }, update: {} });
  const source = await prisma.ledgerAccount.create({ data: { code: `TEST:${randomUUID()}`, currency, type: 'RESERVE' } });
  await postLedger({ idempotencyKey: randomUUID(), kind: LedgerKind.DEPOSIT, referenceType: 'TEST', referenceId: code, postings: [{ accountId: source.id, debit: amount }, { accountId: target.id, credit: amount }] });
  return target;
}

integration('a lottery pack opens exactly one named hall, once, and pays 10 GEN per USDT', async () => {
  const admin = await prisma.user.create({ data: { telegramId: telegramId(), role: 'SUPER_ADMIN' } });
  const user = await prisma.user.create({ data: { telegramId: telegramId(), activePackageCode: 'BRONZE' } });
  await fund('SYSTEM:USDC:REWARD', 'USDC', 100_000_000n);
  const usdt = await fund(`USER:${user.id}:USDC:AVAILABLE`, 'USDC', 5_000_000n, user.id);
  const gen = await fund(`USER:${user.id}:GEN:AVAILABLE`, 'GEN', 50n, user.id);
  const hall = (title: string, round: number) => createAuction(admin.id, { title, series: 'C', round, autoAdvance: false, entryUsdt: 0n, bidGen: 1, prizeUsdt: 1_000_000n, prizeGen: 0, prizeXp: 0, remainingSeconds: 50, endsAt: new Date(Date.now() + 60_000) });
  const c1 = await hall(`C${Date.now() % 100000}`, 1), c2 = await hall(`C${(Date.now() + 1) % 100000}`, 2);

  await expect(placeAuctionBid(user.id, c1.id, 7n, randomUUID())).rejects.toThrow('Buy the C pack');
  const pass = await purchaseHallPack(user.id, c1.id, 1_000_000n, randomUUID());
  expect(pass.rewardGen).toBe(10n);
  expect(await accountBalance(usdt.id)).toBe(4_000_000n);
  expect(await accountBalance(gen.id)).toBe(60n);
  await expect(purchaseHallPack(user.id, c1.id, 1_000_000n, randomUUID())).rejects.toThrow('already own');

  await placeAuctionBid(user.id, c1.id, 7n, randomUUID());
  await placeAuctionBid(user.id, c1.id, 8n, randomUUID());
  // The C1 pack does not open C2.
  await expect(placeAuctionBid(user.id, c2.id, 9n, randomUUID())).rejects.toThrow('Buy the C pack');

  // A series credit bought under the old rules still enters one hall.
  await prisma.auctionEntryPass.create({ data: { userId: user.id, series: 'C', entryUsdt: 1_000_000n, roomsRemaining: 1 } });
  await placeAuctionBid(user.id, c2.id, 9n, randomUUID());
  await placeAuctionBid(user.id, c2.id, 10n, randomUUID());
  expect((await prisma.auctionEntryPass.findUniqueOrThrow({ where: { userId_series: { userId: user.id, series: 'C' } } })).roomsRemaining).toBe(0);
});

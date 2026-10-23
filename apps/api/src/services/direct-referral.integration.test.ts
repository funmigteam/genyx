import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LedgerKind } from '@prisma/client';
import { prisma } from '../prisma.js';
import { accountBalance, postLedger } from './ledger.js';
import { payDirectReferralCommission } from './direct-referral.js';
import { confirmInvestmentPayment, getOrCreateInvestmentIntent } from './investments.js';
import { profileStats } from './community.js';

const enabled = process.env.GENYX_ISOLATED_TEST_DB === 'true';
if (enabled) { const url = new URL(process.env.DATABASE_URL ?? ''); if (url.hostname !== '127.0.0.1' || url.pathname !== '/genyx_integration') throw new Error('Isolated database required'); }
const integration = enabled ? it : it.skip;
afterAll(() => prisma.$disconnect());
const telegramId = () => BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12));
const wallet = async (userId: string) => { const account = await prisma.ledgerAccount.findUnique({ where: { code: `USER:${userId}:USDC:AVAILABLE` } }); return account ? accountBalance(account.id) : 0n; };

integration('the direct sponsor earns 0.5 USDT per cycle of the first purchase only, once', async () => {
  const pool = await prisma.ledgerAccount.upsert({ where: { code: 'SYSTEM:USDC:BINARY' }, create: { code: 'SYSTEM:USDC:BINARY', currency: 'USDC', type: 'RESERVE' }, update: {} });
  const source = await prisma.ledgerAccount.create({ data: { code: `TEST:${randomUUID()}`, currency: 'USDC', type: 'RESERVE' } });
  await postLedger({ idempotencyKey: randomUUID(), kind: LedgerKind.DEPOSIT, referenceType: 'TEST', referenceId: 'pool', postings: [{ accountId: source.id, debit: 100_000_000n }, { accountId: pool.id, credit: 100_000_000n }] });
  const sponsor = await prisma.user.create({ data: { telegramId: telegramId(), activePackageCode: 'GOLD', maxCap: 700_000_000n } });
  const member = await prisma.user.create({ data: { telegramId: telegramId(), referredById: sponsor.id } });

  // First purchase: GOLD = 10 Fixed Cycles → 5 USDT, paid once even if retried.
  const gold = await prisma.payment.create({ data: { userId: member.id, purpose: 'PACKAGE', packageCode: 'GOLD', expectedAmount: 110_000_000n, status: 'CONFIRMED', confirmedAt: new Date(Date.now() - 1000), expiresAt: new Date() } });
  await prisma.$transaction(tx => payDirectReferralCommission(tx, gold.id));
  await prisma.$transaction(tx => payDirectReferralCommission(tx, gold.id));
  expect(await wallet(sponsor.id)).toBe(5_000_000n);

  // A later purchase (here an investment) earns no direct commission.
  await prisma.user.update({ where: { id: member.id }, data: { activePackageCode: 'GOLD' } });
  const intent = await getOrCreateInvestmentIntent(member.id, 'INV110');
  await prisma.$transaction(tx => confirmInvestmentPayment(tx, intent.id));
  expect(await wallet(sponsor.id)).toBe(5_000_000n);

  const stats = await profileStats(sponsor.id);
  expect(stats.directReferral).toMatchObject({ purchases: 1, cycles: 10n, commission: 5_000_000n });
  // GOLD sponsor without a claimed rank (level 0) does not see the payout pool.
  expect(stats.payoutPool).toBeNull();
});

integration('a first Investment Package also earns the sponsor its cycles', async () => {
  const sponsor = await prisma.user.create({ data: { telegramId: telegramId(), activePackageCode: 'GOLD', maxCap: 700_000_000n } });
  const member = await prisma.user.create({ data: { telegramId: telegramId(), referredById: sponsor.id, activePackageCode: 'BRONZE' } });
  const intent = await getOrCreateInvestmentIntent(member.id, 'INV110');
  await prisma.$transaction(tx => confirmInvestmentPayment(tx, intent.id));
  expect(await wallet(sponsor.id)).toBe(5_000_000n);
});

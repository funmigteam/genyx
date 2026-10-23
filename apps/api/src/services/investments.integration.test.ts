import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LedgerKind } from '@prisma/client';
import { prisma } from '../prisma.js';
import { accountBalance, postLedger } from './ledger.js';
import { creditReward } from './rewards.js';
import { cancelInvestment, confirmInvestmentPayment, getOrCreateInvestmentIntent, settleInvestment, withdrawInvestmentProfit } from './investments.js';

const enabled = process.env.GENYX_ISOLATED_TEST_DB === 'true';
if (enabled) { const url = new URL(process.env.DATABASE_URL ?? ''); if (url.hostname !== '127.0.0.1' || url.pathname !== '/genyx_integration') throw new Error('Isolated database required'); }
const integration = enabled ? it : it.skip;
afterAll(() => prisma.$disconnect());
const telegramId = () => BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12));
const balance = async (code: string) => { const account = await prisma.ledgerAccount.findUnique({ where: { code } }); return account ? accountBalance(account.id) : 0n; };
const member = (data: { activePackageCode?: string; referredById?: string; maxCap?: bigint } = {}) =>
  prisma.user.create({ data: { telegramId: telegramId(), activePackageCode: 'BRONZE', maxCap: 70_000_000n, ...data } });
async function invest(userId: string, plan: string, startedAt: Date) {
  const intent = await getOrCreateInvestmentIntent(userId, plan, startedAt);
  await prisma.$transaction(tx => confirmInvestmentPayment(tx, intent.id));
  return prisma.investment.update({ where: { paymentId: intent.id }, data: { startedAt } });
}
async function fundPool(pool: 'BINARY' | 'REWARD', amount: bigint) {
  const target = await prisma.ledgerAccount.upsert({ where: { code: `SYSTEM:USDC:${pool}` }, create: { code: `SYSTEM:USDC:${pool}`, currency: 'USDC', type: 'RESERVE' }, update: {} });
  const source = await prisma.ledgerAccount.create({ data: { code: `TEST:${randomUUID()}`, currency: 'USDC', type: 'RESERVE' } });
  await postLedger({ idempotencyKey: randomUUID(), kind: LedgerKind.DEPOSIT, referenceType: 'TEST', referenceId: pool, postings: [{ accountId: source.id, debit: amount }, { accountId: target.id, credit: amount }] });
}

integration('investment packs open only after a token package and up to 10× its price', async () => {
  const newcomer = await prisma.user.create({ data: { telegramId: telegramId() } });
  await expect(getOrCreateInvestmentIntent(newcomer.id, 'INV110')).rejects.toThrow('token package first');
  const bronze = await member();
  await expect(getOrCreateInvestmentIntent(bronze.id, 'INV330')).rejects.toThrow('10×');
  expect((await getOrCreateInvestmentIntent(bronze.id, 'INV110')).expectedAmount).toBe(110_000_000n);
});

integration('pays every 30 days into the locked balance, counts USDT only, and refunds on cancellation', async () => {
  const sponsor = await member();
  const user = await member({ referredById: sponsor.id });
  const binaryBefore = await balance('SYSTEM:USDC:BINARY');
  const start = new Date('2026-10-16T00:00:00Z');
  const investment = await invest(user.id, 'INV110', start);

  // 10 Fixed Cycles: 100 USDT of volume and a 10 USDT commission allocation.
  expect(investment.fixedCycles).toBe(10);
  expect(investment.commissionAllocation).toBe(10_000_000n);
  // The first purchase also pays the direct sponsor 0.5 USDT × 10 cycles from that allocation.
  expect(await balance('SYSTEM:USDC:BINARY') - binaryBefore).toBe(5_000_000n);
  expect(await balance(`USER:${sponsor.id}:USDC:AVAILABLE`)).toBe(5_000_000n);
  expect((await prisma.binaryVolume.findMany({ where: { userId: sponsor.id } })).map(v => v.amount)).toEqual([100_000_000n]);

  // Nothing before day 30; the first full period is paid once.
  expect((await settleInvestment(investment.id, new Date('2026-11-14T23:00:00Z'))).profitPaid).toBe(0n);
  await settleInvestment(investment.id, new Date('2026-11-15T00:00:01Z'));
  const settled = await settleInvestment(investment.id, new Date('2026-11-20T00:00:00Z'));
  expect(settled.settledThrough).toBe('P0001');
  expect(settled.profitPaid).toBe(3_000_000n);
  expect(settled.tokensPaid).toBe(30n);
  expect(settled.valueConsumed).toBe(3_000_000n);
  expect(settled.profitLocked).toBe(3_000_000n);
  expect(await balance(`USER:${user.id}:USDC:AVAILABLE`)).toBe(0n);
  expect(await balance(`USER:${user.id}:USDC:INVESTMENT`)).toBe(3_000_000n);
  expect(await balance(`USER:${user.id}:GEN:AVAILABLE`)).toBe(30n);
  await expect(withdrawInvestmentProfit(user.id, investment.id)).rejects.toThrow('Max Profit bar');

  // Cancellation refunds principal − profit − commissions; locked profit is released with it.
  const cancelled = await cancelInvestment(user.id, investment.id, new Date('2026-11-20T00:00:00Z'));
  expect(cancelled.refundAmount).toBe(110_000_000n - 3_000_000n - 10_000_000n);
  expect(await balance(`USER:${user.id}:USDC:AVAILABLE`)).toBe(110_000_000n - 10_000_000n);
  expect(await balance(`USER:${user.id}:USDC:INVESTMENT`)).toBe(0n);
  await expect(cancelInvestment(user.id, investment.id, new Date('2026-11-21T00:00:00Z'))).rejects.toThrow('no longer active');
});

integration('cancellation is refused after two months and for another user', async () => {
  const user = await member({ activePackageCode: 'SILVER' });
  const other = await member();
  const investment = await invest(user.id, 'INV330', new Date('2026-10-01T00:00:00Z'));
  await expect(cancelInvestment(other.id, investment.id, new Date('2026-10-05T00:00:00Z'))).rejects.toThrow('not found');
  await expect(cancelInvestment(user.id, investment.id, new Date('2026-12-02T00:00:00Z'))).rejects.toThrow('window has closed');
});

integration('commissions fill the oldest investment first; profit unlocks at Max Profit and tokens stop at Max Cap', async () => {
  await fundPool('REWARD', 2_000_000_000n);
  const user = await member();
  const start = new Date('2026-01-01T00:00:00Z');
  const investment = await invest(user.id, 'INV110', start);

  // 299 USDT of commissions fill the bars of the investment, not the 70 USDT package cap.
  await creditReward({ userId: user.id, amount: 299_000_000n, pool: 'REWARD', idempotencyKey: randomUUID(), referenceType: 'TEST', referenceId: user.id, kind: LedgerKind.REFERRAL_COMMISSION });
  expect((await prisma.investment.findUniqueOrThrow({ where: { id: investment.id } })).valueConsumed).toBe(299_000_000n);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).capConsumed).toBe(0n);

  // The first period pays only the 1 USDT left to Max Profit, plus the 30 tokens.
  const first = await settleInvestment(investment.id, new Date('2026-01-31T00:00:01Z'));
  expect([first.profitPaid, first.tokensPaid, first.valueConsumed, first.status]).toEqual([1_000_000n, 30n, 300_000_000n, 'ACTIVE']);
  const { amount } = await withdrawInvestmentProfit(user.id, investment.id);
  expect(amount).toBe(1_000_000n);
  await expect(withdrawInvestmentProfit(user.id, investment.id)).rejects.toThrow('already withdrawn');

  // No more profit, but miner tokens continue until Max Cap ...
  const second = await settleInvestment(investment.id, new Date('2026-03-02T00:00:01Z'));
  expect([second.profitPaid, second.tokensPaid]).toEqual([1_000_000n, 60n]);
  // ... and lock once commissions fill the Max Cap; the rest goes to the package cap.
  await creditReward({ userId: user.id, amount: 450_000_000n, pool: 'REWARD', idempotencyKey: randomUUID(), referenceType: 'TEST', referenceId: user.id, kind: LedgerKind.REFERRAL_COMMISSION });
  const closed = await prisma.investment.findUniqueOrThrow({ where: { id: investment.id } });
  expect([closed.valueConsumed, closed.status]).toEqual([700_000_000n, 'COMPLETED']);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).capConsumed).toBe(50_000_000n);
  expect((await settleInvestment(investment.id, new Date('2026-06-01T00:00:00Z'))).tokensPaid).toBe(60n);
});

integration('income above the Max Cap buys the largest allowed investment pack automatically', async () => {
  await fundPool('REWARD', 2_000_000_000n);
  const user = await member({ activePackageCode: 'GOLD', maxCap: 700_000_000n });
  await prisma.user.update({ where: { id: user.id }, data: { capConsumed: 700_000_000n } });

  // 1,250 USDT over a full cap: buys INV1100 (≤ 10 × 110), pays 150 USDT up to its cap.
  await creditReward({ userId: user.id, amount: 1_250_000_000n, pool: 'REWARD', idempotencyKey: randomUUID(), referenceType: 'TEST', referenceId: user.id, kind: LedgerKind.REFERRAL_COMMISSION });
  const bought = await prisma.investment.findMany({ where: { userId: user.id } });
  expect(bought.map(row => row.planCode)).toEqual(['INV1100']);
  expect(bought[0].valueConsumed).toBe(150_000_000n);
  expect(await balance(`USER:${user.id}:USDC:AVAILABLE`)).toBe(150_000_000n);
  expect(await balance(`USER:${user.id}:USDC:OVERFLOW`)).toBe(0n);
  expect(await prisma.auditEvent.count({ where: { action: 'INVESTMENT_AUTO_PURCHASED', entityId: bought[0].id } })).toBe(1);

  // Less than the smallest pack is held until later overflow tops it up.
  const small = await member();
  await prisma.user.update({ where: { id: small.id }, data: { capConsumed: 70_000_000n } });
  await creditReward({ userId: small.id, amount: 60_000_000n, pool: 'REWARD', idempotencyKey: randomUUID(), referenceType: 'TEST', referenceId: small.id, kind: LedgerKind.REFERRAL_COMMISSION });
  expect(await balance(`USER:${small.id}:USDC:OVERFLOW`)).toBe(60_000_000n);
  await creditReward({ userId: small.id, amount: 60_000_000n, pool: 'REWARD', idempotencyKey: randomUUID(), referenceType: 'TEST', referenceId: small.id, kind: LedgerKind.REFERRAL_COMMISSION });
  expect((await prisma.investment.findMany({ where: { userId: small.id } })).map(row => row.planCode)).toEqual(['INV110']);
  expect(await balance(`USER:${small.id}:USDC:OVERFLOW`)).toBe(0n);
  expect(await balance(`USER:${small.id}:USDC:AVAILABLE`)).toBe(10_000_000n);
});

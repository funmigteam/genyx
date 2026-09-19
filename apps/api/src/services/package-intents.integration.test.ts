import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma.js';
import { getOrCreatePackageIntent } from './package-intents.js';

const enabled = process.env.GENYX_ISOLATED_TEST_DB === 'true';
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/genyx_integration') throw new Error('Isolated test database required');
}
const integration = enabled ? it : it.skip;
afterAll(async () => { await prisma.$disconnect(); });
const quote = { packageCode: 'BRONZE', expectedAmount: 6000000n, quotedGen: 100n, quotedOwner: 1000000n, quotedBinary: 3250000n, quotedReward: 1750000n, quotedMaxCap: 70000000n };
integration('checkout may reopen concurrently, expire and reopen without counting as a purchase', async () => {
  const user = await prisma.user.create({ data: { telegramId: BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`) } });
  const now = new Date();
  const [first, second] = await Promise.all([getOrCreatePackageIntent(user.id, quote, now), getOrCreatePackageIntent(user.id, quote, now)]);
  expect(first.id).toBe(second.id);
  expect(await prisma.payment.count({ where: { userId: user.id } })).toBe(1);
  const reopened = await getOrCreatePackageIntent(user.id, { ...quote, expectedAmount: 11000000n }, now);
  expect(reopened.expectedAmount).toBe(6000000n);
  const later = new Date(now.getTime() + 31 * 60000);
  const fresh = await getOrCreatePackageIntent(user.id, quote, later);
  expect(fresh.id).not.toBe(first.id);
  await prisma.payment.update({ where: { id: fresh.id }, data: { status: 'CONFIRMED' } });
  await expect(getOrCreatePackageIntent(user.id, quote, later)).rejects.toThrow('confirmed');
});
integration('submitted expired payment is protected and confirmed elite can be bought again', async () => {
  const user = await prisma.user.create({ data: { telegramId: BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`) } });
  const now = new Date();
  const first = await getOrCreatePackageIntent(user.id, quote, now);
  await prisma.payment.update({ where: { id: first.id }, data: { chainTxHash: randomUUID() } });
  await expect(getOrCreatePackageIntent(user.id, quote, new Date(now.getTime() + 31 * 60000))).rejects.toThrow('verified');
  const elite = await getOrCreatePackageIntent(user.id, { ...quote, packageCode: 'DIAMOND' }, now);
  await prisma.payment.update({ where: { id: elite.id }, data: { status: 'CONFIRMED' } });
  expect((await getOrCreatePackageIntent(user.id, { ...quote, packageCode: 'DIAMOND' }, now)).id).not.toBe(elite.id);
});

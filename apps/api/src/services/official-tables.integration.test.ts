import { afterAll, expect, it } from 'vitest';
import { prisma } from '../prisma.js';
import { applyEconomicsUpdate, applyOfficialTables } from './official-tables.js';
import { DEFAULT_TERMS_TEXT } from './terms.js';

const enabled = process.env.GENYX_ISOLATED_TEST_DB === 'true';
if (enabled) { const url = new URL(process.env.DATABASE_URL ?? ''); if (url.hostname !== '127.0.0.1' || url.pathname !== '/genyx_integration') throw new Error('Isolated database required'); }
const integration = enabled ? it : it.skip;
afterAll(() => prisma.$disconnect());

integration('applies the official tables once, keeping prices and later admin edits', async () => {
  await prisma.systemSetting.deleteMany({ where: { key: { in: ['migration:official-tables-2026-10', 'package_prices', 'terms_text'] } } });
  await prisma.systemSetting.create({ data: { key: 'package_prices', value: [
    { code: 'SILVER', active: true, economicUsdc: '33', gen: 310, maxCapUsdt: '210', title: 'BASIC', description: 'kept' },
    { code: 'DIAMOND', active: true, economicUsdc: '1100', gen: 10400, title: 'ELITE' },
  ] } });
  await prisma.systemSetting.create({ data: { key: 'terms_text', value: 'old terms' } });
  await prisma.task.upsert({ where: { rankOrder: 1 }, update: { targetValue: 3, rewardUsdt: 2_000_000n }, create: { rankOrder: 1, title: 'SPARK', startsAt: new Date(), kind: 'CYCLES_REACHED', targetValue: 3, rewardUsdt: 2_000_000n, isDaily: false, status: 'PUBLISHED' } });
  const describe = (cycles: number, reward: number) => `${cycles}:${reward}:${Math.floor(cycles / 6)}`;

  await applyOfficialTables(describe);
  const catalog = (await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'package_prices' } })).value as any[];
  expect(catalog[0]).toMatchObject({ code: 'SILVER', title: 'SILVER', gen: 310, maxCapUsdt: '200', economicUsdc: '33', description: 'kept' });
  expect(catalog[1]).toMatchObject({ code: 'DIAMOND', title: 'PRO PLUS', gen: 10300, maxCapUsdt: '7000' });
  expect(await prisma.task.findUniqueOrThrow({ where: { rankOrder: 1 } })).toMatchObject({ description: '3:2:0' });
  expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'terms_text' } })).value).toBe(DEFAULT_TERMS_TEXT);

  // An administrator edit made afterwards survives every later boot.
  await prisma.systemSetting.update({ where: { key: 'terms_text' }, data: { value: 'admin edit' } });
  await applyOfficialTables(describe);
  expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'terms_text' } })).value).toBe('admin edit');
});

integration('retires the promotion and SPARK, renumbering ranks from RISE by name', async () => {
  await prisma.systemSetting.deleteMany({ where: { key: { in: ['migration:economics-2026-10b', 'package_prices'] } } });
  await prisma.systemSetting.create({ data: { key: 'package_prices', value: [
    { code: 'BRONZE', active: true, economicUsdc: '6', gen: 100, discountPercent: 50, description: 'kept' },
    { code: 'GOLD', active: true, economicUsdc: '60', gen: 1030 },
  ] } });
  // Old layout: SPARK at 1, RISE at 2 — and an admin edit swapped WARRIOR's copy.
  await prisma.task.updateMany({ where: { rankOrder: { not: null } }, data: { rankOrder: null } });
  const old = ['SPARK', 'RISE', 'WARRIOR'];
  for (const [index, name] of old.entries())
    await prisma.task.create({ data: { rankOrder: index + 1, title: `${name} · edited`, startsAt: new Date(), kind: 'CYCLES_REACHED', targetValue: 1, rewardUsdt: 1n, isDaily: false, status: 'PUBLISHED' } });
  const user = await prisma.user.create({ data: { telegramId: BigInt(Date.now()) } });
  const rise = await prisma.task.findUniqueOrThrow({ where: { rankOrder: 2 } });
  await prisma.taskClaim.create({ data: { taskId: rise.id, userId: user.id, claimKey: 'once', settledAt: new Date() } });

  await applyEconomicsUpdate((cycles, reward) => `${cycles}:${reward}`);
  const catalog = (await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'package_prices' } })).value as any[];
  expect(catalog[0]).toMatchObject({ code: 'BRONZE', economicUsdc: '11', description: 'kept' });
  expect(catalog[0].discountPercent).toBeUndefined();
  expect(catalog[1]).toMatchObject({ economicUsdc: '110' });
  const ranks = await prisma.task.findMany({ where: { rankOrder: { not: null } }, orderBy: { rankOrder: 'asc' } });
  expect(ranks.map(task => task.title.split(' ')[0])).toEqual(['RISE', 'WARRIOR', 'ALPHA', 'NOBLE', 'VANGUARD', 'SOVEREIGN', 'ARCHON', 'ASCENDANT', 'TITAN', 'LEGACY', 'ETERNAL']);
  expect(ranks[0]).toMatchObject({ id: rise.id, targetValue: 10, rewardUsdt: 10_000_000n, description: '10:10' });
  expect(ranks[10]).toMatchObject({ targetValue: 1_000_000, rewardUsdt: 1_000_000_000_000n });
  expect((await prisma.task.findFirstOrThrow({ where: { title: 'SPARK · edited' } })).status).toBe('ARCHIVED');
  // The member who claimed RISE keeps it and is now level 1.
  const { rankLevel } = await import('./ranks.js');
  expect(await rankLevel(prisma, user.id)).toBe(1);
  // Runs once.
  await prisma.task.update({ where: { id: rise.id }, data: { title: 'RISE · admin' } });
  await applyEconomicsUpdate((cycles, reward) => `${cycles}:${reward}`);
  expect((await prisma.task.findUniqueOrThrow({ where: { id: rise.id } })).title).toBe('RISE · admin');
});

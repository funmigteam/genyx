import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { PACKAGE_RULES } from '../domain/economics-v2.js';
import { RANKS } from '../domain/ranks.js';
import { packageCatalogInput } from '../domain/package-catalog.js';
import { DEFAULT_TERMS_TEXT } from './terms.js';

const MIGRATION_KEY = 'migration:official-tables-2026-10';

/**
 * Applies the October 2026 official tables once to data that boot seeding
 * deliberately never overwrites: the saved package catalog (titles, GEN and
 * Max Cap; prices, discounts and copy are kept), rank copy and the Terms
 * text. Later administrator edits are preserved because this runs only once.
 */
export async function applyOfficialTables(rankDescription: (cycles: number, reward: number) => string, lotteryPackDescription: (series: string) => string = () => '') {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(718293)`;
    if (await tx.systemSetting.findUnique({ where: { key: MIGRATION_KEY } })) return;
    const saved = await tx.systemSetting.findUnique({ where: { key: 'package_prices' } });
    if (saved) {
      const catalog = packageCatalogInput.parse(saved.value).map(item => {
        const rule = PACKAGE_RULES.find(entry => entry.code === item.code);
        return rule ? { ...item, title: rule.title, gen: Number(rule.gen), maxCapUsdt: String(rule.maxCap) } : item;
      });
      await tx.systemSetting.update({ where: { key: 'package_prices' }, data: { value: catalog as Prisma.InputJsonValue } });
    }
    for (const rank of await tx.task.findMany({ where: { rankOrder: { not: null } } }))
      if (rank.targetValue !== null && rank.rewardUsdt !== null)
        await tx.task.update({ where: { id: rank.id }, data: { description: rankDescription(rank.targetValue, Number(rank.rewardUsdt / 1_000_000n)) } });
    for (const series of ['A', 'B', 'C'])
      await tx.shopItem.updateMany({ where: { sku: `LOTTERY_PACK_${series}` }, data: { description: lotteryPackDescription(series) } });
    if (await tx.systemSetting.findUnique({ where: { key: 'terms_text' } }))
      await tx.systemSetting.update({ where: { key: 'terms_text' }, data: { value: DEFAULT_TERMS_TEXT } });
    await tx.systemSetting.create({ data: { key: MIGRATION_KEY, value: new Date().toISOString() } });
    await tx.auditEvent.create({ data: { action: 'OFFICIAL_TABLES_APPLIED', entityType: 'SystemSetting', entityId: MIGRATION_KEY } });
  });
}

const ECONOMICS_KEY = 'migration:economics-2026-10b';

/**
 * October 2026 (b): the 50% promotion is retired, so every package sells at
 * its official price ($11 = 1 Fixed Cycle); SPARK is removed and the ranks
 * start at RISE (level 1) through ETERNAL (level 11). Runs once.
 */
export async function applyEconomicsUpdate(rankDescription: (cycles: number, reward: number) => string) {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(718293)`;
    if (await tx.systemSetting.findUnique({ where: { key: ECONOMICS_KEY } })) return;
    const saved = await tx.systemSetting.findUnique({ where: { key: 'package_prices' } });
    if (saved) {
      const catalog = packageCatalogInput.parse(saved.value).map(({ discountPercent: _discount, ...item }) => {
        const rule = PACKAGE_RULES.find(entry => entry.code === item.code);
        return rule ? { ...item, economicUsdc: String(rule.base + rule.owner) } : item;
      });
      await tx.systemSetting.update({ where: { key: 'package_prices' }, data: { value: catalog as Prisma.InputJsonValue } });
    }

    // Rank tasks are matched by the rank name at the start of their title, so
    // an administrator's edits to order or copy cannot misplace a rank.
    const existing = await tx.task.findMany({ where: { OR: [{ rankOrder: { not: null } }, { kind: 'CYCLES_REACHED' }] }, orderBy: { createdAt: 'asc' } });
    const nameOf = (title: string) => title.trim().split(/[\s·]+/)[0]?.toUpperCase() ?? '';
    await tx.task.updateMany({ where: { rankOrder: { not: null } }, data: { rankOrder: null } });
    const archived: string[] = [];
    for (const task of existing.filter(row => nameOf(row.title) === 'SPARK')) {
      await tx.task.update({ where: { id: task.id }, data: { status: 'ARCHIVED' } });
      archived.push(task.id);
    }
    for (const [index, rank] of RANKS.entries()) {
      const data = {
        rankOrder: index + 1, kind: 'CYCLES_REACHED' as const, isDaily: false, dayNumber: null, status: 'PUBLISHED' as const,
        title: `${rank.name} · ${rank.cycles.toLocaleString('en-US')} Fixed Cycles`,
        description: rankDescription(rank.cycles, rank.rewardUsdt),
        targetValue: rank.cycles, rewardUsdt: BigInt(rank.rewardUsdt) * 1_000_000n,
      };
      // Prefer the task that was already a rank over a same-named ordinary task.
      const matches = existing.filter(row => nameOf(row.title) === rank.name && !archived.includes(row.id));
      const task = matches.find(row => row.rankOrder !== null) ?? matches[0];
      if (task) await tx.task.update({ where: { id: task.id }, data });
      else await tx.task.create({ data: { ...data, startsAt: new Date() } });
    }
    await tx.systemSetting.create({ data: { key: ECONOMICS_KEY, value: new Date().toISOString() } });
    await tx.auditEvent.create({ data: { action: 'ECONOMICS_UPDATE_APPLIED', entityType: 'SystemSetting', entityId: ECONOMICS_KEY, after: { archivedSpark: archived } } });
  });
}

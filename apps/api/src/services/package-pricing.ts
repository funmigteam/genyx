import { prisma } from '../prisma.js';
import { PACKAGE_RULES } from '../domain/economics-v2.js';
import { packageCatalogInput } from '../domain/package-catalog.js';
import { parseUsdt, formatUsdt } from '../domain/money.js';

/** The 50% opening promotion has been retired: packages sell at full price. */
export function openingActive(_start?: unknown, _extraDays?: number, _now = new Date()) {
  return false;
}
export function discountedPrice(full: bigint, owner: bigint, opening: boolean) {
  if (full <= owner) throw new Error('Package price must exceed owner allocation');
  return owner + (opening ? (full - owner) / 2n : full - owner);
}
export async function readPackagePricing(discount = true) {
  const settings = await prisma.systemSetting.findMany({ where: { key: { in: ['package_prices', 'opening_started_at', 'opening_extra_days'] } } });
  const value = (key: string) => settings.find(s => s.key === key)?.value;
  const opening = openingActive(value('opening_started_at'), Number(value('opening_extra_days') ?? 0));
  const catalog = packageCatalogInput.parse(value('package_prices') ?? PACKAGE_RULES.map(rule => ({ code: rule.code, title: rule.title, economicUsdc: String(rule.base + rule.owner), gen: Number(rule.gen) })));
  return catalog.filter(item => !discount || item.active).map(item => {
    const rule = PACKAGE_RULES.find(r => r.code === item.code);
    if (!rule) throw new Error('Package has no approved financial rule');
    const full = parseUsdt(item.economicUsdc);
    const percent = item.discountPercent ?? 0;
    const owner = rule.owner * 1000000n;
    if(full<=owner)throw new Error('Package price must exceed owner allocation');
    const price = discount ? owner + (full-owner)*BigInt(100-percent)/100n : full;
    return { ...item, title: item.title || rule.title, maxCapUsdt: item.maxCapUsdt ?? String(rule.maxCap), fixedCycles: rule.fixedCycles, appliedDiscountPercent: discount ? percent : 0, regularUsdc: formatUsdt(full), economicUsdc: formatUsdt(price), opening: discount && opening };
  });
}

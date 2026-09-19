import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma.js';
import { assignSponsor, referralChildren } from './referral-tree.js';
import { profileStats } from './community.js';
const enabled = process.env.GENYX_ISOLATED_TEST_DB === 'true';
if (enabled) { const url = new URL(process.env.DATABASE_URL ?? ''); if (url.hostname !== '127.0.0.1' || url.pathname !== '/genyx_integration') throw new Error('Isolated database required'); }
const integration = enabled ? it : it.skip;
afterAll(() => prisma.$disconnect());
const user = () => prisma.user.create({ data: { telegramId: BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)), referralCode: randomUUID() } });
integration('referral branches include descendants but reject outsiders and prevent cycles', async () => {
  const root = await user(), child = await user(), grandchild = await user(), outsider = await user();
  await assignSponsor(child.id, root.referralCode!);
  await assignSponsor(grandchild.id, child.referralCode!);
  expect((await referralChildren(root.id)).rows.map(r => r.id)).toEqual([child.id]);
  expect((await referralChildren(root.id, child.id)).rows.map(r => r.id)).toEqual([grandchild.id]);
  expect((await profileStats(root.id)).team).toBe(2n);
  await expect(referralChildren(outsider.id, root.id)).rejects.toThrow('not in your');
  await expect(assignSponsor(root.id, grandchild.referralCode!)).rejects.toThrow('ancestry');
  expect((await assignSponsor(child.id, outsider.referralCode!)).referredById).toBe(root.id);
});
integration('direct entrants remain unassigned without a referral code', async () => {
  const admin = await user(); await prisma.user.update({ where: { id: admin.id }, data: { role: 'SUPER_ADMIN' } });
  const entrant = await user();
  expect((await assignSponsor(entrant.id)).referredById).toBeNull();
  const positioned = await user(); await prisma.binaryPosition.create({ data: { userId: positioned.id } });
  expect((await assignSponsor(positioned.id)).referredById).toBeNull();
});

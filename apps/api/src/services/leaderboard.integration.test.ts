import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Task } from '@prisma/client';
import { prisma } from '../prisma.js';
import { leaderboard } from './community.js';

const enabled = process.env.GENYX_ISOLATED_TEST_DB === 'true';
if (enabled) { const url = new URL(process.env.DATABASE_URL ?? ''); if (url.hostname !== '127.0.0.1' || url.pathname !== '/genyx_integration') throw new Error('Isolated database required'); }
const integration = enabled ? it : it.skip;
afterAll(() => prisma.$disconnect());

integration('a member sees their own rank and every rank below, never above', async () => {
  const ranks: Task[] = [];
  for (const order of [1, 2]) {
    ranks.push(await prisma.task.findUnique({ where: { rankOrder: order } }) ?? await prisma.task.create({ data: { rankOrder: order, title: `R${order}`, kind: 'CYCLES_REACHED', startsAt: new Date(), status: 'PUBLISHED' } }));
  }
  const member = async (level: number) => {
    const user = await prisma.user.create({ data: { telegramId: BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)), activePackageCode: 'BRONZE' } });
    for (const task of ranks.slice(0, level)) await prisma.taskClaim.create({ data: { taskId: task.id, userId: user.id, claimKey: 'once', settledAt: new Date() } });
    return user;
  };
  const [zero, one, two] = [await member(0), await member(1), await member(2)];
  const board = await leaderboard(one.id);
  expect(board.organizationalRank).toBe(1);
  expect(board.groups.map(group => group.level)).toEqual([1, 0]);
  expect(board.groups[0].rows.some(row => row.isMe)).toBe(true);
  // Unranked members are listed below (top 100 by income); ranked ones never are.
  expect(board.groups[1].members).toBeGreaterThanOrEqual(1);
  expect(board.groups[1].rows.some(row => row.userId === one.id || row.userId === two.id)).toBe(false);
  expect((await leaderboard(zero.id)).groups.map(group => group.level)).toEqual([0]);
  expect(board.groups.flatMap(group => group.rows).some(row => row.userId === two.id)).toBe(false);
  expect((await leaderboard(two.id)).groups.map(group => group.level)).toEqual([2, 1, 0]);
});

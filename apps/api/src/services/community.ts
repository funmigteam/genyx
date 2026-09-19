import { prisma } from '../prisma.js';
import { levelForXp } from '../domain/progression.js';
import { checkChannelMembership } from './task-verification.js';
import { binaryCyclePolicy } from '../domain/economics-v2.js';
import { openingActive } from './package-pricing.js';

export async function profileStats(userId: string) {
  const [user, position, season, nodes, direct, receipts, team, cycleSettings] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.binaryPosition.findUnique({ where: { userId } }),
    prisma.seasonEnrollment.findFirst({ where: { userId, currentDay: { gt: 0 } }, orderBy: { season: 'desc' } }),
    prisma.payment.count({ where: { userId, purpose: 'PACKAGE', status: 'CONFIRMED' } }),
    prisma.user.count({ where: { referredById: userId, role: 'USER', activePackageCode: { not: null } } }),
    prisma.binaryReceipt.aggregate({ where: { userId }, _sum: { vouchers: true, credited: true } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`WITH RECURSIVE tree AS (
      SELECT id, ARRAY[id] AS path FROM "User" WHERE "referredById" = ${userId}
      UNION ALL SELECT p.id, tree.path || p.id FROM "User" p JOIN tree ON p."referredById" = tree.id WHERE p.role = 'USER' AND NOT p.id = ANY(tree.path)
    ) SELECT count(*) FROM tree JOIN "User" member ON member.id = tree.id WHERE member."activePackageCode" IS NOT NULL`,
    prisma.systemSetting.findMany({ where: { key: { in: ['opening_started_at', 'opening_extra_days'] } } }),
  ]);
  const setting = (key: string) => cycleSettings.find(row => row.key === key)?.value;
  const cycle = binaryCyclePolicy(openingActive(setting('opening_started_at'), Number(setting('opening_extra_days') ?? 0)));
  // Lifetime volumes are intentionally exposed to members: settlements consume
  // the operational balance, but the team volume history must never decrease.
  return { displayName: user.displayName || user.firstName || 'GENYX', shareCode: user.referralCode, publicProfile: user.publicProfile, nodes, direct, team: team[0]?.count ?? 0n, maxCap: user.maxCap, capConsumed: user.capConsumed, level: levelForXp(user.xp).level, season: season?.season ?? 0, day: season?.currentDay ?? 0, leftVolume: position?.leftLifetime ?? 0n, rightVolume: position?.rightLifetime ?? 0n, pendingLeftVolume: position?.leftVolume ?? 0n, pendingRightVolume: position?.rightVolume ?? 0n, leftLifetime: position?.leftLifetime ?? 0n, rightLifetime: position?.rightLifetime ?? 0n, cycles: (position?.slots ?? 0n) - BigInt(receipts._sum.vouchers ?? 0), vouchers: user.vouchers, commission: receipts._sum.credited ?? 0n, cycleVolume: cycle.cycleVolume, cycleReward: cycle.cycleReward };
}

export async function checkRequiredChannels(userId: string, token: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const channels = await prisma.requiredChannel.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  const rows = [];
  for (const channel of channels) {
    const verified = await checkChannelMembership(token, channel.chatId, user.telegramId);
    await prisma.channelMembership.upsert({ where: { userId_channelId: { userId, channelId: channel.id } }, create: { userId, channelId: channel.id, verifiedAt: verified ? new Date() : null }, update: { verifiedAt: verified ? new Date() : null } });
    rows.push({ title: channel.title, inviteUrl: channel.inviteUrl, verified });
  }
  return { verified: rows.every(row => row.verified), channels: rows };
}

export async function leaderboard(userId: string) {
  // Commission means actual USDT binary credits, not referral count or GEN.
  const ranking = await prisma.$queryRaw<Array<{ userId: string; amount: bigint; rank: bigint }>>`WITH totals AS (SELECT u.id AS "userId", COALESCE(SUM(b.credited),0)::bigint AS amount FROM "User" u LEFT JOIN "BinaryReceipt" b ON b."userId"=u.id GROUP BY u.id) SELECT "userId",amount,RANK() OVER (ORDER BY amount DESC) AS rank FROM totals ORDER BY amount DESC,"userId"`;
  const top = ranking.slice(0, 100);
  const users = await prisma.user.findMany({ where: { id: { in: top.map(row => row.userId) } }, select: { id: true, displayName: true, firstName: true, publicProfile: true, referralCode: true } });
  return { me: ranking.find(row => row.userId === userId) ?? null, rows: top.map(row => { const user = users.find(u => u.id === row.userId); return { rank: row.rank, amount: row.amount, name: user?.publicProfile ? user.displayName || user.firstName || 'GENYX' : 'GENYX user', shareCode: user?.publicProfile ? user.referralCode : null }; }) };
}

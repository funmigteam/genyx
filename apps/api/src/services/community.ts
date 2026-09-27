import { prisma } from "../prisma.js";
import { levelForXp } from "../domain/progression.js";
import { checkChannelMembership } from "./task-verification.js";
import { binaryCyclePolicy } from "../domain/economics-v2.js";
import { openingActive } from "./package-pricing.js";

export async function profileStats(userId: string) {
  const [user, position, season, nodes, direct, receipts, team, cycleSettings] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.binaryPosition.findUnique({ where: { userId } }),
      prisma.seasonEnrollment.findFirst({
        where: { userId, currentDay: { gt: 0 } },
        orderBy: { season: "desc" },
      }),
      prisma.payment.count({
        where: { userId, purpose: "PACKAGE", status: "CONFIRMED" },
      }),
      prisma.user.count({
        where: {
          referredById: userId,
          role: "USER",
          activePackageCode: { not: null },
        },
      }),
      prisma.binaryReceipt.aggregate({
        where: { userId },
        _sum: { vouchers: true, credited: true },
      }),
      prisma.$queryRaw<Array<{ count: bigint }>>`WITH RECURSIVE tree AS (
      SELECT id, ARRAY[id] AS path FROM "User" WHERE "referredById" = ${userId}
      UNION ALL SELECT p.id, tree.path || p.id FROM "User" p JOIN tree ON p."referredById" = tree.id WHERE p.role = 'USER' AND NOT p.id = ANY(tree.path)
    ) SELECT count(*) FROM tree JOIN "User" member ON member.id = tree.id WHERE member."activePackageCode" IS NOT NULL`,
      prisma.systemSetting.findMany({
        where: { key: { in: ["opening_started_at", "opening_extra_days"] } },
      }),
    ]);
  const setting = (key: string) =>
    cycleSettings.find((row) => row.key === key)?.value;
  const cycle = binaryCyclePolicy(
    openingActive(
      setting("opening_started_at"),
      Number(setting("opening_extra_days") ?? 0),
    ),
  );
  // Lifetime volumes are intentionally exposed to members: settlements consume
  // the operational balance, but the team volume history must never decrease.
  return {
    displayName: user.displayName || user.firstName || "GENYX",
    shareCode: user.referralCode,
    publicProfile: user.publicProfile,
    nodes,
    direct,
    team: team[0]?.count ?? 0n,
    maxCap: user.maxCap,
    capConsumed: user.capConsumed,
    level: levelForXp(user.xp).level,
    season: season?.season ?? 0,
    day: season?.currentDay ?? 0,
    leftVolume: position?.leftLifetime ?? 0n,
    rightVolume: position?.rightLifetime ?? 0n,
    pendingLeftVolume: position?.leftVolume ?? 0n,
    pendingRightVolume: position?.rightVolume ?? 0n,
    leftLifetime: position?.leftLifetime ?? 0n,
    rightLifetime: position?.rightLifetime ?? 0n,
    cycles: (position?.slots ?? 0n) - BigInt(receipts._sum.vouchers ?? 0),
    vouchers: user.vouchers,
    commission: receipts._sum.credited ?? 0n,
    cycleVolume: cycle.cycleVolume,
    cycleReward: cycle.cycleReward,
  };
}

export async function checkRequiredChannels(userId: string, token: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const channels = await prisma.requiredChannel.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });
  const rows = [];
  for (const channel of channels) {
    const verified = await checkChannelMembership(
      token,
      channel.chatId,
      user.telegramId,
    );
    await prisma.channelMembership.upsert({
      where: { userId_channelId: { userId, channelId: channel.id } },
      create: {
        userId,
        channelId: channel.id,
        verifiedAt: verified ? new Date() : null,
      },
      update: { verifiedAt: verified ? new Date() : null },
    });
    rows.push({ title: channel.title, inviteUrl: channel.inviteUrl, verified });
  }
  return { verified: rows.every((row) => row.verified), channels: rows };
}

export async function leaderboard(userId: string) {
  const [rankTasks, claims] = await Promise.all([
    prisma.task.findMany({
      where: { rankOrder: { not: null } },
      select: { id: true, rankOrder: true, title: true },
    }),
    prisma.taskClaim.findMany({
      where: { settledAt: { not: null }, task: { rankOrder: { not: null } } },
      select: { userId: true, task: { select: { rankOrder: true } } },
    }),
  ]);
  const myRank = Math.max(
    0,
    ...claims
      .filter((claim) => claim.userId === userId)
      .map((claim) => claim.task.rankOrder ?? 0),
  );
  const rankTitle =
    rankTasks.find((task) => task.rankOrder === myRank)?.title ?? "UNRANKED";
  const sameRankIds = [
    ...new Set(
      claims
        .filter((claim) => (claim.task.rankOrder ?? 0) === myRank)
        .map((claim) => claim.userId),
    ),
  ];
  if (myRank === 0) sameRankIds.push(userId);
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(sameRankIds)] } },
    select: {
      id: true,
      displayName: true,
      firstName: true,
      publicProfile: true,
      referralCode: true,
      accounts: {
        where: { currency: "USDC", type: "AVAILABLE" },
        select: {
          entries: {
            where: {
              credit: { gt: 0 },
              transaction: {
                kind: {
                  in: [
                    "BINARY_COMMISSION",
                    "DAILY_GIFT",
                    "SEASON_REWARD",
                    "LOTTERY_PRIZE",
                  ],
                },
              },
            },
            select: { credit: true },
          },
        },
      },
    },
  });
  const rows = users
    .map((user) => ({
      userId: user.id,
      amount: user.accounts
        .flatMap((account) => account.entries)
        .reduce((sum, entry) => sum + entry.credit, 0n),
      name: user.publicProfile
        ? user.displayName || user.firstName || "GENYX user"
        : "GENYX user",
      shareCode: user.publicProfile ? user.referralCode : null,
    }))
    .sort((first, second) =>
      second.amount > first.amount
        ? 1
        : second.amount < first.amount
          ? -1
          : first.userId.localeCompare(second.userId),
    )
    .slice(0, 100)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  return {
    me: rows.find((row) => row.userId === userId) ?? { rank: null },
    organizationalRank: myRank,
    organizationalTitle: rankTitle,
    rows,
  };
}

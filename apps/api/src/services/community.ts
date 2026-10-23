import { prisma } from "../prisma.js";
import { rankLevel, rankLevels } from "./ranks.js";
import { rankName } from "../domain/ranks.js";
import { checkChannelMembership } from "./task-verification.js";
import { binaryCyclePolicy } from "../domain/economics-v2.js";
import { openingActive } from "./package-pricing.js";
import { DIRECT_REFERRAL_CYCLE_COMMISSION } from "./direct-referral.js";

/** USDT held to pay member rewards: binary cycles and rank/referral rewards. */
async function payoutPool() {
  const codes = ["SYSTEM:USDC:BINARY", "SYSTEM:USDC:REWARD"];
  const rows = await prisma.$queryRaw<Array<{ code: string; balance: bigint }>>`
    SELECT a.code, COALESCE(SUM(e.credit - e.debit), 0)::bigint AS balance
    FROM "LedgerAccount" a LEFT JOIN "LedgerEntry" e ON e."accountId" = a.id
    WHERE a.code = ANY(${codes}) GROUP BY a.code`;
  const of = (code: string) => rows.find((row) => row.code === code)?.balance ?? 0n;
  const binary = of(codes[0]), reward = of(codes[1]);
  return { binary, reward, total: binary + reward };
}

export async function profileStats(userId: string) {
  const [user, position, nodes, direct, receipts, team, cycleSettings] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.binaryPosition.findUnique({ where: { userId } }),
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
  const level = await rankLevel(prisma, user.id);
  const activeInvestments = await prisma.investment.findMany({ where: { userId, status: "ACTIVE" }, select: { maxCap: true, valueConsumed: true } });
  const investmentCaps = activeInvestments.reduce((sum, row) => ({ maxCap: sum.maxCap + row.maxCap, used: sum.used + row.valueConsumed }), { maxCap: 0n, used: 0n });
  const directReceipts = await prisma.rewardReceipt.aggregate({
    where: { userId, idempotencyKey: { startsWith: "direct-referral:" } },
    _sum: { requested: true, credited: true },
    _count: { _all: true },
  });
  return {
    // Direct Referral Cycle Commission: 0.5 USDT per cycle of each direct
    // referral's first purchase. Cycles count what was earned, even if part
    // was above the Max Cap.
    directReferral: {
      purchases: directReceipts._count._all,
      cycles: (directReceipts._sum.requested ?? 0n) / DIRECT_REFERRAL_CYCLE_COMMISSION,
      commission: directReceipts._sum.credited ?? 0n,
      perCycle: DIRECT_REFERRAL_CYCLE_COMMISSION,
    },
    // The payout pool is shown from RISE (level 1) upward.
    payoutPool: level >= 1 ? await payoutPool() : null,
    displayName: user.displayName || user.firstName || "GENYX",
    shareCode: user.referralCode,
    publicProfile: user.publicProfile,
    nodes,
    direct,
    team: team[0]?.count ?? 0n,
    // Total Max Cap = token package + every active investment pack.
    maxCap: user.maxCap + investmentCaps.maxCap,
    capConsumed: user.capConsumed + investmentCaps.used,
    level,
    rank: rankName(level),
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

const LEADERBOARD_INCOME = ["BINARY_COMMISSION", "DAILY_GIFT", "SEASON_REWARD", "LOTTERY_PRIZE"];

/**
 * Rank leaderboards a member may see: their own rank and every rank below it
 * (levels 0…their level). Within each rank, members are ordered by credited
 * USDT income. Higher ranks stay hidden.
 */
export async function leaderboard(userId: string) {
  const myRank = await rankLevel(prisma, userId);
  const members = await prisma.user.findMany({
    where: { OR: [{ id: userId }, { role: "USER", activePackageCode: { not: null } }] },
    select: { id: true, displayName: true, firstName: true, publicProfile: true, referralCode: true },
  });
  const levels = await rankLevels(prisma, members.map((member) => member.id));
  const visible = members.filter((member) => (levels.get(member.id) ?? 0) <= myRank);
  const income = new Map(
    (visible.length
      ? await prisma.$queryRaw<Array<{ userId: string; amount: bigint }>>`
        SELECT a."userId", COALESCE(SUM(e.credit), 0)::bigint AS amount
        FROM "LedgerEntry" e
        JOIN "LedgerAccount" a ON a.id = e."accountId"
        JOIN "LedgerTransaction" t ON t.id = e."transactionId"
        WHERE a."userId" = ANY(${visible.map((member) => member.id)})
          AND a.currency = 'USDC' AND a.type = 'AVAILABLE' AND e.credit > 0
          AND t.kind::text = ANY(${LEADERBOARD_INCOME})
        GROUP BY a."userId"`
      : []
    ).map((row) => [row.userId, row.amount]),
  );
  const groups = Array.from({ length: myRank + 1 }, (_, index) => myRank - index).map((level) => {
    const atLevel = visible.filter((member) => (levels.get(member.id) ?? 0) === level);
    const rows = atLevel
      .map((member) => ({
        userId: member.id,
        amount: income.get(member.id) ?? 0n,
        name: member.publicProfile ? member.displayName || member.firstName || "GENYX user" : "GENYX user",
        shareCode: member.publicProfile ? member.referralCode : null,
      }))
      .sort((first, second) =>
        second.amount > first.amount ? 1 : second.amount < first.amount ? -1 : first.userId.localeCompare(second.userId),
      )
      .slice(0, 100)
      .map((row, index) => ({ ...row, rank: index + 1, isMe: row.userId === userId }));
    return { level, rank: rankName(level), members: atLevel.length, rows };
  });
  const own = groups[0];
  return {
    me: own.rows.find((row) => row.isMe) ?? { rank: null },
    organizationalRank: myRank,
    organizationalTitle: rankName(myRank),
    rows: own.rows,
    groups,
  };
}

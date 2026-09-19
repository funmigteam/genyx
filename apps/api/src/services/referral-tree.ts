import { prisma } from '../prisma.js';
import { levelForXp } from '../domain/progression.js';

export async function assignSponsor(userId: string, code?: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(718292)::text`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role !== 'USER') return user;
    // A sponsor is only assigned through an explicit, valid referral code.
    // Never place ordinary entrants below an administrator by default.
    if (!code) return user;
    const requestedSponsor = await tx.user.findUnique({ where: { referralCode: code } });
    if (!requestedSponsor || requestedSponsor.id === userId) return user;

    if (user.referredById) {
      if (!code || user.referredById === requestedSponsor.id) return user;
      // A referral that was assigned by the no-link fallback may be corrected
      // before any package activation or binary placement. This avoids sending
      // a valid ordinary-member referral permanently to the default admin.
      const [currentSponsor, confirmedPayment, position] = await Promise.all([
        tx.user.findUnique({ where: { id: user.referredById }, select: { role: true } }),
        tx.payment.findFirst({ where: { userId, status: 'CONFIRMED' }, select: { id: true } }),
        tx.binaryPosition.findUnique({ where: { userId }, select: { userId: true } })
      ]);
      if (currentSponsor?.role !== 'SUPER_ADMIN' || user.activePackageCode || confirmedPayment || position) return user;
      const corrected = await tx.user.update({ where: { id: userId }, data: { referredById: requestedSponsor.id } });
      await tx.auditEvent.create({ data: { actorId: userId, action: 'DEFAULT_REFERRAL_CORRECTED', entityType: 'User', entityId: userId, before: { sponsorId: user.referredById }, after: { sponsorId: requestedSponsor.id } } });
      return corrected;
    }
    if (await tx.binaryPosition.findUnique({ where: { userId } })) return user;
    const sponsor = requestedSponsor;
    const seen = new Set([userId]);
    let ancestor: string | null = sponsor.id;
    while (ancestor) {
      if (seen.has(ancestor)) throw new Error('Invalid referral ancestry');
      seen.add(ancestor);
      ancestor = (await tx.user.findUniqueOrThrow({ where: { id: ancestor }, select: { referredById: true } })).referredById;
    }
    const result = await tx.user.update({ where: { id: userId }, data: { referredById: sponsor.id } });
    await tx.auditEvent.create({ data: { actorId: userId, action: code ? 'REFERRAL_ASSIGNED' : 'DEFAULT_SPONSOR_ASSIGNED', entityType: 'User', entityId: userId, after: { sponsorId: sponsor.id } } });
    return result;
  });
}

export async function referralChildren(userId: string, parentId = userId, cursor?: string) {
  const allowed = await prisma.$queryRaw<Array<{ id: string }>>`WITH RECURSIVE tree AS (
    SELECT id, ARRAY[id] AS path FROM "User" WHERE id = ${userId}
    UNION ALL SELECT u.id, tree.path || u.id FROM "User" u JOIN tree ON u."referredById" = tree.id WHERE u.role = 'USER' AND NOT u.id = ANY(tree.path)
  ) SELECT id FROM tree WHERE id = ${parentId} LIMIT 1`;
  if (!allowed.length) throw new Error('This member is not in your referral team');
  const rows = await prisma.user.findMany({ where: { referredById: parentId, role: 'USER', activePackageCode: { not: null }, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 51, select: { id: true, referralCode: true, firstName: true, displayName: true, xp: true, activePackageCode: true, _count: { select: { referrals: { where: { role: 'USER', activePackageCode: { not: null } } } } } } });
  return { rows: rows.slice(0, 50).map(row => ({ id: row.id, code: row.referralCode ?? row.id, name: row.displayName || row.firstName || 'GENYX member', level: levelForXp(row.xp).level, active: Boolean(row.activePackageCode), children: row._count.referrals })), next: rows.length > 50 ? rows[49].id : null };
}

export async function binaryLanes(userId: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string; parentId: string | null; side: string | null; depth: number; lane: string | null; code: string | null; name: string | null; packageCode: string | null; direct: boolean }>>`
    WITH RECURSIVE tree AS (
      SELECT p."userId" AS id, p."parentId", p.side, 0 AS depth, NULL::text AS lane, ARRAY[p."userId"] AS path
      FROM "BinaryPosition" p WHERE p."userId" = ${userId}
      UNION ALL
      SELECT child."userId", child."parentId", child.side, tree.depth + 1,
        CASE WHEN tree.depth = 0 THEN child.side ELSE tree.lane END,
        tree.path || child."userId"
      FROM "BinaryPosition" child JOIN tree ON child."parentId" = tree.id
      WHERE NOT child."userId" = ANY(tree.path) AND tree.depth < 40
    )
    SELECT tree.id, tree."parentId", tree.side, tree.depth, tree.lane,
      u."referralCode" AS code, COALESCE(u."displayName", u."firstName", 'GENYX member') AS name,
      u."activePackageCode" AS "packageCode", (u."referredById" = ${userId}) AS direct
    FROM tree JOIN "User" u ON u.id = tree.id
    ORDER BY tree.lane NULLS FIRST, tree.depth, tree.id
  `;
  const map = (lane: 'LEFT' | 'RIGHT') => rows.filter(row => row.lane === lane).slice(0, 100).map(row => ({
    id: row.id, parentId: row.parentId, side: row.side, depth: row.depth, code: row.code ?? row.id,
    name: row.name ?? 'GENYX member', active: Boolean(row.packageCode), direct: row.direct,
  }));
  const root = rows.find(row => row.depth === 0);
  return { root: root ? { id: root.id, code: root.code ?? root.id, name: root.name ?? 'GENYX member' } : null, left: map('LEFT'), right: map('RIGHT') };
}

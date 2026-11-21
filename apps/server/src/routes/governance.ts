import { Router } from 'express';
import { z } from 'zod';
import { requireCap } from '../access/access';
import { audit } from '../lib/audit';
import { db } from '../lib/db';
import { forbidden, notFound, param } from '../lib/http';
import { orgCtx } from './orgs';

/** Support grants (owner lets the platform admin see footage for a while) and the audit log. */
export const governanceRouter = Router();

const GrantBody = z.object({ reason: z.string().trim().min(3).max(500), hours: z.number().int().min(1).max(168).default(24) });

governanceRouter.get('/orgs/:orgId/support-grants', async (req, res) => {
  const { access } = await orgCtx(req);
  if (!access.caps.has('org.owner') && !access.platformAdmin) throw forbidden();
  const grants = await db.supportGrant.findMany({ where: { organizationId: access.organizationId }, orderBy: { createdAt: 'desc' }, take: 50 });
  const now = Date.now();
  res.json({ grants: grants.map((g) => ({ ...g, active: !g.revokedAt && g.expiresAt.getTime() > now })) });
});

governanceRouter.post('/orgs/:orgId/support-grants', async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'org.owner');
  const { reason, hours } = GrantBody.parse(req.body);
  const grant = await db.supportGrant.create({
    data: { organizationId: access.organizationId, grantedById: user.id, reason, expiresAt: new Date(Date.now() + hours * 3600_000) },
  });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'support.grant', targetType: 'support_grant', targetId: grant.id, meta: { hours, reason } });
  res.status(201).json({ grant: { ...grant, active: true } });
});

governanceRouter.post('/orgs/:orgId/support-grants/:grantId/revoke', async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'org.owner');
  const id = param(req, 'grantId');
  const grant = id ? await db.supportGrant.findFirst({ where: { id, organizationId: access.organizationId } }).catch(() => null) : null;
  if (!grant) throw notFound('Grant not found');
  const updated = await db.supportGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'support.revoke', targetType: 'support_grant', targetId: grant.id });
  res.json({ grant: { ...updated, active: false } });
});

const AuditQuery = z.object({
  before: z.string().datetime({ offset: true }).optional(),
  action: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Owners (and the platform admin) read the org's audit log, incl. support footage access. */
governanceRouter.get('/orgs/:orgId/audit', async (req, res) => {
  const { access } = await orgCtx(req);
  if (!access.caps.has('org.owner') && !access.platformAdmin) throw forbidden();
  const q = AuditQuery.parse(req.query);
  const rows = await db.auditLog.findMany({
    where: {
      organizationId: access.organizationId,
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.before ? { at: { lt: new Date(q.before) } } : {}),
    },
    orderBy: { at: 'desc' },
    take: q.limit,
  });
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))] as string[];
  const actors = await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } });
  const byId = new Map(actors.map((a) => [a.id, a]));
  res.json({
    entries: rows.map((r) => ({ ...r, actor: r.actorId ? (byId.get(r.actorId) ?? null) : null })),
    nextBefore: rows.length === q.limit ? rows.at(-1)!.at.toISOString() : null,
  });
});

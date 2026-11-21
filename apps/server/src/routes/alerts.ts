import { AlertStatus, Severity } from '@cctv/shared';
import type { Alert, Event, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { type OrgAccess, UUID, requireCap, scopeWhere } from '../access/access';
import { bus } from '../lib/bus';
import { db } from '../lib/db';
import { badRequest, notFound, param } from '../lib/http';
import { getObject } from '../lib/store';
import { orgCtx } from './orgs';

export const alertsRouter = Router();

const List = z.object({
  siteId: z.string().uuid().optional(),
  cameraKey: z.string().max(48).optional(),
  status: AlertStatus.optional(),
  severity: Severity.optional(),
  /** Cursor: return items created before this ISO time. */
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const snapshotUrl = (orgId: string, e: Pick<Event, 'id' | 'snapshotKey'> | null) =>
  e?.snapshotKey ? `/api/orgs/${orgId}/events/${e.id}/snapshot` : null;

export function alertView(orgId: string, a: Alert & { event?: Event | null; rule?: { name: string } | null }) {
  return {
    id: a.id,
    siteId: a.siteId,
    ruleId: a.ruleId,
    ruleName: a.rule?.name ?? null,
    eventId: a.eventId,
    cameraKey: a.cameraKey,
    severity: a.severity,
    status: a.status,
    title: a.title,
    createdAt: a.createdAt,
    ackedAt: a.ackedAt,
    ackedById: a.ackedById,
    closedAt: a.closedAt,
    notes: a.notes,
    snapshotUrl: snapshotUrl(orgId, a.event ?? null),
    event: a.event
      ? {
          id: a.event.id,
          type: a.event.type,
          ts: a.event.ts,
          payload: a.event.payload,
          face: a.event.type === 'face.observed' ? { personId: a.event.facePersonId, similarity: a.event.faceSimilarity } : null,
        }
      : null,
  };
}

function scoped(access: OrgAccess, q: z.infer<typeof List>) {
  const where: Prisma.AlertWhereInput & Prisma.EventWhereInput = { ...scopeWhere(access) };
  if (q.siteId) {
    if (access.siteIds.length && !access.siteIds.includes(q.siteId)) throw notFound('Site not found');
    where.siteId = q.siteId;
  }
  return where;
}

// ---------------------------------------------------------------- alerts

alertsRouter.get('/orgs/:orgId/alerts', async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'footage.read');
  const q = List.parse(req.query);
  const alerts = await db.alert.findMany({
    where: {
      ...scoped(access, q),
      ...(q.cameraKey ? { cameraKey: q.cameraKey } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
    },
    include: { event: true, rule: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: q.limit,
  });
  const views = alerts.map((a) => alertView(access.organizationId, a));
  res.json({ alerts: views, nextBefore: alerts.length === q.limit ? alerts.at(-1)!.createdAt.toISOString() : null });
});

alertsRouter.get('/orgs/:orgId/alerts/:alertId', async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'footage.read');
  res.json({ alert: alertView(access.organizationId, await loadAlert(access, param(req, 'alertId'))) });
});

const Note = z.object({ text: z.string().trim().min(1).max(2000) });

alertsRouter.post('/orgs/:orgId/alerts/:alertId/:action', async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'alerts.manage');
  const alert = await loadAlert(access, param(req, 'alertId'));
  const action = param(req, 'action');
  const now = new Date();
  let data: Prisma.AlertUpdateInput;
  if (action === 'ack') {
    if (alert.status !== 'OPEN') throw badRequest('Only open alerts can be acknowledged');
    data = { status: 'ACKED', ackedAt: now, ackedById: user.id };
  } else if (action === 'close') {
    if (alert.status === 'CLOSED') throw badRequest('Alert is already closed');
    data = { status: 'CLOSED', closedAt: now, ...(alert.ackedAt ? {} : { ackedAt: now, ackedById: user.id }) };
  } else if (action === 'reopen') {
    data = { status: 'OPEN', closedAt: null };
  } else if (action === 'notes') {
    const { text } = Note.parse(req.body);
    const notes = [...((alert.notes as unknown[]) ?? []), { at: now.toISOString(), byId: user.id, byName: user.name, text }];
    data = { notes: notes as Prisma.InputJsonValue };
  } else {
    throw notFound('Unknown alert action');
  }
  const updated = await db.alert.update({ where: { id: alert.id }, data, include: { event: true, rule: { select: { name: true } } } });
  bus.emit('alert.updated', updated);
  res.json({ alert: alertView(access.organizationId, updated) });
});

// ---------------------------------------------------------------- events + snapshots

alertsRouter.get('/orgs/:orgId/events', async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'footage.read');
  const q = List.extend({ type: z.string().max(40).optional() }).parse(req.query);
  const events = await db.event.findMany({
    where: {
      ...scoped(access, q),
      ...(q.cameraKey ? { cameraKey: q.cameraKey } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.before ? { ts: { lt: new Date(q.before) } } : {}),
    },
    orderBy: { ts: 'desc' },
    take: q.limit,
  });
  res.json({
    events: events.map((e) => ({
      id: e.id,
      siteId: e.siteId,
      cameraKey: e.cameraKey,
      type: e.type,
      ts: e.ts,
      payload: e.payload,
      face: e.type === 'face.observed' ? { personId: e.facePersonId, similarity: e.faceSimilarity } : null,
      snapshotUrl: snapshotUrl(access.organizationId, e),
    })),
    nextBefore: events.length === q.limit ? events.at(-1)!.ts.toISOString() : null,
  });
});

alertsRouter.get('/orgs/:orgId/events/:eventId/snapshot', async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'footage.read');
  const id = param(req, 'eventId');
  const ev = id && UUID.test(id) ? await db.event.findFirst({ where: { id, ...scopeWhere(access) } }) : null;
  const jpeg = ev?.snapshotKey ? await getObject(ev.snapshotKey) : null;
  if (!jpeg) throw notFound('Snapshot not found');
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400, immutable'); // snapshots never change
  res.send(jpeg);
});

async function loadAlert(access: OrgAccess, id: string | undefined) {
  const alert =
    id && UUID.test(id)
      ? await db.alert.findFirst({ where: { id, ...scopeWhere(access) }, include: { event: true, rule: { select: { name: true } } } })
      : null;
  if (!alert) throw notFound('Alert not found');
  return alert;
}

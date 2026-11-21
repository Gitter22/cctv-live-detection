import type { Alert, Event } from '@prisma/client';
import { Router } from 'express';
import { requireCap, siteInScope } from '../access/access';
import { bus } from '../lib/bus';
import { db } from '../lib/db';
import { alertView } from './alerts';
import { orgCtx } from './orgs';

/**
 * GET /api/orgs/:orgId/stream: Server-Sent Events with live updates for the caller's org
 * (respecting site limits):
 *   event: alert.created / alert.updated   data: alert view
 *   event: camera.status                    data: { siteId, cameraKey, online, reason, ts }
 * Browsers reconnect automatically (EventSource); a comment line every 25 s keeps proxies open.
 */
export const streamRouter = Router();

streamRouter.get('/orgs/:orgId/stream', async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'footage.read');
  const orgId = access.organizationId;
  const visible = (siteId: string) => siteInScope(access, siteId);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx: don't buffer
  });
  res.write('retry: 3000\n\n');
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const withEvent = async (a: Alert) =>
    alertView(orgId, { ...a, event: a.eventId ? await db.event.findUnique({ where: { id: a.eventId } }) : null, rule: a.ruleId ? await db.rule.findUnique({ where: { id: a.ruleId }, select: { name: true } }) : null });
  const onCreated = async (a: Alert) => {
    if (a.organizationId === orgId && visible(a.siteId)) send('alert.created', await withEvent(a));
  };
  const onUpdated = async (a: Alert) => {
    if (a.organizationId === orgId && visible(a.siteId)) send('alert.updated', await withEvent(a));
  };
  const onEvent = (e: Event) => {
    if (e.organizationId !== orgId || !visible(e.siteId) || e.type !== 'camera.status') return;
    const st = (e.payload as { status?: { online?: boolean; reason?: string | null } }).status;
    send('camera.status', { siteId: e.siteId, cameraKey: e.cameraKey, online: !!st?.online, reason: st?.reason ?? null, ts: e.ts });
  };

  bus.on('alert.created', onCreated);
  bus.on('alert.updated', onUpdated);
  bus.on('event.ingested', onEvent);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    bus.off('alert.created', onCreated);
    bus.off('alert.updated', onUpdated);
    bus.off('event.ingested', onEvent);
  });
});

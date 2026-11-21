import { EdgeHeartbeat } from '@cctv/shared';
import type { Prisma } from '@prisma/client';
import { Router, json } from 'express';
import { db } from '../lib/db';
import { HttpError, badRequest, param } from '../lib/http';
import { isJpeg, putObject } from '../lib/store';

/** Edge -> server: heartbeat (health) and camera thumbnails (for the zone editor). */
export const healthRouter = Router();

/** An edge that hasn't reported for this long is considered offline. */
export const EDGE_STALE_MS = 90_000;

export const thumbnailKey = (siteId: string, cameraKey: string) => `${siteId}/thumbs/${cameraKey}.jpg`;

healthRouter.post('/heartbeat', json({ limit: '256kb' }), async (req, res) => {
  const hb = EdgeHeartbeat.parse(req.body);
  await db.edge.update({
    where: { id: req.edge!.id },
    data: {
      lastSeenAt: new Date(),
      version: hb.version,
      health: { ...hb, receivedAt: new Date().toISOString() } as Prisma.InputJsonValue,
    },
  });
  res.status(204).end();
});

healthRouter.post('/thumbnails/:cameraKey', json({ limit: '3mb' }), async (req, res) => {
  const key = param(req, 'cameraKey') ?? '';
  const camera = await db.camera.findUnique({ where: { siteId_key: { siteId: req.edge!.siteId, key } }, select: { id: true } });
  if (!camera) throw new HttpError(422, 'Unknown camera for this site', 'unknown_camera');
  const b64 = typeof req.body?.jpeg === 'string' ? req.body.jpeg : '';
  const buf = Buffer.from(b64, 'base64');
  if (!isJpeg(buf)) throw badRequest('Thumbnail is not a JPEG');
  await putObject(thumbnailKey(req.edge!.siteId, key), buf);
  res.status(204).end();
});

export interface CameraStatus {
  online: boolean | null;
  reason: string | null;
  since: string | null;
  /** When the edge reported it. */
  reportedAt: string | null;
}

/** Live status per camera key for a site, from the freshest active edge heartbeat. */
export async function siteCameraStatus(siteId: string): Promise<Record<string, CameraStatus>> {
  const edge = await db.edge.findFirst({
    where: { siteId, status: 'ACTIVE', lastSeenAt: { not: null } },
    orderBy: { lastSeenAt: 'desc' },
  });
  const out: Record<string, CameraStatus> = {};
  const parsed = EdgeHeartbeat.safeParse(edge?.health);
  if (!edge || !parsed.success) return out;
  const fresh = Date.now() - (edge.lastSeenAt?.getTime() ?? 0) < EDGE_STALE_MS;
  const at = edge.lastSeenAt!.toISOString();
  for (const [key, h] of Object.entries(parsed.data.cameras)) {
    out[key] = fresh
      ? { online: h.online, reason: h.reason ?? null, since: h.since ?? null, reportedAt: at }
      : { online: null, reason: 'Edge not reporting', since: null, reportedAt: at };
  }
  return out;
}

/** Live player base URL reported by the site's freshest active edge (null if none / stale). */
export async function siteLiveUrl(siteId: string): Promise<string | null> {
  const edge = await db.edge.findFirst({ where: { siteId, status: 'ACTIVE', lastSeenAt: { not: null } }, orderBy: { lastSeenAt: 'desc' } });
  const hb = EdgeHeartbeat.safeParse(edge?.health);
  if (!edge || !hb.success || Date.now() - (edge.lastSeenAt?.getTime() ?? 0) > EDGE_STALE_MS) return null;
  return hb.data.liveUrl ?? null;
}

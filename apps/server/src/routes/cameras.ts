import {
  CreateCameraBody,
  CreateLineBody,
  CreateZoneBody,
  DETECTION_DEFAULTS,
  DetectionSettings,
  UpdateCameraBody,
  UpdateLineBody,
  UpdateZoneBody,
} from '@cctv/shared';
import type { Camera, Line, Prisma, Source, Zone } from '@prisma/client';
import { Router } from 'express';
import { type OrgAccess, loadSite, requireCap } from '../access/access';
import { edgeHub } from '../edge/control';
import { siteCameraStatus, siteLiveUrl, thumbnailKey } from '../edge/health';
import { env } from '../config/env';
import { z } from 'zod';
import { HttpError } from '../lib/http';
import { audit } from '../lib/audit';
import { db } from '../lib/db';
import { badRequest, conflict, notFound, param } from '../lib/http';
import { getObject } from '../lib/store';
import { vendorPath } from '../lib/rtsp';
import { encryptSecret, redactSecrets } from '../lib/secrets';
import { orgCtx } from './orgs';

export const camerasRouter = Router();

export const cameraSecretCtx = (cameraId: string, field: 'subUrl' | 'mainUrl') => `camera:${cameraId}:${field}`;

type CameraFull = Camera & { zones: Zone[]; lines: Line[] };

export function cameraView(c: CameraFull) {
  const { zones, lines, ...rest } = c;
  return {
    ...redactSecrets(rest as unknown as Record<string, unknown>),
    detection: effectiveDetection(c.detection),
    zones: zones.map(({ id, key, label, polygon }) => ({ id, key, label, polygon })),
    lines: lines.map(({ id, key, label, start, end }) => ({ id, key, label, start, end })),
  };
}

/** Stored detection JSON merged over the defaults. */
export function effectiveDetection(stored: Prisma.JsonValue) {
  return DetectionSettings.parse({ ...DETECTION_DEFAULTS, ...((stored as object | null) ?? {}) });
}

/** Why this camera cannot produce a detection stream, or null if it can. */
export function streamProblem(c: { sourceId: string | null; channel: number | null; subUrlEnc: string | null }, source: Source | null) {
  if (c.subUrlEnc) return null;
  if (!source) return 'Choose a source or enter a stream URL (subUrl)';
  if (source.kind === 'RAW_URL') return null;
  if (!vendorPath(source.vendor, 1, 'sub')) return `Vendor "${source.vendor}" has no URL template: enter a stream URL (subUrl)`;
  if (!c.channel) return 'This source needs a channel number';
  return null;
}

const base = '/orgs/:orgId/sites/:siteId/cameras';
const include = { zones: { orderBy: { key: 'asc' } }, lines: { orderBy: { key: 'asc' } } } as const;

// ---------------------------------------------------------------- cameras

camerasRouter.get(base, async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'config.read');
  const site = await loadSite(access, param(req, 'siteId'));
  const [cameras, status] = await Promise.all([
    db.camera.findMany({ where: { siteId: site.id }, include, orderBy: { key: 'asc' } }),
    siteCameraStatus(site.id),
  ]);
  res.json({ cameras: cameras.map((c) => ({ ...cameraView(c), status: status[c.key] ?? null })) });
});

camerasRouter.post(base, async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const site = await loadSite(access, param(req, 'siteId'));
  const body = CreateCameraBody.parse(req.body);
  const source = body.sourceId ? await loadSiteSource(site.id, body.sourceId) : null;
  const problem = streamProblem({ sourceId: body.sourceId ?? null, channel: body.channel ?? null, subUrlEnc: body.subUrl ?? null }, source);
  if (problem) throw badRequest(problem);
  checkDetection(body.detection);
  if (await db.camera.findUnique({ where: { siteId_key: { siteId: site.id, key: body.key } } })) {
    throw conflict('A camera with this key already exists at this site');
  }

  const camera = await db.$transaction(async (tx) => {
    const c = await tx.camera.create({
      data: {
        organizationId: access.organizationId,
        siteId: site.id,
        key: body.key,
        label: body.label,
        sourceId: body.sourceId ?? null,
        channel: body.channel ?? null,
        enabled: body.enabled,
        tags: body.tags,
        detection: body.detection,
      },
    });
    return tx.camera.update({
      where: { id: c.id },
      data: {
        subUrlEnc: body.subUrl ? encryptSecret(body.subUrl, cameraSecretCtx(c.id, 'subUrl')) : null,
        mainUrlEnc: body.mainUrl ? encryptSecret(body.mainUrl, cameraSecretCtx(c.id, 'mainUrl')) : null,
      },
      include,
    });
  });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'camera.create', targetType: 'camera', targetId: camera.id });
  res.status(201).json({ camera: cameraView(camera) });
});

camerasRouter.get(`${base}/:cameraId`, async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'config.read');
  res.json({ camera: cameraView(await loadCamera(access, param(req, 'siteId'), param(req, 'cameraId'))) });
});

/** Latest still image of the camera (footage: needs footage.read). */
camerasRouter.get(`${base}/:cameraId/thumbnail`, async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'footage.read');
  const cam = await loadCamera(access, param(req, 'siteId'), param(req, 'cameraId'));
  const jpeg = await getObject(thumbnailKey(cam.siteId, cam.key));
  if (!jpeg) throw notFound('No thumbnail yet');
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(jpeg);
});

/**
 * Live view (LAN phase): after the footage permission check, return the site's go2rtc player
 * URLs for this camera. Phase F replaces this with signalling through the server.
 */
camerasRouter.get(`${base}/:cameraId/live`, async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'footage.read');
  const cam = await loadCamera(access, param(req, 'siteId'), param(req, 'cameraId'));
  if (!cam.enabled) throw notFound('Camera is disabled');
  const base = await siteLiveUrl(cam.siteId);
  const player = (stream: string) => (base ? `${base.replace(/\/$/, '')}/stream.html?src=${encodeURIComponent(stream)}&mode=webrtc,mse,hls,mjpeg` : null);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    // Preferred: WebRTC negotiated through the server (works without LAN access to the site).
    webrtc: { available: !!edgeHub?.connected(cam.siteId), iceServers: env().ICE_SERVERS },
    // Fallback: the site's own go2rtc player (same LAN / Tailscale only).
    sd: player(cam.key),
    hd: player(`${cam.key}_main`),
  });
});

const WebrtcBody = z.object({ sdp: z.string().min(20).max(20_000), variant: z.enum(['sd', 'hd', 'sd_h264']).default('sd') });

/**
 * Live view signalling: relay the viewer's WebRTC offer to the site's go2rtc over the edge
 * control channel and return the answer. Fresh permission check on every request.
 */
camerasRouter.post(`${base}/:cameraId/webrtc`, async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'footage.read');
  const cam = await loadCamera(access, param(req, 'siteId'), param(req, 'cameraId'));
  if (!cam.enabled) throw notFound('Camera is disabled');
  const { sdp, variant } = WebrtcBody.parse(req.body);
  const src = variant === 'hd' ? `${cam.key}_main` : variant === 'sd_h264' ? `${cam.key}_h264` : cam.key;
  if (!edgeHub?.connected(cam.siteId)) throw new HttpError(503, 'The site is offline: its edge is not connected', 'site_offline');
  try {
    const answer = await edgeHub.request<{ sdp: string }>(cam.siteId, 'webrtc.offer', { src, sdp }, 15_000);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ sdp: answer.sdp });
  } catch (err) {
    throw new HttpError(502, `Live view failed: ${(err as Error).message}`, 'edge_error');
  }
});

camerasRouter.patch(`${base}/:cameraId`, async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const cam = await loadCamera(access, param(req, 'siteId'), param(req, 'cameraId'));
  const body = UpdateCameraBody.parse(req.body);

  if (body.key && body.key !== cam.key && (await db.camera.findUnique({ where: { siteId_key: { siteId: cam.siteId, key: body.key } } }))) {
    throw conflict('A camera with this key already exists at this site');
  }
  const sourceId = body.sourceId !== undefined ? body.sourceId : cam.sourceId;
  const source = sourceId ? await loadSiteSource(cam.siteId, sourceId) : null;
  const subUrlEnc =
    body.subUrl === undefined ? cam.subUrlEnc : body.subUrl ? encryptSecret(body.subUrl, cameraSecretCtx(cam.id, 'subUrl')) : null;
  const mainUrlEnc =
    body.mainUrl === undefined ? cam.mainUrlEnc : body.mainUrl ? encryptSecret(body.mainUrl, cameraSecretCtx(cam.id, 'mainUrl')) : null;
  const channel = body.channel !== undefined ? body.channel : cam.channel;
  const problem = streamProblem({ sourceId, channel, subUrlEnc }, source);
  if (problem) throw badRequest(problem);
  const detection = body.detection ? { ...((cam.detection as object) ?? {}), ...body.detection } : undefined;
  if (detection) checkDetection(detection);

  const { subUrl: _s, mainUrl: _m, detection: _d, ...plain } = body;
  const updated = await db.camera.update({
    where: { id: cam.id },
    data: { ...plain, sourceId, channel, subUrlEnc, mainUrlEnc, ...(detection ? { detection } : {}) },
    include,
  });
  await audit({
    actorId: user.id,
    actorType: 'user',
    organizationId: access.organizationId,
    action: 'camera.update',
    targetType: 'camera',
    targetId: cam.id,
    meta: { fields: Object.keys(body) },
  });
  res.json({ camera: cameraView(updated) });
});

camerasRouter.delete(`${base}/:cameraId`, async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const cam = await loadCamera(access, param(req, 'siteId'), param(req, 'cameraId'));
  await db.camera.delete({ where: { id: cam.id } });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'camera.delete', targetType: 'camera', targetId: cam.id });
  res.status(204).end();
});

// ---------------------------------------------------------------- zones and lines

camerasRouter.post(`${base}/:cameraId/zones`, async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const cam = await loadCamera(access, param(req, 'siteId'), param(req, 'cameraId'));
  const body = CreateZoneBody.parse(req.body);
  if (cam.zones.some((z) => z.key === body.key)) throw conflict('A zone with this key already exists on this camera');
  const zone = await db.zone.create({ data: { ...body, cameraId: cam.id } });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'zone.create', targetType: 'zone', targetId: zone.id });
  res.status(201).json({ zone });
});

camerasRouter.patch(`${base}/:cameraId/zones/:zoneId`, async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const cam = await loadCamera(access, param(req, 'siteId'), param(req, 'cameraId'));
  const zone = cam.zones.find((z) => z.id === param(req, 'zoneId'));
  if (!zone) throw notFound('Zone not found');
  const body = UpdateZoneBody.parse(req.body);
  if (body.key && body.key !== zone.key && cam.zones.some((z) => z.key === body.key)) throw conflict('Zone key in use');
  const updated = await db.zone.update({ where: { id: zone.id }, data: body });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'zone.update', targetType: 'zone', targetId: zone.id });
  res.json({ zone: updated });
});

camerasRouter.delete(`${base}/:cameraId/zones/:zoneId`, async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const cam = await loadCamera(access, param(req, 'siteId'), param(req, 'cameraId'));
  const zone = cam.zones.find((z) => z.id === param(req, 'zoneId'));
  if (!zone) throw notFound('Zone not found');
  await db.zone.delete({ where: { id: zone.id } });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'zone.delete', targetType: 'zone', targetId: zone.id });
  res.status(204).end();
});

camerasRouter.post(`${base}/:cameraId/lines`, async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const cam = await loadCamera(access, param(req, 'siteId'), param(req, 'cameraId'));
  const body = CreateLineBody.parse(req.body);
  if (cam.lines.some((l) => l.key === body.key)) throw conflict('A line with this key already exists on this camera');
  const line = await db.line.create({ data: { ...body, cameraId: cam.id } });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'line.create', targetType: 'line', targetId: line.id });
  res.status(201).json({ line });
});

camerasRouter.patch(`${base}/:cameraId/lines/:lineId`, async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const cam = await loadCamera(access, param(req, 'siteId'), param(req, 'cameraId'));
  const line = cam.lines.find((l) => l.id === param(req, 'lineId'));
  if (!line) throw notFound('Line not found');
  const body = UpdateLineBody.parse(req.body);
  if (body.key && body.key !== line.key && cam.lines.some((l) => l.key === body.key)) throw conflict('Line key in use');
  const updated = await db.line.update({ where: { id: line.id }, data: body });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'line.update', targetType: 'line', targetId: line.id });
  res.json({ line: updated });
});

camerasRouter.delete(`${base}/:cameraId/lines/:lineId`, async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const cam = await loadCamera(access, param(req, 'siteId'), param(req, 'cameraId'));
  const line = cam.lines.find((l) => l.id === param(req, 'lineId'));
  if (!line) throw notFound('Line not found');
  await db.line.delete({ where: { id: line.id } });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'line.delete', targetType: 'line', targetId: line.id });
  res.status(204).end();
});

// ---------------------------------------------------------------- helpers

function checkDetection(patch: object) {
  const d = DetectionSettings.parse({ ...DETECTION_DEFAULTS, ...patch });
  if (d.lowConfidence > d.confidence) throw badRequest('lowConfidence must not exceed confidence');
}

async function loadSiteSource(siteId: string, sourceId: string) {
  const s = await db.source.findFirst({ where: { id: sourceId, siteId } });
  if (!s) throw badRequest('Unknown source for this site', { path: ['sourceId'] });
  return s;
}

export async function loadCamera(access: OrgAccess, siteId: string | undefined, cameraId: string | undefined): Promise<CameraFull> {
  const site = await loadSite(access, siteId);
  const cam = cameraId
    ? await db.camera.findFirst({ where: { id: cameraId, siteId: site.id, organizationId: access.organizationId }, include }).catch(() => null)
    : null;
  if (!cam) throw notFound('Camera not found');
  return cam;
}

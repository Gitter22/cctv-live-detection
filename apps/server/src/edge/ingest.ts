import { Prisma } from '@prisma/client';
import { VisionEvent } from '@cctv/shared';
import { Router, json } from 'express';
import { z } from 'zod';
import { bus } from '../lib/bus';
import { db } from '../lib/db';
import { matchFace } from '../lib/faces';
import { HttpError, badRequest } from '../lib/http';
import { logger } from '../lib/logger';
import { isJpeg, putObject, snapshotKey } from '../lib/store';

/** POST /edge/v1/events: one VisionEvent (+ optional JPEG snapshot, base64) from an edge. */
export const ingestRouter = Router();

const IngestBody = z.object({
  event: z.unknown(),
  snapshot: z.string().max(3_000_000).optional(), // base64 JPEG (~2 MB max)
});

ingestRouter.post('/events', json({ limit: '4mb' }), async (req, res) => {
  const edge = req.edge!;
  const body = IngestBody.parse(req.body);
  const parsed = VisionEvent.safeParse(body.event);
  // 422 = permanently invalid: the edge drops it instead of retrying forever.
  if (!parsed.success) throw new HttpError(422, 'Invalid vision event', 'invalid_event', parsed.error.issues.slice(0, 5));
  const ev = parsed.data;

  const camera = await db.camera.findUnique({ where: { siteId_key: { siteId: edge.siteId, key: ev.camera_id } }, select: { id: true } });
  if (!camera) throw new HttpError(422, `Unknown camera "${ev.camera_id}" for this site`, 'unknown_camera');

  const ts = new Date(ev.ts);
  let key: string | null = null;
  if (body.snapshot) {
    const buf = Buffer.from(body.snapshot, 'base64');
    if (!isJpeg(buf)) throw badRequest('Snapshot is not a JPEG');
    key = snapshotKey(edge.siteId, ev.id, ts);
  }

  // Write the snapshot BEFORE the row: if storing fails, nothing is committed and the edge's
  // retry stores both (writing the same key again is harmless).
  if (key && body.snapshot) await putObject(key, Buffer.from(body.snapshot, 'base64'));

  // Faces: identity is decided here (org-scoped), never at the edge.
  const match = ev.type === 'face.observed' && ev.face ? await matchFace(edge.organizationId, ev.face.embedding) : null;

  try {
    const row = await db.event.create({
      data: {
        id: ev.id,
        organizationId: edge.organizationId,
        siteId: edge.siteId,
        cameraKey: ev.camera_id,
        type: ev.type,
        ts,
        payload: ev as unknown as Prisma.InputJsonValue,
        snapshotKey: key,
        facePersonId: match?.personId ?? null,
        faceSimilarity: match?.similarity ?? null,
      },
    });
    bus.emit('event.ingested', row);
    res.status(201).json({ id: row.id });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(200).json({ id: ev.id, duplicate: true }); // retry of an event we already have
      return;
    }
    logger.error({ err, event: ev.id }, 'event ingest failed');
    throw err;
  }
});

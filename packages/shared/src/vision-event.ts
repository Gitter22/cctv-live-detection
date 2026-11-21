import { z } from 'zod';

/**
 * VisionEvent v1: generic event published by services/vision.
 * Mirrors schemas/vision-event.v1.json (the language-neutral contract for Python).
 * Contains NO business rules: what was seen, where and when.
 */

export const VISION_EVENT_SCHEMA = 'vision.event/v1' as const;

export const VisionEventType = z.enum(['zone.enter', 'zone.exit', 'line.cross', 'camera.status', 'face.observed']);
export type VisionEventType = z.infer<typeof VisionEventType>;

const unit = z.number().min(0).max(1);

export const VisionObject = z
  .object({
    class: z.string().min(1),
    track_id: z.number().int(),
    confidence: unit,
    bbox: z.tuple([unit, unit, unit, unit]),
    dwell_s: z.number().nonnegative().optional(),
  })
  .strict();
export type VisionObject = z.infer<typeof VisionObject>;

export const VisionFace = z
  .object({
    /** SFace feature (128 floats, L2-normalised). Identity is decided by the server, never at the edge. */
    embedding: z.array(z.number()).length(128),
    score: unit,
    bbox: z.tuple([unit, unit, unit, unit]),
    size_px: z.number().int().optional(),
  })
  .strict();
export type VisionFace = z.infer<typeof VisionFace>;

export const VisionEvent = z
  .object({
    schema: z.literal(VISION_EVENT_SCHEMA),
    id: z.string().uuid(),
    type: VisionEventType,
    ts: z.string().datetime({ offset: true }),
    camera_id: z.string().min(1),
    zone_id: z.string().nullish(),
    line_id: z.string().nullish(),
    direction: z.enum(['in', 'out']).nullish(),
    object: VisionObject.nullish(),
    status: z.object({ online: z.boolean(), reason: z.string().nullish() }).strict().nullish(),
    snapshot: z
      .object({ path: z.string(), width: z.number().int().optional(), height: z.number().int().optional() })
      .strict()
      .nullish(),
    frame: z.object({ width: z.number().int(), height: z.number().int() }).partial().strict().nullish(),
    face: VisionFace.nullish(),
  })
  .strict()
  .superRefine((e, ctx) => {
    const needsObject = e.type === 'zone.enter' || e.type === 'zone.exit' || e.type === 'line.cross' || e.type === 'face.observed';
    if (e.type === 'face.observed' && !e.face) ctx.addIssue({ code: 'custom', path: ['face'], message: 'face.observed needs face' });
    if (needsObject && !e.object) ctx.addIssue({ code: 'custom', path: ['object'], message: `${e.type} needs object` });
    if ((e.type === 'zone.enter' || e.type === 'zone.exit') && !e.zone_id)
      ctx.addIssue({ code: 'custom', path: ['zone_id'], message: `${e.type} needs zone_id` });
    if (e.type === 'line.cross' && !e.line_id) ctx.addIssue({ code: 'custom', path: ['line_id'], message: 'line.cross needs line_id' });
    if (e.type === 'camera.status' && !e.status)
      ctx.addIssue({ code: 'custom', path: ['status'], message: 'camera.status needs status' });
  });
export type VisionEvent = z.infer<typeof VisionEvent>;

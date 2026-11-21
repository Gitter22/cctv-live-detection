import { z } from 'zod';
import { DetectionSettings, Point } from './api';

/** GET /edge/v1/config: everything an edge needs to run its site (stream URLs contain secrets). */
export const EdgeCamera = z.object({
  key: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  tags: z.array(z.string()),
  streams: z.object({ sub: z.string(), main: z.string().nullable() }),
  detection: DetectionSettings,
  zones: z.array(z.object({ key: z.string(), label: z.string(), polygon: z.array(Point) })),
  lines: z.array(z.object({ key: z.string(), label: z.string(), start: Point, end: Point })),
});
export type EdgeCamera = z.infer<typeof EdgeCamera>;

export const EdgeConfig = z.object({
  schema: z.literal('edge.config/v1'),
  site: z.object({ id: z.string(), slug: z.string(), name: z.string(), timezone: z.string() }),
  cameras: z.array(EdgeCamera),
  skipped: z.array(z.object({ key: z.string(), reason: z.string() })),
});
export type EdgeConfig = z.infer<typeof EdgeConfig>;

/** POST /edge/v1/heartbeat: edge + camera health, every ~30 s. */
export const CameraHealth = z.object({
  online: z.boolean(),
  reason: z.string().nullish(),
  /** When the camera last changed online state (ISO). */
  since: z.string().nullish(),
  metrics: z
    .object({
      decode_fps: z.number().nullish(),
      detect_fps: z.number().nullish(),
      infer_ms_avg: z.number().nullish(),
      frame_age_ms_avg: z.number().nullish(),
    })
    .passthrough()
    .nullish(),
});
export type CameraHealth = z.infer<typeof CameraHealth>;

export const EdgeHeartbeat = z.object({
  version: z.string().max(40),
  uptimeS: z.number().nonnegative(),
  vision: z.object({ online: z.boolean() }),
  spool: z.number().int().nonnegative(),
  cameras: z.record(z.string(), CameraHealth),
});
export type EdgeHeartbeat = z.infer<typeof EdgeHeartbeat>;

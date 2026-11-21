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

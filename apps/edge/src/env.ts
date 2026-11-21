import { z } from 'zod';

/** Edge settings. The edge only knows its server, site and token; everything else comes from the server. */
const EnvSchema = z.object({
  SERVER_URL: z.string().url().default('http://server:4000'),
  EDGE_SITE_ID: z.string().uuid(),
  EDGE_TOKEN: z.string().startsWith('edg_'),
  /** How often to ask the server for config changes. */
  CONFIG_POLL_S: z.coerce.number().min(1).default(10),
  /** Persistent state: cached config, event spool. */
  STATE_DIR: z.string().default('/state'),
  /** Generated config files shared with go2rtc and vision. */
  GEN_DIR: z.string().default('/gen'),
  /** go2rtc API inside the edge network. */
  GO2RTC_API: z.string().url().default('http://go2rtc:1984'),
  /** RTSP base that vision uses to read go2rtc streams. */
  GO2RTC_RTSP: z.string().default('rtsp://go2rtc:8554'),
  MQTT_URL: z.string().default('mqtt://mosquitto:1883'),
  MQTT_TOPIC_PREFIX: z.string().default('cctv/v1'),
  /** Snapshots written by vision (shared volume). */
  SNAPSHOT_DIR: z.string().default('/data/snapshots'),
  /** go2rtc player URL as browsers reach it, e.g. http://192.168.1.50:1984 (LAN live view). */
  EDGE_LIVE_URL: z.string().url().optional(),
  /** How often to upload a still per camera (zone editor). */
  THUMBNAIL_INTERVAL_S: z.coerce.number().min(60).default(600),
  LOG_LEVEL: z
    .preprocess((v) => (typeof v === 'string' ? v.toLowerCase() : v), z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']))
    .default('info'),
});

export type EdgeEnv = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): EdgeEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid edge environment:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  return parsed.data;
}

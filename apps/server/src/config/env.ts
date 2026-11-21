import { z } from 'zod';

/** All server settings come from the environment (root .env via Docker Compose). */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVER_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  /** Signs session JWTs. At least 32 characters. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_TTL_HOURS: z.coerce.number().positive().default(12),
  /** 32 bytes as 64 hex chars. Encrypts NVR passwords and stream URLs (AES-256-GCM). */
  SECRETS_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'SECRETS_KEY must be 64 hex characters (openssl rand -hex 32)'),
  /** Browser origins allowed to call the API with cookies (comma separated). */
  WEB_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  /** Where event snapshots are stored on disk. */
  SNAPSHOT_STORE: z.string().default('./data/store'),
  SUPERADMIN_EMAIL: z.string().email().optional(),
  SUPERADMIN_PASSWORD: z.string().min(10).optional(),
  SUPERADMIN_NAME: z.string().default('Platform Admin'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid server environment:\n${issues}`);
  }
  return parsed.data;
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

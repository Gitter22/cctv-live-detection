import { createHash } from 'node:crypto';
import type { Source } from '@prisma/client';
import { db } from '../lib/db';
import { logger } from '../lib/logger';
import { deviceUrl } from '../lib/rtsp';
import { decryptSecret } from '../lib/secrets';
import { cameraSecretCtx, effectiveDetection, streamProblem } from '../routes/cameras';
import { sourceSecretCtx } from '../routes/sources';

export type { EdgeCamera, EdgeConfig as EdgeSiteConfig } from '@cctv/shared';
import type { EdgeCamera, EdgeConfig as EdgeSiteConfig } from '@cctv/shared';

function sourceUrls(source: Source, channel: number | null): { sub: string | null; main: string | null } {
  if (source.kind === 'RAW_URL') {
    const url = source.rawUrlEnc ? decryptSecret(source.rawUrlEnc, sourceSecretCtx(source.id, 'rawUrl')) : null;
    return { sub: url, main: url };
  }
  const device = {
    vendor: source.vendor,
    host: source.host,
    rtspPort: source.rtspPort,
    username: source.username,
    password: source.passwordEnc ? decryptSecret(source.passwordEnc, sourceSecretCtx(source.id, 'password')) : null,
  };
  return channel ? { sub: deviceUrl(device, channel, 'sub'), main: deviceUrl(device, channel, 'main') } : { sub: null, main: null };
}

export async function buildSiteConfig(siteId: string): Promise<EdgeSiteConfig> {
  const site = await db.site.findUniqueOrThrow({
    where: { id: siteId },
    include: {
      cameras: {
        include: { source: true, zones: { orderBy: { key: 'asc' } }, lines: { orderBy: { key: 'asc' } } },
        orderBy: { key: 'asc' },
      },
    },
  });

  const cameras: EdgeCamera[] = [];
  const skipped: EdgeSiteConfig['skipped'] = [];
  for (const c of site.cameras) {
    const problem = streamProblem(c, c.source);
    if (problem) {
      skipped.push({ key: c.key, reason: problem });
      continue;
    }
    try {
      const fromSource = c.source ? sourceUrls(c.source, c.channel) : { sub: null, main: null };
      const sub = c.subUrlEnc ? decryptSecret(c.subUrlEnc, cameraSecretCtx(c.id, 'subUrl')) : fromSource.sub;
      const main = c.mainUrlEnc ? decryptSecret(c.mainUrlEnc, cameraSecretCtx(c.id, 'mainUrl')) : fromSource.main;
      if (!sub) {
        skipped.push({ key: c.key, reason: 'No stream URL could be built' });
        continue;
      }
      cameras.push({
        key: c.key,
        label: c.label,
        enabled: c.enabled,
        tags: c.tags,
        streams: { sub, main: main ?? null },
        detection: effectiveDetection(c.detection),
        zones: c.zones.map((z) => ({ key: z.key, label: z.label, polygon: z.polygon as [number, number][] })),
        lines: c.lines.map((l) => ({ key: l.key, label: l.label, start: l.start as [number, number], end: l.end as [number, number] })),
      });
    } catch (err) {
      // Wrong SECRETS_KEY or corrupted ciphertext: skip this camera, keep the site running.
      logger.error({ err, camera: c.key, siteId }, 'cannot decrypt camera secrets');
      skipped.push({ key: c.key, reason: 'Stored credentials cannot be decrypted' });
    }
  }
  return {
    schema: 'edge.config/v1',
    site: { id: site.id, slug: site.slug, name: site.name, timezone: site.timezone },
    cameras,
    skipped,
  };
}

/** Stable content hash, used as ETag. */
export function configEtag(config: EdgeSiteConfig): string {
  return `"${createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 32)}"`;
}

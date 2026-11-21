/**
 * One-time migration of the step-1 home setup into the database (idempotent).
 *
 * Reads:  NVR_HOST / NVR_RTSP_PORT / NVR_USER / NVR_PASSWORD (URL-encoded) from the root .env,
 *         config/vision.yaml   (camera ids, labels, zones, lines, detection)
 *         config/go2rtc.yaml   (NVR channel of each camera stream)
 * Creates: organization "home" + site "home" (Asia/Kolkata), source "Home NVR" (Dahua),
 *          the cameras with zones/lines, owner membership for HOME_OWNER_EMAIL (default:
 *          SUPERADMIN_EMAIL), and one edge "home-edge" whose token + site id are written to
 *          the root .env (EDGE_TOKEN, EDGE_SITE_ID) without being printed.
 *
 *   npm run import:home -w apps/server
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { newEdgeToken } from '../edge/edge-auth';
import { db } from '../lib/db';
import { encryptSecret } from '../lib/secrets';
import { sourceSecretCtx } from '../routes/sources';
import { seedSuperAdmin } from './seed';

const ROOT = join(__dirname, '../../../..');

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

interface VisionYaml {
  detector?: { confidence?: number; low_confidence?: number; classes?: string[] };
  pipeline?: { detect_fps?: number; motion_gate?: boolean };
  cameras: {
    id: string;
    name?: string;
    stream: string;
    zones?: { id: string; polygon: [number, number][] }[];
    lines?: { id: string; start: [number, number]; end: [number, number] }[];
  }[];
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env`);
  return v;
}

async function main() {
  const admin = await seedSuperAdmin();
  const ownerEmail = (process.env.HOME_OWNER_EMAIL ?? process.env.SUPERADMIN_EMAIL ?? '').toLowerCase();
  const owner = ownerEmail ? await db.user.findUnique({ where: { email: ownerEmail } }) : admin;
  if (!owner) throw new Error(`Owner ${ownerEmail} does not exist (create it or set HOME_OWNER_EMAIL)`);

  const vision = parse(readFileSync(join(ROOT, 'config/vision.yaml'), 'utf8')) as VisionYaml;
  const go2rtc = parse(readFileSync(join(ROOT, 'config/go2rtc.yaml'), 'utf8')) as { streams: Record<string, string> };

  // ---- organization + site
  const org = await db.organization.upsert({ where: { slug: 'home' }, update: {}, create: { name: 'Home', slug: 'home' } });
  await db.membership.upsert({
    where: { userId_organizationId: { userId: owner.id, organizationId: org.id } },
    update: {},
    create: { userId: owner.id, organizationId: org.id, role: 'OWNER' },
  });
  const site = await db.site.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: 'home' } },
    update: {},
    create: { organizationId: org.id, name: 'Home', slug: 'home', timezone: 'Asia/Kolkata' },
  });

  // ---- NVR source (password from .env is URL-encoded there; store the plain value)
  let source = await db.source.findFirst({ where: { siteId: site.id, name: 'Home NVR' } });
  const fields = {
    kind: 'NVR' as const,
    vendor: 'dahua',
    host: need('NVR_HOST'),
    rtspPort: Number(process.env.NVR_RTSP_PORT ?? 554),
    username: need('NVR_USER'),
  };
  source ??= await db.source.create({ data: { organizationId: org.id, siteId: site.id, name: 'Home NVR', ...fields } });
  source = await db.source.update({
    where: { id: source.id },
    data: {
      ...fields,
      passwordEnc: encryptSecret(decodeURIComponent(need('NVR_PASSWORD')), sourceSecretCtx(source.id, 'password')),
    },
  });

  // ---- cameras, zones, lines
  const detection = {
    classes: vision.detector?.classes ?? ['person'],
    confidence: vision.detector?.confidence ?? 0.5,
    lowConfidence: vision.detector?.low_confidence ?? 0.25,
    detectFps: vision.pipeline?.detect_fps ?? 5,
    motionGate: vision.pipeline?.motion_gate ?? true,
  };
  for (const c of vision.cameras) {
    const url = go2rtc.streams[c.stream];
    const channel = Number(/channel=(\d+)/.exec(url ?? '')?.[1]);
    if (!channel) throw new Error(`No NVR channel found for stream ${c.stream} in go2rtc.yaml`);
    const camera = await db.camera.upsert({
      where: { siteId_key: { siteId: site.id, key: c.id } },
      update: { label: c.name ?? c.id, sourceId: source.id, channel },
      create: {
        organizationId: org.id,
        siteId: site.id,
        key: c.id,
        label: c.name ?? c.id,
        sourceId: source.id,
        channel,
        detection,
      },
    });
    for (const z of c.zones ?? []) {
      const key = slugify(z.id);
      await db.zone.upsert({
        where: { cameraId_key: { cameraId: camera.id, key } },
        update: { polygon: z.polygon },
        create: { cameraId: camera.id, key, label: z.id.replace(/[_-]/g, ' '), polygon: z.polygon },
      });
    }
    for (const l of c.lines ?? []) {
      const key = slugify(l.id);
      await db.line.upsert({
        where: { cameraId_key: { cameraId: camera.id, key } },
        update: { start: l.start, end: l.end },
        create: { cameraId: camera.id, key, label: l.id, start: l.start, end: l.end },
      });
    }
    console.log(`camera ${c.id}: NVR channel ${channel}`);
  }

  // ---- home edge: token goes to .env, never to the console
  const edge = await db.edge.findFirst({ where: { siteId: site.id, name: 'home-edge', status: 'ACTIVE' } });
  if (!edge) {
    const { token, tokenHash } = newEdgeToken();
    const created = await db.edge.create({ data: { organizationId: org.id, siteId: site.id, name: 'home-edge', tokenHash } });
    appendFileSync(
      join(ROOT, '.env'),
      `\n# --- Edge (written by import:home ${new Date().toISOString().slice(0, 10)}) -- edge ${created.id}\nEDGE_SITE_ID=${site.id}\nEDGE_TOKEN=${token}\n`,
    );
    console.log('edge home-edge created; EDGE_SITE_ID and EDGE_TOKEN written to .env');
  } else {
    console.log('edge home-edge already exists (token unchanged)');
  }
  console.log(`org ${org.slug} / site ${site.slug} ready (${vision.cameras.length} cameras)`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await db.$disconnect();
    process.exit(1);
  });

/**
 * E2E fixtures (phase G).
 *
 *   npm run e2e -w apps/server -- seed     demo factory org + users per role + rules + edge token
 *   npm run e2e -w apps/server -- event <camera> <zone.enter|zone.exit|face.observed|camera.status> [zone]
 *   npm run e2e -w apps/server -- reset    remove everything seed created
 *
 * Generated test passwords and the demo edge token are written to data/e2e-credentials.json
 * (gitignored), never printed. Events are posted through the real edge API with a real JPEG.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RuleDefinition } from '@cctv/shared';
import type { OrgRole, Prisma } from '@prisma/client';
import { hashPassword } from '../auth/password';
import { newEdgeToken } from '../edge/edge-auth';
import { db } from '../lib/db';

const ROOT = join(__dirname, '../../../..');
const CREDS = join(ROOT, 'data/e2e-credentials.json');
const ORG_SLUG = 'acme-e2e';
const EMAIL_DOMAIN = 'e2e.test';

interface Creds {
  serverUrl: string;
  org: { id: string; slug: string };
  site: { id: string };
  edgeToken: string;
  users: Record<string, { email: string; password: string; role: string }>;
}

const pw = () => `e2e-${randomBytes(9).toString('base64url')}`;

async function user(email: string, name: string, password: string) {
  return db.user.upsert({
    where: { email },
    update: { passwordHash: await hashPassword(password), disabled: false },
    create: { email, name, passwordHash: await hashPassword(password) },
  });
}

async function seed() {
  await reset(true);
  const org = await db.organization.create({ data: { name: 'Acme Factory (E2E)', slug: ORG_SLUG } });
  const site = await db.site.create({ data: { organizationId: org.id, name: 'Plant 1', slug: 'plant-1', timezone: 'Asia/Kolkata' } });

  // Cameras with their own (unreachable) URLs: this site has no real edge; events come from the injector.
  const cams = [
    { key: 'gate-1', label: 'Main gate', tags: ['gate'], zone: { key: 'gate', label: 'Gate', polygon: [[0.2, 0.3], [0.8, 0.3], [0.8, 1], [0.2, 1]] } },
    { key: 'press-3', label: 'Press 3', tags: ['machine-area'], zone: { key: 'operator-area', label: 'Operator area', polygon: [[0.1, 0.2], [0.6, 0.2], [0.6, 0.95], [0.1, 0.95]] } },
  ];
  for (const c of cams) {
    await db.camera.create({
      data: {
        organizationId: org.id,
        siteId: site.id,
        key: c.key,
        label: c.label,
        tags: c.tags,
        enabled: true,
        zones: { create: { key: c.zone.key, label: c.zone.label, polygon: c.zone.polygon } },
      },
    });
  }

  const rules: { name: string; definition: unknown }[] = [
    {
      name: 'Person at the gate',
      definition: { scope: { mode: 'tags', tags: ['gate'] }, when: { type: 'presence', zones: ['gate'] }, then: { severity: 'danger' }, cooldownS: 0 },
    },
    {
      name: 'Operator left machine',
      definition: {
        scope: { mode: 'cameras', cameras: ['press-3'] },
        when: { type: 'absence', zones: ['operator-area'], forS: 30 },
        then: { severity: 'warning' },
        cooldownS: 0,
      },
    },
  ];
  for (const r of rules) {
    await db.rule.create({
      data: { organizationId: org.id, siteId: site.id, name: r.name, definition: RuleDefinition.parse(r.definition) as Prisma.InputJsonValue },
    });
  }

  const users: Creds['users'] = {};
  for (const role of ['OWNER', 'ADMIN', 'VIEWER'] as OrgRole[]) {
    const email = `${role.toLowerCase()}@${EMAIL_DOMAIN}`;
    const password = pw();
    const u = await user(email, `E2E ${role.toLowerCase()}`, password);
    await db.membership.create({ data: { userId: u.id, organizationId: org.id, role } });
    users[role.toLowerCase()] = { email, password, role };
  }
  // A viewer of the HOME org (cross-org isolation tests); only if the home org exists.
  const home = await db.organization.findUnique({ where: { slug: 'home' } });
  if (home) {
    const password = pw();
    const u = await user(`home-viewer@${EMAIL_DOMAIN}`, 'E2E home viewer', password);
    await db.membership.upsert({
      where: { userId_organizationId: { userId: u.id, organizationId: home.id } },
      update: { role: 'VIEWER' },
      create: { userId: u.id, organizationId: home.id, role: 'VIEWER' },
    });
    users.homeViewer = { email: u.email, password, role: 'VIEWER (home)' };
  }

  const { token, tokenHash } = newEdgeToken();
  await db.edge.create({ data: { organizationId: org.id, siteId: site.id, name: 'e2e-injector', tokenHash } });

  const creds: Creds = { serverUrl: process.env.E2E_SERVER_URL ?? 'http://localhost:4000', org: { id: org.id, slug: ORG_SLUG }, site: { id: site.id }, edgeToken: token, users };
  mkdirSync(join(ROOT, 'data'), { recursive: true });
  writeFileSync(CREDS, JSON.stringify(creds, null, 2), { mode: 0o600 });
  console.log(`seeded ${ORG_SLUG}: ${Object.keys(users).length} users, 2 cameras, ${rules.length} rules; credentials in data/e2e-credentials.json`);
}

async function reset(quiet = false) {
  const org = await db.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (org) await db.organization.delete({ where: { id: org.id } }); // cascades sites, cameras, rules, events, alerts, people
  const users = await db.user.findMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } }, select: { id: true } });
  await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  if (!quiet) console.log(`reset: removed ${org ? 1 : 0} org, ${users.length} e2e users`);
}

/** Post one VisionEvent through the real edge API, like an edge would. */
async function event(camera: string, type: string, zone = '') {
  if (!existsSync(CREDS)) throw new Error('Run seed first');
  const creds = JSON.parse(readFileSync(CREDS, 'utf8')) as Creds;
  const jpeg = readFileSync(join(ROOT, 'data/test/people.jpg'));
  const id = randomUUID();
  const base = { schema: 'vision.event/v1', id, type, ts: new Date().toISOString(), camera_id: camera };
  const object = { class: 'person', track_id: Math.floor(Math.random() * 100000), confidence: 0.92, bbox: [0.55, 0.3, 0.7, 0.95] };
  const ev =
    type === 'camera.status'
      ? { ...base, status: { online: zone !== 'offline', reason: zone === 'offline' ? 'no frames' : null } }
      : type === 'face.observed'
        ? { ...base, zone_id: zone || null, object, face: { embedding: Array.from({ length: 128 }, () => 1 / Math.sqrt(128)), score: 0.9, bbox: [0.58, 0.32, 0.64, 0.42] } }
        : { ...base, zone_id: zone, object, snapshot: { path: 'e2e.jpg', width: 640, height: 480 } };
  const res = await fetch(`${creds.serverUrl}/edge/v1/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.edgeToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: ev, ...(type === 'camera.status' ? {} : { snapshot: jpeg.toString('base64') }) }),
  });
  console.log(`event ${type} ${camera} ${zone} -> HTTP ${res.status} (id ${id})`);
  if (!res.ok) process.exitCode = 1;
}

const [cmd, ...args] = process.argv.slice(2);
const run = cmd === 'seed' ? seed() : cmd === 'reset' ? reset() : cmd === 'event' ? event(args[0] ?? 'gate-1', args[1] ?? 'zone.enter', args[2] ?? 'gate') : Promise.reject(new Error('usage: seed | reset | event <camera> <type> [zone]'));
run
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await db.$disconnect();
    process.exit(1);
  });

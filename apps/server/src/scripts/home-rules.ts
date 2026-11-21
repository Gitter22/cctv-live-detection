/**
 * Seed the home rules from the handover (idempotent by rule name):
 *   - person at the entrance (any time)                 -> warning
 *   - person on first floor / last floor at night        -> danger
 *   - any camera offline > 2 min                         -> warning
 *   - face at the entrance: known -> info, unknown -> danger (faces switched on for entrance-1)
 *
 *   npm run seed:home-rules -w apps/server
 */
import { RuleDefinition } from '@cctv/shared';
import type { Prisma } from '@prisma/client';
import { db } from '../lib/db';

const RULES: { name: string; definition: unknown }[] = [
  {
    name: 'Person at the entrance',
    definition: {
      scope: { mode: 'cameras', cameras: ['entrance-1'] },
      when: { type: 'presence', classes: ['person'] },
      then: { severity: 'warning' },
      cooldownS: 120,
    },
  },
  {
    name: 'Person on the balcony or terrace at night',
    definition: {
      scope: { mode: 'cameras', cameras: ['firstfloor-3', 'lastfloor-4'] },
      when: { type: 'presence', classes: ['person'] },
      schedule: { windows: [{ start: '22:00', end: '06:00' }] },
      then: { severity: 'danger' },
      cooldownS: 120,
    },
  },
  {
    name: 'Known person at the entrance',
    definition: { scope: { mode: 'cameras', cameras: ['entrance-1'] }, when: { type: 'face', match: 'known' }, then: { severity: 'info' }, cooldownS: 300 },
  },
  {
    name: 'Unknown person at the entrance',
    definition: { scope: { mode: 'cameras', cameras: ['entrance-1'] }, when: { type: 'face', match: 'unknown' }, then: { severity: 'danger' }, cooldownS: 120 },
  },
  {
    name: 'Camera offline',
    definition: { scope: { mode: 'all' }, when: { type: 'camera_offline', forS: 120 }, then: { severity: 'warning' }, cooldownS: 1800 },
  },
];

async function main() {
  const site = await db.site.findFirst({ where: { slug: 'home', organization: { slug: 'home' } } });
  if (!site) throw new Error('Home site not found: run import:home first');
  // Faces only where the rules need them (privacy): the entrance camera.
  const entrance = await db.camera.findUnique({ where: { siteId_key: { siteId: site.id, key: 'entrance-1' } } });
  if (entrance) {
    await db.camera.update({ where: { id: entrance.id }, data: { detection: { ...((entrance.detection as object) ?? {}), faces: true } } });
    console.log('faces enabled on entrance-1');
  }
  for (const r of RULES) {
    const definition = RuleDefinition.parse(r.definition) as Prisma.InputJsonValue;
    const existing = await db.rule.findFirst({ where: { siteId: site.id, name: r.name } });
    if (existing) await db.rule.update({ where: { id: existing.id }, data: { definition } });
    else await db.rule.create({ data: { organizationId: site.organizationId, siteId: site.id, name: r.name, definition } });
    console.log(`rule ok: ${r.name}`);
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await db.$disconnect();
    process.exit(1);
  });

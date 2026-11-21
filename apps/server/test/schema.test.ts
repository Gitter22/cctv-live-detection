import { db } from '../src/lib/db';
import { resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe('database schema', () => {
  it('stores an org with a site, camera and zone', async () => {
    const org = await db.organization.create({ data: { name: 'Home', slug: 'home' } });
    const site = await db.site.create({
      data: { organizationId: org.id, name: 'Home', slug: 'home', timezone: 'Asia/Kolkata' },
    });
    await db.camera.create({
      data: {
        organizationId: org.id,
        siteId: site.id,
        key: 'entrance-1',
        label: 'Entrance gate',
        channel: 1,
        tags: ['gate'],
        zones: { create: { key: 'gate', label: 'Gate', polygon: [[0, 0], [1, 0], [1, 1]] } },
      },
    });
    const read = await db.site.findUniqueOrThrow({ where: { id: site.id }, include: { cameras: { include: { zones: true } } } });
    expect(read.cameras[0]?.key).toBe('entrance-1');
    expect(read.cameras[0]?.zones[0]?.polygon).toEqual([[0, 0], [1, 0], [1, 1]]);
  });

  it('enforces unique camera keys per site', async () => {
    const org = await db.organization.create({ data: { name: 'A', slug: 'a' } });
    const site = await db.site.create({ data: { organizationId: org.id, name: 'S', slug: 's' } });
    const cam = { organizationId: org.id, siteId: site.id, key: 'k', label: 'L' };
    await db.camera.create({ data: cam });
    await expect(db.camera.create({ data: cam })).rejects.toThrow();
  });

  it('has the pgvector extension', async () => {
    const rows = await db.$queryRaw<{ extname: string }[]>`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    expect(rows).toHaveLength(1);
  });
});

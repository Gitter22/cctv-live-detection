import { db } from '../src/lib/db';
import { agentFor } from './api';
import { addMember, makeOrg, makeUser } from './factories';
import { resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe('sites', () => {
  it('admins create sites with a valid timezone; slugs are unique per org', async () => {
    const { org } = await makeOrg();
    const admin = await makeUser();
    await addMember(admin.id, org.id, 'ADMIN');
    const a = await agentFor(admin.email);
    const ok = await a.post(`/api/orgs/${org.id}/sites`).send({ name: 'Shop 3', slug: 'shop-3', timezone: 'Asia/Kolkata' });
    expect(ok.status).toBe(201);
    expect((await a.post(`/api/orgs/${org.id}/sites`).send({ name: 'x', slug: 'shop-3' })).status).toBe(409);
    expect((await a.post(`/api/orgs/${org.id}/sites`).send({ name: 'x', slug: 'y', timezone: 'Mars/Base' })).status).toBe(400);
    const list = await a.get(`/api/orgs/${org.id}/sites`);
    expect(list.body.sites.map((s: { slug: string }) => s.slug).sort()).toEqual(['main', 'shop-3']);
  });

  it('viewers read but cannot write; site-limited members see only their sites', async () => {
    const { org, site } = await makeOrg();
    await db.site.create({ data: { organizationId: org.id, name: 'Hidden', slug: 'hidden' } });
    const v = await makeUser();
    await addMember(v.id, org.id, 'VIEWER', [site.id]);
    const a = await agentFor(v.email);
    const list = await a.get(`/api/orgs/${org.id}/sites`);
    expect(list.body.sites).toHaveLength(1);
    expect((await a.patch(`/api/orgs/${org.id}/sites/${site.id}`).send({ name: 'x' })).status).toBe(403);
    expect((await a.post(`/api/orgs/${org.id}/sites`).send({ name: 'x', slug: 'x' })).status).toBe(403);
  });

  it('cannot reach a site of another org through its own org id', async () => {
    const a = await makeOrg('A');
    const b = await makeOrg('B');
    const u = await makeUser();
    await addMember(u.id, a.org.id, 'OWNER');
    const agent = await agentFor(u.email);
    expect((await agent.get(`/api/orgs/${a.org.id}/sites/${b.site.id}`)).status).toBe(404);
    expect((await agent.delete(`/api/orgs/${a.org.id}/sites/${b.site.id}`)).status).toBe(404);
    expect(await db.site.count({ where: { id: b.site.id } })).toBe(1);
  });
});

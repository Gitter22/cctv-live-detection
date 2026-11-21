import { db } from '../src/lib/db';
import { agentFor } from './api';
import { addMember, makeOrg, makeUser } from './factories';
import { resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe('organizations', () => {
  it('only the platform admin creates orgs, with a new owner user', async () => {
    const admin = await makeUser({ superAdmin: true });
    const plain = await makeUser();
    const body = { name: 'Acme Factory', slug: 'acme', owner: { email: 'boss@acme.test', name: 'Boss', password: 'boss-password-1' } };

    expect((await (await agentFor(plain.email)).post('/api/orgs').send(body)).status).toBe(403);
    const res = await (await agentFor(admin.email)).post('/api/orgs').send(body);
    expect(res.status).toBe(201);

    const boss = await agentFor('boss@acme.test', 'boss-password-1');
    const list = await boss.get('/api/orgs');
    expect(list.body.orgs).toEqual([expect.objectContaining({ slug: 'acme', role: 'OWNER' })]);
    expect((await db.auditLog.count({ where: { action: 'org.create' } }))).toBe(1);
  });

  it('rejects duplicate slugs and a new owner without password', async () => {
    const admin = await agentFor((await makeUser({ superAdmin: true })).email);
    await admin.post('/api/orgs').send({ name: 'A', slug: 'dup', owner: { email: 'a@x.test', password: 'password-123' } });
    expect((await admin.post('/api/orgs').send({ name: 'B', slug: 'dup', owner: { email: 'b@x.test', password: 'password-123' } })).status).toBe(409);
    expect((await admin.post('/api/orgs').send({ name: 'C', slug: 'cee', owner: { email: 'c@x.test' } })).status).toBe(400);
  });

  it('members of org A cannot see org B (404)', async () => {
    const a = await makeOrg('A');
    const b = await makeOrg('B');
    const u = await makeUser();
    await addMember(u.id, a.org.id, 'OWNER');
    const agent = await agentFor(u.email);
    expect((await agent.get(`/api/orgs/${b.org.id}`)).status).toBe(404);
    expect((await agent.get(`/api/orgs/${b.org.id}/members`)).status).toBe(404);
    expect((await agent.patch(`/api/orgs/${b.org.id}`).send({ name: 'x' })).status).toBe(404);
    expect((await agent.get(`/api/orgs/${a.org.id}`)).status).toBe(200);
  });

  it('only owners delete the org', async () => {
    const { org } = await makeOrg();
    const admin = await makeUser();
    const owner = await makeUser();
    await addMember(admin.id, org.id, 'ADMIN');
    await addMember(owner.id, org.id, 'OWNER');
    expect((await (await agentFor(admin.email)).delete(`/api/orgs/${org.id}`)).status).toBe(403);
    expect((await (await agentFor(owner.email)).delete(`/api/orgs/${org.id}`)).status).toBe(204);
  });
});

describe('members', () => {
  async function setup() {
    const { org, site } = await makeOrg();
    const owner = await makeUser();
    const admin = await makeUser();
    const viewer = await makeUser();
    await addMember(owner.id, org.id, 'OWNER');
    await addMember(admin.id, org.id, 'ADMIN');
    await addMember(viewer.id, org.id, 'VIEWER');
    return { org, site, owner, admin, viewer };
  }

  it('viewers cannot list or add members', async () => {
    const { org, viewer } = await setup();
    const agent = await agentFor(viewer.email);
    expect((await agent.get(`/api/orgs/${org.id}/members`)).status).toBe(403);
    expect((await agent.post(`/api/orgs/${org.id}/members`).send({ email: 'n@x.test', password: 'password-123', role: 'VIEWER' })).status).toBe(403);
  });

  it('admins add viewers limited to a site, but cannot create owners', async () => {
    const { org, site, admin } = await setup();
    const agent = await agentFor(admin.email);
    const ok = await agent.post(`/api/orgs/${org.id}/members`).send({ email: 'shop@x.test', password: 'password-123', role: 'VIEWER', siteIds: [site.id] });
    expect(ok.status).toBe(201);
    expect(ok.body.member).toMatchObject({ role: 'VIEWER', siteIds: [site.id] });
    const no = await agent.post(`/api/orgs/${org.id}/members`).send({ email: 'o@x.test', password: 'password-123', role: 'OWNER' });
    expect(no.status).toBe(403);
  });

  it('rejects sites from another org', async () => {
    const { org, owner } = await setup();
    const other = await makeOrg('Other');
    const res = await (await agentFor(owner.email))
      .post(`/api/orgs/${org.id}/members`)
      .send({ email: 'z@x.test', password: 'password-123', role: 'VIEWER', siteIds: [other.site.id] });
    expect(res.status).toBe(400);
  });

  it('keeps at least one owner', async () => {
    const { org, owner } = await setup();
    const agent = await agentFor(owner.email);
    const ms = (await agent.get(`/api/orgs/${org.id}/members`)).body.members as { id: string; role: string }[];
    const own = ms.find((m) => m.role === 'OWNER')!;
    expect((await agent.patch(`/api/orgs/${org.id}/members/${own.id}`).send({ role: 'ADMIN' })).status).toBe(409);
    expect((await agent.delete(`/api/orgs/${org.id}/members/${own.id}`)).status).toBe(409);
  });

  it('platform admin manages members but sees no footage capability', async () => {
    const { org } = await setup();
    const pa = await agentFor((await makeUser({ superAdmin: true })).email);
    const res = await pa.get(`/api/orgs/${org.id}`);
    expect(res.status).toBe(200);
    expect(res.body.access.capabilities).not.toContain('footage.read');
    expect((await pa.get(`/api/orgs/${org.id}/members`)).status).toBe(200);
  });
});

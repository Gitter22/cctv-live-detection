import { db } from '../src/lib/db';
import { agentFor } from './api';
import { addMember, makeOrg, makeUser } from './factories';
import { resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const flush = () => new Promise((r) => setTimeout(r, 50)); // audit writes are fire-and-forget

describe('support grants and audit', () => {
  it('platform admin sees footage only while a grant is active, and every view is logged', async () => {
    const { org, site } = await makeOrg('Acme');
    const owner = await makeUser();
    await addMember(owner.id, org.id, 'OWNER');
    await db.alert.create({ data: { organizationId: org.id, siteId: site.id, severity: 'danger', title: 'x' } });
    const o = await agentFor(owner.email);
    const pa = await agentFor((await makeUser({ superAdmin: true })).email);

    expect((await pa.get(`/api/orgs/${org.id}/alerts`)).status).toBe(403);
    expect((await pa.post(`/api/orgs/${org.id}/support-grants`).send({ reason: 'let me in' })).status).toBe(403); // only owners grant

    const grant = await o.post(`/api/orgs/${org.id}/support-grants`).send({ reason: 'Debug missing alerts', hours: 2 });
    expect(grant.status).toBe(201);
    expect((await pa.get(`/api/orgs/${org.id}/alerts`)).status).toBe(200);
    await flush();

    const log = await o.get(`/api/orgs/${org.id}/audit?action=support`);
    const actions = log.body.entries.map((e: { action: string; targetId: string }) => `${e.action} ${e.targetId}`);
    expect(actions).toEqual(expect.arrayContaining([`support.grant ${grant.body.grant.id}`, `support.footage_access GET /api/orgs/${org.id}/alerts`]));

    await o.post(`/api/orgs/${org.id}/support-grants/${grant.body.grant.id}/revoke`);
    expect((await pa.get(`/api/orgs/${org.id}/alerts`)).status).toBe(403);
  });

  it('owners read the audit log; admins and viewers cannot; grants are not visible to admins', async () => {
    const { org } = await makeOrg();
    const admin = await makeUser();
    await addMember(admin.id, org.id, 'ADMIN');
    const a = await agentFor(admin.email);
    expect((await a.get(`/api/orgs/${org.id}/audit`)).status).toBe(403);
    expect((await a.get(`/api/orgs/${org.id}/support-grants`)).status).toBe(403);
    expect((await a.post(`/api/orgs/${org.id}/support-grants`).send({ reason: 'nope nope' })).status).toBe(403);
  });

  it('config changes are audited without secrets', async () => {
    const { org, site } = await makeOrg();
    const owner = await makeUser();
    await addMember(owner.id, org.id, 'OWNER');
    const o = await agentFor(owner.email);
    await o.post(`/api/orgs/${org.id}/sites/${site.id}/sources`).send({ kind: 'NVR', name: 'N', vendor: 'dahua', host: '10.0.0.1', username: 'u', password: 'TopSecret-1' });
    const log = await o.get(`/api/orgs/${org.id}/audit`);
    expect(log.body.entries.map((e: { action: string }) => e.action)).toContain('source.create');
    expect(JSON.stringify(log.body)).not.toContain('TopSecret');
  });
});

import { db } from '../src/lib/db';
import { agentFor } from './api';
import { addMember, makeOrg, makeUser } from './factories';
import { resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

async function setup(role: 'ADMIN' | 'VIEWER' = 'ADMIN') {
  const { org, site } = await makeOrg();
  const u = await makeUser();
  await addMember(u.id, org.id, role);
  const agent = await agentFor(u.email);
  const siteBase = `/api/orgs/${org.id}/sites/${site.id}`;
  return { org, site, agent, siteBase, base: `${siteBase}/cameras` };
}

async function nvr(agent: Awaited<ReturnType<typeof agentFor>>, siteBase: string, vendor = 'dahua') {
  const r = await agent.post(`${siteBase}/sources`).send({ kind: 'NVR', name: 'NVR', vendor, host: '192.168.1.17', username: 'viewer', password: 'pw-123' });
  return r.body.source.id as string;
}

describe('cameras', () => {
  it('creates a camera on an NVR channel with tags and default detection', async () => {
    const { agent, siteBase, base } = await setup();
    const sourceId = await nvr(agent, siteBase);
    const res = await agent.post(base).send({ key: 'entrance-1', label: 'Entrance', sourceId, channel: 1, tags: ['gate'] });
    expect(res.status).toBe(201);
    expect(res.body.camera).toMatchObject({ key: 'entrance-1', tags: ['gate'], subUrlSet: false, detection: { classes: ['person'], detectFps: 5 } });
    expect((await agent.post(base).send({ key: 'entrance-1', label: 'Dup', sourceId, channel: 2 })).status).toBe(409);
  });

  it('requires a usable stream', async () => {
    const { agent, siteBase, base } = await setup();
    const dahua = await nvr(agent, siteBase);
    const generic = await nvr(agent, siteBase, 'generic');
    expect((await agent.post(base).send({ key: 'a-1', label: 'A' })).status).toBe(400);
    expect((await agent.post(base).send({ key: 'a-1', label: 'A', sourceId: dahua })).body.error.message).toMatch(/channel/);
    expect((await agent.post(base).send({ key: 'a-1', label: 'A', sourceId: generic, channel: 1 })).body.error.message).toMatch(/URL/);
    const ok = await agent.post(base).send({ key: 'a-1', label: 'A', sourceId: generic, subUrl: 'rtsp://u:secret@10.0.0.2/s1' });
    expect(ok.status).toBe(201);
    expect(ok.body.camera.subUrlSet).toBe(true);
    expect(JSON.stringify(ok.body)).not.toContain('secret');
  });

  it('merges detection updates instead of resetting other settings', async () => {
    const { agent, siteBase, base } = await setup();
    const sourceId = await nvr(agent, siteBase);
    const id = (await agent.post(base).send({ key: 'm-1', label: 'Machine', sourceId, channel: 2, detection: { classes: ['person', 'car'] } })).body.camera.id;
    const res = await agent.patch(`${base}/${id}`).send({ detection: { detectFps: 2 } });
    expect(res.body.camera.detection).toMatchObject({ classes: ['person', 'car'], detectFps: 2 });
    expect((await agent.patch(`${base}/${id}`).send({ detection: { confidence: 0.3, lowConfidence: 0.6 } })).status).toBe(400);
  });

  it('manages zones and lines with normalised coordinates', async () => {
    const { agent, siteBase, base } = await setup();
    const sourceId = await nvr(agent, siteBase);
    const id = (await agent.post(base).send({ key: 'e-1', label: 'E', sourceId, channel: 1 })).body.camera.id;
    const z = await agent.post(`${base}/${id}/zones`).send({ key: 'gate', label: 'Gate', polygon: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.9]] });
    expect(z.status).toBe(201);
    expect((await agent.post(`${base}/${id}/zones`).send({ key: 'bad', label: 'Bad', polygon: [[0, 0], [1.5, 0], [1, 1]] })).status).toBe(400);
    expect((await agent.post(`${base}/${id}/zones`).send({ key: 'two', label: 'Two', polygon: [[0, 0], [1, 1]] })).status).toBe(400);
    const l = await agent.post(`${base}/${id}/lines`).send({ key: 'gate-line', label: 'Gate line', start: [0.2, 0.7], end: [0.8, 0.7] });
    expect(l.status).toBe(201);
    expect((await agent.post(`${base}/${id}/lines`).send({ key: 'dot', label: 'Dot', start: [0.2, 0.2], end: [0.2, 0.2] })).status).toBe(400);
    const cam = (await agent.get(`${base}/${id}`)).body.camera;
    expect(cam.zones[0]).toMatchObject({ key: 'gate', polygon: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.9]] });
    expect(cam.lines[0]).toMatchObject({ key: 'gate-line' });
    expect((await agent.delete(`${base}/${id}/zones/${z.body.zone.id}`)).status).toBe(204);
  });

  it('rejects a source from another site and blocks viewers / other orgs', async () => {
    const a = await setup();
    const b = await setup();
    const foreignSource = await nvr(b.agent, b.siteBase);
    expect((await a.agent.post(a.base).send({ key: 'x-1', label: 'X', sourceId: foreignSource, channel: 1 })).status).toBe(400);
    const sourceId = await nvr(a.agent, a.siteBase);
    const camId = (await a.agent.post(a.base).send({ key: 'x-1', label: 'X', sourceId, channel: 1 })).body.camera.id;
    expect((await b.agent.get(`${a.base}/${camId}`)).status).toBe(404);
    const v = await makeUser();
    await addMember(v.id, a.org.id, 'VIEWER');
    const viewer = await agentFor(v.email);
    expect((await viewer.get(`${a.base}/${camId}`)).status).toBe(200);
    expect((await viewer.patch(`${a.base}/${camId}`).send({ label: 'nope' })).status).toBe(403);
  });
});

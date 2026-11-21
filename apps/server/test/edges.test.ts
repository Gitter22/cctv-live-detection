import request from 'supertest';
import { db } from '../src/lib/db';
import { app, agentFor } from './api';
import { addMember, makeOrg, makeUser } from './factories';
import { resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

async function siteWithCameras() {
  const { org, site } = await makeOrg();
  const u = await makeUser();
  await addMember(u.id, org.id, 'ADMIN');
  const agent = await agentFor(u.email);
  const siteBase = `/api/orgs/${org.id}/sites/${site.id}`;
  const sourceId = (
    await agent.post(`${siteBase}/sources`).send({ kind: 'NVR', name: 'NVR', vendor: 'dahua', host: '192.168.1.17', username: 'viewer', password: 'p@ss#1' })
  ).body.source.id;
  const cam = (await agent.post(`${siteBase}/cameras`).send({ key: 'entrance-1', label: 'Entrance', sourceId, channel: 1, tags: ['gate'] })).body.camera;
  await agent.post(`${siteBase}/cameras/${cam.id}/zones`).send({ key: 'gate', label: 'Gate', polygon: [[0, 0], [0.5, 0], [0.5, 1]] });
  const edge = await agent.post(`${siteBase}/edges`).send({ name: 'Home box' });
  return { org, site, agent, siteBase, token: edge.body.token as string, edgeId: edge.body.edge.id as string };
}

describe('edges', () => {
  it('shows the token once and stores only its hash', async () => {
    const { agent, siteBase, token, edgeId } = await siteWithCameras();
    expect(token).toMatch(/^edg_/);
    const list = await agent.get(`${siteBase}/edges`);
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(JSON.stringify(list.body)).not.toContain('tokenHash');
    const row = await db.edge.findUniqueOrThrow({ where: { id: edgeId } });
    expect(row.tokenHash).not.toContain(token);
  });

  it('serves decrypted, ready-to-use config to its edge only', async () => {
    const { token } = await siteWithCameras();
    const res = await request(app).get('/edge/v1/config').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.cameras).toHaveLength(1);
    expect(res.body.cameras[0]).toMatchObject({
      key: 'entrance-1',
      tags: ['gate'],
      streams: {
        sub: 'rtsp://viewer:p%40ss%231@192.168.1.17:554/cam/realmonitor?channel=1&subtype=1',
        main: 'rtsp://viewer:p%40ss%231@192.168.1.17:554/cam/realmonitor?channel=1&subtype=0',
      },
      zones: [{ key: 'gate' }],
      detection: { classes: ['person'] },
    });
    const other = await siteWithCameras();
    const otherCfg = await request(app).get('/edge/v1/config').set('Authorization', `Bearer ${other.token}`);
    expect(otherCfg.body.site.id).toBe(other.site.id);
  });

  it('answers 304 when the config is unchanged', async () => {
    const { token } = await siteWithCameras();
    const first = await request(app).get('/edge/v1/config').set('Authorization', `Bearer ${token}`);
    const again = await request(app).get('/edge/v1/config').set('Authorization', `Bearer ${token}`).set('If-None-Match', String(first.headers.etag));
    expect(again.status).toBe(304);
  });

  it('rejects missing, wrong and revoked tokens; user cookies do not work on edge routes', async () => {
    const { agent, siteBase, token, edgeId } = await siteWithCameras();
    expect((await request(app).get('/edge/v1/config')).status).toBe(401);
    expect((await request(app).get('/edge/v1/config').set('Authorization', 'Bearer edg_nope')).status).toBe(401);
    expect((await agent.get('/edge/v1/config')).status).toBe(401);
    await agent.post(`${siteBase}/edges/${edgeId}/revoke`);
    expect((await request(app).get('/edge/v1/config').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('edge tokens do not work on user APIs', async () => {
    const { org, token } = await siteWithCameras();
    expect((await request(app).get(`/api/orgs/${org.id}`).set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('lists misconfigured cameras as skipped instead of failing', async () => {
    const { site, org, token } = await siteWithCameras();
    await db.camera.create({ data: { organizationId: org.id, siteId: site.id, key: 'broken-9', label: 'Broken' } });
    const res = await request(app).get('/edge/v1/config').set('Authorization', `Bearer ${token}`);
    expect(res.body.skipped).toEqual([{ key: 'broken-9', reason: expect.any(String) }]);
  });
});

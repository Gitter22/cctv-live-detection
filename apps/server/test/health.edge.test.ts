import request from 'supertest';
import { db } from '../src/lib/db';
import { app, agentFor } from './api';
import { addMember, makeOrg, makeUser } from './factories';
import { resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

async function setup() {
  const { org, site } = await makeOrg();
  const admin = await makeUser();
  await addMember(admin.id, org.id, 'ADMIN');
  const agent = await agentFor(admin.email);
  const siteBase = `/api/orgs/${org.id}/sites/${site.id}`;
  const cam = (await agent.post(`${siteBase}/cameras`).send({ key: 'entrance-1', label: 'E', subUrl: 'rtsp://x/1' })).body.camera;
  const token = (await agent.post(`${siteBase}/edges`).send({ name: 'e' })).body.token as string;
  return { org, site, agent, siteBase, cam, token };
}

const heartbeat = (online: boolean) => ({
  version: '0.1.0',
  uptimeS: 10,
  vision: { online: true },
  spool: 0,
  cameras: { 'entrance-1': { online, reason: online ? null : 'no frames', since: new Date().toISOString(), metrics: { detect_fps: 0.5 } } },
});

describe('edge health', () => {
  it('stores heartbeats and exposes camera status on the camera list', async () => {
    const { agent, siteBase, token } = await setup();
    expect((await request(app).post('/edge/v1/heartbeat').set('Authorization', `Bearer ${token}`).send(heartbeat(false))).status).toBe(204);
    const list = await agent.get(`${siteBase}/cameras`);
    expect(list.body.cameras[0].status).toMatchObject({ online: false, reason: 'no frames' });
    const edges = await agent.get(`${siteBase}/edges`);
    expect(edges.body.edges[0]).toMatchObject({ version: '0.1.0' });
  });

  it('reports unknown status when the edge went quiet', async () => {
    const { agent, siteBase, token } = await setup();
    await request(app).post('/edge/v1/heartbeat').set('Authorization', `Bearer ${token}`).send(heartbeat(true));
    await db.edge.updateMany({ data: { lastSeenAt: new Date(Date.now() - 5 * 60_000) } });
    const list = await agent.get(`${siteBase}/cameras`);
    expect(list.body.cameras[0].status).toMatchObject({ online: null, reason: 'Edge not reporting' });
  });

  it('stores thumbnails; reading them needs footage access', async () => {
    const { org, agent, siteBase, cam, token } = await setup();
    const up = (key: string, body: object) => request(app).post(`/edge/v1/thumbnails/${key}`).set('Authorization', `Bearer ${token}`).send(body);
    expect((await up('entrance-1', { jpeg: JPEG.toString('base64') })).status).toBe(204);
    expect((await up('nope-9', { jpeg: JPEG.toString('base64') })).status).toBe(422);
    expect((await up('entrance-1', { jpeg: 'aGVsbG8=' })).status).toBe(400);

    const img = await agent.get(`${siteBase}/cameras/${cam.id}/thumbnail`).buffer(true);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.from(img.body)).toEqual(JPEG);

    const pa = await agentFor((await makeUser({ superAdmin: true })).email);
    expect((await pa.get(`/api/orgs/${org.id}/sites/${cam.siteId}/cameras/${cam.id}/thumbnail`)).status).toBe(403);
  });
});

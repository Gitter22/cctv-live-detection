import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { db } from '../src/lib/db';
import { app, agentFor } from './api';
import { addMember, makeOrg, makeUser } from './factories';
import { resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

async function world() {
  const { org, site } = await makeOrg('Home');
  const owner = await makeUser();
  await addMember(owner.id, org.id, 'OWNER');
  const agent = await agentFor(owner.email);
  const siteBase = `/api/orgs/${org.id}/sites/${site.id}`;
  await agent.post(`${siteBase}/cameras`).send({ key: 'entrance-1', label: 'E', subUrl: 'rtsp://x/1' });
  const token = (await agent.post(`${siteBase}/edges`).send({ name: 'e' })).body.token as string;
  const evId = randomUUID();
  await request(app)
    .post('/edge/v1/events')
    .set('Authorization', `Bearer ${token}`)
    .send({
      event: { schema: 'vision.event/v1', id: evId, type: 'zone.enter', ts: new Date().toISOString(), camera_id: 'entrance-1', zone_id: 'gate', object: { class: 'person', track_id: 1, confidence: 0.9, bbox: [0, 0, 0.5, 1] }, snapshot: { path: 'x.jpg' } },
      snapshot: JPEG.toString('base64'),
    });
  const alert = await db.alert.create({
    data: { organizationId: org.id, siteId: site.id, eventId: evId, cameraKey: 'entrance-1', severity: 'danger', title: 'Person in gate' },
  });
  return { org, site, owner, agent, alert, evId };
}

describe('alerts API', () => {
  it('lists alerts with snapshot link; snapshot is served after a permission check', async () => {
    const { org, agent } = await world();
    const list = await agent.get(`/api/orgs/${org.id}/alerts?status=OPEN`);
    expect(list.status).toBe(200);
    const a = list.body.alerts[0];
    expect(a).toMatchObject({ severity: 'danger', status: 'OPEN', snapshotUrl: expect.stringMatching(/\/snapshot$/) });
    const img = await agent.get(a.snapshotUrl).buffer(true);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.from(img.body)).toEqual(JPEG);
  });

  it('viewer acknowledges, adds a note and closes', async () => {
    const { org, alert } = await world();
    const v = await makeUser();
    await addMember(v.id, org.id, 'VIEWER');
    const viewer = await agentFor(v.email);
    const base = `/api/orgs/${org.id}/alerts/${alert.id}`;
    expect((await viewer.post(`${base}/ack`)).body.alert).toMatchObject({ status: 'ACKED', ackedById: v.id });
    expect((await viewer.post(`${base}/ack`)).status).toBe(400);
    expect((await viewer.post(`${base}/notes`).send({ text: 'It was the courier' })).body.alert.notes[0]).toMatchObject({ text: 'It was the courier' });
    expect((await viewer.post(`${base}/close`)).body.alert.status).toBe('CLOSED');
  });

  it('other orgs and site-limited members cannot see it; platform admin needs a support grant', async () => {
    const { org, alert, evId } = await world();
    const other = await makeOrg('Other');
    const stranger = await makeUser();
    await addMember(stranger.id, other.org.id, 'OWNER');
    const s = await agentFor(stranger.email);
    expect((await s.get(`/api/orgs/${org.id}/alerts/${alert.id}`)).status).toBe(404);
    expect((await s.get(`/api/orgs/${org.id}/events/${evId}/snapshot`)).status).toBe(404);

    const limitedSite = await db.site.create({ data: { organizationId: org.id, name: 'Shop', slug: 'shop' } });
    const lim = await makeUser();
    await addMember(lim.id, org.id, 'VIEWER', [limitedSite.id]);
    const l = await agentFor(lim.email);
    expect((await l.get(`/api/orgs/${org.id}/alerts`)).body.alerts).toEqual([]);
    expect((await l.get(`/api/orgs/${org.id}/alerts/${alert.id}`)).status).toBe(404);

    const pa = await agentFor((await makeUser({ superAdmin: true })).email);
    expect((await pa.get(`/api/orgs/${org.id}/alerts`)).status).toBe(403);
    expect((await pa.get(`/api/orgs/${org.id}/events/${evId}/snapshot`)).status).toBe(403);
  });

  it('lists events with filters and a cursor', async () => {
    const { org, agent } = await world();
    const res = await agent.get(`/api/orgs/${org.id}/events?type=zone.enter&limit=1`);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.nextBefore).toEqual(expect.any(String));
    const next = await agent.get(`/api/orgs/${org.id}/events?type=zone.enter&limit=1&before=${encodeURIComponent(res.body.nextBefore)}`);
    expect(next.body.events).toHaveLength(0);
  });
});

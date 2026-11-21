import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { db } from '../src/lib/db';
import { RulesRunner } from '../src/rules/runner';
import { app, agentFor } from './api';
import { addMember, makeOrg, makeUser } from './factories';
import { resetDb } from './helpers';

let runner: RulesRunner;
beforeEach(async () => {
  await resetDb();
  runner = new RulesRunner({ tickMs: 60_000, refreshMs: 60_000 });
  await runner.start();
});
afterEach(() => runner.stop());
afterAll(() => db.$disconnect());

async function site() {
  const { org, site } = await makeOrg();
  const u = await makeUser();
  await addMember(u.id, org.id, 'OWNER');
  const agent = await agentFor(u.email);
  const siteBase = `/api/orgs/${org.id}/sites/${site.id}`;
  const cam = (await agent.post(`${siteBase}/cameras`).send({ key: 'entrance-1', label: 'Entrance', subUrl: 'rtsp://x/1' })).body.camera;
  await agent.post(`${siteBase}/cameras/${cam.id}/zones`).send({ key: 'gate', label: 'Gate', polygon: [[0, 0], [1, 0], [1, 1]] });
  const token = (await agent.post(`${siteBase}/edges`).send({ name: 'e' })).body.token as string;
  return { site, agent, siteBase, token };
}

const event = (type: string, extra: object) => ({
  schema: 'vision.event/v1',
  id: randomUUID(),
  type,
  ts: new Date().toISOString(),
  camera_id: 'entrance-1',
  ...extra,
});
const personAtGate = () =>
  event('zone.enter', { zone_id: 'gate', object: { class: 'person', track_id: 1, confidence: 0.9, bbox: [0.1, 0.1, 0.3, 0.9] } });

describe('rules runner', () => {
  it('event in -> alert out (rule created after start is picked up)', async () => {
    const { site, agent, siteBase, token } = await site_();
    await agent.post(`${siteBase}/rules`).send({
      name: 'Person at gate',
      definition: { scope: { mode: 'all' }, when: { type: 'presence', zones: ['gate'] }, then: { severity: 'danger' } },
    });
    await runner.idle();
    const ev = personAtGate();
    expect((await request(app).post('/edge/v1/events').set('Authorization', `Bearer ${token}`).send({ event: ev })).status).toBe(201);
    await runner.idle();
    const alerts = await db.alert.findMany({ where: { siteId: site.id } });
    expect(alerts).toEqual([expect.objectContaining({ severity: 'danger', eventId: ev.id, cameraKey: 'entrance-1', status: 'OPEN' })]);
  });

  it('disabled rules do nothing; camera offline fires on tick', async () => {
    const { site, agent, siteBase, token } = await site_();
    await agent.post(`${siteBase}/rules`).send({
      name: 'Gate',
      enabled: false,
      definition: { scope: { mode: 'all' }, when: { type: 'presence' }, then: { severity: 'danger' } },
    });
    await agent.post(`${siteBase}/rules`).send({
      name: 'Offline',
      definition: { scope: { mode: 'all' }, when: { type: 'camera_offline', forS: 5 }, then: { severity: 'warning' } },
    });
    await runner.idle();
    const post = (e: object) => request(app).post('/edge/v1/events').set('Authorization', `Bearer ${token}`).send({ event: e });
    await post(personAtGate());
    await post(event('camera.status', { status: { online: false, reason: 'no frames' } }));
    await runner.idle();
    expect(await db.alert.count({ where: { siteId: site.id } })).toBe(0);
    await runner.tickAll(Date.now() + 6000);
    const alerts = await db.alert.findMany({ where: { siteId: site.id } });
    expect(alerts).toEqual([expect.objectContaining({ severity: 'warning', title: expect.stringMatching(/offline/) })]);
  });
});

// (named site_ to avoid shadowing in destructuring above)
const site_ = site;

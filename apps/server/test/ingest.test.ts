import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { bus } from '../src/lib/bus';
import { db } from '../src/lib/db';
import { getObject } from '../src/lib/store';
import { app, agentFor } from './api';
import { addMember, makeOrg, makeUser } from './factories';
import { resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

// Smallest valid JPEG-ish payload for the magic-byte check: SOI ... EOI
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

async function edgeFor() {
  const { org, site } = await makeOrg();
  const u = await makeUser();
  await addMember(u.id, org.id, 'ADMIN');
  const agent = await agentFor(u.email);
  const siteBase = `/api/orgs/${org.id}/sites/${site.id}`;
  await agent.post(`${siteBase}/cameras`).send({ key: 'entrance-1', label: 'E', subUrl: 'rtsp://x/1' });
  const token = (await agent.post(`${siteBase}/edges`).send({ name: 'e' })).body.token as string;
  return { org, site, token };
}

const zoneEnter = (camera = 'entrance-1') => ({
  schema: 'vision.event/v1',
  id: randomUUID(),
  type: 'zone.enter',
  ts: new Date().toISOString(),
  camera_id: camera,
  zone_id: 'gate',
  object: { class: 'person', track_id: 3, confidence: 0.9, bbox: [0.1, 0.2, 0.3, 0.9] },
  snapshot: { path: 'entrance-1/x.jpg', width: 640, height: 360 },
});

const post = (token: string, body: object) => request(app).post('/edge/v1/events').set('Authorization', `Bearer ${token}`).send(body);

describe('event ingest', () => {
  it('stores the event, its snapshot and notifies the bus', async () => {
    const { site, token } = await edgeFor();
    const seen: string[] = [];
    const listener = (e: { id: string }) => seen.push(e.id);
    bus.on('event.ingested', listener);
    const ev = zoneEnter();
    const res = await post(token, { event: ev, snapshot: JPEG.toString('base64') });
    bus.off('event.ingested', listener);
    expect(res.status).toBe(201);
    const row = await db.event.findUniqueOrThrow({ where: { id: ev.id } });
    expect(row).toMatchObject({ siteId: site.id, cameraKey: 'entrance-1', type: 'zone.enter' });
    expect(row.snapshotKey).toMatch(new RegExp(`^${site.id}/\\d{4}-\\d{2}-\\d{2}/${ev.id}\\.jpg$`));
    expect(await getObject(row.snapshotKey!)).toEqual(JPEG);
    expect(seen).toEqual([ev.id]);
  });

  it('is idempotent: a retried event is accepted but stored once', async () => {
    const { token } = await edgeFor();
    const ev = zoneEnter();
    expect((await post(token, { event: ev })).status).toBe(201);
    const again = await post(token, { event: ev });
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(await db.event.count()).toBe(1);
  });

  it('rejects invalid events and unknown cameras with 422 (edge drops them)', async () => {
    const { token } = await edgeFor();
    expect((await post(token, { event: { ...zoneEnter(), object: undefined } })).status).toBe(422);
    expect((await post(token, { event: zoneEnter('not-a-camera') })).status).toBe(422);
  });

  it('cannot inject events into another site', async () => {
    const a = await edgeFor();
    const b = await edgeFor();
    const ev = zoneEnter();
    expect((await post(b.token, { event: ev })).status).toBe(201);
    const row = await db.event.findUniqueOrThrow({ where: { id: ev.id } });
    expect(row.siteId).toBe(b.site.id);
    expect(row.siteId).not.toBe(a.site.id);
  });

  it('refuses non-JPEG snapshots and unauthenticated posts', async () => {
    const { token } = await edgeFor();
    expect((await post(token, { event: zoneEnter(), snapshot: Buffer.from('<svg/>').toString('base64') })).status).toBe(400);
    expect((await request(app).post('/edge/v1/events').send({ event: zoneEnter() })).status).toBe(401);
  });
});

describe('event ingest when the store fails', () => {
  it('commits nothing, so the retry stores event and snapshot', async () => {
    const store = await import('../src/lib/store');
    const { token } = await edgeFor();
    const ev = zoneEnter();
    const body = { event: ev, snapshot: JPEG.toString('base64') };
    const spy = vi.spyOn(store, 'putObject').mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    expect((await post(token, body)).status).toBe(500);
    expect(await db.event.count({ where: { id: ev.id } })).toBe(0);
    spy.mockRestore();
    expect((await post(token, body)).status).toBe(201);
    const row = await db.event.findUniqueOrThrow({ where: { id: ev.id } });
    expect(await getObject(row.snapshotKey!)).toEqual(JPEG);
  });
});

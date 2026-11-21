import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { db } from '../src/lib/db';
import { app, agentFor } from './api';
import { addMember, makeOrg, makeUser } from './factories';
import { resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

/** Deterministic pseudo-random unit vector; `noise` makes a "same person, other photo" variant. */
function vec(seed: number, noise = 0, noiseSeed = 99): number[] {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) - 0.5;
  const v = Array.from({ length: 128 }, rnd);
  let n = noiseSeed;
  const rnd2 = () => ((n = (n * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) - 0.5;
  const w = v.map((x) => x + noise * rnd2());
  const len = Math.hypot(...w);
  return w.map((x) => Number((x / len).toFixed(5)));
}

async function world() {
  const { org, site } = await makeOrg('Home');
  const owner = await makeUser();
  await addMember(owner.id, org.id, 'OWNER');
  const agent = await agentFor(owner.email);
  const siteBase = `/api/orgs/${org.id}/sites/${site.id}`;
  await agent.post(`${siteBase}/cameras`).send({ key: 'entrance-1', label: 'E', subUrl: 'rtsp://x/1' });
  const token = (await agent.post(`${siteBase}/edges`).send({ name: 'e' })).body.token as string;
  const faceEvent = async (embedding: number[]) => {
    const id = randomUUID();
    const res = await request(app)
      .post('/edge/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event: {
          schema: 'vision.event/v1',
          id,
          type: 'face.observed',
          ts: new Date().toISOString(),
          camera_id: 'entrance-1',
          zone_id: 'gate',
          object: { class: 'person', track_id: 1, confidence: 0.9, bbox: [0.1, 0.1, 0.3, 0.9] },
          face: { embedding, score: 0.9, bbox: [0.15, 0.12, 0.2, 0.2], size_px: 80 },
        },
      });
    expect(res.status).toBe(201);
    return db.event.findUniqueOrThrow({ where: { id } });
  };
  return { org, owner, agent, faceEvent };
}

describe('faces', () => {
  it('enrols a person from a face event; the same face later matches, a stranger does not', async () => {
    const { org, agent, faceEvent } = await world();
    const first = await faceEvent(vec(1));
    expect(first.facePersonId).toBeNull(); // nobody enrolled yet: unknown

    const person = (await agent.post(`/api/orgs/${org.id}/people`).send({ name: 'Aadil' })).body.person;
    expect((await agent.post(`/api/orgs/${org.id}/people/${person.id}/faces`).send({ eventId: first.id })).status).toBe(201);

    const again = await faceEvent(vec(1, 0.05)); // same person, slightly different photo
    expect(again.facePersonId).toBe(person.id);
    expect(again.faceSimilarity).toBeGreaterThan(0.9);

    const stranger = await faceEvent(vec(2));
    expect(stranger.facePersonId).toBeNull();

    const list = await agent.get(`/api/orgs/${org.id}/people`);
    expect(list.body.people).toEqual([expect.objectContaining({ name: 'Aadil', faces: 1 })]);
  });

  it("never matches another organization's people", async () => {
    const a = await world();
    const b = await world();
    const ev = await a.faceEvent(vec(7));
    const person = (await a.agent.post(`/api/orgs/${a.org.id}/people`).send({ name: 'A person' })).body.person;
    await a.agent.post(`/api/orgs/${a.org.id}/people/${person.id}/faces`).send({ eventId: ev.id });
    const inB = await b.faceEvent(vec(7));
    expect(inB.facePersonId).toBeNull();
    // and B cannot enrol from A's event
    const pb = (await b.agent.post(`/api/orgs/${b.org.id}/people`).send({ name: 'x' })).body.person;
    expect((await b.agent.post(`/api/orgs/${b.org.id}/people/${pb.id}/faces`).send({ eventId: ev.id })).status).toBe(404);
  });

  it('viewers see people but cannot enrol; platform admin cannot see people without a grant', async () => {
    const { org, faceEvent, agent } = await world();
    const ev = await faceEvent(vec(3));
    const person = (await agent.post(`/api/orgs/${org.id}/people`).send({ name: 'P' })).body.person;
    const v = await makeUser();
    await addMember(v.id, org.id, 'VIEWER');
    const viewer = await agentFor(v.email);
    expect((await viewer.get(`/api/orgs/${org.id}/people`)).status).toBe(200);
    expect((await viewer.post(`/api/orgs/${org.id}/people/${person.id}/faces`).send({ eventId: ev.id })).status).toBe(403);
    const pa = await agentFor((await makeUser({ superAdmin: true })).email);
    expect((await pa.get(`/api/orgs/${org.id}/people`)).status).toBe(403);
  });
});

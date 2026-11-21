import { db } from '../src/lib/db';
import { agentFor } from './api';
import { addMember, makeOrg, makeUser } from './factories';
import { resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

async function factory(role: 'ADMIN' | 'VIEWER' = 'ADMIN') {
  const { org, site } = await makeOrg('Factory');
  const u = await makeUser();
  await addMember(u.id, org.id, 'ADMIN');
  const admin = await agentFor(u.email);
  const siteBase = `/api/orgs/${org.id}/sites/${site.id}`;
  const press = (await admin.post(`${siteBase}/cameras`).send({ key: 'press-3', label: 'Press 3', subUrl: 'rtsp://x/3', tags: ['machine-area'] })).body.camera;
  await admin.post(`${siteBase}/cameras/${press.id}/zones`).send({ key: 'operator-area', label: 'Operator', polygon: [[0.1, 0.1], [0.6, 0.1], [0.6, 0.9]] });
  const gate = (await admin.post(`${siteBase}/cameras`).send({ key: 'gate-1', label: 'Gate', subUrl: 'rtsp://x/1', tags: ['gate'] })).body.camera;
  await admin.post(`${siteBase}/cameras/${gate.id}/zones`).send({ key: 'gate', label: 'Gate', polygon: [[0, 0], [1, 0], [1, 1]] });
  let agent = admin;
  if (role === 'VIEWER') {
    const v = await makeUser();
    await addMember(v.id, org.id, 'VIEWER');
    agent = await agentFor(v.email);
  }
  return { agent, base: `${siteBase}/rules` };
}

// The factory examples from docs/ARCHITECTURE.md
const intruder = {
  name: 'After-hours intruder',
  definition: {
    scope: { mode: 'tags', tags: ['gate'] },
    when: { type: 'presence', zones: ['gate'] },
    schedule: { windows: [{ start: '22:00', end: '06:00' }] },
    then: { severity: 'danger' },
  },
};
const operatorLeft = {
  name: 'Operator left machine',
  definition: {
    scope: { mode: 'cameras', cameras: ['press-3'] },
    when: { type: 'absence', zones: ['operator-area'], forS: 60 },
    schedule: { windows: [{ days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' }] },
    then: { severity: 'warning' },
  },
};
const crowding = {
  name: 'Crowding at machine',
  definition: {
    scope: { mode: 'cameras', cameras: ['press-3'] },
    when: { type: 'count', zones: ['operator-area'], op: 'gt', n: 2, forS: 10 },
    then: { severity: 'warning' },
  },
};

describe('rules API', () => {
  it('stores the factory example rules with defaults filled in', async () => {
    const { agent, base } = await factory();
    for (const r of [intruder, operatorLeft, crowding]) expect((await agent.post(base).send(r)).status).toBe(201);
    const list = (await agent.get(base)).body.rules as { name: string; definition: { when: { classes: string[] }; cooldownS: number; v: number } }[];
    expect(list.map((r) => r.name)).toEqual(['After-hours intruder', 'Crowding at machine', 'Operator left machine']);
    expect(list[0]!.definition).toMatchObject({ v: 1, cooldownS: 300, when: { classes: ['person'] } });
  });

  it('rejects unknown cameras/zones and invalid definitions', async () => {
    const { agent, base } = await factory();
    const bad = (definition: object) => agent.post(base).send({ name: 'x', definition });
    expect((await bad({ ...operatorLeft.definition, scope: { mode: 'cameras', cameras: ['nope-1'] } })).status).toBe(400);
    expect((await bad({ ...operatorLeft.definition, when: { type: 'absence', zones: ['nowhere'], forS: 60 } })).status).toBe(400);
    expect((await bad({ ...operatorLeft.definition, when: { type: 'absence', forS: 1 } })).status).toBe(400); // forS min 5
    expect((await bad({ ...intruder.definition, schedule: { windows: [{ start: '25:00', end: '06:00' }] } })).status).toBe(400);
    expect((await bad({ ...intruder.definition, then: { severity: 'catastrophic' } })).status).toBe(400);
  });

  it('updates, disables and deletes; viewers can read but not write', async () => {
    const { agent, base } = await factory();
    const id = (await agent.post(base).send(intruder)).body.rule.id;
    expect((await agent.patch(`${base}/${id}`).send({ enabled: false })).body.rule.enabled).toBe(false);
    expect((await agent.delete(`${base}/${id}`)).status).toBe(204);
    const v = await factory('VIEWER');
    expect((await v.agent.get(v.base)).status).toBe(200);
    expect((await v.agent.post(v.base).send(intruder)).status).toBe(403);
  });
});

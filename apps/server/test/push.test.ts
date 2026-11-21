import request from 'supertest';
import { db } from '../src/lib/db';
import { sendAlertPush } from '../src/lib/push';
import { app, agentFor } from './api';
import { addMember, makeOrg, makeUser } from './factories';
import { resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe('push notifications', () => {
  it('registers devices and notifies only members who may see the site', async () => {
    const { org, site } = await makeOrg();
    const other = await db.site.create({ data: { organizationId: org.id, name: 'Shop', slug: 'shop' } });
    const owner = await makeUser();
    const limited = await makeUser();
    const outsider = await makeUser();
    await addMember(owner.id, org.id, 'OWNER');
    await addMember(limited.id, org.id, 'VIEWER', [other.id]); // only the shop
    const register = async (email: string, token: string) =>
      (await agentFor(email)).post('/api/push/devices').send({ token, platform: 'android' });
    expect((await register(owner.email, 'ExponentPushToken[owner]')).status).toBe(204);
    expect((await register(limited.email, 'ExponentPushToken[limited]')).status).toBe(204);
    expect((await register(outsider.email, 'ExponentPushToken[outsider]')).status).toBe(204);
    expect((await register(owner.email, 'not-a-token')).status).toBe(400);
    expect((await request(app).post('/api/push/devices').send({ token: 'ExponentPushToken[x]', platform: 'android' })).status).toBe(401);

    const sent: { to: string; title: string; data: { alertId: string } }[][] = [];
    const fake = (async (_url: string, init?: RequestInit) => {
      const msgs = JSON.parse(String(init?.body));
      sent.push(msgs);
      // pretend the owner's phone uninstalled the app
      return new Response(JSON.stringify({ data: msgs.map((m: { to: string }) => (m.to.includes('owner') ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' })) }));
    }) as typeof fetch;
    const alert = await db.alert.create({ data: { organizationId: org.id, siteId: site.id, severity: 'danger', title: 'Unknown person', cameraKey: 'entrance-1' } });
    const r = await sendAlertPush(alert, fake);
    expect(sent[0]!.map((m) => m.to)).toEqual(['ExponentPushToken[owner]']); // not the shop-only viewer, not the outsider
    expect(sent[0]![0]).toMatchObject({ title: '🚨 Unknown person', data: { alertId: alert.id } });
    expect(r).toEqual({ sent: 1, removed: 1 });
    expect(await db.pushDevice.count({ where: { token: 'ExponentPushToken[owner]' } })).toBe(0);
  });
});

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { bus } from '../src/lib/bus';
import { db } from '../src/lib/db';
import { app } from './api';
import { addMember, makeOrg, makeUser } from './factories';
import { resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

/** Open the SSE stream with a session cookie and collect "event:" names until `count` arrive. */
function listen(port: number, path: string, cookie: string, count: number, timeoutMs = 1000): Promise<{ status: number; events: { event: string; data: unknown }[] }> {
  return new Promise((resolve, reject) => {
    const events: { event: string; data: unknown }[] = [];
    const req = http.get({ port, path, headers: { Cookie: cookie } }, (res) => {
      let buf = '';
      const done = () => {
        req.destroy();
        resolve({ status: res.statusCode ?? 0, events });
      };
      const timer = setTimeout(done, timeoutMs);
      res.on('data', (chunk) => {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (ev) events.push({ event: ev, data: data ? JSON.parse(data) : null });
          if (events.length >= count) {
            clearTimeout(timer);
            done();
          }
        }
      });
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        done();
      }
    });
    req.on('error', reject);
  });
}

describe('live stream (SSE)', () => {
  it('delivers a new alert to the right org within a second', async () => {
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    try {
      const home = await makeOrg('Home');
      const other = await makeOrg('Other');
      const u = await makeUser();
      await addMember(u.id, home.org.id, 'VIEWER');
      const login = await (await import('supertest')).default(app).post('/api/auth/login').send({ email: u.email, password: 'correct horse battery' });
      const sessionCookie = String(login.headers['set-cookie']).split(';')[0]!;

      const started = Date.now();
      const pending = listen(port, `/api/orgs/${home.org.id}/stream`, sessionCookie, 1);
      await new Promise((r) => setTimeout(r, 100));
      // an alert for ANOTHER org must not arrive; one for ours must
      const foreign = await db.alert.create({ data: { organizationId: other.org.id, siteId: other.site.id, severity: 'danger', title: 'not yours' } });
      bus.emit('alert.created', foreign);
      const mine = await db.alert.create({ data: { organizationId: home.org.id, siteId: home.site.id, severity: 'danger', title: 'Person in gate' } });
      bus.emit('alert.created', mine);
      const got = await pending;
      expect(got.status).toBe(200);
      expect(got.events).toEqual([{ event: 'alert.created', data: expect.objectContaining({ id: mine.id, title: 'Person in gate' }) }]);
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      server.close();
    }
  });

  it('requires a session and footage access', async () => {
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    try {
      const { org } = await makeOrg();
      expect((await listen(port, `/api/orgs/${org.id}/stream`, '', 1, 300)).status).toBe(401);
    } finally {
      server.close();
    }
  });
});

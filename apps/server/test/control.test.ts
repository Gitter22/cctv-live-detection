import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { EdgeHub } from '../src/edge/control';
import { db } from '../src/lib/db';
import { app, agentFor } from './api';
import { addMember, makeOrg, makeUser } from './factories';
import { resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

function open(port: number, token: string): Promise<{ ws: WebSocket; messages: { type: string; [k: string]: unknown }[] }> {
  return new Promise((resolve, reject) => {
    const messages: { type: string }[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/edge/v1/ws`, { headers: { Authorization: `Bearer ${token}` } });
    ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on('error', reject);
  });
}
const until = async (cond: () => boolean, ms = 1000) => {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
  return Date.now() - t;
};

describe('edge control channel', () => {
  it('pushes config.changed to the site edge within a second; requests get answers', async () => {
    const server = app.listen(0);
    const hub = new EdgeHub().attach(server);
    const port = (server.address() as AddressInfo).port;
    try {
      const { org, site } = await makeOrg();
      const u = await makeUser();
      await addMember(u.id, org.id, 'ADMIN');
      const agent = await agentFor(u.email);
      const siteBase = `/api/orgs/${org.id}/sites/${site.id}`;
      const token = (await agent.post(`${siteBase}/edges`).send({ name: 'e' })).body.token as string;
      const edge = await open(port, token);
      await until(() => edge.messages.some((m) => m.type === 'hello'));
      expect(hub.connected(site.id)).toBe(true);

      await agent.post(`${siteBase}/cameras`).send({ key: 'cam-1', label: 'C', subUrl: 'rtsp://x/1' });
      const took = await until(() => edge.messages.some((m) => m.type === 'config.changed'));
      expect(took).toBeLessThan(1000);

      // request/response (used for live-view signalling)
      edge.ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'request') edge.ws.send(JSON.stringify({ type: 'response', id: m.id, ok: true, result: { echo: m.params } }));
      });
      await expect(hub.request(site.id, 'ping', { a: 1 })).resolves.toEqual({ echo: { a: 1 } });
      edge.ws.close();
    } finally {
      hub.close();
      server.close();
    }
  });

  it('refuses bad tokens and reports offline sites', async () => {
    const server = app.listen(0);
    const hub = new EdgeHub().attach(server);
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(open(port, 'edg_bogus')).rejects.toThrow(/401/);
      await expect(hub.request('00000000-0000-4000-8000-000000000000', 'x', {})).rejects.toThrow(/offline/);
    } finally {
      hub.close();
      server.close();
    }
  });
});

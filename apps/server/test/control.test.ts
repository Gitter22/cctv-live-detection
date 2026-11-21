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

describe('live view signalling', () => {
  it('relays the offer to the site edge after the permission check', async () => {
    const { setEdgeHub } = await import('../src/edge/control');
    const server = app.listen(0);
    const hub = new EdgeHub().attach(server);
    setEdgeHub(hub);
    const port = (server.address() as AddressInfo).port;
    try {
      const { org, site } = await makeOrg();
      const u = await makeUser();
      await addMember(u.id, org.id, 'VIEWER');
      const admin = await makeUser();
      await addMember(admin.id, org.id, 'ADMIN');
      const a = await agentFor(admin.email);
      const siteBase = `/api/orgs/${org.id}/sites/${site.id}`;
      const cam = (await a.post(`${siteBase}/cameras`).send({ key: 'entrance-1', label: 'E', subUrl: 'rtsp://x/1' })).body.camera;
      const token = (await a.post(`${siteBase}/edges`).send({ name: 'e' })).body.token as string;
      const viewer = await agentFor(u.email);
      const offer = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';

      expect((await viewer.post(`${siteBase}/cameras/${cam.id}/webrtc`).send({ sdp: offer })).status).toBe(503); // edge offline

      const edge = await open(port, token);
      const seen: { src: string }[] = [];
      edge.ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'request' && m.method === 'webrtc.offer') {
          seen.push(m.params);
          edge.ws.send(JSON.stringify({ type: 'response', id: m.id, ok: true, result: { sdp: 'v=0\r\nanswer' } }));
        }
      });
      await until(() => hub.connected(site.id));
      const res = await viewer.post(`${siteBase}/cameras/${cam.id}/webrtc`).send({ sdp: offer, variant: 'sd_h264' });
      expect(res.status).toBe(200);
      expect(res.body.sdp).toBe('v=0\r\nanswer');
      expect(seen[0]!.src).toBe('entrance-1_h264');
      const live = await viewer.get(`${siteBase}/cameras/${cam.id}/live`);
      expect(live.body.webrtc).toMatchObject({ available: true, iceServers: expect.any(Array) });

      const pa = await agentFor((await makeUser({ superAdmin: true })).email);
      expect((await pa.post(`${siteBase}/cameras/${cam.id}/webrtc`).send({ sdp: offer })).status).toBe(403);
      edge.ws.close();
    } finally {
      setEdgeHub(null);
      hub.close();
      server.close();
    }
  });
});

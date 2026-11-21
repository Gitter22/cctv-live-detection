import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { ControlChannel } from '../src/control';

describe('ControlChannel', () => {
  it('connects with the token, reacts to config.changed and answers requests', async () => {
    const wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as AddressInfo).port;
    let auth = '';
    const responses: unknown[] = [];
    wss.on('connection', (ws, req) => {
      auth = String(req.headers.authorization);
      ws.on('message', (d) => responses.push(JSON.parse(d.toString())));
      ws.send(JSON.stringify({ type: 'config.changed' }));
      ws.send(JSON.stringify({ type: 'request', id: 'r1', method: 'echo', params: { x: 1 } }));
      ws.send(JSON.stringify({ type: 'request', id: 'r2', method: 'nope', params: {} }));
    });
    let changed = 0;
    const ch = new ControlChannel(`http://127.0.0.1:${port}`, 'edg_t', () => changed++);
    ch.handlers.set('echo', async (p) => p);
    ch.start();
    const t = Date.now();
    while (responses.length < 2 && Date.now() - t < 2000) await new Promise((r) => setTimeout(r, 10));
    ch.stop();
    wss.close();
    expect(auth).toBe('Bearer edg_t');
    expect(changed).toBeGreaterThanOrEqual(2); // once on open, once on the push
    expect(responses).toEqual(
      expect.arrayContaining([
        { type: 'response', id: 'r1', ok: true, result: { x: 1 } },
        expect.objectContaining({ id: 'r2', ok: false, error: expect.stringMatching(/Unknown method/) }),
      ]),
    );
  });
});

import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSync } from '../src/config-sync';

const config = {
  schema: 'edge.config/v1',
  site: { id: 's1', slug: 'home', name: 'Home', timezone: 'Asia/Kolkata' },
  cameras: [
    {
      key: 'entrance-1',
      label: 'Entrance',
      enabled: true,
      tags: [],
      streams: { sub: 'rtsp://u:p@nvr/1', main: null },
      detection: { classes: ['person'], confidence: 0.5, lowConfidence: 0.25, detectFps: 5, motionGate: true, faces: false },
      zones: [],
      lines: [],
    },
  ],
  skipped: [],
};

/** Minimal fake fetch: serves `config` with ETag "v1" and honours If-None-Match. */
function fakeServer() {
  const calls: { headers: Record<string, string> }[] = [];
  let status = 200;
  const impl = (async (_url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ headers });
    if (status !== 200) return new Response('', { status });
    if (headers['If-None-Match'] === '"v1"') return new Response(null, { status: 304 });
    return new Response(JSON.stringify(config), { status: 200, headers: { etag: '"v1"' } });
  }) as typeof fetch;
  return { impl, calls, setStatus: (s: number) => (status = s) };
}

describe('ConfigSync', () => {
  it('fetches, validates, caches (0600) and emits once; then uses ETag', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edge-'));
    const srv = fakeServer();
    const sync = new ConfigSync({ serverUrl: 'http://x', token: 'edg_t', stateDir: dir, pollMs: 1000, fetchImpl: srv.impl });
    const seen: unknown[] = [];
    sync.on('config', (c) => seen.push(c));
    expect(await sync.pollOnce()).toBe(true);
    expect(await sync.pollOnce()).toBe(false);
    expect(seen).toHaveLength(1);
    expect(srv.calls[0]!.headers.Authorization).toBe('Bearer edg_t');
    expect(srv.calls[1]!.headers['If-None-Match']).toBe('"v1"');
    const st = await stat(join(dir, 'config.json'));
    expect(st.mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')).config.site.slug).toBe('home');
  });

  it('starts from the cached config when the server is down', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edge-'));
    const up = fakeServer();
    await new ConfigSync({ serverUrl: 'http://x', token: 't', stateDir: dir, pollMs: 1000, fetchImpl: up.impl }).pollOnce();

    const down = fakeServer();
    down.setStatus(503);
    const sync = new ConfigSync({ serverUrl: 'http://x', token: 't', stateDir: dir, pollMs: 60_000, fetchImpl: down.impl });
    const seen: unknown[] = [];
    sync.on('config', (c) => seen.push(c));
    await sync.start();
    sync.stop();
    expect(seen).toHaveLength(1);
    expect(sync.current?.cameras[0]?.key).toBe('entrance-1');
  });

  it('rejects an invalid config and keeps the previous one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edge-'));
    const bad = (async () => new Response(JSON.stringify({ schema: 'nope' }), { status: 200 })) as typeof fetch;
    const sync = new ConfigSync({ serverUrl: 'http://x', token: 't', stateDir: dir, pollMs: 1000, fetchImpl: bad });
    expect(await sync.pollOnce()).toBe(false);
    expect(sync.current).toBeNull();
  });
});

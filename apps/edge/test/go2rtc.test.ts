import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EdgeConfig } from '@cctv/shared';
import { parse } from 'yaml';
import { applyGo2rtc, go2rtcStreams } from '../src/go2rtc';

const cam = (key: string, sub: string, main: string | null = null, enabled = true) => ({
  key,
  label: key,
  enabled,
  tags: [],
  streams: { sub, main },
  detection: { classes: ['person'], confidence: 0.5, lowConfidence: 0.25, detectFps: 5, motionGate: true, faces: false },
  zones: [],
  lines: [],
});
const cfg = (cameras: ReturnType<typeof cam>[]): EdgeConfig => ({
  schema: 'edge.config/v1',
  site: { id: 's', slug: 'home', name: 'Home', timezone: 'UTC' },
  cameras,
  skipped: [],
});

describe('go2rtc config', () => {
  it('maps cameras to sub and _main streams, skipping disabled ones', () => {
    const s = go2rtcStreams(cfg([cam('entrance-1', 'rtsp://a', 'rtsp://a-main'), cam('off-2', 'rtsp://b', null, false)]));
    expect(s).toEqual({ 'entrance-1': 'rtsp://a', 'entrance-1_main': 'rtsp://a-main' });
  });

  it('writes the file (0600) and restarts only when streams change', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'g2r-'));
    const path = join(dir, 'go2rtc.yaml');
    const restarts: string[] = [];
    const fetchImpl = (async (url: string) => {
      restarts.push(url);
      return new Response('', { status: 200 });
    }) as typeof fetch;
    const special = 'rtsp://viewer:p%40ss%23@192.168.1.17:554/cam/realmonitor?channel=1&subtype=1';
    const c1 = cfg([cam('entrance-1', special)]);

    expect(await applyGo2rtc(c1, { path, apiUrl: 'http://g', fetchImpl })).toBe(true);
    expect(await applyGo2rtc(c1, { path, apiUrl: 'http://g', fetchImpl })).toBe(false);
    expect(restarts).toEqual(['http://g/api/restart']);
    expect(((await stat(path)).mode & 0o777)).toBe(0o600);
    // URL survives YAML round trip exactly (special characters, & and ?)
    expect(parse(await readFile(path, 'utf8')).streams['entrance-1']).toBe(special);

    expect(await applyGo2rtc(cfg([cam('entrance-1', special), cam('backyard-2', 'rtsp://x')]), { path, apiUrl: 'http://g', fetchImpl })).toBe(true);
    expect(restarts).toHaveLength(2);
  });
});

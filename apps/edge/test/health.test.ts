import { HealthCollector, uploadThumbnails } from '../src/health';

const b = (o: unknown) => Buffer.from(JSON.stringify(o));

describe('HealthCollector', () => {
  it('tracks status, keeps "since" while state is unchanged, merges metrics', () => {
    const h = new HealthCollector();
    h.onCameraStatus('entrance-1', b({ ts: '2026-11-21T10:00:00Z', status: { online: true } }));
    h.onCameraStatus('entrance-1', b({ ts: '2026-11-21T10:05:00Z', status: { online: true } }));
    h.onMetrics('entrance-1', b({ detect_fps: 0.5, infer_ms_avg: 150, junk: 'x' }));
    h.onVisionService(b({ online: true }));
    const hb = h.snapshot(['entrance-1', 'backyard-2'], 3);
    expect(hb.cameras['entrance-1']).toMatchObject({ online: true, since: '2026-11-21T10:00:00Z', metrics: { detect_fps: 0.5, infer_ms_avg: 150 } });
    expect(hb.cameras['backyard-2']).toMatchObject({ online: false, reason: 'no status from vision yet' });
    expect(hb).toMatchObject({ vision: { online: true }, spool: 3 });
  });

  it('forgets a camera when its retained status is cleared', () => {
    const h = new HealthCollector();
    h.onCameraStatus('old-1', b({ status: { online: true } }));
    h.onCameraStatus('old-1', Buffer.alloc(0));
    expect(h.cameras['old-1']).toBeUndefined();
  });
});

describe('uploadThumbnails', () => {
  it('fetches a frame from go2rtc per camera and posts it', async () => {
    const calls: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('frame.jpeg')) return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200 });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const n = await uploadThumbnails({ serverUrl: 'http://s', token: 't', go2rtcApi: 'http://g', cameraKeys: ['entrance-1'], fetchImpl: f });
    expect(n).toBe(1);
    expect(calls).toEqual(['GET http://g/api/frame.jpeg?src=entrance-1', 'POST http://s/edge/v1/thumbnails/entrance-1']);
  });
});

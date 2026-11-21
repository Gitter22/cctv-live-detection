import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EdgeConfig } from '@cctv/shared';
import { parse } from 'yaml';
import { applyVision, renderVisionYaml } from '../src/vision-config';

const config: EdgeConfig = {
  schema: 'edge.config/v1',
  site: { id: 's', slug: 'factory', name: 'Factory', timezone: 'UTC' },
  cameras: [
    {
      key: 'press-3',
      label: 'Press 3',
      enabled: true,
      tags: ['machine-area'],
      streams: { sub: 'rtsp://admin:SECRET@10.0.0.3/sub', main: null },
      detection: { classes: ['person'], confidence: 0.6, lowConfidence: 0.3, detectFps: 2, motionGate: false, faces: false },
      zones: [{ key: 'operator-area', label: 'Operator', polygon: [[0.1, 0.1], [0.6, 0.1], [0.6, 0.9]] }],
      lines: [],
    },
    { key: 'off-1', label: 'Off', enabled: false, tags: [], streams: { sub: 'rtsp://x', main: null },
      detection: { classes: ['person'], confidence: 0.5, lowConfidence: 0.25, detectFps: 5, motionGate: true, faces: false }, zones: [], lines: [] },
  ],
  skipped: [],
};

describe('vision config', () => {
  it('maps per-camera detection and zones, reads go2rtc streams, contains no secrets', () => {
    const text = renderVisionYaml(config, { go2rtcRtsp: 'rtsp://go2rtc:8554/' });
    expect(text).not.toContain('SECRET');
    const doc = parse(text);
    expect(doc.cameras).toHaveLength(1);
    expect(doc.cameras[0]).toMatchObject({
      id: 'press-3',
      url: 'rtsp://go2rtc:8554/press-3',
      confidence: 0.6,
      low_confidence: 0.3,
      detect_fps: 2,
      motion_gate: false,
      zones: [{ id: 'operator-area' }],
    });
  });

  it('writes only when the content changes', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'vis-')), 'vision.yaml');
    expect(await applyVision(config, { path, go2rtcRtsp: 'rtsp://go2rtc:8554' })).toBe(true);
    expect(await applyVision(config, { path, go2rtcRtsp: 'rtsp://go2rtc:8554' })).toBe(false);
    expect(parse(await readFile(path, 'utf8')).cameras[0].id).toBe('press-3');
  });
});

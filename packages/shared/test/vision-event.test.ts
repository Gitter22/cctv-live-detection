import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VisionEvent, VisionEventType } from '../src';

// Payloads in exactly the shape services/vision publishes (captured from the live system).
const zoneEnter = {
  schema: 'vision.event/v1',
  id: '7f5bd5f7-52db-4cd5-95c5-b62caabafa10',
  type: 'zone.enter',
  ts: '2026-11-21T17:35:25.983Z',
  camera_id: 'entrance-1',
  zone_id: 'full_frame',
  object: { class: 'person', track_id: 7, confidence: 0.912, bbox: [0.41, 0.2, 0.52, 0.95], dwell_s: 0.6 },
  frame: { width: 640, height: 360 },
  snapshot: { path: 'entrance-1/2026-11-21/7f5bd5f7-52db-4cd5-95c5-b62caabafa10.jpg', width: 640, height: 360 },
};
const status = {
  schema: 'vision.event/v1',
  id: 'c1719345-9507-4d1c-a00a-4c9fcb94c00b',
  type: 'camera.status',
  ts: '2026-11-21T17:35:25.981Z',
  camera_id: 'entrance-1',
  status: { online: false, reason: 'no frames' },
};

describe('VisionEvent', () => {
  it('accepts real vision payloads', () => {
    expect(VisionEvent.parse(zoneEnter).object?.class).toBe('person');
    expect(VisionEvent.parse(status).status?.online).toBe(false);
  });

  it('rejects inconsistent events', () => {
    expect(VisionEvent.safeParse({ ...zoneEnter, object: undefined }).success).toBe(false);
    expect(VisionEvent.safeParse({ ...zoneEnter, zone_id: undefined }).success).toBe(false);
    expect(VisionEvent.safeParse({ ...zoneEnter, extra: 1 }).success).toBe(false);
    expect(VisionEvent.safeParse({ ...zoneEnter, object: { ...zoneEnter.object, bbox: [0, 0, 2, 1] } }).success).toBe(false);
  });

  it('stays in sync with the JSON Schema used by Python', () => {
    const json = JSON.parse(readFileSync(join(__dirname, '../schemas/vision-event.v1.json'), 'utf8'));
    expect(json.properties.type.enum).toEqual(VisionEventType.options);
    expect(json.properties.schema.const).toBe('vision.event/v1');
    expect(Object.keys(json.properties).sort()).toEqual(Object.keys(VisionEvent.shape).sort());
  });
});

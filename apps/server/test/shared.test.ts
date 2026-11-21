import { VisionEvent, topics } from '@cctv/shared';

describe('@cctv/shared from the server (CommonJS)', () => {
  it('validates a vision event and builds topics', () => {
    const ev = VisionEvent.parse({
      schema: 'vision.event/v1',
      id: 'dba23ec2-629b-47c3-9621-25493bd6d1e3',
      type: 'camera.status',
      ts: '2026-11-21T17:35:25.983Z',
      camera_id: 'firstfloor-3',
      status: { online: true },
    });
    expect(ev.camera_id).toBe('firstfloor-3');
    expect(topics().events('firstfloor-3', 'zone.enter')).toBe('cctv/v1/events/firstfloor-3/zone.enter');
  });
});

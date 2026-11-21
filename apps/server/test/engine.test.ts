import { RuleDefinition, type VisionEvent } from '@cctv/shared';
import { RuleEngine, type EngineCamera } from '../src/rules/engine';
import { scheduleActive } from '../src/rules/schedule';

const TZ = 'Asia/Kolkata'; // UTC+5:30
/** Epoch ms for an IST wall-clock time on Mon 2026-11-23. */
const ist = (hhmm: string, dayOffset = 0) => Date.parse(`2026-11-${String(23 + dayOffset).padStart(2, '0')}T${hhmm}:00+05:30`);

const cams: EngineCamera[] = [
  { key: 'gate-1', label: 'Gate', tags: ['gate'], zones: ['gate'] },
  { key: 'press-3', label: 'Press 3', tags: ['machine-area'], zones: ['operator-area'] },
];
const rule = (id: string, def: object) => ({ id, name: id, definition: RuleDefinition.parse(def) });

let seq = 0;
const base = (type: VisionEvent['type'], camera: string, at: number): VisionEvent =>
  ({ schema: 'vision.event/v1', id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, type, ts: new Date(at).toISOString(), camera_id: camera }) as VisionEvent;
const enter = (camera: string, zone: string, track: number, at: number, cls = 'person'): VisionEvent => ({
  ...base('zone.enter', camera, at),
  zone_id: zone,
  object: { class: cls, track_id: track, confidence: 0.9, bbox: [0.1, 0.1, 0.2, 0.9] },
});
const exit = (camera: string, zone: string, track: number, at: number): VisionEvent => ({ ...enter(camera, zone, track, at), type: 'zone.exit' });
const status = (camera: string, online: boolean, at: number): VisionEvent => ({ ...base('camera.status', camera, at), status: { online } });

describe('schedule', () => {
  const night = { windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '22:00', end: '06:00' }] };
  it('handles overnight windows in the site timezone', () => {
    expect(scheduleActive(night, TZ, ist('23:30'))).toBe(true);
    expect(scheduleActive(night, TZ, ist('05:59'))).toBe(true);
    expect(scheduleActive(night, TZ, ist('06:00'))).toBe(false);
    expect(scheduleActive(night, TZ, ist('12:00'))).toBe(false);
  });
  it('uses the start day for overnight windows', () => {
    const fridayNight = { windows: [{ days: [5], start: '22:00', end: '06:00' }] };
    const fri = 4; // Mon 23 + 4 = Fri 27
    expect(scheduleActive(fridayNight, TZ, ist('23:00', fri))).toBe(true);
    expect(scheduleActive(fridayNight, TZ, ist('02:00', fri + 1))).toBe(true); // Saturday early morning
    expect(scheduleActive(fridayNight, TZ, ist('23:00', fri + 1))).toBe(false); // Saturday night
  });
});

describe('presence', () => {
  const intruder = rule('intruder', {
    scope: { mode: 'tags', tags: ['gate'] },
    when: { type: 'presence', zones: ['gate'] },
    schedule: { windows: [{ start: '22:00', end: '06:00' }] },
    then: { severity: 'danger' },
  });

  it('fires at night only, on the right camera, with the triggering event', () => {
    const e = new RuleEngine(TZ, cams, [intruder]);
    expect(e.handleEvent(enter('gate-1', 'gate', 1, ist('14:00')))).toEqual([]);
    const ev = enter('gate-1', 'gate', 2, ist('23:10'));
    const out = e.handleEvent(ev);
    expect(out).toEqual([expect.objectContaining({ ruleId: 'intruder', cameraKey: 'gate-1', severity: 'danger', eventId: ev.id, zone: 'gate' })]);
    expect(out[0]!.title).toMatch(/Person in gate · Gate/);
    expect(e.handleEvent(enter('press-3', 'operator-area', 3, ist('23:11')))).toEqual([]);
  });

  it('respects the cooldown per camera', () => {
    const e = new RuleEngine(TZ, cams, [intruder]);
    expect(e.handleEvent(enter('gate-1', 'gate', 1, ist('23:00')))).toHaveLength(1);
    expect(e.handleEvent(enter('gate-1', 'gate', 2, ist('23:02')))).toHaveLength(0); // within 300 s
    expect(e.handleEvent(enter('gate-1', 'gate', 3, ist('23:06')))).toHaveLength(1);
  });

  it('ignores other classes', () => {
    const e = new RuleEngine(TZ, cams, [intruder]);
    expect(e.handleEvent(enter('gate-1', 'gate', 1, ist('23:00'), 'dog'))).toEqual([]);
  });

  it('minimum dwell fires on tick only if the object is still there', () => {
    const loiter = rule('loiter', { scope: { mode: 'all' }, when: { type: 'presence', minDwellS: 30 }, then: { severity: 'warning' } });
    const e = new RuleEngine(TZ, cams, [loiter]);
    expect(e.handleEvent(enter('gate-1', 'gate', 1, ist('10:00')))).toEqual([]);
    expect(e.tick(ist('10:00') + 20_000)).toEqual([]);
    expect(e.tick(ist('10:00') + 31_000)).toHaveLength(1);
    // second visitor leaves before 30 s: nothing
    e.handleEvent(enter('gate-1', 'gate', 2, ist('11:00')));
    e.handleEvent(exit('gate-1', 'gate', 2, ist('11:00') + 10_000));
    expect(e.tick(ist('11:00') + 40_000)).toEqual([]);
  });
});

describe('factory: operator left machine (absence)', () => {
  const left = rule('left', {
    scope: { mode: 'cameras', cameras: ['press-3'] },
    when: { type: 'absence', zones: ['operator-area'], forS: 60 },
    schedule: { windows: [{ days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' }] },
    then: { severity: 'warning' },
    cooldownS: 0,
  });

  it('fires once per absence episode during shift hours and re-arms when the operator returns', () => {
    const e = new RuleEngine(TZ, cams, [left], ist('07:00'));
    expect(e.tick(ist('07:30'))).toEqual([]); // before shift: not measured
    expect(e.tick(ist('08:00'))).toEqual([]); // starts counting at 08:00
    const fired = e.tick(ist('08:01') + 1000);
    expect(fired).toEqual([expect.objectContaining({ ruleId: 'left', cameraKey: 'press-3', zone: 'operator-area' })]);
    expect(e.tick(ist('08:05'))).toEqual([]); // same episode
    e.handleEvent(enter('press-3', 'operator-area', 7, ist('08:10')));
    expect(e.tick(ist('08:30'))).toEqual([]); // operator present
    e.handleEvent(exit('press-3', 'operator-area', 7, ist('08:40')));
    expect(e.tick(ist('08:40') + 30_000)).toEqual([]);
    expect(e.tick(ist('08:41') + 1000)).toHaveLength(1); // new episode
  });

  it('does not judge an offline camera', () => {
    const e = new RuleEngine(TZ, cams, [left], ist('07:00'));
    e.handleEvent(status('press-3', false, ist('09:00')));
    expect(e.tick(ist('09:10'))).toEqual([]);
  });
});

describe('factory: crowding (count)', () => {
  const crowd = rule('crowd', {
    scope: { mode: 'cameras', cameras: ['press-3'] },
    when: { type: 'count', zones: ['operator-area'], op: 'gt', n: 2, forS: 10 },
    then: { severity: 'warning' },
  });
  it('fires when more than 2 people stay for 10 s', () => {
    const e = new RuleEngine(TZ, cams, [crowd]);
    const t = ist('10:00');
    for (const tr of [1, 2, 3]) e.handleEvent(enter('press-3', 'operator-area', tr, t));
    expect(e.tick(t + 5000)).toEqual([]);
    expect(e.tick(t + 11_000)).toEqual([expect.objectContaining({ ruleId: 'crowd' })]);
    expect(e.tick(t + 20_000)).toEqual([]);
  });
});

describe('line crossing and camera offline', () => {
  it('matches line and direction', () => {
    const r = rule('in', { scope: { mode: 'all' }, when: { type: 'line_cross', lines: ['gate-line'], direction: 'in' }, then: { severity: 'info' } });
    const e = new RuleEngine(TZ, cams, [r]);
    const cross = (dir: 'in' | 'out', at: number): VisionEvent => ({
      ...base('line.cross', 'gate-1', at),
      line_id: 'gate-line',
      direction: dir,
      object: { class: 'person', track_id: 1, confidence: 0.9, bbox: [0, 0, 1, 1] },
    });
    expect(e.handleEvent(cross('out', ist('10:00')))).toEqual([]);
    expect(e.handleEvent(cross('in', ist('10:01')))).toHaveLength(1);
  });

  it('fires when a camera stays offline, once, and re-arms after it comes back', () => {
    const r = rule('off', { scope: { mode: 'all' }, when: { type: 'camera_offline', forS: 60 }, then: { severity: 'warning' }, cooldownS: 0 });
    const e = new RuleEngine(TZ, cams, [r]);
    e.handleEvent(status('gate-1', false, ist('10:00')));
    expect(e.tick(ist('10:00') + 30_000)).toEqual([]);
    expect(e.tick(ist('10:01') + 1000)).toEqual([expect.objectContaining({ cameraKey: 'gate-1', title: expect.stringMatching(/offline/) })]);
    expect(e.tick(ist('10:05'))).toEqual([]);
    e.handleEvent(status('gate-1', true, ist('10:06')));
    e.handleEvent(status('gate-1', false, ist('10:07')));
    expect(e.tick(ist('10:08') + 1000)).toHaveLength(1);
  });
});

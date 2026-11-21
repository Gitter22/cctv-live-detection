import type { RuleCondition, RuleDefinition, Severity, VisionEvent } from '@cctv/shared';
import { scheduleActive } from './schedule';

/**
 * Rules engine for ONE site. Pure: no DB, no timers, time is passed in. The caller feeds it
 * ingested VisionEvents (`handleEvent`) and calls `tick(now)` every few seconds for
 * time-based conditions (dwell, absence, count duration, camera offline).
 *
 * It keeps zone occupancy from zone.enter / zone.exit, so absence and count need no
 * vision changes. State is in memory: after a server restart occupancy starts empty.
 */

export interface EngineCamera {
  key: string;
  label: string;
  tags: string[];
  zones: string[];
}

export interface EngineRule {
  id: string;
  name: string;
  definition: RuleDefinition;
}

export interface AlertDraft {
  ruleId: string;
  cameraKey: string;
  severity: Severity;
  title: string;
  eventId: string | null;
  zone: string | null;
  at: number;
}

interface Track {
  cls: string;
  since: number;
}

interface Episode {
  /** When the condition became true (null = not true now). */
  since: number | null;
  fired: boolean;
}

export class RuleEngine {
  private cameras = new Map<string, EngineCamera>();
  private rules: EngineRule[] = [];
  /** camera -> zone -> trackId -> track */
  private occupancy = new Map<string, Map<string, Map<number, Track>>>();
  private online = new Map<string, { online: boolean; since: number }>();
  private episodes = new Map<string, Episode>();
  private pendingDwell = new Map<string, { ruleId: string; camera: string; zone: string; track: number; enteredAt: number; eventId: string }>();
  private lastFired = new Map<string, number>();

  constructor(
    public timezone: string,
    cameras: EngineCamera[],
    rules: EngineRule[],
    private readonly startedAt = Date.now(),
  ) {
    this.configure(timezone, cameras, rules);
  }

  /** Replace cameras/rules (on config change). Occupancy and episodes are kept. */
  configure(timezone: string, cameras: EngineCamera[], rules: EngineRule[]) {
    this.timezone = timezone;
    this.cameras = new Map(cameras.map((c) => [c.key, c]));
    this.rules = rules;
    const ids = new Set(rules.map((r) => r.id));
    for (const k of [...this.episodes.keys()]) if (!ids.has(k.split('|')[0]!)) this.episodes.delete(k);
    for (const [k, p] of this.pendingDwell) if (!ids.has(p.ruleId)) this.pendingDwell.delete(k);
  }

  // ---------------------------------------------------------------- inputs

  handleEvent(ev: VisionEvent, now = Date.parse(ev.ts)): AlertDraft[] {
    const out: AlertDraft[] = [];
    const cam = ev.camera_id;

    if (ev.type === 'camera.status' && ev.status) {
      const prev = this.online.get(cam);
      if (!prev || prev.online !== ev.status.online) this.online.set(cam, { online: ev.status.online, since: now });
      if (!ev.status.online) this.occupancy.delete(cam); // tracks are gone with the stream
    }

    if (ev.type === 'zone.enter' && ev.zone_id && ev.object) {
      const enteredAt = now - (ev.object.dwell_s ?? 0) * 1000;
      this.zoneTracks(cam, ev.zone_id).set(ev.object.track_id, { cls: ev.object.class, since: enteredAt });
      for (const rule of this.matching(cam, 'presence')) {
        const w = rule.definition.when as Extract<RuleCondition, { type: 'presence' }>;
        if (!w.classes.includes(ev.object.class) || !zoneMatches(w.zones, ev.zone_id)) continue;
        if (w.minDwellS === 0) this.fire(out, rule, cam, now, ev.id, ev.zone_id, `${cap(ev.object.class)} in ${ev.zone_id}`);
        else {
          this.pendingDwell.set(`${rule.id}|${cam}|${ev.zone_id}|${ev.object.track_id}`, {
            ruleId: rule.id,
            camera: cam,
            zone: ev.zone_id,
            track: ev.object.track_id,
            enteredAt,
            eventId: ev.id,
          });
        }
      }
    }

    if (ev.type === 'zone.exit' && ev.zone_id && ev.object) {
      this.occupancy.get(cam)?.get(ev.zone_id)?.delete(ev.object.track_id);
      for (const [k, p] of this.pendingDwell) {
        if (p.camera === cam && p.zone === ev.zone_id && p.track === ev.object.track_id) this.pendingDwell.delete(k);
      }
    }

    if (ev.type === 'line.cross' && ev.line_id && ev.object) {
      for (const rule of this.matching(cam, 'line_cross')) {
        const w = rule.definition.when as Extract<RuleCondition, { type: 'line_cross' }>;
        if (!w.classes.includes(ev.object.class)) continue;
        if (w.lines?.length && !w.lines.includes(ev.line_id)) continue;
        if (w.direction !== 'any' && ev.direction !== w.direction) continue;
        this.fire(out, rule, cam, now, ev.id, null, `${cap(ev.object.class)} crossed ${ev.line_id}${ev.direction ? ` (${ev.direction})` : ''}`);
      }
    }

    // Occupancy changed: count conditions with forS=0 can fire right away.
    out.push(...this.evaluateStates(now, ev.id));
    return out;
  }

  tick(now = Date.now()): AlertDraft[] {
    const out: AlertDraft[] = [];
    for (const [k, p] of this.pendingDwell) {
      const rule = this.rules.find((r) => r.id === p.ruleId);
      const w = rule?.definition.when;
      if (!rule || w?.type !== 'presence') {
        this.pendingDwell.delete(k);
        continue;
      }
      if (now - p.enteredAt >= w.minDwellS * 1000) {
        this.pendingDwell.delete(k);
        const tr = this.occupancy.get(p.camera)?.get(p.zone)?.get(p.track);
        if (tr) this.fire(out, rule, p.camera, now, p.eventId, p.zone, `${cap(tr.cls)} in ${p.zone} for ${w.minDwellS}s`);
      }
    }
    out.push(...this.evaluateStates(now, null));
    return out;
  }

  // ---------------------------------------------------------------- state conditions

  private evaluateStates(now: number, eventId: string | null): AlertDraft[] {
    const out: AlertDraft[] = [];
    for (const rule of this.rules) {
      const w = rule.definition.when;
      if (w.type !== 'absence' && w.type !== 'count' && w.type !== 'camera_offline') continue;
      for (const cam of this.scopedCameras(rule)) {
        if (w.type === 'camera_offline') {
          const st = this.online.get(cam.key);
          const ep = this.episode(`${rule.id}|${cam.key}`);
          if (!st || st.online) {
            ep.since = null;
            ep.fired = false;
            continue;
          }
          ep.since ??= st.since;
          if (!ep.fired && now - ep.since >= w.forS * 1000 && this.active(rule, now)) {
            ep.fired = true;
            this.fire(out, rule, cam.key, now, eventId, null, `Camera ${cam.label} offline`);
          }
          continue;
        }
        const cameraUp = this.online.get(cam.key)?.online !== false;
        for (const zone of w.zones?.length ? w.zones.filter((z) => cam.zones.includes(z)) : cam.zones) {
          const ep = this.episode(`${rule.id}|${cam.key}|${zone}`);
          const n = [...(this.occupancy.get(cam.key)?.get(zone)?.values() ?? [])].filter((t) => w.classes.includes(t.cls)).length;
          const holds = w.type === 'absence' ? n === 0 : w.op === 'gt' ? n > w.n : n < w.n;
          // Can't judge an offline camera; outside the schedule nothing is measured.
          if (!holds || !cameraUp || !this.active(rule, now)) {
            ep.since = null;
            ep.fired = false;
            continue;
          }
          ep.since ??= w.type === 'absence' ? Math.max(now, this.startedAt) : now;
          if (!ep.fired && now - ep.since >= w.forS * 1000) {
            ep.fired = true;
            const what = w.classes.map(cap).join('/');
            const title = w.type === 'absence' ? `No ${what.toLowerCase()} in ${zone} for ${w.forS}s` : `${n} ${what.toLowerCase()} in ${zone} (${w.op === 'gt' ? '>' : '<'} ${w.n})`;
            this.fire(out, rule, cam.key, now, eventId, zone, title);
          }
        }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- helpers

  private fire(out: AlertDraft[], rule: EngineRule, camera: string, now: number, eventId: string | null, zone: string | null, auto: string) {
    if (!this.active(rule, now)) return;
    const key = `${rule.id}|${camera}`;
    const last = this.lastFired.get(key);
    if (last !== undefined && now - last < rule.definition.cooldownS * 1000) return;
    this.lastFired.set(key, now);
    const label = this.cameras.get(camera)?.label ?? camera;
    out.push({
      ruleId: rule.id,
      cameraKey: camera,
      severity: rule.definition.then.severity,
      title: rule.definition.then.title || `${auto} · ${label}`,
      eventId,
      zone,
      at: now,
    });
  }

  private active(rule: EngineRule, now: number) {
    return scheduleActive(rule.definition.schedule, this.timezone, now);
  }

  private matching(cameraKey: string, type: RuleCondition['type']) {
    const cam = this.cameras.get(cameraKey);
    if (!cam) return [];
    return this.rules.filter((r) => r.definition.when.type === type && scopeMatches(r.definition, cam));
  }

  private scopedCameras(rule: EngineRule) {
    return [...this.cameras.values()].filter((c) => scopeMatches(rule.definition, c));
  }

  private zoneTracks(camera: string, zone: string) {
    let zones = this.occupancy.get(camera);
    if (!zones) this.occupancy.set(camera, (zones = new Map()));
    let tracks = zones.get(zone);
    if (!tracks) zones.set(zone, (tracks = new Map()));
    return tracks;
  }

  private episode(key: string): Episode {
    let ep = this.episodes.get(key);
    if (!ep) this.episodes.set(key, (ep = { since: null, fired: false }));
    return ep;
  }
}

export function scopeMatches(def: RuleDefinition, cam: EngineCamera): boolean {
  const s = def.scope;
  if (s.mode === 'all') return true;
  if (s.mode === 'tags') return s.tags.some((t) => cam.tags.includes(t));
  return s.cameras.includes(cam.key);
}

const zoneMatches = (zones: string[] | undefined, zone: string) => !zones?.length || zones.includes(zone);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

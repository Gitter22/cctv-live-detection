import type { CameraHealth, EdgeHeartbeat } from '@cctv/shared';
import { logger } from './logger';

const VERSION = process.env.npm_package_version ?? '0.1.0';
const started = Date.now();

/** Collects camera/vision state from vision's retained MQTT topics and reports it to the server. */
export class HealthCollector {
  cameras: Record<string, CameraHealth> = {};
  visionOnline = false;

  onCameraStatus(cameraKey: string, payload: Buffer) {
    if (!payload.length) {
      delete this.cameras[cameraKey]; // retained value cleared: camera removed
      return;
    }
    try {
      const ev = JSON.parse(payload.toString('utf8')) as { ts?: string; status?: { online: boolean; reason?: string | null } };
      if (!ev.status) return;
      const prev = this.cameras[cameraKey];
      this.cameras[cameraKey] = {
        online: ev.status.online,
        reason: ev.status.reason ?? null,
        since: prev && prev.online === ev.status.online ? prev.since : (ev.ts ?? new Date().toISOString()),
        metrics: prev?.metrics ?? null,
      };
    } catch {
      // ignore malformed
    }
  }

  onMetrics(cameraKey: string, payload: Buffer) {
    if (!payload.length) return;
    try {
      const m = JSON.parse(payload.toString('utf8')) as Record<string, unknown>;
      const cam = (this.cameras[cameraKey] ??= { online: Boolean(m.online), reason: null, since: null, metrics: null });
      cam.metrics = {
        decode_fps: num(m.decode_fps),
        detect_fps: num(m.detect_fps),
        infer_ms_avg: num(m.infer_ms_avg),
        frame_age_ms_avg: num(m.frame_age_ms_avg),
      };
    } catch {
      // ignore malformed
    }
  }

  onVisionService(payload: Buffer) {
    try {
      this.visionOnline = Boolean((JSON.parse(payload.toString('utf8')) as { online?: boolean }).online);
    } catch {
      this.visionOnline = false;
    }
  }

  /** Only cameras of the current config are reported. */
  snapshot(cameraKeys: string[], spool: number, liveUrl?: string): EdgeHeartbeat {
    const cameras: Record<string, CameraHealth> = {};
    for (const key of cameraKeys) cameras[key] = this.cameras[key] ?? { online: false, reason: 'no status from vision yet', since: null, metrics: null };
    return { version: VERSION, uptimeS: Math.round((Date.now() - started) / 1000), vision: { online: this.visionOnline }, spool, cameras, liveUrl: liveUrl ?? null };
  }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function sendHeartbeat(serverUrl: string, token: string, hb: EdgeHeartbeat, fetchImpl: typeof fetch = fetch) {
  try {
    const res = await fetchImpl(`${serverUrl}/edge/v1/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(hb),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) logger.warn({ status: res.status }, 'heartbeat rejected');
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'heartbeat failed (server unreachable)');
  }
}

/** Grab a JPEG still per camera from go2rtc and upload it (for the zone editor). */
export async function uploadThumbnails(opts: {
  serverUrl: string;
  token: string;
  go2rtcApi: string;
  cameraKeys: string[];
  fetchImpl?: typeof fetch;
}): Promise<number> {
  const f = opts.fetchImpl ?? fetch;
  let ok = 0;
  for (const key of opts.cameraKeys) {
    try {
      const frame = await f(`${opts.go2rtcApi}/api/frame.jpeg?src=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(20_000) });
      if (!frame.ok) continue;
      const jpeg = Buffer.from(await frame.arrayBuffer()).toString('base64');
      const res = await f(`${opts.serverUrl}/edge/v1/thumbnails/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jpeg }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) ok++;
    } catch (err) {
      logger.debug({ camera: key, err: (err as Error).message }, 'thumbnail failed');
    }
  }
  if (opts.cameraKeys.length) logger.info({ uploaded: ok, of: opts.cameraKeys.length }, 'thumbnails uploaded');
  return ok;
}

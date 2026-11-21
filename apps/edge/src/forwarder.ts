import { readFile } from 'node:fs/promises';
import { normalize, join, sep } from 'node:path';
import mqtt, { type MqttClient } from 'mqtt';
import { logger } from './logger';
import { Spool } from './spool';

export interface SpooledEvent {
  event: { id: string; camera_id: string; type: string; snapshot?: { path: string } | null };
  snapshot?: string; // base64 JPEG
}

export interface ForwarderOptions {
  serverUrl: string;
  token: string;
  spool: Spool<SpooledEvent>;
  snapshotDir: string;
  fetchImpl?: typeof fetch;
}

/**
 * Vision events -> server. MQTT message -> spool on disk -> upload in order.
 *   2xx           delivered (also "duplicate": the server already had it)  -> remove
 *   400/413/422   permanently invalid                                      -> remove + log
 *   401 / 5xx / network                                                    -> keep, retry later
 */
export class Forwarder {
  private draining: Promise<void> | null = null;
  private retryAt = 0;
  private failures = 0;
  delivered = 0;

  constructor(private readonly opts: ForwarderOptions) {}

  /** Called for every vision event received on MQTT. */
  async accept(payload: Buffer): Promise<void> {
    let event: SpooledEvent['event'];
    try {
      event = JSON.parse(payload.toString('utf8'));
    } catch {
      logger.warn('ignoring non-JSON MQTT message');
      return;
    }
    if (!event?.id) return;
    const item: SpooledEvent = { event };
    if (event.snapshot?.path) {
      const snap = await this.readSnapshot(event.snapshot.path);
      if (snap) item.snapshot = snap.toString('base64');
    }
    await this.opts.spool.add(event.id, item);
    void this.drain();
  }

  private async readSnapshot(rel: string): Promise<Buffer | null> {
    const root = normalize(this.opts.snapshotDir);
    const p = normalize(join(root, rel));
    if (!p.startsWith(root + sep)) return null; // never read outside the snapshot dir
    try {
      return await readFile(p);
    } catch {
      return null;
    }
  }

  /** Upload spooled events oldest-first until empty or the server is unavailable.
   *  Concurrent callers share the drain already in progress. */
  drain(): Promise<void> {
    if (this.draining) return this.draining;
    if (Date.now() < this.retryAt) return Promise.resolve();
    this.draining = this.drainOnce().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async drainOnce(): Promise<void> {
    {
      for (const name of await this.opts.spool.list()) {
        const item = await this.opts.spool.read(name).catch(() => null);
        if (!item) {
          await this.opts.spool.remove(name);
          continue;
        }
        const status = await this.post(item);
        if (status === null || status === 401 || status >= 500 || status === 429) {
          this.failures++;
          const wait = Math.min(1000 * 2 ** Math.min(this.failures, 6), 60_000);
          this.retryAt = Date.now() + wait;
          logger.warn({ status, retryInMs: wait }, 'server unavailable for events; keeping them spooled');
          return;
        }
        this.failures = 0;
        if (status >= 400) logger.warn({ status, event: item.event.id, camera: item.event.camera_id }, 'server rejected event; dropping it');
        else this.delivered++;
        await this.opts.spool.remove(name);
      }
    }
  }

  private async post(item: SpooledEvent): Promise<number | null> {
    try {
      const res = await (this.opts.fetchImpl ?? fetch)(`${this.opts.serverUrl}/edge/v1/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.opts.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
        signal: AbortSignal.timeout(20_000),
      });
      return res.status;
    } catch {
      return null;
    }
  }
}

/** Subscribe to vision events on the local broker and feed the forwarder. */
export function connectMqtt(url: string, prefix: string, forwarder: Forwarder): MqttClient {
  const client = mqtt.connect(url, { clientId: `edge-${process.pid}`, reconnectPeriod: 2000, clean: false });
  const topic = `${prefix}/events/+/+`;
  client.on('connect', () => {
    logger.info({ topic }, 'mqtt connected');
    client.subscribe(topic, { qos: 1 });
  });
  client.on('error', (err) => logger.warn({ err: err.message }, 'mqtt error'));
  client.on('message', (_t, payload) => {
    forwarder.accept(payload).catch((err) => logger.error({ err }, 'spooling event failed'));
  });
  return client;
}

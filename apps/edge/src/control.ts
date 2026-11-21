import { WebSocket } from 'ws';
import { logger } from './logger';

export type RequestHandler = (params: unknown) => Promise<unknown>;

/**
 * Outbound WebSocket to the server (no inbound ports at the site). Reconnects with backoff.
 *   { type: 'config.changed' }            -> onConfigChanged()
 *   { type: 'request', id, method, params} -> handlers[method](params) -> { type: 'response', ... }
 */
export class ControlChannel {
  private ws: WebSocket | null = null;
  private stopped = false;
  private failures = 0;
  readonly handlers = new Map<string, RequestHandler>();

  constructor(
    private readonly serverUrl: string,
    private readonly token: string,
    private readonly onConfigChanged: () => void,
  ) {}

  start() {
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
  }

  private connect() {
    const url = `${this.serverUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/edge/v1/ws`;
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${this.token}` }, handshakeTimeout: 10_000 });
    this.ws = ws;
    ws.on('open', () => {
      this.failures = 0;
      logger.info('control channel connected');
      this.onConfigChanged(); // we may have missed changes while disconnected
    });
    ws.on('message', (data) => void this.onMessage(ws, data.toString()));
    ws.on('unexpected-response', (_req, res) => logger.warn({ status: res.statusCode }, 'control channel refused (token revoked?)'));
    ws.on('error', (err) => logger.debug({ err: err.message }, 'control channel error'));
    ws.on('close', () => {
      if (this.stopped) return;
      this.failures++;
      const wait = Math.min(1000 * 2 ** Math.min(this.failures, 6), 60_000);
      setTimeout(() => this.connect(), wait);
    });
  }

  private async onMessage(ws: WebSocket, text: string) {
    let msg: { type?: string; id?: string; method?: string; params?: unknown };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type === 'config.changed') return this.onConfigChanged();
    if (msg.type !== 'request' || !msg.id) return;
    const handler = msg.method ? this.handlers.get(msg.method) : undefined;
    try {
      if (!handler) throw new Error(`Unknown method ${msg.method}`);
      const result = await handler(msg.params);
      ws.send(JSON.stringify({ type: 'response', id: msg.id, ok: true, result }));
    } catch (err) {
      ws.send(JSON.stringify({ type: 'response', id: msg.id, ok: false, error: (err as Error).message }));
    }
  }
}

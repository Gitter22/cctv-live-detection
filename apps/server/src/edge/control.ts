import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { bus } from '../lib/bus';
import { db } from '../lib/db';
import { logger } from '../lib/logger';
import { hashEdgeToken } from './edge-auth';

/**
 * Edge control channel: each edge keeps ONE outbound WebSocket to the server (no ports opened
 * at the site). Used to push "config changed" instantly and to relay live-view signalling.
 *
 * Messages (JSON):
 *   server -> edge  { type: 'config.changed' }
 *   server -> edge  { type: 'request', id, method, params }   (expects a 'response' with the same id)
 *   edge -> server  { type: 'response', id, ok, result?, error? }
 */
interface Conn {
  ws: WebSocket;
  edgeId: string;
  siteId: string;
  alive: boolean;
}

export class EdgeHub {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });
  private conns = new Map<string, Conn>(); // edgeId -> conn
  private pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void; timer: NodeJS.Timeout }>();
  private pinger: NodeJS.Timeout | null = null;

  attach(server: Server) {
    server.on('upgrade', (req, socket, head) => {
      if (!req.url?.startsWith('/edge/v1/ws')) return; // not ours (another handler may take it)
      void this.authenticate(req, socket, head);
    });
    bus.on('site.config.changed', this.onConfigChanged);
    this.pinger = setInterval(() => this.pingAll(), 25_000);
    return this;
  }

  close() {
    bus.off('site.config.changed', this.onConfigChanged);
    if (this.pinger) clearInterval(this.pinger);
    for (const c of this.conns.values()) c.ws.terminate();
    this.wss.close();
  }

  /** Is an edge of this site connected right now? */
  connected(siteId: string) {
    return [...this.conns.values()].some((c) => c.siteId === siteId && c.ws.readyState === WebSocket.OPEN);
  }

  /** Send a request to an edge of the site and wait for its response. */
  request<T = unknown>(siteId: string, method: string, params: unknown, timeoutMs = 10_000): Promise<T> {
    const conn = [...this.conns.values()].find((c) => c.siteId === siteId && c.ws.readyState === WebSocket.OPEN);
    if (!conn) return Promise.reject(new Error('The site is offline (no edge connected)'));
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The edge did not answer in time'));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      conn.ws.send(JSON.stringify({ type: 'request', id, method, params }));
    });
  }

  private onConfigChanged = (siteId: string) => {
    for (const c of this.conns.values()) {
      if (c.siteId === siteId && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: 'config.changed' }));
    }
  };

  private async authenticate(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const edge = token.startsWith('edg_') ? await db.edge.findUnique({ where: { tokenHash: hashEdgeToken(token) } }) : null;
    if (!edge || edge.status !== 'ACTIVE') {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const prev = this.conns.get(edge.id);
      if (prev) prev.ws.terminate(); // one connection per edge
      const conn: Conn = { ws, edgeId: edge.id, siteId: edge.siteId, alive: true };
      this.conns.set(edge.id, conn);
      logger.info({ edge: edge.id }, 'edge control channel connected');
      ws.on('pong', () => (conn.alive = true));
      ws.on('message', (data) => this.onMessage(data.toString()));
      ws.on('close', () => {
        if (this.conns.get(edge.id) === conn) this.conns.delete(edge.id);
      });
      ws.send(JSON.stringify({ type: 'hello', edgeId: edge.id }));
    });
  }

  private onMessage(text: string) {
    let msg: { type?: string; id?: string; ok?: boolean; result?: unknown; error?: string };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type === 'response' && msg.id) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error ?? 'Edge request failed'));
    }
  }

  private pingAll() {
    for (const [id, c] of this.conns) {
      if (!c.alive) {
        c.ws.terminate();
        this.conns.delete(id);
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }
}

/** The process-wide hub (set in server.ts). Routes use it for live-view signalling. */
export let edgeHub: EdgeHub | null = null;
export function setEdgeHub(h: EdgeHub | null) {
  edgeHub = h;
}

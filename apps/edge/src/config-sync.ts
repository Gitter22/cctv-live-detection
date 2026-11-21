import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { EdgeConfig } from '@cctv/shared';
import { logger } from './logger';

export interface ConfigSyncOptions {
  serverUrl: string;
  token: string;
  stateDir: string;
  pollMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * Keeps the site config in sync with the server.
 *  - polls GET /edge/v1/config with If-None-Match (304 = unchanged, almost free)
 *  - validates the response against the shared schema before using it
 *  - caches the last good config on disk: after a restart without server, the site keeps running
 *  - emits "config" (EdgeConfig) whenever the content changes
 */
export class ConfigSync extends EventEmitter {
  private etag: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private failures = 0;
  current: EdgeConfig | null = null;

  constructor(private readonly opts: ConfigSyncOptions) {
    super();
  }

  private get cachePath() {
    return join(this.opts.stateDir, 'config.json');
  }

  /** Load the cached config (if any), then start polling. */
  async start(): Promise<void> {
    try {
      const cached = JSON.parse(await readFile(this.cachePath, 'utf8')) as { etag: string; config: unknown };
      this.current = EdgeConfig.parse(cached.config);
      this.etag = cached.etag;
      logger.info({ cameras: this.current.cameras.length }, 'using cached config until the server answers');
      this.emit('config', this.current);
    } catch {
      // no cache yet
    }
    await this.pollOnce();
    this.schedule();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule() {
    // Back off while the server is unreachable: poll, 2x, 4x ... up to 2 min.
    const delay = Math.min(this.opts.pollMs * 2 ** Math.min(this.failures, 4), 120_000);
    this.timer = setTimeout(async () => {
      await this.pollOnce();
      if (this.timer) this.schedule();
    }, delay);
  }

  /** One request. Returns true if a new config was applied. */
  async pollOnce(): Promise<boolean> {
    const fetchFn = this.opts.fetchImpl ?? fetch;
    try {
      const res = await fetchFn(`${this.opts.serverUrl}/edge/v1/config`, {
        headers: { Authorization: `Bearer ${this.opts.token}`, ...(this.etag ? { 'If-None-Match': this.etag } : {}) },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 304) {
        this.failures = 0;
        return false;
      }
      if (res.status === 401) {
        this.failures++;
        logger.error('server rejected the edge token (revoked or wrong EDGE_TOKEN); keeping last config');
        return false;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const config = EdgeConfig.parse(await res.json());
      this.failures = 0;
      this.etag = res.headers.get('etag');
      this.current = config;
      await this.saveCache(config);
      logger.info({ cameras: config.cameras.length, skipped: config.skipped }, 'config updated');
      this.emit('config', config);
      return true;
    } catch (err) {
      this.failures++;
      logger.warn({ err: (err as Error).message, failures: this.failures }, 'config fetch failed; keeping last config');
      return false;
    }
  }

  private async saveCache(config: EdgeConfig) {
    await mkdir(dirname(this.cachePath), { recursive: true });
    const tmp = `${this.cachePath}.tmp`;
    // The cache contains stream URLs with credentials: owner-only file permissions.
    await writeFile(tmp, JSON.stringify({ etag: this.etag, config }), { mode: 0o600 });
    await rename(tmp, this.cachePath);
  }
}

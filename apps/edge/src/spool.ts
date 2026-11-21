import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Durable FIFO on disk: every event is written here BEFORE upload and removed only after the
 * server accepted it. A server outage or an edge restart loses nothing (up to `max` items;
 * beyond that the oldest are dropped so the disk can't fill up).
 */
export class Spool<T> {
  private seq = 0;

  constructor(
    private readonly dir: string,
    private readonly max = 5000,
  ) {}

  async init() {
    await mkdir(this.dir, { recursive: true });
  }

  async add(id: string, item: T): Promise<void> {
    // Sortable name: time + counter keeps arrival order.
    const name = `${Date.now().toString().padStart(15, '0')}-${(this.seq++ % 1e6).toString().padStart(6, '0')}-${id}.json`;
    const tmp = join(this.dir, `.${name}.tmp`);
    await writeFile(tmp, JSON.stringify(item));
    await rename(tmp, join(this.dir, name));
    await this.trim();
  }

  async list(): Promise<string[]> {
    return (await readdir(this.dir)).filter((f) => f.endsWith('.json') && !f.startsWith('.')).sort();
  }

  async read(name: string): Promise<T> {
    return JSON.parse(await readFile(join(this.dir, name), 'utf8')) as T;
  }

  async remove(name: string): Promise<void> {
    await rm(join(this.dir, name), { force: true });
  }

  private async trim() {
    const files = await this.list();
    for (const f of files.slice(0, Math.max(0, files.length - this.max))) await this.remove(f);
  }
}

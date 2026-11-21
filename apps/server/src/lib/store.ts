import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { env } from '../config/env';

/**
 * Disk store for snapshots and thumbnails (MinIO/S3 can replace it behind the same functions).
 * Keys look like "<siteId>/2026-11-21/<eventId>.jpg" and are never built from user input
 * without validation, so a key can't escape the store root.
 */
function root() {
  return normalize(env().SNAPSHOT_STORE);
}

export function storePath(key: string): string {
  const p = normalize(join(root(), key));
  if (!p.startsWith(root() + sep)) throw new Error('Invalid store key');
  return p;
}

export function isJpeg(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
}

export async function putObject(key: string, data: Buffer): Promise<void> {
  const p = storePath(key);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, p);
}

export async function getObject(key: string): Promise<Buffer | null> {
  try {
    return await readFile(storePath(key));
  } catch {
    return null;
  }
}

export const snapshotKey = (siteId: string, eventId: string, ts: Date) =>
  `${siteId}/${ts.toISOString().slice(0, 10)}/${eventId}.jpg`;

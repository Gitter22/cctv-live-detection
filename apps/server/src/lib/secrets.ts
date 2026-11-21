import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env';

/**
 * Secrets at rest (NVR passwords, RTSP URLs with credentials): AES-256-GCM.
 *
 * Stored format:  v1:<iv b64>:<auth tag b64>:<ciphertext b64>
 *   - "v1" = key version, so SECRETS_KEY can be rotated later (decrypt old, re-encrypt new).
 *   - `context` is bound as additional authenticated data (AAD), e.g. "source:<id>:password".
 *     A ciphertext copied to another row/field then fails to decrypt instead of leaking.
 */
const VERSION = 'v1';

function key(): Buffer {
  return Buffer.from(env().SECRETS_KEY, 'hex');
}

export function encryptSecret(plain: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(stored: string, context: string): string {
  const [version, ivB64, tagB64, ctB64] = stored.split(':');
  if (version !== VERSION || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error('Unsupported secret format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

/**
 * Replace every `<name>Enc` field with `<name>Set: boolean` for API output.
 * Secrets are write-only: clients can learn whether one is set, never its value.
 */
export function redactSecrets<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.endsWith('Enc')) out[`${k.slice(0, -3)}Set`] = v != null && v !== '';
    else out[k] = v;
  }
  return out;
}

/** Hide credentials in an RTSP URL for logs: rtsp://user:***@host/... */
export function maskUrl(url: string): string {
  return url.replace(/(\/\/[^:/@]+:)[^@]*@/, '$1***@');
}

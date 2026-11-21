import { createHmac } from 'node:crypto';
import { env } from '../config/env';

/**
 * Short-lived TURN credentials (coturn "use-auth-secret", the TURN REST API scheme):
 *   username   = "<expiry unix seconds>:<userId>"
 *   credential = base64(HMAC-SHA1(TURN_SECRET, username))
 * coturn checks the signature and the expiry, so only logged-in users can use the relay,
 * and a leaked credential stops working by itself.
 */
export function turnCredentials(userId: string, now = Date.now()) {
  const { TURN_URLS: urls, TURN_SECRET: secret, TURN_TTL_S: ttl } = env();
  if (!urls.length || !secret) return null;
  const username = `${Math.floor(now / 1000) + ttl}:${userId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { urls, username, credential };
}

/** ICE servers for a viewer: configured STUN servers + a personal TURN entry if TURN is set up. */
export function iceServersFor(userId: string) {
  const turn = turnCredentials(userId);
  return turn ? [...env().ICE_SERVERS, turn] : env().ICE_SERVERS;
}

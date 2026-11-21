import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../lib/db';
import { unauthorized } from '../lib/http';

export interface EdgeAuth {
  id: string;
  siteId: string;
  organizationId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    edge?: EdgeAuth;
  }
}

/** New edge token: "edg_" + 32 random bytes (base64url). Only its sha256 is stored. */
export function newEdgeToken(): { token: string; tokenHash: string } {
  const token = `edg_${randomBytes(32).toString('base64url')}`;
  return { token, tokenHash: hashEdgeToken(token) };
}

export function hashEdgeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Only update lastSeenAt this often per edge (avoid a DB write on every poll). */
const SEEN_WRITE_INTERVAL_MS = 30_000;
const lastSeenWrite = new Map<string, number>();

/** Authenticate /edge/v1/* requests: `Authorization: Bearer edg_...`, edge must be ACTIVE. */
export async function edgeAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token?.startsWith('edg_')) return next(unauthorized('Edge token required'));
  const edge = await db.edge.findUnique({ where: { tokenHash: hashEdgeToken(token) } });
  if (!edge || edge.status !== 'ACTIVE') return next(unauthorized('Invalid or revoked edge token'));

  req.edge = { id: edge.id, siteId: edge.siteId, organizationId: edge.organizationId };
  const now = Date.now();
  if (now - (lastSeenWrite.get(edge.id) ?? 0) > SEEN_WRITE_INTERVAL_MS) {
    lastSeenWrite.set(edge.id, now);
    await db.edge.update({ where: { id: edge.id }, data: { lastSeenAt: new Date(now) } });
  }
  next();
}

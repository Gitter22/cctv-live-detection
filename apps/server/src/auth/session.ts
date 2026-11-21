import type { CookieOptions, NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { db } from '../lib/db';
import { forbidden, unauthorized } from '../lib/http';

export const SESSION_COOKIE = 'cctv_session';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  platformRole: 'SUPER_ADMIN' | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `authenticate` when a valid session is present. */
    user?: AuthUser;
  }
}

export function signSession(userId: string): string {
  return jwt.sign({}, env().JWT_SECRET, {
    subject: userId,
    expiresIn: `${env().JWT_TTL_HOURS}h`,
    algorithm: 'HS256',
    audience: 'cctv-web',
  });
}

export function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().NODE_ENV === 'production',
    path: '/',
    maxAge: env().JWT_TTL_HOURS * 3600 * 1000,
  };
}

function readToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
}

/** Attach req.user if a valid session token is present. Never throws for anonymous requests. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, env().JWT_SECRET, { algorithms: ['HS256'], audience: 'cctv-web' });
    const userId = typeof payload === 'object' ? payload.sub : undefined;
    if (!userId) return next();
    const user = await db.user.findUnique({ where: { id: userId } });
    if (user && !user.disabled) {
      req.user = { id: user.id, email: user.email, name: user.name, platformRole: user.platformRole };
    }
  } catch {
    // expired or invalid token: treat as anonymous
  }
  next();
}

export function requireUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/**
 * CSRF guard for cookie sessions. SameSite=Lax already stops cross-site POSTs carrying the
 * cookie; additionally, a state-changing request that carries an Origin header must come
 * from an allowed web origin. Non-browser clients (mobile app, edge) send no Origin and
 * authenticate with a Bearer token.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Bearer-token requests (mobile app, its WebView player) can't be forged cross-site:
  // a malicious page can't read the token. Only cookie sessions need the origin check.
  if (req.headers.authorization?.startsWith('Bearer ') && !(req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE]) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  const host = req.headers.host;
  const allowed = env().WEB_ORIGINS.includes(origin) || (host && new URL(origin).host === host);
  if (!allowed) return next(forbidden('Cross-site request blocked'));
  next();
}

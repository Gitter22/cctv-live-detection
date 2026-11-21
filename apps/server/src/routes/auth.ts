import { Router } from 'express';
import { z } from 'zod';
import { DUMMY_HASH, verifyPassword } from '../auth/password';
import { RateLimiter } from '../auth/rate-limit';
import { SESSION_COOKIE, cookieOptions, requireUser, signSession } from '../auth/session';
import { db } from '../lib/db';
import { HttpError, unauthorized } from '../lib/http';

export const authRouter = Router();

/** 10 failed logins per email+IP per 15 minutes. */
export const loginLimiter = new RateLimiter(10, 15 * 60 * 1000);

const LoginBody = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1).max(200) });

authRouter.post('/auth/login', async (req, res) => {
  const { email, password } = LoginBody.parse(req.body);
  const key = `${email}|${req.ip}`;
  if (!loginLimiter.hit(key)) throw new HttpError(429, 'Too many attempts, try again later', 'rate_limited');

  const user = await db.user.findUnique({ where: { email } });
  // Always run a hash comparison so unknown emails take as long as wrong passwords.
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || user.disabled) throw unauthorized('Wrong email or password');

  loginLimiter.reset(key);
  const token = signSession(user.id);
  res.cookie(SESSION_COOKIE, token, cookieOptions());
  // Mobile clients can't use httpOnly cookies conveniently: they ask for the token explicitly.
  const wantsToken = req.headers['x-client'] === 'mobile';
  res.json({ user: { id: user.id, email: user.email, name: user.name }, ...(wantsToken ? { token } : {}) });
});

authRouter.post('/auth/logout', (_req, res) => {
  const { maxAge: _maxAge, ...opts } = cookieOptions();
  res.clearCookie(SESSION_COOKIE, opts);
  res.status(204).end();
});

authRouter.get('/auth/me', async (req, res) => {
  const user = requireUser(req);
  const memberships = await db.membership.findMany({
    where: { userId: user.id },
    include: { organization: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json({
    user,
    memberships: memberships.map((m) => ({
      organization: m.organization,
      role: m.role,
      siteIds: m.siteIds,
    })),
  });
});

import request from 'supertest';
import { createApp } from '../src/app';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { loginLimiter } from '../src/routes/auth';
import { db } from '../src/lib/db';
import { PASSWORD, addMember, makeOrg, makeUser } from './factories';
import { resetDb } from './helpers';

const app = createApp();
beforeEach(async () => {
  await resetDb();
  (loginLimiter as unknown as { hits: Map<string, number[]> }).hits.clear();
});
afterAll(() => db.$disconnect());

const login = (email: string, password = PASSWORD, origin?: string) => {
  const r = request(app).post('/api/auth/login').send({ email, password });
  return origin ? r.set('Origin', origin) : r;
};

describe('passwords', () => {
  it('hashes and verifies', async () => {
    const h = await hashPassword('pw-123456');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('pw-123456', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
});

describe('login', () => {
  it('sets an httpOnly SameSite=Lax session cookie and returns no token to browsers', async () => {
    const u = await makeUser();
    const res = await login(u.email);
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/cctv_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(res.body.token).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('gives the token to mobile clients', async () => {
    const u = await makeUser();
    const res = await login(u.email).set('X-Client', 'mobile');
    expect(typeof res.body.token).toBe('string');
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
  });

  it('rejects wrong password, unknown email and disabled users with the same message', async () => {
    const u = await makeUser();
    const d = await makeUser({ disabled: true });
    const a = await login(u.email, 'nope');
    const b = await login('nobody@test.local');
    const c = await login(d.email);
    for (const r of [a, b, c]) {
      expect(r.status).toBe(401);
      expect(r.body.error.message).toBe('Wrong email or password');
    }
  });

  it('rate limits repeated failures', async () => {
    const u = await makeUser();
    for (let i = 0; i < 10; i++) await login(u.email, 'nope');
    const res = await login(u.email);
    expect(res.status).toBe(429);
  });
});

describe('session', () => {
  it('/me needs a session and returns memberships', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const u = await makeUser();
    const { org } = await makeOrg('Home');
    await addMember(u.id, org.id, 'OWNER');
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: u.email, password: PASSWORD });
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.memberships[0]).toMatchObject({ role: 'OWNER', organization: { name: 'Home' } });
  });

  it('rejects a tampered token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer abc.def.ghi');
    expect(res.status).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(/cctv_session=;/);
  });

  it('blocks state-changing requests from foreign origins (CSRF)', async () => {
    const u = await makeUser();
    expect((await login(u.email, PASSWORD, 'https://evil.example')).status).toBe(403);
    expect((await login(u.email, PASSWORD, 'http://localhost:5173')).status).toBe(200);
  });
});

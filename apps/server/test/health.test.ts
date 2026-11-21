import request from 'supertest';
import { createApp } from '../src/app';
import { loadEnv } from '../src/config/env';

describe('health', () => {
  it('returns ok', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('unknown API routes return JSON 404', async () => {
    const res = await request(createApp()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

describe('env', () => {
  it('rejects a short JWT secret and a bad secrets key', () => {
    expect(() =>
      loadEnv({ DATABASE_URL: 'postgresql://x@y/z', JWT_SECRET: 'short', SECRETS_KEY: 'abc' } as NodeJS.ProcessEnv),
    ).toThrow(/JWT_SECRET[\s\S]*SECRETS_KEY/);
  });
});

// Runs in every test worker (and from global-setup). Tests always use a separate *_test database.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
const base = process.env.DATABASE_URL ?? 'postgresql://cctv:cctv@localhost:5434/cctv';
if (!/_test(\?|$)/.test(new URL(base).pathname + '?')) {
  const u = new URL(base);
  u.pathname = `${u.pathname.replace(/\/$/, '')}_test`;
  process.env.DATABASE_URL = u.toString();
}
process.env.JWT_SECRET = 'test-jwt-secret-test-jwt-secret-1234';
process.env.SECRETS_KEY = '0'.repeat(63) + '1';
process.env.WEB_ORIGINS = 'http://localhost:5173';
process.env.SNAPSHOT_STORE = './data/test-store';

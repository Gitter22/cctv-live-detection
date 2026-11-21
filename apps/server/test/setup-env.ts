// Test defaults. Real values come from the environment (CI or `npm test` with a DB).
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.DATABASE_URL ??= 'postgresql://cctv:cctv@localhost:5434/cctv_test';
process.env.JWT_SECRET ??= 'test-jwt-secret-test-jwt-secret-1234';
process.env.SECRETS_KEY ??= '0'.repeat(63) + '1';
process.env.WEB_ORIGINS ??= 'http://localhost:5173';
process.env.SNAPSHOT_STORE ??= './data/test-store';

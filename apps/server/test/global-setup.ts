import { execSync } from 'node:child_process';
import './setup-env';

/**
 * Once per test run: bring the separate *_test database up to the latest migration.
 * (Non-destructive `migrate deploy`; each test file empties tables itself via resetDb.)
 */
export default function setup() {
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: process.env });
}

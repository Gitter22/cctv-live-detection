/**
 * Create (or keep) the platform super admin from SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD.
 * Idempotent: an existing user keeps its password; only the platform role is ensured.
 *
 *   npm run seed -w apps/server
 */
import { hashPassword } from '../auth/password';
import { env } from '../config/env';
import { db } from '../lib/db';

export async function seedSuperAdmin() {
  const { SUPERADMIN_EMAIL: email, SUPERADMIN_PASSWORD: password, SUPERADMIN_NAME: name } = env();
  if (!email || !password) {
    console.log('SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD not set: skipping super admin');
    return null;
  }
  const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    if (existing.platformRole !== 'SUPER_ADMIN') {
      await db.user.update({ where: { id: existing.id }, data: { platformRole: 'SUPER_ADMIN' } });
    }
    console.log(`super admin ok: ${existing.email}`);
    return existing;
  }
  const user = await db.user.create({
    data: { email: email.toLowerCase(), name, passwordHash: await hashPassword(password), platformRole: 'SUPER_ADMIN' },
  });
  console.log(`super admin created: ${user.email}`);
  return user;
}

if (require.main === module) {
  seedSuperAdmin()
    .then(() => db.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await db.$disconnect();
      process.exit(1);
    });
}

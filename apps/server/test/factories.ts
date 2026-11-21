import type { OrgRole } from '@prisma/client';
import { hashPassword } from '../src/auth/password';
import { db } from '../src/lib/db';

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

export const PASSWORD = 'correct horse battery';

export async function makeUser(opts: { email?: string; superAdmin?: boolean; disabled?: boolean } = {}) {
  return db.user.create({
    data: {
      email: opts.email ?? `u${uniq()}@test.local`,
      name: 'Test User',
      passwordHash: await hashPassword(PASSWORD),
      platformRole: opts.superAdmin ? 'SUPER_ADMIN' : null,
      disabled: opts.disabled ?? false,
    },
  });
}

export async function makeOrg(name = 'Org') {
  const slug = `org-${uniq()}`;
  const org = await db.organization.create({ data: { name, slug } });
  const site = await db.site.create({ data: { organizationId: org.id, name: `${name} site`, slug: 'main', timezone: 'Asia/Kolkata' } });
  return { org, site };
}

export async function addMember(userId: string, organizationId: string, role: OrgRole, siteIds: string[] = []) {
  return db.membership.create({ data: { userId, organizationId, role, siteIds } });
}

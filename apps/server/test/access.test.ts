import { loadSite, orgAccess, requireCap, scopeWhere } from '../src/access/access';
import type { AuthUser } from '../src/auth/session';
import { db } from '../src/lib/db';
import { addMember, makeOrg, makeUser } from './factories';
import { resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const asAuth = (u: { id: string; email: string; name: string; platformRole: 'SUPER_ADMIN' | null }): AuthUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  platformRole: u.platformRole,
});

describe('access layer', () => {
  it('hides other organizations completely (404, not 403)', async () => {
    const a = await makeOrg('A');
    const b = await makeOrg('B');
    const u = await makeUser();
    await addMember(u.id, a.org.id, 'OWNER');
    await expect(orgAccess(asAuth(u), b.org.id)).rejects.toMatchObject({ status: 404 });
    await expect(orgAccess(asAuth(u), 'not-a-uuid')).rejects.toMatchObject({ status: 404 });
    const access = await orgAccess(asAuth(u), a.org.id);
    await expect(loadSite(access, b.site.id)).rejects.toMatchObject({ status: 404 });
  });

  it('gives viewers read + alerts but not config writes', async () => {
    const { org } = await makeOrg();
    const u = await makeUser();
    await addMember(u.id, org.id, 'VIEWER');
    const access = await orgAccess(asAuth(u), org.id);
    expect(() => requireCap(access, 'footage.read')).not.toThrow();
    expect(() => requireCap(access, 'alerts.manage')).not.toThrow();
    expect(() => requireCap(access, 'config.write')).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => requireCap(access, 'members.manage')).toThrow();
  });

  it('only owners hold org.owner', async () => {
    const { org } = await makeOrg();
    const admin = await makeUser();
    const owner = await makeUser();
    await addMember(admin.id, org.id, 'ADMIN');
    await addMember(owner.id, org.id, 'OWNER');
    expect((await orgAccess(asAuth(admin), org.id)).caps.has('org.owner')).toBe(false);
    expect((await orgAccess(asAuth(owner), org.id)).caps.has('org.owner')).toBe(true);
  });

  it('limits site-restricted members to their sites', async () => {
    const { org, site } = await makeOrg();
    const other = await db.site.create({ data: { organizationId: org.id, name: 'Shop 2', slug: 'shop-2' } });
    const u = await makeUser();
    await addMember(u.id, org.id, 'VIEWER', [site.id]);
    const access = await orgAccess(asAuth(u), org.id);
    await expect(loadSite(access, site.id)).resolves.toMatchObject({ id: site.id });
    await expect(loadSite(access, other.id)).rejects.toMatchObject({ status: 404 });
    expect(scopeWhere(access)).toEqual({ organizationId: org.id, siteId: { in: [site.id] } });
  });

  it('platform admin: configuration yes, footage only with an active support grant', async () => {
    const { org } = await makeOrg();
    const owner = await makeUser();
    await addMember(owner.id, org.id, 'OWNER');
    const admin = await makeUser({ superAdmin: true });

    let access = await orgAccess(asAuth(admin), org.id);
    expect(access.caps.has('config.write')).toBe(true);
    expect(access.caps.has('footage.read')).toBe(false);
    expect(access.caps.has('alerts.manage')).toBe(false);

    await db.supportGrant.create({
      data: { organizationId: org.id, grantedById: owner.id, reason: 'debug', expiresAt: new Date(Date.now() - 1000) },
    });
    access = await orgAccess(asAuth(admin), org.id);
    expect(access.caps.has('footage.read')).toBe(false); // expired

    await db.supportGrant.create({
      data: { organizationId: org.id, grantedById: owner.id, reason: 'debug', expiresAt: new Date(Date.now() + 60_000) },
    });
    access = await orgAccess(asAuth(admin), org.id);
    expect(access.caps.has('footage.read')).toBe(true);
    expect(access.supportGrantActive).toBe(true);
  });
});

import type { OrgRole, Prisma } from '@prisma/client';
import { ORG_ROLE_RANK } from '@cctv/shared';
import type { AuthUser } from '../auth/session';
import { db } from '../lib/db';
import { forbidden, notFound } from '../lib/http';

/**
 * THE place where permissions are decided. Routes call `orgAccess` + `require*`; they never
 * compare roles themselves. See docs/ARCHITECTURE.md "Roles and permissions".
 *
 * Capabilities:
 *   config.read      see sites, sources, cameras, zones, rules, edges (never secret values)
 *   config.write     create/update/delete configuration
 *   members.manage   manage the org's users and roles
 *   footage.read     events, snapshots, clips, live view
 *   alerts.manage    acknowledge / close / annotate alerts
 *   org.owner        support grants, delete the org
 */
export type Capability = 'config.read' | 'config.write' | 'members.manage' | 'footage.read' | 'alerts.manage' | 'org.owner';

const ROLE_CAPS: Record<OrgRole, Capability[]> = {
  VIEWER: ['config.read', 'footage.read', 'alerts.manage'],
  ADMIN: ['config.read', 'config.write', 'members.manage', 'footage.read', 'alerts.manage'],
  OWNER: ['config.read', 'config.write', 'members.manage', 'footage.read', 'alerts.manage', 'org.owner'],
};

/** Platform admin: configuration and health only. Footage needs an active support grant. */
const PLATFORM_CAPS: Capability[] = ['config.read', 'config.write', 'members.manage'];

export interface OrgAccess {
  organizationId: string;
  userId: string;
  role: OrgRole | null;
  /** Empty = all sites of the org. */
  siteIds: string[];
  platformAdmin: boolean;
  supportGrantActive: boolean;
  caps: Set<Capability>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve what `user` may do in `organizationId`.
 * Users who are neither members nor platform admins get 404 (the org "does not exist" for them).
 */
export async function orgAccess(user: AuthUser, organizationId: string | undefined): Promise<OrgAccess> {
  if (!organizationId || !UUID.test(organizationId)) throw notFound();
  const platformAdmin = user.platformRole === 'SUPER_ADMIN';
  const [membership, org] = await Promise.all([
    db.membership.findUnique({ where: { userId_organizationId: { userId: user.id, organizationId } } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { id: true } }),
  ]);
  if (!org || (!membership && !platformAdmin)) throw notFound();

  const caps = new Set<Capability>(membership ? ROLE_CAPS[membership.role] : []);
  let supportGrantActive = false;
  if (platformAdmin) {
    PLATFORM_CAPS.forEach((c) => caps.add(c));
    if (!membership) {
      const grant = await db.supportGrant.findFirst({
        where: { organizationId, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      supportGrantActive = !!grant;
      if (supportGrantActive) caps.add('footage.read');
    }
  }
  return {
    organizationId,
    userId: user.id,
    role: membership?.role ?? null,
    // A platform admin who is not a member sees every site (configuration only).
    siteIds: membership?.siteIds ?? [],
    platformAdmin,
    supportGrantActive,
    caps,
  };
}

/** Throw 403 unless the capability is held. */
export function requireCap(access: OrgAccess, cap: Capability): void {
  if (!access.caps.has(cap)) throw forbidden(`Missing permission: ${cap}`);
}

export function hasRoleAtLeast(access: OrgAccess, role: OrgRole): boolean {
  return access.role != null && ORG_ROLE_RANK[access.role] >= ORG_ROLE_RANK[role];
}

/** Is this site inside the caller's site limit? (Org match is checked by the query filter.) */
export function siteInScope(access: OrgAccess, siteId: string): boolean {
  return access.siteIds.length === 0 || access.siteIds.includes(siteId);
}

/** Prisma filter for site-owned rows (sites use `id`, everything else `siteId`). */
export function scopeWhere(access: OrgAccess): { organizationId: string; siteId?: { in: string[] } } {
  return access.siteIds.length
    ? { organizationId: access.organizationId, siteId: { in: access.siteIds } }
    : { organizationId: access.organizationId };
}

export function siteScopeWhere(access: OrgAccess): Prisma.SiteWhereInput {
  return access.siteIds.length
    ? { organizationId: access.organizationId, id: { in: access.siteIds } }
    : { organizationId: access.organizationId };
}

/** Load a site the caller may see, or 404. */
export async function loadSite(access: OrgAccess, siteId: string | undefined) {
  if (!siteId || !UUID.test(siteId) || !siteInScope(access, siteId)) throw notFound('Site not found');
  const site = await db.site.findFirst({ where: { id: siteId, organizationId: access.organizationId } });
  if (!site) throw notFound('Site not found');
  return site;
}

export { UUID };

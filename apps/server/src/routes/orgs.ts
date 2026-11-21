import { AddMemberBody, CreateOrgBody, ORG_ROLE_RANK, UpdateMemberBody, UpdateOrgBody } from '@cctv/shared';
import type { OrgRole } from '@prisma/client';
import { Router, type Request } from 'express';
import { type OrgAccess, orgAccess, requireCap } from '../access/access';
import { hashPassword } from '../auth/password';
import { requireUser } from '../auth/session';
import { audit } from '../lib/audit';
import { db } from '../lib/db';
import { badRequest, conflict, forbidden, notFound, param } from '../lib/http';

export const orgsRouter = Router();

/** Resolve user + access for routes under /orgs/:orgId. */
export async function orgCtx(req: Request) {
  const user = requireUser(req);
  const access = await orgAccess(user, param(req, 'orgId'));
  return { user, access };
}

const orgView = (o: { id: string; name: string; slug: string; createdAt: Date }) => ({
  id: o.id,
  name: o.name,
  slug: o.slug,
  createdAt: o.createdAt,
});

// ---------------------------------------------------------------- organizations

orgsRouter.get('/orgs', async (req, res) => {
  const user = requireUser(req);
  if (user.platformRole === 'SUPER_ADMIN') {
    const orgs = await db.organization.findMany({ orderBy: { name: 'asc' } });
    res.json({ orgs: orgs.map((o) => ({ ...orgView(o), role: null })) });
    return;
  }
  const ms = await db.membership.findMany({ where: { userId: user.id }, include: { organization: true } });
  res.json({ orgs: ms.map((m) => ({ ...orgView(m.organization), role: m.role })) });
});

orgsRouter.post('/orgs', async (req, res) => {
  const user = requireUser(req);
  if (user.platformRole !== 'SUPER_ADMIN') throw forbidden('Only the platform admin can create organizations');
  const body = CreateOrgBody.parse(req.body);
  if (await db.organization.findUnique({ where: { slug: body.slug } })) throw conflict('Slug already in use');

  const org = await db.$transaction(async (tx) => {
    const owner = await findOrCreateUser(tx, body.owner);
    const org = await tx.organization.create({ data: { name: body.name, slug: body.slug } });
    await tx.membership.create({ data: { userId: owner.id, organizationId: org.id, role: 'OWNER' } });
    return org;
  });
  await audit({ actorId: user.id, actorType: 'user', organizationId: org.id, action: 'org.create', targetType: 'organization', targetId: org.id });
  res.status(201).json({ org: orgView(org) });
});

orgsRouter.get('/orgs/:orgId', async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'config.read');
  const org = await db.organization.findUniqueOrThrow({ where: { id: access.organizationId } });
  res.json({ org: orgView(org), access: accessView(access) });
});

orgsRouter.patch('/orgs/:orgId', async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const body = UpdateOrgBody.parse(req.body);
  const org = await db.organization.update({ where: { id: access.organizationId }, data: body });
  await audit({ actorId: user.id, actorType: 'user', organizationId: org.id, action: 'org.update', targetType: 'organization', targetId: org.id });
  res.json({ org: orgView(org) });
});

orgsRouter.delete('/orgs/:orgId', async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'org.owner');
  await db.organization.delete({ where: { id: access.organizationId } });
  await audit({ actorId: user.id, actorType: 'user', action: 'org.delete', targetType: 'organization', targetId: access.organizationId });
  res.status(204).end();
});

// ---------------------------------------------------------------- members

orgsRouter.get('/orgs/:orgId/members', async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'members.manage');
  const ms = await db.membership.findMany({
    where: { organizationId: access.organizationId },
    include: { user: { select: { id: true, email: true, name: true, disabled: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ members: ms.map(memberView) });
});

orgsRouter.post('/orgs/:orgId/members', async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'members.manage');
  const body = AddMemberBody.parse(req.body);
  assertMayAssign(access, body.role);
  await assertSitesInOrg(access.organizationId, body.siteIds);

  const membership = await db.$transaction(async (tx) => {
    const member = await findOrCreateUser(tx, body);
    const existing = await tx.membership.findUnique({
      where: { userId_organizationId: { userId: member.id, organizationId: access.organizationId } },
    });
    if (existing) throw conflict('User is already a member');
    return tx.membership.create({
      data: { userId: member.id, organizationId: access.organizationId, role: body.role, siteIds: body.siteIds },
      include: { user: { select: { id: true, email: true, name: true, disabled: true } } },
    });
  });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'member.add', targetType: 'membership', targetId: membership.id, meta: { role: body.role } });
  res.status(201).json({ member: memberView(membership) });
});

orgsRouter.patch('/orgs/:orgId/members/:memberId', async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'members.manage');
  const body = UpdateMemberBody.parse(req.body);
  const m = await loadMembership(access, param(req, 'memberId'));
  // Changing an owner, or making someone owner, needs owner (or platform) rights.
  assertMayAssign(access, m.role);
  if (body.role) assertMayAssign(access, body.role);
  if (body.siteIds) await assertSitesInOrg(access.organizationId, body.siteIds);
  if (m.role === 'OWNER' && body.role && body.role !== 'OWNER') await assertNotLastOwner(access.organizationId, m.id);

  const updated = await db.membership.update({
    where: { id: m.id },
    data: body,
    include: { user: { select: { id: true, email: true, name: true, disabled: true } } },
  });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'member.update', targetType: 'membership', targetId: m.id, meta: body });
  res.json({ member: memberView(updated) });
});

orgsRouter.delete('/orgs/:orgId/members/:memberId', async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'members.manage');
  const m = await loadMembership(access, param(req, 'memberId'));
  assertMayAssign(access, m.role);
  if (m.role === 'OWNER') await assertNotLastOwner(access.organizationId, m.id);
  await db.membership.delete({ where: { id: m.id } });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'member.remove', targetType: 'membership', targetId: m.id });
  res.status(204).end();
});

// ---------------------------------------------------------------- helpers

export function accessView(a: OrgAccess) {
  return {
    role: a.role,
    siteIds: a.siteIds,
    platformAdmin: a.platformAdmin,
    supportGrantActive: a.supportGrantActive,
    capabilities: [...a.caps].sort(),
  };
}

function memberView(m: {
  id: string;
  role: OrgRole;
  siteIds: string[];
  createdAt: Date;
  user: { id: string; email: string; name: string; disabled: boolean };
}) {
  return { id: m.id, role: m.role, siteIds: m.siteIds, createdAt: m.createdAt, user: m.user };
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function findOrCreateUser(tx: Tx, u: { email: string; name?: string; password?: string }) {
  const existing = await tx.user.findUnique({ where: { email: u.email } });
  if (existing) return existing;
  if (!u.password) throw badRequest('A password is required for a new user', { path: ['password'] });
  return tx.user.create({
    data: { email: u.email, name: u.name ?? u.email.split('@')[0]!, passwordHash: await hashPassword(u.password) },
  });
}

/** Only owners (and the platform admin) may hand out or change the OWNER role; admins up to ADMIN. */
function assertMayAssign(access: OrgAccess, role: OrgRole) {
  if (access.platformAdmin && !access.role) return;
  const mine = access.role ? ORG_ROLE_RANK[access.role] : 0;
  if (ORG_ROLE_RANK[role] > mine || (role === 'OWNER' && access.role !== 'OWNER')) {
    throw forbidden('You cannot manage members with this role');
  }
}

async function assertSitesInOrg(organizationId: string, siteIds: string[]) {
  if (!siteIds.length) return;
  const n = await db.site.count({ where: { organizationId, id: { in: siteIds } } });
  if (n !== new Set(siteIds).size) throw badRequest('Unknown site in siteIds', { path: ['siteIds'] });
}

async function assertNotLastOwner(organizationId: string, membershipId: string) {
  const owners = await db.membership.count({ where: { organizationId, role: 'OWNER', id: { not: membershipId } } });
  if (owners === 0) throw conflict('An organization needs at least one owner');
}

async function loadMembership(access: OrgAccess, id: string | undefined) {
  const m = id ? await db.membership.findFirst({ where: { id, organizationId: access.organizationId } }).catch(() => null) : null;
  if (!m) throw notFound('Member not found');
  return m;
}

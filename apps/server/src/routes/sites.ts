import { CreateSiteBody, UpdateSiteBody } from '@cctv/shared';
import { Router } from 'express';
import { loadSite, requireCap, siteScopeWhere } from '../access/access';
import { audit } from '../lib/audit';
import { db } from '../lib/db';
import { conflict, forbidden, param } from '../lib/http';
import { orgCtx } from './orgs';

export const sitesRouter = Router();

sitesRouter.get('/orgs/:orgId/sites', async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'config.read');
  const sites = await db.site.findMany({
    where: siteScopeWhere(access),
    orderBy: { name: 'asc' },
    include: { _count: { select: { cameras: true, edges: true } } },
  });
  res.json({ sites });
});

sitesRouter.post('/orgs/:orgId/sites', async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  if (access.siteIds.length) throw forbidden('Members limited to some sites cannot create sites');
  const body = CreateSiteBody.parse(req.body);
  await assertSlugFree(access.organizationId, body.slug);
  const site = await db.site.create({ data: { ...body, organizationId: access.organizationId } });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'site.create', targetType: 'site', targetId: site.id });
  res.status(201).json({ site });
});

sitesRouter.get('/orgs/:orgId/sites/:siteId', async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'config.read');
  res.json({ site: await loadSite(access, param(req, 'siteId')) });
});

sitesRouter.patch('/orgs/:orgId/sites/:siteId', async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const site = await loadSite(access, param(req, 'siteId'));
  const body = UpdateSiteBody.parse(req.body);
  if (body.slug && body.slug !== site.slug) await assertSlugFree(access.organizationId, body.slug);
  const updated = await db.site.update({ where: { id: site.id }, data: body });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'site.update', targetType: 'site', targetId: site.id, meta: body });
  res.json({ site: updated });
});

sitesRouter.delete('/orgs/:orgId/sites/:siteId', async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const site = await loadSite(access, param(req, 'siteId'));
  await db.site.delete({ where: { id: site.id } });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'site.delete', targetType: 'site', targetId: site.id });
  res.status(204).end();
});

async function assertSlugFree(organizationId: string, slug: string) {
  if (await db.site.findUnique({ where: { organizationId_slug: { organizationId, slug } } })) {
    throw conflict('A site with this slug already exists');
  }
}

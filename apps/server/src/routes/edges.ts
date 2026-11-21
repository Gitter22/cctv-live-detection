import type { Edge } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { loadSite, requireCap } from '../access/access';
import { edgeAuth, newEdgeToken } from '../edge/edge-auth';
import { ingestRouter } from '../edge/ingest';
import { buildSiteConfig, configEtag } from '../edge/site-config';
import { audit } from '../lib/audit';
import { db } from '../lib/db';
import { notFound, param } from '../lib/http';
import { orgCtx } from './orgs';

export const edgesRouter = Router();

const edgeView = (e: Edge) => ({
  id: e.id,
  siteId: e.siteId,
  name: e.name,
  status: e.status,
  lastSeenAt: e.lastSeenAt,
  version: e.version,
  health: e.health,
  createdAt: e.createdAt,
  revokedAt: e.revokedAt,
});

const base = '/orgs/:orgId/sites/:siteId/edges';
const CreateEdgeBody = z.object({ name: z.string().trim().min(1).max(120) });

// ---------------------------------------------------------------- management (users)

edgesRouter.get(base, async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'config.read');
  const site = await loadSite(access, param(req, 'siteId'));
  const edges = await db.edge.findMany({ where: { siteId: site.id }, orderBy: { createdAt: 'asc' } });
  res.json({ edges: edges.map(edgeView) });
});

edgesRouter.post(base, async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const site = await loadSite(access, param(req, 'siteId'));
  const { name } = CreateEdgeBody.parse(req.body);
  const { token, tokenHash } = newEdgeToken();
  const edge = await db.edge.create({ data: { organizationId: access.organizationId, siteId: site.id, name, tokenHash } });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'edge.create', targetType: 'edge', targetId: edge.id });
  // The token is returned ONCE. It cannot be recovered later; revoke and create a new edge instead.
  res.status(201).json({ edge: edgeView(edge), token });
});

edgesRouter.post(`${base}/:edgeId/revoke`, async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const site = await loadSite(access, param(req, 'siteId'));
  const edgeId = param(req, 'edgeId');
  const edge = edgeId ? await db.edge.findFirst({ where: { id: edgeId, siteId: site.id } }).catch(() => null) : null;
  if (!edge) throw notFound('Edge not found');
  const updated = await db.edge.update({ where: { id: edge.id }, data: { status: 'REVOKED', revokedAt: new Date() } });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'edge.revoke', targetType: 'edge', targetId: edge.id });
  res.json({ edge: edgeView(updated) });
});

// ---------------------------------------------------------------- edge-facing API

export const edgeApiRouter = Router();
edgeApiRouter.use(edgeAuth);
edgeApiRouter.use(ingestRouter);

/** Site configuration for the calling edge. Supports If-None-Match (304 when unchanged). */
edgeApiRouter.get('/config', async (req, res) => {
  const config = await buildSiteConfig(req.edge!.siteId);
  const etag = configEtag(config);
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'no-store');
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.json(config);
});

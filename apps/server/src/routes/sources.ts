import { CreateSourceBody, UpdateSourceBody } from '@cctv/shared';
import type { Source } from '@prisma/client';
import { Router } from 'express';
import { type OrgAccess, loadSite, requireCap } from '../access/access';
import { audit } from '../lib/audit';
import { db } from '../lib/db';
import { badRequest, notFound, param } from '../lib/http';
import { encryptSecret, redactSecrets } from '../lib/secrets';
import { orgCtx } from './orgs';

export const sourcesRouter = Router();

/** AAD context for a source secret: binds the ciphertext to this row and field. */
export const sourceSecretCtx = (sourceId: string, field: 'password' | 'rawUrl') => `source:${sourceId}:${field}`;

/** API view of a source: secrets replaced by passwordSet / rawUrlSet. */
export const sourceView = (s: Source) => redactSecrets(s as unknown as Record<string, unknown>);

const base = '/orgs/:orgId/sites/:siteId/sources';

sourcesRouter.get(base, async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'config.read');
  const site = await loadSite(access, param(req, 'siteId'));
  const sources = await db.source.findMany({ where: { siteId: site.id }, orderBy: { name: 'asc' } });
  res.json({ sources: sources.map(sourceView) });
});

sourcesRouter.post(base, async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const site = await loadSite(access, param(req, 'siteId'));
  const body = CreateSourceBody.parse(req.body);

  // Create first to get the id, then store secrets bound to that id.
  const source = await db.$transaction(async (tx) => {
    const created = await tx.source.create({
      data:
        body.kind === 'RAW_URL'
          ? { organizationId: access.organizationId, siteId: site.id, name: body.name, kind: body.kind }
          : {
              organizationId: access.organizationId,
              siteId: site.id,
              name: body.name,
              kind: body.kind,
              vendor: body.vendor,
              host: body.host,
              rtspPort: body.rtspPort,
              username: body.username || null,
            },
    });
    return tx.source.update({
      where: { id: created.id },
      data:
        body.kind === 'RAW_URL'
          ? { rawUrlEnc: encryptSecret(body.url, sourceSecretCtx(created.id, 'rawUrl')) }
          : { passwordEnc: body.password ? encryptSecret(body.password, sourceSecretCtx(created.id, 'password')) : null },
    });
  });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'source.create', targetType: 'source', targetId: source.id });
  res.status(201).json({ source: sourceView(source) });
});

sourcesRouter.get(`${base}/:sourceId`, async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'config.read');
  const source = await loadSource(access, param(req, 'siteId'), param(req, 'sourceId'));
  res.json({ source: sourceView(source) });
});

sourcesRouter.patch(`${base}/:sourceId`, async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const source = await loadSource(access, param(req, 'siteId'), param(req, 'sourceId'));
  const body = UpdateSourceBody.parse(req.body);

  const isRaw = source.kind === 'RAW_URL';
  if (isRaw && (body.vendor || body.host || body.rtspPort || body.username !== undefined || body.password !== undefined)) {
    throw badRequest('A RAW_URL source only has a name and a url');
  }
  if (!isRaw && body.url) throw badRequest('Only RAW_URL sources have a url');

  const { password, url, ...plain } = body;
  const data: Record<string, unknown> = { ...plain };
  if (password !== undefined) data.passwordEnc = password ? encryptSecret(password, sourceSecretCtx(source.id, 'password')) : null;
  if (url) data.rawUrlEnc = encryptSecret(url, sourceSecretCtx(source.id, 'rawUrl'));

  const updated = await db.source.update({ where: { id: source.id }, data });
  await audit({
    actorId: user.id,
    actorType: 'user',
    organizationId: access.organizationId,
    action: 'source.update',
    targetType: 'source',
    targetId: source.id,
    // Record WHICH fields changed, never secret values.
    meta: { fields: Object.keys(body) },
  });
  res.json({ source: sourceView(updated) });
});

sourcesRouter.delete(`${base}/:sourceId`, async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const source = await loadSource(access, param(req, 'siteId'), param(req, 'sourceId'));
  await db.source.delete({ where: { id: source.id } });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'source.delete', targetType: 'source', targetId: source.id });
  res.status(204).end();
});

export async function loadSource(access: OrgAccess, siteId: string | undefined, sourceId: string | undefined) {
  const site = await loadSite(access, siteId);
  const source = sourceId
    ? await db.source.findFirst({ where: { id: sourceId, siteId: site.id, organizationId: access.organizationId } }).catch(() => null)
    : null;
  if (!source) throw notFound('Source not found');
  return source;
}

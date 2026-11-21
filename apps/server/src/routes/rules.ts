import { CreateRuleBody, type RuleDefinition, UpdateRuleBody } from '@cctv/shared';
import type { Prisma, Rule } from '@prisma/client';
import { Router } from 'express';
import { type OrgAccess, loadSite, requireCap } from '../access/access';
import { audit } from '../lib/audit';
import { bus } from '../lib/bus';
import { db } from '../lib/db';
import { badRequest, notFound, param } from '../lib/http';
import { orgCtx } from './orgs';

export const rulesRouter = Router();

const base = '/orgs/:orgId/sites/:siteId/rules';

const ruleView = (r: Rule) => ({
  id: r.id,
  siteId: r.siteId,
  name: r.name,
  enabled: r.enabled,
  definition: r.definition,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** Camera keys / zone keys / line keys referenced by a rule must exist at the site. */
async function validateRefs(siteId: string, def: RuleDefinition) {
  const cameras = await db.camera.findMany({ where: { siteId }, include: { zones: true, lines: true } });
  const keys = new Set(cameras.map((c) => c.key));
  if (def.scope.mode === 'cameras') {
    const missing = def.scope.cameras.filter((k) => !keys.has(k));
    if (missing.length) throw badRequest(`Unknown camera(s): ${missing.join(', ')}`, { path: ['definition', 'scope', 'cameras'] });
  }
  const w = def.when;
  if ('zones' in w && w.zones?.length) {
    const zoneKeys = new Set(cameras.flatMap((c) => c.zones.map((z) => z.key)));
    const missing = w.zones.filter((z) => !zoneKeys.has(z));
    if (missing.length) throw badRequest(`Unknown zone(s): ${missing.join(', ')}`, { path: ['definition', 'when', 'zones'] });
  }
  if (w.type === 'face' && w.people?.length) {
    const site = await db.site.findUniqueOrThrow({ where: { id: siteId }, select: { organizationId: true } });
    const n = await db.person.count({ where: { organizationId: site.organizationId, id: { in: w.people } } });
    if (n !== new Set(w.people).size) throw badRequest('Unknown person in rule', { path: ['definition', 'when', 'people'] });
  }
  if (w.type === 'line_cross' && w.lines?.length) {
    const lineKeys = new Set(cameras.flatMap((c) => c.lines.map((l) => l.key)));
    const missing = w.lines.filter((l) => !lineKeys.has(l));
    if (missing.length) throw badRequest(`Unknown line(s): ${missing.join(', ')}`, { path: ['definition', 'when', 'lines'] });
  }
}

rulesRouter.get(base, async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'config.read');
  const site = await loadSite(access, param(req, 'siteId'));
  const rules = await db.rule.findMany({ where: { siteId: site.id }, orderBy: { name: 'asc' } });
  res.json({ rules: rules.map(ruleView) });
});

rulesRouter.post(base, async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const site = await loadSite(access, param(req, 'siteId'));
  const body = CreateRuleBody.parse(req.body);
  await validateRefs(site.id, body.definition);
  const rule = await db.rule.create({
    data: {
      organizationId: access.organizationId,
      siteId: site.id,
      name: body.name,
      enabled: body.enabled,
      definition: body.definition as Prisma.InputJsonValue,
    },
  });
  bus.emit('rules.changed', site.id);
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'rule.create', targetType: 'rule', targetId: rule.id });
  res.status(201).json({ rule: ruleView(rule) });
});

rulesRouter.get(`${base}/:ruleId`, async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'config.read');
  res.json({ rule: ruleView(await loadRule(access, param(req, 'siteId'), param(req, 'ruleId'))) });
});

rulesRouter.patch(`${base}/:ruleId`, async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const rule = await loadRule(access, param(req, 'siteId'), param(req, 'ruleId'));
  const body = UpdateRuleBody.parse(req.body);
  if (body.definition) await validateRefs(rule.siteId, body.definition);
  const updated = await db.rule.update({
    where: { id: rule.id },
    data: { ...body, ...(body.definition ? { definition: body.definition as Prisma.InputJsonValue } : {}) },
  });
  bus.emit('rules.changed', rule.siteId);
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'rule.update', targetType: 'rule', targetId: rule.id, meta: { fields: Object.keys(body) } });
  res.json({ rule: ruleView(updated) });
});

rulesRouter.delete(`${base}/:ruleId`, async (req, res) => {
  const { user, access } = await orgCtx(req);
  requireCap(access, 'config.write');
  const rule = await loadRule(access, param(req, 'siteId'), param(req, 'ruleId'));
  await db.rule.delete({ where: { id: rule.id } });
  bus.emit('rules.changed', rule.siteId);
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'rule.delete', targetType: 'rule', targetId: rule.id });
  res.status(204).end();
});

async function loadRule(access: OrgAccess, siteId: string | undefined, ruleId: string | undefined) {
  const site = await loadSite(access, siteId);
  const rule = ruleId ? await db.rule.findFirst({ where: { id: ruleId, siteId: site.id } }).catch(() => null) : null;
  if (!rule) throw notFound('Rule not found');
  return rule;
}

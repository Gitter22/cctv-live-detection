import { Router } from 'express';
import { z } from 'zod';
import { type OrgAccess, UUID, requireCap, scopeWhere } from '../access/access';
import { audit } from '../lib/audit';
import { db } from '../lib/db';
import { addFaceSample } from '../lib/faces';
import { badRequest, notFound, param } from '../lib/http';
import { orgCtx } from './orgs';

/**
 * Known people and their face samples (biometric data). Listing needs footage access;
 * changing needs footage + config write. Samples are enrolled FROM face.observed events
 * (the embedding is copied; the server never processes images).
 */
export const peopleRouter = Router();

const PersonBody = z.object({ name: z.string().trim().min(1).max(120), notes: z.string().trim().max(500).optional() });

function canManage(access: OrgAccess) {
  requireCap(access, 'footage.read');
  requireCap(access, 'config.write');
}

peopleRouter.get('/orgs/:orgId/people', async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'footage.read');
  const people = await db.person.findMany({
    where: { organizationId: access.organizationId },
    include: { _count: { select: { faces: true } } },
    orderBy: { name: 'asc' },
  });
  res.json({ people: people.map((p) => ({ id: p.id, name: p.name, notes: p.notes, faces: p._count.faces, createdAt: p.createdAt })) });
});

peopleRouter.post('/orgs/:orgId/people', async (req, res) => {
  const { user, access } = await orgCtx(req);
  canManage(access);
  const body = PersonBody.parse(req.body);
  const person = await db.person.create({ data: { ...body, organizationId: access.organizationId } });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'person.create', targetType: 'person', targetId: person.id });
  res.status(201).json({ person });
});

peopleRouter.delete('/orgs/:orgId/people/:personId', async (req, res) => {
  const { user, access } = await orgCtx(req);
  canManage(access);
  const person = await loadPerson(access, param(req, 'personId'));
  await db.person.delete({ where: { id: person.id } }); // cascades to face samples
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'person.delete', targetType: 'person', targetId: person.id });
  res.status(204).end();
});

/** Enrol: copy the face embedding of a face.observed event the caller can see. */
peopleRouter.post('/orgs/:orgId/people/:personId/faces', async (req, res) => {
  const { user, access } = await orgCtx(req);
  canManage(access);
  const person = await loadPerson(access, param(req, 'personId'));
  const { eventId } = z.object({ eventId: z.string().uuid() }).parse(req.body);
  const ev = await db.event.findFirst({ where: { id: eventId, ...scopeWhere(access) } });
  if (!ev) throw notFound('Event not found');
  const embedding = (ev.payload as { face?: { embedding?: number[] } }).face?.embedding;
  if (ev.type !== 'face.observed' || !embedding || embedding.length !== 128) throw badRequest('This event has no face');
  await addFaceSample(access.organizationId, person.id, embedding, ev.id);
  // This event is now a confirmed match of that person.
  await db.event.update({ where: { id: ev.id }, data: { facePersonId: person.id, faceSimilarity: 1 } });
  await audit({ actorId: user.id, actorType: 'user', organizationId: access.organizationId, action: 'person.enrol_face', targetType: 'person', targetId: person.id, meta: { eventId } });
  res.status(201).json({ ok: true });
});

peopleRouter.get('/orgs/:orgId/people/:personId/faces', async (req, res) => {
  const { access } = await orgCtx(req);
  requireCap(access, 'footage.read');
  const person = await loadPerson(access, param(req, 'personId'));
  const faces = await db.$queryRaw<{ id: string; sourceEventId: string | null; createdAt: Date }[]>`
    SELECT id, "sourceEventId", "createdAt" FROM face_samples WHERE "personId" = ${person.id}::uuid ORDER BY "createdAt" DESC`;
  res.json({
    faces: faces.map((f) => ({ ...f, snapshotUrl: f.sourceEventId ? `/api/orgs/${access.organizationId}/events/${f.sourceEventId}/snapshot` : null })),
  });
});

peopleRouter.delete('/orgs/:orgId/people/:personId/faces/:faceId', async (req, res) => {
  const { access } = await orgCtx(req);
  canManage(access);
  const person = await loadPerson(access, param(req, 'personId'));
  const faceId = param(req, 'faceId');
  if (!faceId || !UUID.test(faceId)) throw notFound();
  await db.$executeRaw`DELETE FROM face_samples WHERE id = ${faceId}::uuid AND "personId" = ${person.id}::uuid`;
  res.status(204).end();
});

async function loadPerson(access: OrgAccess, id: string | undefined) {
  const p = id && UUID.test(id) ? await db.person.findFirst({ where: { id, organizationId: access.organizationId } }) : null;
  if (!p) throw notFound('Person not found');
  return p;
}

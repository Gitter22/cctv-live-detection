import { z } from 'zod';
import { OrgRole, Slug } from './enums';

/** Request bodies of the REST API. Shared so web/mobile forms validate exactly like the server. */

export const Email = z.string().trim().toLowerCase().email();
export const Password = z.string().min(10, 'at least 10 characters').max(200);
const Name = z.string().trim().min(1).max(120);
const Uuid = z.string().uuid();

// ---------------------------------------------------------------- organizations and members

export const CreateOrgBody = z.object({
  name: Name,
  slug: Slug,
  owner: z.object({
    email: Email,
    name: Name.optional(),
    /** Required when the owner is a new user. */
    password: Password.optional(),
  }),
});
export type CreateOrgBody = z.infer<typeof CreateOrgBody>;

export const UpdateOrgBody = z.object({ name: Name });
export type UpdateOrgBody = z.infer<typeof UpdateOrgBody>;

export const AddMemberBody = z.object({
  email: Email,
  name: Name.optional(),
  password: Password.optional(),
  role: OrgRole,
  siteIds: z.array(Uuid).default([]),
});
export type AddMemberBody = z.infer<typeof AddMemberBody>;

export const UpdateMemberBody = z
  .object({ role: OrgRole.optional(), siteIds: z.array(Uuid).optional() })
  .refine((b) => b.role !== undefined || b.siteIds !== undefined, 'nothing to update');
export type UpdateMemberBody = z.infer<typeof UpdateMemberBody>;

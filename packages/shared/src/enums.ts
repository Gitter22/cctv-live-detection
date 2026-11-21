import { z } from 'zod';

/** Organization roles. Order matters: later roles include the rights of earlier ones. */
export const OrgRole = z.enum(['VIEWER', 'ADMIN', 'OWNER']);
export type OrgRole = z.infer<typeof OrgRole>;

export const ORG_ROLE_RANK: Record<OrgRole, number> = { VIEWER: 1, ADMIN: 2, OWNER: 3 };

export const PlatformRole = z.enum(['SUPER_ADMIN']);
export type PlatformRole = z.infer<typeof PlatformRole>;

export const SourceKind = z.enum(['NVR', 'CAMERA', 'RAW_URL']);
export type SourceKind = z.infer<typeof SourceKind>;

export const SourceVendor = z.enum(['dahua', 'hikvision', 'generic']);
export type SourceVendor = z.infer<typeof SourceVendor>;

export const Severity = z.enum(['info', 'warning', 'danger']);
export type Severity = z.infer<typeof Severity>;

export const AlertStatus = z.enum(['OPEN', 'ACKED', 'CLOSED']);
export type AlertStatus = z.infer<typeof AlertStatus>;

/** Slugs / keys: lowercase letters, digits and dashes, e.g. "entrance-1". */
export const Slug = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, digits and single dashes');

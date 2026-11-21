import { z } from 'zod';
import { OrgRole, Slug, SourceVendor } from './enums';

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

// ---------------------------------------------------------------- sites

export const Timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'unknown IANA timezone, e.g. Asia/Kolkata');

const SiteFields = { name: Name, slug: Slug, timezone: Timezone };

export const CreateSiteBody = z.object({ ...SiteFields, timezone: Timezone.default('UTC') });
export type CreateSiteBody = z.infer<typeof CreateSiteBody>;

// Built from the fields WITHOUT defaults: a partial update must never inject default values.
export const UpdateSiteBody = z
  .object(SiteFields)
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'nothing to update');
export type UpdateSiteBody = z.infer<typeof UpdateSiteBody>;

// ---------------------------------------------------------------- sources

const Host = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-zA-Z0-9.-]+$|^\[[0-9a-fA-F:]+\]$/, 'hostname or IP address only (no scheme, path or port)');
export const RtspUrl = z
  .string()
  .trim()
  .max(2000)
  .regex(/^rtsps?:\/\/[^\s]+$/i, 'must start with rtsp:// or rtsps://');
const Port = z.coerce.number().int().min(1).max(65535);

const DeviceSourceFields = {
  name: Name,
  vendor: SourceVendor,
  host: Host,
  rtspPort: Port.default(554),
  username: z.string().max(120).optional(),
  /** Plain password. Stored encrypted, never returned. */
  password: z.string().max(200).optional(),
};

export const CreateSourceBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('NVR'), ...DeviceSourceFields }),
  z.object({ kind: z.literal('CAMERA'), ...DeviceSourceFields }),
  z.object({ kind: z.literal('RAW_URL'), name: Name, url: RtspUrl }),
]);
export type CreateSourceBody = z.infer<typeof CreateSourceBody>;

/** Omit a secret to keep it, send null to clear it, send a string to replace it. */
export const UpdateSourceBody = z
  .object({
    name: Name,
    vendor: SourceVendor,
    host: Host,
    rtspPort: Port,
    username: z.string().max(120).nullable(),
    password: z.string().max(200).nullable(),
    url: RtspUrl,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'nothing to update');
export type UpdateSourceBody = z.infer<typeof UpdateSourceBody>;

// ---------------------------------------------------------------- cameras, zones, lines

/** Generic per-camera detection settings (what vision looks for; NOT business rules). */
const DetectionFields = {
  /** COCO class names to track, e.g. person, car, dog */
  classes: z.array(z.string().min(1).max(40)).min(1).max(80),
  /** Score needed to start a track */
  confidence: z.number().min(0.05).max(0.99),
  /** Weaker detections only keep existing tracks alive */
  lowConfidence: z.number().min(0.05).max(0.99),
  /** Max detections per second for this camera */
  detectFps: z.number().min(0.2).max(15),
  /** Skip the detector on still frames */
  motionGate: z.boolean(),
  /** Look for faces on persons (main stream) and publish face.observed. Off by default (privacy). */
  faces: z.boolean(),
};

export const DETECTION_DEFAULTS = {
  classes: ['person'],
  confidence: 0.5,
  lowConfidence: 0.25,
  detectFps: 5,
  motionGate: true,
  faces: false,
};

/** Complete settings (stored values merged over DETECTION_DEFAULTS). */
export const DetectionSettings = z.object(DetectionFields);
/** What clients send: any subset, no defaults injected (they would overwrite stored values). */
export const DetectionPatch = z.object(DetectionFields).partial();
export type DetectionSettings = z.infer<typeof DetectionSettings>;

const CameraFields = {
  key: Slug,
  label: Name,
  sourceId: Uuid.nullable(),
  channel: z.number().int().min(1).max(512).nullable(),
  /** Optional per-camera URLs; override the source template. Stored encrypted. */
  subUrl: RtspUrl.nullable(),
  mainUrl: RtspUrl.nullable(),
  enabled: z.boolean(),
  tags: z.array(Slug).max(20),
  detection: DetectionPatch,
};

export const CreateCameraBody = z.object({
  ...CameraFields,
  sourceId: CameraFields.sourceId.optional(),
  channel: CameraFields.channel.optional(),
  subUrl: CameraFields.subUrl.optional(),
  mainUrl: CameraFields.mainUrl.optional(),
  enabled: z.boolean().default(true),
  tags: CameraFields.tags.default([]),
  detection: CameraFields.detection.default({}),
});
export type CreateCameraBody = z.infer<typeof CreateCameraBody>;

export const UpdateCameraBody = z
  .object(CameraFields)
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'nothing to update');
export type UpdateCameraBody = z.infer<typeof UpdateCameraBody>;

export const Point = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
export type Point = z.infer<typeof Point>;

const ZoneFields = { key: Slug, label: Name, polygon: z.array(Point).min(3).max(64) };
export const CreateZoneBody = z.object(ZoneFields);
export const UpdateZoneBody = z.object(ZoneFields).partial().refine((b) => Object.keys(b).length > 0, 'nothing to update');

const LineFields = { key: Slug, label: Name, start: Point, end: Point };
export const CreateLineBody = z
  .object(LineFields)
  .refine((l) => l.start[0] !== l.end[0] || l.start[1] !== l.end[1], 'start and end must differ');
export const UpdateLineBody = z.object(LineFields).partial().refine((b) => Object.keys(b).length > 0, 'nothing to update');

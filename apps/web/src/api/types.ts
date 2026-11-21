/** Response shapes of the server API (request bodies come from @cctv/shared). */

export type OrgRole = 'VIEWER' | 'ADMIN' | 'OWNER';
export type Capability = 'config.read' | 'config.write' | 'members.manage' | 'footage.read' | 'alerts.manage' | 'org.owner';

export interface Me {
  user: { id: string; email: string; name: string; platformRole: 'SUPER_ADMIN' | null };
  memberships: { organization: { id: string; name: string; slug: string }; role: OrgRole; siteIds: string[] }[];
}

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: OrgRole | null;
}

export interface OrgDetail {
  org: { id: string; name: string; slug: string };
  access: { role: OrgRole | null; siteIds: string[]; platformAdmin: boolean; supportGrantActive: boolean; capabilities: Capability[] };
}

export interface Site {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  timezone: string;
  _count?: { cameras: number; edges: number };
}

export interface Source {
  id: string;
  name: string;
  kind: 'NVR' | 'CAMERA' | 'RAW_URL';
  vendor: string | null;
  host: string | null;
  rtspPort: number | null;
  username: string | null;
  passwordSet: boolean;
  rawUrlSet: boolean;
}

export type Point = [number, number];

export interface Zone {
  id: string;
  key: string;
  label: string;
  polygon: Point[];
}

export interface Line {
  id: string;
  key: string;
  label: string;
  start: Point;
  end: Point;
}

export interface CameraStatus {
  online: boolean | null;
  reason: string | null;
  since: string | null;
  reportedAt: string | null;
}

export interface Camera {
  id: string;
  siteId: string;
  sourceId: string | null;
  key: string;
  label: string;
  channel: number | null;
  enabled: boolean;
  tags: string[];
  subUrlSet: boolean;
  mainUrlSet: boolean;
  detection: { classes: string[]; confidence: number; lowConfidence: number; detectFps: number; motionGate: boolean; faces: boolean };
  zones: Zone[];
  lines: Line[];
  status?: CameraStatus | null;
}

export interface Edge {
  id: string;
  siteId: string;
  name: string;
  status: 'ACTIVE' | 'REVOKED';
  lastSeenAt: string | null;
  version: string | null;
  health: { vision?: { online: boolean }; spool?: number; uptimeS?: number } | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface Member {
  id: string;
  role: OrgRole;
  siteIds: string[];
  createdAt: string;
  user: { id: string; email: string; name: string; disabled: boolean };
}

export interface Rule {
  id: string;
  siteId: string;
  name: string;
  enabled: boolean;
  definition: import('@cctv/shared').RuleDefinition;
}

export type Severity = 'info' | 'warning' | 'danger';
export type AlertStatus = 'OPEN' | 'ACKED' | 'CLOSED';

export interface Alert {
  id: string;
  siteId: string;
  ruleId: string | null;
  ruleName: string | null;
  eventId: string | null;
  cameraKey: string | null;
  severity: Severity;
  status: AlertStatus;
  title: string;
  createdAt: string;
  ackedAt: string | null;
  closedAt: string | null;
  notes: { at: string; byName: string; text: string }[];
  snapshotUrl: string | null;
  event: { id: string; type: string; ts: string; payload: { object?: { bbox: [number, number, number, number]; class: string } } } | null;
}

export interface SupportGrant {
  id: string;
  reason: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  active: boolean;
}

export interface AuditEntry {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  at: string;
  actor: { name: string; email: string } | null;
  meta: unknown;
}

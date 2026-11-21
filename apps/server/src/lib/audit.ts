import type { Prisma } from '@prisma/client';
import { db } from './db';
import { logger } from './logger';

export interface AuditEntry {
  actorId?: string | null;
  actorType: 'user' | 'edge' | 'system';
  organizationId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Prisma.InputJsonValue;
}

/** Append to the audit log. Never include secrets in `meta`. Failures are logged, not thrown. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({ data: entry });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'audit log write failed');
  }
}

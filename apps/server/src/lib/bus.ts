import { EventEmitter } from 'node:events';
import type { Alert, Event } from '@prisma/client';

/**
 * In-process event bus. Ingestion emits, the rules engine (C3) and live streams (C5) listen.
 * Listeners must not throw; errors are their own responsibility.
 */
export interface BusEvents {
  'event.ingested': [Event];
  /** A site's rules were created/updated/deleted (siteId). */
  'rules.changed': [string];
  'alert.created': [Alert];
  'alert.updated': [Alert];
  /** Something an edge receives in its config changed for this site (siteId). */
  'site.config.changed': [string];
}

class Bus extends EventEmitter<BusEvents> {}

export const bus = new Bus();
bus.setMaxListeners(50);

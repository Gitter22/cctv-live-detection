import { EventEmitter } from 'node:events';
import type { Event } from '@prisma/client';

/**
 * In-process event bus. Ingestion emits, the rules engine (C3) and live streams (C5) listen.
 * Listeners must not throw; errors are their own responsibility.
 */
export interface BusEvents {
  'event.ingested': [Event];
}

class Bus extends EventEmitter<BusEvents> {}

export const bus = new Bus();
bus.setMaxListeners(50);

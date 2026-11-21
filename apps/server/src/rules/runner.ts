import { RuleDefinition, VisionEvent } from '@cctv/shared';
import type { Alert, Event } from '@prisma/client';
import { bus } from '../lib/bus';
import { db } from '../lib/db';
import { logger } from '../lib/logger';
import { type AlertDraft, type EngineCamera, type EngineRule, RuleEngine } from './engine';

/**
 * Runs one RuleEngine per site: feeds ingested events, ticks every few seconds for time-based
 * conditions, and turns drafts into Alert rows (+ "alert.created" on the bus).
 */
export class RulesRunner {
  private engines = new Map<string, RuleEngine>();
  private loading = new Map<string, Promise<RuleEngine | null>>();
  private timers: NodeJS.Timeout[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: { tickMs?: number; refreshMs?: number } = {}) {}

  async start() {
    bus.on('event.ingested', this.onEvent);
    bus.on('rules.changed', this.onRulesChanged);
    // Sites with enabled rules need ticks even without events (absence, offline).
    const sites = await db.rule.findMany({ where: { enabled: true }, distinct: ['siteId'], select: { siteId: true } });
    await Promise.all(sites.map((s) => this.engineFor(s.siteId)));
    this.timers.push(setInterval(() => this.serial(() => this.tickAll(Date.now())), this.opts.tickMs ?? 5000));
    this.timers.push(setInterval(() => this.serial(() => this.refreshAll()), this.opts.refreshMs ?? 30_000));
    logger.info({ sites: this.engines.size }, 'rules runner started');
  }

  stop() {
    bus.off('event.ingested', this.onEvent);
    bus.off('rules.changed', this.onRulesChanged);
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  /** Wait until queued work is done (tests). */
  idle() {
    return this.queue;
  }

  private onEvent = (event: Event) => {
    this.serial(async () => {
      const engine = await this.engineFor(event.siteId);
      const parsed = VisionEvent.safeParse(event.payload);
      if (!engine || !parsed.success) return;
      await this.createAlerts(event.siteId, engine.handleEvent(parsed.data));
    });
  };

  private onRulesChanged = (siteId: string) => {
    this.serial(() => this.refresh(siteId));
  };

  /** Run engine work strictly one at a time (keeps state changes ordered). */
  private serial(fn: () => Promise<unknown>) {
    this.queue = this.queue.then(fn).catch((err) => logger.error({ err }, 'rules runner error'));
    return this.queue;
  }

  async tickAll(now: number) {
    for (const [siteId, engine] of this.engines) await this.createAlerts(siteId, engine.tick(now));
  }

  private async refreshAll() {
    for (const siteId of this.engines.keys()) await this.refresh(siteId);
  }

  private async engineFor(siteId: string): Promise<RuleEngine | null> {
    const existing = this.engines.get(siteId);
    if (existing) return existing;
    let p = this.loading.get(siteId);
    if (!p) {
      p = this.load(siteId).then((cfg) => {
        this.loading.delete(siteId);
        if (!cfg) return null;
        const engine = new RuleEngine(cfg.timezone, cfg.cameras, cfg.rules);
        this.engines.set(siteId, engine);
        return engine;
      });
      this.loading.set(siteId, p);
    }
    return p;
  }

  private async refresh(siteId: string) {
    const cfg = await this.load(siteId);
    const engine = this.engines.get(siteId);
    if (!cfg) {
      this.engines.delete(siteId);
      return;
    }
    if (engine) engine.configure(cfg.timezone, cfg.cameras, cfg.rules);
    else this.engines.set(siteId, new RuleEngine(cfg.timezone, cfg.cameras, cfg.rules));
  }

  private async load(siteId: string) {
    const site = await db.site.findUnique({
      where: { id: siteId },
      include: { cameras: { include: { zones: { select: { key: true } } } }, rules: { where: { enabled: true } } },
    });
    if (!site) return null;
    const cameras: EngineCamera[] = site.cameras.map((c) => ({ key: c.key, label: c.label, tags: c.tags, zones: c.zones.map((z) => z.key) }));
    const rules: EngineRule[] = [];
    for (const r of site.rules) {
      const def = RuleDefinition.safeParse(r.definition);
      if (def.success) rules.push({ id: r.id, name: r.name, definition: def.data });
      else logger.warn({ rule: r.id }, 'skipping rule with invalid definition');
    }
    return { timezone: site.timezone, cameras, rules };
  }

  private async createAlerts(siteId: string, drafts: AlertDraft[]): Promise<Alert[]> {
    if (!drafts.length) return [];
    const site = await db.site.findUnique({ where: { id: siteId }, select: { organizationId: true } });
    if (!site) return [];
    const created: Alert[] = [];
    for (const d of drafts) {
      const alert = await db.alert.create({
        data: {
          organizationId: site.organizationId,
          siteId,
          ruleId: d.ruleId,
          eventId: d.eventId,
          cameraKey: d.cameraKey,
          severity: d.severity,
          title: d.title,
          createdAt: new Date(d.at),
        },
      });
      created.push(alert);
      bus.emit('alert.created', alert);
      logger.info({ alert: alert.id, severity: alert.severity, title: alert.title }, 'alert raised');
    }
    return created;
  }
}

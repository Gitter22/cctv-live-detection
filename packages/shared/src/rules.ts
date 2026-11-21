import { z } from 'zod';
import { Severity, Slug } from './enums';

/**
 * Rule definition v1 (stored as JSON in Rule.definition). Business logic lives HERE, on the
 * server, never in vision. See docs/ARCHITECTURE.md "Rules: scope and conditions".
 *
 *   scope    which cameras of the site the rule watches
 *   when     the condition (on zones of those cameras, optionally limited to some zone keys)
 *   schedule when the rule is active (site timezone); none = always
 *   then     what to raise
 */

export const RuleScope = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({ mode: z.literal('tags'), tags: z.array(Slug).min(1).max(20) }),
  z.object({ mode: z.literal('cameras'), cameras: z.array(Slug).min(1).max(100) }),
]);
export type RuleScope = z.infer<typeof RuleScope>;

const Classes = z.array(z.string().min(1).max(40)).min(1).max(20).default(['person']);
/** Zone keys to watch on the scoped cameras. Empty/omitted = any zone. */
const Zones = z.array(Slug).max(20).optional();
const Seconds = (max: number) => z.number().int().min(0).max(max);

export const RuleCondition = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('presence'),
    classes: Classes,
    zones: Zones,
    /** Fire only once the object has stayed this long (0 = on entry). */
    minDwellS: Seconds(3600).default(0),
  }),
  z.object({
    type: z.literal('absence'),
    classes: Classes,
    zones: Zones,
    /** Fire when no matching object has been in the zone for this long. */
    forS: Seconds(86_400).min(5),
  }),
  z.object({
    type: z.literal('count'),
    classes: Classes,
    zones: Zones,
    op: z.enum(['gt', 'lt']),
    n: z.number().int().min(0).max(1000),
    forS: Seconds(3600).default(0),
  }),
  z.object({
    type: z.literal('line_cross'),
    classes: Classes,
    /** Line keys. Omitted = any line. */
    lines: z.array(Slug).max(20).optional(),
    direction: z.enum(['in', 'out', 'any']).default('any'),
  }),
  z.object({
    type: z.literal('camera_offline'),
    forS: Seconds(86_400).default(60),
  }),
  z.object({
    type: z.literal('face'),
    /** known = matched an enrolled person; unknown = could not confirm; any = every face. */
    match: z.enum(['known', 'unknown', 'any']),
    /** Only these enrolled people (known only). Omitted = anyone known. */
    people: z.array(z.string().uuid()).max(50).optional(),
    zones: Zones,
  }),
]);
export type RuleCondition = z.infer<typeof RuleCondition>;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM, 24h');

/** Active windows in the SITE timezone. end < start = overnight (e.g. 22:00-06:00). */
export const RuleSchedule = z.object({
  windows: z
    .array(
      z.object({
        /** 0 = Sunday ... 6 = Saturday. The day the window STARTS on. */
        days: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([0, 1, 2, 3, 4, 5, 6]),
        start: HHMM,
        end: HHMM,
      }),
    )
    .min(1)
    .max(14),
});
export type RuleSchedule = z.infer<typeof RuleSchedule>;

export const RuleDefinition = z.object({
  v: z.literal(1).default(1),
  scope: RuleScope,
  when: RuleCondition,
  schedule: RuleSchedule.nullish(),
  then: z.object({
    severity: Severity,
    /** Alert title; default is generated from the condition. */
    title: z.string().trim().max(160).optional(),
  }),
  /** Minimum seconds between two alerts of this rule for the same camera. */
  cooldownS: Seconds(86_400).default(300),
});
export type RuleDefinition = z.infer<typeof RuleDefinition>;

export const CreateRuleBody = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  definition: RuleDefinition,
});
export type CreateRuleBody = z.infer<typeof CreateRuleBody>;

export const UpdateRuleBody = z
  .object({ name: z.string().trim().min(1).max(120), enabled: z.boolean(), definition: RuleDefinition })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'nothing to update');
export type UpdateRuleBody = z.infer<typeof UpdateRuleBody>;

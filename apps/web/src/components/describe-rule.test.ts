import { RuleDefinition } from '@cctv/shared';
import { describeRule } from './describe-rule';

describe('describeRule', () => {
  it('summarises the factory examples', () => {
    expect(
      describeRule(
        RuleDefinition.parse({
          scope: { mode: 'cameras', cameras: ['press-3'] },
          when: { type: 'absence', zones: ['operator-area'], forS: 60 },
          schedule: { windows: [{ days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' }] },
          then: { severity: 'warning' },
        }),
      ),
    ).toBe('No person in operator-area for ≥ 60 s · press-3 · Mon–Fri 08:00–17:00 · warning');
    expect(
      describeRule(
        RuleDefinition.parse({
          scope: { mode: 'tags', tags: ['gate'] },
          when: { type: 'presence', zones: ['gate'] },
          schedule: { windows: [{ start: '22:00', end: '06:00' }] },
          then: { severity: 'danger' },
        }),
      ),
    ).toBe('Person in gate · tag gate · 22:00–06:00 · danger');
    expect(
      describeRule(RuleDefinition.parse({ scope: { mode: 'all' }, when: { type: 'count', op: 'gt', n: 2, forS: 10 }, then: { severity: 'info' } })),
    ).toBe('More than 2 person for ≥ 10 s · all cameras · always · info');
  });
});

import { timeAgo } from './ui';

describe('timeAgo', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');
  it('formats seconds, minutes, hours, days', () => {
    expect(timeAgo('2026-11-21T11:59:30Z', now)).toBe('30s ago');
    expect(timeAgo('2026-11-21T11:50:00Z', now)).toBe('10m ago');
    expect(timeAgo('2026-11-21T09:00:00Z', now)).toBe('3h ago');
    expect(timeAgo('2026-11-19T12:00:00Z', now)).toBe('2d ago');
    expect(timeAgo('2026-11-21T12:00:05Z', now)).toBe('0s ago'); // clock skew never negative
  });
});

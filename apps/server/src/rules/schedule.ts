import type { RuleSchedule } from '@cctv/shared';

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map<string, Intl.DateTimeFormat>();

/** Local weekday (0=Sun) and minutes since midnight in `timezone`. */
export function localTime(at: number, timezone: string): { day: number; minutes: number } {
  let fmt = fmtCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    fmtCache.set(timezone, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return { day: WEEKDAY[parts.weekday!] ?? 0, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Is the schedule active at `at`? No schedule = always active.
 * A window with end <= start runs overnight: it starts on one of `days` and ends the next morning.
 */
export function scheduleActive(schedule: RuleSchedule | null | undefined, timezone: string, at: number): boolean {
  if (!schedule) return true;
  const { day, minutes } = localTime(at, timezone);
  const yesterday = (day + 6) % 7;
  return schedule.windows.some((w) => {
    const s = toMin(w.start);
    const e = toMin(w.end);
    if (s < e) return w.days.includes(day) && minutes >= s && minutes < e;
    // overnight (or 24h when s === e)
    return (w.days.includes(day) && minutes >= s) || (w.days.includes(yesterday) && minutes < e);
  });
}

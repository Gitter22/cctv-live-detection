import type { RuleDefinition } from '@cctv/shared';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function days(d: number[]) {
  const s = [...d].sort();
  if (s.length === 7) return '';
  if (s.join() === '1,2,3,4,5') return 'Mon–Fri ';
  if (s.join() === '0,6') return 'weekends ';
  return `${s.map((x) => DAYS[x]).join(', ')} `;
}

const list = (xs: string[]) => xs.join(', ');

/** One-line plain-English summary of a rule, e.g. "Person in gate · tag gate · 22:00–06:00 · danger". */
export function describeRule(def: RuleDefinition): string {
  const w = def.when;
  const where = 'zones' in w && w.zones?.length ? ` in ${list(w.zones)}` : '';
  const what = 'classes' in w ? list(w.classes) : '';
  let cond: string;
  switch (w.type) {
    case 'presence':
      cond = `${what}${where}${w.minDwellS ? ` for ≥ ${w.minDwellS} s` : ''}`;
      break;
    case 'absence':
      cond = `no ${what}${where} for ≥ ${w.forS} s`;
      break;
    case 'count':
      cond = `${w.op === 'gt' ? 'more than' : 'fewer than'} ${w.n} ${what}${where}${w.forS ? ` for ≥ ${w.forS} s` : ''}`;
      break;
    case 'line_cross':
      cond = `${what} crosses ${w.lines?.length ? list(w.lines) : 'a line'}${w.direction !== 'any' ? ` (${w.direction})` : ''}`;
      break;
    case 'camera_offline':
      cond = `camera offline ≥ ${w.forS} s`;
      break;
  }
  const scope = def.scope.mode === 'all' ? 'all cameras' : def.scope.mode === 'tags' ? `tag ${list(def.scope.tags)}` : list(def.scope.cameras);
  const when = def.schedule?.windows.length ? def.schedule.windows.map((x) => `${days(x.days)}${x.start}–${x.end}`).join(' + ') : 'always';
  return `${cond.charAt(0).toUpperCase()}${cond.slice(1)} · ${scope} · ${when} · ${def.then.severity}`;
}

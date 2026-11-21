import { RuleDefinition, type RuleCondition } from '@cctv/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { del, errorMessage, patch, post } from '../api/client';
import { keys, useCameras, useRules } from '../api/hooks';
import type { Camera, Rule, Severity } from '../api/types';
import { describeRule } from '../components/describe-rule';
import { useOrgCtx } from '../components/Layout';
import { ErrorText, Modal, SeverityBadge } from '../components/ui';

export function RulesPage() {
  const { orgId, site, can } = useOrgCtx();
  const qc = useQueryClient();
  const rules = useRules(orgId, site?.id);
  const cameras = useCameras(orgId, site?.id);
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const toggle = useMutation({
    mutationFn: (r: Rule) => patch(`/orgs/${orgId}/sites/${site!.id}/rules/${r.id}`, { enabled: !r.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.rules(orgId, site!.id) }),
  });
  if (!site) return <p className="muted">No site selected.</p>;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Rules · {site.name}</h1>
          <p className="muted small">What counts as an alert. Times use the site timezone ({site.timezone}).</p>
        </div>
        {can('config.write') && (
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            New rule
          </button>
        )}
      </header>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>On</th>
              <th>Rule</th>
              <th>Severity</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(rules.data ?? []).map((r) => (
              <tr key={r.id} className={r.enabled ? '' : 'muted'}>
                <td>
                  <input type="checkbox" aria-label={`Enable ${r.name}`} checked={r.enabled} disabled={!can('config.write')} onChange={() => toggle.mutate(r)} />
                </td>
                <td>
                  <strong>{r.name}</strong>
                  <div className="small muted">{describeRule(r.definition)}</div>
                </td>
                <td>
                  <SeverityBadge severity={r.definition.then.severity} />
                </td>
                <td className="right">
                  {can('config.write') && (
                    <button className="btn btn-sm" onClick={() => setEditing(r)}>
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rules.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No rules yet: nothing will raise alerts at this site.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && <RuleForm rule={editing === 'new' ? null : editing} cameras={cameras.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

type CondType = RuleCondition['type'];
const COND_LABEL: Record<CondType, string> = {
  presence: 'Something is present',
  absence: 'Nobody / nothing present',
  count: 'Too many / too few',
  line_cross: 'Crosses a line',
  camera_offline: 'Camera offline',
};
const CLASSES = ['person', 'car', 'motorcycle', 'bicycle', 'truck', 'dog', 'cat'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface FormState {
  name: string;
  enabled: boolean;
  scopeMode: 'all' | 'tags' | 'cameras';
  tags: string;
  cameras: string[];
  type: CondType;
  classes: string[];
  zones: string[];
  lines: string[];
  direction: 'in' | 'out' | 'any';
  minDwellS: number;
  forS: number;
  op: 'gt' | 'lt';
  n: number;
  scheduled: boolean;
  windows: { days: number[]; start: string; end: string }[];
  severity: Severity;
  title: string;
  cooldownS: number;
}

function initial(rule: Rule | null): FormState {
  const d = rule?.definition;
  const w = d?.when;
  return {
    name: rule?.name ?? '',
    enabled: rule?.enabled ?? true,
    scopeMode: d?.scope.mode ?? 'all',
    tags: d?.scope.mode === 'tags' ? d.scope.tags.join(', ') : '',
    cameras: d?.scope.mode === 'cameras' ? d.scope.cameras : [],
    type: w?.type ?? 'presence',
    classes: w && 'classes' in w ? w.classes : ['person'],
    zones: w && 'zones' in w ? (w.zones ?? []) : [],
    lines: w?.type === 'line_cross' ? (w.lines ?? []) : [],
    direction: w?.type === 'line_cross' ? w.direction : 'any',
    minDwellS: w?.type === 'presence' ? w.minDwellS : 0,
    forS: w && 'forS' in w ? w.forS : 60,
    op: w?.type === 'count' ? w.op : 'gt',
    n: w?.type === 'count' ? w.n : 2,
    scheduled: !!d?.schedule?.windows.length,
    windows: d?.schedule?.windows ?? [{ days: [0, 1, 2, 3, 4, 5, 6], start: '22:00', end: '06:00' }],
    severity: d?.then.severity ?? 'warning',
    title: d?.then.title ?? '',
    cooldownS: d?.cooldownS ?? 300,
  };
}

function toDefinition(f: FormState) {
  const scope =
    f.scopeMode === 'all'
      ? { mode: 'all' }
      : f.scopeMode === 'tags'
        ? { mode: 'tags', tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean) }
        : { mode: 'cameras', cameras: f.cameras };
  const zones = f.zones.length ? f.zones : undefined;
  const when =
    f.type === 'presence'
      ? { type: f.type, classes: f.classes, zones, minDwellS: Number(f.minDwellS) }
      : f.type === 'absence'
        ? { type: f.type, classes: f.classes, zones, forS: Number(f.forS) }
        : f.type === 'count'
          ? { type: f.type, classes: f.classes, zones, op: f.op, n: Number(f.n), forS: Number(f.forS) }
          : f.type === 'line_cross'
            ? { type: f.type, classes: f.classes, lines: f.lines.length ? f.lines : undefined, direction: f.direction }
            : { type: f.type, forS: Number(f.forS) };
  return RuleDefinition.safeParse({
    scope,
    when,
    schedule: f.scheduled ? { windows: f.windows } : null,
    then: { severity: f.severity, ...(f.title.trim() ? { title: f.title.trim() } : {}) },
    cooldownS: Number(f.cooldownS),
  });
}

function RuleForm({ rule, cameras, onClose }: { rule: Rule | null; cameras: Camera[]; onClose(): void }) {
  const { orgId, site } = useOrgCtx();
  const qc = useQueryClient();
  const [f, setF] = useState<FormState>(() => initial(rule));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const toggleIn = (k: 'classes' | 'zones' | 'lines' | 'cameras', v: string) =>
    setF((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }));

  // Zones/lines offered = those of the cameras in scope.
  const scoped = useMemo(() => {
    if (f.scopeMode === 'cameras') return cameras.filter((c) => f.cameras.includes(c.key));
    if (f.scopeMode === 'tags') {
      const tags = f.tags.split(',').map((t) => t.trim());
      return cameras.filter((c) => c.tags.some((t) => tags.includes(t)));
    }
    return cameras;
  }, [cameras, f.scopeMode, f.cameras, f.tags]);
  const zoneKeys = [...new Set(scoped.flatMap((c) => c.zones.map((z) => z.key)))];
  const lineKeys = [...new Set(scoped.flatMap((c) => c.lines.map((l) => l.key)))];
  const allTags = [...new Set(cameras.flatMap((c) => c.tags))];

  const base = `/orgs/${orgId}/sites/${site!.id}/rules`;
  const save = useMutation({
    mutationFn: (definition: unknown) =>
      rule ? patch(`${base}/${rule.id}`, { name: f.name, enabled: f.enabled, definition }) : post(base, { name: f.name, enabled: f.enabled, definition }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.rules(orgId, site!.id) });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => del(`${base}/${rule!.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.rules(orgId, site!.id) });
      onClose();
    },
  });

  const parsed = toDefinition(f);
  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }
    save.mutate(parsed.data);
  };

  const hasClasses = f.type !== 'camera_offline';
  const hasZones = f.type === 'presence' || f.type === 'absence' || f.type === 'count';

  return (
    <Modal title={rule ? `Edit rule` : 'New rule'} onClose={onClose}>
      <form
        className="form-grid rule-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label style={{ gridColumn: '1 / -1' }}>
          Name
          <input required value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Operator left machine" />
        </label>

        <fieldset className="checks">
          <legend className="small">Cameras</legend>
          {(['all', 'tags', 'cameras'] as const).map((m) => (
            <label key={m} className="check">
              <input type="radio" name="scope" checked={f.scopeMode === m} onChange={() => set('scopeMode', m)} />
              {m === 'all' ? 'All cameras' : m === 'tags' ? 'Cameras with tag' : 'Specific cameras'}
            </label>
          ))}
          {f.scopeMode === 'tags' && (
            <input aria-label="Tags" list="tag-options" placeholder="gate, machine-area" value={f.tags} onChange={(e) => set('tags', e.target.value)} />
          )}
          <datalist id="tag-options">
            {allTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          {f.scopeMode === 'cameras' &&
            cameras.map((c) => (
              <label key={c.key} className="check">
                <input type="checkbox" checked={f.cameras.includes(c.key)} onChange={() => toggleIn('cameras', c.key)} />
                {c.label}
              </label>
            ))}
        </fieldset>

        <label>
          When
          <select value={f.type} onChange={(e) => set('type', e.target.value as CondType)}>
            {(Object.keys(COND_LABEL) as CondType[]).map((t) => (
              <option key={t} value={t}>
                {COND_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        {f.type === 'presence' && (
          <label>
            Stays at least (s)
            <input type="number" min={0} max={3600} value={f.minDwellS} onChange={(e) => set('minDwellS', Number(e.target.value))} />
          </label>
        )}
        {(f.type === 'absence' || f.type === 'count' || f.type === 'camera_offline') && (
          <label>
            For at least (s)
            <input type="number" min={f.type === 'absence' ? 5 : 0} value={f.forS} onChange={(e) => set('forS', Number(e.target.value))} />
          </label>
        )}
        {f.type === 'count' && (
          <>
            <label>
              Condition
              <select value={f.op} onChange={(e) => set('op', e.target.value as 'gt' | 'lt')}>
                <option value="gt">more than</option>
                <option value="lt">fewer than</option>
              </select>
            </label>
            <label>
              Number
              <input type="number" min={0} value={f.n} onChange={(e) => set('n', Number(e.target.value))} />
            </label>
          </>
        )}
        {f.type === 'line_cross' && (
          <label>
            Direction
            <select value={f.direction} onChange={(e) => set('direction', e.target.value as FormState['direction'])}>
              <option value="any">any</option>
              <option value="in">in</option>
              <option value="out">out</option>
            </select>
          </label>
        )}

        {hasClasses && (
          <fieldset className="checks">
            <legend className="small">Objects</legend>
            {[...new Set([...CLASSES, ...f.classes])].map((c) => (
              <label key={c} className="check">
                <input type="checkbox" checked={f.classes.includes(c)} onChange={() => toggleIn('classes', c)} />
                {c}
              </label>
            ))}
          </fieldset>
        )}
        {hasZones && (
          <fieldset className="checks">
            <legend className="small">Zones (none = any zone)</legend>
            {zoneKeys.length === 0 && <span className="muted small">No zones on these cameras yet: draw them on the camera page.</span>}
            {zoneKeys.map((z) => (
              <label key={z} className="check">
                <input type="checkbox" checked={f.zones.includes(z)} onChange={() => toggleIn('zones', z)} />
                {z}
              </label>
            ))}
          </fieldset>
        )}
        {f.type === 'line_cross' && (
          <fieldset className="checks">
            <legend className="small">Lines (none = any line)</legend>
            {lineKeys.map((l) => (
              <label key={l} className="check">
                <input type="checkbox" checked={f.lines.includes(l)} onChange={() => toggleIn('lines', l)} />
                {l}
              </label>
            ))}
          </fieldset>
        )}

        <fieldset className="checks schedule">
          <legend className="small">Schedule ({site?.timezone})</legend>
          <label className="check">
            <input type="checkbox" checked={f.scheduled} onChange={(e) => set('scheduled', e.target.checked)} /> Only at certain times
          </label>
          {f.scheduled &&
            f.windows.map((w, i) => (
              <div key={i} className="window-row">
                {DAYS.map((d, di) => (
                  <label key={d} className="check day">
                    <input
                      type="checkbox"
                      checked={w.days.includes(di)}
                      onChange={() =>
                        set(
                          'windows',
                          f.windows.map((x, xi) => (xi === i ? { ...x, days: x.days.includes(di) ? x.days.filter((y) => y !== di) : [...x.days, di].sort() } : x)),
                        )
                      }
                    />
                    {d}
                  </label>
                ))}
                <input type="time" aria-label="From" value={w.start} onChange={(e) => set('windows', f.windows.map((x, xi) => (xi === i ? { ...x, start: e.target.value } : x)))} />
                <input type="time" aria-label="To" value={w.end} onChange={(e) => set('windows', f.windows.map((x, xi) => (xi === i ? { ...x, end: e.target.value } : x)))} />
                {f.windows.length > 1 && (
                  <button type="button" className="btn btn-sm" onClick={() => set('windows', f.windows.filter((_, xi) => xi !== i))}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          {f.scheduled && (
            <button type="button" className="btn btn-sm" onClick={() => set('windows', [...f.windows, { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' }])}>
              Add time window
            </button>
          )}
        </fieldset>

        <label>
          Severity
          <select value={f.severity} onChange={(e) => set('severity', e.target.value as Severity)}>
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="danger">danger</option>
          </select>
        </label>
        <label>
          Cooldown (s)
          <input type="number" min={0} value={f.cooldownS} onChange={(e) => set('cooldownS', Number(e.target.value))} />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          Alert title <span className="muted small">(optional)</span>
          <input value={f.title} onChange={(e) => set('title', e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Enabled
        </label>
        {parsed.success && <p className="muted small summary">{describeRule(parsed.data)}</p>}
        <div className="form-actions">
          <ErrorText error={error} />
          {rule && (
            <button type="button" className="btn btn-danger" onClick={() => confirm(`Delete rule "${rule.name}"?`) && remove.mutate()}>
              Delete
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={save.isPending}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { del, errorMessage, patch, post } from '../api/client';
import { keys, useCameras, useSources } from '../api/hooks';
import type { Camera, Source } from '../api/types';
import { useOrgCtx } from '../components/Layout';
import { ErrorText, Modal, StatusBadge } from '../components/ui';

export function CamerasPage() {
  const { orgId, site, can } = useOrgCtx();
  const cameras = useCameras(orgId, site?.id);
  const sources = useSources(orgId, site?.id);
  const [editing, setEditing] = useState<Camera | 'new' | null>(null);
  if (!site) return <p className="muted">No site selected.</p>;
  const sourceName = (id: string | null) => sources.data?.find((s) => s.id === id)?.name ?? '—';

  return (
    <div className="page">
      <header className="page-head">
        <h1>Cameras · {site.name}</h1>
        {can('config.write') && (
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            Add camera
          </button>
        )}
      </header>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Camera</th>
              <th>Stream</th>
              <th>Tags</th>
              <th>Detects</th>
              <th>Zones</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(cameras.data ?? []).map((c) => (
              <tr key={c.id}>
                <td>
                  <Link to={`/o/${orgId}/cameras/${c.id}`}>
                    <strong>{c.label}</strong>
                  </Link>
                  <div className="muted small">{c.key}</div>
                </td>
                <td className="small">{c.subUrlSet ? 'Own URL' : `${sourceName(c.sourceId)}${c.channel ? ` · ch ${c.channel}` : ''}`}</td>
                <td className="small">{c.tags.join(', ') || '—'}</td>
                <td className="small">
                  {c.detection.classes.join(', ')} · {c.detection.detectFps} fps
                </td>
                <td className="small">{c.zones.length + c.lines.length}</td>
                <td>
                  <StatusBadge status={c.status} enabled={c.enabled} />
                </td>
                <td className="right nowrap">
                  <Link className="btn btn-sm" to={`/o/${orgId}/cameras/${c.id}`}>
                    Zones
                  </Link>{' '}
                  {can('config.write') && (
                    <button className="btn btn-sm" onClick={() => setEditing(c)}>
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <CameraForm camera={editing === 'new' ? null : editing} sources={sources.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

const COMMON_CLASSES = ['person', 'car', 'motorcycle', 'bicycle', 'truck', 'bus', 'dog', 'cat'];

function CameraForm({ camera, sources, onClose }: { camera: Camera | null; sources: Source[]; onClose(): void }) {
  const { orgId, site } = useOrgCtx();
  const qc = useQueryClient();
  const base = `/orgs/${orgId}/sites/${site!.id}/cameras`;
  const [form, setForm] = useState({
    key: camera?.key ?? '',
    label: camera?.label ?? '',
    sourceId: camera?.sourceId ?? sources[0]?.id ?? '',
    channel: camera?.channel ?? 1,
    subUrl: '',
    mainUrl: '',
    tags: camera?.tags.join(', ') ?? '',
    enabled: camera?.enabled ?? true,
    classes: camera?.detection.classes ?? ['person'],
    confidence: camera?.detection.confidence ?? 0.5,
    detectFps: camera?.detection.detectFps ?? 5,
    motionGate: camera?.detection.motionGate ?? true,
    faces: camera?.detection.faces ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const source = sources.find((s) => s.id === form.sourceId);
  const needsChannel = !!source && source.kind !== 'RAW_URL' && source.vendor !== 'generic';

  const save = useMutation({
    mutationFn: () => {
      const body = {
        key: form.key,
        label: form.label,
        sourceId: form.sourceId || null,
        channel: needsChannel ? Number(form.channel) : null,
        ...(form.subUrl ? { subUrl: form.subUrl } : {}),
        ...(form.mainUrl ? { mainUrl: form.mainUrl } : {}),
        enabled: form.enabled,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        detection: { classes: form.classes, confidence: Number(form.confidence), detectFps: Number(form.detectFps), motionGate: form.motionGate, faces: form.faces },
      };
      return camera ? patch(`${base}/${camera.id}`, body) : post(base, body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cameras', orgId] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => del(`${base}/${camera!.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.cameras(orgId, site!.id) });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const toggleClass = (c: string) =>
    setForm({ ...form, classes: form.classes.includes(c) ? form.classes.filter((x) => x !== c) : [...form.classes, c] });

  return (
    <Modal title={camera ? `Edit ${camera.label}` : 'Add camera'} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <label>
          Key <span className="muted small">(stream ID, e.g. entrance-1)</span>
          <input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.key} onChange={set('key')} />
        </label>
        <label>
          Label
          <input required value={form.label} onChange={set('label')} placeholder="Entrance gate" />
        </label>
        <label>
          Source
          <select value={form.sourceId} onChange={set('sourceId')}>
            <option value="">None (own URL)</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {needsChannel && (
          <label>
            Channel
            <input type="number" min={1} max={512} value={form.channel} onChange={set('channel')} />
          </label>
        )}
        {(!form.sourceId || source?.vendor === 'generic') && (
          <>
            <label style={{ gridColumn: '1 / -1' }}>
              Detection stream URL (sub) {camera?.subUrlSet && <span className="muted small">(set; type to replace)</span>}
              <input type="password" autoComplete="off" value={form.subUrl} onChange={set('subUrl')} placeholder="rtsp://…" />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              HD stream URL (main, optional)
              <input type="password" autoComplete="off" value={form.mainUrl} onChange={set('mainUrl')} placeholder="rtsp://…" />
            </label>
          </>
        )}
        <label>
          Tags <span className="muted small">(comma separated)</span>
          <input value={form.tags} onChange={set('tags')} placeholder="gate, outdoor" />
        </label>
        <label className="check">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled
        </label>
        <fieldset className="checks">
          <legend className="small">Detect</legend>
          {[...new Set([...COMMON_CLASSES, ...form.classes])].map((c) => (
            <label key={c} className="check">
              <input type="checkbox" checked={form.classes.includes(c)} onChange={() => toggleClass(c)} />
              {c}
            </label>
          ))}
        </fieldset>
        <label>
          Confidence
          <input type="number" step="0.05" min={0.1} max={0.95} value={form.confidence} onChange={set('confidence')} />
        </label>
        <label>
          Detections / s
          <input type="number" step="0.5" min={0.5} max={15} value={form.detectFps} onChange={set('detectFps')} />
        </label>
        <label className="check">
          <input type="checkbox" checked={form.motionGate} onChange={(e) => setForm({ ...form, motionGate: e.target.checked })} /> Motion gate (save CPU)
        </label>
        <label className="check">
          <input type="checkbox" checked={form.faces} onChange={(e) => setForm({ ...form, faces: e.target.checked })} /> Recognise faces (uses the HD stream)
        </label>
        <div className="form-actions">
          <ErrorText error={error} />
          {camera && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                if (confirm(`Delete camera ${camera.label}? Its zones are deleted too.`)) remove.mutate();
              }}
            >
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

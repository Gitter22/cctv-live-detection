import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Link, useParams } from 'react-router';
import { del, errorMessage, patch, post } from '../api/client';
import { useCameras } from '../api/hooks';
import type { Camera, Point } from '../api/types';
import { slugify, svgPoints, toNorm } from '../components/geometry';
import { useOrgCtx } from '../components/Layout';
import { ErrorText, StatusBadge } from '../components/ui';
import { LiveView } from './LiveView';

/** A zone or line being edited (local until saved). */
interface Shape {
  uid: string;
  id?: string; // server id once saved
  kind: 'zone' | 'line';
  key: string;
  label: string;
  points: Point[];
  dirty: boolean;
  deleted: boolean;
}

type Mode = 'select' | 'zone' | 'line';

const fromCamera = (c: Camera): Shape[] => [
  ...c.zones.map((z) => ({ uid: z.id, id: z.id, kind: 'zone' as const, key: z.key, label: z.label, points: z.polygon, dirty: false, deleted: false })),
  ...c.lines.map((l) => ({ uid: l.id, id: l.id, kind: 'line' as const, key: l.key, label: l.label, points: [l.start, l.end], dirty: false, deleted: false })),
];

export function CameraDetailPage() {
  const { cameraId } = useParams();
  const { orgId, site, can } = useOrgCtx();
  const cameras = useCameras(orgId, site?.id);
  const camera = cameras.data?.find((c) => c.id === cameraId);
  if (cameras.isLoading) return <p className="muted">Loading…</p>;
  if (!camera || !site) return <p className="muted">Camera not found at this site.</p>;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <Link to={`/o/${orgId}/cameras`} className="muted small">
            ← Cameras
          </Link>
          <h1>
            {camera.label} <span className="muted small">{camera.key}</span>
          </h1>
        </div>
        <StatusBadge status={camera.status} enabled={camera.enabled} />
      </header>
      {can('footage.read') && <LiveView orgId={orgId} camera={camera} />}
      <ZoneEditor key={camera.id} camera={camera} siteId={site.id} editable={can('config.write')} showImage={can('footage.read')} />
    </div>
  );
}

function ZoneEditor({ camera, siteId, editable, showImage }: { camera: Camera; siteId: string; editable: boolean; showImage: boolean }) {
  const { orgId } = useOrgCtx();
  const qc = useQueryClient();
  const [shapes, setShapes] = useState<Shape[]>(() => fromCamera(camera));
  const [mode, setMode] = useState<Mode>('select');
  const [draft, setDraft] = useState<Point[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ uid: string; i: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgTick] = useState(() => Date.now());
  const box = useRef<HTMLDivElement>(null);
  const dirty = shapes.some((s) => s.dirty || (s.deleted && s.id) || (!s.id && !s.deleted));

  const update = (uid: string, change: Partial<Shape>) => setShapes((all) => all.map((s) => (s.uid === uid ? { ...s, ...change, dirty: true } : s)));
  const pointAt = (e: { clientX: number; clientY: number }) => toNorm(e.clientX, e.clientY, box.current!.getBoundingClientRect());

  const finishDraft = (pts: Point[], kind: 'zone' | 'line') => {
    const n = shapes.filter((s) => s.kind === kind).length + 1;
    const label = kind === 'zone' ? `Zone ${n}` : `Line ${n}`;
    let key = slugify(label);
    while (shapes.some((s) => s.kind === kind && s.key === key)) key = `${key}-x`;
    const shape: Shape = { uid: crypto.randomUUID(), kind, key, label, points: pts, dirty: true, deleted: false };
    setShapes((all) => [...all, shape]);
    setSelected(shape.uid);
    setDraft([]);
    setMode('select');
  };

  const onCanvasDown = (e: RPointerEvent) => {
    if (!editable || mode === 'select') return;
    const p = pointAt(e);
    if (mode === 'line') {
      const pts = [...draft, p];
      if (pts.length === 2) finishDraft(pts, 'line');
      else setDraft(pts);
      return;
    }
    // zone: clicking near the first point closes the polygon
    const first = draft[0];
    const rect = box.current!.getBoundingClientRect();
    if (first && draft.length >= 3 && Math.hypot((first[0] - p[0]) * rect.width, (first[1] - p[1]) * rect.height) < 12) {
      finishDraft(draft, 'zone');
    } else setDraft([...draft, p]);
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const p = pointAt(e);
      setShapes((all) => all.map((s) => (s.uid === drag.uid ? { ...s, dirty: true, points: s.points.map((q, i) => (i === drag.i ? p : q)) } : s)));
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDraft([]);
        setMode('select');
      }
      if (e.key === 'Enter' && mode === 'zone' && draft.length >= 3) finishDraft(draft, 'zone');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function save() {
    setSaving(true);
    setError(null);
    const base = `/orgs/${orgId}/sites/${siteId}/cameras/${camera.id}`;
    try {
      for (const s of shapes) {
        const path = `${base}/${s.kind === 'zone' ? 'zones' : 'lines'}`;
        const body = s.kind === 'zone' ? { key: s.key, label: s.label, polygon: s.points } : { key: s.key, label: s.label, start: s.points[0], end: s.points[1] };
        if (s.deleted) {
          if (s.id) await del(`${path}/${s.id}`);
        } else if (!s.id) await post(path, body);
        else if (s.dirty) await patch(`${path}/${s.id}`, body);
      }
      await qc.invalidateQueries({ queryKey: ['cameras', orgId] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  // After a save, the camera prop refreshes: re-sync local shapes when nothing is pending.
  const serverSig = useMemo(() => JSON.stringify([camera.zones, camera.lines]), [camera.zones, camera.lines]);
  useEffect(() => {
    if (!saving) setShapes(fromCamera(camera));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSig]);

  const visible = shapes.filter((s) => !s.deleted);
  const sel = visible.find((s) => s.uid === selected);

  return (
    <section className="card editor">
      <div className="section-head">
        <h2>Zones and lines</h2>
        {editable && (
          <div className="toolbar">
            <button className={`btn btn-sm ${mode === 'zone' ? 'btn-primary' : ''}`} onClick={() => { setMode('zone'); setDraft([]); }}>
              Draw zone
            </button>
            <button className={`btn btn-sm ${mode === 'line' ? 'btn-primary' : ''}`} onClick={() => { setMode('line'); setDraft([]); }}>
              Draw line
            </button>
            <button className="btn btn-sm btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
      <p className="muted small">
        {mode === 'zone'
          ? 'Click to add corners; click the first corner (or press Enter) to close. Esc cancels.'
          : mode === 'line'
            ? 'Click the start and end of the line. Crossing direction "in" is to the left of start→end.'
            : 'Zones decide where objects count (by their feet). Drag corners to adjust. Changes reach the edge within ~10 s after saving.'}
      </p>
      <div className="editor-body">
        <div ref={box} className={`canvas ${mode !== 'select' ? 'drawing' : ''}`} onPointerDown={onCanvasDown}>
          {showImage ? (
            <img
              src={`/api/orgs/${orgId}/sites/${siteId}/cameras/${camera.id}/thumbnail?t=${imgTick}`}
              alt={`${camera.label} still`}
              draggable={false}
              onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')}
            />
          ) : (
            <div className="no-image muted small">No footage access: drawing on a blank frame</div>
          )}
          <svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
            {visible.map((s) =>
              s.kind === 'zone' ? (
                <polygon key={s.uid} points={svgPoints(s.points)} className={`zone ${s.uid === selected ? 'sel' : ''}`} onPointerDown={(e) => { if (mode === 'select') { e.stopPropagation(); setSelected(s.uid); } }} />
              ) : (
                <line key={s.uid} x1={s.points[0]![0] * 1000} y1={s.points[0]![1] * 1000} x2={s.points[1]![0] * 1000} y2={s.points[1]![1] * 1000} className={`line ${s.uid === selected ? 'sel' : ''}`} onPointerDown={(e) => { if (mode === 'select') { e.stopPropagation(); setSelected(s.uid); } }} />
              ),
            )}
            {draft.length > 0 && <polyline points={svgPoints(draft)} className="draft" />}
          </svg>
          {visible.map((s) => (
            <span key={`l-${s.uid}`} className="shape-label" style={{ left: `${s.points[0]![0] * 100}%`, top: `${s.points[0]![1] * 100}%` }}>
              {s.label}
            </span>
          ))}
          {editable &&
            mode === 'select' &&
            sel?.points.map((p, i) => (
              <span
                key={`${sel.uid}-${i}`}
                className="handle"
                style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setDrag({ uid: sel.uid, i });
                }}
              />
            ))}
          {draft.map((p, i) => (
            <span key={`d-${i}`} className="handle draft-handle" style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }} />
          ))}
        </div>
        <div className="shape-list">
          {visible.length === 0 && <p className="muted small">No zones yet. Without zones nothing triggers zone rules.</p>}
          {visible.map((s) => (
            <div key={s.uid} className={`shape-row ${s.uid === selected ? 'sel' : ''}`} onClick={() => setSelected(s.uid)}>
              <span className={`swatch ${s.kind}`} />
              {editable ? (
                <input aria-label={`${s.kind} name`} value={s.label} onChange={(e) => update(s.uid, { label: e.target.value, ...(s.id ? {} : { key: slugify(e.target.value) }) })} />
              ) : (
                <span>{s.label}</span>
              )}
              <code className="small">{s.key}</code>
              {editable && (
                <button className="btn btn-sm btn-danger" aria-label={`Delete ${s.label}`} onClick={() => update(s.uid, { deleted: true })}>
                  ✕
                </button>
              )}
            </div>
          ))}
          <ErrorText error={error} />
        </div>
      </div>
    </section>
  );
}

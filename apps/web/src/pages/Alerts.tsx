import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { errorMessage, post } from '../api/client';
import { keys, useAlerts, useCameras } from '../api/hooks';
import type { Alert } from '../api/types';
import { useOrgCtx } from '../components/Layout';
import { ErrorText, SeverityBadge, formatTime, timeAgo, useTicker } from '../components/ui';
import { LiveView } from './LiveView';
import { FacePanel } from './People';

export function AlertsPage() {
  const { orgId, site, sites, can } = useOrgCtx();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'OPEN';
  const severity = params.get('severity') ?? '';
  const cameraKey = params.get('camera') ?? '';
  const alerts = useAlerts(orgId, { siteId: site?.id, status: status || undefined, severity: severity || undefined, cameraKey: cameraKey || undefined });
  const cameras = useCameras(orgId, site?.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useTicker(30_000); // keep "x min ago" fresh
  const list = alerts.data?.alerts ?? [];
  const selected = list.find((a) => a.id === selectedId) ?? list[0];
  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === 'status' && !v) next.set('status', '');
    setParams(next);
  };
  if (!can('footage.read')) return <p className="muted">You don't have access to alerts.</p>;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Alerts{sites.length > 1 && site ? ` · ${site.name}` : ''}</h1>
        <div className="toolbar">
          <select aria-label="Status" value={status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="OPEN">Open</option>
            <option value="ACKED">Acknowledged</option>
            <option value="CLOSED">Closed</option>
            <option value="">All</option>
          </select>
          <select aria-label="Severity" value={severity} onChange={(e) => setFilter('severity', e.target.value)}>
            <option value="">All severities</option>
            <option value="danger">Danger</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
          <select aria-label="Camera" value={cameraKey} onChange={(e) => setFilter('camera', e.target.value)}>
            <option value="">All cameras</option>
            {(cameras.data ?? []).map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </header>
      <div className="alerts-layout">
        <ul className="card alert-list" aria-label="Alerts">
          {list.map((a) => (
            <li key={a.id}>
              <button className={`alert-item ${a.id === selected?.id ? 'sel' : ''}`} onClick={() => setSelectedId(a.id)}>
                <SeverityBadge severity={a.severity} />
                <span className="alert-title">{a.title}</span>
                <span className="muted small">
                  {timeAgo(a.createdAt)} · {a.status.toLowerCase()}
                </span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="muted empty">{alerts.isLoading ? 'Loading…' : 'No alerts here. 🎉'}</li>}
        </ul>
        {selected && <AlertDetail key={selected.id} alert={selected} timezone={site?.timezone} />}
      </div>
    </div>
  );
}

function AlertDetail({ alert, timezone }: { alert: Alert; timezone?: string }) {
  const { orgId, site, can } = useOrgCtx();
  const qc = useQueryClient();
  const cameras = useCameras(orgId, site?.id);
  const camera = cameras.data?.find((c) => c.key === alert.cameraKey);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const act = useMutation({
    mutationFn: (v: { action: string; body?: unknown }) => post(`/orgs/${orgId}/alerts/${alert.id}/${v.action}`, v.body),
    onSuccess: () => {
      setNote('');
      void qc.invalidateQueries({ queryKey: keys.alerts(orgId) });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const bbox = alert.event?.payload.object?.bbox;

  return (
    <article className="card alert-detail" aria-label="Alert detail">
      <div className="section-head">
        <h2>{alert.title}</h2>
        <SeverityBadge severity={alert.severity} />
      </div>
      <div className="snapshot">
        {alert.snapshotUrl ? (
          <>
            <img src={alert.snapshotUrl} alt="Snapshot at the time of the alert" />
            {bbox && alert.event?.type !== 'face.observed' && (
              <span
                className="bbox"
                style={{ left: `${bbox[0] * 100}%`, top: `${bbox[1] * 100}%`, width: `${(bbox[2] - bbox[0]) * 100}%`, height: `${(bbox[3] - bbox[1]) * 100}%` }}
              />
            )}
          </>
        ) : (
          <span className="muted small">No snapshot for this alert</span>
        )}
      </div>
      <FacePanel alert={alert} />
      <dl className="facts">
        <dt>When</dt>
        <dd>{formatTime(alert.createdAt, timezone)}</dd>
        <dt>Camera</dt>
        <dd>{camera?.label ?? alert.cameraKey ?? '—'}</dd>
        <dt>Rule</dt>
        <dd>{alert.ruleName ?? '—'}</dd>
        <dt>Status</dt>
        <dd>
          {alert.status.toLowerCase()}
          {alert.ackedAt ? ` · acknowledged ${timeAgo(alert.ackedAt)}` : ''}
        </dd>
      </dl>
      {can('alerts.manage') && (
        <div className="toolbar">
          {alert.status === 'OPEN' && (
            <button className="btn btn-primary" onClick={() => act.mutate({ action: 'ack' })}>
              Acknowledge
            </button>
          )}
          {alert.status !== 'CLOSED' ? (
            <button className="btn" onClick={() => act.mutate({ action: 'close' })}>
              Close
            </button>
          ) : (
            <button className="btn" onClick={() => act.mutate({ action: 'reopen' })}>
              Reopen
            </button>
          )}
          {camera && (
            <button className="btn" onClick={() => setLive((v) => !v)}>
              {live ? 'Hide live' : 'Watch live'}
            </button>
          )}
        </div>
      )}
      {live && camera && <LiveView orgId={orgId} camera={camera} autoplay />}
      <section className="notes">
        <h3 className="small muted">Notes</h3>
        {alert.notes.map((n, i) => (
          <p key={i} className="note">
            <strong>{n.byName}</strong> <span className="muted small">{timeAgo(n.at)}</span>
            <br />
            {n.text}
          </p>
        ))}
        {can('alerts.manage') && (
          <form
            className="form-row"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              if (note.trim()) act.mutate({ action: 'notes', body: { text: note } });
            }}
          >
            <input className="grow" aria-label="Add a note" placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn btn-sm" disabled={!note.trim()}>
              Add
            </button>
          </form>
        )}
        <ErrorText error={error} />
      </section>
    </article>
  );
}

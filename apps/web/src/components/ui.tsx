import { useEffect, useState, type ReactNode } from 'react';
import type { CameraStatus, Severity } from '../api/types';

export function StatusBadge({ status, enabled = true }: { status?: CameraStatus | null; enabled?: boolean }) {
  if (!enabled) return <span className="badge">Disabled</span>;
  if (!status || status.online === null) return <span className="badge" title={status?.reason ?? 'No report yet'}>Unknown</span>;
  return status.online ? (
    <span className="badge badge-ok">Online</span>
  ) : (
    <span className="badge badge-danger" title={status.reason ?? ''}>
      Offline
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge badge-${severity === 'danger' ? 'danger' : severity === 'warning' ? 'warning' : 'info'}`}>{severity}</span>;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

export function formatTime(iso: string, timeZone?: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium', timeZone }).format(new Date(iso));
}

/** A counter that changes every `ms` (cache-busting, relative times). */
export function useTicker(ms: number) {
  const [n, setN] = useState(() => Math.floor(Date.now() / ms));
  useEffect(() => {
    const t = setInterval(() => setN(Math.floor(Date.now() / ms)), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}

export function Modal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { errorMessage, patch, post } from '../api/client';
import { keys, useEdges, useSources } from '../api/hooks';
import type { Source } from '../api/types';
import { useOrgCtx } from '../components/Layout';
import { ErrorText, Modal, timeAgo } from '../components/ui';

/** Settings → sites: create sites; per site its sources (credentials) and edges (tokens). */
export function SitesTab() {
  const { orgId, sites, site, setSiteId, can } = useOrgCtx();
  return (
    <div className="page">
      {can('config.write') && <CreateSite />}
      {sites.length > 0 && (
        <div className="tabs" role="tablist" aria-label="Site">
          {sites.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === site?.id} className={`tab ${s.id === site?.id ? 'tab-active' : ''}`} onClick={() => setSiteId(s.id)}>
              {s.name} <span className="muted small">({s.timezone})</span>
            </button>
          ))}
        </div>
      )}
      {site && <SourcesSection orgId={orgId} siteId={site.id} />}
      {site && <EdgesSection orgId={orgId} siteId={site.id} siteName={site.name} />}
    </div>
  );
}

function CreateSite() {
  const { orgId, setSiteId } = useOrgCtx();
  const qc = useQueryClient();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [form, setForm] = useState({ name: '', slug: '', timezone: tz });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => post<{ site: { id: string } }>(`/orgs/${orgId}/sites`, form),
    onSuccess: (r) => {
      setForm({ name: '', slug: '', timezone: tz });
      void qc.invalidateQueries({ queryKey: keys.sites(orgId) });
      setSiteId(r.site.id);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <form
      className="card form-row"
      aria-label="New site"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setError(null);
        create.mutate();
      }}
    >
      <label className="grow">
        New site
        <input required placeholder="Shop 3" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label>
        Slug
        <input required placeholder="shop-3" pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
      </label>
      <label>
        Timezone
        <input required value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
      </label>
      <button className="btn btn-primary" disabled={create.isPending}>
        Add site
      </button>
      <ErrorText error={error} />
    </form>
  );
}

// ---------------------------------------------------------------- sources

function SourcesSection({ orgId, siteId }: { orgId: string; siteId: string }) {
  const { can } = useOrgCtx();
  const sources = useSources(orgId, siteId);
  const [editing, setEditing] = useState<Source | 'new' | null>(null);
  return (
    <section className="card">
      <div className="section-head">
        <h2>Sources</h2>
        {can('config.write') && (
          <button className="btn btn-sm" onClick={() => setEditing('new')}>
            Add source
          </button>
        )}
      </div>
      <p className="muted small">An NVR or camera (vendor template, host, credentials) or a raw RTSP URL. Passwords are encrypted and never shown again.</p>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>Address</th>
            <th>Credentials</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(sources.data ?? []).map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>
                {s.kind}
                {s.vendor ? <span className="muted small"> · {s.vendor}</span> : null}
              </td>
              <td className="small">{s.kind === 'RAW_URL' ? <span className="muted">URL stored encrypted</span> : `${s.host}:${s.rtspPort}`}</td>
              <td className="small">
                {s.kind === 'RAW_URL' ? (s.rawUrlSet ? 'URL set' : '—') : `${s.username ?? '—'} · password ${s.passwordSet ? 'set' : 'not set'}`}
              </td>
              <td className="right">
                {can('config.write') && (
                  <button className="btn btn-sm" onClick={() => setEditing(s)}>
                    Edit
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <SourceForm orgId={orgId} siteId={siteId} source={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function SourceForm({ orgId, siteId, source, onClose }: { orgId: string; siteId: string; source: Source | null; onClose(): void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Source['kind']>(source?.kind ?? 'NVR');
  const [form, setForm] = useState({
    name: source?.name ?? '',
    vendor: source?.vendor ?? 'dahua',
    host: source?.host ?? '',
    rtspPort: source?.rtspPort ?? 554,
    username: source?.username ?? '',
    password: '',
    url: '',
  });
  const [error, setError] = useState<string | null>(null);
  const base = `/orgs/${orgId}/sites/${siteId}/sources`;
  const save = useMutation({
    mutationFn: () => {
      if (kind === 'RAW_URL') {
        const body = { name: form.name, ...(form.url ? { url: form.url } : {}) };
        return source ? patch(`${base}/${source.id}`, body) : post(base, { kind, ...body });
      }
      const body = {
        name: form.name,
        vendor: form.vendor,
        host: form.host,
        rtspPort: Number(form.rtspPort),
        username: form.username || (source ? null : undefined),
        // write-only: only sent when typed
        ...(form.password ? { password: form.password } : {}),
      };
      return source ? patch(`${base}/${source.id}`, body) : post(base, { kind, ...body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.sources(orgId, siteId) });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal title={source ? `Edit ${source.name}` : 'Add source'} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <label>
          Name
          <input required value={form.name} onChange={set('name')} placeholder="Home NVR" />
        </label>
        <label>
          Kind
          <select value={kind} disabled={!!source} onChange={(e) => setKind(e.target.value as Source['kind'])}>
            <option value="NVR">NVR (channels)</option>
            <option value="CAMERA">IP camera</option>
            <option value="RAW_URL">Raw RTSP URL</option>
          </select>
        </label>
        {kind === 'RAW_URL' ? (
          <label style={{ gridColumn: '1 / -1' }}>
            RTSP URL {source && <span className="muted small">(leave empty to keep the stored one)</span>}
            <input type="password" required={!source} value={form.url} onChange={set('url')} placeholder="rtsp://user:pass@10.0.0.5:554/stream1" autoComplete="off" />
          </label>
        ) : (
          <>
            <label>
              Vendor
              <select value={form.vendor} onChange={set('vendor')}>
                <option value="dahua">Dahua / CP Plus / Amcrest (and rebrands)</option>
                <option value="hikvision">Hikvision</option>
                <option value="generic">Other (enter stream URLs per camera)</option>
              </select>
            </label>
            <label>
              Host / IP
              <input required value={form.host} onChange={set('host')} placeholder="192.168.1.17" />
            </label>
            <label>
              RTSP port
              <input type="number" min={1} max={65535} value={form.rtspPort} onChange={set('rtspPort')} />
            </label>
            <label>
              Username
              <input value={form.username} onChange={set('username')} autoComplete="off" />
            </label>
            <label>
              Password {source?.passwordSet && <span className="muted small">(set; type to replace)</span>}
              <input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
            </label>
          </>
        )}
        <div className="form-actions">
          <ErrorText error={error} />
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

// ---------------------------------------------------------------- edges

function EdgesSection({ orgId, siteId, siteName }: { orgId: string; siteId: string; siteName: string }) {
  const { can } = useOrgCtx();
  const qc = useQueryClient();
  const edges = useEdges(orgId, siteId);
  const [name, setName] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/orgs/${orgId}/sites/${siteId}/edges`;
  const refresh = () => qc.invalidateQueries({ queryKey: keys.edges(orgId, siteId) });
  const create = useMutation({
    mutationFn: () => post<{ token: string }>(base, { name }),
    onSuccess: (r) => {
      setToken(r.token);
      setName('');
      void refresh();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const revoke = useMutation({ mutationFn: (id: string) => post(`${base}/${id}/revoke`), onSuccess: refresh });
  return (
    <section className="card">
      <div className="section-head">
        <h2>Edges</h2>
      </div>
      <p className="muted small">The box at this site that runs go2rtc + vision. It only needs the server URL, the site ID and its token.</p>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Last seen</th>
            <th>Version</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(edges.data ?? []).map((e) => (
            <tr key={e.id}>
              <td>{e.name}</td>
              <td>{e.status === 'ACTIVE' ? <span className="badge badge-ok">Active</span> : <span className="badge">Revoked</span>}</td>
              <td className="small">{e.lastSeenAt ? timeAgo(e.lastSeenAt) : 'never'}</td>
              <td className="small">{e.version ?? '—'}</td>
              <td className="right">
                {e.status === 'ACTIVE' && can('config.write') && (
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => {
                      if (confirm(`Revoke ${e.name}? It stops receiving config and its events are rejected.`)) revoke.mutate(e.id);
                    }}
                  >
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {can('config.write') && (
        <form
          className="form-row"
          style={{ marginTop: '1rem' }}
          aria-label="Register edge"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          <label className="grow">
            Register a new edge
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder={`${siteName} box`} />
          </label>
          <button className="btn" disabled={create.isPending}>
            Register
          </button>
          <ErrorText error={error} />
        </form>
      )}
      {token && (
        <Modal title="Edge token (shown once)" onClose={() => setToken(null)}>
          <p>
            Copy this into the edge's <code>.env</code> now. It cannot be shown again; if it's lost, revoke the edge and register a new one.
          </p>
          <pre className="codeblock">{`EDGE_SITE_ID=${siteId}\nEDGE_TOKEN=${token}\n# EDGE_SERVER_URL=https://<this server>`}</pre>
          <button className="btn btn-primary" onClick={() => void navigator.clipboard?.writeText(`EDGE_SITE_ID=${siteId}\nEDGE_TOKEN=${token}\n`)}>
            Copy
          </button>
        </Modal>
      )}
    </section>
  );
}

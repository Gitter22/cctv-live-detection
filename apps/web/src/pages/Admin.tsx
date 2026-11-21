import { CreateOrgBody } from '@cctv/shared';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import { errorMessage, get, post } from '../api/client';
import { keys, useOrgs } from '../api/hooks';
import type { Edge, Site } from '../api/types';
import { useAuth } from '../auth/auth';
import { ErrorText, timeAgo } from '../components/ui';

/** Platform admin: all organizations, site/edge health, create organizations. */
export function AdminPage() {
  const { me } = useAuth();
  const orgs = useOrgs();
  const [creating, setCreating] = useState(false);
  if (me?.user.platformRole !== 'SUPER_ADMIN') return <Navigate to="/" replace />;

  return (
    <div className="content">
      <div className="page">
        <header className="page-head">
          <div>
            <Link to="/" className="muted small">
              ← Back
            </Link>
            <h1>Platform admin</h1>
            <p className="muted small">Configuration and health of every organization. Footage needs a support grant from the owner.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : 'New organization'}
          </button>
        </header>
        {creating && <CreateOrg onDone={() => setCreating(false)} />}
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Organization</th>
                <th>Sites and edges</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(orgs.data ?? []).map((o) => (
                <tr key={o.id}>
                  <td>
                    <strong>{o.name}</strong>
                    <div className="muted small">{o.slug}</div>
                  </td>
                  <td>
                    <OrgHealth orgId={o.id} />
                  </td>
                  <td className="right">
                    <Link className="btn btn-sm" to={`/o/${o.id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function OrgHealth({ orgId }: { orgId: string }) {
  const sites = useQueries({
    queries: [{ queryKey: keys.sites(orgId), queryFn: () => get<{ sites: Site[] }>(`/orgs/${orgId}/sites`).then((r) => r.sites) }],
  })[0];
  const edgeQueries = useQueries({
    queries: (sites?.data ?? []).map((s) => ({
      queryKey: keys.edges(orgId, s.id),
      queryFn: () => get<{ edges: Edge[] }>(`/orgs/${orgId}/sites/${s.id}/edges`).then((r) => r.edges),
      refetchInterval: 30_000,
    })),
  });
  if (!sites?.data?.length) return <span className="muted small">No sites</span>;
  return (
    <ul className="plain">
      {sites.data.map((s, i) => {
        const edge = edgeQueries[i]?.data?.find((e) => e.status === 'ACTIVE');
        const fresh = edge?.lastSeenAt && Date.now() - Date.parse(edge.lastSeenAt) < 90_000;
        return (
          <li key={s.id}>
            <span className={`dot ${fresh ? 'dot-ok' : 'dot-off'}`} /> {s.name}{' '}
            <span className="muted small">
              · {s._count?.cameras ?? 0} cameras · edge {edge?.lastSeenAt ? `seen ${timeAgo(edge.lastSeenAt)}` : 'not registered/never seen'}
              {edge?.health?.vision ? ` · vision ${edge.health.vision.online ? 'up' : 'down'}` : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function CreateOrg({ onDone }: { onDone(): void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', slug: '', ownerEmail: '', ownerName: '', ownerPassword: '' });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      post('/orgs', CreateOrgBody.parse({
        name: form.name,
        slug: form.slug,
        owner: { email: form.ownerEmail, name: form.ownerName || undefined, password: form.ownerPassword || undefined },
      })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.orgs });
      onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate();
  };
  return (
    <form className="card form-grid" onSubmit={submit} aria-label="New organization">
      <label>
        Name
        <input required value={form.name} onChange={set('name')} placeholder="Acme Factory" />
      </label>
      <label>
        Slug
        <input required value={form.slug} onChange={set('slug')} placeholder="acme" pattern="[a-z0-9]+(-[a-z0-9]+)*" />
      </label>
      <label>
        Owner email
        <input required type="email" value={form.ownerEmail} onChange={set('ownerEmail')} />
      </label>
      <label>
        Owner name
        <input value={form.ownerName} onChange={set('ownerName')} />
      </label>
      <label>
        Owner password <span className="muted small">(new users only, min 10)</span>
        <input type="password" autoComplete="new-password" value={form.ownerPassword} onChange={set('ownerPassword')} minLength={10} />
      </label>
      <div className="form-actions">
        <ErrorText error={error} />
        <button className="btn btn-primary" disabled={create.isPending}>
          Create
        </button>
      </div>
    </form>
  );
}

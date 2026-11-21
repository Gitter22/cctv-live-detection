import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { del, errorMessage, get, patch, post } from '../api/client';
import { keys, useMembers } from '../api/hooks';
import type { AuditEntry, Member, OrgRole, SupportGrant } from '../api/types';
import { useAuth } from '../auth/auth';
import { useOrgCtx } from '../components/Layout';
import { ErrorText, formatTime } from '../components/ui';
import { PeopleTab } from './People';
import { SitesTab } from './Sites';

type Tab = 'sites' | 'members' | 'people' | 'support' | 'audit';

export function SettingsPage() {
  const { can, org } = useOrgCtx();
  const [params, setParams] = useSearchParams();
  const isOwnerish = can('org.owner') || !!org?.access.platformAdmin;
  const tabs: [Tab, string, boolean][] = [
    ['sites', 'Sites, sources & edges', can('config.read')],
    ['members', 'Members', can('members.manage')],
    ['people', 'People (faces)', can('footage.read')],
    ['support', 'Support access', isOwnerish],
    ['audit', 'Audit log', isOwnerish],
  ];
  const visible = tabs.filter((t) => t[2]);
  const tab = (visible.find((t) => t[0] === params.get('tab'))?.[0] ?? visible[0]?.[0]) as Tab | undefined;
  return (
    <div className="page">
      <h1>Settings</h1>
      <div className="tabs" role="tablist">
        {visible.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'tab-active' : ''}`} onClick={() => setParams({ tab: id })}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'sites' && <SitesTab />}
      {tab === 'members' && <MembersTab />}
      {tab === 'people' && <PeopleTab />}
      {tab === 'support' && <SupportTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}

// ---------------------------------------------------------------- members

const ROLES: OrgRole[] = ['VIEWER', 'ADMIN', 'OWNER'];

function MembersTab() {
  const { orgId, sites } = useOrgCtx();
  const { me } = useAuth();
  const qc = useQueryClient();
  const members = useMembers(orgId);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: keys.members(orgId) });
  const update = useMutation({
    mutationFn: (v: { id: string; body: object }) => patch(`/orgs/${orgId}/members/${v.id}`, v.body),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/orgs/${orgId}/members/${id}`),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="page">
      <AddMember onAdded={refresh} />
      <ErrorText error={error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Sites</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(members.data ?? []).map((m: Member) => (
              <tr key={m.id}>
                <td>
                  <strong>{m.user.name}</strong>
                  <div className="muted small">{m.user.email}</div>
                </td>
                <td>
                  <select
                    aria-label={`Role of ${m.user.email}`}
                    value={m.role}
                    onChange={(e) => {
                      setError(null);
                      update.mutate({ id: m.id, body: { role: e.target.value } });
                    }}
                  >
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td className="small">{m.siteIds.length ? m.siteIds.map(siteName).join(', ') : <span className="muted">All sites</span>}</td>
                <td className="right">
                  {m.user.id !== me?.user.id && (
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => {
                        if (confirm(`Remove ${m.user.email} from this organization?`)) remove.mutate(m.id);
                      }}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddMember({ onAdded }: { onAdded(): void }) {
  const { orgId, sites } = useOrgCtx();
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'VIEWER' as OrgRole, siteIds: [] as string[] });
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => post(`/orgs/${orgId}/members`, { ...form, name: form.name || undefined, password: form.password || undefined }),
    onSuccess: () => {
      setForm({ email: '', name: '', password: '', role: 'VIEWER', siteIds: [] });
      onAdded();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    add.mutate();
  };
  return (
    <form className="card form-grid" onSubmit={submit} aria-label="Add member">
      <label>
        Email
        <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </label>
      <label>
        Name
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label>
        Password <span className="muted small">(new users only, min 10)</span>
        <input type="password" autoComplete="new-password" minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </label>
      <label>
        Role
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as OrgRole })}>
          {ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      {sites.length > 1 && (
        <fieldset className="checks">
          <legend className="small">Limit to sites (none = all)</legend>
          {sites.map((s) => (
            <label key={s.id} className="check">
              <input
                type="checkbox"
                checked={form.siteIds.includes(s.id)}
                onChange={(e) => setForm({ ...form, siteIds: e.target.checked ? [...form.siteIds, s.id] : form.siteIds.filter((x) => x !== s.id) })}
              />
              {s.name}
            </label>
          ))}
        </fieldset>
      )}
      <div className="form-actions">
        <ErrorText error={error} />
        <button className="btn btn-primary" disabled={add.isPending}>
          Add member
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- support access

function SupportTab() {
  const { orgId, can } = useOrgCtx();
  const qc = useQueryClient();
  const grants = useQuery({ queryKey: ['grants', orgId], queryFn: () => get<{ grants: SupportGrant[] }>(`/orgs/${orgId}/support-grants`).then((r) => r.grants) });
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState(24);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['grants', orgId] });
  const grant = useMutation({
    mutationFn: () => post(`/orgs/${orgId}/support-grants`, { reason, hours }),
    onSuccess: () => {
      setReason('');
      void refresh();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const revoke = useMutation({ mutationFn: (id: string) => post(`/orgs/${orgId}/support-grants/${id}/revoke`), onSuccess: refresh });
  return (
    <div className="page">
      <p className="muted">
        The platform admin manages configuration but cannot see your footage or events. Grant temporary access for support; every view is logged in the audit log.
      </p>
      {can('org.owner') && (
        <form
          className="card form-row"
          aria-label="Grant support access"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            grant.mutate();
          }}
        >
          <label className="grow">
            Reason
            <input required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Help debugging missing alerts" />
          </label>
          <label>
            Hours
            <input type="number" min={1} max={168} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
          </label>
          <button className="btn btn-primary" disabled={grant.isPending}>
            Grant access
          </button>
        </form>
      )}
      <ErrorText error={error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Reason</th>
              <th>Granted</th>
              <th>Expires</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(grants.data ?? []).map((g) => (
              <tr key={g.id}>
                <td>{g.reason}</td>
                <td className="small">{formatTime(g.createdAt)}</td>
                <td className="small">{formatTime(g.expiresAt)}</td>
                <td>{g.active ? <span className="badge badge-warning">Active</span> : <span className="badge">{g.revokedAt ? 'Revoked' : 'Expired'}</span>}</td>
                <td className="right">
                  {g.active && can('org.owner') && (
                    <button className="btn btn-sm btn-danger" onClick={() => revoke.mutate(g.id)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {grants.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No support access granted yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- audit log

function AuditTab() {
  const { orgId } = useOrgCtx();
  const [action, setAction] = useState('');
  const log = useQuery({
    queryKey: ['audit', orgId, action],
    queryFn: () => get<{ entries: AuditEntry[] }>(`/orgs/${orgId}/audit`, { action, limit: 200 }).then((r) => r.entries),
  });
  return (
    <div className="page">
      <label className="inline">
        Filter
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          <option value="support">Support access</option>
          <option value="camera">Cameras</option>
          <option value="source">Sources</option>
          <option value="rule">Rules</option>
          <option value="member">Members</option>
          <option value="edge">Edges</option>
        </select>
      </label>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {(log.data ?? []).map((e) => (
              <tr key={e.id}>
                <td className="small nowrap">{formatTime(e.at)}</td>
                <td className="small">{e.actor ? `${e.actor.name} (${e.actor.email})` : 'system'}</td>
                <td>
                  <code>{e.action}</code>
                </td>
                <td className="small muted">{e.targetType ? `${e.targetType}: ${e.targetId ?? ''}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

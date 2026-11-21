import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useNavigate, useParams } from 'react-router';
import { useOrg, useOrgStream, useOrgs, useSites } from '../api/hooks';
import type { Capability, OrgDetail, Site } from '../api/types';
import { useAuth } from '../auth/auth';

interface OrgCtx {
  orgId: string;
  org: OrgDetail | undefined;
  sites: Site[];
  site: Site | undefined;
  setSiteId(id: string): void;
  can(cap: Capability): boolean;
  streamConnected: boolean;
}

const Ctx = createContext<OrgCtx | null>(null);

export function useOrgCtx(): OrgCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOrgCtx outside OrgLayout');
  return v;
}

/** "/" -> first org the user can see (or the admin area for a platform admin without orgs). */
export function OrgIndexRedirect() {
  const { data: orgs, isLoading } = useOrgs();
  const { me } = useAuth();
  if (isLoading) return <div className="center muted">Loading…</div>;
  if (orgs?.[0]) return <Navigate to={`/o/${orgs[0].id}`} replace />;
  if (me?.user.platformRole === 'SUPER_ADMIN') return <Navigate to="/admin" replace />;
  return <div className="center muted">You are not a member of any organization yet.</div>;
}

const SITE_KEY = (orgId: string) => `cctv.site.${orgId}`;

export function OrgLayout() {
  const { orgId = '' } = useParams();
  const org = useOrg(orgId);
  const sites = useSites(orgId);
  const [siteId, setSiteIdState] = useState<string>(() => localStorage.getItem(SITE_KEY(orgId)) ?? '');
  const caps = new Set(org.data?.access.capabilities ?? []);
  const stream = useOrgStream(orgId, caps.has('footage.read'));

  const list = sites.data ?? [];
  const site = list.find((s) => s.id === siteId) ?? list[0];
  useEffect(() => {
    setSiteIdState(localStorage.getItem(SITE_KEY(orgId)) ?? '');
  }, [orgId]);
  const setSiteId = (id: string) => {
    localStorage.setItem(SITE_KEY(orgId), id);
    setSiteIdState(id);
  };

  if (org.isError) return <div className="center muted">Organization not found.</div>;

  const value: OrgCtx = {
    orgId,
    org: org.data,
    sites: list,
    site,
    setSiteId,
    can: (c) => caps.has(c),
    streamConnected: stream.connected,
  };
  return (
    <Ctx.Provider value={value}>
      <Shell lastAlertTitle={stream.lastAlert?.title}>
        <Outlet />
      </Shell>
    </Ctx.Provider>
  );
}

function Shell({ children, lastAlertTitle }: { children: ReactNode; lastAlertTitle?: string }) {
  const { orgId, org, sites, site, setSiteId, can, streamConnected } = useOrgCtx();
  const { me, logout } = useAuth();
  const { data: orgs } = useOrgs();
  const navigate = useNavigate();
  const base = `/o/${orgId}`;
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to={base} className="brand">
          <img src="/favicon.svg" alt="" width={24} height={24} />
          <span>CCTV Alerts</span>
        </Link>
        <select aria-label="Organization" value={orgId} onChange={(e) => navigate(`/o/${e.target.value}`)}>
          {(orgs ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {sites.length > 1 && (
          <select aria-label="Site" value={site?.id ?? ''} onChange={(e) => setSiteId(e.target.value)}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <nav>
          <NavLink end to={base}>Dashboard</NavLink>
          {can('footage.read') && <NavLink to={`${base}/alerts`}>Alerts</NavLink>}
          <NavLink to={`${base}/cameras`}>Cameras</NavLink>
          <NavLink to={`${base}/rules`}>Rules</NavLink>
          <NavLink to={`${base}/settings`}>Settings</NavLink>
          {me?.user.platformRole === 'SUPER_ADMIN' && <NavLink to="/admin">Platform admin</NavLink>}
        </nav>
        <div className="sidebar-foot">
          <div className="muted small">
            {me?.user.name}
            <br />
            {org?.access.role ?? (org?.access.platformAdmin ? 'Platform admin' : '')}
          </div>
          <span className={`dot ${streamConnected ? 'dot-ok' : 'dot-off'}`} title={streamConnected ? 'Live updates connected' : 'Live updates off'} />
          <button className="btn btn-sm" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        {org?.access.platformAdmin && !org.access.role && (
          <div className="banner">
            Platform admin view: configuration only
            {org.access.supportGrantActive ? ' · support access to footage is active (audited)' : ''}.
          </div>
        )}
        {lastAlertTitle && <LiveToast title={lastAlertTitle} onOpen={() => navigate(`${base}/alerts`)} />}
        {children}
      </main>
    </div>
  );
}

function LiveToast({ title, onOpen }: { title: string; onOpen(): void }) {
  const [shown, setShown] = useState(title);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setShown(title);
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(t);
  }, [title]);
  if (!visible) return null;
  return (
    <button className="toast" onClick={onOpen} role="status">
      New alert: {shown}
    </button>
  );
}

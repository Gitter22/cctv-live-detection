import { Link } from 'react-router';
import { useAlerts, useCameras, useEdges } from '../api/hooks';
import type { Camera } from '../api/types';
import { useOrgCtx } from '../components/Layout';
import { StatusBadge, timeAgo, useTicker } from '../components/ui';

export function DashboardPage() {
  const { orgId, site, can } = useOrgCtx();
  const cameras = useCameras(orgId, site?.id);
  const edges = useEdges(orgId, site?.id);
  const open = useAlerts(orgId, { siteId: site?.id, status: 'OPEN' }, can('footage.read') && !!site);
  const tick = useTicker(60_000); // refresh thumbnails every minute

  if (!site) return <p className="muted">No sites yet. Add one under Settings.</p>;
  const edge = edges.data?.find((e) => e.status === 'ACTIVE');
  const online = (cameras.data ?? []).filter((c) => c.status?.online).length;

  return (
    <div className="page">
      <header className="page-head">
        <h1>{site.name}</h1>
        <div className="stats">
          <Stat label="Cameras online" value={`${online}/${cameras.data?.length ?? 0}`} />
          {can('footage.read') && (
            <Link to={`/o/${orgId}/alerts`} className="stat-link">
              <Stat label="Open alerts" value={String(open.data?.alerts.length ?? '–')} tone={open.data?.alerts.length ? 'danger' : undefined} />
            </Link>
          )}
          <Stat
            label="Edge"
            value={edge?.lastSeenAt ? `seen ${timeAgo(edge.lastSeenAt)}` : 'never seen'}
            tone={edge?.lastSeenAt && Date.now() - Date.parse(edge.lastSeenAt) < 90_000 ? 'ok' : 'danger'}
          />
        </div>
      </header>
      <div className="grid-cameras">
        {(cameras.data ?? []).map((c) => (
          <CameraTile key={c.id} camera={c} orgId={orgId} siteId={site.id} showThumb={can('footage.read')} tick={tick} />
        ))}
      </div>
      {cameras.data?.length === 0 && <p className="muted">No cameras at this site yet.</p>}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'danger' }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function CameraTile({ camera, orgId, siteId, showThumb, tick }: { camera: Camera; orgId: string; siteId: string; showThumb: boolean; tick: number }) {
  return (
    <Link to={`/o/${orgId}/cameras/${camera.id}`} className="card camera-tile">
      <div className="thumb">
        {showThumb ? (
          <img src={`/api/orgs/${orgId}/sites/${siteId}/cameras/${camera.id}/thumbnail?t=${tick}`} alt={`${camera.label} still`} loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
        ) : (
          <span className="muted small">No footage access</span>
        )}
      </div>
      <div className="tile-foot">
        <div>
          <div className="tile-title">{camera.label}</div>
          <div className="muted small">
            {camera.key}
            {camera.tags.length ? ` · ${camera.tags.join(', ')}` : ''}
          </div>
        </div>
        <StatusBadge status={camera.status} enabled={camera.enabled} />
      </div>
    </Link>
  );
}

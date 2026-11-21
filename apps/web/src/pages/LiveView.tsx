import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage, get } from '../api/client';
import type { Camera } from '../api/types';
import { useOrgCtx } from '../components/Layout';

/**
 * Live view (LAN phase): the server checks footage permission and returns the site's go2rtc
 * player URLs; the browser then plays straight from the site (WebRTC, falling back to MSE/HLS).
 * Only works where the browser can reach the edge (same LAN or Tailscale). Phase F adds
 * signalling through the server for anywhere access.
 */
export function LiveView({ orgId, camera, autoplay = false }: { orgId: string; camera: Camera; autoplay?: boolean }) {
  const { site } = useOrgCtx();
  const [on, setOn] = useState(autoplay);
  const [hd, setHd] = useState(false);
  const live = useQuery({
    queryKey: ['live', orgId, camera.id],
    queryFn: () => get<{ sd: string; hd: string }>(`/orgs/${orgId}/sites/${site!.id}/cameras/${camera.id}/live`),
    enabled: on && !!site,
    retry: false,
    staleTime: 0,
  });
  return (
    <section className="card live">
      <div className="section-head">
        <h2>Live</h2>
        <div className="toolbar">
          {on && (
            <button className="btn btn-sm" onClick={() => setHd((v) => !v)} aria-pressed={hd}>
              {hd ? 'HD' : 'SD'}
            </button>
          )}
          <button className={`btn btn-sm ${on ? '' : 'btn-primary'}`} onClick={() => setOn((v) => !v)}>
            {on ? 'Stop' : 'Watch live'}
          </button>
        </div>
      </div>
      {on && (
        <div className="player">
          {live.isLoading && <span className="muted small">Connecting…</span>}
          {live.isError && <span className="error small">{errorMessage(live.error)}</span>}
          {live.data && <iframe title={`${camera.label} live`} src={hd ? live.data.hd : live.data.sd} allow="autoplay; fullscreen" />}
        </div>
      )}
    </section>
  );
}

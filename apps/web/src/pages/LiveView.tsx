import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { errorMessage, get, post } from '../api/client';
import type { Camera } from '../api/types';
import { useOrgCtx } from '../components/Layout';

interface LiveInfo {
  webrtc: { available: boolean; iceServers: RTCIceServer[] };
  sd: string | null;
  hd: string | null;
}

/** Can this browser decode H.265 over WebRTC? Otherwise we ask the edge for its H.264 copy. */
function supportsH265() {
  try {
    return !!RTCRtpReceiver.getCapabilities?.('video')?.codecs.some((c) => /h265|hevc/i.test(c.mimeType));
  } catch {
    return false;
  }
}

/** Wait until ICE gathering finishes (non-trickle), at most `ms`. */
function gathered(pc: RTCPeerConnection, ms = 2500) {
  return new Promise<void>((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const t = setTimeout(resolve, ms);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

/**
 * Live view. Default: WebRTC negotiated THROUGH the server (permission-checked, works from
 * anywhere the site is reachable via ICE/TURN); the video itself flows directly from the
 * site's go2rtc. Fallback: the site's own player on the LAN.
 */
export function LiveView({ orgId, camera, autoplay = false }: { orgId: string; camera: Camera; autoplay?: boolean }) {
  const { site } = useOrgCtx();
  const [on, setOn] = useState(autoplay);
  const [hd, setHd] = useState(false);
  const [mode, setMode] = useState<'webrtc' | 'lan'>('webrtc');
  const info = useQuery({
    queryKey: ['live', orgId, camera.id],
    queryFn: () => get<LiveInfo>(`/orgs/${orgId}/sites/${site!.id}/cameras/${camera.id}/live`),
    enabled: on && !!site,
    retry: false,
    staleTime: 0,
  });
  const lanUrl = hd ? info.data?.hd : info.data?.sd;
  const useWebrtc = mode === 'webrtc' && info.data?.webrtc.available;
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
          {on && lanUrl && (
            <button className="btn btn-sm" onClick={() => setMode((m) => (m === 'webrtc' ? 'lan' : 'webrtc'))}>
              {mode === 'webrtc' ? 'Use LAN player' : 'Use WebRTC'}
            </button>
          )}
          <button className={`btn btn-sm ${on ? '' : 'btn-primary'}`} onClick={() => setOn((v) => !v)}>
            {on ? 'Stop' : 'Watch live'}
          </button>
        </div>
      </div>
      {on && (
        <div className="player">
          {info.isLoading && <span className="muted small">Connecting…</span>}
          {info.isError && <span className="error small">{errorMessage(info.error)}</span>}
          {info.data && useWebrtc && (
            <WebRtcPlayer key={`${hd}`} orgId={orgId} siteId={site!.id} camera={camera} hd={hd} iceServers={info.data.webrtc.iceServers} />
          )}
          {info.data && !useWebrtc && lanUrl && <iframe title={`${camera.label} live`} src={lanUrl} allow="autoplay; fullscreen" />}
          {info.data && !useWebrtc && !lanUrl && <span className="muted small">The site is offline.</span>}
        </div>
      )}
    </section>
  );
}

function WebRtcPlayer({ orgId, siteId, camera, hd, iceServers }: { orgId: string; siteId: string; camera: Camera; hd: boolean; iceServers: RTCIceServer[] }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState('connecting');
  useEffect(() => {
    let closed = false;
    const pc = new RTCPeerConnection({ iceServers });
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.ontrack = (e) => {
      if (video.current) video.current.srcObject = e.streams[0] ?? new MediaStream([e.track]);
    };
    pc.onconnectionstatechange = () => !closed && setState(pc.connectionState);
    (async () => {
      try {
        await pc.setLocalDescription(await pc.createOffer());
        await gathered(pc);
        const variant = hd ? 'hd' : supportsH265() ? 'sd' : 'sd_h264';
        const { sdp } = await post<{ sdp: string }>(`/orgs/${orgId}/sites/${siteId}/cameras/${camera.id}/webrtc`, { sdp: pc.localDescription!.sdp, variant });
        if (!closed) await pc.setRemoteDescription({ type: 'answer', sdp });
      } catch (err) {
        if (!closed) setState(`failed: ${errorMessage(err)}`);
      }
    })();
    return () => {
      closed = true;
      pc.close();
    };
  }, [orgId, siteId, camera.id, hd, iceServers]);
  return (
    <>
      <video ref={video} autoPlay playsInline muted controls aria-label={`${camera.label} live video`} />
      {state !== 'connected' && <span className="player-state small">{state}</span>}
    </>
  );
}

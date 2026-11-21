import { useEffect, useRef, useState } from 'react';

/**
 * /embed/live?org=&site=&cam=&hd=1 : bare live player for the mobile app's WebView.
 * The app injects the session token as window.__CCTV_TOKEN before the page loads (never in the
 * URL). Same flow as the web player: permission-checked WebRTC negotiated through the server,
 * video directly from the site.
 */
declare global {
  interface Window {
    __CCTV_TOKEN?: string;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${window.__CCTV_TOKEN ?? ''}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
  return data as T;
}

export function LiveEmbed() {
  const p = new URLSearchParams(location.search);
  const [org, site, cam, hd] = [p.get('org'), p.get('site'), p.get('cam'), p.get('hd') === '1'];
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState('connecting…');

  useEffect(() => {
    if (!org || !site || !cam) return setState('missing camera');
    let closed = false;
    let pc: RTCPeerConnection | null = null;
    (async () => {
      try {
        const live = await call<{ webrtc: { available: boolean; iceServers: RTCIceServer[] } }>('GET', `/orgs/${org}/sites/${site}/cameras/${cam}/live`);
        if (!live.webrtc.available) throw new Error('The site is offline');
        pc = new RTCPeerConnection({ iceServers: live.webrtc.iceServers });
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.ontrack = (e) => {
          if (video.current) video.current.srcObject = e.streams[0] ?? new MediaStream([e.track]);
        };
        pc.onconnectionstatechange = () => !closed && setState(pc!.connectionState === 'connected' ? '' : pc!.connectionState);
        await pc.setLocalDescription(await pc.createOffer());
        await new Promise<void>((r) => {
          if (pc!.iceGatheringState === 'complete') return r();
          setTimeout(r, 2500);
          pc!.addEventListener('icegatheringstatechange', () => pc!.iceGatheringState === 'complete' && r());
        });
        const h265 = !!RTCRtpReceiver.getCapabilities?.('video')?.codecs.some((c) => /h265|hevc/i.test(c.mimeType));
        const { sdp } = await call<{ sdp: string }>('POST', `/orgs/${org}/sites/${site}/cameras/${cam}/webrtc`, {
          sdp: pc.localDescription!.sdp,
          variant: hd ? 'hd' : h265 ? 'sd' : 'sd_h264',
        });
        if (!closed) await pc.setRemoteDescription({ type: 'answer', sdp });
      } catch (e) {
        if (!closed) setState((e as Error).message);
      }
    })();
    return () => {
      closed = true;
      pc?.close();
    };
  }, [org, site, cam, hd]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'grid', placeItems: 'center' }}>
      <video ref={video} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      {state && <div style={{ position: 'absolute', bottom: 12, left: 12, color: '#fff', background: 'rgb(0 0 0 / 60%)', padding: '4px 8px', borderRadius: 4, font: '14px system-ui' }}>{state}</div>}
    </div>
  );
}

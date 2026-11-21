import { z } from 'zod';

/**
 * Live-view signalling at the edge: the server relays a browser's WebRTC offer here (over the
 * control channel); we hand it to the local go2rtc and return its answer. Media then flows
 * directly between go2rtc and the viewer (or via TURN), never through the server.
 */
const OfferParams = z.object({
  src: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:_(?:main|h264))?$/, 'invalid stream name'),
  sdp: z.string().min(20).max(20_000),
});

export function webrtcOfferHandler(go2rtcApi: string, knownStreams: () => Set<string>, fetchImpl: typeof fetch = fetch) {
  return async (params: unknown) => {
    const { src, sdp } = OfferParams.parse(params);
    if (!knownStreams().has(src)) throw new Error(`Unknown stream ${src}`);
    const res = await fetchImpl(`${go2rtcApi}/api/webrtc?src=${encodeURIComponent(src)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: sdp,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`go2rtc refused the offer (HTTP ${res.status})`);
    const answer = await res.text();
    if (!answer.startsWith('v=0')) throw new Error('go2rtc returned no SDP answer');
    return { sdp: answer };
  };
}

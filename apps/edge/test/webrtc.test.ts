import { webrtcOfferHandler } from '../src/webrtc';

const OFFER = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';

describe('webrtc offer relay', () => {
  it('passes the offer to go2rtc for a known stream and returns the answer', async () => {
    const calls: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url} ${String(init?.body).slice(0, 3)}`);
      return new Response('v=0\r\nanswer', { status: 201 });
    }) as typeof fetch;
    const h = webrtcOfferHandler('http://g:1984', () => new Set(['entrance-1', 'entrance-1_h264']), f);
    await expect(h({ src: 'entrance-1_h264', sdp: OFFER })).resolves.toEqual({ sdp: 'v=0\r\nanswer' });
    expect(calls).toEqual(['POST http://g:1984/api/webrtc?src=entrance-1_h264 v=0']);
  });

  it('refuses unknown or malformed stream names', async () => {
    const h = webrtcOfferHandler('http://g', () => new Set(['entrance-1']), (async () => new Response('v=0')) as typeof fetch);
    await expect(h({ src: 'other-2', sdp: OFFER })).rejects.toThrow(/Unknown stream/);
    await expect(h({ src: '../api/exit', sdp: OFFER })).rejects.toThrow();
  });
});

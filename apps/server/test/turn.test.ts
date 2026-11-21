import { createHmac } from 'node:crypto';

describe('TURN credentials', () => {
  it('are absent without configuration and signed + time-limited with it', async () => {
    vi.resetModules();
    process.env.TURN_URLS = '';
    process.env.TURN_SECRET = '';
    expect((await import('../src/lib/turn')).turnCredentials('u1')).toBeNull();

    vi.resetModules();
    process.env.TURN_URLS = 'turn:hub.example.com:3478?transport=udp, turn:hub.example.com:3478?transport=tcp';
    process.env.TURN_SECRET = 'shh-secret';
    process.env.TURN_TTL_S = '600';
    const m = await import('../src/lib/turn');
    const now = Date.parse('2026-11-21T12:00:00Z');
    const c = m.turnCredentials('u1', now)!;
    expect(c.urls).toHaveLength(2);
    expect(c.username).toBe(`${now / 1000 + 600}:u1`);
    expect(c.credential).toBe(createHmac('sha1', 'shh-secret').update(c.username).digest('base64'));
    expect(m.iceServersFor('u1').at(-1)).toMatchObject({ username: expect.stringMatching(/:u1$/) });
    process.env.TURN_URLS = '';
    process.env.TURN_SECRET = '';
    vi.resetModules();
  });
});

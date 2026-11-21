import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Forwarder, type SpooledEvent } from '../src/forwarder';
import { Spool } from '../src/spool';

const JPEG = Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]);

async function setup(statuses: (number | 'down')[]) {
  const dir = await mkdtemp(join(tmpdir(), 'fwd-'));
  const snaps = join(dir, 'snaps');
  await mkdir(join(snaps, 'entrance-1'), { recursive: true });
  await writeFile(join(snaps, 'entrance-1', 'a.jpg'), JPEG);
  const spool = new Spool<SpooledEvent>(join(dir, 'spool'));
  await spool.init();
  const posted: SpooledEvent[] = [];
  let i = 0;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const s = statuses[Math.min(i++, statuses.length - 1)]!;
    if (s === 'down') throw new Error('ECONNREFUSED');
    posted.push(JSON.parse(String(init?.body)));
    return new Response('{}', { status: s });
  }) as typeof fetch;
  const fwd = new Forwarder({ serverUrl: 'http://s', token: 'edg_t', spool, snapshotDir: snaps, fetchImpl });
  return { fwd, spool, posted };
}

const msg = (id: string, path?: string) =>
  Buffer.from(JSON.stringify({ id, camera_id: 'entrance-1', type: 'zone.enter', snapshot: path ? { path } : null }));

describe('Forwarder', () => {
  it('uploads with the snapshot and empties the spool', async () => {
    const { fwd, spool, posted } = await setup([201]);
    await fwd.accept(msg('e1', 'entrance-1/a.jpg'));
    await fwd.drain();
    expect(posted[0]!.snapshot).toBe(JPEG.toString('base64'));
    expect(await spool.list()).toEqual([]);
  });

  it('keeps events while the server is down and delivers them in order later', async () => {
    const { fwd, spool, posted } = await setup(['down', 201, 201, 201]);
    await fwd.accept(msg('e1'));
    await fwd.accept(msg('e2'));
    await fwd.accept(msg('e3'));
    expect((await spool.list()).length).toBe(3); // first upload failed, nothing lost
    (fwd as unknown as { retryAt: number }).retryAt = 0; // skip the backoff wait
    await fwd.drain();
    expect(posted.map((p) => p.event.id)).toEqual(['e1', 'e2', 'e3']);
    expect(await spool.list()).toEqual([]);
  });

  it('drops permanently invalid events (422) but keeps them on 401', async () => {
    const rejected = await setup([422]);
    await rejected.fwd.accept(msg('bad'));
    await rejected.fwd.drain();
    expect(await rejected.spool.list()).toEqual([]);

    const unauthorised = await setup([401]);
    await unauthorised.fwd.accept(msg('keep'));
    await unauthorised.fwd.drain();
    expect((await unauthorised.spool.list()).length).toBe(1);
  });

  it('never reads files outside the snapshot dir', async () => {
    const { fwd, posted } = await setup([201]);
    await fwd.accept(msg('e1', '../../../etc/passwd'));
    await fwd.drain();
    expect(posted[0]!.snapshot).toBeUndefined();
  });

  it('caps the spool size', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cap-'));
    const spool = new Spool<number>(dir, 3);
    await spool.init();
    for (let n = 0; n < 5; n++) await spool.add(`i${n}`, n);
    const names = await spool.list();
    expect(names).toHaveLength(3);
    expect(await spool.read(names[0]!)).toBe(2);
  });
});

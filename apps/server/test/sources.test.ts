import { db } from '../src/lib/db';
import { deviceUrl } from '../src/lib/rtsp';
import { decryptSecret } from '../src/lib/secrets';
import { sourceSecretCtx } from '../src/routes/sources';
import { agentFor } from './api';
import { addMember, makeOrg, makeUser } from './factories';
import { resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const SECRET = 'p@ss#word:1/2?';

async function setup(role: 'ADMIN' | 'VIEWER' = 'ADMIN') {
  const { org, site } = await makeOrg();
  const u = await makeUser();
  await addMember(u.id, org.id, role);
  const agent = await agentFor(u.email);
  return { org, site, agent, base: `/api/orgs/${org.id}/sites/${site.id}/sources` };
}

describe('rtsp templates', () => {
  const d = { vendor: 'dahua', host: '192.168.1.17', rtspPort: 554, username: 'viewer', password: SECRET };
  it('builds Dahua URLs and percent-encodes credentials', () => {
    expect(deviceUrl(d, 3, 'sub')).toBe(
      'rtsp://viewer:p%40ss%23word%3A1%2F2%3F@192.168.1.17:554/cam/realmonitor?channel=3&subtype=1',
    );
    expect(deviceUrl(d, 3, 'main')).toContain('channel=3&subtype=0');
  });
  it('builds Hikvision URLs', () => {
    expect(deviceUrl({ ...d, vendor: 'hikvision', username: null }, 2, 'main')).toBe('rtsp://192.168.1.17:554/Streaming/Channels/201');
  });
  it('has no template for generic devices', () => {
    expect(deviceUrl({ ...d, vendor: 'generic' }, 1, 'sub')).toBeNull();
  });
});

describe('sources API', () => {
  it('stores the password encrypted and never returns it', async () => {
    const { agent, base } = await setup();
    const res = await agent.post(base).send({ kind: 'NVR', name: 'Home NVR', vendor: 'dahua', host: '192.168.1.17', username: 'viewer', password: SECRET });
    expect(res.status).toBe(201);
    const id = res.body.source.id as string;
    for (const r of [res, await agent.get(base), await agent.get(`${base}/${id}`)]) {
      const text = JSON.stringify(r.body);
      expect(text).not.toContain('p@ss');
      expect(text).not.toContain('passwordEnc');
      expect(text).toContain('"passwordSet":true');
    }
    const row = await db.source.findUniqueOrThrow({ where: { id } });
    expect(row.passwordEnc).not.toContain('p@ss');
    expect(decryptSecret(row.passwordEnc!, sourceSecretCtx(id, 'password'))).toBe(SECRET);
    const audits = await db.auditLog.findMany();
    expect(JSON.stringify(audits)).not.toContain('p@ss');
  });

  it('keeps, replaces or clears the password on update', async () => {
    const { agent, base } = await setup();
    const id = (await agent.post(base).send({ kind: 'CAMERA', name: 'Cam', vendor: 'hikvision', host: '10.0.0.5', username: 'u', password: 'one-1' })).body.source.id;
    expect((await agent.patch(`${base}/${id}`).send({ name: 'Renamed' })).body.source.passwordSet).toBe(true);
    await agent.patch(`${base}/${id}`).send({ password: 'two-2' });
    const row = await db.source.findUniqueOrThrow({ where: { id } });
    expect(decryptSecret(row.passwordEnc!, sourceSecretCtx(id, 'password'))).toBe('two-2');
    expect((await agent.patch(`${base}/${id}`).send({ password: null })).body.source.passwordSet).toBe(false);
  });

  it('raw URL sources keep the URL secret', async () => {
    const { agent, base } = await setup();
    const res = await agent.post(base).send({ kind: 'RAW_URL', name: 'Shop cam', url: 'rtsp://admin:secret@10.1.1.9/stream1' });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain('secret@');
    expect(res.body.source.rawUrlSet).toBe(true);
    expect((await agent.patch(`${base}/${res.body.source.id}`).send({ host: 'x' })).status).toBe(400);
  });

  it('validates input', async () => {
    const { agent, base } = await setup();
    expect((await agent.post(base).send({ kind: 'NVR', name: 'x', vendor: 'dahua', host: 'rtsp://1.2.3.4' })).status).toBe(400);
    expect((await agent.post(base).send({ kind: 'RAW_URL', name: 'x', url: 'http://x' })).status).toBe(400);
    expect((await agent.post(base).send({ kind: 'NVR', name: 'x', vendor: 'sony', host: '1.2.3.4' })).status).toBe(400);
  });

  it('viewers cannot write; other orgs get 404', async () => {
    const v = await setup('VIEWER');
    expect((await v.agent.post(v.base).send({ kind: 'RAW_URL', name: 'x', url: 'rtsp://a/b' })).status).toBe(403);
    const other = await setup();
    const id = (await other.agent.post(other.base).send({ kind: 'RAW_URL', name: 'x', url: 'rtsp://a/b' })).body.source.id;
    expect((await v.agent.get(`${v.base}/${id}`)).status).toBe(404);
  });
});

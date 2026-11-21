import { decryptSecret, encryptSecret, maskUrl, redactSecrets } from '../src/lib/secrets';

describe('secrets', () => {
  const ctx = 'source:123:password';

  it('round-trips and never stores plaintext', () => {
    const enc = encryptSecret('s3cr3t-P@ss', ctx);
    expect(enc).toMatch(/^v1:/);
    expect(enc).not.toContain('s3cr3t');
    expect(decryptSecret(enc, ctx)).toBe('s3cr3t-P@ss');
  });

  it('uses a fresh IV each time', () => {
    expect(encryptSecret('same', ctx)).not.toBe(encryptSecret('same', ctx));
  });

  it('detects tampering', () => {
    const [v, iv, tag, ct] = encryptSecret('value', ctx).split(':');
    const flipped = Buffer.from(ct!, 'base64');
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString('base64')].join(':'), ctx)).toThrow();
  });

  it('refuses a ciphertext moved to another row/field (context bound)', () => {
    const enc = encryptSecret('value', ctx);
    expect(() => decryptSecret(enc, 'source:999:password')).toThrow();
  });

  it('fails with a different key', async () => {
    const enc = encryptSecret('value', ctx);
    const original = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = 'f'.repeat(64);
    vi.resetModules(); // fresh module graph -> env() re-reads SECRETS_KEY
    try {
      const other = await import('../src/lib/secrets');
      expect(() => other.decryptSecret(enc, ctx)).toThrow();
    } finally {
      process.env.SECRETS_KEY = original;
      vi.resetModules();
    }
  });

  it('redacts *Enc fields to *Set booleans', () => {
    expect(redactSecrets({ id: '1', passwordEnc: 'v1:x', rawUrlEnc: null, host: 'h' })).toEqual({
      id: '1',
      passwordSet: true,
      rawUrlSet: false,
      host: 'h',
    });
  });

  it('masks credentials in URLs', () => {
    expect(maskUrl('rtsp://viewer:p%40ss@192.168.1.17:554/cam')).toBe('rtsp://viewer:***@192.168.1.17:554/cam');
  });
});

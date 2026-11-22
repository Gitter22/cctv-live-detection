import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { resetSession } from './auth';

describe('resetSession (sign-out)', () => {
  it('notifies the existing "me" observer and drops other cached data', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['me'], { id: 'u1' });
    qc.setQueryData(['alerts', 'org1'], [{ id: 'a1' }]);
    const seen: unknown[] = [];
    const obs = new QueryObserver(qc, { queryKey: ['me'], queryFn: () => ({ id: 'u1' }), staleTime: Infinity });
    const unsub = obs.subscribe((r) => seen.push(r.data));

    resetSession(qc);

    expect(seen.at(-1)).toBeNull(); // the UI's observer sees the sign-out
    expect(qc.getQueryData(['alerts', 'org1'])).toBeUndefined(); // previous user's data is gone
    unsub();
  });
});

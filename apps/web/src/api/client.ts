/**
 * Tiny fetch wrapper. Same-origin API (/api), session in an httpOnly cookie, JSON in/out.
 * Errors become ApiError with the server's { error: { code, message, details } }.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
    public details?: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export async function api<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const res = await fetch(withQuery(`/api${path}`, query), {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.message ?? res.statusText, e.code, e.details);
  }
  return data as T;
}

export const get = <T>(path: string, query?: Query) => api<T>('GET', path, undefined, query);
export const post = <T>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const patch = <T>(path: string, body: unknown) => api<T>('PATCH', path, body);
export const del = <T = void>(path: string) => api<T>('DELETE', path);

/** Human-readable message for any error (validation details flattened). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const details = Array.isArray(err.details)
      ? (err.details as { path?: unknown[]; message?: string }[])
          .map((d) => `${(d.path ?? []).join('.')}: ${d.message}`)
          .join('; ')
      : '';
    return details ? `${err.message} (${details})` : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

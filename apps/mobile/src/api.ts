import * as SecureStore from 'expo-secure-store';

/** Session kept in the device's encrypted SecureStore (Keystore on Android). */
export interface Session {
  baseUrl: string; // e.g. http://192.168.1.50:5173 (the web app's nginx) or a Tailscale/public URL
  token: string;
}

const KEY = 'cctv.session';

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}
export const saveSession = (s: Session) => SecureStore.setItemAsync(KEY, JSON.stringify(s));
export const clearSession = () => SecureStore.deleteItemAsync(KEY);

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(s: Pick<Session, 'baseUrl'> & { token?: string }, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${s.baseUrl.replace(/\/$/, '')}/api${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'X-Client': 'mobile',
      ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error?.message ?? `HTTP ${res.status}`);
  return data as T;
}

/** Image source with the session token (snapshots/thumbnails are protected). */
export const authedImage = (s: Session, path: string) => ({ uri: `${s.baseUrl.replace(/\/$/, '')}${path}`, headers: { Authorization: `Bearer ${s.token}` } });

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api, clearSession, loadSession, saveSession, type Session } from './api';

export interface Me {
  user: { id: string; name: string; email: string };
  memberships: { organization: { id: string; name: string }; role: string }[];
}

interface AuthState {
  ready: boolean;
  session: Session | null;
  me: Me | null;
  login(baseUrl: string, email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    (async () => {
      const s = await loadSession();
      if (s) {
        try {
          setMe(await api<Me>(s, 'GET', '/auth/me'));
          setSession(s);
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) await clearSession(); // expired
          else setSession(s); // offline: keep the session, retry later
        }
      }
      setReady(true);
    })();
  }, []);

  const login = useCallback(async (baseUrl: string, email: string, password: string) => {
    const r = await api<{ token: string }>({ baseUrl }, 'POST', '/auth/login', { email, password });
    const s = { baseUrl, token: r.token };
    setMe(await api<Me>(s, 'GET', '/auth/me'));
    await saveSession(s);
    setSession(s);
  }, []);

  const logout = useCallback(async () => {
    await clearSession();
    setSession(null);
    setMe(null);
  }, []);

  return <Ctx.Provider value={{ ready, session, me, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

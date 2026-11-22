import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { ApiError, get, post } from '../api/client';
import type { Me } from '../api/types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

/**
 * After sign-out: set 'me' to null IN PLACE, then drop the previous user's cached data.
 * Don't use qc.clear(): it removes the 'me' query the AuthProvider is subscribed to, so the
 * UI would keep showing the signed-in layout.
 */
export function resetSession(qc: QueryClient) {
  qc.setQueryData(['me'], null);
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await get<Me>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });

  const loginMutation = useMutation({
    mutationFn: (v: { email: string; password: string }) => post('/auth/login', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });

  const value: AuthState = {
    me: meQuery.data ?? null,
    loading: meQuery.isLoading,
    login: async (email, password) => {
      await loginMutation.mutateAsync({ email, password });
    },
    logout: async () => {
      await post('/auth/logout');
      resetSession(qc);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

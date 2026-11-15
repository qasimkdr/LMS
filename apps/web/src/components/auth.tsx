'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { Me, Role } from '@/lib/types';

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  reload: () => Promise<Me | null>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({ me: null, loading: true, reload: async () => null, logout: async () => undefined });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const reload = useCallback(async () => {
    try {
      const data = await api.get<Me>('/auth/me');
      setMe(data);
      return data;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setMe(null);
    router.replace('/login');
  }, [router]);

  useEffect(() => {
    reload();
  }, [reload]);

  return <Ctx.Provider value={{ me, loading, reload, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

/** Where each role lands after login. */
export function homeFor(role: Role): string {
  if (role === 'SUPER_ADMIN') return '/admin';
  if (role === 'PRINCIPAL' || role === 'STAFF') return '/school';
  return '/home';
}

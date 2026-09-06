import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { api, setAccessToken } from '../../lib/api';

type Role = 'SUPER_ADMIN' | 'PRINCIPAL' | 'STAFF' | 'TEACHER' | 'STUDENT' | 'PARENT';
type SessionUser = {
  id: string;
  role: Role;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  schoolId?: string | null;
  school?: { id: string; name: string; logoUrl?: string | null; status: string } | null;
};

type AuthContextValue = {
  user: SessionUser | null;
  loading: boolean;
  login: (login: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<SessionUser | null>(() => {
    try { return JSON.parse(sessionStorage.getItem('nexora_user') ?? 'null'); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.post('/auth/refresh').then(({ data }) => {
      setAccessToken(data.accessToken);
    }).catch(() => {
      sessionStorage.removeItem('nexora_user');
      setUser(null);
    }).finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (loginValue: string, password: string) => {
    const { data } = await api.post('/auth/login', { login: loginValue, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    sessionStorage.setItem('nexora_user', JSON.stringify(data.user));
    return data.user as SessionUser;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } finally {
      setAccessToken(null);
      setUser(null);
      sessionStorage.removeItem('nexora_user');
    }
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

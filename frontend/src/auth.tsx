import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';
import type { PermissionAction, SessionUser } from './types';

type AuthContextValue = {
  user: SessionUser | null;
  loading: boolean;
  startSession: (payload: { token: string; user: SessionUser }) => void;
  logout: () => void;
  refresh: () => Promise<SessionUser>;
  can: (module: string, action?: PermissionAction | string) => boolean;
  hasModule: (key: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(!!getToken());

  const logout = useCallback(() => { setToken(''); setUser(null); }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) return;
    api.get<SessionUser>('/auth/me').then(setUser).catch(() => logout()).finally(() => setLoading(false));
  }, [logout]);

  const startSession = useCallback(({ token, user: u }: { token: string; user: SessionUser }) => {
    setToken(token);
    setUser(u);
  }, []);
  const refresh = useCallback(() => api.get<SessionUser>('/auth/me').then((u) => { setUser(u); return u; }), []);

  const can = useCallback((module: string, action: PermissionAction | string = 'view') => {
    if (!user) return false;
    if (user.is_admin) return true;
    return Array.isArray(user.permissions?.[module]) && user.permissions[module].includes(action);
  }, [user]);

  const hasModule = useCallback((key: string) => {
    if (!user) return false;
    const m = user.plan_modules;
    if (!m || typeof m !== 'object') return true;
    return m[key] !== false;
  }, [user]);

  const value = useMemo(
    () => ({ user, loading, startSession, logout, refresh, can, hasModule }),
    [user, loading, startSession, logout, refresh, can, hasModule],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

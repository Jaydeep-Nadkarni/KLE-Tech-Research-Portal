import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api.get('/auth/me').then((r) => setUser(r.data.user)).catch(() => setUser(null)).finally(() => setReady(true));
    const expired = () => setUser(null);
    window.addEventListener('auth:expired', expired);
    return () => window.removeEventListener('auth:expired', expired);
  }, []);

  const login = useCallback(async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    const me = await api.get('/auth/me');
    setUser(me.data.user || r.data.user);
  }, []);
  const logout = useCallback(async () => { await api.post('/auth/logout').catch(() => {}); setUser(null); }, []);

  const isAdmin = user?.role === 'hod' || user?.role === 'super_admin';
  const canViewAll = isAdmin || user?.role === 'viewer';
  return <AuthCtx.Provider value={{ user, ready, login, logout, isAdmin, canViewAll }}>{children}</AuthCtx.Provider>;
}

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { login as loginApi } from '../lib/api';

interface AuthContextValue {
  isAuthenticated: boolean;
  username: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('ecobel_token'));
  const [username, setUsername] = useState<string | null>(localStorage.getItem('ecobel_username'));

  const login = useCallback(async (u: string, p: string) => {
    const { access_token } = await loginApi(u, p);
    localStorage.setItem('ecobel_token', access_token);
    localStorage.setItem('ecobel_username', u);
    setToken(access_token);
    setUsername(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('ecobel_token');
    localStorage.removeItem('ecobel_username');
    setToken(null);
    setUsername(null);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated: !!token, username, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

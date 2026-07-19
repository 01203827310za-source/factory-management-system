import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authApi, type AuthUser } from '../services/api';

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  can: (permission: string) => boolean;
  isAdmin: boolean;
  isViewer: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const savedUser = localStorage.getItem('auth_user');
    if (token && savedUser) {
      setUser(JSON.parse(savedUser));
      // Verify token is still valid in background
      authApi.me()
        .then(freshUser => {
          setUser(freshUser);
          localStorage.setItem('auth_user', JSON.stringify(freshUser));
        })
        .catch(() => {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('auth_user');
          setUser(null);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = async (username: string, password: string) => {
    const { token, user: userData } = await authApi.login(username, password);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', JSON.stringify(userData));
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setUser(null);
  };

  const can = (permission: string) => user?.permissions?.includes(permission) ?? false;

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isAuthenticated: !!user,
      login,
      logout,
      can,
      isAdmin: user?.role === 'admin',
      isViewer: user?.role === 'viewer',
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

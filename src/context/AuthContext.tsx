import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserProfile, UserRole } from '../types';

interface AuthContextType {
  user: UserProfile | null;
  role: UserRole;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  login: (email: string, password?: string) => Promise<boolean>;
  register: (name: string, email: string, password?: string) => Promise<boolean>;
  logout: () => void;
  switchRole: (newRole: UserRole) => void;
}

const DEFAULT_USER: UserProfile = {
  id: 'usr-1',
  name: 'سامر أحمد',
  email: 'sameranede@gmail.com',
  role: 'USER',
  avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=160&auto=format&fit=crop&q=80',
  preferredLanguage: 'ar',
  createdAt: '2025-01-15T10:00:00Z',
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(() => {
    try {
      const saved = localStorage.getItem('movyza_user_session_v2');
      if (saved) return JSON.parse(saved);
      return DEFAULT_USER;
    } catch {
      return DEFAULT_USER;
    }
  });

  useEffect(() => {
    if (user) {
      localStorage.setItem('movyza_user_session_v2', JSON.stringify(user));
    } else {
      localStorage.removeItem('movyza_user_session_v2');
    }
  }, [user]);

  const login = async (email: string): Promise<boolean> => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const newUser: UserProfile = {
      id: `usr-${Date.now()}`,
      name: email.split('@')[0] || 'مستخدم موفيزا',
      email,
      role: email.includes('admin') ? 'ADMIN' : email.includes('owner') ? 'OWNER' : 'USER',
      avatarUrl: DEFAULT_USER.avatarUrl,
      preferredLanguage: 'ar',
      createdAt: new Date().toISOString(),
    };
    setUser(newUser);
    return true;
  };

  const register = async (name: string, email: string): Promise<boolean> => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const newUser: UserProfile = {
      id: `usr-${Date.now()}`,
      name,
      email,
      role: 'USER',
      avatarUrl: DEFAULT_USER.avatarUrl,
      preferredLanguage: 'ar',
      createdAt: new Date().toISOString(),
    };
    setUser(newUser);
    return true;
  };

  const logout = () => {
    setUser(null);
  };

  const switchRole = (newRole: UserRole) => {
    if (user) {
      setUser({ ...user, role: newRole });
    }
  };

  const role = user?.role || 'USER';
  const isAdmin = role === 'ADMIN' || role === 'OWNER';
  const isOwner = role === 'OWNER';

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        isAuthenticated: !!user,
        isAdmin,
        isOwner,
        login,
        register,
        logout,
        switchRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

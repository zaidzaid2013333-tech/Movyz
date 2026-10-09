import React, { createContext, useContext, useEffect, useState } from 'react';
import type { UserProfile, UserRole } from '../types';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  user: UserProfile | null;
  role: UserRole;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  loading: boolean;
  login: (email: string, password?: string) => Promise<boolean>;
  register: (name: string, email: string, password?: string) => Promise<boolean>;
  verifySignupCode: (email: string, token: string) => Promise<void>;
  resendSignupCode: (email: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  resetPasswordWithCode: (email: string, token: string, password: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const authRedirect = (path: string) => `${window.location.origin}${path}`;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async (session: any) => {
    if (!supabase || !session?.user) {
      setUser(null);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id,role,display_name,avatar_url,locale,created_at')
      .eq('id', session.user.id)
      .maybeSingle();

    setUser({
      id: session.user.id,
      email: session.user.email || '',
      name: profile?.display_name || session.user.user_metadata?.display_name || '',
      role: (profile?.role || 'USER') as UserRole,
      avatarUrl: profile?.avatar_url || '',
      preferredLanguage: profile?.locale || 'ar',
      createdAt: profile?.created_at || session.user.created_at,
    });
  };

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      await refresh(data.session);
      if (active) setLoading(false);
    }).catch(() => {
      if (active) setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) void refresh(session);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const requireSupabase = () => {
    if (!supabase) {
      throw new Error('خدمة الحسابات غير مهيأة حاليًا. حاول مرة أخرى لاحقًا.');
    }
    return supabase;
  };

  const login = async (email: string, password = '') => {
    const client = requireSupabase();
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) throw error;
    await refresh(data.session);
    return true;
  };

  // Returns true only when Supabase created a session immediately. When email
  // confirmation is enabled, the page must stop here and ask for verification.
  const register = async (name: string, email: string, password = '') => {
    const client = requireSupabase();
    const { data, error } = await client.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: { display_name: name.trim() },
        emailRedirectTo: authRedirect('/auth/callback'),
      },
    });
    if (error) throw error;
    if (data.session) await refresh(data.session);
    return Boolean(data.session);
  };

  const verifySignupCode = async (email: string, token: string) => {
    const client = requireSupabase();
    const { data, error } = await client.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: 'signup',
    });
    if (error) throw error;
    await refresh(data.session);
  };

  const resendSignupCode = async (email: string) => {
    const client = requireSupabase();
    const { error } = await client.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: authRedirect('/auth/callback') },
    });
    if (error) throw error;
  };

  const requestPasswordReset = async (email: string) => {
    const client = requireSupabase();
    const { error } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: authRedirect('/reset-password'),
    });
    if (error) throw error;
  };

  const resetPasswordWithCode = async (email: string, token: string, password: string) => {
    const client = requireSupabase();
    const { data, error } = await client.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: 'recovery',
    });
    if (error) throw error;
    if (!data.session) throw new Error('انتهت صلاحية الرمز أو أنه غير صحيح. اطلب رمزًا جديدًا.');

    const { error: updateError } = await client.auth.updateUser({ password });
    if (updateError) throw updateError;
    await client.auth.signOut({ scope: 'local' });
    setUser(null);
  };

  // Also supports the secure recovery link sent by Supabase. The route is only
  // shown after Supabase has consumed the callback token from the email URL.
  const updatePassword = async (password: string) => {
    const client = requireSupabase();
    const { data } = await client.auth.getSession();
    if (!data.session) {
      throw new Error('رابط الاستعادة غير صالح أو انتهت صلاحيته. اطلب رسالة جديدة.');
    }
    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;
    await client.auth.signOut({ scope: 'local' });
    setUser(null);
  };

  const logout = async () => {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
  };

  const role = user?.role || 'USER';
  return (
    <AuthContext.Provider value={{
      user, role, isAuthenticated: !!user,
      isAdmin: role === 'ADMIN' || role === 'OWNER',
      isOwner: role === 'OWNER',
      loading, login, register, verifySignupCode, resendSignupCode,
      requestPasswordReset, resetPasswordWithCode, updatePassword, logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

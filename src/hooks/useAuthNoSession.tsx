/**
 * AUTH HOOK (single source of truth for Supabase auth)
 *
 * Despite the legacy "NoSession" name, sessions ARE persisted across browser
 * restarts so mobile apps and web users stay signed in. Renaming would require
 * touching dozens of import sites; this header documents the actual behavior
 * to remove confusion. See `useAuth.tsx` for the higher-level wrapper that
 * also tracks subscription state.
 *
 * Google & Apple OAuth use Lovable Cloud managed auth (in-app, no external
 * browser).
 */

import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { lovable } from '@/integrations/lovable/index';
import { Capacitor } from '@capacitor/core';
import { signInWithOAuthNative } from '@/lib/nativeOAuth';
import { Sentry } from '@/lib/sentry';

// Re-export for backward compatibility
export const supabaseNoSession = supabase;

type ProvisioningState = 'idle' | 'pending' | 'done' | 'failed';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  initialCleanupDone: boolean;
  /** Whether OAuth org provisioning has completed for the current user */
  provisioning: ProvisioningState;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, metadata?: { full_name?: string; phone?: string }) => Promise<{ data: { user: User | null } | null; error: Error | null }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signInWithApple: () => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  checkExistingProfile: (userId: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProviderNoSession({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialCleanupDone, setInitialCleanupDone] = useState(false);
  const initRef = useRef(false);
  // Track which user the cache belongs to so we only clear on identity change.
  const cachedUserIdRef = useRef<string | null>(null);

  /**
   * Initialize auth - check for existing session (sessions now persist)
   */
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const initializeAuth = async () => {
      try {
        // getSession() already refreshes an expired token from a valid
        // refresh token — that is what supabase-js does internally on
        // recovery. There used to be a manual refreshSession() in the else
        // branch here as a belt-and-braces fallback. It was neither: with
        // autoRefreshToken:true and a second manual refresh in useAuth, the
        // same refresh token could be presented three times, and Supabase
        // treats a reused refresh token as theft and revokes the whole token
        // family. That is how one account accumulated 111 refresh tokens and
        // 29 sessions, being logged out each time a family was revoked.
        // One refresher. Do not add another.
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession) {
          setSession(currentSession);
          setUser(currentSession.user);
        }
      } catch (err) {
        console.error('Error initializing auth:', err);
      } finally {
        setInitialCleanupDone(true);
        setLoading(false);
      }
    };

    initializeAuth();
  }, []);

  // Listen for auth state changes AFTER initial cleanup.
  //
  // CRITICAL: the callback must NEVER call supabase.from(), .functions.invoke(),
  // or .auth.getSession(). Those acquire the auth lock, and this callback runs
  // INSIDE that lock (called from _notifyAllSubscribers during setSession/
  // signInWithPassword). Calling any lock-acquiring method deadlocks the app.
  // See: 2026-08-25 OAuth black-screen investigation.
  //
  // All async work (org provisioning, membership checks) goes in a separate
  // useEffect keyed on the user id, which runs AFTER the lock releases.
  useEffect(() => {
    if (!initialCleanupDone) return;

    const { data: { subscription } } = supabaseNoSession.auth.onAuthStateChange(
      (event, currentSession) => {
        // Synchronous state updates only — no awaits, no supabase calls.
        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (event === 'SIGNED_OUT') {
          setUser(null);
          setSession(null);
          cachedUserIdRef.current = null;
          queryClient.resetQueries();
        }

        if (event === 'SIGNED_IN' && currentSession?.user) {
          const newUserId = currentSession.user.id;
          if (cachedUserIdRef.current && cachedUserIdRef.current !== newUserId) {
            queryClient.resetQueries();
          }
          cachedUserIdRef.current = newUserId;
        }
      }
    );

    // Check current session (for OAuth callbacks).
    // This getSession call is OUTSIDE the lock (it's in a useEffect, not in the
    // onAuthStateChange callback), so it's safe.
    supabaseNoSession.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- queryClient is stable from QueryClientProvider; re-subscribing on initialCleanupDone is the only trigger needed
  }, [initialCleanupDone]);

  // ── OAuth provisioning effect ────────────────────────────────────────
  // Runs when a new user identity appears (user.id changes). Checks for
  // org_memberships and provisions a trial org if none exist.
  //
  // Separated from onAuthStateChange to avoid the auth lock deadlock:
  // supabase.from() calls getSession() which acquires the lock, but
  // onAuthStateChange runs INSIDE the lock. This effect runs after React
  // re-renders with the new user, which is after the lock releases.
  //
  // Exposes `provisioning` state so callers (LoginPage) can wait for it
  // before navigating, rather than racing the provision against a timer.
  const provisionedUserRef = useRef<string | null>(null);
  const [provisioning, setProvisioning] = useState<ProvisioningState>('idle');

  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      setProvisioning('idle');
      return;
    }
    // Never auto-provision a brand-new trial org while a team invite is being
    // accepted. The existing-user invite path signs in BEFORE the membership
    // row is written, so this effect used to see zero memberships, create a
    // fresh org, and drop the invitee into the onboarding wizard ("create a
    // whole new account") instead of the workspace they were invited to.
    // The existing-user path also detours through /reset-password?next=/accept-invite...
    // to create a password. That unmounts AcceptInvitePage (clearing the
    // sessionStorage flag) and signs the user in via verifyOtp while still on
    // /reset-password — so the pathname check alone used to miss it and a
    // stray empty trial org got created mid-invite.
    let invitePending = false;
    try {
      const path = window.location.pathname;
      const search = window.location.search;
      invitePending =
        path.startsWith('/accept-invite') ||
        (path.startsWith('/reset-password') && search.includes('accept-invite')) ||
        sessionStorage.getItem('tidywise_invite_pending') === 'true';
    } catch { /* storage unavailable — fall back to the pathname check above */ }

    if (invitePending) {
      setProvisioning('idle');
      return;
    }
    if (provisionedUserRef.current === userId) return;
    provisionedUserRef.current = userId;

    let cancelled = false;
    setProvisioning('pending');


    (async () => {
      try {
        const { data: memberships, error: memErr } = await supabaseNoSession
          .from('org_memberships')
          .select('organization_id')
          .eq('user_id', userId)
          .limit(1);

        if (cancelled) return;

        // Fail closed. A temporary membership lookup failure must never be
        // interpreted as "this user has no workspace" and create a business.
        if (memErr) throw memErr;

        if (!memberships || memberships.length === 0) {
          const { data, error: provErr } = await supabaseNoSession.functions.invoke('provision-trial-org');

          if (cancelled) return;

          const orgId = (data as { organization_id?: string })?.organization_id;
          if (orgId) {
            try { localStorage.setItem('tidywise_active_org', orgId); } catch { /* ignore */ }
          }

          if (provErr) {
            console.error('Trial org provisioning failed:', provErr);
            setProvisioning('failed');
            return;
          }
        }
        if (!cancelled) setProvisioning('done');
      } catch (err) {
        console.error('Trial org provisioning failed:', err);
        if (!cancelled) setProvisioning('failed');
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per user identity; supabaseNoSession is stable
  }, [user?.id]);

  // Tag Sentry events with the authenticated user so production errors
  // can be traced to a specific account. Clears on sign-out. Reacts to
  // any `user` change, so we don't need to thread setUser through every
  // sign-in / sign-out / token-refresh code path.
  useEffect(() => {
    if (user) {
      Sentry.setUser({ id: user.id, email: user.email ?? undefined });
    } else {
      Sentry.setUser(null);
    }
  }, [user]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await supabaseNoSession.auth.signInWithPassword({
        email,
        password,
      });
      return { error };
    } catch (err) {
      return { error: err as Error };
    }
  }, []);

  const signUp = useCallback(async (
    email: string, 
    password: string, 
    metadata?: { full_name?: string; phone?: string }
  ): Promise<{ data: { user: User | null } | null; error: Error | null }> => {
    try {
      const { data, error } = await supabaseNoSession.auth.signUp({
        email,
        password,
        options: {
          data: metadata,
          emailRedirectTo: `${window.location.origin}/signup`,
        },
      });
      return { data, error };
    } catch (err) {
      return { data: null, error: err as Error };
    }
  }, []);

  /**
   * Google OAuth:
   * - Native: uses Supabase + @capacitor/browser (in-app SFSafariViewController) for Guideline 4.0
   * - Web: uses Lovable Cloud managed auth
   */
  const signInWithGoogle = useCallback(async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        return await signInWithOAuthNative('google');
      }
      const result = await lovable.auth.signInWithOAuth('google', {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        return { error: result.error instanceof Error ? result.error : new Error(String(result.error)) };
      }
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  }, []);

  /**
   * Apple Sign In:
   * - Native: uses Supabase + @capacitor/browser (in-app SFSafariViewController) for Guideline 4.0
   * - Web: uses Lovable Cloud managed auth
   */
  const signInWithApple = useCallback(async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        return await signInWithOAuthNative('apple');
      }
      const result = await lovable.auth.signInWithOAuth('apple', {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        return { error: result.error instanceof Error ? result.error : new Error(String(result.error)) };
      }
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  }, []);

  /**
   * Check if a profile already exists for this user
   * Used to block Google/Apple OAuth "sign-in" attempts on signup page
   */
  const checkExistingProfile = useCallback(async (userId: string): Promise<boolean> => {
    try {
      const { data, error } = await supabaseNoSession
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();
      
      if (error) {
        console.error('Error checking profile:', error);
        return false;
      }
      
      return !!data;
    } catch (err) {
      console.error('Error checking profile:', err);
      return false;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      // scope: 'local' — end only this device's session. The SDK default
      // (scope: 'global', i.e. no scope argument) revokes EVERY active
      // session for the account everywhere, which meant clicking Logout
      // on one device silently signed the user out of their phone and
      // any other open tab/browser too (confirmed live, 2026-07-14 — see
      // tests/logout-check.spec.ts). No evidence this was intentional:
      // there's no separate "sign out everywhere" feature anywhere in the
      // app, and ForgotPasswordPage's own copy states the opposite
      // expectation ("All other active sessions on other devices stay
      // signed in unless you sign them out from settings" — a settings
      // feature that doesn't actually exist yet). If a deliberate
      // "sign out everywhere" action is ever added, give IT the global
      // scope explicitly rather than making it Logout's default.
      await supabaseNoSession.auth.signOut({ scope: "local" });
    } catch {
      // Always continue; we still want to wipe local state.
    }
    setUser(null);
    setSession(null);

    // Clear storage synchronously BEFORE redirecting — the redirect kills
    // the JS context, so anything after it is fire-and-forget at best.
    try {
      const authKeys = Object.keys(localStorage).filter(key =>
        key.startsWith('sb-') || key.includes('supabase')
      );
      authKeys.forEach(key => localStorage.removeItem(key));
      localStorage.removeItem('tw-offline-cache');
    } catch {
      // Ignore storage errors
    }

    // Hard-redirect on web IMMEDIATELY. This must come before any async
    // cleanup — if the React tree is frozen (detached observers from a
    // prior queryClient.clear), async work never completes and the user
    // is stuck. The redirect kills the entire JS context, which is the
    // only reliable way out of a frozen page.
    if (typeof window !== 'undefined' && !Capacitor.isNativePlatform()) {
      window.location.href = '/login';
      return; // Redirect kills the JS context; nothing below runs on web.
    }

    // Clear Capacitor Preferences storage (native only — web already redirected)
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const { keys } = await Preferences.keys();
      for (const key of keys) {
        if (key.startsWith('sb-') || key.includes('supabase')) {
          await Preferences.remove({ key });
        }
      }
    } catch {
      // Preferences may not be available
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      initialCleanupDone,
      provisioning,
      signIn,
      signUp,
      signInWithGoogle,
      signInWithApple,
      signOut,
      checkExistingProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthNoSession() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthNoSession must be used within an AuthProviderNoSession');
  }
  return context;
}
// supabaseNoSession is already exported above via re-export from @/lib/supabase

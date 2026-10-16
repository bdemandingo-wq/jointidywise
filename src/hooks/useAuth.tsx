/**
 * AUTH HOOK - Unified with No-Session System
 * 
 * This hook now uses the no-session auth context as its source of truth.
 * Session persistence is disabled - users must login every visit.
 */

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { User, Session } from '@supabase/supabase-js';
import { useAuthNoSession, supabaseNoSession } from './useAuthNoSession';
import { isInvalidSessionError } from '@/lib/authErrors';
import {
  clearStartupCache,
  readStartupSection,
  STARTUP_SUBSCRIPTION_STALE_MS,
  startupSubscriptionKey,
  writeStartupSection,
} from '@/lib/startupCache';

interface SubscriptionStatus {
  subscribed: boolean;
  trial_active: boolean;
  trial_end: string | null;
  subscription_end: string | null;
  payment_failed?: boolean;
  message?: string;
  product_id?: string | null;
}

/** idle: no session. loading: check in flight. ready: answer stored. error: check failed. */
export type SubscriptionCheck = 'idle' | 'loading' | 'ready' | 'error';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  subscription: SubscriptionStatus | null;
  /** Distinguishes "not loaded yet" from "check failed". A failed check must not look like full access. */
  subscriptionCheck: SubscriptionCheck;
  checkSubscription: (accessToken?: string) => Promise<void>;
  showSubscriptionDialog: boolean;
  setShowSubscriptionDialog: (show: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function fetchSubscription(userId: string, token: string): Promise<SubscriptionStatus> {
  // NOTE: The free-account allowlist is enforced server-side in the
  // `check-subscription` edge function (keyed by auth.users.id and email).
  // Do NOT add a client-side bypass here — it would be trivially spoofable.
  const { data, error } = await supabaseNoSession.functions.invoke('check-subscription', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) throw error;
  const status = data as SubscriptionStatus;
  writeStartupSection(userId, 'subscription', status);
  return status;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const noSessionAuth = useAuthNoSession();
  const queryClient = useQueryClient();
  const userId = noSessionAuth.user?.id ?? null;
  const token = noSessionAuth.session?.access_token ?? null;
  const cached = userId ? readStartupSection<SubscriptionStatus>(userId, 'subscription') : null;

  const [showSubscriptionDialog, setShowSubscriptionDialog] = useState(false);
  const signOutRef = useRef<() => Promise<void>>(async () => {});

  const subscriptionQuery = useQuery({
    queryKey: userId ? startupSubscriptionKey(userId) : ['startup-subscription', 'signed-out'],
    queryFn: () => fetchSubscription(userId as string, token as string),
    enabled: !!userId && !!token,
    staleTime: STARTUP_SUBSCRIPTION_STALE_MS,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 2,
    ...(cached ? { initialData: cached.value, initialDataUpdatedAt: cached.at } : {}),
  });

  const subscription = token ? (subscriptionQuery.data ?? cached?.value ?? null) : null;
  const subscriptionCheck: SubscriptionCheck = !token
    ? 'idle'
    : subscription
      ? 'ready'
      : subscriptionQuery.isError
        ? 'error'
        : 'loading';

  const signOut = async () => {
    const { clearSidebarHiddenItemsCache } = await import('@/hooks/useSidebarHiddenItems');
    clearSidebarHiddenItemsCache();
    try { localStorage.removeItem('tidywise_org_chosen'); } catch { /* ignore */ }
    clearStartupCache();
    await noSessionAuth.signOut();
    setShowSubscriptionDialog(false);
  };
  signOutRef.current = signOut;

  const checkSubscription = async (accessToken?: string) => {
    const uid = noSessionAuth.user?.id;
    const nextToken = accessToken ?? noSessionAuth.session?.access_token;
    if (!uid || !nextToken) return;
    await queryClient.fetchQuery({
      queryKey: startupSubscriptionKey(uid),
      queryFn: () => fetchSubscription(uid, nextToken),
      staleTime: 0,
    });
  };

  useEffect(() => {
    const data = subscriptionQuery.data;
    if (!data || !token) return;
    if (!data.subscribed) {
      const inGrace = (() => {
        try {
          return sessionStorage.getItem('tw_post_checkout') === '1';
        } catch { return false; }
      })();
      if (!inGrace) setShowSubscriptionDialog(true);
    } else {
      try { sessionStorage.removeItem('tw_post_checkout'); } catch { /* no-op */ }
    }
  }, [subscriptionQuery.data, token]);

  // Session validity is decided here, and only on proof from getUser().
  // It used to run BEFORE check-subscription and hold the auth lock for a
  // full network round trip, so the org read and the billing check waited
  // behind it. The check now starts with the session token; this confirmation
  // runs after the dashboard has had a chance to paint from cache.
  useEffect(() => {
    if (!token) return;
    const timer = window.setTimeout(async () => {
      try {
        const { data, error } = await supabaseNoSession.auth.getUser();
        if (error && isInvalidSessionError(error)) {
          const session = noSessionAuth.session;
          const expiresAt = session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : 'unknown';
          console.error('[useAuth] SIGNING OUT — getUser returned invalid session', {
            errorStatus: (error as { status?: number }).status ?? 'unknown',
            errorMessage: error.message,
            isInvalidSession: true,
            sessionExpiresAt: expiresAt,
            currentTime: new Date().toISOString(),
            tokenPrefix: session?.access_token?.substring(0, 20) ?? 'none',
          });
          await signOutRef.current();
          return;
        }
        if (error) {
          console.warn('[useAuth] could not verify session, keeping it:', error.message);
        }
        if (!error && !data?.user) {
          console.warn('[useAuth] getUser returned no user; keeping the session');
        }
      } catch (e) {
        console.warn('[useAuth] auth check threw, keeping session:', e);
      }
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [token, noSessionAuth.session]);

  return (
    <AuthContext.Provider value={{
      user: noSessionAuth.user,
      session: noSessionAuth.session,
      loading: noSessionAuth.loading || !noSessionAuth.initialCleanupDone,
      signOut,
      subscription,
      subscriptionCheck,
      checkSubscription,
      showSubscriptionDialog,
      setShowSubscriptionDialog
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

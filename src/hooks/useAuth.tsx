/**
 * AUTH HOOK - Unified with No-Session System
 * 
 * This hook now uses the no-session auth context as its source of truth.
 * Session persistence is disabled - users must login every visit.
 */

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { useAuthNoSession, supabaseNoSession } from './useAuthNoSession';
import { isInvalidSessionError } from '@/lib/authErrors';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  // Use the no-session auth as the source of truth
  const noSessionAuth = useAuthNoSession();
  
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [subscriptionCheck, setSubscriptionCheck] = useState<SubscriptionCheck>('idle');
  const [showSubscriptionDialog, setShowSubscriptionDialog] = useState(false);
  const checkGen = useRef(0);

  const signOut = async () => {
    // Purge per-user/per-org sidebar visibility cache so the next signed-in
    // user (e.g. on a shared device) never inherits stale hidden tabs.
    const { clearSidebarHiddenItemsCache } = await import('@/hooks/useSidebarHiddenItems');
    clearSidebarHiddenItemsCache();
    // Clear the deliberate org choice so the next login defaults to the
    // highest-priority org instead of inheriting a stale pick.
    try { localStorage.removeItem('tidywise_org_chosen'); } catch { /* ignore */ }
    await noSessionAuth.signOut();
    setSubscription(null);
    setSubscriptionCheck('idle');
    setShowSubscriptionDialog(false);
  };

  const checkSubscription = async (accessToken?: string) => {
    const gen = ++checkGen.current;
    try {
      const token =
        accessToken ?? noSessionAuth.session?.access_token;

      if (!token) {
        if (gen === checkGen.current) setSubscriptionCheck('idle');
        return;
      }

      setSubscriptionCheck('loading');

      // NOTE: The free-account allowlist is enforced server-side in the
      // `check-subscription` edge function (keyed by auth.users.id and email).
      // Do NOT add a client-side bypass here — it would be trivially spoofable.

      const { data, error } = await supabaseNoSession.functions.invoke("check-subscription", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (error) throw error;
      if (gen !== checkGen.current) return;

      setSubscription(data);
      setSubscriptionCheck('ready');
      // Open the subscription dialog only when:
      //   1. The user genuinely doesn't have a subscription, AND
      //   2. We are NOT in the post-checkout grace window — the
      //      /checkout/success page polls this function several times
      //      right after Stripe redirects, and the webhook can race
      //      that by a second or two. Without the guard, the paywall
      //      dialog flashes open during the polling and creates the
      //      "screen glitching" the user reported.
      if (!data?.subscribed) {
        const inGrace = (() => {
          try {
            return sessionStorage.getItem("tw_post_checkout") === "1";
          } catch { return false; }
        })();
        if (!inGrace) setShowSubscriptionDialog(true);
      } else {
        // Subscription confirmed — exit the grace window if we were in
        // one so a later state change (downgrade, cancel) opens the
        // dialog normally.
        try { sessionStorage.removeItem("tw_post_checkout"); } catch { /* no-op */ }
      }
    } catch (error: unknown) {
      // This function no longer signs anyone out.
      //
      // It used to: two consecutive 401s from check-subscription ended the
      // session. But check-subscription returns 401 from four places, and one
      // of them is its OWN server-side auth.getUser(token) call failing — so a
      // hiccup inside an edge function was logging a browser out. It also
      // returns 401 for a missing header and a malformed token, neither of
      // which is proof the stored session is bad.
      //
      // Session validity is now decided in exactly one place: the getUser()
      // check in the effect below, which asks the auth server directly and
      // classifies the answer via isInvalidSessionError. A billing endpoint's
      // status code is not evidence about a credential, so this only logs.
      const e = error as { context?: { status?: number }; message?: string } | null;
      console.error("[useAuth] check-subscription failed", {
        status: e?.context?.status,
        message: e?.message,
      });
      // Leave subscription empty and record the failure. Callers must not
      // treat "still null" as access — that was the paywall bypass when this
      // request hung or 500'd.
      if (gen === checkGen.current) {
        setSubscription(null);
        setSubscriptionCheck('error');
      }
    }
  };

  useEffect(() => {
    if (!noSessionAuth.session?.access_token) {
      checkGen.current += 1;
      setSubscription(null);
      setSubscriptionCheck('idle');
      setShowSubscriptionDialog(false);
      return;
    }

    const t = window.setTimeout(async () => {
      try {
        const { data, error } = await supabaseNoSession.auth.getUser();

        // This is the ONLY place that ends a session automatically, and it
        // only does so on proof. getUser() returns `{ error }` rather than
        // throwing for an unreachable auth server, so `if (error)` used to
        // catch a network blip and a rejected JWT identically — and the
        // manual refreshSession() that followed was both a third refresher
        // (see useAuthNoSession) and a second chance to sign someone out.
        // Both are gone. Anything that isn't provably an invalid session
        // leaves the session alone and skips this cycle's check.
        if (error && isInvalidSessionError(error)) {
          const session = noSessionAuth.session;
          const expiresAt = session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : 'unknown';
          const now = new Date().toISOString();
          console.error('[useAuth] SIGNING OUT — getUser returned invalid session', {
            errorStatus: (error as any)?.status ?? (error as any)?.context?.status ?? 'unknown',
            errorMessage: error.message,
            isInvalidSession: true,
            sessionExpiresAt: expiresAt,
            currentTime: now,
            tokenPrefix: session?.access_token?.substring(0, 20) ?? 'none',
          });
          await signOut();
          return;
        }
        if (error) {
          console.warn('[useAuth] could not verify session, keeping it:', error.message);
          // The session stays, but billing was not confirmed. Do not leave
          // subscriptionCheck idle — AdminRoute treats that as "unknown"
          // and must not render the product.
          setSubscription(null);
          setSubscriptionCheck('error');
          return;
        }
        if (!data?.user) {
          // No error but no user: nothing to check against. Don't infer a
          // dead session from it — autoRefreshToken may still be mid-flight.
          setSubscription(null);
          setSubscriptionCheck('error');
          return;
        }

        await checkSubscription(noSessionAuth.session?.access_token);
      } catch (e) {
        // Thrown (rather than returned) failures are transport-level. Never
        // a reason to sign out. Billing is still unconfirmed, so the
        // dashboard stays locked until a retry succeeds.
        console.warn('[useAuth] auth check threw, keeping session:', e);
        setSubscription(null);
        setSubscriptionCheck('error');
      }
    }, 0);

    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- checkSubscription/signOut are recreated each render; re-checking on every token refresh is correct, not on callback identity
  }, [noSessionAuth.session?.access_token]);

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

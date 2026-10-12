import { ReactNode, useEffect, useRef } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSubscription } from '@/hooks/useSubscription';
import { Loader2 } from 'lucide-react';

interface AdminRouteProps {
  children: ReactNode;
}

// Routes a non-active org owner is still allowed to reach so they can
// pay / log out / view billing / complete onboarding.
const PAYWALL_ALLOWED_PATHS = [
  '/dashboard/subscription',
  '/dashboard/billing',
  '/onboarding',
  '/logout',
];

function isPaywallAllowed(pathname: string, search: string) {
  if (PAYWALL_ALLOWED_PATHS.some(
    (allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`),
  )) {
    return true;
  }
  if (pathname !== '/dashboard/settings') return false;
  const tab = new URLSearchParams(search).get('tab');
  return tab === 'subscription' || tab === 'billing';
}

function RouteSkeleton() {
  return (
    <div className="flex min-h-screen bg-background" aria-busy="true" aria-label="Loading">
      <div className="hidden w-64 shrink-0 border-r border-border bg-muted/40 md:block" />
      <div className="min-w-0 flex-1 space-y-4 p-4 sm:p-6">
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  );
}

const INVITE_JOIN_KEY = 'tidywise_invite_joined_workspace';

function getRecentInviteJoinAttempt(): { attempt_id?: string } | null {
  try {
    const raw = sessionStorage.getItem(INVITE_JOIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { attempt_id?: string; at?: number };
    if (!parsed.at || Date.now() - parsed.at > 10 * 60 * 1000) {
      sessionStorage.removeItem(INVITE_JOIN_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}



/**
 * AdminRoute - Protects admin dashboard routes
 * 
 * SECURITY: Only allows users with 'owner' or 'admin' role in org_memberships.
 * Staff members (role='member') are redirected to the staff portal.
 * 
 * This prevents cleaners/staff from accidentally or intentionally accessing
 * the admin dashboard even if they have valid authentication.
 */
export function AdminRoute({ children }: AdminRouteProps) {
  const { user, loading: authLoading, subscription, subscriptionCheck, checkSubscription, signOut } = useAuth();
  const { organization, membership, loading: orgLoading, resolution: orgResolution, switching, isAdmin, allOrganizations, switchOrganization, refetch } = useOrganization();
  const { hasFullAccess } = useSubscription();
  const location = useLocation();
  const navigate = useNavigate();

  const switchedRef = useRef(false);
  // One-shot paywall redirect guard. Without this, AdminRoute returns a
  // fresh <Navigate to="/pricing"> on every re-render — and re-renders
  // happen often (subscription poll, org refetch, queryClient changes).
  // Each render fires a navigation call; Chrome's "Throttling navigation"
  // protection kicks in around 30 nav/5s and freezes the tab on a black
  // screen. Imperative navigate() inside useEffect fires once per
  // distinct redirect decision and never floods.
  const paywallRedirectRef = useRef<string | null>(null);


  // If the active org isn't admin/owner but the user IS admin/owner in another
  // org, transparently switch — UNLESS the user deliberately chose this org
  // via the switcher. A deliberate choice means they want the staff portal.
  const adminOrgElsewhere = allOrganizations.find(
    (o) => (o.role === 'owner' || o.role === 'admin' || o.role === 'manager') && o.organization.id !== organization?.id
  );

  const wasOrgChosen = (() => {
    try { return localStorage.getItem('tidywise_org_chosen') === 'true'; }
    catch { return false; }
  })();

  useEffect(() => {
    if (orgLoading || authLoading) return;
    // Don't auto-switch if the user deliberately chose this org.
    if (wasOrgChosen) return;
    if (membership && !isAdmin && adminOrgElsewhere && !switchedRef.current) {
      switchedRef.current = true;
      switchOrganization(adminOrgElsewhere.organization.id);
    }
  }, [orgLoading, authLoading, membership, isAdmin, adminOrgElsewhere, switchOrganization, wasOrgChosen]);

  useEffect(() => {
    if (!organization) return;
    try { sessionStorage.removeItem(INVITE_JOIN_KEY); } catch { /* noop */ }
  }, [organization]);

  // ── PAYWALL GATE ────────────────────────────────────────────────────────
  // Compute BEFORE any early returns so hook order stays stable across
  // renders (otherwise React error #310 — hooks called conditionally).
  //
  // Post-checkout grace window: when the user just completed Stripe
  // Checkout, `tw_post_checkout` is set for ~2 minutes. During that
  // window we suppress the paywall redirect entirely because the
  // webhook (which flips plan_type → 'lifetime' / inserts the
  // subscription row) can race the redirect by several seconds. Without
  // this guard, lifetime buyers land on /dashboard and get bounced
  // straight back to /pricing before check-subscription has caught up
  // — exactly the complaint in the forwarded support email.
  const inPostCheckoutGrace = (() => {
    try {
      return typeof window !== 'undefined' &&
        window.sessionStorage?.getItem('tw_post_checkout') === '1';
    } catch { return false; }
  })();

  // Only a finished check can open the paywall. While the check is in
  // flight, or after it failed, the dashboard is not rendered (see below).
  // Treating "not loaded" as access is how /dashboard skipped payment.
  const needsPaywallRedirect =
    subscriptionCheck === 'ready' &&
    !!user &&
    !!organization &&
    isAdmin &&
    !hasFullAccess &&
    !inPostCheckoutGrace &&
    !PAYWALL_ALLOWED_PATHS.some(
      (allowed) => location.pathname === allowed || location.pathname.startsWith(allowed + '/')
    );

  // On native, always send to /dashboard/subscription (the trial-expired
  // wall). On web, existing customers go to /dashboard/subscription to
  // update their card; new users go to /choose-plan to pick a plan.
  const isExistingCustomer =
    !!subscription?.payment_failed ||
    !!subscription?.subscription_end ||
    (!!subscription?.product_id && subscription.product_id !== 'org_trial');

  const paywallDestination = Capacitor.isNativePlatform()
    ? '/dashboard/subscription'
    : isExistingCustomer ? '/dashboard/subscription' : '/choose-plan';

  // Imperative one-shot redirect, keyed on pathname.
  useEffect(() => {
    if (!needsPaywallRedirect) return;
    if (paywallRedirectRef.current === location.pathname) return;
    paywallRedirectRef.current = location.pathname;
    navigate(paywallDestination, { replace: true, state: { from: location.pathname } });
  }, [needsPaywallRedirect, location.pathname, navigate, paywallDestination]);


  if (authLoading || orgLoading) {
    return <RouteSkeleton />;
  }

  // Not logged in - redirect to login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Logged in but no organization - redirect to onboarding
  if (!organization) {
    const inviteAttempt = getRecentInviteJoinAttempt();
    if (inviteAttempt) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md space-y-3 rounded-lg border bg-card p-6 shadow-sm">
            <h1 className="text-lg font-semibold text-card-foreground">Workspace access is still syncing</h1>
            <p className="text-sm text-muted-foreground">
              Your invite was accepted, but the workspace could not be loaded yet. Refresh once; if it continues, share this attempt ID with support.
            </p>
            {inviteAttempt.attempt_id && (
              <p className="break-all rounded-md bg-muted p-2 text-xs text-muted-foreground">attempt_id: {inviteAttempt.attempt_id}</p>
            )}
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
              onClick={() => window.location.reload()}
            >
              Refresh workspace
            </button>
          </div>
        </div>
      );
    }
    if (orgResolution === 'empty') {
      return <Navigate to="/onboarding" replace />;
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md space-y-3 rounded-lg border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-card-foreground">We couldn't load your workspace</h1>
          <p className="text-sm text-muted-foreground">
            Your account is signed in, but workspace access could not be verified. Retry instead of creating another business.
          </p>
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            onClick={() => void refetch()}
          >
            Retry workspace
          </button>
        </div>
      </div>
    );
  }

  // Org exists but onboarding not completed — send to the wizard.
  // ONLY the account that created the workspace ever sees onboarding. Invited
  // teammates join an existing business; making them run the setup wizard would
  // overwrite the owner's settings.
  // IMPORTANT: /onboarding must stay OUTSIDE AdminRoute in the route tree.
  // If it were inside, this redirect would loop infinitely.
  if (organization.needs_onboarding && organization.owner_id === user.id) {
    return <Navigate to="/onboarding" replace />;
  }


  // Wait for the auto-switch above to take effect before deciding to bounce.
  if (membership && !isAdmin && adminOrgElsewhere) {
    return <RouteSkeleton />;
  }

  // User is a member but NOT an admin/owner anywhere - send to staff portal
  if (membership && !isAdmin) {
    console.warn(
      '[SECURITY] Non-admin user attempted to access admin route',
      { userId: user.id, role: membership.role }
    );
    return <Navigate to="/staff" replace />;
  }

  // Only allow if user is explicitly admin or owner
  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  // Billing unknown: do not mount the product. A check that never returns
  // used to fall through to {children}. The subscription page stays
  // reachable so a failed check cannot trap someone who is trying to pay.
  const onPaywallAllowedPath = isPaywallAllowed(location.pathname, location.search);

  if (!onPaywallAllowedPath && (subscriptionCheck === 'idle' || subscriptionCheck === 'loading')) {
    return <RouteSkeleton />;
  }

  if (!onPaywallAllowedPath && subscriptionCheck === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md space-y-3 rounded-lg border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-card-foreground">We couldn't verify your subscription</h1>
          <p className="text-sm text-muted-foreground">
            The dashboard stays locked until billing can be confirmed. Retry, or sign out and back in.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
              onClick={() => void checkSubscription()}
            >
              Retry
            </button>
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (needsPaywallRedirect) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      {switching && (
        <div className="fixed inset-0 z-[9998] bg-background/80 backdrop-blur-sm flex items-center justify-center transition-opacity">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Switching business...</p>
          </div>
        </div>
      )}
      {children}
    </>
  );
}

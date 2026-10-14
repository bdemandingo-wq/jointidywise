/**
 * usePlanFeature – React hook for tier-aware feature gating.
 *
 * Pairs with src/lib/features.ts. Resolves the user's current
 * organization's effective plan once per session via the
 * my_effective_plan RPC, then returns an { allowed, upgradeTo } pair for
 * any feature key.
 *
 * "Effective" matters: comped orgs, redeemed access codes and in-progress
 * trials all resolve to full features server-side without touching
 * organizations.plan_type, which is billing-owned and locked down by the
 * block_org_billing_self_update trigger.
 */

import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '@/lib/supabase';
import {
  canAccess,
  minimumPlanFor,
  PlanContext,
  PlanType,
  FeatureKey,
} from '@/lib/features';
import { isActiveOrgTrial } from '@/lib/stripeMode';

export interface PlanState extends PlanContext {
  loading: boolean;
  /**
   * Set when my_effective_plan failed every attempt. `loading` goes false at
   * the same moment, so the state always RESOLVES — a permanently-loading plan
   * is a silent wrong answer, and this file used to produce one (see the catch
   * block below for what it cost).
   */
  error: string | null;
  /**
   * organizations.plan_type as stored, before effective_plan folds in
   * comps, access codes and trials. Use this to answer "what plan is this
   * org actually ON" — billing UI, plan switching. Use planType for "what
   * features do they get". Conflating the two told every trialing and
   * comped org they were a lifetime customer.
   */
  rawPlanType: PlanType;
}

// Session-level cache so every component that asks doesn't refetch.
// Cleared when the user changes (different account) below.
let cachedKey: string | null = null;
let cachedState: PlanState | null = null;

/** Subscribers woken by retryPlanState(). Lets the banner re-run the fetch. */
const listeners = new Set<() => void>();

/**
 * Drop the cached plan and make every mounted usePlanState re-fetch.
 * Exported for the "Try again" button on PlanStateBanner.
 */
export function retryPlanState(): void {
  cachedState = null;
  listeners.forEach((notify) => notify());
}

const ATTEMPTS = 3;
/** Backoff before attempts 2 and 3. Short — this runs on every app load. */
const BACKOFF_MS = [300, 1200];

const DEFAULT_STATE: PlanState = {
  planType: 'free',
  rawPlanType: 'free',
  grandfathered: false,
  loading: true,
  error: null,
};

export function usePlanState(): PlanState {
  const { user } = useAuth();
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<PlanState>(() => {
    if (cachedKey === (user?.id ?? null) && cachedState) return cachedState;
    return DEFAULT_STATE;
  });

  // Wake on retryPlanState().
  useEffect(() => {
    const notify = () => setNonce((n) => n + 1);
    listeners.add(notify);
    return () => { listeners.delete(notify); };
  }, []);

  useEffect(() => {
    const userId = user?.id ?? null;
    if (cachedKey !== userId) {
      // Account switched — drop the cache.
      cachedKey = userId;
      cachedState = null;
    }
    if (!userId) {
      const next: PlanState = {
        planType: 'free',
        rawPlanType: 'free',
        grandfathered: false,
        loading: false,
        error: null,
      };
      cachedState = next;
      setState(next);
      return;
    }
    if (cachedState && !cachedState.loading) {
      setState(cachedState);
      return;
    }
    // A retry starts from loading again, so the banner can't linger next to
    // a figure that has already been refreshed.
    setState((prev) => (prev.error ? { ...prev, loading: true, error: null } : prev));

    let cancelled = false;
    (async () => {
      // my_effective_plan resolves the caller's own org and folds in the
      // things plan_type alone doesn't know about: an active comped grant,
      // a redeemed access code, or an in-progress Stripe trial. See
      // public.effective_plan.
      const fetchPlan = async () => {
        const { data, error } = await supabase.rpc('my_effective_plan');
        if (error) throw error;
        return Array.isArray(data) ? data[0] : data;
      };

      let lastError: unknown = null;
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1]));
          if (cancelled) return;
        }
        try {
          const row = await fetchPlan();
          if (cancelled) return;

          const next: PlanState = {
            planType: (row?.plan_type as PlanType) ?? 'free',
            rawPlanType: (row?.raw_plan_type as PlanType) ?? 'free',
            // Deprecated and always false. my_effective_plan stopped
            // returning it once canAccess stopped reading it; grandfathered
            // orgs now arrive as planType 'lifetime' instead.
            grandfathered: false,
            loading: false,
            error: null,
          };
          cachedKey = userId;
          cachedState = next;
          setState(next);
          return;
        } catch (e) {
          lastError = e;
        }
      }

      // Every attempt failed.
      //
      // Neither fail open nor fail closed. Setting grandfathered:true here
      // once turned any transient lookup error into a full feature bypass;
      // failing closed would show a paying Custom customer an upgrade wall
      // over a network blip. The previous fix was to stay in `loading`
      // forever — but that never RESOLVES, and an unresolved state is a
      // silent wrong answer that nobody can see or report. It also leaves
      // useSubscription().isLoading true permanently, which suppresses the
      // paywall redirect indefinitely.
      //
      // So: resolve, keep the gates' existing pass-through behaviour (they
      // already render children while loading, so treating `error` the same
      // way changes nothing about what is unlocked), and make the failure
      // VISIBLE via PlanStateBanner. Degraded and legible beats correct-
      // looking and stuck.
      if (!cancelled) {
        const message =
          lastError instanceof Error
            ? lastError.message
            : typeof lastError === 'string'
              ? lastError
              : 'Unknown error';
        console.warn('[usePlanState] my_effective_plan failed after', ATTEMPTS, 'attempts:', message);
        const next: PlanState = {
          planType: 'free',
          rawPlanType: 'free',
          grandfathered: false,
          loading: false,
          error: message,
        };
        // Deliberately NOT cached: the next mount should try again rather
        // than inherit a failure from earlier in the session.
        cachedState = null;
        setState(next);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, nonce]);

  return state;
}

export interface FeatureAccess {
  /** Final yes/no for the question "can this user use this feature?" */
  allowed: boolean;
  /** Still resolving the user's plan. UI should pass children through, not block. */
  loading: boolean;
  /**
   * The plan lookup failed after every retry. Treat this exactly like
   * `loading` for gating decisions — pass children through — and let
   * PlanStateBanner do the explaining. Blocking on it would be a false wall.
   */
  error: string | null;
  /** The user's current plan label (raw enum value). */
  planType: PlanType;
  /** Grandfathered orgs always allowed regardless of plan_type. */
  grandfathered: boolean;
  /**
   * The minimum plan the user must upgrade TO to unlock this feature.
   * null when already allowed.
   */
  upgradeTo: 'basic' | 'pro' | 'custom' | null;
}

export function usePlanFeature(featureKey: FeatureKey): FeatureAccess {
  const state = usePlanState();
  const { subscription } = useAuth();
  // Card-free trial is Pro even when organizations.plan_type is still free.
  const planType: PlanType = isActiveOrgTrial(subscription) ? 'trial' : state.planType;
  const ctx: PlanContext = { ...state, planType };
  const allowed = !state.loading && !state.error && canAccess(featureKey, ctx);
  return {
    allowed,
    loading: state.loading,
    error: state.error,
    planType,
    grandfathered: state.grandfathered,
    upgradeTo: allowed ? null : minimumPlanFor(featureKey),
  };
}

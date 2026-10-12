/**
 * useSubscription – derives feature-level access from the auth subscription state.
 *
 * Free / trial-expired users are "limited mode":
 *   • Max 5 customers
 *   • No SMS campaigns
 *   • No OpenPhone integration
 *   • No AI Intelligence
 *   • No advanced reports / finance
 *
 * Accounts in FREE_ACCOUNTS always get full access.
 */

import { useAuth } from './useAuth';
import { usePlanState } from './usePlanFeature';
import { hasPaidDashboardAccess } from '@/lib/dashboardAccess';

const FREE_ACCOUNTS = [
  'support@tidywisecleaning.com',
  'applereview@tidywise.com',
  'applereview@tidywise1.com',
];

/** Demo/review accounts that bypass subscription enforcement entirely */
function isDemoAccount(email: string | undefined): boolean {
  if (!email) return false;
  return FREE_ACCOUNTS.includes(email) || email.endsWith('@tidywise1.com');
}

export interface SubscriptionAccess {
  /** True only if user has a confirmed active Stripe subscription */
  isSubscribed: boolean;
  /** True if the user is on an active trial that has NOT expired */
  isTrialActive: boolean;
  /** True if the user has full (paid or free-account) access */
  hasFullAccess: boolean;
  /** Whether the subscription data has loaded yet */
  isLoading: boolean;

  /* Feature-level gates */
  canAccessCampaigns: boolean;
  canAccessOpenPhone: boolean;
  canAccessAIIntelligence: boolean;
  canAccessReports: boolean;
  canAccessFinance: boolean;
  canAccessClientPortal: boolean;
  canAccessInventory: boolean;
  canAccessExpenses: boolean;
  canAccessBookingPhotos: boolean;

  /** Max customers allowed (Infinity for full access) */
  maxCustomers: number;
}

export function useSubscription(): SubscriptionAccess {
  const { user, subscription, subscriptionCheck, loading } = useAuth();
  const planState = usePlanState();

  const isFreeAccount = isDemoAccount(user?.email ?? '');
  const isSubscribed = subscription?.subscribed === true;
  const isTrialActive = subscription?.trial_active === true;

  // Access is granted when check-subscription says the account is
  // subscribed or on an active trial. That includes Stripe trialing, the
  // card-free org trial (product_id org_trial), the older 60-day org trial,
  // lifetime, and comped access. subscribed=false with no trial is the
  // only block: no plan, expired trial, or a failed payment.
  const hasFullAccess = hasPaidDashboardAccess({
    isFreeAccount,
    subscribed: isSubscribed,
    trialActive: isTrialActive,
  });

  // Tier-aware Pro-feature gate. Even during the 14-day trial, the
  // user only gets access to the FEATURES of the plan they selected.
  // Basic-plan users (paid or trialing) must NOT see Pro-only modules
  // like AI, Campaigns, Reports, Inventory, etc.
  // Demo accounts bypass tier gating entirely. Native trial users get
  // all features during the trial (plan_type='trial' is treated as pro).
  const bypassTier = isFreeAccount || planState.grandfathered;
  const proOrAbove = bypassTier || (hasFullAccess && (
    planState.planType === 'pro' ||
    planState.planType === 'custom' ||
    planState.planType === 'lifetime' ||
    planState.planType === 'standard' ||
    planState.planType === 'enterprise' ||
    planState.planType === 'trial'
  ));

  return {
    isSubscribed,
    isTrialActive,
    hasFullAccess,
    // While auth/subscription/plan is still loading we don't know yet —
    // keep isLoading true so route guards can wait instead of bouncing.
    isLoading:
      loading ||
      planState.loading ||
      (!!user &&
        !isFreeAccount &&
        (subscriptionCheck === 'idle' || subscriptionCheck === 'loading')),

    canAccessCampaigns: proOrAbove,
    canAccessOpenPhone: proOrAbove,
    canAccessAIIntelligence: proOrAbove,
    canAccessReports: proOrAbove,
    canAccessFinance: proOrAbove,
    canAccessClientPortal: proOrAbove,
    canAccessInventory: proOrAbove,
    canAccessExpenses: proOrAbove,
    canAccessBookingPhotos: proOrAbove,

    maxCustomers: hasFullAccess ? Infinity : 5,
  };
}

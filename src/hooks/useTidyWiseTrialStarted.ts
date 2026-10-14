import { useEffect } from 'react';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/lib/supabase';
import { loadPrivacyChoice } from '@/lib/tidywisePrivacyStore';
import {
  isTagHostnameAllowed,
  orgCreatedWithinTrialPixelWindow,
  readGlobalPrivacyControl,
  shouldSendTrialStartedPixel,
  tagHostOptionsFromEnv,
  trialStartedConsentAllows,
  trialStartedDestinationConfigured,
} from '@/lib/tidywiseSitePrivacy';
import { detectNativePlatform, tidyWiseIdsFromEnv, trackTidyWiseConversion } from '@/lib/tidywiseTags';

interface TrialOrg {
  id?: string;
  created_at?: string | null;
  plan_type?: string | null;
}

function planIsTrial(planType: string | null | undefined): boolean {
  return (planType ?? '').trim().toLowerCase() === 'trial';
}

function liveConsent(): {
  choice: ReturnType<typeof loadPrivacyChoice>;
  gpc: boolean;
  hostnameAllowed: boolean;
  native: boolean;
} {
  const nav = typeof navigator === 'undefined'
    ? null
    : (navigator as Navigator & { globalPrivacyControl?: boolean });
  const hostnameAllowed = typeof window !== 'undefined' && isTagHostnameAllowed(
    window.location.hostname,
    tagHostOptionsFromEnv({
      PROD: import.meta.env.PROD === true,
      VITE_TIDYWISE_TAG_TEST_HOSTS: import.meta.env.VITE_TIDYWISE_TAG_TEST_HOSTS,
    }),
  );
  return {
    choice: loadPrivacyChoice(),
    gpc: readGlobalPrivacyControl(nav),
    hostnameAllowed,
    native: detectNativePlatform(),
  };
}

/**
 * One trial_started pixel per org. The browser event fires only after
 * claim_trial_started_pixel returns true. That RPC is the one-time claim.
 * Nothing here reports the event to our own server.
 */
export function useTidyWiseTrialStarted(organization: TrialOrg | null | undefined): void {
  const { isTrialActive, isLoading } = useSubscription();
  const organizationId = organization?.id ?? null;
  const createdAt = organization?.created_at ?? null;
  const planType = organization?.plan_type ?? null;

  useEffect(() => {
    if (!organizationId) return;
    if (!orgCreatedWithinTrialPixelWindow(createdAt)) return;
    const inTrial = planIsTrial(planType) || isTrialActive;
    if (!planIsTrial(planType) && isLoading) return;
    if (!inTrial) return;
    // No ids, opt-out, GPC, or a disallowed host must not spend the one-time claim.
    const consent = liveConsent();
    if (!trialStartedConsentAllows(consent)) return;
    if (!trialStartedDestinationConfigured(tidyWiseIdsFromEnv())) return;

    void (async () => {
      const { data, error } = await supabase.rpc('claim_trial_started_pixel', { p_org: organizationId });
      if (error) {
        console.warn('trial_started claim failed', error);
        return;
      }
      const consent = liveConsent();
      if (!shouldSendTrialStartedPixel({
        createdAt,
        inTrial,
        claimGranted: data === true,
        choice: consent.choice,
        gpc: consent.gpc,
        hostnameAllowed: consent.hostnameAllowed,
        native: consent.native,
      })) return;
      trackTidyWiseConversion('trial_started');
    })();
  }, [organizationId, createdAt, planType, isTrialActive, isLoading]);
}

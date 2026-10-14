import { useEffect, useRef } from 'react';
import { trackTidyWiseConversion } from '@/lib/tidywiseTags';

/**
 * The trial org is created while the visitor is on /onboarding or /dashboard.
 * Fire once per user. The conversion helper dedupes across both pages.
 */
export function useTidyWiseTrialStarted(
  userId: string | null | undefined,
  organizationId: string | null | undefined,
): void {
  const sentFor = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || !organizationId) return;
    if (sentFor.current === userId) return;
    sentFor.current = userId;
    trackTidyWiseConversion('trial_started', userId);
  }, [userId, organizationId]);
}

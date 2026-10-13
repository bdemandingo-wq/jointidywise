import { useState } from 'react';
import { captureReferralFromLocation, readCapturedReferral } from '@/lib/referralAttribution';

/**
 * Shown on signup when the visitor arrived through /r/CODE or ?ref=.
 * Capture runs during the first render so the banner is not blank on the
 * paint that happens before App's effect.
 */
export function ReferredSignupBanner() {
  const [referred] = useState(() => {
    if (typeof window === 'undefined') return false;
    captureReferralFromLocation(window.location);
    return readCapturedReferral() != null;
  });

  if (!referred) return null;

  return (
    <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground">
      You were referred to TidyWise. Create your account and your referrer is credited once you become a paying customer.
    </div>
  );
}

import {
  lifetimeSpotsLabel,
  shouldShowTrustedBy,
  shouldShowWeeklySignups,
  trustedByLabel,
  weeklySignupLabel,
} from '@/lib/publicActivity';
import type { LifetimeState } from '@/hooks/useLifetimeCounter';
import type { PublicGrowthCounters } from '@/lib/publicActivity';

/**
 * Real counts only. A missing read renders nothing rather than a
 * placeholder like "100 of 100".
 */
export function GrowthCounters({
  lifetime,
  counters,
  className = '',
}: {
  lifetime?: LifetimeState | null;
  counters?: PublicGrowthCounters | null;
  className?: string;
}) {
  const total = counters?.lifetimeTotal ?? (lifetime && !lifetime.loading && !lifetime.unavailable ? lifetime.total : null);
  const remaining = counters
    ? counters.lifetimeRemaining
    : lifetime && !lifetime.loading && !lifetime.unavailable
      ? lifetime.spotsLeft
      : null;
  const weekly = counters?.weeklySignups ?? null;
  const organizations = counters?.organizationCount ?? null;
  const showLifetime = total != null && remaining != null && total > 0;
  const showTrusted = shouldShowTrustedBy(organizations);
  const showWeekly = shouldShowWeeklySignups(weekly, counters?.weeklySignupMin);

  if (!showLifetime && !showWeekly && !showTrusted) return null;

  return (
    <div className={`flex flex-col gap-1 text-sm ${className.includes('items-') ? '' : 'items-center'} ${className}`}>
      {showTrusted && organizations != null && (
        <p className="font-serif text-2xl sm:text-3xl text-foreground leading-tight">
          {trustedByLabel(organizations)}
        </p>
      )}
      {showLifetime && (
        <p className="font-medium text-foreground">
          {lifetimeSpotsLabel(remaining, total)}
        </p>
      )}
      {showWeekly && weekly != null && (
        <p className="text-muted-foreground">{weeklySignupLabel(weekly)}</p>
      )}
    </div>
  );
}

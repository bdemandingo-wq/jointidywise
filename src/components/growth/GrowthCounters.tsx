import { lifetimeSpotsLabel, shouldShowWeeklySignups, weeklySignupLabel } from '@/lib/publicActivity';
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
  const showLifetime = total != null && remaining != null && total > 0;
  const showWeekly = shouldShowWeeklySignups(weekly);

  if (!showLifetime && !showWeekly) return null;

  return (
    <div className={`flex flex-col gap-1 text-sm ${className.includes('items-') ? '' : 'items-center'} ${className}`}>
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

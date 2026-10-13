import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { GrowthCounters } from '@/components/growth/GrowthCounters';
import { TRIAL_CTA } from '@/lib/trialOffer';
import type { LifetimeState } from '@/hooks/useLifetimeCounter';
import type { PublicGrowthCounters } from '@/lib/publicActivity';

export function GrowthUpgradeCard({
  lifetime,
  counters,
  href,
  detail,
  title = TRIAL_CTA,
}: {
  lifetime?: LifetimeState | null;
  counters?: PublicGrowthCounters | null;
  href: string;
  detail: string;
  title?: string;
}) {
  return (
    <section className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
          <GrowthCounters lifetime={lifetime} counters={counters} className="mt-3 items-start" />
        </div>
        <Button asChild className="shrink-0">
          <Link to={href}>See plans</Link>
        </Button>
      </div>
    </section>
  );
}

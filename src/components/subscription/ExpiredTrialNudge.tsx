import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { expiredTrialNudgeCopy } from "@/lib/planBillingCopy";

/** Shown on the dashboard home when the trial is over or there is no plan. */
export function ExpiredTrialNudge({ trialEnd }: { trialEnd: string | null | undefined }) {
  const copy = expiredTrialNudgeCopy(trialEnd);
  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">{copy.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.detail}</p>
        </div>
        <Button asChild className="h-11 min-h-[44px] shrink-0">
          <Link to="/dashboard/settings?tab=subscription">See plans</Link>
        </Button>
      </div>
    </section>
  );
}

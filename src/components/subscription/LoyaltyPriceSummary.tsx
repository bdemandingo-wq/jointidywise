import { Progress } from "@/components/ui/progress";
import { billingLoyaltyLine } from "../../../supabase/functions/_shared/loyalty-pricing";
import type { LoyaltyPricingState } from "@/hooks/useLoyaltyPricing";

export function LoyaltyPriceSummary({ state }: { state: LoyaltyPricingState }) {
  if (state.tableNotLive || state.isDisabled || state.isLoading || state.isEmpty) return null;
  if (state.error) {
    return (
      <p className="text-sm text-destructive">
        Couldn't load your loyalty price. {state.error.message}
      </p>
    );
  }
  if (!state.quote) return null;
  const percent = Math.round(state.quote.progress * 100);
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
      <p className="text-sm text-foreground">{billingLoyaltyLine(state.quote)}</p>
      <Progress
        value={percent}
        aria-label={
          state.quote.atFloor
            ? "Loyalty price is at its lowest"
            : "Progress toward the next loyalty price drop"
        }
      />
    </div>
  );
}

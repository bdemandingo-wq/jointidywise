import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { readReportedStripeMode, type ReportedStripeMode } from "@/lib/stripeMode";

const COPY: Record<ReportedStripeMode, { label: string; className: string }> = {
  live: {
    label: "Stripe LIVE — real charges",
    className: "border-amber-500 bg-amber-50 text-amber-950 hover:bg-amber-50",
  },
  test: {
    label: "Stripe test mode",
    className: "border-emerald-600 bg-emerald-50 text-emerald-950 hover:bg-emerald-50",
  },
  unset: {
    label: "Stripe key is not set",
    className: "border-destructive text-destructive",
  },
  unknown: {
    label: "Stripe key prefix is unrecognized",
    className: "border-destructive text-destructive",
  },
  unreported: {
    label: "Stripe mode not reported yet",
    className: "text-muted-foreground",
  },
};

/**
 * Admin-visible test/live indicator. The mode comes from the prefix of
 * STRIPE_SECRET_KEY, reported by check-subscription. This component does not
 * choose a mode.
 */
export function StripeModeBadge() {
  const { subscription } = useAuth();
  const mode = readReportedStripeMode(subscription);
  const copy = COPY[mode];
  return (
    <Badge variant="outline" className={copy.className} data-stripe-mode={mode}>
      {copy.label}
    </Badge>
  );
}

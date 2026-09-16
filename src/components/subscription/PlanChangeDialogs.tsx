import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, AlertTriangle, BadgePercent, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useOrgId } from "@/hooks/useOrgId";
import { isAlreadyLifetimeError, ALREADY_LIFETIME_MESSAGE } from "@/lib/alreadyLifetime";
import {
  readEdgeFunctionError,
  readEdgeFunctionErrorBody,
} from "@/lib/edgeFunctionError";

/**
 * Someone on a trial has no Stripe subscription to modify, so the plan-change
 * function correctly refuses. Rather than dead-ending them on an error, send
 * them straight to checkout for the plan they just picked.
 */
async function startCheckout(planId: string): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("create-subscription", {
    body: { plan: planId, interval: "monthly" },
  });
  if (error) {
    // A lifetime owner has nothing to buy. Tell them so and treat it as
    // handled, rather than falling through to "could not upgrade plan".
    if (await isAlreadyLifetimeError(error)) {
      toast.success(ALREADY_LIFETIME_MESSAGE);
      return true;
    }
    return false;
  }
  const url = (data as { url?: string } | null)?.url;
  if (!url) return false;
  window.location.href = url;
  return true;
}

export interface PlanInfo {
  id: "basic" | "pro" | "custom";
  name: string;
  monthlyPrice: number;
  features: string[];
}

function fmtMoney(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

interface PreviewData {
  currency: string;
  amount_due_today: number;
  proration_credit: number;
  next_amount: number;
  next_billing_date: string | null;
  discount_valid: boolean;
  discount_error?: string;
}

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetPlan: PlanInfo | null;
  onCompleted: () => void;
}

export function UpgradePlanDialog({
  open,
  onOpenChange,
  targetPlan,
  onCompleted,
}: UpgradeDialogProps) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [discountCode, setDiscountCode] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { organizationId } = useOrgId();


  useEffect(() => {
    if (!open || !targetPlan) return;
    setDiscountCode("");
    setAppliedCode(null);
    void fetchPreview(undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchPreview/targetPlan are recreated each render; runs when dialog opens or plan id changes
  }, [open, targetPlan?.id]);

  async function fetchPreview(code: string | undefined) {
    if (!targetPlan) return;
    setLoading(true);
    setPreviewError(null);
    try {
      const { data, error } = await supabase.functions.invoke("preview-plan-change", {
        body: { plan: targetPlan.id, interval: "monthly", discount_code: code },
      });
      if (error) {
        throw new Error(await readEdgeFunctionError(error, "Could not load preview"));
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      setPreview(data as PreviewData);
      if (code && (data as PreviewData).discount_valid) {
        setAppliedCode(code);
        toast.success("Discount applied");
      } else if (code && (data as PreviewData).discount_error) {
        toast.error((data as PreviewData).discount_error || "Invalid code");
        setAppliedCode(null);
      }
    } catch (err: any) {
      setPreviewError(err?.message || "Could not load preview");
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    if (!targetPlan) return;
    setConfirming(true);
    try {
      const { data, error } = await supabase.functions.invoke("change-subscription-plan", {
        body: {
          plan: targetPlan.id,
          interval: "monthly",
          mode: "upgrade",
          organization_id: organizationId,
          discount_code: appliedCode ?? undefined,
        },
      });
      if (error) {
        const body = await readEdgeFunctionErrorBody(error);
        if (body?.code === "no_subscription") {
          const started = await startCheckout(targetPlan.id);
          if (started) return;
        }
        throw new Error(await readEdgeFunctionError(error, "Could not upgrade plan"));
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(
        `You've been upgraded to ${targetPlan.name}. Your new features are now active.`,
      );
      onOpenChange(false);
      onCompleted();
    } catch (err: any) {
      toast.error(err?.message || "Could not upgrade plan");
    } finally {
      setConfirming(false);
    }
  }

  if (!targetPlan) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upgrade to {targetPlan.name}</DialogTitle>
          <DialogDescription>
            Switch immediately. You'll be charged a prorated amount for the rest of this billing period.
          </DialogDescription>
        </DialogHeader>

        {loading && !preview ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : previewError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{previewError}</AlertDescription>
          </Alert>
        ) : preview ? (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Prorated charge today</span>
              <span className="font-semibold">
                {fmtMoney(preview.amount_due_today, preview.currency)}
              </span>
            </div>
            {preview.proration_credit > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Credit applied</span>
                <span>−{fmtMoney(preview.proration_credit, preview.currency)}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-3">
              <span className="text-muted-foreground">Next billing amount</span>
              <span className="font-semibold">
                {fmtMoney(preview.next_amount, preview.currency)}/mo
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Next billing date</span>
              <span>
                {preview.next_billing_date
                  /* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant (billing/subscription/audit date), not a business-day boundary; see src/lib/orgDateRange.ts */
                  ? new Date(preview.next_billing_date).toLocaleDateString()
                  : "—"}
              </span>
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="discount" className="text-xs uppercase tracking-wide text-muted-foreground">
            Discount code
          </Label>
          <div className="flex gap-2">
            <Input
              id="discount"
              value={discountCode}
              onChange={(e) => setDiscountCode(e.target.value)}
              placeholder="Enter code"
              disabled={loading || confirming}
            />
            <Button
              variant="outline"
              type="button"
              onClick={() => fetchPreview(discountCode.trim())}
              disabled={!discountCode.trim() || loading || confirming}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
            </Button>
          </div>
          {appliedCode && (
            <p className="flex items-center gap-1 text-xs text-emerald-600">
              <CheckCircle2 className="h-3 w-3" /> Code {appliedCode} applied
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={confirming || loading || !!previewError}>
            {confirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Upgrade to {targetPlan.name}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DowngradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetPlan: PlanInfo | null;
  currentPlan: PlanInfo | null;
  periodEnd: string | null;
  onCompleted: () => void;
}

export function DowngradePlanDialog({
  open,
  onOpenChange,
  targetPlan,
  currentPlan,
  periodEnd,
  onCompleted,
}: DowngradeDialogProps) {
  const [confirming, setConfirming] = useState(false);
  const { organizationId } = useOrgId();

  async function confirm() {
    if (!targetPlan) return;
    setConfirming(true);
    try {
      const { data, error } = await supabase.functions.invoke("change-subscription-plan", {
        body: {
          plan: targetPlan.id,
          interval: "monthly",
          mode: "downgrade",
          organization_id: organizationId,
        },
      });
      if (error) {
        throw new Error(await readEdgeFunctionError(error, "Could not schedule downgrade"));
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      const scheduled = (data as any)?.scheduled_at || periodEnd;
      const dateStr = scheduled
        /* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant (billing/subscription/audit date), not a business-day boundary; see src/lib/orgDateRange.ts */
        ? new Date(scheduled).toLocaleDateString()
        : "your next billing date";
      toast.success(
        `Your plan will downgrade to ${targetPlan.name} on ${dateStr}.`,
      );
      onOpenChange(false);
      onCompleted();
    } catch (err: any) {
      toast.error(err?.message || "Could not schedule downgrade");
    } finally {
      setConfirming(false);
    }
  }

  if (!targetPlan) return null;

  // Features lost = features in current plan that aren't in target plan
  const lostFeatures = currentPlan
    ? currentPlan.features.filter((f) => !targetPlan.features.includes(f))
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Downgrade to {targetPlan.name}</DialogTitle>
          <DialogDescription>
            Your account will be credited for the remaining time on your current plan.
          </DialogDescription>
        </DialogHeader>

        {lostFeatures.length > 0 && (
          <Alert variant="destructive" className="border-amber-300 bg-amber-50 text-amber-900 [&>svg]:text-amber-600">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>You'll lose access to:</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                {lostFeatures.slice(0, 6).map((f) => (
                  <li key={f}>{f}</li>
                ))}
                {lostFeatures.length > 6 && (
                  <li className="text-muted-foreground">
                    +{lostFeatures.length - 6} more features
                  </li>
                )}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <div className="flex items-center gap-2">
            <BadgePercent className="h-4 w-4 text-muted-foreground" />
            <span>
              Switches on{" "}
              <span className="font-semibold">
                {/* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant */}
                {periodEnd ? new Date(periodEnd).toLocaleDateString() : "next billing date"}
              </span>
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            You keep {currentPlan?.name ?? "your current plan"} features until then.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={confirming}>
            {confirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Downgrade Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

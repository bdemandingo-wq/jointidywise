import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Check,
  Crown,
  Lock,
  Sparkles,
  Zap,
  CalendarClock,
  Loader2,
} from "lucide-react";
import { usePlanState } from "@/hooks/usePlanFeature";
import {
  UpgradePlanDialog,
  DowngradePlanDialog,
  type PlanInfo,
} from "./PlanChangeDialogs";
import { useAuth } from "@/hooks/useAuth";
import { useOrgId } from "@/hooks/useOrgId";
import { usePlatform } from "@/hooks/usePlatform";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { readEdgeFunctionError, readEdgeFunctionErrorBody } from "@/lib/edgeFunctionError";
import { hasChangeableStripeSubscription, isActiveOrgTrial, planSectionLabel } from "@/lib/stripeMode";
import { AlreadyLifetimeCheckout, startSubscriptionCheckout } from "@/lib/startSubscriptionCheckout";
import { ALREADY_LIFETIME_MESSAGE } from "@/lib/alreadyLifetime";
import { CustomPriceMissing } from "@/lib/priceNotConfigured";

const PLANS: PlanInfo[] = [
  {
    id: "basic",
    name: "Basic",
    monthlyPrice: 49,
    features: [
      "Online booking system",
      "Unlimited customers + CRM",
      "Smart team scheduler",
      "Estimates, invoices, Stripe payments",
      "Recurring bookings + jobs",
      "Staff management",
      "In-app messaging",
      "Email support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPrice: 97,
    features: [
      "Everything in Basic",
      "Automations (reviews, reminders, win-back, promos)",
      "Email marketing campaigns",
      "AI Intelligence + Copilot",
      "Advanced reports + benchmarks",
      "GPS tracking + operations dashboard",
      "Payroll for cleaners",
      "Inventory + expenses",
      "Client portal",
      "Data import",
      "Lead pipeline",
    ],
  },
  {
    id: "custom",
    name: "Custom",
    monthlyPrice: 197,
    features: [
      "Everything in Pro",
      "1 done-for-you request per month",
      "Build me a website + connect to TidyWise",
      "Set up my SMS + email marketing",
      "Import my customers from another CRM",
      "Scripts & documents pack",
      "Priority support",
    ],
  },
];

const RANK: Record<string, number> = { basic: 1, pro: 2, custom: 3, lifetime: 99 };
const ICONS = { basic: Sparkles, pro: Zap, custom: Crown } as const;

interface DowngradeState {
  to: string | null;
  date: string | null;
}

export function PlanSwitcher() {
  const navigate = useNavigate();
  const planState = usePlanState();
  const { subscription, checkSubscription } = useAuth();
  const { organizationId } = useOrgId();
  const { canShowPaymentFlows } = usePlatform();
  const [upgradeTarget, setUpgradeTarget] = useState<PlanInfo | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState<string | null>(null);
  const [downgradeTarget, setDowngradeTarget] = useState<PlanInfo | null>(null);
  const [downgrade, setDowngrade] = useState<DowngradeState>({ to: null, date: null });
  const [cancellingDowngrade, setCancellingDowngrade] = useState(false);

  // Billing UI must reflect the plan the org is actually ON, not the tier
  // effective_plan grants them. effective_plan returns 'lifetime' for
  // comped orgs and anyone mid-trial too, so reading planType here told a
  // 14-day trial user they were a lifetime customer with nothing to buy —
  // and hid the plan switcher that would have converted them.
  const currentPlanId = planState.rawPlanType;
  const isLifetime = currentPlanId === "lifetime";

  const currentPlan = useMemo(
    () => PLANS.find((p) => p.id === currentPlanId) ?? null,
    [currentPlanId],
  );

  const targetDowngradePlan = useMemo(
    () => PLANS.find((p) => p.id === downgrade.to) ?? null,
    [downgrade.to],
  );

  async function refreshDowngrade() {
    if (!organizationId) return;
    const { data } = await (supabase as any)
      .from("organizations")
      .select("plan_downgrade_scheduled_to, plan_downgrade_date")
      .eq("id", organizationId)
      .maybeSingle();
    setDowngrade({
      to: data?.plan_downgrade_scheduled_to ?? null,
      date: data?.plan_downgrade_date ?? null,
    });
  }

  useEffect(() => {
    void refreshDowngrade();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  function action(plan: PlanInfo) {
    const targetRank = RANK[plan.id] ?? 0;
    const curRank = RANK[currentPlanId] ?? 0;
    if (targetRank > curRank) setUpgradeTarget(plan);
    else if (targetRank < curRank) setDowngradeTarget(plan);
  }

  async function cancelDowngrade() {
    setCancellingDowngrade(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "change-subscription-plan",
        { body: { mode: "cancel_downgrade", organization_id: organizationId } },
      );
      if (error) throw new Error(await readEdgeFunctionError(error, "Could not cancel downgrade"));
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Downgrade cancelled. You'll stay on your current plan.");
      setDowngrade({ to: null, date: null });
      await checkSubscription();
      await refreshDowngrade();
    } catch (err: any) {
      toast.error(err?.message || "Could not cancel downgrade");
    } finally {
      setCancellingDowngrade(false);
    }
  }

  const hasScheduledDowngrade =
    !!downgrade.to && !!targetDowngradePlan && !isLifetime;
  const canChangePlan = hasChangeableStripeSubscription(subscription);
  const choosingFirstPlan = isActiveOrgTrial(subscription) || subscription?.trial_active === true;

  async function subscribe(plan: PlanInfo) {
    if (!canShowPaymentFlows) {
      window.open("https://jointidywise.com/choose-plan?upgrade=1", "_blank", "noopener,noreferrer");
      return;
    }
    setCheckoutBusy(plan.id);
    try {
      await startSubscriptionCheckout(plan.id, "monthly", organizationId);
    } catch (err) {
      if (err instanceof AlreadyLifetimeCheckout) {
        toast.success(ALREADY_LIFETIME_MESSAGE);
      } else if (err instanceof CustomPriceMissing) {
        navigate("/contact");
      } else {
        toast.error(err instanceof Error ? err.message : "Could not start checkout. Nothing was charged.");
      }
      setCheckoutBusy(null);
    }
  }

  async function openPortal() {
    setCheckoutBusy("portal");
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal", {
        body: organizationId ? { organization_id: organizationId } : {},
      });
      if (error) {
        const body = await readEdgeFunctionErrorBody(error);
        if (body?.code === "no_customer") {
          toast.error(typeof body.error === "string" ? body.error : "No card on file yet.");
          if (canShowPaymentFlows) window.location.href = "/choose-plan?upgrade=1";
          return;
        }
        throw new Error(await readEdgeFunctionError(error, "Could not open the billing portal."));
      }
      const url = (data as { url?: string; error?: string } | null)?.url;
      if (!url) throw new Error((data as { error?: string } | null)?.error || "Could not open the billing portal.");
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open the billing portal.");
    } finally {
      setCheckoutBusy(null);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Plan</h3>
          <p className="text-sm text-muted-foreground">
            {isLifetime ? (
              <span className="inline-flex items-center gap-1">
                <Crown className="h-3.5 w-3.5 text-amber-500" /> Lifetime — locked in forever
              </span>
            ) : (
              <>You're on the <span className="font-medium text-foreground">{planSectionLabel({
                rawPlanType: currentPlanId,
                productId: subscription?.product_id,
                subscribed: subscription?.subscribed,
                trialActive: subscription?.trial_active,
              })}</span> plan.</>
            )}
          </p>
        </div>
        {isLifetime && (
          <Badge variant="secondary" className="gap-1">
            <Lock className="h-3 w-3" /> Locked
          </Badge>
        )}
      </div>

      {hasScheduledDowngrade && (
        <Alert className="mb-4 border-amber-300 bg-amber-50 text-amber-900 [&>svg]:text-amber-600">
          <CalendarClock className="h-4 w-4" />
          <AlertTitle>Downgrade scheduled</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Your plan will change to{" "}
              <span className="font-semibold">{targetDowngradePlan!.name}</span>
              {downgrade.date ? (
                <>
                  {" "}on{" "}
                  <span className="font-semibold">
                    {/* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant */}
                    {new Date(downgrade.date).toLocaleDateString()}
                  </span>
                </>
              ) : null}
              .
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={cancelDowngrade}
              disabled={cancellingDowngrade}
              className="self-start sm:self-auto"
            >
              {cancellingDowngrade && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              Cancel downgrade
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {PLANS.map((plan) => {
          const Icon = ICONS[plan.id];
          const isCurrent = plan.id === currentPlanId;
          const targetRank = RANK[plan.id] ?? 0;
          const curRank = RANK[currentPlanId] ?? 0;
          const isUpgrade = targetRank > curRank;
          const isPendingTarget = downgrade.to === plan.id;

          return (
            <div
              key={plan.id}
              className={`relative rounded-lg border p-4 ${
                isCurrent ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              {isCurrent && !choosingFirstPlan && (
                <Badge className="absolute -top-2 right-3" variant="default">
                  Current
                </Badge>
              )}
              {isPendingTarget && !isCurrent && (
                <Badge
                  className="absolute -top-2 right-3 bg-amber-500 hover:bg-amber-500"
                  variant="default"
                >
                  Scheduled
                </Badge>
              )}
              <div className="mb-2 flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">{plan.name}</span>
              </div>
              <div className="mb-3">
                <span className="text-2xl font-bold">${plan.monthlyPrice}</span>
                <span className="text-sm text-muted-foreground">/mo</span>
              </div>
              <ul className="mb-4 space-y-1.5 text-xs text-muted-foreground">
                {plan.features.slice(0, 4).map((f) => (
                  <li key={f} className="flex items-start gap-1.5">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {choosingFirstPlan ? (
                <Button
                  size="sm"
                  variant="premium"
                  className="w-full"
                  onClick={() => void subscribe(plan)}
                  disabled={checkoutBusy !== null}
                >
                  {checkoutBusy === plan.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  {canShowPaymentFlows ? `Choose ${plan.name}` : "Subscribe on the web"}
                </Button>
              ) : isLifetime ? (
                <Button variant="outline" size="sm" disabled className="w-full">
                  <Lock className="mr-1 h-3 w-3" /> Locked
                </Button>
              ) : isCurrent ? (
                <Button variant="outline" size="sm" disabled className="w-full">
                  Current plan
                </Button>
              ) : !canChangePlan && subscription?.payment_failed ? (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => void openPortal()}
                  disabled={checkoutBusy !== null}
                >
                  {checkoutBusy === "portal" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Update payment method
                </Button>
              ) : !canChangePlan ? (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => void subscribe(plan)}
                  disabled={checkoutBusy !== null}
                >
                  {checkoutBusy === plan.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  {canShowPaymentFlows ? `Choose ${plan.name}` : "Subscribe on the web"}
                </Button>
              ) : isPendingTarget ? (
                <Button variant="outline" size="sm" disabled className="w-full">
                  Pending downgrade
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant={isUpgrade ? "default" : "outline"}
                  className="w-full"
                  onClick={() => action(plan)}
                  disabled={hasScheduledDowngrade && !isUpgrade}
                >
                  {isUpgrade ? `Upgrade to ${plan.name}` : `Downgrade to ${plan.name}`}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {!isLifetime && !canChangePlan && (
        <p className="mt-3 text-xs text-muted-foreground">
          {subscription?.payment_failed
            ? "The last payment failed. Update payment method opens Stripe's billing portal."
            : isActiveOrgTrial(subscription)
              ? "Your trial is active. Choosing a plan opens Stripe Checkout when you want to upgrade. The card is entered on Stripe, and your trial stays in place until that checkout finishes."
              : canShowPaymentFlows
                ? "There is no card on file, so these open Stripe Checkout. The card is entered on Stripe, not in this screen."
                : "Subscriptions are managed at jointidywise.com. This app cannot take a card."}
        </p>
      )}

      <UpgradePlanDialog
        open={!!upgradeTarget}
        onOpenChange={(o) => !o && setUpgradeTarget(null)}
        targetPlan={upgradeTarget}
        onCompleted={async () => {
          await checkSubscription();
          await refreshDowngrade();
        }}
      />
      <DowngradePlanDialog
        open={!!downgradeTarget}
        onOpenChange={(o) => !o && setDowngradeTarget(null)}
        targetPlan={downgradeTarget}
        currentPlan={currentPlan}
        periodEnd={subscription?.subscription_end ?? null}
        onCompleted={async () => {
          await checkSubscription();
          await refreshDowngrade();
        }}
      />
    </Card>
  );
}

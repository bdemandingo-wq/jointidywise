import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, PauseCircle, PlayCircle, CreditCard } from "lucide-react";
import CancellationFlowDialog from "@/components/subscription/CancellationFlowDialog";
import { LoyaltyPriceSummary } from "@/components/subscription/LoyaltyPriceSummary";
import { useLoyaltyPricing } from "@/hooks/useLoyaltyPricing";
import { cancelLoyaltyWarning } from "../../../supabase/functions/_shared/loyalty-pricing";
import { PlanSwitcher } from "@/components/subscription/PlanSwitcher";
import { RedeemAccessCodeCard } from "@/components/subscription/RedeemAccessCodeCard";
import { StripeModeBadge } from "@/components/subscription/StripeModeBadge";
import { readEdgeFunctionError, readEdgeFunctionErrorBody } from "@/lib/edgeFunctionError";
import { billingNextStep, hasChangeableStripeSubscription, isActiveOrgTrial } from "@/lib/stripeMode";

export function SubscriptionPanel() {
  const { subscription, checkSubscription } = useAuth();
  const { organization } = useOrganization();
  const navigate = useNavigate();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [paused, setPaused] = useState(false);
  const nextStep = billingNextStep(subscription);
  const loyalty = useLoyaltyPricing();
  const loyaltyWarning = loyalty.quote ? cancelLoyaltyWarning(loyalty.quote) : null;

  const isSubscribed = subscription?.subscribed === true;
  const periodEnd = subscription?.subscription_end ?? null;
  const onTrial = isActiveOrgTrial(subscription) || subscription?.trial_active === true;
  const realStripe = hasChangeableStripeSubscription(subscription);
  const showResume = !onTrial && paused;
  const showPauseOrCancel = !onTrial && realStripe && !paused;

  useEffect(() => {
    if (!organization?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("subscription_pauses")
        .select("id")
        .eq("organization_id", organization.id)
        .eq("status", "active")
        .limit(1);
      if (cancelled) return;
      if (error) {
        console.warn("[subscription] pause lookup failed", error);
        return;
      }
      setPaused((data?.length ?? 0) > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [organization?.id]);

  async function resumeEarly() {
    setResuming(true);
    try {
      const { data, error } = await supabase.functions.invoke("resume-subscription", {
        body: organization?.id ? { organization_id: organization.id } : {},
      });
      if (error) throw new Error(await readEdgeFunctionError(error, "Could not resume subscription"));
      if ((data as { error?: string } | null)?.error) throw new Error((data as { error?: string }).error);
      toast.success("Subscription resumed.");
      setPaused(false);
      await checkSubscription();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not resume subscription";
      toast.error(message);
    } finally {
      setResuming(false);
    }
  }

  async function openBillingPortal() {
    setOpeningPortal(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal", {
        body: organization?.id ? { organization_id: organization.id } : {},
      });
      if (error) {
        const body = await readEdgeFunctionErrorBody(error);
        if (body?.code === "no_customer") {
          toast.error(
            typeof body.error === "string"
              ? body.error
              : "No card on file yet. Choose a plan to add one at checkout.",
          );
          navigate("/dashboard/settings?tab=subscription");
          return;
        }
        throw new Error(await readEdgeFunctionError(error, "Could not open the billing portal."));
      }
      const url = (data as { url?: string; error?: string } | null)?.url;
      if (!url) throw new Error((data as { error?: string } | null)?.error || "Could not open the billing portal.");

      const { Capacitor } = await import("@capacitor/core");
      if (Capacitor.isNativePlatform()) {
        const { Browser } = await import("@capacitor/browser");
        await Browser.open({ url, presentationStyle: "popover" });
      } else {
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (!opened) window.location.href = url;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not open billing portal";
      toast.error(message);
    } finally {
      setOpeningPortal(false);
    }
  }

  return (
    <>
      <div className="mx-auto max-w-2xl space-y-4">
        <StripeModeBadge />
        <PlanSwitcher />
        <RedeemAccessCodeCard />

        <Card>
          <CardHeader>
            <CardTitle>TidyWise CRM</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isSubscribed ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {nextStep === "checkout" && onTrial
                    ? "Your trial is active. Choose a plan when you want to add a card. Checkout is optional, and nothing is charged until you finish it."
                    : nextStep === "checkout"
                      ? "This account does not have a card on file yet. Choose a plan to open Stripe Checkout."
                      : paused
                        ? "Your subscription is paused."
                        : "Your subscription is active."}
                  {periodEnd && !onTrial && (
                    <>
                      {" "}Next billing date:{" "}
                      <span className="font-medium text-foreground">
                        {/* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant */}
                        {new Date(periodEnd).toLocaleDateString()}
                      </span>
                      .
                    </>
                  )}
                </p>

                <LoyaltyPriceSummary state={loyalty} />

                <div className="flex flex-wrap gap-2">
                  {showResume && (
                    <Button
                      variant="outline"
                      onClick={resumeEarly}
                      disabled={resuming}
                    >
                      {resuming ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <PlayCircle className="mr-1 h-4 w-4" />
                      )}
                      Resume now
                    </Button>
                  )}
                  {nextStep === "portal" && !onTrial ? (
                    <Button
                      variant="outline"
                      onClick={openBillingPortal}
                      disabled={openingPortal}
                    >
                      {openingPortal ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <CreditCard className="mr-1 h-4 w-4" />
                      )}
                      Update payment method
                    </Button>
                  ) : nextStep === "checkout" ? (
                    <Button variant="premium" onClick={() => navigate("/choose-plan?upgrade=1")}>
                      <CreditCard className="mr-1 h-4 w-4" />
                      Choose a plan
                    </Button>
                  ) : null}
                  {showPauseOrCancel && (
                    <Button
                      variant="ghost"
                      onClick={() => setCancelOpen(true)}
                      className="text-muted-foreground"
                    >
                      <PauseCircle className="mr-1 h-4 w-4" />
                      Pause or cancel
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-4 text-center">
                <p className="text-sm text-muted-foreground">
                  {nextStep === "portal"
                    ? "A payment failed or the card on file needs an update. This opens Stripe's billing portal."
                    : nextStep === "lifetime"
                      ? "Lifetime access does not have a payment method to update."
                      : nextStep === "comped"
                        ? "This account's access is comped. There is no card on file to update."
                        : "There is no card on file yet. Choose a plan and Stripe Checkout will collect it. Nothing is charged until you finish that page."}
                </p>
                {nextStep === "portal" ? (
                  <Button onClick={openBillingPortal} disabled={openingPortal}>
                    {openingPortal ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <CreditCard className="mr-1 h-4 w-4" />
                    )}
                    Update payment method
                  </Button>
                ) : nextStep === "checkout" ? (
                  <Button variant="premium" onClick={() => navigate("/choose-plan?upgrade=1")}>
                    <CreditCard className="mr-1 h-4 w-4" />
                    Choose a plan
                  </Button>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <CancellationFlowDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        periodEndDate={periodEnd}
        loyaltyWarning={loyaltyWarning}
        onCancelled={() => checkSubscription()}
        onPaused={() => {
          setPaused(true);
          checkSubscription();
        }}
        onSaved={() => checkSubscription()}
      />
    </>
  );
}

export default function SubscriptionPage() {
  return (
    <AdminLayout title="Subscription" subtitle="Your TidyWise plan">
      <div className="portal-v2 portal-v2-scroll">
        <SEOHead title="Subscription | TidyWise" description="TidyWise subscription" noIndex />
        <SubscriptionPanel />
      </div>
    </AdminLayout>
  );
}

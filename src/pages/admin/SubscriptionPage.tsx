import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, PauseCircle, PlayCircle, CreditCard } from "lucide-react";
import CancellationFlowDialog from "@/components/subscription/CancellationFlowDialog";
import { PlanSwitcher } from "@/components/subscription/PlanSwitcher";
import { RedeemAccessCodeCard } from "@/components/subscription/RedeemAccessCodeCard";
import { StripeModeBadge } from "@/components/subscription/StripeModeBadge";
import { readEdgeFunctionError, readEdgeFunctionErrorBody } from "@/lib/edgeFunctionError";
import { billingNextStep, isActiveOrgTrial } from "@/lib/stripeMode";

export default function SubscriptionPage() {
  const { subscription, checkSubscription } = useAuth();
  const navigate = useNavigate();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const nextStep = billingNextStep(subscription);


  const isSubscribed = subscription?.subscribed === true;
  const periodEnd = subscription?.subscription_end ?? null;

  async function resumeEarly() {
    setResuming(true);
    try {
      const { data, error } = await supabase.functions.invoke("resume-subscription", {
        body: {},
      });
      if (error) throw new Error(await readEdgeFunctionError(error, "Could not resume subscription"));
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Subscription resumed.");
      await checkSubscription();
    } catch (err: any) {
      toast.error(err?.message || "Could not resume subscription");
    } finally {
      setResuming(false);
    }
  }

  async function openBillingPortal() {
    setOpeningPortal(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal", { body: {} });
      if (error) {
        const body = await readEdgeFunctionErrorBody(error);
        if (body?.code === "no_customer") {
          toast.error(
            typeof body.error === "string"
              ? body.error
              : "No card on file yet. Choose a plan to add one at checkout.",
          );
          navigate("/choose-plan?upgrade=1");
          return;
        }
        throw new Error(await readEdgeFunctionError(error, "Could not open the billing portal."));
      }
      const url = (data as { url?: string; error?: string } | null)?.url;
      if (!url) throw new Error((data as { error?: string } | null)?.error || "Could not open the billing portal.");

      // Use Capacitor Browser on native (iOS blocks window.open), fallback to window.open on web
      const { Capacitor } = await import("@capacitor/core");
      if (Capacitor.isNativePlatform()) {
        const { Browser } = await import("@capacitor/browser");
        await Browser.open({ url, presentationStyle: "popover" });
      } else {
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (!opened) window.location.href = url;
      }
    } catch (err: any) {
      toast.error(err?.message || "Could not open billing portal");
    } finally {
      setOpeningPortal(false);
    }
  }


  return (
    <AdminLayout title="Subscription" subtitle="Your TidyWise plan">
<div className="portal-v2 portal-v2-scroll">
      <SEOHead title="Subscription | TidyWise" description="TidyWise subscription" noIndex />

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
                  {nextStep === "checkout" && isActiveOrgTrial(subscription)
                    ? "Your trial is active. Choose a plan when you want to add a card. Checkout is optional, and nothing is charged until you finish it."
                    : nextStep === "checkout"
                      ? "This account does not have a card on file yet. Choose a plan to open Stripe Checkout."
                      : "Your subscription is active."}
                  {periodEnd && (
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

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={resumeEarly}
                    disabled={resuming}
                    title="Resume early if you previously paused"
                  >
                    {resuming ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <PlayCircle className="mr-1 h-4 w-4" />
                    )}
                    Resume now
                  </Button>
                  {nextStep === "portal" ? (
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
                    <Button variant="outline" onClick={() => navigate("/choose-plan?upgrade=1")}>
                      <CreditCard className="mr-1 h-4 w-4" />
                      Choose a plan
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    onClick={() => setCancelOpen(true)}
                    className="text-muted-foreground"
                  >
                    <PauseCircle className="mr-1 h-4 w-4" />
                    Pause or cancel
                  </Button>
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
                  <Button onClick={() => navigate("/choose-plan?upgrade=1")}>
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
        onCancelled={() => checkSubscription()}
        onPaused={() => checkSubscription()}
        onSaved={() => checkSubscription()}
      />
    </div>
</AdminLayout>
  );
}

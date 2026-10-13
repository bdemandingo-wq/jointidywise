/**
 * Multi-step cancellation + retention flow for the TidyWise CRM subscription.
 *
 * Step 1 — "Why are you leaving?" reason picker (+ conditional follow-ups)
 * Step 2 — Pause for 1/2/3 months (offered to everyone)
 * Step 2b — Win-back offer (only when reason = too_expensive, only ever shown once)
 * Step 3 — Final confirm
 *
 * Cancellations are always period-end (handled server-side in self-cancel-subscription).
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, PauseCircle, Sparkles } from "lucide-react";

type Reason =
  | "not_enough_jobs"
  | "going_manual"
  | "switching_crm"
  | "too_expensive"
  | "too_complicated"
  | "missing_feature"
  | "booking_didnt_work"
  | "payments_didnt_work"
  | "just_testing"
  | "pausing_slow_season"
  | "other";

const REASONS: { value: Reason; label: string }[] = [
  { value: "not_enough_jobs", label: "Not enough cleaning jobs / business slowed down" },
  { value: "going_manual", label: "Going back to managing manually (pen & paper / spreadsheets)" },
  { value: "switching_crm", label: "Switching to another cleaning CRM (Jobber, Housecall Pro, ZenMaid, etc.)" },
  { value: "too_expensive", label: "Too expensive for my current number of clients/cleaners" },
  { value: "too_complicated", label: "Too complicated. My team or cleaners couldn't get the hang of it." },
  { value: "missing_feature", label: "Missing a feature I need to run my cleaning business" },
  { value: "booking_didnt_work", label: "Booking / scheduling didn't work the way I needed" },
  { value: "payments_didnt_work", label: "Payments or cleaner payouts didn't work for me" },
  { value: "just_testing", label: "Just testing it out / not ready to commit yet" },
  { value: "pausing_slow_season", label: "Pausing (slow season, plan to come back)" },
  { value: "other", label: "Other" },
];

type Step = "reason" | "pause" | "winback" | "confirm";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodEndDate: string | null;
  /** Set once a lower loyalty rate has been earned. Null at the list price. */
  loyaltyWarning?: string | null;
  onCancelled: () => void;
  onPaused: () => void;
  onSaved: () => void; // closed without canceling (kept plan / claimed offer)
}

export default function CancellationFlowDialog({
  open,
  onOpenChange,
  periodEndDate,
  loyaltyWarning,
  onCancelled,
  onPaused,
  onSaved,
}: Props) {
  const [step, setStep] = useState<Step>("reason");
  const [reason, setReason] = useState<Reason | "">("");
  const [competitor, setCompetitor] = useState("");
  const [missingFeature, setMissingFeature] = useState("");
  const [feedback, setFeedback] = useState("");
  const [keptText, setKeptText] = useState("");
  const [pauseMonths, setPauseMonths] = useState<1 | 2 | 3>(1);
  const [submitting, setSubmitting] = useState(false);
  const [winbackOffer, setWinbackOffer] = useState<{ label: string } | null>(null);
  const [winbackEligible, setWinbackEligible] = useState<boolean | null>(null);

  // Reset state when reopening
  useEffect(() => {
    if (open) {
      setStep("reason");
      setReason("");
      setCompetitor("");
      setMissingFeature("");
      setFeedback("");
      setKeptText("");
      setPauseMonths(1);
      setWinbackOffer(null);
      setWinbackEligible(null);
    }
  }, [open]);

  // Exit-survey requirements: every cancellation must tell us WHY (min 30
  // chars) and what would have kept them (min 20 chars) — this is the data
  // that drives the roadmap, so short "n/a" answers don't count.
  const FEEDBACK_MIN = 30;
  const KEPT_MIN = 20;
  const feedbackOk = feedback.trim().length >= FEEDBACK_MIN;
  const keptOk = keptText.trim().length >= KEPT_MIN;
  const canContinueFromReason = !!reason && feedbackOk && keptOk;

  function keepPlan() {
    onOpenChange(false);
    onSaved();
  }

  function goToPause() {
    setStep("pause");
  }

  async function continueToCancel() {
    // Price reason → try winback first (only once per user)
    if (reason === "too_expensive") {
      setSubmitting(true);
      try {
        const { data, error } = await supabase.functions.invoke("claim-winback-offer", {
          body: { action: "show" },
        });
        if (error) throw error;
        if ((data as any)?.eligible && (data as any)?.offer) {
          setWinbackOffer({ label: (data as any).offer.label });
          setWinbackEligible(true);
          setStep("winback");
          return;
        }
        setWinbackEligible(false);
      } catch (err: any) {
        // If the offer call fails, don't block cancellation
        console.error(err);
      } finally {
        setSubmitting(false);
      }
    }
    setStep("confirm");
  }

  async function claimOffer() {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("claim-winback-offer", {
        body: { action: "claim" },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`You're staying! Offer applied: ${winbackOffer?.label ?? "discount"}.`);
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      toast.error(err?.message || "Could not apply offer");
    } finally {
      setSubmitting(false);
    }
  }

  async function declineOffer() {
    setSubmitting(true);
    try {
      await supabase.functions.invoke("claim-winback-offer", {
        body: { action: "decline" },
      });
    } finally {
      setSubmitting(false);
      setStep("confirm");
    }
  }

  async function pauseNow() {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("pause-subscription", {
        body: { months: pauseMonths },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Subscription paused for ${pauseMonths} month${pauseMonths > 1 ? "s" : ""}.`);
      onOpenChange(false);
      onPaused();
    } catch (err: any) {
      toast.error(err?.message || "Could not pause subscription");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmCancel() {
    if (!reason) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("self-cancel-subscription", {
        body: {
          reason,
          competitor_name: competitor || undefined,
          missing_feature: missingFeature || undefined,
          feedback_text: feedback || undefined,
          kept_text: keptText || undefined,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Subscription will end at the end of the current billing period.");
      onOpenChange(false);
      onCancelled();
    } catch (err: any) {
      toast.error(err?.message || "Could not cancel subscription");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {loyaltyWarning ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-foreground">
            {loyaltyWarning}
          </p>
        ) : null}
        {step === "reason" && (
          <>
            <DialogHeader>
              <DialogTitle>Why are you leaving TidyWise?</DialogTitle>
              <DialogDescription>
                Your feedback helps us build a better CRM for cleaning businesses.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Main reason</Label>
                <Select value={reason} onValueChange={(v) => setReason(v as Reason)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a reason" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {reason === "switching_crm" && (
                <div className="space-y-2">
                  <Label>Which one? (optional)</Label>
                  <Input
                    value={competitor}
                    onChange={(e) => setCompetitor(e.target.value)}
                    placeholder="e.g. Jobber, Housecall Pro, ZenMaid"
                  />
                </div>
              )}

              {reason === "missing_feature" && (
                <div className="space-y-2">
                  <Label>Which feature? (optional)</Label>
                  <Input
                    value={missingFeature}
                    onChange={(e) => setMissingFeature(e.target.value)}
                    placeholder="e.g. recurring discounts, route optimization…"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>
                  Why are you cancelling? Tell us what happened
                  <span className="text-destructive"> *</span>
                </Label>
                <Textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Be honest: what wasn't working, what frustrated you, what pushed you to cancel…"
                  rows={3}
                />
                <p className={`text-xs ${feedbackOk ? "text-muted-foreground" : "text-destructive"}`}>
                  {feedbackOk
                    ? `${feedback.trim().length} characters`
                    : `${Math.max(0, FEEDBACK_MIN - feedback.trim().length)} more characters needed (min ${FEEDBACK_MIN})`}
                </p>
              </div>

              <div className="space-y-2">
                <Label>
                  What would have made you stay?
                  <span className="text-destructive"> *</span>
                </Label>
                <Textarea
                  value={keptText}
                  onChange={(e) => setKeptText(e.target.value)}
                  placeholder="A feature, a price, better support: what would've changed your mind?"
                  rows={2}
                />
                <p className={`text-xs ${keptOk ? "text-muted-foreground" : "text-destructive"}`}>
                  {keptOk
                    ? `${keptText.trim().length} characters`
                    : `${Math.max(0, KEPT_MIN - keptText.trim().length)} more characters needed (min ${KEPT_MIN})`}
                </p>
              </div>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="ghost" onClick={keepPlan}>
                Keep my plan
              </Button>
              <Button
                variant="outline"
                onClick={goToPause}
                disabled={!reason}
              >
                <PauseCircle className="mr-1 h-4 w-4" />
                Pause instead
              </Button>
              <Button
                onClick={continueToCancel}
                disabled={!canContinueFromReason || submitting}
              >
                {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Continue to cancel
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "pause" && (
          <>
            <DialogHeader>
              <DialogTitle>Pause instead of cancel</DialogTitle>
              <DialogDescription>
                Pause your subscription for 1, 2, or 3 months. No charges during the pause —
                your bookings, clients, payments, and cleaners stay safe, and your plan
                resumes automatically.
              </DialogDescription>
            </DialogHeader>
            <RadioGroup
              value={String(pauseMonths)}
              onValueChange={(v) => setPauseMonths(Number(v) as 1 | 2 | 3)}
              className="grid grid-cols-3 gap-2"
            >
              {[1, 2, 3].map((m) => (
                <label
                  key={m}
                  className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-border p-3 hover:bg-accent"
                >
                  <RadioGroupItem value={String(m)} />
                  <span className="text-sm font-medium">
                    {m} month{m > 1 ? "s" : ""}
                  </span>
                </label>
              ))}
            </RadioGroup>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="ghost" onClick={() => setStep("reason")}>
                Back
              </Button>
              <Button onClick={pauseNow} disabled={submitting}>
                {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Pause for {pauseMonths} month{pauseMonths > 1 ? "s" : ""}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "winback" && winbackOffer && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Stay with TidyWise — {winbackOffer.label}
              </DialogTitle>
              <DialogDescription>
                We&apos;d hate to see you go because of price. Claim this one-time offer
                and keep everything you&apos;ve built — bookings, clients, payouts,
                everything stays in place.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={declineOffer} disabled={submitting}>
                No thanks, cancel
              </Button>
              <Button onClick={claimOffer} disabled={submitting}>
                {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Claim offer &amp; stay
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "confirm" && (
          <>
            <DialogHeader>
              <DialogTitle>Confirm cancellation</DialogTitle>
              <DialogDescription>
                Your subscription will remain active until{" "}
                <span className="font-medium text-foreground">
                  {periodEndDate
                    /* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant (billing/subscription/audit date), not a business-day boundary; see src/lib/orgDateRange.ts */
                    ? new Date(periodEndDate).toLocaleDateString()
                    : "the end of your current billing period"}
                </span>
                . After that, your TidyWise CRM access will end. Your bookings, clients,
                payment history, and cleaner data are retained in case you come back.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="ghost" onClick={keepPlan}>
                Keep my plan
              </Button>
              <Button
                variant="destructive"
                onClick={confirmCancel}
                disabled={submitting}
              >
                {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Cancel subscription
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

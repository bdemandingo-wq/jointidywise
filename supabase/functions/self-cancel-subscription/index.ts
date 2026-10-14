import { createStripeClient } from "../_shared/stripe-client.ts";
// Self-serve cancellation for a TidyWise CRM (platform SaaS) subscription.
// - Sets cancel_at_period_end = true on the user's Stripe subscription.
// - Writes a cancellation_feedback row capturing the reason.
// - Does NOT touch Stripe Connect (cleaner-payout) flow — uses the billing account key only.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { authenticateUser } from "../_shared/auth-org.ts";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_REASONS = new Set([
  "not_enough_jobs",
  "going_manual",
  "switching_crm",
  "too_expensive",
  "too_complicated",
  "missing_feature",
  "booking_didnt_work",
  "payments_didnt_work",
  "just_testing",
  "pausing_slow_season",
  "other",
]);

const log = (step: string, details?: unknown) => {
  console.log(`[SELF-CANCEL-SUB] ${step}${details ? " - " + JSON.stringify(details) : ""}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await authenticateUser(req);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error }), {
        status: auth.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { supabase, userId, userEmail, organizationId } = auth.ctx;

    const body = await req.json().catch(() => ({}));
    const {
      reason,
      competitor_name,
      missing_feature,
      feedback_text,
      kept_text,
    } = body as {
      reason?: string;
      competitor_name?: string;
      missing_feature?: string;
      feedback_text?: string;
      kept_text?: string;
    };

    if (!reason || !ALLOWED_REASONS.has(reason)) {
      return new Response(JSON.stringify({ error: "Invalid cancellation reason" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Reasons that require free-text feedback
    const requiresFeedback =
      reason === "other" || reason === "switching_crm" || reason === "missing_feature";
    if (requiresFeedback && !feedback_text?.trim()) {
      return new Response(
        JSON.stringify({ error: "Feedback text is required for this reason" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const stripeKey = billingSecretKey();
    if (!stripeKey) throw new Error("STRIPE_BILLING_SECRET_KEY is not set");
    const stripe = await createStripeClient(stripeKey, { organizationId: organizationId, apiVersion: "2025-08-27.basil" });

    // Find the platform customer + subscription for this user (by email)
    const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
    if (customers.data.length === 0) {
      return new Response(JSON.stringify({ error: "No subscription found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const customerId = customers.data[0].id;

    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
    });
    const active = subs.data.find((s) =>
      ["active", "trialing", "past_due"].includes(s.status),
    );
    if (!active) {
      return new Response(JSON.stringify({ error: "No active subscription to cancel" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency: if the user already cancelled (cancel_at_period_end
    // is set), short-circuit and return success without writing another
    // cancellation_feedback row. The cancel button on the dashboard is
    // not disabled aggressively, so double-clicks and the resubmit-on-
    // back-button case were inserting duplicate rows and skewing churn
    // counts in cancellation-analytics.
    if (active.cancel_at_period_end) {
      const existingPeriodEnd =
        active.items.data[0]?.current_period_end ?? (active as any).current_period_end;
      return new Response(
        JSON.stringify({
          success: true,
          subscription_id: active.id,
          cancel_at_period_end: true,
          period_end: existingPeriodEnd
            ? new Date(existingPeriodEnd * 1000).toISOString()
            : null,
          already_cancelled: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Period-end cancellation — never instant.
    const result = await stripe.subscriptions.update(active.id, {
      cancel_at_period_end: true,
      cancellation_details: { comment: feedback_text?.slice(0, 480) ?? undefined },
    });
    log("Cancelled at period end", { sub: active.id, by: userEmail });

    // Stripe Basil moved current_period_end onto subscription.items.data[i].
    // The top-level field still works for single-item subs today but goes
    // null the moment a second item is added. Prefer the item-level value
    // and fall back to the legacy top-level for resilience.
    const periodEndSec =
      result.items.data[0]?.current_period_end ?? (result as any).current_period_end;
    const periodEnd = periodEndSec
      ? new Date(periodEndSec * 1000).toISOString()
      : null;

    // Save feedback (RLS allows the user to insert their own row)
    const { error: insertError } = await supabase.from("cancellation_feedback").insert({
      organization_id: organizationId,
      user_id: userId,
      user_email: userEmail,
      stripe_customer_id: customerId,
      stripe_subscription_id: active.id,
      reason,
      competitor_name: competitor_name?.slice(0, 200) || null,
      missing_feature: missing_feature?.slice(0, 200) || null,
      feedback_text: feedback_text?.slice(0, 2000) || null,
      kept_text: kept_text?.slice(0, 2000) || null,
      plan: active.items.data[0]?.price?.id || null,
      period_end_date: periodEnd,
      eligible_for_winback: true,
    });
    if (insertError) {
      log("WARN: failed to write feedback", insertError.message);
    }

    // Fire-and-forget cancellation notifications (email + SMS to user,
    // alert to platform admin). Failures are non-fatal — the cancellation
    // itself already succeeded by this point; just log and move on.
    try {
      let orgName: string | null = null;
      if (organizationId) {
        const { data: orgRow } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", organizationId)
          .maybeSingle();
        orgName = orgRow?.name ?? null;
      }
      await supabase.functions.invoke("notify-tidywise-cancellation", {
        body: {
          user_id: userId,
          user_email: userEmail,
          reason,
          feedback_text: feedback_text?.slice(0, 2000) || null,
          kept_text: kept_text?.slice(0, 2000) || null,
          competitor_name: competitor_name?.slice(0, 200) || null,
          missing_feature: missing_feature?.slice(0, 200) || null,
          period_end_date: periodEnd,
          plan: active.items.data[0]?.price?.id || null,
          organization_id: organizationId,
          organization_name: orgName,
          triggered_by: "self",
        },
      });
    } catch (notifyErr) {
      log("WARN: notification dispatch failed", String(notifyErr));
    }

    return new Response(
      JSON.stringify({
        success: true,
        subscription_id: result.id,
        cancel_at_period_end: true,
        period_end: periodEnd,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("ERROR", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

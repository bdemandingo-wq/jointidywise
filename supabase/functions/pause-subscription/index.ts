// Pause the user's TidyWise CRM (platform) subscription for 1/2/3 months
// via Stripe pause_collection with a resumes_at. Does not cancel.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { authenticateUser } from "../_shared/auth-org.ts";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const log = (s: string, d?: unknown) =>
  console.log(`[PAUSE-SUB] ${s}${d ? " - " + JSON.stringify(d) : ""}`);

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
    const months = Number(body?.months);
    if (![1, 2, 3].includes(months)) {
      return new Response(JSON.stringify({ error: "months must be 1, 2, or 3" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripeKey = billingSecretKey();
    if (!stripeKey) throw new Error("STRIPE_BILLING_SECRET_KEY is not set");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

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
      return new Response(JSON.stringify({ error: "No active subscription to pause" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Refuse to pause an already-paused subscription. Without this guard
    // a second call would push resumes_at further into the future and
    // insert a second subscription_pauses row, skewing churn analytics
    // and confusing the resume flow about which row to mark resumed.
    if ((active as any).pause_collection != null) {
      return new Response(
        JSON.stringify({ error: "Subscription is already paused" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const resumeDate = new Date();
    resumeDate.setMonth(resumeDate.getMonth() + months);
    const resumesAtSec = Math.floor(resumeDate.getTime() / 1000);

    const updated = await stripe.subscriptions.update(active.id, {
      pause_collection: { behavior: "void", resumes_at: resumesAtSec },
    });
    log("Paused", { sub: active.id, months, resumes_at: resumesAtSec });

    // Stripe already paused billing above — don't report failure to the
    // customer for a purely local mirroring issue, but a missing row
    // here breaks the resume flow (nothing to mark "resumed") and any
    // UI/analytics that depend on subscription_pauses to know this
    // customer is currently paused.
    let pauseRowCreated = false;
    let lastPauseInsertErr: string | undefined;
    for (let attempt = 1; attempt <= 2 && !pauseRowCreated; attempt++) {
      const { error: pauseInsertErr } = await supabase.from("subscription_pauses").insert({
        organization_id: organizationId,
        user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: active.id,
        resume_date: resumeDate.toISOString(),
        pause_months: months,
        status: "active",
      });
      if (!pauseInsertErr) {
        pauseRowCreated = true;
      } else {
        lastPauseInsertErr = pauseInsertErr.message;
        console.error(`[PAUSE-SUB] subscription_pauses insert failed (attempt ${attempt}/2):`, pauseInsertErr);
      }
    }
    if (!pauseRowCreated) {
      console.error(
        `[PAUSE-SUB] CRITICAL: Stripe subscription ${active.id} paused (resumes ${resumeDate.toISOString()}) but no ` +
        `subscription_pauses row was created for user ${userId} after 2 attempts (${lastPauseInsertErr}) — ` +
        `resume flow and pause-state UI won't know about this pause until manually reconciled.`,
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        subscription_id: updated.id,
        resume_date: resumeDate.toISOString(),
        pause_months: months,
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

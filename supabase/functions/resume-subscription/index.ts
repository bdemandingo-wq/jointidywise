import { createStripeClient } from "../_shared/stripe-client.ts";
// Resume a paused TidyWise CRM (platform) subscription early.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { authenticateUser } from "../_shared/auth-org.ts";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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
    const { supabase, userId, userEmail } = auth.ctx;

    const stripeKey = billingSecretKey();
    if (!stripeKey) throw new Error("STRIPE_BILLING_SECRET_KEY is not set");
    const stripe = await createStripeClient(stripeKey, { apiVersion: "2025-08-27.basil" });

    const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
    if (customers.data.length === 0) {
      return new Response(JSON.stringify({ error: "No subscription found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const subs = await stripe.subscriptions.list({
      customer: customers.data[0].id,
      status: "all",
      limit: 10,
    });
    const paused = subs.data.find((s) => (s as any).pause_collection != null);
    if (!paused) {
      return new Response(JSON.stringify({ error: "No paused subscription" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stripe rejects "" for pause_collection — only null clears the pause.
    // Passing "" returned a 400 for every user clicking "Resume now",
    // leaving them stuck in the paused state until pause_collection.resumes_at.
    const updated = await stripe.subscriptions.update(paused.id, {
      pause_collection: null,
    });

    // Mark the active pause row as resumed. Stripe already resumed
    // billing above — don't report failure to the customer for a purely
    // local mirroring issue, but don't let it go unnoticed either: a
    // stuck "active" pause row could make the app keep showing a
    // "paused" state to a customer who's actually being billed again.
    let pauseRowUpdated = false;
    let lastPauseUpdateErr: string | undefined;
    for (let attempt = 1; attempt <= 2 && !pauseRowUpdated; attempt++) {
      const { error: pauseUpdateErr } = await supabase
        .from("subscription_pauses")
        .update({ status: "resumed", resumed_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("stripe_subscription_id", paused.id)
        .eq("status", "active");
      if (!pauseUpdateErr) {
        pauseRowUpdated = true;
      } else {
        lastPauseUpdateErr = pauseUpdateErr.message;
        console.error(`[RESUME-SUB] subscription_pauses update failed (attempt ${attempt}/2):`, pauseUpdateErr);
      }
    }
    if (!pauseRowUpdated) {
      console.error(
        `[RESUME-SUB] CRITICAL: Stripe subscription ${paused.id} resumed but subscription_pauses row for ` +
        `user ${userId} still shows status='active' after 2 attempts (${lastPauseUpdateErr}) — needs manual reconciliation.`,
      );
    }

    return new Response(
      JSON.stringify({ success: true, subscription_id: updated.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log("[RESUME-SUB] ERROR", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

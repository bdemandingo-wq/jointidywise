// Stripe webhook for AI credit purchases (PLATFORM account, not Connect).
// On `checkout.session.completed` with metadata.purpose === 'ai_credits_topup',
// credits the ai_credit_ledger via the idempotent credit_ai_purchase RPC.
//
// IMPORTANT: verify_jwt=false (Stripe doesn't send a JWT). Signature is
// verified using STRIPE_AI_CREDITS_WEBHOOK_SECRET. The API client is the
// billing account (STRIPE_BILLING_SECRET_KEY). STRIPE_SECRET_KEY is used only
// while STRIPE_CONNECT_PLATFORM_SWITCHED is off.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const stripeKey = billingSecretKey();
  const webhookSecret = Deno.env.get("STRIPE_AI_CREDITS_WEBHOOK_SECRET");
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!stripeKey || !webhookSecret || !supaUrl || !serviceKey) {
    console.error("[ai-credits-webhook] missing required secrets");
    return new Response("Server misconfigured", { status: 500, headers: corsHeaders });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature", { status: 400, headers: corsHeaders });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ai-credits-webhook] signature verification failed:", msg);
    return new Response(`Webhook Error: ${msg}`, { status: 400, headers: corsHeaders });
  }

  // Only process checkout completions for our credit-purchase flow.
  // Ignore everything else so this endpoint can safely share a webhook with other flows.
  if (event.type !== "checkout.session.completed") {
    return new Response(JSON.stringify({ received: true, ignored: event.type }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const purpose = session.metadata?.purpose;
  if (purpose !== "ai_credits_topup") {
    return new Response(JSON.stringify({ received: true, ignored: "not_ai_credits_topup" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const organizationId = session.metadata?.organization_id;
  const credits = parseInt(session.metadata?.credits || "0", 10);

  if (!organizationId || !credits || credits <= 0) {
    console.error("[ai-credits-webhook] invalid metadata", session.metadata);
    return new Response(JSON.stringify({ error: "invalid metadata" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (session.payment_status !== "paid") {
    console.log(`[ai-credits-webhook] session ${session.id} not paid (status=${session.payment_status}), skipping`);
    return new Response(JSON.stringify({ received: true, skipped: "unpaid" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const admin = createClient(supaUrl, serviceKey);
  const { data, error } = await admin.rpc("credit_ai_purchase", {
    _org_id: organizationId,
    _amount: credits,
    _stripe_session_id: session.id,
    _reason: "stripe_purchase",
  });

  if (error) {
    console.error("[ai-credits-webhook] credit_ai_purchase failed:", error.message);
    return new Response(JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const row = Array.isArray(data) ? data[0] : data;
  console.log(`[ai-credits-webhook] org=${organizationId} credits=+${credits} session=${session.id} alreadyProcessed=${row?.already_processed} newBalance=${row?.new_balance}`);

  return new Response(JSON.stringify({ received: true, ...row }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

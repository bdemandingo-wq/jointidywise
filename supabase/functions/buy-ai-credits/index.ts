import { createStripeClient } from "../_shared/stripe-client.ts";
// Creates a Stripe Checkout session for a $10 / 500-credit AI-credit top-up.
// Charges the PLATFORM Stripe account (TidyWise), not the per-org Connect
// account — orgs are buying a TidyWise product.
//
// Body: { organizationId: string }
// Auth: caller must be a member of that organization.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CREDITS_PER_PACK = 500;
const PRICE_CENTS = 1000; // $10.00

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = billingSecretKey();
    if (!stripeKey) throw new Error("STRIPE_BILLING_SECRET_KEY is not set");

    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userClient = createClient(supaUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user?.email) {
      return new Response(JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const user = userData.user;

    const { organizationId } = await req.json();
    if (!organizationId) {
      return new Response(JSON.stringify({ error: "organizationId required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Verify org membership
    const admin = createClient(supaUrl, serviceKey);
    const { data: membership } = await admin
      .from("org_memberships")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ error: "Forbidden — not a member of this organization" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const stripe = await createStripeClient(stripeKey, { organizationId: organizationId, apiVersion: "2025-08-27.basil" });

    // Reuse an existing platform Stripe customer for this email, if any.
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = customers.data[0]?.id;

    const origin = req.headers.get("origin") || "https://app.tidywise.com";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      mode: "payment",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: PRICE_CENTS,
          product_data: {
            name: `${CREDITS_PER_PACK} AI Credits`,
            description: `Adds ${CREDITS_PER_PACK} AI credits to your TidyWise organization. Credits never expire.`,
          },
        },
      }],
      metadata: {
        purpose: "ai_credits_topup",
        organization_id: organizationId,
        credits: String(CREDITS_PER_PACK),
        purchaser_user_id: user.id,
      },
      payment_intent_data: {
        metadata: {
          purpose: "ai_credits_topup",
          organization_id: organizationId,
          credits: String(CREDITS_PER_PACK),
        },
      },
      success_url: `${origin}/admin/ai-intelligence?credits=success`,
      cancel_url: `${origin}/admin/ai-intelligence?credits=cancel`,
    });

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[buy-ai-credits] error:", message);
    return new Response(JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

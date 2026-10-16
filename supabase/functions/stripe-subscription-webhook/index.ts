// Stripe subscription webhook — keeps organizations.plan_tier in sync.
// Listens for customer.subscription.created / updated / deleted, resolves the
// customer email -> owner user -> organization, and updates plan_tier based on
// the active subscription's price id. Cancelled/deleted -> 'trial' (unless the
// org is lifetime/grandfathered).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { subscriptionToPlanTier, updateOrgPlanTier } from "../_shared/plan-tier.ts";
import { platformAdminPhones } from "../_shared/platform-admin-phones.ts";
import { syncLoyaltySubscription } from "../_shared/loyalty-pricing-sync.ts";
import { billingSecretKey } from "../_shared/billing-stripe.ts";
import {
  handleSubscriptionWebhookEvent,
  subscriptionWebhookCorsHeaders,
} from "../_shared/subscription-webhook-event.ts";

const corsHeaders = subscriptionWebhookCorsHeaders;

const ADMIN_PHONES = platformAdminPhones();

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const stripeKey = billingSecretKey();
  const webhookSecret = Deno.env.get("STRIPE_SUBSCRIPTION_WEBHOOK_SECRET");
  if (!stripeKey || !webhookSecret) {
    return new Response(JSON.stringify({ error: "Stripe env not configured" }), { status: 500, headers: corsHeaders });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  let event: Stripe.Event;
  try {
    const sig = req.headers.get("stripe-signature");
    if (!sig) throw new Error("missing signature");
    const body = await req.text();
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (err) {
    console.log(`[STRIPE-SUB-WEBHOOK] Invalid signature - ${JSON.stringify({ message: (err as Error).message })}`);
    return new Response(JSON.stringify({ error: "invalid signature" }), { status: 400, headers: corsHeaders });
  }

  return handleSubscriptionWebhookEvent({
    event,
    stripe,
    supabase,
    subscriptionToPlanTier,
    updateOrgPlanTier,
    syncLoyaltySubscription: (db, _stripeClient, args) => syncLoyaltySubscription(
      db as unknown as Parameters<typeof syncLoyaltySubscription>[0],
      stripe,
      args,
    ),
    adminPhones: ADMIN_PHONES,
    env: (name) => Deno.env.get(name),
  });
});

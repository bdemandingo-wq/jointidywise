// Daily loyalty-price sync, also the invoice.upcoming endpoint.
//
// Attaches or replaces a forever amount-off coupon at the renewal boundary.
// subscriptions.update is called with proration_behavior "none", so Stripe
// does not collect a payment for the current period. This function never
// creates a charge, invoice, checkout session, or PaymentIntent.
//
// STRIPE_BILLING_SECRET_KEY may be live. STRIPE_SECRET_KEY is a fallback only
// until STRIPE_PLATFORM_ACCOUNT_ID is set or STRIPE_CONNECT_PLATFORM_SWITCHED
// is on. That billing key is the one
// the renewal coupon has to use. Do not point a test-card script at this function.
// Set LOYALTY_PRICING_DRY_RUN=1 to write the clock and skip the coupon update.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import { stripeKeyMode } from "../_shared/stripe-key-mode.ts";
import { syncLoyaltySubscription } from "../_shared/loyalty-pricing-sync.ts";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, stripe-signature",
};

const ACTIVE_STATUSES = ["active", "trialing", "past_due", "unpaid", "paused"];
const RANK = ["active", "past_due", "paused", "trialing", "unpaid", "canceled", "cancelled"];

function rankStatus(status: string | null): number {
  const index = RANK.indexOf(status ?? "");
  return index === -1 ? RANK.length : index;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const stripeKey = billingSecretKey();
  if (!stripeKey) {
    return new Response(JSON.stringify({ error: "STRIPE_BILLING_SECRET_KEY is not set" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const dryRun = Deno.env.get("LOYALTY_PRICING_DRY_RUN") === "1";
  console.log("[apply-loyalty-pricing] stripe mode", stripeKeyMode(stripeKey), dryRun ? "dry-run" : "apply");

  const signature = req.headers.get("stripe-signature");
  if (signature) {
    const secret = Deno.env.get("STRIPE_LOYALTY_WEBHOOK_SECRET");
    if (!secret) {
      return new Response(JSON.stringify({ error: "STRIPE_LOYALTY_WEBHOOK_SECRET is not set" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.text();
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, secret);
    } catch (err) {
      return new Response(JSON.stringify({ error: (err as Error).message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    try {
      const result = await handleEvent(supabase, stripe, event, dryRun);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("[apply-loyalty-pricing] webhook failed", (err as Error).message);
      return new Response(JSON.stringify({ error: (err as Error).message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const cronGate = requireCronSecret(req);
  if (cronGate) return cronGate;

  try {
    const result = await scan(supabase, stripe, dryRun);
    return new Response(JSON.stringify(result), {
      status: result.failed > 0 ? 500 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[apply-loyalty-pricing] scan failed", (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function handleEvent(
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe,
  event: Stripe.Event,
  dryRun: boolean,
): Promise<Record<string, unknown>> {
  const eventKey = `loyalty:${event.id}`;
  const { data: already, error: readError } = await supabase
    .from("stripe_webhook_events")
    .select("event_id")
    .eq("event_id", eventKey)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (already) return { duplicate: true, event: event.id };

  const result = await dispatchLoyaltyEvent(supabase, stripe, event, dryRun);
  const { error: insertError } = await supabase.from("stripe_webhook_events").insert({
    event_id: eventKey,
    event_type: event.type,
    source: "apply-loyalty-pricing",
  });
  if (insertError && (insertError as { code?: string }).code !== "23505") {
    throw new Error(insertError.message);
  }
  return result;
}

async function dispatchLoyaltyEvent(
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe,
  event: Stripe.Event,
  dryRun: boolean,
): Promise<Record<string, unknown>> {
  const stripeClient = stripe as unknown as Parameters<typeof syncLoyaltySubscription>[1];
  if (event.type === "invoice.upcoming") {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id;
    if (!subscriptionId) return { ignored: event.type };
    const orgId = await orgIdForSubscription(supabase, subscriptionId);
    if (!orgId) return { skipped: "no_org", subscriptionId };
    const synced = await syncLoyaltySubscription(supabase, stripeClient, {
      organizationId: orgId,
      subscriptionId,
      invoiceUpcoming: true,
      dryRun,
    });
    return { ok: true, ...synced };
  }

  if (
    event.type === "customer.subscription.created"
    || event.type === "customer.subscription.updated"
    || event.type === "customer.subscription.deleted"
  ) {
    const subscription = event.data.object as Stripe.Subscription;
    const orgId = await orgIdForSubscription(supabase, subscription.id);
    if (!orgId) return { skipped: "no_org", subscriptionId: subscription.id };
    const synced = await syncLoyaltySubscription(supabase, stripeClient, {
      organizationId: orgId,
      subscriptionId: subscription.id,
      invoiceUpcoming: false,
      dryRun,
    });
    return { ok: true, ...synced };
  }

  return { ignored: event.type };
}

async function orgIdForSubscription(
  supabase: ReturnType<typeof createClient>,
  subscriptionId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("stripe_subscriptions")
    .select("organization_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.organization_id as string | undefined) ?? null;
}

async function scan(
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe,
  dryRun: boolean,
): Promise<{ checked: number; failed: number; results: unknown[] }> {
  const { data: subs, error: subError } = await supabase
    .from("stripe_subscriptions")
    .select("organization_id, stripe_subscription_id, status")
    .in("status", ACTIVE_STATUSES);
  if (subError) throw new Error(subError.message);

  const { data: clocks, error: clockError } = await supabase
    .from("org_subscription_loyalty")
    .select("organization_id")
    .not("continuous_since", "is", null);
  if (clockError) throw new Error(clockError.message);

  const orgIds = new Set<string>();
  for (const row of subs ?? []) {
    if (row.organization_id) orgIds.add(row.organization_id as string);
  }
  for (const row of clocks ?? []) {
    if (row.organization_id) orgIds.add(row.organization_id as string);
  }

  const results: unknown[] = [];
  let failed = 0;
  for (const organizationId of orgIds) {
    try {
      const picked = await pickSubscription(supabase, organizationId);
      if (!picked) {
        results.push({ organizationId, action: "no_subscription" });
        continue;
      }
      const result = await syncLoyaltySubscription(supabase, stripe as unknown as Parameters<typeof syncLoyaltySubscription>[1], {
        organizationId,
        subscriptionId: picked,
        invoiceUpcoming: false,
        dryRun,
      });
      results.push(result);
    } catch (err) {
      failed += 1;
      console.error("[apply-loyalty-pricing] org failed", organizationId, (err as Error).message);
      results.push({ organizationId, error: (err as Error).message });
    }
  }
  return { checked: orgIds.size, failed, results };
}

async function pickSubscription(
  supabase: ReturnType<typeof createClient>,
  organizationId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("stripe_subscriptions")
    .select("stripe_subscription_id, status")
    .eq("organization_id", organizationId);
  if (error) throw new Error(error.message);
  const rows = (data ?? [])
    .filter((row) => typeof row.stripe_subscription_id === "string" && row.stripe_subscription_id)
    .slice()
    .sort((a, b) => rankStatus(a.status as string) - rankStatus(b.status as string));
  return (rows[0]?.stripe_subscription_id as string | undefined) ?? null;
}

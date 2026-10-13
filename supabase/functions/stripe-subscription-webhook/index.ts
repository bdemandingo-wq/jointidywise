// Stripe subscription webhook — keeps organizations.plan_tier in sync.
// Listens for customer.subscription.created / updated / deleted, resolves the
// customer email -> owner user -> organization, and updates plan_tier based on
// the active subscription's price id. Cancelled/deleted -> 'trial' (unless the
// org is lifetime/grandfathered).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { subscriptionToPlanTier, updateOrgPlanTier, PlanTier } from "../_shared/plan-tier.ts";
import { platformAdminPhones } from "../_shared/platform-admin-phones.ts";
import { syncLoyaltySubscription } from "../_shared/loyalty-pricing-sync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

const ADMIN_PHONES = platformAdminPhones();

const log = (step: string, details?: unknown) => {
  const s = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[STRIPE-SUB-WEBHOOK] ${step}${s}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
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
    log("Invalid signature", { message: (err as Error).message });
    return new Response(JSON.stringify({ error: "invalid signature" }), { status: 400, headers: corsHeaders });
  }

  try {
    if (
      event.type !== "customer.subscription.created" &&
      event.type !== "customer.subscription.updated" &&
      event.type !== "customer.subscription.deleted"
    ) {
      return new Response(JSON.stringify({ ignored: event.type }), { status: 200, headers: corsHeaders });
    }

    const sub = event.data.object as Stripe.Subscription;
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
    if (!customerId) throw new Error("no customer id");

    const customer = await stripe.customers.retrieve(customerId);
    const email = (customer as any)?.email?.toLowerCase();
    if (!email) throw new Error("customer has no email");

    // Find org via owner/admin membership -> profiles.email
    const { data: profile } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
    if (!profile) {
      log("No profile matches customer email", { email });
      return new Response(JSON.stringify({ ok: true, skipped: "no_profile" }), { status: 200, headers: corsHeaders });
    }
    const { data: membership } = await supabase
      .from("org_memberships")
      .select("organization_id")
      .eq("user_id", profile.id)
      .in("role", ["owner", "admin"])
      .limit(1)
      .maybeSingle();
    if (!membership) {
      log("No owning org", { email });
      return new Response(JSON.stringify({ ok: true, skipped: "no_org" }), { status: 200, headers: corsHeaders });
    }

    // Decide tier: if this event is delete or the subscription is not active/trialing,
    // check if the customer still has ANY other active/trialing sub. Otherwise -> trial.
    let tier: PlanTier = "trial";
    const isTerminal =
      event.type === "customer.subscription.deleted" ||
      !(sub.status === "active" || sub.status === "trialing");

    if (isTerminal) {
      const all = await stripe.subscriptions.list({ customer: customerId, limit: 10 });
      const other = all.data.find(
        (s) => s.id !== sub.id && (s.status === "active" || s.status === "trialing"),
      );
      if (other) tier = subscriptionToPlanTier(other) ?? "trial";
    } else {
      tier = subscriptionToPlanTier(sub) ?? "trial";
    }

    const result = await updateOrgPlanTier(supabase, membership.organization_id, tier);
    log("Updated plan_tier", { orgId: membership.organization_id, tier, ...result });

    // --- Trial -> paid conversion notification -------------------------------
    // Non-fatal by construction: everything below is inside its own try/catch
    // and runs AFTER updateOrgPlanTier, so a failed SMS can never roll back or
    // block the plan_tier sync this webhook exists to perform.
    const previousStatus =
      (event.data.previous_attributes as { status?: string } | undefined)?.status;
    const converted = previousStatus === "trialing" && sub.status === "active";

    if (converted) {
      try {
        const item = sub.items.data[0];
        const price = item?.price;
        const amount =
          typeof price?.unit_amount === "number"
            ? `${(price.unit_amount / 100).toFixed(2)} ${String(price.currency).toUpperCase()}`
            : "unknown amount";
        const interval = price?.recurring?.interval ?? "unknown interval";

        // create-subscription stamps tidywise_plan on the subscription's metadata.
        // Fall back to the price nickname rather than to a plan-name table.
        const planName =
          (sub.metadata as Record<string, string> | undefined)?.tidywise_plan ??
          price?.nickname ??
          "unknown plan";

        const { data: org } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", membership.organization_id)
          .maybeSingle();
        const organizationName = org?.name ?? membership.organization_id;

        const message =
          `TidyWise: trial converted to paid\n` +
          `Org: ${organizationName}\n` +
          `Plan: ${planName}\n` +
          `Price: ${amount} / ${interval}\n` +
          `Subscription: ${sub.id}`;

        const TIDYWISE_ORG_ID = "e95b92d0-7099-408e-a773-e4407b34f8b4";
        const { data: smsSettings } = await supabase
          .from("organization_sms_settings")
          .select("openphone_api_key, openphone_phone_number_id")
          .eq("organization_id", TIDYWISE_ORG_ID)
          .maybeSingle();

        const openphoneApiKey =
          smsSettings?.openphone_api_key || Deno.env.get("OPENPHONE_API_KEY");
        const openphonePhoneNumberId =
          smsSettings?.openphone_phone_number_id || Deno.env.get("OPENPHONE_PHONE_NUMBER_ID");

        if (openphoneApiKey && openphonePhoneNumberId) {
          for (const phone of ADMIN_PHONES) {
            try {
              const res = await fetch("https://api.openphone.com/v1/messages", {
                method: "POST",
                headers: {
                  Authorization: openphoneApiKey.trim().replace(/^Bearer\s+/i, ""),
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  from: openphonePhoneNumberId,
                  to: [phone],
                  content: message,
                }),
              });
              if (!res.ok) {
                log("Conversion SMS failed", { phone, status: res.status, body: await res.text() });
              } else {
                log("Conversion SMS sent", { phone, subscription: sub.id });
              }
            } catch (smsErr) {
              log("Conversion SMS error", { phone, message: (smsErr as Error).message });
            }
          }
        } else {
          log("Conversion SMS skipped - OpenPhone not configured");
        }
      } catch (notifyErr) {
        log("Conversion notification error (non-fatal)", {
          message: (notifyErr as Error).message,
        });
      }
    }


    // Clock only. A failure here must not fail the plan_tier sync above.
    // The daily apply-loyalty-pricing job repeats this and is what attaches
    // the renewal coupon. proration_behavior is none inside the sync.
    try {
      await syncLoyaltySubscription(supabase, stripe, {
        organizationId: membership.organization_id,
        subscriptionId: sub.id,
      });
    } catch (loyaltyErr) {
      log("Loyalty clock sync failed (non-fatal)", { message: (loyaltyErr as Error).message });
    }

    return new Response(JSON.stringify({ ok: true, tier, ...result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    log("ERROR", { message: (err as Error).message });
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

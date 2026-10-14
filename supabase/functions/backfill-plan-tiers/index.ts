import { createStripeClient } from "../_shared/stripe-client.ts";
// One-shot backfill: reconciles organizations.plan_tier with Stripe.
// Auth: requires the caller to pass BACKFILL_SECRET (matches PLAN_TIER_BACKFILL_SECRET env var).
// - Lifetime/grandfathered orgs are locked to 'custom' (updated if not already).
// - For each other org, looks up the owner/admin's Stripe customer by email
//   and finds an active/trialing subscription. Maps its price id -> tier.
//   No active sub -> 'trial'.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { subscriptionToPlanTier, PlanTier } from "../_shared/plan-tier.ts";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const backfillSecret = Deno.env.get("PLAN_TIER_BACKFILL_SECRET");
  const provided = req.headers.get("x-backfill-secret");
  if (!backfillSecret || provided !== backfillSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stripe = await createStripeClient(billingSecretKey() ?? "", { apiVersion: "2025-08-27.basil" });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const { data: orgs, error } = await supabase
    .from("organizations")
    .select("id, name, plan_type, plan_tier, grandfathered_lifetime");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }

  const changes: Array<{ org: string; from: string | null; to: PlanTier; reason: string }> = [];

  for (const org of orgs ?? []) {
    let newTier: PlanTier;
    let reason: string;

    if (org.grandfathered_lifetime || org.plan_type === "lifetime") {
      newTier = "custom";
      reason = "lifetime";
    } else {
      // Find owner email via profiles
      const { data: membership } = await supabase
        .from("org_memberships")
        .select("user_id")
        .eq("organization_id", org.id)
        .in("role", ["owner", "admin"])
        .limit(1)
        .maybeSingle();

      let email: string | null = null;
      if (membership) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("email")
          .eq("id", membership.user_id)
          .maybeSingle();
        email = profile?.email?.toLowerCase() ?? null;
      }

      if (!email) {
        newTier = "trial";
        reason = "no_owner_email";
      } else {
        const customers = await stripe.customers.list({ email, limit: 1 });
        if (customers.data.length === 0) {
          newTier = "trial";
          reason = "no_stripe_customer";
        } else {
          const subs = await stripe.subscriptions.list({
            customer: customers.data[0].id,
            limit: 10,
          });
          const active = subs.data.find(
            (s) => s.status === "active" || s.status === "trialing",
          );
          if (!active) {
            newTier = "trial";
            reason = "no_active_sub";
          } else {
            newTier = subscriptionToPlanTier(active) ?? "trial";
            reason = `price:${active.items.data[0]?.price?.id ?? "unknown"}`;
          }
        }
      }
    }

    if (org.plan_tier !== newTier) {
      const { error: upErr } = await supabase
        .from("organizations")
        .update({ plan_tier: newTier })
        .eq("id", org.id);
      if (!upErr) {
        changes.push({ org: org.name, from: org.plan_tier, to: newTier, reason });
      }
    }
  }

  // Return current counts too
  const { data: counts } = await supabase
    .from("organizations")
    .select("plan_tier");
  const tally: Record<string, number> = {};
  for (const row of counts ?? []) tally[row.plan_tier ?? "null"] = (tally[row.plan_tier ?? "null"] ?? 0) + 1;

  return new Response(JSON.stringify({ ok: true, changes, tally }, null, 2), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

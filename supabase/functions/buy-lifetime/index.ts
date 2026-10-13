// One-time lifetime checkout for a signed-in user.
//
// A live Stripe Checkout Session is created only after auth.getUser accepts
// the bearer token. The anon key is not a user. The session metadata carries
// that user's organization_id so the webhook updates the org they belong to.
//
// verify_jwt stays false because the anon key is itself a signed JWT. This
// function returns 401 when the caller is not a real user.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { lifetimeCallerStatus, lifetimeOrgStatus } from "../_shared/lifetime-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LIFETIME_PRICE_ID = Deno.env.get("STRIPE_LIFETIME_PRICE_ID") || "";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const token = authHeader?.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(authHeader.indexOf(" ") + 1).trim()
      : "";
    let user: { id: string; email: string } | null = null;
    if (token && token !== anonKey) {
      const { data, error } = await admin.auth.getUser(token);
      if (!error && data.user?.id && data.user.email) {
        user = { id: data.user.id, email: data.user.email };
      }
    }
    const rejected = lifetimeCallerStatus({ authorization: authHeader, anonKey, user });
    if (rejected || !user) return json({ error: rejected?.error ?? "Sign in to claim a lifetime spot." }, 401);

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    if (!LIFETIME_PRICE_ID) {
      return json({
        error: "Lifetime checkout is not configured on the server. STRIPE_LIFETIME_PRICE_ID is missing.",
      }, 503);
    }

    const { data: state } = await admin
      .from("lifetime_offer_state")
      .select("total_spots, sold_spots, sold_out_at")
      .eq("id", 1)
      .maybeSingle();

    const total = state?.total_spots ?? 100;
    const sold = state?.sold_spots ?? 0;
    if (state?.sold_out_at || sold >= total) {
      return json({ error: "Lifetime offer is sold out." }, 409);
    }

    const { data: membership, error: membershipError } = await admin
      .from("org_memberships")
      .select("organization_id, organizations(plan_type, grandfathered_lifetime)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (membershipError) throw new Error(membershipError.message);

    const organizationId = membership?.organization_id ?? null;
    const org = (membership as { organizations?: { plan_type?: string; grandfathered_lifetime?: boolean } } | null)?.organizations;
    if (org?.grandfathered_lifetime || org?.plan_type === "lifetime") {
      return json({
        error: "You already have lifetime access. No need to buy again.",
        alreadyLifetime: true,
      }, 409);
    }
    const orgMissing = lifetimeOrgStatus(organizationId);
    if (orgMissing || !organizationId) {
      return json({
        error: orgMissing?.error ?? "Your workspace is still being set up. Try again in a moment.",
        code: orgMissing?.code ?? "org_not_ready",
      }, 409);
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = customers.data[0]?.id;

    const origin =
      req.headers.get("origin") ||
      Deno.env.get("APP_URL") ||
      "https://jointidywise.com";

    const metadata: Record<string, string> = {
      plan: "lifetime",
      signup_flow: "in_app_upgrade",
      tidywise_plan: "lifetime",
      user_id: user.id,
      account_id: user.id,
      email: user.email,
      organization_id: organizationId,
    };

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      mode: "payment",
      line_items: [{ price: LIFETIME_PRICE_ID, quantity: 1 }],
      payment_method_options: {
        card: { request_three_d_secure: "any" },
      },
      metadata,
      payment_intent_data: { metadata },
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}&plan=lifetime`,
      cancel_url: `${origin}/pricing?lifetime=cancelled`,
    });

    return json({ url: session.url }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[buy-lifetime] error:", msg);
    return json({ error: msg }, 500);
  }
});

// One-time $300 lifetime checkout. Supports two flows:
//
//   1) Anonymous (checkout-first):
//      Caller is NOT authenticated. Stripe Checkout collects the email
//      and creates a Customer. The webhook reads
//      session.customer_details.email at checkout.session.completed,
//      provisions the TidyWise account, atomically claims a lifetime
//      spot, and emails the user a "set your password" link.
//
//   2) Authenticated (in-app upgrade):
//      Caller is logged in. We pre-check the live spot counter, refuse
//      if grandfathered/lifetime already, attach to existing Stripe
//      customer if one exists.
//
// verify_jwt = false in config.toml so anonymous callers reach us.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LIFETIME_PRICE_ID = Deno.env.get("STRIPE_LIFETIME_PRICE_ID") || "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    if (!LIFETIME_PRICE_ID) {
      return new Response(JSON.stringify({
        error: "Lifetime checkout is not configured on the server. STRIPE_LIFETIME_PRICE_ID is missing.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read live counter — best-effort UX guard (webhook is the hard
    // guard via the database CHECK constraint).
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const { data: state } = await admin
      .from("lifetime_offer_state")
      .select("total_spots, sold_spots, sold_out_at")
      .eq("id", 1)
      .maybeSingle();

    const total = state?.total_spots ?? 100;
    const sold = state?.sold_spots ?? 0;
    if (state?.sold_out_at || sold >= total) {
      return new Response(
        JSON.stringify({ error: "Lifetime offer is sold out." }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Detect flow: anonymous vs authenticated ────────────────────────────
    const authHeader = req.headers.get("Authorization");
    let user: { id: string; email: string } | null = null;
    if (authHeader?.startsWith("Bearer ")) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      );
      const { data: udata } = await userClient.auth.getUser(
        authHeader.replace("Bearer ", ""),
      );
      if (udata?.user?.email) {
        user = { id: udata.user.id, email: udata.user.email };
      }
    }

    let customerId: string | undefined;
    if (user) {
      const { data: membership } = await admin
        .from("org_memberships")
        .select("organization_id, organizations(plan_type, grandfathered_lifetime)")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      const org = (membership as { organizations?: { plan_type?: string; grandfathered_lifetime?: boolean } } | null)?.organizations;
      if (org?.grandfathered_lifetime || org?.plan_type === "lifetime") {
        return new Response(
          JSON.stringify({
            error: "You already have lifetime access. No need to buy again.",
            alreadyLifetime: true,
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const stripeForLookup = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      const customers = await stripeForLookup.customers.list({
        email: user.email,
        limit: 1,
      });
      customerId = customers.data[0]?.id;
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const origin =
      req.headers.get("origin") ||
      Deno.env.get("APP_URL") ||
      "https://jointidywise.com";

    const metadata: Record<string, string> = {
      plan: "lifetime",
      signup_flow: user ? "in_app_upgrade" : "anonymous_checkout",
      tidywise_plan: "lifetime",
    };
    if (user) {
      // Both keys for backward-compat — the existing webhook lifetime
      // branch reads user_id; account_id matches the fraud-evidence
      // convention.
      metadata.user_id = user.id;
      metadata.account_id = user.id;
      metadata.email = user.email;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user?.email,
      ...(user ? {} : { customer_creation: "always" as const }),
      mode: "payment",
      line_items: [{ price: LIFETIME_PRICE_ID, quantity: 1 }],
      payment_method_options: {
        card: { request_three_d_secure: "automatic" },
      },
      metadata,
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}&plan=lifetime`,
      cancel_url: `${origin}/pricing?lifetime=cancelled`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[buy-lifetime] error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

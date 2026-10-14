// Ad-management retainer checkout — $400/mo per platform.
//
// Separate Stripe subscription from the main TidyWise plan; each
// platform (google_search, google_lsa, facebook) is its own
// subscription so the customer can cancel one without losing the
// others. A unique partial index on
// ad_management_subscriptions(organization_id, platform) WHERE
// status='active' prevents double-buys at the DB layer; we also
// short-circuit here for a clean error message.
//
// Available to anyone on a paid plan (basic, pro, custom, lifetime,
// or grandfathered). Refused for orgs with no paid access since
// without TidyWise there's nowhere for the lead flow to land.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PRICE_IDS: Record<string, string | undefined> = {
  google_search: Deno.env.get("STRIPE_AD_GOOGLE_SEARCH_PRICE_ID"),
  google_lsa: Deno.env.get("STRIPE_AD_GOOGLE_LSA_PRICE_ID"),
  facebook: Deno.env.get("STRIPE_AD_FACEBOOK_PRICE_ID"),
};

const PLATFORM_LABEL: Record<string, string> = {
  google_search: "Google Search Ads",
  google_lsa: "Google Local Services Ads",
  facebook: "Facebook Ads",
};

const PAID_PLAN_TYPES = new Set([
  "basic",
  "pro",
  "custom",
  "lifetime",
  "standard", // legacy single paid tier
  "trial", // active trial users can pre-buy if they want
  "enterprise",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = billingSecretKey();
    if (!stripeKey) throw new Error("STRIPE_BILLING_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );
    const { data: udata } = await userClient.auth.getUser(token);
    const user = udata?.user;
    if (!user?.email) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const platform: string | undefined = body?.platform;
    if (!platform || !PRICE_IDS[platform]) {
      return new Response(
        JSON.stringify({
          error: "platform must be one of: google_search, google_lsa, facebook",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const priceId = PRICE_IDS[platform];
    if (!priceId) {
      return new Response(
        JSON.stringify({
          error: `Stripe price for ${platform} is not configured on the server`,
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Find the user's org and check they're on a paid plan (or
    // grandfathered). Ad management is a paid-only add-on.
    const { data: membership } = await admin
      .from("org_memberships")
      .select("organization_id, organizations(plan_type, grandfathered_lifetime)")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    const orgId = membership?.organization_id;
    const org = (membership as any)?.organizations;
    if (!orgId) {
      return new Response(JSON.stringify({ error: "No organization found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const onPaidPlan = org?.grandfathered_lifetime || PAID_PLAN_TYPES.has(org?.plan_type);
    if (!onPaidPlan) {
      return new Response(
        JSON.stringify({
          error:
            "Ad management is only available to TidyWise subscribers. Pick a plan first, then come back.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Already have an active sub for this platform?
    const { data: existing, error: existingErr } = await admin
      .from("ad_management_subscriptions")
      .select("id, stripe_subscription_id")
      .eq("organization_id", orgId)
      .eq("platform", platform)
      .eq("status", "active")
      .maybeSingle();
    if (existingErr) {
      // Can't confirm there isn't already an active sub — refuse rather
      // than risk letting a customer buy a second one for the same
      // platform (the DB's own unique index is a second guard, but it's
      // better to fail here with a clear message than rely on that alone).
      console.error("[buy-ad-management] duplicate-check failed, refusing to proceed:", existingErr);
      return new Response(
        JSON.stringify({ error: "Could not verify your subscription status. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (existing) {
      return new Response(
        JSON.stringify({
          error: `You're already subscribed to ${PLATFORM_LABEL[platform]}.`,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = customers.data[0]?.id;

    const origin =
      req.headers.get("origin") ||
      Deno.env.get("APP_URL") ||
      "https://jointidywise.com";

    // Server-trusted fraud-evidence fields, same shape as
    // create-subscription. Lets the dispute pipeline assemble Visa
    // CE 3.0 evidence on ad-management charges the same way it does
    // for the main subscription.
    const clientIp =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-real-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      null;
    const userAgent = req.headers.get("user-agent") || null;

    const evidenceMetadata: Record<string, string> = {
      account_id: user.id,
      organization_id: orgId,
      email: user.email,
      signup_date: user.created_at || new Date().toISOString(),
      ip: clientIp || "",
      device: (userAgent || "").slice(0, 480),
      purpose: "tidywise_ad_management",
      ad_platform: platform,
    };

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_options: {
        card: { request_three_d_secure: "automatic" },
      },
      metadata: evidenceMetadata,
      subscription_data: {
        metadata: evidenceMetadata,
        payment_settings: {
          payment_method_options: {
            card: { request_three_d_secure: "automatic" },
          },
        },
      },
      success_url: `${origin}/dashboard?ad=success&platform=${platform}`,
      cancel_url: `${origin}/dashboard/subscription?ad=cancelled`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[buy-ad-management] error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

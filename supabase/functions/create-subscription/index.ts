// Tier-aware subscription checkout. Supports two flows:
//
//   1) Anonymous (checkout-first):
//      - Caller is NOT authenticated. Stripe Checkout collects the email
//        and creates a Customer. The completed-session webhook reads
//        customer_details.email and provisions the TidyWise account
//        from there.
//      - This is the default /pricing flow: visitor clicks "Start Pro",
//        goes straight to Stripe, pays, and lands on /welcome where
//        the webhook (already running) has emailed them a link to set
//        their password.
//
//   2) Authenticated (in-app upgrade):
//      - Caller is logged in (Bearer token present). We look up their
//        existing Stripe customer + check for grandfathered-lifetime
//        before opening Checkout. Used when a logged-in Basic user
//        clicks /pricing → "Choose Pro" to upgrade their plan.
//
// The function distinguishes via the presence/validity of the Bearer
// token. verify_jwt = false in config.toml so anonymous callers reach
// us; the function still gates the authenticated branch via getUser().

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { ensureOnboardingCoupon, type OnboardingCouponOffer } from "../_shared/onboarding-coupons.ts";
import { embeddedCheckoutBody, embeddedCheckoutParams, readPublishableKey } from "../_shared/embedded-checkout.ts";
import { stripeTrialEndUnix } from "../_shared/trial-end.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PRICE_IDS: Record<string, Record<string, string | undefined>> = {
  basic: {
    monthly: Deno.env.get("STRIPE_BASIC_MONTHLY_PRICE_ID"),
    yearly: Deno.env.get("STRIPE_BASIC_YEARLY_PRICE_ID"),
  },
  pro: {
    monthly: Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID"),
    yearly: Deno.env.get("STRIPE_PRO_YEARLY_PRICE_ID"),
  },
  custom: {
    monthly: Deno.env.get("STRIPE_CUSTOM_MONTHLY_PRICE_ID"),
    yearly: Deno.env.get("STRIPE_CUSTOM_YEARLY_PRICE_ID"),
  },
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CREATE-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    let bodyData: Record<string, unknown> = {};
    try {
      bodyData = (await req.json()) as Record<string, unknown>;
    } catch {
      // no body
    }

    const requestedPlan =
      typeof bodyData?.plan === "string" ? (bodyData.plan as string) : undefined;
    const requestedInterval =
      bodyData?.interval === "yearly" ? "yearly" : "monthly";

    if (!requestedPlan || !["basic", "pro", "custom"].includes(requestedPlan)) {
      return new Response(
        JSON.stringify({ error: "Invalid plan — must be basic, pro, or custom." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    // Fail fast if the price ID for the chosen tier isn't configured.
    // Better than silently falling back to a legacy price (which was
    // billing $50 "Pro Subscription" when Basic was clicked).
    const priceId = PRICE_IDS[requestedPlan]?.[requestedInterval];
    if (!priceId) {
      logStep("Missing price ID config", {
        plan: requestedPlan,
        interval: requestedInterval,
      });
      return new Response(
        JSON.stringify({
          error: `Stripe price for ${requestedPlan} ${requestedInterval} is not configured on the server yet. The operator needs to set STRIPE_${requestedPlan.toUpperCase()}_${requestedInterval.toUpperCase()}_PRICE_ID in Supabase secrets.`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
      );
    }

    // ── Detect flow: anonymous vs authenticated ───────────────────────────
    const authHeader = req.headers.get("Authorization");
    let user: { id: string; email: string; created_at?: string } | null = null;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      // Skip the supabase auth gateway's anon-key fingerprint that some
      // clients send by default — that's not a real session token.
      const isAnonKey = token === (Deno.env.get("SUPABASE_ANON_KEY") ?? "");
      if (!isAnonKey) {
        const supabaseClient = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        );
        const { data } = await supabaseClient.auth.getUser(token);
        if (data.user?.email) {
          user = {
            id: data.user.id,
            email: data.user.email,
            created_at: data.user.created_at,
          };
          logStep("Authenticated flow", { userId: user.id, email: user.email });
        } else {
          // Bearer present but didn't resolve to a user (expired session,
          // revoked token, or a stale JWT auto-attached by supabase-js
          // from a previous session on the public pricing page). Don't
          // 401 — that breaks anonymous checkout for visitors who just
          // happen to have an old token in localStorage. Fall through to
          // the anonymous flow; Stripe will collect their email at
          // checkout and we link it to an account afterward.
          logStep("Bearer present but invalid — continuing as anonymous");
        }
      } else {
        logStep("Anonymous flow (anon-key Bearer ignored)");
      }
    } else {
      logStep("Anonymous flow (no Bearer header)");
    }

    let customerId: string | undefined;
    // Hoisted out of the `if (user)` block: the referral-discount lookup below
    // runs at the session-creation site and needs both of these. Do not move
    // that lookup inside this block — it would change when it runs.
    let referredOrgId: string | null = null;
    let orgPlanType: string | null = null;
    const accessAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    if (user) {
      // limit(1) with no order picked an arbitrary membership. An owner of a
      // trial org and another org could miss plan_type trial and get a
      // different Stripe trial than the dashboard clock.
      const { data: membershipRows } = await accessAdmin
        .from("org_memberships")
        .select("role, organizations(id, plan_type, grandfathered_lifetime)")
        .eq("user_id", user.id);
      type MembershipOrg = { id?: string; plan_type?: string; grandfathered_lifetime?: boolean };
      const memberships = (membershipRows ?? []) as Array<{
        role?: string;
        organizations?: MembershipOrg | MembershipOrg[] | null;
      }>;
      const orgFrom = (row: (typeof memberships)[number]): MembershipOrg | null => {
        const value = row.organizations;
        if (!value) return null;
        return Array.isArray(value) ? (value[0] ?? null) : value;
      };
      const trialMembership = memberships.find((row) => orgFrom(row)?.plan_type === "trial");
      const ownerMembership = memberships.find((row) => row.role === "owner" || row.role === "admin");
      const chosen = trialMembership ?? ownerMembership ?? memberships[0];
      const org = chosen ? orgFrom(chosen) : null;
      referredOrgId = org?.id ?? null;
      orgPlanType = org?.plan_type ?? null;
      if (org?.grandfathered_lifetime || org?.plan_type === "lifetime") {

        return new Response(
          JSON.stringify({
            error: "You already have lifetime access — no need to subscribe.",
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
      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
        logStep("Found existing Stripe customer", { customerId });

        const existingSubs = await stripeForLookup.subscriptions.list({
          customer: customerId,
          status: "active",
          limit: 1,
        });
        const existingTrials = await stripeForLookup.subscriptions.list({
          customer: customerId,
          status: "trialing",
          limit: 1,
        });
        // Do not open a second Checkout for someone already trialing in
        // Stripe. Their card and trial end stay exactly as they are.
        if (existingSubs.data.length > 0 || existingTrials.data.length > 0) {
          return new Response(
            JSON.stringify({ error: "You already have an active subscription." }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 400,
            },
          );
        }
      }
    }

    const clientIp =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-real-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      null;
    const userAgent = req.headers.get("user-agent") || null;
    const deviceFingerprint =
      typeof bodyData?.deviceFingerprint === "string"
        ? (bodyData.deviceFingerprint as string)
        : null;

    const evidenceMetadata: Record<string, string> = {
      ip: clientIp || "",
      device: (userAgent || "").slice(0, 480),
      device_fingerprint: deviceFingerprint || "",
      purpose: "tidywise_saas_subscription",
      tidywise_plan: requestedPlan,
      tidywise_interval: requestedInterval,
      signup_flow: user ? "in_app_upgrade" : "anonymous_checkout",
    };
    if (user) {
      evidenceMetadata.account_id = user.id;
      evidenceMetadata.email = user.email;
      evidenceMetadata.signup_date = user.created_at || new Date().toISOString();
    }

    const origin =
      req.headers.get("origin") ||
      Deno.env.get("APP_URL") ||
      "https://jointidywise.com";
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Card-free trial lives on the org (plan_type trial + trial_ends_at).
    // Signup does not call this function for Basic, Pro, or Custom.
    //
    // - Active org trial with at least 48h left: card required. trial_end
    //   is the exact unix second of profiles.trial_ends_at. No
    //   trial_period_days, so Stripe does not start a second trial or add
    //   days. The card is charged when that existing trial ends.
    // - Org trial under 48h or already over: card required, no trial_end
    //   and no trial_period_days. Billing starts now. Stripe rejects
    //   trial_end inside 48 hours.
    // - Any other existing plan: card required, 14-day Stripe trial.
    //   Those subscriptions are not rewritten.
    // - Anonymous first checkout: card optional, 30-day Stripe trial,
    //   cancel if no card when it ends.

    // The referred org's half of the programme: 50% off their first month.
    // Only orgs that arrived through someone's referral link, and only on
    // their first subscription.
    //
    // KNOWN GAP: `referredOrgId` is only resolved for the AUTHENTICATED flow.
    // In anonymous checkout no organization exists yet, so no discount can be
    // applied. Accepted, not an oversight — the code is still in the browser's
    // storage and claim-referral records it at onboarding, so the REFERRER
    // still earns their month.
    //
    // The coupon is `repeating`/`duration_in_months: 1`, NOT `once`: with a
    // A trial Stripe issues a $0 invoice at creation, and a `once` coupon
    // could be consumed by it, leaving nothing for the first real charge.
    let referralDiscount: { coupon: string }[] | undefined;
    let referralRowId: string | null = null;
    let winbackOffer: OnboardingCouponOffer | null = null;
    try {
      const couponId = Deno.env.get("REFERRED_FIRST_MONTH_COUPON");
      if (couponId && referredOrgId) {
        const { data: ref } = await accessAdmin
          .from("org_referrals")
          .select("id, status, referred_discount_applied_at, referred_first_payment_at")
          .eq("referred_org_id", referredOrgId)
          .in("status", ["pending", "qualified"])
          .maybeSingle();
        // Gate on an actual PAYMENT, not on a session having been created.
        // Abandoned checkouts (tab closed, card declined, "cancel" back to
        // /pricing) used to stamp referred_discount_applied_at and silently
        // burn the 50% coupon on the first attempt.
        if (ref && !ref.referred_first_payment_at) {
          referralDiscount = [{ coupon: couponId }];
          referralRowId = ref.id;
        }
      }
    } catch (e) {
      // Never block checkout over a discount lookup.
      console.error("[referral] discount lookup failed:", e);
    }

    if (user) {
      try {
        const { data: winback } = await accessAdmin
          .from("onboarding_winback")
          .select("offer_used")
          .eq("user_id", user.id)
          .maybeSingle();
        if (winback?.offer_used === "half_off_first_month" || winback?.offer_used === "first_month_free") {
          winbackOffer = winback.offer_used;
        }
      } catch (e) {
        console.error("[winback] lookup failed:", e);
      }
    }

    let checkoutDiscounts = referralDiscount;
    if (winbackOffer) {
      try {
        const coupon = await ensureOnboardingCoupon(stripe, winbackOffer);
        checkoutDiscounts = [{ coupon }];
        // One coupon per Checkout session. The larger winback offer wins,
        // and the referral coupon is left unused rather than stacked.
        referralRowId = null;
        evidenceMetadata.tidywise_winback_offer = winbackOffer;
      } catch (e) {
        console.error("[winback] coupon ensure failed:", e);
      }
    }

    let paymentMethodCollection: "always" | "if_required" = "if_required";
    const subscriptionData: {
      metadata: Record<string, string>;
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } };
      trial_period_days?: number;
      trial_end?: number;
    } = {
      metadata: evidenceMetadata,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    };

    if (user && orgPlanType === "trial") {
      paymentMethodCollection = "always";
      const { data: trialProfile } = await accessAdmin
        .from("profiles")
        .select("trial_ends_at")
        .eq("id", user.id)
        .maybeSingle();
      const trialEnd = stripeTrialEndUnix(trialProfile?.trial_ends_at);
      if (trialEnd != null) {
        subscriptionData.trial_end = trialEnd;
      }
    } else if (user && orgPlanType && orgPlanType !== "trial") {
      paymentMethodCollection = "always";
      subscriptionData.trial_period_days = 14;
    } else {
      paymentMethodCollection = "if_required";
      subscriptionData.trial_period_days = 30;
    }

    const publishableKey = readPublishableKey();
    if (!publishableKey) {
      return new Response(
        JSON.stringify({
          error: "Checkout is not configured. STRIPE_PUBLISHABLE_KEY is missing on the server. Nothing was charged.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
      );
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,

      customer_email: customerId ? undefined : user?.email,
      // Note: `customer_creation` is only valid in payment mode. In
      // subscription mode Stripe always creates a Customer automatically,
      // so we don't need (or are allowed) to set it.

      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      ...embeddedCheckoutParams(origin),
      // Subscription checkout uses the Billing Payments configuration, not the
      // account Default. Link and Cash App are disabled inside that config:
      // they accounted for 14 of 36 SaaS payment failures (partner_insufficient_funds,
      // link_connection_closed, cashapp_payment_declined), while cards failed
      // once in a year. Cards, Apple Pay and Google Pay stay on.
      //
      // Scoped here deliberately. Twelve other functions create Checkout
      // sessions for booking and merchant flows and still use the account
      // Default, where those methods are wanted. Do not "simplify" this by
      // changing the account-wide setting instead — that would hit all of them.
      payment_method_configuration: "pmc_1Q0IjxJv857o86nohXqYdISA",
      payment_method_collection: paymentMethodCollection,
      payment_method_options: {
        card: { request_three_d_secure: "automatic" },
      },
      metadata: evidenceMetadata,
      // Spread conditionally — passing the key as undefined is not the same
      // as omitting it, and Stripe rejects it alongside promotion codes
      // (which this function does not enable).

      ...(checkoutDiscounts ? { discounts: checkoutDiscounts } : {}),
      subscription_data: subscriptionData,
    });

    // Record that a discounted session was attached. This is informational
    // only — the eligibility gate above keys off referred_first_payment_at,
    // so an abandoned session no longer consumes the coupon.
    if (referralRowId) {
      await accessAdmin
        .from("org_referrals")
        .update({ referred_discount_applied_at: new Date().toISOString() })
        .eq("id", referralRowId)
        .then(({ error }) => {
          if (error) console.error("[referral] failed to stamp discount:", error);
        });
    }

    if (user && winbackOffer && checkoutDiscounts) {
      await accessAdmin
        .from("onboarding_winback")
        .update({
          checkout_coupon_id: checkoutDiscounts[0].coupon,
          checkout_attached_at: new Date().toISOString(),
        })
        .eq("user_id", user.id)
        .then(({ error }) => {
          if (error) console.error("[winback] failed to record coupon:", error);
        });
    }

    logStep("Checkout session created", {
      sessionId: session.id,
      flow: user ? "authenticated" : "anonymous",
      referralDiscount: Boolean(referralRowId),
      winbackOffer,
    });


    return new Response(JSON.stringify(embeddedCheckoutBody(session.client_secret, publishableKey)), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

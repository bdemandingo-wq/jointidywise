// Read-only first-charge preview. Same plan, org, trial, and coupon gates as
// create-subscription. Creates nothing in Stripe: no Checkout Session, no
// Customer, no Coupon, and no row updates.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { billingSecretKey } from "../_shared/billing-stripe.ts";
import {
  CHECKOUT_MEMBERSHIP_SELECT,
  WINBACK_COUPON_IDS,
  WINBACK_PERCENT_OFF,
  amountCentsAfterDiscounts,
  chooseCheckoutOrg,
  lookupCheckoutDiscount,
  subscriptionChargeTiming,
  type WinbackOffer,
} from "../_shared/subscription-charge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = billingSecretKey();
    if (!stripeKey) throw new Error("STRIPE_BILLING_SECRET_KEY is not set");

    let bodyData: Record<string, unknown> = {};
    try {
      bodyData = (await req.json()) as Record<string, unknown>;
    } catch {
      // no body
    }

    const requestedPlan = typeof bodyData.plan === "string" ? bodyData.plan : undefined;
    const requestedInterval = bodyData.interval === "yearly" ? "yearly" : "monthly";
    if (!requestedPlan || !["basic", "pro", "custom"].includes(requestedPlan)) {
      return json({ error: "Invalid plan — must be basic, pro, or custom." }, 400);
    }

    const priceId = PRICE_IDS[requestedPlan]?.[requestedInterval];
    if (!priceId) {
      return json({
        error: `Stripe price for ${requestedPlan} ${requestedInterval} is not configured on the server yet.`,
        code: "price_not_configured",
        plan: requestedPlan,
      }, 503);
    }

    const authHeader = req.headers.get("Authorization");
    let user: { id: string; email: string } | null = null;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const isAnonKey = token === (Deno.env.get("SUPABASE_ANON_KEY") ?? "");
      if (!isAnonKey) {
        const supabaseClient = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        );
        const { data } = await supabaseClient.auth.getUser(token);
        if (data.user?.email) {
          user = { id: data.user.id, email: data.user.email };
        }
      }
    }

    const accessAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    let referredOrgId: string | null = null;
    let orgPlanType: string | null = null;
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    if (user) {
      const { data: membershipRows } = await accessAdmin
        .from("org_memberships")
        .select(CHECKOUT_MEMBERSHIP_SELECT)
        .eq("user_id", user.id);
      const requestedOrgId = typeof bodyData.organization_id === "string"
        ? bodyData.organization_id.trim()
        : typeof bodyData.organizationId === "string"
          ? bodyData.organizationId.trim()
          : "";
      const chosenOrg = chooseCheckoutOrg(membershipRows ?? [], requestedOrgId);
      referredOrgId = chosenOrg.referredOrgId;
      orgPlanType = chosenOrg.orgPlanType;
      if (chosenOrg.lifetime) {
        return json({
          error: "You already have lifetime access — no need to subscribe.",
          alreadyLifetime: true,
        }, 409);
      }

      const customers = await stripe.customers.list({ email: user.email, limit: 1 });
      if (customers.data.length > 0) {
        const customerId = customers.data[0].id;
        const existingSubs = await stripe.subscriptions.list({
          customer: customerId,
          status: "active",
          limit: 1,
        });
        const existingTrials = await stripe.subscriptions.list({
          customer: customerId,
          status: "trialing",
          limit: 1,
        });
        if (existingSubs.data.length > 0 || existingTrials.data.length > 0) {
          return json({ error: "You already have an active subscription." }, 400);
        }
      }
    }

    let trialEndsAt: string | null = null;
    if (user && orgPlanType === "trial") {
      const { data: trialProfile } = await accessAdmin
        .from("profiles")
        .select("trial_ends_at")
        .eq("id", user.id)
        .maybeSingle();
      trialEndsAt = trialProfile?.trial_ends_at ?? null;
    }

    const timing = subscriptionChargeTiming({
      hasUser: Boolean(user),
      orgPlanType,
      trialEndsAt,
    });

    const discountLookup = await lookupCheckoutDiscount(accessAdmin, {
      userId: user?.id ?? null,
      referredOrgId,
      referralCouponId: Deno.env.get("REFERRED_FIRST_MONTH_COUPON") ?? null,
    });

    const price = await stripe.prices.retrieve(priceId);
    if (price.unit_amount == null) {
      return json({ error: "Stripe price has no unit amount. Nothing was charged." }, 503);
    }

    const discount = await readDiscount(stripe, discountLookup);
    const amount = amountCentsAfterDiscounts(price.unit_amount, discount);

    return json({
      bill_now: timing.billNow,
      first_charge_at: timing.firstChargeAt,
      amount_cents_after_discounts: amount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[PREVIEW-SUBSCRIPTION-CHARGE]", message);
    return json({ error: message }, 500);
  }
});

async function readDiscount(
  stripe: Stripe,
  lookup: { referral: { couponId: string } | null; winbackOffer: WinbackOffer | null },
): Promise<{ percentOff: number | null; amountOffCents: number | null } | null> {
  if (lookup.winbackOffer) {
    const couponId = WINBACK_COUPON_IDS[lookup.winbackOffer];
    try {
      const coupon = await stripe.coupons.retrieve(couponId);
      if (coupon && !(coupon as { deleted?: boolean }).deleted) {
        return {
          percentOff: coupon.percent_off ?? null,
          amountOffCents: coupon.amount_off ?? null,
        };
      }
    } catch {
      // Coupon is created on the real checkout if it is missing. Use the
      // percent that creation writes. This retrieve does not create it.
    }
    return { percentOff: WINBACK_PERCENT_OFF[lookup.winbackOffer], amountOffCents: null };
  }
  if (lookup.referral) {
    const coupon = await stripe.coupons.retrieve(lookup.referral.couponId);
    return {
      percentOff: coupon.percent_off ?? null,
      amountOffCents: coupon.amount_off ?? null,
    };
  }
  return null;
}

// Preview proration for an upcoming subscription plan change.
// Returns prorated amount due today, next billing amount, and next billing date.
// Used by the in-app Upgrade modal.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

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

const log = (s: string, d?: unknown) =>
  console.log(`[PREVIEW-PLAN-CHANGE] ${s}${d ? " " + JSON.stringify(d) : ""}`);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr) throw new Error(userErr.message);
    const user = userData.user;
    if (!user?.email) throw new Error("Not authenticated");

    const body = (await req.json().catch(() => ({}))) as {
      plan?: string;
      interval?: string;
      discount_code?: string;
    };
    const plan = body.plan;
    const interval = body.interval === "yearly" ? "yearly" : "monthly";

    if (!plan || !["basic", "pro", "custom"].includes(plan)) {
      return new Response(JSON.stringify({ error: "Invalid plan" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newPriceId = PRICE_IDS[plan]?.[interval];
    if (!newPriceId) {
      return new Response(
        JSON.stringify({
          error: `Stripe price for ${plan} ${interval} is not configured.`,
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // A person on a trial (or whose latest invoice is retrying) still has a
    // real Stripe subscription — it just isn't "active". Filtering on
    // status:"active" made those upgrades fail with a bare 400.
    const CHANGEABLE = ["active", "trialing", "past_due", "unpaid"];
    const noSub = () =>
      new Response(
        JSON.stringify({
          error: "You don't have a paid subscription yet, so there's nothing to upgrade. Start a plan to continue.",
          code: "no_subscription",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (customers.data.length === 0) return noSub();
    const customerId = customers.data[0].id;

    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 20,
    });
    const subscription = subs.data.find((s) => CHANGEABLE.includes(s.status));
    if (!subscription) return noSub();
    const itemId = subscription.items.data[0].id;

    // Validate discount code if supplied
    let discountValid = false;
    let discountId: string | undefined;
    let discountError: string | undefined;
    if (body.discount_code) {
      try {
        const promos = await stripe.promotionCodes.list({
          code: body.discount_code.trim(),
          active: true,
          limit: 1,
        });
        if (promos.data.length > 0) {
          discountValid = true;
          discountId = promos.data[0].id;
        } else {
          discountError = "Invalid or expired discount code.";
        }
      } catch (err) {
        discountError = "Could not validate discount code.";
        log("discount lookup failed", { err: String(err) });
      }
    }

    // Preview the upcoming invoice with the proposed item swap.
    const invoice = await stripe.invoices.createPreview({
      customer: customerId,
      subscription: subscription.id,
      subscription_details: {
        items: [{ id: itemId, price: newPriceId }],
        proration_behavior: "always_invoice",
        proration_date: Math.floor(Date.now() / 1000),
      },
      ...(discountId ? { discounts: [{ promotion_code: discountId }] } : {}),
    });

    // Sum only proration lines for today's prorated total.
    const prorationLines = invoice.lines.data.filter((l) => l.proration);
    const prorationAmount = prorationLines.reduce((sum, l) => sum + l.amount, 0);

    // Next billing amount is the new recurring price.
    const newPrice = await stripe.prices.retrieve(newPriceId);

    return new Response(
      JSON.stringify({
        currency: invoice.currency,
        amount_due_today: Math.max(0, prorationAmount), // negative = credit
        proration_credit: prorationAmount < 0 ? Math.abs(prorationAmount) : 0,
        next_amount: newPrice.unit_amount ?? 0,
        next_billing_date: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null,
        discount_valid: discountValid,
        discount_error: discountError,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("ERROR", { msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { createStripeClient } from "../_shared/stripe-client.ts";
/**
 * RESEND SUBSCRIPTION RECEIPT
 *
 * Triggered from the dashboard "Resend receipt" action. Looks up the
 * authenticated user's most recent paid Stripe invoice, then invokes
 * `send-subscription-receipt` with the same payload shape as the
 * `stripe-invoice-webhook` so the receipt email contains the correct
 * plan, interval, amount, and next billing date.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PRICE_TO_META: Record<string, { plan: string; interval: "monthly" | "yearly" }> = {
  // Resolved at runtime via the subscription item, but kept here as a
  // documentation hint for the price → plan mapping. The real mapping
  // comes off the subscription's price metadata when available.
};

function planFromPrice(price: Stripe.Price | null | undefined): {
  plan: string | null;
  interval: "monthly" | "yearly" | null;
} {
  if (!price) return { plan: null, interval: null };
  const meta = (price.metadata ?? {}) as Record<string, string>;
  const plan = meta.plan ?? PRICE_TO_META[price.id]?.plan ?? null;
  const recurring = price.recurring?.interval;
  const interval =
    recurring === "year" ? "yearly" : recurring === "month" ? "monthly" : null;
  return { plan, interval };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = billingSecretKey();
    if (!stripeKey) throw new Error("STRIPE_BILLING_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const token = authHeader.replace("Bearer ", "").trim();
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user?.email) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const email = userData.user.email;

    const stripe = await createStripeClient(stripeKey, { apiVersion: "2025-08-27.basil" });
    const customers = await stripe.customers.list({ email, limit: 1 });
    if (customers.data.length === 0) {
      return new Response(
        JSON.stringify({ error: "No billing record found for this account" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const customerId = customers.data[0].id;

    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 5,
      status: "paid",
    });
    const invoice = invoices.data[0];
    if (!invoice) {
      return new Response(
        JSON.stringify({ error: "No paid invoice found yet — please try again later." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Pull plan + interval from the subscription's first price.
    let plan: string | null = null;
    let interval: "monthly" | "yearly" | null = null;
    const subId = (invoice as any).subscription as string | null;
    if (subId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subId);
        const price = sub.items.data[0]?.price as Stripe.Price | undefined;
        const resolved = planFromPrice(price);
        plan = resolved.plan;
        interval = resolved.interval;
      } catch (e) {
        console.warn("[resend-subscription-receipt] could not retrieve subscription", e);
      }
    }

    const payload = {
      email,
      amount_cents: invoice.amount_paid ?? invoice.total ?? 0,
      currency: invoice.currency ?? "usd",
      invoice_id: invoice.id ?? "",
      hosted_invoice_url: invoice.hosted_invoice_url ?? null,
      period_end: (invoice as any).period_end ?? null,
      plan,
      interval,
    };

    const { data, error } = await supabase.functions.invoke(
      "send-subscription-receipt",
      { body: payload },
    );
    if (error) throw error;

    return new Response(
      JSON.stringify({
        ok: true,
        sent_to: email,
        plan,
        interval,
        invoice_id: invoice.id,
        period_end: payload.period_end,
        downstream: data,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[resend-subscription-receipt] error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

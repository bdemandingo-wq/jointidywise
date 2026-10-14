import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Used to "end trial now" for users already in a Stripe trial, or open
// a Checkout Session for users on an org-based free trial.
//
// Do not fall back to a hard-coded price id from the old Stripe account.
// Prefer the configured tier prices, with Pro monthly as the
// sensible default (the post-trial path is for users converting their
// trial, which is the canonical paid plan). Fail closed with a 503 if
// none are configured.
function resolveUpgradePriceId(): string | null {
  return (
    Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID") ||
    Deno.env.get("STRIPE_BASIC_MONTHLY_PRICE_ID") ||
    Deno.env.get("STRIPE_STANDARD_PRICE_ID") ||
    null
  );
}

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[UPGRADE-NOW] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = billingSecretKey();
    if (!stripeKey) throw new Error("STRIPE_BILLING_SECRET_KEY is not set");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Check for existing Stripe customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId: string | undefined;

    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Found Stripe customer", { customerId });

      // Check if they have a trialing subscription — end trial immediately
      const trialingSubs = await stripe.subscriptions.list({
        customer: customerId,
        status: "trialing",
        limit: 1,
      });

      if (trialingSubs.data.length > 0) {
        const subscription = trialingSubs.data[0];
        logStep("Found trialing subscription, ending trial now", { subscriptionId: subscription.id });

        const updated = await stripe.subscriptions.update(subscription.id, {
          trial_end: "now",
        });

        logStep("Trial ended successfully", { status: updated.status });

        return new Response(JSON.stringify({
          success: true,
          subscription_id: updated.id,
          status: updated.status,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      // Check if already actively subscribed
      const activeSubs = await stripe.subscriptions.list({
        customer: customerId,
        status: "active",
        limit: 1,
      });

      if (activeSubs.data.length > 0) {
        logStep("User already has an active subscription");
        return new Response(JSON.stringify({ error: "You already have an active subscription." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
    }

    // No trialing sub found — user is on org-based free trial
    // Create a Stripe Checkout session to start their paid subscription
    const priceId = resolveUpgradePriceId();
    if (!priceId) {
      logStep("No upgrade price ID configured");
      return new Response(
        JSON.stringify({
          error:
            "Upgrade is not configured yet. The operator needs to set STRIPE_PRO_MONTHLY_PRICE_ID (or STRIPE_BASIC_MONTHLY_PRICE_ID) in Supabase secrets.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 503,
        },
      );
    }

    const origin = req.headers.get("origin") || Deno.env.get("APP_URL") || "https://jointidywise.com";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${origin}/dashboard?subscription=success`,
      cancel_url: `${origin}/dashboard/subscription?canceled=true`,
    });

    logStep("Checkout session created for upgrade", { sessionId: session.id });

    return new Response(JSON.stringify({
      success: true,
      url: session.url,
      redirect: true,
    }), {
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

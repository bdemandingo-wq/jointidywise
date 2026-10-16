import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { embeddedCheckoutBody, embeddedCheckoutParams, readPublishableKey } from "../_shared/embedded-checkout.ts";
import { billingSecretKey } from "../_shared/billing-stripe.ts";
import { countLifetimeSpots } from "../_shared/lifetime-spots.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: any) => {
  console.log(`[CREATE-LIFETIME-CHECKOUT] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = billingSecretKey();
    if (!stripeKey) throw new Error("STRIPE_BILLING_SECRET_KEY is not set");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user?.email) throw new Error("User not authenticated");
    const user = userData.user;
    logStep("User authenticated", { userId: user.id, email: user.email });

    // Same count as get_lifetime_spots_remaining: total_spots for the cap,
    // lifetime_access_purchases for how many are sold.
    const spots = await countLifetimeSpots(supabase);

    if (!spots.available) {
      return new Response(
        JSON.stringify({ error: `Sorry — all ${spots.total} lifetime spots have been claimed.` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Check if this user already bought lifetime
    const { data: existingPurchase } = await supabase
      .from("lifetime_access_purchases")
      .select("id")
      .eq("email", user.email.toLowerCase())
      .maybeSingle();

    if (existingPurchase) {
      return new Response(
        JSON.stringify({ error: "You already have lifetime access." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const lifetimePriceId = Deno.env.get("STRIPE_LIFETIME_PRICE_ID");
    if (!lifetimePriceId) {
      return new Response(
        JSON.stringify({
          error: "Lifetime checkout is not configured on the server. STRIPE_LIFETIME_PRICE_ID is missing.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const origin = req.headers.get("origin") || Deno.env.get("APP_URL") || "https://jointidywise.com";

    // Get or create Stripe customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = customers.data.length > 0 ? customers.data[0].id : undefined;

    const publishableKey = readPublishableKey();
    if (!publishableKey) {
      return new Response(
        JSON.stringify({
          error: "Checkout is not configured. STRIPE_BILLING_PUBLISHABLE_KEY is missing on the server. Nothing was charged.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
      );
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      mode: "payment",
      ...embeddedCheckoutParams(origin),
      // Same dispute protection as buy-lifetime: always challenge the card.
      payment_method_options: {
        card: { request_three_d_secure: "any" },
      },
      metadata: {
        user_id: user.id,
        email: user.email,
        plan: "lifetime",
      },
      payment_intent_data: {
        metadata: {
          user_id: user.id,
          email: user.email,
          plan: "lifetime",
        },
      },
      line_items: [{ price: lifetimePriceId, quantity: 1 }],
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    logStep("Lifetime checkout session created", { sessionId: session.id, spotsLeft: spots.remaining - 1 });

    return new Response(
      JSON.stringify({
        ...embeddedCheckoutBody(session.client_secret, publishableKey),
        spotsRemaining: spots.remaining,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error: any) {
    logStep("ERROR", { message: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

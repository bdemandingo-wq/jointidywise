import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { lifetimeCallerStatus, lifetimeOrgStatus } from "../_shared/lifetime-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TOTAL_SPOTS = 100;
const LIFETIME_PRICE_CENTS = 20000; // $200.00

const logStep = (step: string, details?: any) => {
  console.log(`[CREATE-LIFETIME-CHECKOUT] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const token = authHeader?.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(authHeader.indexOf(" ") + 1).trim()
      : "";
    let authed: { id: string; email: string } | null = null;
    if (token && token !== anonKey) {
      const { data: userData, error: userError } = await supabase.auth.getUser(token);
      if (!userError && userData.user?.id && userData.user.email) {
        authed = { id: userData.user.id, email: userData.user.email };
      }
    }
    const rejected = lifetimeCallerStatus({ authorization: authHeader, anonKey, user: authed });
    if (rejected || !authed) {
      return new Response(JSON.stringify({ error: rejected?.error ?? "Sign in to claim a lifetime spot." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    const user = authed;
    logStep("User authenticated", { userId: user.id });

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    // Check spots remaining
    const { count, error: countError } = await supabase
      .from("lifetime_access_purchases")
      .select("id", { count: "exact", head: true });

    if (countError) throw countError;
    const used = count ?? 0;

    if (used >= TOTAL_SPOTS) {
      return new Response(
        JSON.stringify({ error: "Sorry — all 100 lifetime spots have been claimed." }),
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
        JSON.stringify({ error: "You already have lifetime access.", alreadyLifetime: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 }
      );
    }

    const { data: membership, error: membershipError } = await supabase
      .from("org_memberships")
      .select("organization_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (membershipError) throw membershipError;
    const organizationId = membership?.organization_id ?? null;
    const orgMissing = lifetimeOrgStatus(organizationId);
    if (orgMissing || !organizationId) {
      return new Response(JSON.stringify({
        error: orgMissing?.error ?? "Your workspace is still being set up. Try again in a moment.",
        code: orgMissing?.code ?? "org_not_ready",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 409,
      });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Use configured lifetime price ID if set, otherwise create a price on the fly
    const lifetimePriceId = Deno.env.get("STRIPE_LIFETIME_PRICE_ID");
    const origin = req.headers.get("origin") || Deno.env.get("APP_URL") || "https://jointidywise.com";

    // Get or create Stripe customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = customers.data.length > 0 ? customers.data[0].id : undefined;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      mode: "payment",
      success_url: `${origin}/dashboard?lifetime=success`,
      cancel_url: `${origin}/dashboard?lifetime=canceled`,
      metadata: {
        user_id: user.id,
        email: user.email,
        plan: "lifetime",
        organization_id: organizationId,
      },
      payment_intent_data: {
        metadata: {
          user_id: user.id,
          email: user.email,
          plan: "lifetime",
          organization_id: organizationId,
        },
      },
      line_items: lifetimePriceId
        ? [{ price: lifetimePriceId, quantity: 1 }]
        : [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: "TidyWise Lifetime Access",
                  description: `One-time payment — lifetime access to all TidyWise features. Spot ${used + 1} of ${TOTAL_SPOTS}.`,
                },
                unit_amount: LIFETIME_PRICE_CENTS,
              },
              quantity: 1,
            },
          ],
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    logStep("Lifetime checkout session created", { sessionId: session.id, spotsLeft: TOTAL_SPOTS - used - 1 });

    return new Response(
      JSON.stringify({ url: session.url, spotsRemaining: TOTAL_SPOTS - used }),
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

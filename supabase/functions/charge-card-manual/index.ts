import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { orgReconnectResponse } from "../_shared/get-org-stripe-settings.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) throw new Error("Unauthorized");

    const { organization_id, customer_name, amount, description } = await req.json();
    if (!organization_id || !customer_name || amount === undefined || amount === null) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Validate organization_id is a UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof organization_id !== "string" || !uuidRegex.test(organization_id)) {
      return new Response(JSON.stringify({ error: "Invalid organization_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Validate customer_name length
    if (typeof customer_name !== "string" || customer_name.trim().length === 0 || customer_name.length > 200) {
      return new Response(JSON.stringify({ error: "Invalid customer_name (must be 1-200 chars)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Validate amount: must be a positive number, max $100,000
    const amountNum = typeof amount === "number" ? amount : parseFloat(String(amount));
    if (!isFinite(amountNum) || isNaN(amountNum) || amountNum <= 0 || amountNum > 100000) {
      return new Response(JSON.stringify({ error: "Invalid amount: must be between $0.01 and $100,000" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Validate description length if provided
    if (description !== undefined && description !== null && (typeof description !== "string" || description.length > 1000)) {
      return new Response(JSON.stringify({ error: "Invalid description (max 1000 chars)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Verify org membership
    const { data: membership } = await supabaseAdmin
      .from("org_memberships")
      .select("role")
      .eq("organization_id", organization_id)
      .eq("user_id", user.id)
      .in("role", ["owner", "admin", "manager"])
      .maybeSingle();

    if (!membership) {
      return new Response(JSON.stringify({ error: "Not authorized for this organization" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Get org Stripe key (secrets live in org_stripe_secrets via SECURITY DEFINER RPC).
    const { data: secretRows } = await supabaseAdmin.rpc("get_org_stripe_secret", {
      p_org_id: organization_id,
    });
    const blocked = await orgReconnectResponse(organization_id, corsHeaders);
    if (blocked) return blocked;

    const orgSecret = Array.isArray(secretRows) ? secretRows[0] : secretRows;
    const stripeKey: string | null = orgSecret?.stripe_access_token || orgSecret?.stripe_secret_key || null;
    if (!stripeKey) {
      return new Response(JSON.stringify({ error: "Stripe not connected for this organization" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Create a payment intent (requires a payment method - use for direct charges)
    const amountCents = Math.round(amountNum * 100);

    // Create a payment link for manual charge
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      description: `Manual charge: ${customer_name.trim()} - ${description?.trim() || "No description"}`,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: {
        manual_charge: "true",
        customer_name: customer_name.trim().slice(0, 200),
        charged_by: user.id,
        organization_id,
      },
    });

    // Log in manual_payments
    await supabaseAdmin.from("manual_payments").insert({
      organization_id,
      customer_name: customer_name.trim(),
      amount: amountNum,
      description: description?.trim() || null,
      stripe_charge_id: paymentIntent.id,
      created_by: user.id,
    });

    return new Response(JSON.stringify({
      success: true,
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    console.error("charge-card-manual error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

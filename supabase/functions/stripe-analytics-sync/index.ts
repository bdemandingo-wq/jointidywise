import { createStripeClient } from "../_shared/stripe-client.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { resolveCallerOrg } from "../_shared/require-caller-org.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { date_from, date_to } = await req.json();

    if (!date_from || !date_to) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SECURITY: never trust organization_id from the request body — resolve
    // it from the caller's own JWT + org_memberships instead.
    const callerOrg = await resolveCallerOrg(req);
    if (!callerOrg.ok) {
      return new Response(JSON.stringify({ error: callerOrg.error }), {
        status: callerOrg.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const organization_id = callerOrg.ctx.organizationId;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get org's Stripe key. Secrets via audited RPC; connection flag from settings.
    const [{ data: secretRows, error: orgErr }, { data: orgConn }] = await Promise.all([
      supabase.rpc("get_org_stripe_secret", { p_org_id: organization_id }),
      supabase
        .from("org_stripe_settings")
        .select("is_connected")
        .eq("organization_id", organization_id)
        .maybeSingle(),
    ]);

    const orgSecret = Array.isArray(secretRows) ? secretRows[0] : secretRows;
    const stripeApiKey: string | null = orgSecret?.stripe_access_token || orgSecret?.stripe_secret_key || null;

    if (orgErr || !stripeApiKey || !orgConn?.is_connected) {
      return new Response(JSON.stringify({
        error: "stripe_not_connected",
        message: "Stripe is not connected for this organization",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = await createStripeClient(stripeApiKey, { organizationId: organization_id,
      apiVersion: "2023-10-16",
    });

    const fromTimestamp = Math.floor(new Date(date_from).getTime() / 1000);
    const toTimestamp = Math.floor(new Date(date_to).getTime() / 1000);

    // Fetch charges from Stripe
    let allCharges: any[] = [];
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const params: any = {
        created: { gte: fromTimestamp, lte: toTimestamp },
        limit: 100,
      };
      if (startingAfter) params.starting_after = startingAfter;

      const charges = await stripe.charges.list(params);
      allCharges = allCharges.concat(charges.data);
      hasMore = charges.has_more;
      if (charges.data.length > 0) {
        startingAfter = charges.data[charges.data.length - 1].id;
      }
    }

    // Fetch refunds
    let allRefunds: any[] = [];
    hasMore = true;
    startingAfter = undefined;

    while (hasMore) {
      const params: any = {
        created: { gte: fromTimestamp, lte: toTimestamp },
        limit: 100,
      };
      if (startingAfter) params.starting_after = startingAfter;

      const refunds = await stripe.refunds.list(params);
      allRefunds = allRefunds.concat(refunds.data);
      hasMore = refunds.has_more;
      if (refunds.data.length > 0) {
        startingAfter = refunds.data[refunds.data.length - 1].id;
      }
    }

    // Fetch disputes
    let allDisputes: any[] = [];
    hasMore = true;
    startingAfter = undefined;

    while (hasMore) {
      const params: any = {
        created: { gte: fromTimestamp, lte: toTimestamp },
        limit: 100,
      };
      if (startingAfter) params.starting_after = startingAfter;

      const disputes = await stripe.disputes.list(params);
      allDisputes = allDisputes.concat(disputes.data);
      hasMore = disputes.has_more;
      if (disputes.data.length > 0) {
        startingAfter = disputes.data[disputes.data.length - 1].id;
      }
    }

    // Calculate metrics
    const successfulCharges = allCharges.filter(c => c.status === "succeeded" && !c.refunded);
    const totalRevenue = successfulCharges.reduce((sum, c) => sum + c.amount, 0) / 100;
    const successfulPaymentsCount = successfulCharges.length;

    // Unique customers
    const uniqueCustomers = new Set(successfulCharges.map(c => c.customer).filter(Boolean));
    const newCustomersCount = uniqueCustomers.size;
    const spendPerCustomer = newCustomersCount > 0 ? totalRevenue / newCustomersCount : 0;

    // Total fees (from balance_transaction if available)
    const totalFees = successfulCharges.reduce((sum, c) => {
      if (c.balance_transaction && typeof c.balance_transaction === "object") {
        return sum + (c.balance_transaction.fee || 0);
      }
      // Estimate: 2.9% + $0.30
      return sum + (c.amount * 0.029 + 30);
    }, 0) / 100;

    // Refunds
    const totalRefunds = allRefunds.reduce((sum, r) => sum + r.amount, 0) / 100;
    const refundsCount = allRefunds.length;

    // Disputes
    const totalDisputes = allDisputes.reduce((sum, d) => sum + d.amount, 0) / 100;
    const disputesCount = allDisputes.length;

    // Net revenue
    const netRevenue = totalRevenue - totalFees - totalRefunds - totalDisputes;

    const result = {
      source: "stripe_live",
      synced_at: new Date().toISOString(),
      date_from,
      date_to,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      successful_payments_count: successfulPaymentsCount,
      new_customers_count: newCustomersCount,
      spend_per_customer: Math.round(spendPerCustomer * 100) / 100,
      total_fees: Math.round(totalFees * 100) / 100,
      total_refunds: Math.round(totalRefunds * 100) / 100,
      refunds_count: refundsCount,
      total_disputes: Math.round(totalDisputes * 100) / 100,
      disputes_count: disputesCount,
      net_revenue: Math.round(netRevenue * 100) / 100,
      charges: allCharges.length,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Stripe analytics sync error:", error);
    return new Response(JSON.stringify({
      error: "sync_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

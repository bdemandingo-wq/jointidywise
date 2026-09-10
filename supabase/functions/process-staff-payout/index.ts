import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[PROCESS-STAFF-PAYOUT] ${step}${d}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    // Authenticate admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Unauthorized");
    const userId = userData.user.id;
    logStep("Admin authenticated", { userId });

    const { staff_id, organization_id, amount, week_start, payment_method, notes } = await req.json();

    if (!staff_id || !organization_id || !amount || !week_start || !payment_method) {
      throw new Error("Missing required fields: staff_id, organization_id, amount, week_start, payment_method");
    }

    // Verify admin belongs to this org
    const { data: membership } = await supabaseAdmin
      .from('org_memberships')
      .select('role')
      .eq('user_id', userId)
      .eq('organization_id', organization_id)
      .maybeSingle();

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      throw new Error("Insufficient permissions");
    }
    logStep("Admin verified", { role: membership.role });

    // Check if already paid for this period
    const { data: existingPayment } = await supabaseAdmin
      .from('payroll_payments')
      .select('id')
      .eq('organization_id', organization_id)
      .eq('staff_id', staff_id)
      .eq('week_start', week_start)
      .maybeSingle();

    if (existingPayment) {
      throw new Error("This staff member has already been paid for this period");
    }

    let stripeTransferId: string | null = null;

    if (payment_method === 'stripe_transfer') {
      // Get the org's Stripe credentials. Secrets live in org_stripe_secrets
      // (no client RLS access); non-sensitive flags stay on org_stripe_settings.
      const [{ data: secretRows }, { data: orgConn }] = await Promise.all([
        supabaseAdmin.rpc('get_org_stripe_secret', { p_org_id: organization_id }),
        supabaseAdmin
          .from('org_stripe_settings')
          .select('stripe_account_id, is_connected')
          .eq('organization_id', organization_id)
          .maybeSingle(),
      ]);

      const orgSecret = Array.isArray(secretRows) ? secretRows[0] : secretRows;
      const orgStripeApiKey: string | null = orgSecret?.stripe_access_token || orgSecret?.stripe_secret_key || null;

      if (!orgStripeApiKey || !orgConn?.is_connected) {
        throw new Error("Organization does not have Stripe connected. Please connect Stripe in Payment Integration settings.");
      }
      logStep("Org Stripe verified");

      // Get cleaner's Stripe Express account
      const { data: payoutAccount } = await supabaseAdmin
        .from('staff_payout_accounts')
        .select('stripe_account_id, account_status, payouts_enabled')
        .eq('staff_id', staff_id)
        .eq('organization_id', organization_id)
        .maybeSingle();

      if (!payoutAccount?.stripe_account_id) {
        throw new Error("This cleaner has not set up their payout account yet");
      }

      if (payoutAccount.account_status !== 'active' || !payoutAccount.payouts_enabled) {
        throw new Error("This cleaner's payout account is not fully active. Current status: " + payoutAccount.account_status);
      }
      logStep("Cleaner payout account verified", { stripeAccountId: payoutAccount.stripe_account_id });

      // Create Stripe Transfer using the PLATFORM key.
      // Cleaner payout accounts are Stripe Connect Express accounts created
      // under the TidyWise platform, so transfers must originate from the
      // platform account — never from an individual organization's Stripe
      // connected account. Stripe rejects transfers between connected accounts.
      const platformStripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!platformStripeKey) {
        throw new Error("Platform Stripe key is not configured. Cannot process Stripe transfer.");
      }
      const platformStripeClient = new Stripe(platformStripeKey, { apiVersion: "2025-08-27.basil" });

      const amountCents = Math.round(amount * 100);
      logStep("Creating Stripe Transfer", { amountCents, destination: payoutAccount.stripe_account_id });

      const transfer = await platformStripeClient.transfers.create({
        amount: amountCents,
        currency: 'usd',
        destination: payoutAccount.stripe_account_id,
        description: `Payroll payment for period starting ${week_start}`,
        metadata: {
          staff_id,
          organization_id,
          week_start,
          paid_by: userId,
        },
      });

      stripeTransferId = transfer.id;
      logStep("Stripe Transfer created", { transferId: transfer.id });
    } else {
      logStep("Recording external payment", { method: payment_method });
    }

    // Record the payment
    const { data: payment, error: insertError } = await supabaseAdmin
      .from('payroll_payments')
      .insert({
        organization_id,
        staff_id,
        week_start,
        paid_by: userId,
        amount,
        payment_method,
        stripe_transfer_id: stripeTransferId,
        notes: notes || null,
      })
      .select()
      .single();

    if (insertError) throw insertError;
    logStep("Payment recorded", { paymentId: payment.id });

    return new Response(JSON.stringify({
      success: true,
      payment_id: payment.id,
      stripe_transfer_id: stripeTransferId,
      payment_method,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { sendStaffSms, sendStaffEmail, PORTAL_URL, FORGOT_URL } from "../_shared/staff-notify.ts";

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

      // Live check with Stripe right before moving money — the saved status can
      // be stale (Stripe may have asked for ID/bank info since it was synced).
      const live = await platformStripeClient.accounts.retrieve(payoutAccount.stripe_account_id);
      const disabledReason = live.requirements?.disabled_reason || null;
      const due = live.requirements?.currently_due || [];
      await supabaseAdmin.from('staff_payout_accounts').update({
        payouts_enabled: live.payouts_enabled || false,
        details_submitted: live.details_submitted || false,
        account_status: live.details_submitted ? (live.payouts_enabled ? 'active' : 'pending_verification') : 'onboarding',
        disabled_reason: disabledReason,
        requirements_currently_due: due,
        updated_at: new Date().toISOString(),
      }).eq('staff_id', staff_id).eq('organization_id', organization_id);
      if (!live.payouts_enabled || disabledReason) {
        const why = disabledReason
          ? `Stripe has paused this cleaner's payouts (${disabledReason.replace(/[._]/g, ' ')})`
          : "Stripe hasn't enabled payouts for this cleaner yet";
        const need = due.length ? ` — Stripe still needs: ${due.slice(0, 4).map((d) => d.replace(/[._]/g, ' ')).join(', ')}` : '';
        throw new Error(`${why}${need}. Nothing was sent. Ask the cleaner to open the Payouts tab in the staff portal and finish setup.`);
      }
      logStep("Cleaner payout account verified live", { stripeAccountId: payoutAccount.stripe_account_id });

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
        payout_status: stripeTransferId ? 'pending' : 'paid',
        status_updated_at: new Date().toISOString(),
        status_history: [{ status: stripeTransferId ? 'pending' : 'paid', at: new Date().toISOString() }],
      })
      .select()
      .single();

    if (insertError) throw insertError;
    logStep("Payment recorded", { paymentId: payment.id });

    // Tell the cleaner (Stripe payouts only). Best effort — never fails the payment.
    if (stripeTransferId) {
      const [{ data: s }, { data: org }] = await Promise.all([
        supabaseAdmin.from('staff').select('name, email, phone').eq('id', staff_id).eq('organization_id', organization_id).maybeSingle(),
        supabaseAdmin.from('organizations').select('name').eq('id', organization_id).maybeSingle(),
      ]);
      const biz = org?.name || 'Your employer';
      const amt = `$${Number(amount).toFixed(2)}`;
      const first = (s?.name || '').split(' ')[0] || 'there';
      // Estimated arrival: +2 business days (Stripe's exact date shows in the portal once the bank payout starts).
      const est = new Date();
      let added = 0;
      while (added < 2) { est.setUTCDate(est.getUTCDate() + 1); const d = est.getUTCDay(); if (d !== 0 && d !== 6) added++; }
      const estStr = est.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      const sms = `${biz}: Hi ${first}, you've been paid ${amt}. Estimated deposit: ${estStr}. It goes to your bank automatically. Nothing to accept. Track it in the staff portal: ${PORTAL_URL} (Forgot password? ${FORGOT_URL})`;
      const html = `<p>Hi ${first},</p><p><strong>${biz}</strong> just paid you <strong>${amt}</strong> for the period starting ${week_start}.</p><p><strong>Estimated deposit: ${estStr}</strong>. You don't need to accept anything. The money goes to your bank account automatically.</p><p><a href="${PORTAL_URL}">Open the staff portal</a> to track your payout status. <a href="${FORGOT_URL}">Forgot your password?</a></p>`;
      const [smsSent, emailSent] = await Promise.all([
        sendStaffSms(supabaseAdmin, organization_id, s?.phone ?? null, sms, 'process-staff-payout'),
        sendStaffEmail(organization_id, s?.email ?? null, `You've been paid ${amt}`, html, 'process-staff-payout'),
      ]);
      logStep("Cleaner notified", { smsSent, emailSent, organization_id, paid_by: userId });
    }

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

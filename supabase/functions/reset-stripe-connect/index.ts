import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { connectPlatformFromEnv, platformAccountColumnReady, staffConnectNeedsReconnect, writeRowRetryWithoutPlatform } from "../_shared/connect-platform.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const platformStripeKey = Deno.env.get("STRIPE_SECRET_KEY");

    if (!supabaseUrl || !serviceRoleKey || !platformStripeKey) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { staffId, organizationId, reason, initiatedBy } = await req.json();

    if (!staffId || !organizationId) {
      return new Response(JSON.stringify({ error: "staffId and organizationId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const initiator = initiatedBy === "admin" ? "admin" : "cleaner";

    // If cleaner-initiated, verify the staff belongs to this user
    if (initiator === "cleaner") {
      const { data: staffRecord, error: staffErr } = await supabase
        .from("staff")
        .select("id, name, email, user_id, organization_id")
        .eq("id", staffId)
        .eq("user_id", userData.user.id)
        .single();

      if (staffErr || !staffRecord || staffRecord.organization_id !== organizationId) {
        return new Response(JSON.stringify({ error: "Staff record not found or access denied" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      // Admin-initiated: verify the user is an admin of the org
      const { data: membership } = await supabase
        .from("org_memberships")
        .select("role")
        .eq("user_id", userData.user.id)
        .eq("organization_id", organizationId)
        .single();

      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return new Response(JSON.stringify({ error: "Admin access required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Get existing payout account
    const { data: existingAccount } = await supabase
      .from("staff_payout_accounts")
      .select("*")
      .eq("staff_id", staffId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!existingAccount?.stripe_account_id) {
      return new Response(JSON.stringify({ error: "No existing payout account to reset" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(platformStripeKey, { apiVersion: "2025-08-27.basil" });
    const platform = connectPlatformFromEnv();
    const stalePlatform = staffConnectNeedsReconnect(
      existingAccount.platform_account_id,
      existingAccount.stripe_account_id,
      platform,
    );

    // Check current account status. A stale platform account is not on this
    // Stripe key, so do not retrieve it or read its balance.
    let oldAccount;
    if (!stalePlatform) {
      try {
        oldAccount = await stripe.accounts.retrieve(existingAccount.stripe_account_id);
      } catch (err: any) {
        console.error("[reset-stripe-connect] Failed to retrieve old account:", err.message);
        oldAccount = null;
      }
    }

    // Block reset if onboarding is in progress (details submitted but not yet verified)
    if (oldAccount && oldAccount.details_submitted && !oldAccount.payouts_enabled &&
        existingAccount.account_status === "pending_verification") {
      return new Response(JSON.stringify({
        error: "Setup is currently in progress. Please wait for it to complete or contact support.",
        code: "onboarding_in_progress",
      }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check for pending payouts (balance) on the old account
    let pendingAmount = 0;
    if (oldAccount) {
      try {
        const balance = await stripe.balance.retrieve({ stripeAccount: existingAccount.stripe_account_id });
        for (const b of balance.pending || []) {
          pendingAmount += b.amount;
        }
      } catch (err: any) {
        console.warn("[reset-stripe-connect] Could not check balance:", err.message);
      }
    }

    const previousAccountId = existingAccount.stripe_account_id;
    const columnReady = await platformAccountColumnReady(() =>
      supabase.from("staff_payout_accounts").select("platform_account_id").limit(1)
    );
    if ((platform.switched || platform.platformAccountId) && !columnReady) {
      return new Response(JSON.stringify({
        error: "Apply the platform_account_id migration before resetting payout accounts. Nothing was created.",
      }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (platform.switched && !platform.platformAccountId) {
      return new Response(JSON.stringify({
        error: "STRIPE_PLATFORM_ACCOUNT_ID is not set. Nothing was created.",
      }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get staff info for the new account
    const { data: staffInfo } = await supabase
      .from("staff")
      .select("name, email")
      .eq("id", staffId)
      .single();

    // Create a fresh Stripe Connect Express account
    const newAccount = await stripe.accounts.create({
      type: "express",
      email: staffInfo?.email || undefined,
      metadata: {
        staff_id: staffId,
        organization_id: organizationId,
        reset_from: previousAccountId,
      },
      capabilities: {
        transfers: { requested: true },
      },
    });

    console.log("[reset-stripe-connect] New account created:", newAccount.id, "replacing:", previousAccountId);

    // Update payout account record with new account (archive old one).
    // If this fails, the DB keeps pointing at previousAccountId while
    // the customer completes onboarding for newAccount.id below —
    // payouts would keep silently routing to the reset-away-from
    // account. Fail here rather than send them an onboarding link for
    // an account our system doesn't actually have linked.
    const { error: payoutUpdateError } = await writeRowRetryWithoutPlatform(
      (row) => supabase
        .from("staff_payout_accounts")
        .update(row)
        .eq("staff_id", staffId)
        .eq("organization_id", organizationId),
      {
        stripe_account_id: newAccount.id,
        platform_account_id: platform.platformAccountId,
        account_status: "onboarding",
        payouts_enabled: false,
        charges_enabled: false,
        details_submitted: false,
        bank_last4: null,
        account_holder_name: staffInfo?.name || null,
        requirements_currently_due: [],
        requirements_pending_verification: [],
        disabled_reason: null,
        stripe_requirements_errors: [],
        onboarding_url: null,
        last_webhook_at: null,
        updated_at: new Date().toISOString(),
      },
    );

    if (payoutUpdateError) {
      console.error(
        "[reset-stripe-connect] CRITICAL: new Stripe Connect account created but staff_payout_accounts still points at the old account:",
        { staffId, organizationId, previousAccountId, newAccountId: newAccount.id, error: payoutUpdateError },
      );
      return new Response(
        JSON.stringify({ error: "Could not complete the payout reset — please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Log the reset (audit trail — non-fatal if it fails, the reset itself already succeeded)
    const { error: resetHistoryError } = await supabase.from("stripe_reset_history").insert({
      staff_id: staffId,
      organization_id: organizationId,
      previous_stripe_account_id: previousAccountId,
      new_stripe_account_id: newAccount.id,
      reason: reason || null,
      initiated_by: initiator,
      initiated_by_user_id: userData.user.id,
    });
    if (resetHistoryError) {
      console.error("[reset-stripe-connect] stripe_reset_history insert failed (non-fatal):", resetHistoryError);
    }

    // Create account link for the new account
    const baseReturnUrl = "https://jointidywise.com";
    const accountLink = await stripe.accountLinks.create({
      account: newAccount.id,
      refresh_url: `${baseReturnUrl}/staff?tab=payouts`,
      return_url: `${baseReturnUrl}/staff?tab=payouts&setup=complete`,
      type: "account_onboarding",
    });

    // If admin-initiated, create notification for the cleaner
    if (initiator === "admin") {
      const { error: notifyError } = await supabase.from("cleaner_notifications").insert({
        staff_id: staffId,
        organization_id: organizationId,
        type: "payout_reset",
        title: "Payout Setup Reset",
        message: "Your payout setup has been reset by support. Please log in and reconnect your bank account.",
      });
      if (notifyError) {
        console.error("[reset-stripe-connect] cleaner_notifications insert failed (non-fatal):", notifyError);
      }
    }

    // Resolve any open stripe_requirement_notifications for the old account
    const { error: resolveNotifError } = await supabase
      .from("stripe_requirement_notifications")
      .update({ resolved_at: new Date().toISOString() })
      .eq("staff_id", staffId)
      .eq("organization_id", organizationId)
      .is("resolved_at", null);
    if (resolveNotifError) {
      console.error("[reset-stripe-connect] stripe_requirement_notifications resolve failed (non-fatal):", resolveNotifError);
    }

    return new Response(JSON.stringify({
      success: true,
      url: accountLink.url,
      newAccountId: newAccount.id,
      previousAccountId,
      pendingAmount: pendingAmount / 100,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[reset-stripe-connect] Error:", error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

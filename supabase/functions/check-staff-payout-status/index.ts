import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

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

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerId = userData.user.id;

    const { staffId, organizationId: requestedOrgId } = await req.json();

    if (!staffId || !requestedOrgId) {
      return new Response(JSON.stringify({ error: "staffId and organizationId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SECURITY: a valid JWT alone isn't enough — without this, any
    // authenticated user could read any other org's staff payout status
    // (bank last 4, Stripe requirements, disabled reasons) by supplying a
    // different staffId/organizationId. Two legitimate caller shapes:
    //   1. An owner/admin/manager checking a staff member's status from the
    //      admin dashboard — allowed for any staffId in THEIR org.
    //   2. A staff-portal user checking their OWN payout setup — allowed
    //      only when staffId resolves to their own staff record.
    const { data: memberships } = await supabase
      .from("org_memberships")
      .select("organization_id, role")
      .eq("user_id", callerId);

    const adminMembership = (memberships ?? []).find(
      (m: { organization_id: string; role: string }) =>
        m.organization_id === requestedOrgId && ["owner", "admin", "manager"].includes(m.role)
    );

    let organizationId: string;
    if (adminMembership) {
      organizationId = requestedOrgId;
    } else {
      // Scope the lookup to the requested org. A cleaner who works for two
      // businesses has two staff rows, and the old unscoped .maybeSingle()
      // errored (PGRST116) -> staffRow null -> a bogus 403 on the payout
      // screen for exactly the people most likely to use it.
      const { data: staffRow } = await supabase
        .from("staff")
        .select("id, organization_id")
        .eq("user_id", callerId)
        .eq("organization_id", requestedOrgId)
        .eq("id", staffId)
        .maybeSingle();

      if (!staffRow) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      organizationId = staffRow.organization_id;
    }


    // Get existing payout account record
    const { data: payoutAccount } = await supabase
      .from("staff_payout_accounts")
      .select("*")
      .eq("staff_id", staffId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!payoutAccount?.stripe_account_id) {
      return new Response(JSON.stringify({
        status: "not_started",
        payoutsEnabled: false,
        detailsSubmitted: false,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch latest status from Stripe using the PLATFORM key.
    // Cleaner payout accounts are Stripe Connect Express accounts created under the platform,
    // so they must be retrieved with the platform secret key rather than the organization's key.
    const platformStripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!platformStripeKey) {
      return new Response(JSON.stringify({
        error: "platform_stripe_not_configured",
        status: "not_started",
        payoutsEnabled: false,
        detailsSubmitted: false,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(platformStripeKey, { apiVersion: "2025-08-27.basil" });

    const account = await stripe.accounts.retrieve(payoutAccount.stripe_account_id);

    const newStatus = account.details_submitted
      ? (account.payouts_enabled ? "active" : "pending_verification")
      : "onboarding";

    // Get bank info if available
    let bankLast4: string | null = null;
    if (account.external_accounts?.data?.length > 0) {
      const bankAccount = account.external_accounts.data[0];
      bankLast4 = bankAccount.last4 || null;
    }

    // Extract requirements details
    const requirementsCurrentlyDue = account.requirements?.currently_due || [];
    const requirementsPendingVerification = account.requirements?.pending_verification || [];
    const disabledReason = account.requirements?.disabled_reason || null;
    const requirementsErrors = account.requirements?.errors || [];

    // Update local record with full requirements data
    await supabase
      .from("staff_payout_accounts")
      .update({
        account_status: newStatus,
        payouts_enabled: account.payouts_enabled || false,
        charges_enabled: account.charges_enabled || false,
        details_submitted: account.details_submitted || false,
        bank_last4: bankLast4,
        requirements_currently_due: requirementsCurrentlyDue,
        requirements_pending_verification: requirementsPendingVerification,
        disabled_reason: disabledReason,
        stripe_requirements_errors: requirementsErrors,
        updated_at: new Date().toISOString(),
      })
      .eq("staff_id", staffId)
      .eq("organization_id", organizationId);

    return new Response(JSON.stringify({
      status: newStatus,
      payoutsEnabled: account.payouts_enabled || false,
      chargesEnabled: account.charges_enabled || false,
      detailsSubmitted: account.details_submitted || false,
      bankLast4: bankLast4,
      accountHolderName: payoutAccount.account_holder_name,
      requirementsCurrentlyDue,
      requirementsPendingVerification,
      disabledReason,
      requirementsErrors,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error checking payout status:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

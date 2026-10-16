import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  connectPlatformFromEnv,
  platformAccountColumnReady,
  staffConnectNeedsReconnect,
  writeRowRetryWithoutPlatform,
} from "../_shared/connect-platform.ts";

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
      console.error("[create-staff-connect-account] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
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

    // Authenticate the user
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
      console.error("[create-staff-connect-account] Auth error:", userError?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { staffId, organizationId, returnUrl, country: countryRaw } = await req.json();
    // Supported Stripe Express countries (common subset). Default US.
    const SUPPORTED_COUNTRIES = ["US","AU","GB","CA","NZ","IE","FR","DE","ES","IT","NL","BE","AT","PT","FI","SE","DK","NO","CH","SG","HK","JP","MX","BR"];
    const country = (typeof countryRaw === "string" && SUPPORTED_COUNTRIES.includes(countryRaw.toUpperCase()))
      ? countryRaw.toUpperCase()
      : "US";
    console.log("[create-staff-connect-account] Request:", { staffId, organizationId, userId: userData.user.id });

    if (!staffId || !organizationId) {
      return new Response(JSON.stringify({ error: "staffId and organizationId are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up the staff record (service role bypasses RLS)
    const { data: staffRecord, error: staffError } = await supabase
      .from("staff")
      .select("id, name, email, user_id, organization_id")
      .eq("id", staffId)
      .maybeSingle();

    if (staffError || !staffRecord) {
      console.error("[create-staff-connect-account] Staff lookup failed:", staffError?.message);
      return new Response(JSON.stringify({
        error: "Staff record not found",
        code: "STAFF_NOT_FOUND",
        reason: "No staff record exists for the provided staffId in this organization.",
        action: "Ask an owner/admin to verify this staff member exists in Settings → Staff.",
        details: { staffId, organizationId, callerUserId: userData.user.id },
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorize: caller must be the staff member OR an admin/owner of the staff's org
    const isSelf = staffRecord.user_id === userData.user.id;
    let membershipRole: string | null = null;
    let isAdmin = false;
    if (!isSelf) {
      const { data: membership } = await supabase
        .from("org_memberships")
        .select("role")
        .eq("organization_id", staffRecord.organization_id)
        .eq("user_id", userData.user.id)
        .maybeSingle();
      membershipRole = (membership as any)?.role ?? null;
      isAdmin = !!membershipRole && ["owner", "admin"].includes(membershipRole);
    }
    if (!isSelf && !isAdmin) {
      console.error("[create-staff-connect-account] Access denied for user", userData.user.id, "on staff", staffId);
      const reason = membershipRole
        ? `Your role in this organization is "${membershipRole}", which cannot manage payouts for other staff.`
        : "You are not the staff member, and you have no owner/admin membership in this staff's organization.";
      return new Response(JSON.stringify({
        error: "Access denied",
        code: "ACCESS_DENIED",
        reason,
        action: "Sign in as the staff member, or have an owner/admin of that organization complete this step.",
        details: {
          staffId,
          staffOrganizationId: staffRecord.organization_id,
          staffUserId: staffRecord.user_id,
          callerUserId: userData.user.id,
          callerRoleInStaffOrg: membershipRole,
        },
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify org matches
    if (staffRecord.organization_id !== organizationId) {
      return new Response(JSON.stringify({
        error: "Organization mismatch",
        code: "ORG_MISMATCH",
        reason: `Staff belongs to organization ${staffRecord.organization_id}, but the request was made for ${organizationId}.`,
        action: "Switch to the correct organization using the business switcher and try again.",
        details: { staffOrganizationId: staffRecord.organization_id, requestedOrganizationId: organizationId },
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }



    // Use PLATFORM Stripe key for creating Connect Express accounts
    // Org keys are connected accounts themselves and cannot create sub-accounts
    const platformStripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!platformStripeKey) {
      console.error("[create-staff-connect-account] Missing STRIPE_SECRET_KEY (platform key)");
      return new Response(JSON.stringify({ 
        error: "Platform payment configuration missing. Please contact support."
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const stripe = new Stripe(platformStripeKey, { apiVersion: "2025-08-27.basil" });
    console.log("[create-staff-connect-account] Using platform Stripe key for Connect account creation");

    // Check if account already exists
    const { data: existingAccount } = await supabase
      .from("staff_payout_accounts")
      .select("*")
      .eq("staff_id", staffId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    const platform = connectPlatformFromEnv();
    const stale = !!(existingAccount?.stripe_account_id && staffConnectNeedsReconnect(
      existingAccount.platform_account_id,
      existingAccount.stripe_account_id,
      platform,
    ));
    let stripeAccountId = stale ? null : existingAccount?.stripe_account_id;

    if (!stripeAccountId) {
      const columnReady = await platformAccountColumnReady(() =>
        supabase.from("staff_payout_accounts").select("platform_account_id").limit(1)
      );
      if ((platform.switched || platform.platformAccountId) && !columnReady) {
        return new Response(JSON.stringify({
          error: "Apply the platform_account_id migration before creating payout accounts. Nothing was created.",
        }), {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (platform.switched && !platform.platformAccountId) {
        return new Response(JSON.stringify({
          error: "STRIPE_PLATFORM_ACCOUNT_ID is not set. Nothing was created.",
        }), {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.log("[create-staff-connect-account] Creating new Express account for staff:", staffId);
      // Create a new Stripe Connect Express account
      const account = await stripe.accounts.create({
        type: "express",
        country,
        email: staffRecord.email,
        metadata: {
          staff_id: staffId,
          organization_id: organizationId,
        },
        capabilities: {
          transfers: { requested: true },
        },
      });

      stripeAccountId = account.id;
      console.log("[create-staff-connect-account] Created Stripe account:", stripeAccountId);

      // Save to database. A stale Express account is replaced, not reused:
      // accountLinks on the old platform id would fail against the new key.
      const { error: payoutAccountError } = await writeRowRetryWithoutPlatform(
        (row) => supabase.from("staff_payout_accounts").upsert(row, { onConflict: "staff_id,organization_id" }),
        {
          staff_id: staffId,
          organization_id: organizationId,
          stripe_account_id: stripeAccountId,
          platform_account_id: platform.platformAccountId,
          account_status: "onboarding",
          account_holder_name: staffRecord.name,
          payouts_enabled: false,
          charges_enabled: false,
          details_submitted: false,
          bank_last4: null,
          disabled_reason: null,
          requirements_currently_due: [],
          requirements_pending_verification: [],
          stripe_requirements_errors: [],
          onboarding_url: null,
        },
      );

      if (payoutAccountError) {
        // The Stripe account exists but isn't linked — sending them an
        // onboarding link now would let them finish setup at Stripe for
        // an account our system can never find again (no webhook match,
        // no payout routing). Fail here instead; a retry creates a new
        // account attempt rather than silently orphaning this one.
        console.error(
          "[create-staff-connect-account] CRITICAL: Stripe Connect account created but staff_payout_accounts save failed:",
          { staffId, organizationId, stripeAccountId, error: payoutAccountError },
        );
        return new Response(
          JSON.stringify({ error: "Could not save your payout account — please try again." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else {
      console.log("[create-staff-connect-account] Reusing existing Stripe account:", stripeAccountId);
    }

    // Create an account link for onboarding
    // ALWAYS use production URL for Stripe redirects to avoid preview URL issues
    const baseReturnUrl = "https://jointidywise.com";

    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${baseReturnUrl}/staff?tab=payouts`,
      return_url: `${baseReturnUrl}/staff?tab=payouts&setup=complete`,
      type: "account_onboarding",
    });

    console.log("[create-staff-connect-account] Account link created successfully");

    // Update onboarding URL
    await supabase
      .from("staff_payout_accounts")
      .update({ onboarding_url: accountLink.url, updated_at: new Date().toISOString() })
      .eq("staff_id", staffId)
      .eq("organization_id", organizationId);

    return new Response(JSON.stringify({
      url: accountLink.url,
      accountId: stripeAccountId,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[create-staff-connect-account] Error:", error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

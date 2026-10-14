import { createStripeClient } from "../_shared/stripe-client.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAdminAuth, createUnauthorizedResponse } from "../_shared/verify-admin-auth.ts";
import { verifyPortalSession } from "../_shared/portal-session.ts";
import { logAudit, AuditActions } from "../_shared/audit-log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-portal-session",
};

interface SetupIntentRequest {
  email: string;
  customerName: string;
  organizationId: string;
  publicBooking?: boolean;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: SetupIntentRequest = await req.json();
    let { email, customerName, organizationId } = body;
    const { publicBooking } = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    let authUserId: string | null = null;
    let callerKind: "admin" | "portal" | "public" = "public";

    // ---- Branch 1: portal session (checked FIRST) ----
    const hasPortalToken = !!req.headers.get("x-portal-session");
    if (hasPortalToken) {
      const session = await verifyPortalSession(req, supabase);
      if (!session.ok) {
        return new Response(
          JSON.stringify({ error: session.error }),
          { status: session.status, headers: { "Content-Type": "application/json", ...corsHeaders } },
        );
      }
      callerKind = "portal";
      // Identity comes from the VERIFIED SESSION, never the body.
      organizationId = session.organization_id;
      const { data: cust, error: custErr } = await supabase
        .from("customers")
        .select("email, first_name, last_name")
        .eq("id", session.customer_id)
        .maybeSingle();
      if (custErr) {
        return new Response(
          JSON.stringify({ error: "Failed to load customer" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
        );
      }
      if (!cust?.email) {
        return new Response(
          JSON.stringify({ error: "No email on file for this account" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
        );
      }
      email = cust.email;
      customerName = `${cust.first_name ?? ""} ${cust.last_name ?? ""}`.trim() || cust.email;
    }

    // SECURITY: Require organization context always
    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: "Organization ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    if (callerKind !== "portal") {
      if (publicBooking) {
        // ---- Branch 2: anonymous public booking (constrained below) ----
        callerKind = "public";
        console.log("Public booking card setup for:", { email, customerName, organizationId });
      } else {
        // ---- Branch 3: admin JWT (unchanged) ----
        const authResult = await verifyAdminAuth(req.headers.get("Authorization"), {
          requireAdmin: true,
          requireOrganizationId: organizationId,
        });

        if (!authResult.success) {
          console.error("Auth failed:", authResult.error);
          return createUnauthorizedResponse(authResult.error || "Unauthorized", corsHeaders);
        }

        callerKind = "admin";
        authUserId = authResult.userId!;
      }
    }

    console.log("Creating SetupIntent for:", { email, customerName, organizationId, callerKind });

    if (!email || !customerName) {
      return new Response(
        JSON.stringify({ error: "Email and customer name are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // STRICT ISOLATION: Get organization-specific Stripe credentials
    const [{ data: secretRows }, { data: orgSettings }] = await Promise.all([
      supabase.rpc("get_org_stripe_secret", { p_org_id: organizationId }),
      supabase
        .from("org_stripe_settings")
        .select("stripe_publishable_key")
        .eq("organization_id", organizationId)
        .maybeSingle(),
    ]);

    const orgSecret = Array.isArray(secretRows) ? secretRows[0] : secretRows;
    const stripeSecretKey: string | null = orgSecret?.stripe_access_token || orgSecret?.stripe_secret_key || null;
    const stripePublishableKey = orgSettings?.stripe_publishable_key ?? null;

    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured for this organization. Please connect your Stripe account in Settings → Payments." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    const stripe = await createStripeClient(stripeSecretKey, { organizationId: organizationId, apiVersion: "2025-08-27.basil" });

    // SECURITY FIX: Look for customer with matching email AND organization_id in metadata
    const customers = await stripe.customers.list({ email: email, limit: 100 });
    let customerId: string;

    // Find customer that belongs to THIS organization
    const orgCustomer = customers.data.find((c: Stripe.Customer) => {
      return c.metadata?.organization_id === organizationId;
    });

    // ---- Part 3: constrain the anonymous branch ----
    // A first-time customer is legitimate. Attaching a card to a customer who
    // already has a portal login or a card on file is the chargeback vector;
    // that customer has an authenticated route (the portal Payment tab).
    if (callerKind === "public") {
      const normalizedEmail = email.trim().toLowerCase();

      const { data: existingCustomers } = await supabase
        .from("customers")
        .select("id")
        .eq("organization_id", organizationId)
        .ilike("email", normalizedEmail);

      let hasPortalLogin = false;
      const customerIds = (existingCustomers ?? []).map((c: { id: string }) => c.id);
      if (customerIds.length > 0) {
        const { data: portalUsers } = await supabase
          .from("client_portal_users")
          .select("id")
          .eq("organization_id", organizationId)
          .in("customer_id", customerIds)
          .limit(1);
        hasPortalLogin = (portalUsers ?? []).length > 0;
      }

      const hasDefaultCard = !!(
        orgCustomer &&
        typeof orgCustomer !== "string" &&
        (orgCustomer as Stripe.Customer).invoice_settings?.default_payment_method
      );

      if (hasPortalLogin || hasDefaultCard) {
        console.warn("[create-setup-intent] Rejected anonymous card attach for established customer", {
          organizationId,
          hasPortalLogin,
          hasDefaultCard,
        });
        return new Response(
          JSON.stringify({
            error: "This email already has an account. Please sign in to your client portal to update your card.",
            code: "existing_customer",
          }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } },
        );
      }
    }

    if (orgCustomer) {
      customerId = orgCustomer.id;
      console.log("Found existing org-specific Stripe customer:", customerId);
    } else {
      // Create new customer WITH organization_id in metadata for isolation
      const newCustomer = await stripe.customers.create({
        email: email,
        name: customerName,
        metadata: {
          organization_id: organizationId,
        },
      });
      customerId = newCustomer.id;
      console.log("Created new org-specific Stripe customer:", customerId);
    }

    // Create a SetupIntent
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
    });

    // Log the setup intent creation (only for authenticated users)
    if (authUserId) {
      await logAudit({
        action: AuditActions.CARD_SAVED,
        userId: authUserId,
        organizationId: organizationId,
        details: {
          customerId,
          customerEmail: email,
          setupIntentId: setupIntent.id,
        },
      });
    }

    console.log("Created SetupIntent:", setupIntent.id);

    return new Response(JSON.stringify({
      clientSecret: setupIntent.client_secret,
      customerId: customerId,
      publishableKey: stripePublishableKey || null,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    // Surface Stripe error details in logs so we can diagnose 500s (bad key,
    // revoked account, invalid email, etc.) instead of just "Error: ...".
    const stripeType = error?.type || error?.raw?.type;
    const stripeCode = error?.code || error?.raw?.code;
    const stripeStatus = typeof error?.statusCode === 'number' ? error.statusCode : undefined;
    console.error("Error in create-setup-intent function:", {
      message: error?.message,
      stripeType,
      stripeCode,
      stripeStatus,
      requestId: error?.requestId,
    });

    const isAuthError =
      stripeType === 'StripeAuthenticationError' ||
      stripeType === 'StripePermissionError' ||
      stripeStatus === 401 ||
      stripeStatus === 403;
    const status = isAuthError ? 400 : 500;
    const message = isAuthError
      ? "This organization's Stripe connection is invalid or revoked. Please reconnect Stripe in Settings → Payments."
      : (error?.message || "Failed to create SetupIntent");

    return new Response(
      JSON.stringify({ error: message, code: stripeCode ?? null }),
      { status, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
};

serve(handler);

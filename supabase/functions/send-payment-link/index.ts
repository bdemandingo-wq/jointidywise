import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAdminAuth, createUnauthorizedResponse, createForbiddenResponse } from "../_shared/verify-admin-auth.ts";
import { logAudit, AuditActions } from "../_shared/audit-log.ts";
import { getOrgStripeClient } from "../_shared/get-org-stripe-settings.ts";
import { sendOpenPhoneMessage } from "../_shared/openphone-send.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PaymentLinkRequest {
  phone: string;  // Customer phone number for SMS
  customerName: string;
  amount: number;
  serviceName: string;
  bookingId?: string;
  organizationId: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: PaymentLinkRequest = await req.json();
    const { phone, customerName, amount, serviceName, bookingId, organizationId } = body;

    // SECURITY: Organization context required before auth so membership is
    // verified against THIS org (multi-org users pick their active org).
    if (!organizationId) {
      console.error("Missing organizationId - cannot send payment link without organization context");
      return new Response(JSON.stringify({
        error: "Missing organizationId - organization context is required"
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // SECURITY: Verify authenticated user has admin privileges IN THE REQUESTED ORG
    const authResult = await verifyAdminAuth(req.headers.get("Authorization"), {
      requireAdmin: true,
      requireOrganizationId: organizationId,
    });

    if (!authResult.success) {
      console.error("Auth failed:", authResult.error);
      return createForbiddenResponse(authResult.error || "Unauthorized", corsHeaders);
    }

    console.log("Received payment link request:", { phone, customerName, amount, serviceName, bookingId, organizationId, userId: authResult.userId });

    if (!phone || !customerName || !amount) {
      return new Response(
        JSON.stringify({ error: "Missing required fields (phone, customerName, amount)" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // STRICT ISOLATION: Get organization-specific Stripe credentials via shared helper
    const stripeResult = await getOrgStripeClient(organizationId);
    if (!stripeResult.success || !stripeResult.stripe) {
      return new Response(
        JSON.stringify({ error: stripeResult.error || "Stripe not configured for this organization. Please connect your Stripe account in Settings → Payments." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    const stripe = stripeResult.stripe;

    // Shared Supabase client for org settings (SMS, business settings)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Get organization SMS settings for OpenPhone
    const { data: smsSettings, error: smsError } = await supabase
      .from("organization_sms_settings")
      .select("openphone_api_key, openphone_phone_number_id, sms_enabled")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (smsError || !smsSettings) {
      console.error("SMS settings error:", smsError);
      return new Response(
        JSON.stringify({ error: "SMS not configured. Please set up OpenPhone in Settings → SMS." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!smsSettings.sms_enabled) {
      return new Response(
        JSON.stringify({ error: "SMS is disabled for this organization." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const apiKey = smsSettings.openphone_api_key;
    let phoneNumberId = smsSettings.openphone_phone_number_id;

    if (!apiKey || !phoneNumberId) {
      return new Response(
        JSON.stringify({ error: "OpenPhone not configured. Please add your API Key and Phone Number ID in Settings → SMS." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Extract phone number ID if a full URL was pasted
    const pnMatch = phoneNumberId.match(/(PN[a-zA-Z0-9]+)/);
    if (pnMatch) {
      phoneNumberId = pnMatch[1];
    }

    // Get company name for SMS
    const { data: businessSettings } = await supabase
      .from("business_settings")
      .select("company_name")
      .eq("organization_id", organizationId)
      .maybeSingle();

    const companyName = businessSettings?.company_name || "Your Cleaning Service";

    // Format phone number
    let formattedPhone = phone.replace(/\D/g, "");
    if (formattedPhone.length === 10) {
      formattedPhone = "+1" + formattedPhone;
    } else if (!formattedPhone.startsWith("+")) {
      formattedPhone = "+" + formattedPhone;
    }

    // STRICT ISOLATION: Look for customer scoped to this organization by phone + org metadata
    // List all customers, then filter to only those belonging to this org
    const customers = await stripe.customers.list({ limit: 100 });
    let customerId: string | undefined;
    
    // Only accept customers explicitly tagged to this org
    const orgCustomer = customers.data.find((c: Stripe.Customer) =>
      c.metadata?.organization_id === organizationId &&
      (c.phone === formattedPhone || c.metadata?.phone === formattedPhone)
    );

    if (orgCustomer) {
      customerId = orgCustomer.id;
      console.log("Found existing org-specific Stripe customer by phone:", customerId);
    }
    
    if (!customerId) {
      const newCustomer = await stripe.customers.create({
        name: customerName,
        phone: formattedPhone,
        metadata: {
          organization_id: organizationId,
          phone: formattedPhone,
        },
      });
      customerId = newCustomer.id;
      console.log("Created new org-specific Stripe customer:", customerId);
    }

    // Create a Stripe Checkout session in SETUP mode to save card without charging
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "setup",  // SETUP mode = save card only, NO charge
      payment_method_types: ["card"],
      success_url: `${Deno.env.get("APP_URL") || "https://jointidywise.com"}/card-saved?success=true`,
      cancel_url: `${Deno.env.get("APP_URL") || "https://jointidywise.com"}/card-saved?cancelled=true`,
      metadata: {
        bookingId: bookingId || "",
        customerName: customerName,
        serviceName: serviceName,
        organization_id: organizationId,
        amount: amount.toString(),  // Store amount for reference (not charged)
      },
    });

    console.log("Created Stripe checkout session:", session.id, "URL:", session.url);

    // Send SMS with the card collection link via OpenPhone
    const smsMessage = `Hi ${customerName}! ${companyName} here. Please add your card on file for your $${amount.toFixed(2)} ${serviceName} service. Your card will NOT be charged until after your service. Tap here: ${session.url}`;

    console.log("[send-payment-link] Sending SMS via OpenPhone to:", formattedPhone);

    const paymentSent = await sendOpenPhoneMessage({
      supabase,
      organizationId,
      to: formattedPhone,
      content: smsMessage,
      from: phoneNumberId,
      apiKey,
      tag: "send-payment-link",
    });
    if (paymentSent.skipped) {
      return new Response(
        JSON.stringify({ success: false, skipped: true, reason: "opted_out" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const openPhoneResponse = paymentSent.response;

    if (!openPhoneResponse.ok) {
      const errorText = await openPhoneResponse.text();
      console.error("[send-payment-link] OpenPhone API error:", openPhoneResponse.status, errorText);

      let openphoneError: Record<string, unknown> | null = null;
      try {
        openphoneError = JSON.parse(errorText);
      } catch {
        // ignore non-JSON error payloads
      }

      const openphoneCode = typeof openphoneError?.code === 'string' ? openphoneError.code : null;
      const openphoneTitle = typeof openphoneError?.title === 'string' ? openphoneError.title : null;

      // A2P / 10DLC compliance block
      if (openPhoneResponse.status === 400 && (openphoneCode === '0206400' || (openphoneTitle && openphoneTitle.toLowerCase().includes('a2p')))) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "OpenPhone blocked this SMS - A2P/10DLC registration is pending approval. Please wait for carrier approval.",
            errorCode: "A2P_NOT_APPROVED",
            sessionUrl: session.url,  // Still return the URL so admin can copy/share manually
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Return session URL anyway so admin can share manually
      return new Response(
        JSON.stringify({
          success: false,
          error: `SMS failed to send. You can share this link manually: ${session.url}`,
          sessionUrl: session.url,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const smsResult = await openPhoneResponse.json();
    console.log("[send-payment-link] SMS sent successfully:", smsResult);

    // Log successful card collection link send
    await logAudit({
      action: AuditActions.SMS_GENERIC,
      userId: authResult.userId!,
      organizationId: authResult.organizationId!,
      details: { 
        type: "card_collection_link",
        customerPhone: formattedPhone,
        amount,
        sessionId: session.id 
      },
    });

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Card collection link sent via SMS",
      sessionUrl: session.url,
      sessionId: session.id
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-payment-link function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);

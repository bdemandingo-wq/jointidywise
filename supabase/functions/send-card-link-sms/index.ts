import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { requireOrgAdmin } from "../_shared/requireOrgAdmin.ts";
import { orgReconnectResponse } from "../_shared/get-org-stripe-settings.ts";

// Hash an email for audit logs (don't store plaintext PII in logs)
async function hashEmail(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const data = new TextEncoder().encode(email.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const APP_URL = Deno.env.get("APP_URL") || "https://jointidywise.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface CardLinkSmsRequest {
  phone: string;
  email: string;
  customerName: string;
  organizationId: string;
  amount: number; // Amount in dollars
}

// Generate a short random code (6 chars)
function generateShortCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, email, customerName, organizationId, amount }: CardLinkSmsRequest = await req.json();

    console.log("Creating card link SMS for:", { phone, customerName, organizationId, amount });

    if (!phone || !customerName || !amount) {
      return new Response(
        JSON.stringify({ error: "Phone, customer name, and amount are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // CRITICAL: organizationId is REQUIRED for multi-tenant isolation
    if (!organizationId) {
      console.error("Missing organizationId - cannot send card link without organization context");
      return new Response(JSON.stringify({
        error: "Missing organizationId - organization context is required"
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // SECURITY: Require caller to be an owner/admin of organizationId.
    const auth = await requireOrgAdmin(req, organizationId);
    if (auth instanceof Response) return auth;
    const { user, supabaseAdmin: authSupabase } = auth;

    // RATE LIMIT: max 5 SMS per organization per minute. Uses sms_send_log
    // (which we also write on success below). Counts only card_link sends.
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count: recentCount } = await authSupabase
      .from("sms_send_log")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("sms_type", "card_link")
      .gte("created_at", oneMinuteAgo);
    if ((recentCount ?? 0) >= 5) {
      return new Response(JSON.stringify({
        success: false,
        error: "Rate limit exceeded: max 5 card-link SMS per minute. Please wait and try again.",
        errorCode: "rate_limited",
      }), {
        status: 429,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }


    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Database connection not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch organization SMS settings - ONLY for specific org
    const { data: smsSettings, error: smsError } = await supabase
      .from('organization_sms_settings')
      .select('openphone_api_key, openphone_phone_number_id, sms_enabled')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (smsError) {
      console.error("Error fetching SMS settings:", smsError);
      return new Response(JSON.stringify({ 
        error: "Failed to fetch SMS settings for organization" 
      }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (!smsSettings || !smsSettings.sms_enabled) {
      console.error("SMS not enabled for organization:", organizationId);
      return new Response(JSON.stringify({ 
        error: "SMS is not enabled for this organization. Please configure SMS settings first." 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (!smsSettings.openphone_api_key || !smsSettings.openphone_phone_number_id) {
      console.error("OpenPhone settings not configured for org:", organizationId);
      return new Response(JSON.stringify({ 
        error: "OpenPhone API key or phone number not configured. Please set up SMS settings." 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Extract phone number ID from URL if needed (handles both full URLs and IDs)
    let phoneNumberId = smsSettings.openphone_phone_number_id;
    if (phoneNumberId.includes('openphone.com')) {
      // Extract PN... ID from URL like https://my.openphone.com/settings/phone-numbers/PNr7XukuaV
      const match = phoneNumberId.match(/PN[a-zA-Z0-9]+/);
      if (match) {
        phoneNumberId = match[0];
        console.log("Extracted phone number ID from URL:", phoneNumberId);
      } else {
        console.error("Could not extract phone number ID from URL:", phoneNumberId);
        return new Response(JSON.stringify({ 
          error: "Invalid OpenPhone phone number ID format. Please update SMS settings with just the phone number ID (e.g., PNxxxxxxxx)." 
        }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
    }

    // Get company name for the message
    const { data: settings } = await supabase
      .from('business_settings')
      .select('company_name')
      .eq('organization_id', organizationId)
      .maybeSingle();

    const companyName = settings?.company_name || "Your cleaning service";

    // STRICT ISOLATION: Get organization-specific Stripe credentials via audited RPC.
    const { data: secretRows } = await supabase.rpc("get_org_stripe_secret", {
      p_org_id: organizationId,
    });
    const blocked = await orgReconnectResponse(organizationId, corsHeaders);
    if (blocked) return blocked;

    const orgSecret = Array.isArray(secretRows) ? secretRows[0] : secretRows;
    const stripeSecretKey: string | null = orgSecret?.stripe_access_token || orgSecret?.stripe_secret_key || null;

    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured for this organization. Please connect your Stripe account in Settings → Payments." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-08-27.basil" });

    // Check if customer exists in Stripe, create if not
    let customerId: string;
    
    if (email) {
      const customers = await stripe.customers.list({ email: email, limit: 1 });
      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
        console.log("Found existing Stripe customer:", customerId);
      } else {
        const newCustomer = await stripe.customers.create({
          email: email,
          name: customerName,
          phone: phone,
        });
        customerId = newCustomer.id;
        console.log("Created new Stripe customer:", customerId);
      }
    } else {
      // Create customer with just phone and name
      const newCustomer = await stripe.customers.create({
        name: customerName,
        phone: phone,
      });
      customerId = newCustomer.id;
      console.log("Created new Stripe customer (phone only):", customerId);
    }

    // Create a Stripe Checkout session in SETUP mode to save card WITHOUT charging
    // The card will be saved to the customer for future manual charges

    // Generate a tracking ref for booking link tracking
    const trackingRef = crypto.randomUUID().replace(/-/g, '').substring(0, 12);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "setup",  // SETUP mode = save card only, NO automatic charge
      payment_method_types: ["card"],
      success_url: `${APP_URL}/card-saved?success=true`,
      cancel_url: `${APP_URL}/card-saved?cancelled=true`,
      metadata: {
        customerName: customerName,
        purpose: "card_collection",  // Changed from cleaning_payment
        organizationId: organizationId,
        amount: amount.toString(),  // Store amount for reference (NOT charged)
        trackingRef: trackingRef,
      },
    });

    // Insert booking link tracking record (card collection type)
    await supabase
      .from('booking_link_tracking')
      .insert({
        organization_id: organizationId,
        tracking_ref: trackingRef,
        customer_name: customerName,
        customer_phone: phone,
        customer_email: email || null,
        link_sent_at: new Date().toISOString(),
        status: 'sent',
        link_type: 'card_collection',
      })
      .then(({ error: trackingError }) => {
        if (trackingError) console.log('Booking link tracking insert skipped:', trackingError.message);
      });

    console.log("Created Stripe setup session (card save only):", session.id);

    // Create short URL for the Stripe checkout link
    const shortCode = generateShortCode();
    const { error: shortUrlError } = await supabase
      .from('short_urls')
      .insert({
        code: shortCode,
        target_url: session.url,
        organization_id: organizationId,
      });
    
    if (shortUrlError) {
      console.error("Error creating short URL:", shortUrlError);
      // Fall back to full URL if short URL creation fails
    }
    
    // Use short URL if created successfully, otherwise fall back to full URL
    const linkUrl = shortUrlError ? session.url : `${APP_URL}/c/${shortCode}`;

    // Send SMS via OpenPhone - short, clean message
    const smsMessage = `${companyName}: Add your card for $${amount.toFixed(2)} service (not charged now): ${linkUrl}`;
    let formattedPhone = phone.replace(/\D/g, '');
    if (!formattedPhone.startsWith('1') && formattedPhone.length === 10) {
      formattedPhone = '1' + formattedPhone;
    }
    formattedPhone = '+' + formattedPhone;

     // OpenPhone expects the raw API key in the Authorization header
     const authHeader = smsSettings.openphone_api_key.trim().replace(/^Bearer\s+/i, '');

    const openPhoneResponse = await fetch('https://api.openphone.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: smsMessage,
        from: phoneNumberId,
        to: [formattedPhone],
      }),
    });

    if (!openPhoneResponse.ok) {
      const errorText = await openPhoneResponse.text();
      console.error("OpenPhone API error:", openPhoneResponse.status, errorText);
      
      // Handle billing/payment issues gracefully
      if (openPhoneResponse.status === 402) {
        return new Response(JSON.stringify({ 
          success: false,
          error: "SMS service requires payment. Please check your OpenPhone account billing.",
          errorCode: "BILLING_REQUIRED",
          sessionUrl: session.url // Still provide the payment URL
        }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      
      // Handle auth issues
      if (openPhoneResponse.status === 401) {
        return new Response(JSON.stringify({ 
          success: false,
          error: "Invalid OpenPhone API key. Please update your SMS settings.",
          errorCode: "AUTH_FAILED",
          sessionUrl: session.url
        }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      
      return new Response(JSON.stringify({ 
        success: false,
        error: "SMS delivery failed. Please try again later.",
        sessionUrl: session.url
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const smsResult = await openPhoneResponse.json();
    console.log("Card collection link SMS sent successfully:", smsResult);

    // Audit log: record the successful card-link SMS (also feeds rate limiter).
    try {
      await authSupabase.from("sms_send_log").insert({
        organization_id: organizationId,
        admin_user_id: user.id,
        sms_type: "card_link",
        customer_phone: phone,
        customer_email_hash: await hashEmail(email),
        status: "sent",
        details: { amount, openphone_message_id: smsResult?.data?.id ?? null },
      });
    } catch (logErr) {
      console.error("Failed to write sms_send_log:", logErr);
    }

    return new Response(JSON.stringify({
      success: true,
      sessionUrl: session.url,
      message: "Card collection link sent via SMS successfully (card will NOT be charged automatically)"
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-card-link-sms function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);

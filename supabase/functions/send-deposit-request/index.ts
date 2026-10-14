import { sendOpenPhoneMessage } from "../_shared/send-openphone.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAudit } from "../_shared/audit-log.ts";
import { verifyAdminAuth } from "../_shared/verify-admin-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface SendDepositRequest {
  bookingId: string;
  organizationId: string;
  amount: number;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { bookingId, organizationId, amount } = await req.json() as SendDepositRequest;

    if (!bookingId || !organizationId || !amount || amount <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing bookingId, organizationId, or valid amount" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // AUTH: owner/admin/manager of this org. The caller picks the dollar
    // amount, so an anon key must not be enough to text a payment link.
    const authResult = await verifyAdminAuth(req.headers.get("Authorization"), {
      requireAdmin: true,
      requireOrganizationId: organizationId,
    });
    if (!authResult.success) {
      const denied = /access denied/i.test(authResult.error || "");
      return new Response(
        JSON.stringify({ success: false, error: authResult.error || "Unauthorized" }),
        { status: denied ? 403 : 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch booking with customer info
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select(`
        id, booking_number, organization_id,
        customer:customers(first_name, last_name, phone)
      `)
      .eq('id', bookingId)
      .eq('organization_id', organizationId)
      .single();

    if (bookingError || !booking) {
      return new Response(
        JSON.stringify({ success: false, error: "Booking not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const customerData = booking.customer as unknown;
    const customer = Array.isArray(customerData) ? customerData[0] : customerData;
    const typedCustomer = customer as { first_name: string; last_name: string; phone: string | null } | null;

    if (!typedCustomer?.phone) {
      return new Response(
        JSON.stringify({ success: false, error: "Customer has no phone number" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create deposit request record
    const { data: deposit, error: depositError } = await supabase
      .from('deposit_requests')
      .insert({
        booking_id: bookingId,
        organization_id: organizationId,
        amount,
        customer_name: `${typedCustomer.first_name} ${typedCustomer.last_name}`,
        customer_phone: typedCustomer.phone,
      })
      .select('id, token')
      .single();

    if (depositError || !deposit) {
      console.error("[send-deposit-request] Failed to create deposit record:", depositError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create deposit request" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get business settings for company name and org-specific app URL
    const { data: businessSettings } = await supabase
      .from('business_settings')
      .select('company_name, app_url')
      .eq('organization_id', organizationId)
      .maybeSingle();

    const companyName = businessSettings?.company_name || 'Your cleaning service';
    const appUrl = (businessSettings?.app_url || Deno.env.get("APP_URL") || Deno.env.get("PROJECT_URL") || req.headers.get("origin") || "https://jointidywise.com").replace(/\/+$/, '');

    // Build deposit link
    const fullDepositLink = `${appUrl}/deposit/${deposit.token}`;

    // Shorten the deposit link
    const shortCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { error: shortUrlError } = await supabase
      .from('short_urls')
      .insert({
        code: shortCode,
        target_url: fullDepositLink,
        organization_id: organizationId,
      });

    const depositLink = shortUrlError ? fullDepositLink : `${appUrl}/c/${shortCode}`;
    const displayLink = depositLink.replace(/^https?:\/\//, '');

    // Build SMS message
    const message = `Hi ${typedCustomer.first_name}! ${companyName} here. A deposit of $${amount.toFixed(2)} is required for your upcoming service (Booking #${booking.booking_number}). Tap to pay securely: ${displayLink}`;

    // Fetch SMS settings
    const { data: smsSettings } = await supabase
      .from('organization_sms_settings')
      .select('openphone_api_key, openphone_phone_number_id, sms_enabled')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (!smsSettings?.sms_enabled || !smsSettings.openphone_api_key || !smsSettings.openphone_phone_number_id) {
      return new Response(
        JSON.stringify({ success: false, error: "SMS not configured for this organization" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Format phone number
    let formattedPhone = typedCustomer.phone.replace(/\D/g, '');
    if (formattedPhone.length === 10) {
      formattedPhone = `+1${formattedPhone}`;
    } else if (!formattedPhone.startsWith('+')) {
      formattedPhone = `+${formattedPhone}`;
    }

    // Extract phone number ID
    let phoneNumberId = smsSettings.openphone_phone_number_id;
    if (phoneNumberId.includes('/') || phoneNumberId.includes('openphone')) {
      const pnMatch = phoneNumberId.match(/(PN[A-Za-z0-9]+)/);
      if (pnMatch) phoneNumberId = pnMatch[1];
    }

    const authHeader = smsSettings.openphone_api_key.trim().replace(/^Bearer\s+/i, '');

    // Send SMS
    const response = await sendOpenPhoneMessage( {
      organizationId: organizationId,
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: phoneNumberId,
        to: [formattedPhone],
        content: message,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[send-deposit-request] SMS failed:", response.status, errorText);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to send deposit SMS" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update deposit record with sms_sent_at
    await supabase
      .from('deposit_requests')
      .update({ sms_sent_at: new Date().toISOString() })
      .eq('id', deposit.id);

    logAudit({
      action: 'sms.deposit_request',
      organizationId,
      resourceType: 'booking',
      resourceId: bookingId,
      success: true,
      details: { depositId: deposit.id, amount, customerPhone: formattedPhone },
    });

    return new Response(
      JSON.stringify({ success: true, depositId: deposit.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[send-deposit-request] Error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);

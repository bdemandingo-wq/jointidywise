import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAudit, AuditActions } from "../_shared/audit-log.ts";
import { isOptedOut } from "../_shared/marketing-guard.ts";
import { verifyAdminAuth } from "../_shared/verify-admin-auth.ts";
import { sendOpenPhoneMessage } from "../_shared/openphone-send.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface SendTipRequest {
  bookingId: string;
  organizationId: string;
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
    const { bookingId, organizationId } = await req.json() as SendTipRequest;

    if (!bookingId || !organizationId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing bookingId or organizationId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // AUTH: owner/admin/manager of this org. Same gate as send-deposit-request.
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
        customer:customers(id, first_name, last_name, phone)
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
    const typedCustomer = customer as { id: string; first_name: string; last_name: string; phone: string | null } | null;

    if (!typedCustomer?.phone) {
      return new Response(
        JSON.stringify({ success: false, error: "Customer has no phone number" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // MARKETING CONSENT: a tip request is a solicitation, not a transactional
    // message. Skipping is a normal outcome, so answer 200 with skipped:true.
    if (await isOptedOut(supabase, organizationId, typedCustomer.id)) {
      console.info(
        `[send-tip-request] Skipping opted-out customer | org:${organizationId} customer:${typedCustomer.id}`,
      );
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "customer_opted_out" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }



    // Create tip record
    const { data: tip, error: tipError } = await supabase
      .from('tips')
      .insert({
        booking_id: bookingId,
        organization_id: organizationId,
        customer_name: `${typedCustomer.first_name} ${typedCustomer.last_name}`,
        customer_phone: typedCustomer.phone,
      })
      .select('id, token')
      .single();

    if (tipError || !tip) {
      console.error("[send-tip-request] Failed to create tip record:", tipError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create tip request" }),
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

    // Build tip link
    const fullTipLink = `${appUrl}/tip/${tip.token}`;

    // Shorten the tip link using short_urls table
    const shortCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { error: shortUrlError } = await supabase
      .from('short_urls')
      .insert({
        code: shortCode,
        target_url: fullTipLink,
        organization_id: organizationId,
      });

    const tipLink = shortUrlError ? fullTipLink : `${appUrl}/c/${shortCode}`;

    // Build a clean display link (strip protocol for SMS readability)
    const displayLink = tipLink.replace(/^https?:\/\//, '');

    // Build SMS message
    const message = `Hi ${typedCustomer.first_name}! 😊 We loved serving you from ${companyName}! Tap to leave a tip for your cleaner: ${displayLink} 💚`;

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

    const sent = await sendOpenPhoneMessage({
      supabase,
      organizationId,
      to: formattedPhone,
      content: message,
      from: phoneNumberId,
      apiKey: authHeader,
      tag: "send-tip-request",
    });
    if (sent.skipped) {
      return new Response(
        JSON.stringify({ success: false, skipped: true, reason: "opted_out" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const response = sent.response;

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[send-tip-request] SMS failed:", response.status, errorText);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to send tip SMS" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update tip record with sms_sent_at
    await supabase
      .from('tips')
      .update({ sms_sent_at: new Date().toISOString() })
      .eq('id', tip.id);

    logAudit({
      action: 'sms.tip_request',
      organizationId,
      resourceType: 'booking',
      resourceId: bookingId,
      success: true,
      details: { tipId: tip.id, customerPhone: formattedPhone },
    });

    return new Response(
      JSON.stringify({ success: true, tipId: tip.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[send-tip-request] Error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);

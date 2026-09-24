import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyOrgAccess } from "../_shared/verify-org-access.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AdminNotificationRequest {
  customerName: string;
  serviceName: string;
  scheduledAt: string;
  formattedDate?: string; // Pre-formatted date from client
  formattedTime?: string; // Pre-formatted time from client
  totalAmount: number;
  address?: string;
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
      console.error("[send-admin-sms-notification] Missing Supabase configuration");
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { 
      customerName, 
      serviceName, 
      scheduledAt, 
      formattedDate: preFormattedDate,
      formattedTime: preFormattedTime,
      totalAmount,
      address,
      organizationId
    }: AdminNotificationRequest = await req.json();

    if (!organizationId) {
      console.error("[send-admin-sms-notification] Missing organizationId");
      return new Response(
        JSON.stringify({ success: false, error: "Missing organizationId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const auth = await verifyOrgAccess(req, organizationId);
    if (!auth.ok) {
      return new Response(
        JSON.stringify({ success: false, error: auth.error }),
        { status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }


    console.log("[send-admin-sms-notification] Processing notification for org:", organizationId);

    // Fetch SMS settings for the organization
    const { data: smsSettings, error: settingsError } = await supabase
      .from('organization_sms_settings')
      .select('openphone_api_key, openphone_phone_number_id, sms_enabled')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (settingsError) {
      console.error("[send-admin-sms-notification] Error fetching SMS settings:", settingsError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch SMS settings" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!smsSettings?.sms_enabled) {
      console.log("[send-admin-sms-notification] SMS disabled for organization:", organizationId);
      return new Response(
        JSON.stringify({ success: false, error: "SMS notifications are disabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!smsSettings.openphone_api_key || !smsSettings.openphone_phone_number_id) {
      console.log("[send-admin-sms-notification] OpenPhone not configured for org:", organizationId);
      return new Response(
        JSON.stringify({ success: false, error: "OpenPhone not configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get admin phone and notification settings from business settings
    const { data: businessSettings, error: businessError } = await supabase
      .from('business_settings')
      .select('company_phone, notification_phone, company_name, notify_new_booking, timezone')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (businessError) {
      console.error("[send-admin-sms-notification] Error fetching business settings:", businessError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch business settings" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if new booking notifications are enabled
    if (businessSettings?.notify_new_booking === false) {
      console.log("[send-admin-sms-notification] New booking notifications disabled for org:", organizationId);
      return new Response(
        JSON.stringify({ success: false, error: "New booking notifications are disabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    /* Personal cell first — company_phone is often the OpenPhone line itself,
       and OpenPhone texting its own number never lands on a handset. */
    const alertPhone = (businessSettings as { notification_phone?: string | null } | null)?.notification_phone
      || businessSettings?.company_phone;

    if (!alertPhone) {
      console.log("[send-admin-sms-notification] No admin phone configured for org:", organizationId);
      return new Response(
        JSON.stringify({ success: false, error: "No admin phone number configured in business settings" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use pre-formatted date/time if provided, otherwise fall back to parsing (for backwards compatibility)
    let formattedDate: string;
    let formattedTime: string;
    
    if (preFormattedDate && preFormattedTime) {
      formattedDate = preFormattedDate;
      formattedTime = preFormattedTime;
    } else {
      // Fallback: format in org timezone from business_settings
      const orgTimezone = businessSettings?.timezone || "America/New_York";
      const bookingDate = new Date(scheduledAt);
      formattedDate = new Intl.DateTimeFormat('en-US', { 
        timeZone: orgTimezone,
        weekday: 'short', 
        month: 'short', 
        day: 'numeric' 
      }).format(bookingDate);
      formattedTime = new Intl.DateTimeFormat('en-US', { 
        timeZone: orgTimezone,
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      }).format(bookingDate);
    }

    // Build admin notification message
    const message = `🆕 NEW BOOKING!\n\n` +
      `Customer: ${customerName}\n` +
      `Service: ${serviceName}\n` +
      `Date: ${formattedDate} at ${formattedTime}\n` +
      `${address ? `Address: ${address}\n` : ''}` +
      `Total: $${totalAmount.toFixed(2)}\n\n` +
      `Log in to your dashboard to view details.`;

    // Format admin phone
    let formattedPhone = businessSettings.company_phone.replace(/\D/g, '');
    if (formattedPhone.length === 10) {
      formattedPhone = `+1${formattedPhone}`;
    } else if (!formattedPhone.startsWith('+')) {
      formattedPhone = `+${formattedPhone}`;
    }

    // Extract phone number ID if full URL was provided
    let phoneNumberId = smsSettings.openphone_phone_number_id;
    if (phoneNumberId.includes('openphone.com')) {
      const match = phoneNumberId.match(/phone-numbers\/([A-Za-z0-9]+)/);
      if (match) {
        phoneNumberId = match[1];
      }
    }

    console.log(`[send-admin-sms-notification] Sending admin SMS to ${formattedPhone}`);

    // OpenPhone expects the raw API key in the Authorization header
    const authHeader = smsSettings.openphone_api_key.trim().replace(/^Bearer\s+/i, '');

    // Send SMS via OpenPhone API
    const response = await fetch("https://api.openphone.com/v1/messages", {
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
      console.error(`[send-admin-sms-notification] OpenPhone API error: ${response.status} - ${errorText}`);
      
      // Handle billing/payment issues gracefully
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: "SMS service requires payment. Please check your OpenPhone account billing.", 
            errorCode: "BILLING_REQUIRED" 
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Handle auth issues
      if (response.status === 401) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: "Invalid OpenPhone API key. Please update your SMS settings.", 
            errorCode: "AUTH_FAILED" 
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ success: false, error: "SMS delivery failed. Please try again later." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    console.log(`[send-admin-sms-notification] SMS sent successfully:`, result);

    return new Response(
      JSON.stringify({ success: true, messageId: result.data?.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[send-admin-sms-notification] Error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCallerOrg } from "../_shared/require-caller-org.ts";
import { sendOpenPhoneMessage } from "../_shared/send-sms.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OnboardingCompleteSmsRequest {
  to: string;
  businessName: string;
  organizationId: string;
  ownerName?: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[send-onboarding-complete-sms] Missing Supabase configuration");
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { to, businessName, ownerName } = await req.json() as OnboardingCompleteSmsRequest;

    // SECURITY: never trust organizationId from the request body — resolve
    // it from the caller's own JWT + org_memberships instead. By the time
    // this fires, the onboarding flow has already created the org and the
    // caller's first (owner) membership row.
    const callerOrg = await resolveCallerOrg(req);
    if (!callerOrg.ok) {
      return new Response(
        JSON.stringify({ success: false, error: callerOrg.error }),
        { status: callerOrg.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const organizationId = callerOrg.ctx.organizationId;

    if (!to) {
      console.error("[send-onboarding-complete-sms] Missing phone number");
      return new Response(
        JSON.stringify({ success: false, error: "Phone number is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch SMS settings for the organization
    const { data: smsSettings, error: settingsError } = await supabase
      .from('organization_sms_settings')
      .select('openphone_api_key, openphone_phone_number_id, sms_enabled')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (settingsError) {
      console.error("[send-onboarding-complete-sms] Error fetching SMS settings:", settingsError);
      // Don't fail - organization may not have SMS configured yet
      return new Response(
        JSON.stringify({ success: false, error: "SMS not configured yet - that's okay!" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!smsSettings || !smsSettings.sms_enabled || !smsSettings.openphone_api_key || !smsSettings.openphone_phone_number_id) {
      console.log("[send-onboarding-complete-sms] SMS not configured for organization:", organizationId);
      // Don't fail - organization may not have SMS configured yet
      return new Response(
        JSON.stringify({ success: false, error: "SMS not configured yet - that's okay!" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = smsSettings.openphone_api_key;
    let phoneNumberId = smsSettings.openphone_phone_number_id;

    // Extract phone number ID if a full URL was provided
    if (phoneNumberId.includes('openphone.com')) {
      const match = phoneNumberId.match(/phone-numbers\/([A-Za-z0-9]+)/);
      if (match) {
        phoneNumberId = match[1];
      }
    }

    // Format phone number
    let formattedPhone = to.replace(/\D/g, '');
    if (formattedPhone.length === 10) {
      formattedPhone = `+1${formattedPhone}`;
    } else if (!formattedPhone.startsWith('+')) {
      formattedPhone = `+${formattedPhone}`;
    }

    // Construct congratulations message
    const greeting = ownerName ? `Congrats ${ownerName}! ` : "Congrats! ";
    const message = `${greeting}🎊 Your ${businessName} account is all set up and ready to go! Start adding customers, scheduling jobs, and growing your business. Need help? Just reply here!`;

    console.log(`[send-onboarding-complete-sms] Sending onboarding complete SMS to ${formattedPhone} for org: ${organizationId}`);

    // Send SMS via OpenPhone API
    const sent = await sendOpenPhoneMessage({
      supabase,
      organizationId,
      to: formattedPhone,
      content: message,
      from: phoneNumberId,
      apiKey,
      tag: "send-onboarding-complete-sms",
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
      console.error(`[send-onboarding-complete-sms] OpenPhone API error: ${response.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ success: false, error: `OpenPhone API error` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    console.log(`[send-onboarding-complete-sms] Onboarding complete SMS sent successfully:`, result);

    return new Response(
      JSON.stringify({ success: true, messageId: result.data?.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[send-onboarding-complete-sms] Error:", errorMessage);

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);

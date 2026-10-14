import { sendOpenPhoneMessage } from "../_shared/send-openphone.ts";
import { isDemoSendBlocked } from "../_shared/demo-org.ts";
import {
  resolveTemplate,
  withStopSentence,
  AUTOMATION_DEFAULTS,
} from "../_shared/automation-templates.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCallerOrg } from "../_shared/require-caller-org.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReviewRequestSmsPayload {
  bookingId: string;
  customerId: string;
  customerPhone: string;
  customerName: string;
  serviceName: string;
  organizationId: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: ReviewRequestSmsPayload = await req.json();
    const { bookingId, customerId, customerPhone, customerName, serviceName } = payload;

    if (!customerPhone || !bookingId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // SECURITY: never trust organizationId from the request body — resolve it
    // from the caller's own JWT + org_memberships instead.
    const callerOrg = await resolveCallerOrg(req, payload.organizationId ?? null);
    if (!callerOrg.ok) {
      return new Response(JSON.stringify({ error: callerOrg.error }), {
        status: callerOrg.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const organizationId = callerOrg.ctx.organizationId;

    console.log("Processing review request SMS:", { bookingId, customerName, organizationId });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Block if customer has already received a review request
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('review_request_sent')
      .eq('id', customerId)
      .maybeSingle();

    if ((existingCustomer as any)?.review_request_sent) {
      return new Response(JSON.stringify({
        success: false,
        error: 'This customer has already received a review request.',
        errorCode: 'ALREADY_SENT'
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    
    // Fetch SMS settings for the organization
    const { data: smsSettings, error: smsError } = await supabase
      .from('organization_sms_settings')
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (smsError) {
      console.error("Error fetching SMS settings:", smsError);
      throw new Error("Failed to fetch SMS settings");
    }

    if (!smsSettings || !smsSettings.sms_enabled) {
      console.log("SMS is not enabled for this organization");
      return new Response(JSON.stringify({ 
        error: "SMS notifications are not enabled. Please configure SMS settings first." 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (!smsSettings.openphone_api_key || !smsSettings.openphone_phone_number_id) {
      console.log("OpenPhone credentials not configured");
      return new Response(JSON.stringify({ 
        error: "OpenPhone credentials are not configured. Please add your API key and phone number ID." 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    
    // Get business settings for company name, review template, and org-specific app URL
    const { data: businessSettings } = await supabase
      .from('business_settings')
      .select('company_name, google_review_url, review_sms_template, app_url')
      .eq('organization_id', organizationId)
      .maybeSingle();

    const companyName = businessSettings?.company_name || 'Our Company';
    const googleReviewUrl = businessSettings?.google_review_url || '';
    
    // Generate unique token for this review request
    const token = crypto.randomUUID();
    
    // Use org-specific app URL, fallback to global PROJECT_URL
    const projectUrl = (businessSettings?.app_url || Deno.env.get("APP_URL") || Deno.env.get("PROJECT_URL") || "https://jointidywise.com").replace(/\/+$/, '');
    const reviewPageUrl = `${projectUrl}/review/${token}`;

    // Get staff_id and staff name from booking to associate review with cleaner
    const { data: bookingData } = await supabase
      .from("bookings")
      .select("staff_id, staff:staff_id(name)")
      .eq("id", bookingId)
      .single();

    const cleanerName = (bookingData?.staff as any)?.name || 'your cleaner';

    // Create review request record
    const { error: insertError } = await supabase
      .from("review_requests")
      .insert({
        booking_id: bookingId,
        customer_id: customerId,
        staff_id: bookingData?.staff_id || null,
        status: "sent",
        sent_at: new Date().toISOString(),
        review_link_token: token,
        google_review_url: googleReviewUrl,
      });

    if (insertError) {
      console.error("Failed to create review request:", insertError);
      throw new Error("Failed to create review request record");
    }

    // Build the SMS message from template or use default
    // ── template resolution ────────────────────────────────────────────
    // Two editing paths used to disagree: the new Messages tab writes to
    // organization_automations.settings.templates.review_request, while this
    // sender alone honoured the older business_settings.review_sms_template.
    // The new store wins; a legacy body with no new entry is migrated across on
    // first read so the two converge instead of fighting. A migration failure is
    // logged and ignored — the message still sends with the legacy wording.
    const { data: autoRow, error: autoErr } = await supabase
      .from('organization_automations')
      .select('id, settings')
      .eq('organization_id', organizationId)
      .eq('automation_type', 'review_request')
      .maybeSingle();
    if (autoErr) {
      console.warn('[send-review-request-sms] template lookup failed, using default:', autoErr);
    }
    const settings = (autoRow?.settings ?? {}) as { templates?: Record<string, string> };
    let customBody: string | null = settings.templates?.review_request ?? null;

    const legacyBody: string | null = businessSettings?.review_sms_template || null;
    if (!customBody && legacyBody) {
      customBody = legacyBody;
      const nextSettings = {
        ...(autoRow?.settings ?? {}),
        templates: { ...(settings.templates ?? {}), review_request: legacyBody },
      };
      const migrate = autoRow
        ? await supabase.from('organization_automations')
            .update({ settings: nextSettings })
            .eq('id', autoRow.id)
        : await supabase.from('organization_automations')
            .insert([{
              organization_id: organizationId,
              automation_type: 'review_request',
              // Off by default: copying wording across must not switch an
              // automation on for an org that never enabled it.
              is_enabled: false,
              settings: nextSettings,
            }]);
      if (migrate.error) {
        console.warn('[send-review-request-sms] legacy template migration failed:', migrate.error);
      }
    }

    const resolved = resolveTemplate('review_request', customBody, {
      customer_name: customerName,
      company_name: companyName,
      cleaner_name: cleanerName,
      service_name: serviceName,
      review_link: reviewPageUrl,
    });
    if (resolved.warning) {
      console.warn(`[send-review-request-sms] org=${organizationId}: ${resolved.warning}`);
    }
    const message =
      AUTOMATION_DEFAULTS.review_request.message_class === 'marketing'
        ? withStopSentence(resolved.text)
        : resolved.text;

    // Format phone number
    let formattedPhone = customerPhone.replace(/\D/g, '');
    if (formattedPhone.length === 10) {
      formattedPhone = `+1${formattedPhone}`;
    } else if (!formattedPhone.startsWith('+')) {
      formattedPhone = `+${formattedPhone}`;
    }

    // Extract phone number ID from full URL if provided
    let phoneNumberId = smsSettings.openphone_phone_number_id;
    if (phoneNumberId.includes('/')) {
      const parts = phoneNumberId.split('/');
      phoneNumberId = parts[parts.length - 1];
    }

    console.log("Sending review request SMS to:", formattedPhone);

    // OpenPhone expects the raw API key in the Authorization header
    const authHeader = smsSettings.openphone_api_key.trim().replace(/^Bearer\s+/i, '');

    // Send SMS via OpenPhone API
    const openPhoneResponse = await sendOpenPhoneMessage( {
      organizationId: organizationId,
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: message,
        from: phoneNumberId,
        to: [formattedPhone],
      }),
    });

    if (!openPhoneResponse.ok) {
      const errorText = await openPhoneResponse.text();
      console.error('OpenPhone API error:', openPhoneResponse.status, errorText);
      
      // Handle billing/payment issues gracefully
      if (openPhoneResponse.status === 402) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'SMS service requires payment. Please check your OpenPhone account billing.', 
            errorCode: 'BILLING_REQUIRED' 
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      
      // Handle auth issues
      if (openPhoneResponse.status === 401) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Invalid OpenPhone API key. Please update your SMS settings.', 
            errorCode: 'AUTH_FAILED' 
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'SMS delivery failed. Please try again later.' }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const responseData = await openPhoneResponse.json();
    console.log("Review request SMS sent successfully:", responseData);

    // Flag the customer so they never receive another review request
    const { error: flagCustomerErr } = await supabase
      .from('customers')
      .update({ review_request_sent: true, review_request_sent_at: new Date().toISOString() } as any)
      .eq('id', customerId);
    if (flagCustomerErr) {
      console.error(`Review SMS sent but customer ${customerId} was not flagged review_request_sent — they may receive another review request via a different path:`, flagCustomerErr);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    if (isDemoSendBlocked(error)) {
      return new Response(
        JSON.stringify({ success: false, skipped: true, reason: "demo_mode" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    console.error("Error in send-review-request-sms function:", error);
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);

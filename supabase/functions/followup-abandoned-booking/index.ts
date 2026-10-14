import { sendOpenPhoneMessage } from "../_shared/send-openphone.ts";
import {
  resolveTemplate,
  withStopSentence,
  AUTOMATION_DEFAULTS,
} from "../_shared/automation-templates.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireOrgAdmin } from "../_shared/requireOrgAdmin.ts";
import { isServiceRoleRequest, rejectUnauthenticated } from "../_shared/require-caller-org.ts";
import { isPhoneOptedOut } from "../_shared/marketing-guard.ts";
import { demoModeEnabledForOrg } from "../_shared/demo-guard.ts";
import { isKnownDemoOrganization } from "../_shared/demo-org.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Caller first. An empty unauthenticated POST used to throw inside
    // req.json() and come back as 500. Service-role (cron / another function)
    // is a caller; it skips the user-membership check below because
    // requireOrgAdmin only accepts a user session.
    const denied = await rejectUnauthenticated(req, corsHeaders, {
      success: false,
      error: "Unauthorized",
    });
    if (denied) return denied;

    let body: {
      organizationId?: string;
      testMode?: boolean;
      message?: string;
      hoursThreshold?: number;
    } | null = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    const organizationId = body?.organizationId;
    const testMode = body?.testMode ?? false;
    const message = body?.message;
    const hoursThreshold = body?.hoursThreshold ?? 1;

    if (!organizationId) {
      return new Response(
        JSON.stringify({ success: false, error: "Organization ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SECURITY: require an authenticated owner/admin of this org before
    // touching the org's OpenPhone credentials or sending SMS to its customers.
    if (!isServiceRoleRequest(req)) {
      const authResult = await requireOrgAdmin(req, organizationId);
      if (authResult instanceof Response) return authResult;
    }

    if (isKnownDemoOrganization(organizationId) || await demoModeEnabledForOrg(supabase, organizationId)) {
      console.log(`[followup-abandoned-booking] skipped demo org ${organizationId}`);
      return new Response(
        JSON.stringify({ success: true, skipped: "demo_mode", sentCount: 0, failedCount: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[followup-abandoned-booking] Starting for org: ${organizationId}, threshold: ${hoursThreshold}h`);

    // Get SMS settings
    const { data: smsSettings } = await supabase
      .from('organization_sms_settings')
      .select('openphone_api_key, openphone_phone_number_id, sms_enabled')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (!smsSettings?.sms_enabled || !smsSettings.openphone_api_key || !smsSettings.openphone_phone_number_id) {
      return new Response(
        JSON.stringify({ success: false, error: "SMS not configured or disabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get business settings
    const { data: businessSettings } = await supabase
      .from('business_settings')
      .select('company_name')
      .eq('organization_id', organizationId)
      .maybeSingle();

    const companyName = businessSettings?.company_name || 'Our Company';

    const { data: orgRow } = await supabase
      .from('organizations')
      .select('slug')
      .eq('id', organizationId)
      .maybeSingle();
    const orgSlug = (orgRow as { slug?: string | null } | null)?.slug || '';

    // Find abandoned bookings with phone numbers that haven't been followed up
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - hoursThreshold);

    const { data: abandonedBookings, error: fetchError } = await supabase
      .from('abandoned_bookings')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('followup_sent', false)
      .eq('converted', false)
      .not('phone', 'is', null)
      .lt('created_at', cutoffTime.toISOString())
      .order('created_at', { ascending: false });

    if (fetchError) {
      console.error("[followup-abandoned-booking] Fetch error:", fetchError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch abandoned bookings" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[followup-abandoned-booking] Found ${abandonedBookings?.length || 0} abandoned bookings to follow up`);

    if (testMode) {
      return new Response(
        JSON.stringify({
          success: true,
          testMode: true,
          abandonedCount: abandonedBookings?.length || 0,
          bookings: (abandonedBookings || []).slice(0, 10).map(b => ({
            id: b.id,
            first_name: b.first_name,
            phone: b.phone,
            step_reached: b.step_reached,
            created_at: b.created_at,
          })),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Precedence: an explicit `message` in the request (a one-off blast an
    // admin typed), then the org's saved copy, then the shipped default.
    const { data: abAutomation, error: abAutoErr } = await supabase
      .from('organization_automations')
      .select('settings')
      .eq('organization_id', organizationId)
      .eq('automation_type', 'abandoned_booking_recovery')
      .maybeSingle();
    if (abAutoErr) {
      console.warn('[followup-abandoned-booking] template lookup failed, using default:', abAutoErr);
    }
    const savedTemplate =
      ((abAutomation?.settings as { templates?: Record<string, string> } | null)
        ?.templates?.abandoned_booking_recovery) ?? null;
    const messageTemplate = message || savedTemplate || null;

    let sentCount = 0;
    let failedCount = 0;
    let skippedOptedOut = 0;
    const authHeader = smsSettings.openphone_api_key.trim().replace(/^Bearer\s+/i, '');

    for (const booking of abandonedBookings || []) {
      try {
        // MARKETING CONSENT: abandoned_bookings has no customer_id, so match on
        // the phone number. Fails closed. Mark followup_sent so an opted-out
        // row is not reconsidered on every subsequent run.
        if (await isPhoneOptedOut(supabase, organizationId, booking.phone)) {
          console.info(
            `[followup-abandoned-booking] Skipping opted-out recipient | org:${organizationId} phone:${booking.phone}`,
          );
          skippedOptedOut++;
          await supabase
            .from('abandoned_bookings')
            .update({ followup_sent: true, followup_sent_at: new Date().toISOString() })
            .eq('id', booking.id);
          continue;
        }

        const resolvedAb = resolveTemplate('abandoned_booking_recovery', messageTemplate, {
          first_name: booking.first_name || 'there',
          company_name: companyName,
        });
        if (resolvedAb.warning) {
          console.warn(`[followup-abandoned-booking] org=${organizationId}: ${resolvedAb.warning}`);
        }
        // Marketing: the STOP line is appended here rather than baked into the
        // body, so an owner rewording it cannot drop the opt-out.
        let personalizedMessage =
          AUTOMATION_DEFAULTS.abandoned_booking_recovery.message_class === 'marketing'
            ? withStopSentence(resolvedAb.text)
            : resolvedAb.text;
        if (orgSlug && booking.session_token) {
          const resumeUrl = `https://www.jointidywise.com/book/${orgSlug}?resume=${encodeURIComponent(booking.session_token)}`;
          personalizedMessage = `${personalizedMessage}\n\nFinish your booking: ${resumeUrl}`;
        }


        let toPhone = booking.phone.replace(/\D/g, '');
        if (!toPhone.startsWith('1') && toPhone.length === 10) {
          toPhone = '1' + toPhone;
        }
        toPhone = '+' + toPhone;

        const response = await sendOpenPhoneMessage( {
      organizationId: organizationId,
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: smsSettings.openphone_phone_number_id,
            to: [toPhone],
            content: personalizedMessage,
          }),
        });

        if (response.ok) {
          sentCount++;
          await supabase
            .from('abandoned_bookings')
            .update({ followup_sent: true, followup_sent_at: new Date().toISOString() })
            .eq('id', booking.id);
        } else {
          const errorData = await response.text();
          console.error(`[followup-abandoned-booking] SMS failed for ${booking.id}:`, errorData);
          failedCount++;
        }

        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`[followup-abandoned-booking] Error for ${booking.id}:`, error);
        failedCount++;
      }
    }

    console.log(`[followup-abandoned-booking] Complete. Sent: ${sentCount}, Failed: ${failedCount}, SkippedOptedOut: ${skippedOptedOut}`);

    return new Response(
      JSON.stringify({ success: true, sentCount, failedCount, skippedOptedOut, totalAbandoned: abandonedBookings?.length || 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[followup-abandoned-booking] Error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);

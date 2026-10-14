import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendResendSdkEmail } from "../_shared/send-resend.ts";
import { getOrgEmailSettings, formatEmailFrom } from "../_shared/get-org-email-settings.ts";
import { isServiceRoleRequest } from "../_shared/require-caller-org.ts";
import { escapeHtml } from "../_shared/escapeHtml.ts";

// Platform-level Resend API key (shared email service)
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CancellationRequest {
  customerEmail: string;
  customerName: string;
  reason?: string;
  organizationId: string; // REQUIRED - no fallback allowed
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // SECURITY: no frontend or edge function currently calls this — internal
  // churn-tracking notification only, until a real caller is wired up.
  if (!isServiceRoleRequest(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const { customerEmail, customerName, reason, organizationId }: CancellationRequest = await req.json();

    // CRITICAL: organizationId is REQUIRED for multi-tenant isolation
    if (!organizationId) {
      console.error("[notify-subscription-cancelled] Missing organizationId - cannot send notification without organization context");
      return new Response(JSON.stringify({ 
        error: "Missing organizationId - organization context is required" 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // STRICT ISOLATION: Verify Resend API key is available
    if (!RESEND_API_KEY) {
      console.error("[notify-subscription-cancelled] Missing RESEND_API_KEY");
      return new Response(JSON.stringify({ error: "Email service not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    console.log("[notify-subscription-cancelled] Processing cancellation for org:", organizationId);

    // Get org-specific email settings - STRICT ISOLATION
    const emailSettingsResult = await getOrgEmailSettings(organizationId);
    
    if (!emailSettingsResult.success || !emailSettingsResult.settings) {
      console.error("[notify-subscription-cancelled] Failed to get email settings:", emailSettingsResult.error);
      return new Response(JSON.stringify({ 
        error: emailSettingsResult.error || "Email settings not configured for this organization" 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const emailSettings = emailSettingsResult.settings;
    const senderFrom = formatEmailFrom(emailSettings);
    const adminEmail = emailSettings.from_email;
    const companyName = emailSettings.from_name;

    console.log("[notify-subscription-cancelled] Using org email settings - from:", senderFrom, "to:", adminEmail);

    const { data: sendData, error: sendError } = await sendResendSdkEmail(emailSettings.resend_api_key || RESEND_API_KEY || "", {
      from: senderFrom,
      to: [adminEmail],
      subject: `Subscription Cancelled: ${customerName}`,
      html: `
        <h2>Subscription Cancellation Notice</h2>
        <p>A customer has cancelled their ${escapeHtml(companyName)} Pro subscription:</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; font-weight: bold;">Customer Name:</td>
            <td style="padding: 8px;">${escapeHtml(customerName)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; font-weight: bold;">Email:</td>
            <td style="padding: 8px;">${escapeHtml(customerEmail)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; font-weight: bold;">Cancellation Date:</td>
            <td style="padding: 8px;">${new Date().toLocaleDateString()}</td>
          </tr>
          ${reason ? `
          <tr>
            <td style="padding: 8px; font-weight: bold;">Reason:</td>
            <td style="padding: 8px;">${escapeHtml(reason)}</td>
          </tr>
          ` : ''}
        </table>
        <p>Please follow up with this customer to understand their feedback and potentially win them back.</p>
        <p style="color: #666; font-size: 12px;">This is an automated notification from ${companyName}.</p>
      `,
    }, { organizationId });

    if (sendError) {
      const detail =
        typeof sendError === "string"
          ? sendError
          : (sendError as { message?: string })?.message ?? JSON.stringify(sendError);
      console.error("[notify-subscription-cancelled] send FAILED:", detail);

      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { error: failLogErr } = await supabaseAdmin.rpc("log_org_email_send_failure", {
        _organization_id: organizationId,
        _method: "resend",
        _fell_back_to: null,
        _recipient: adminEmail,
        _subject: `Subscription Cancelled: ${customerName}`,
        _error_message: detail,
      });
      if (failLogErr) console.error("[notify-subscription-cancelled] failure-log insert failed:", failLogErr);

      return new Response(
        JSON.stringify({ success: false, error: "notification email failed", detail }),
        { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    console.log("[notify-subscription-cancelled] Cancellation notification sent:", sendData?.id);

    return new Response(JSON.stringify({ success: true, emailId: sendData?.id }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("[notify-subscription-cancelled] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);

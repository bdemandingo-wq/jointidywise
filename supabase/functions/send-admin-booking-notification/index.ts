import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrgEmailSettings, formatEmailFrom } from "../_shared/get-org-email-settings.ts";
import { sendOrgEmail } from "../_shared/send-org-email.ts";
import { verifyOrgAccess } from "../_shared/verify-org-access.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface BookingNotificationRequest {
  customerName: string;
  customerEmail: string;
  serviceName: string;
  scheduledAt: string;
  totalAmount: number;
  address?: string;
  organizationId: string; // REQUIRED - no fallback allowed
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      customerName, 
      customerEmail, 
      serviceName, 
      scheduledAt, 
      totalAmount,
      address,
      organizationId
    }: BookingNotificationRequest = await req.json();

    // CRITICAL: organizationId is REQUIRED for multi-tenant isolation
    if (!organizationId) {
      console.error("[send-admin-booking-notification] Missing organizationId - cannot send notification without organization context");
      return new Response(JSON.stringify({ 
        error: "Missing organizationId - organization context is required" 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Verify caller is either the service role (internal webhook) or an
    // authenticated member of this organization.
    const access = await verifyOrgAccess(req, organizationId);
    if (!access.ok) {
      console.warn("[send-admin-booking-notification] Unauthorized:", access.error);
      return new Response(JSON.stringify({ error: access.error }), {
        status: access.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }


    // Get email settings from organization_email_settings table
    const emailSettingsResult = await getOrgEmailSettings(organizationId);
    if (!emailSettingsResult.success || !emailSettingsResult.settings) {
      console.error("[send-admin-booking-notification] Failed to get email settings:", emailSettingsResult.error);
      return new Response(
        JSON.stringify({ error: emailSettingsResult.error }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("[send-admin-booking-notification] Sending notification for org:", organizationId);

    const emailSettings = emailSettingsResult.settings;
    const senderFrom = formatEmailFrom(emailSettings);
    // Admin notifications go to the organization's email
    const adminEmail = emailSettings.from_email;

    // Get business settings for branding
    let companyName = emailSettings.from_name;
    let orgTimezone = "America/New_York";
    
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: settings } = await supabase
        .from('business_settings')
        .select('company_name, timezone')
        .eq('organization_id', organizationId)
        .maybeSingle();
      
      if (settings?.company_name) {
        companyName = settings.company_name;
      }
      if (settings?.timezone) {
        orgTimezone = settings.timezone;
      }
    }

    const bookingDate = new Date(scheduledAt);
    // Use org timezone to avoid UTC shift in Deno runtime
    const formattedDate = new Intl.DateTimeFormat('en-US', {
      timeZone: orgTimezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(bookingDate);
    const formattedTime = new Intl.DateTimeFormat('en-US', {
      timeZone: orgTimezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(bookingDate);

    const sendResult = await sendOrgEmail({
      templateName: "admin_new_booking",
      organizationId,
      to: adminEmail,
      subject: `🆕 New Booking: ${customerName} - ${serviceName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f5; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; padding: 25px; text-align: center; border-radius: 10px 10px 0 0; }
            .header h1 { margin: 0; font-size: 22px; }
            .content { background: white; padding: 25px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .badge { display: inline-block; background: #22c55e; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; margin-bottom: 15px; }
            .details-grid { display: grid; gap: 15px; }
            .detail-row { display: flex; border-bottom: 1px solid #e5e7eb; padding: 12px 0; }
            .detail-row:last-child { border-bottom: none; }
            .detail-label { color: #6b7280; width: 120px; font-size: 14px; }
            .detail-value { font-weight: 600; color: #111827; flex: 1; }
            .amount-box { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 20px; border-radius: 8px; text-align: center; margin-top: 20px; }
            .amount-label { font-size: 14px; opacity: 0.9; }
            .amount-value { font-size: 32px; font-weight: bold; margin-top: 5px; }
            .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; padding: 15px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📋 New Booking Created</h1>
            </div>
            <div class="content">
              <span class="badge">NEW BOOKING</span>
              
              <div class="details-grid">
                <div class="detail-row">
                  <span class="detail-label">Customer</span>
                  <span class="detail-value">${customerName}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Email</span>
                  <span class="detail-value">${customerEmail}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Service</span>
                  <span class="detail-value">${serviceName}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Date</span>
                  <span class="detail-value">${formattedDate}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Time</span>
                  <span class="detail-value">${formattedTime}</span>
                </div>
                ${address ? `
                <div class="detail-row">
                  <span class="detail-label">Address</span>
                  <span class="detail-value">${address}</span>
                </div>
                ` : ''}
              </div>
              
              <div class="amount-box">
                <div class="amount-label">Total Amount</div>
                <div class="amount-value">$${totalAmount.toFixed(2)}</div>
              </div>
              
              ${emailSettings.email_footer ? `<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;"><p style="font-size: 12px; color: #9ca3af;">${emailSettings.email_footer}</p>` : ''}
            </div>
            <div class="footer">
              <p>This is an automated notification from your booking system.</p>
              <p>Log in to your admin dashboard to view full details.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    if (!sendResult.success) {
      const rawMsg = sendResult.error ?? "Email send failed";
      console.error("[send-admin-booking-notification] send error:", rawMsg);

      // Adapted to sendOrgEmail's error shape — the transport (Gmail SMTP,
      // Resend fallback, or settings-missing) is abstracted, and all of those
      // are fixed in the same place, so point the owner there.
      const friendly = `Booking notification email failed to send: ${rawMsg}. Check Settings → Emails.`;

      // Surface to org owner via admin_system_notifications — louder than the
      // delivery panel (a missed booking alert is worth the interrupt). Dedupe by day.
      try {
        if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
          const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
          const day = new Date().toISOString().slice(0, 10);
          await admin.from("admin_system_notifications").upsert({
            organization_id: organizationId,
            type: "email_send_failure",
            title: "Booking notification email failed",
            message: friendly,
            link: "/dashboard/settings?tab=emails",
            metadata: { function: "send-admin-booking-notification", raw: rawMsg, method: sendResult.method, from: senderFrom, to: adminEmail },
            is_read: false,
            dedupe_key: `email_send_failure:send-admin-booking-notification:${day}`,
          }, { onConflict: "organization_id,dedupe_key" });
        }
      } catch (notifyErr) {
        console.error("[send-admin-booking-notification] Failed to write admin notification:", notifyErr);
      }

      return new Response(
        JSON.stringify({ error: friendly, detail: rawMsg }),
        { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    console.log("[send-admin-booking-notification] Email sent successfully:", sendResult.id, "via", sendResult.method);

    return new Response(JSON.stringify({
      success: true,
      emailId: sendResult.id,
      to: adminEmail,
      from: senderFrom,
      method: sendResult.method,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("[send-admin-booking-notification] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);

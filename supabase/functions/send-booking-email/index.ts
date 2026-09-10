import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrgEmailSettings } from "../_shared/get-org-email-settings.ts";
import { logAudit, AuditActions } from "../_shared/audit-log.ts";
import { loadOrgBrand, renderBrandedEmail } from "../_shared/org-email-renderer.ts";
import { resolveCallerOrg } from "../_shared/require-caller-org.ts";
import { formatFullAddress } from "../_shared/format-address.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface BookingEmailRequest {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  serviceName: string;
  homeSize: string;
  appointmentDate: string;
  appointmentTime: string;
  address: string;
  aptSuite?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  extras: string[];
  totalPrice: number;
  confirmationNumber: string;
  organizationId: string; // REQUIRED - no fallback allowed
}

// Helper to send SMS via OpenPhone
async function sendBookingSMS(
  supabase: any,
  organizationId: string,
  customerPhone: string,
  customerName: string,
  appointmentDate: string,
  appointmentTime: string,
  serviceName: string,
  companyName: string
): Promise<void> {
  try {
    // Check if SMS is enabled for this org
    const { data: smsSettings } = await supabase
      .from('organization_sms_settings')
      .select('sms_enabled, sms_booking_confirmation, openphone_api_key, openphone_phone_number_id')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (!smsSettings?.sms_enabled || !smsSettings?.sms_booking_confirmation) {
      console.log("[send-booking-email] SMS disabled or confirmation SMS disabled for org:", organizationId);
      return;
    }

    if (!smsSettings.openphone_api_key || !smsSettings.openphone_phone_number_id) {
      console.log("[send-booking-email] OpenPhone not configured for org:", organizationId);
      return;
    }

    if (!customerPhone) {
      console.log("[send-booking-email] No customer phone provided, skipping SMS");
      return;
    }

    // Format phone number
    let formattedPhone = customerPhone.replace(/\D/g, '');
    if (formattedPhone.length === 10) {
      formattedPhone = `+1${formattedPhone}`;
    } else if (!formattedPhone.startsWith('+')) {
      formattedPhone = `+${formattedPhone}`;
    }

    const message = `Hi ${customerName}! Your ${serviceName} booking with ${companyName} is confirmed for ${appointmentDate} at ${appointmentTime}. We look forward to serving you!`;

    console.log(`[send-booking-email] Sending SMS to ${formattedPhone}`);

    const response = await fetch("https://api.openphone.com/v1/messages", {
      method: "POST",
      headers: {
        "Authorization": smsSettings.openphone_api_key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: smsSettings.openphone_phone_number_id,
        to: [formattedPhone],
        content: message,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[send-booking-email] SMS failed: ${response.status} - ${errorText}`);
    } else {
      console.log("[send-booking-email] SMS sent successfully");
    }
  } catch (smsError) {
    console.error("[send-booking-email] SMS error:", smsError);
    // Don't throw - SMS is secondary to email
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!RESEND_API_KEY) {
    console.error("Missing RESEND_API_KEY secret");
    return new Response(JSON.stringify({ error: "Email service is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  let bookingBody: Partial<BookingEmailRequest> = {};
  try {
    bookingBody = (await req.json()) as Partial<BookingEmailRequest>;
  } catch (parseErr) {
    console.error("[send-booking-email] Failed to parse request body:", parseErr);
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const booking = bookingBody;


    const customerEmail = (booking.customerEmail || "").trim();
    const customerName = (booking.customerName || "").trim();

    if (!customerEmail) {
      return new Response(JSON.stringify({ error: "Missing customerEmail" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // SECURITY: never trust organizationId from the request body — resolve it
    // from the caller's own JWT + org_memberships instead. The body's value
    // (if any) is ignored below.
    const callerOrg = await resolveCallerOrg(req, booking.organizationId ?? null);
    if (!callerOrg.ok) {
      return new Response(JSON.stringify({ error: callerOrg.error }), {
        status: callerOrg.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    booking.organizationId = callerOrg.ctx.organizationId;

    console.log("Sending booking confirmation email to:", customerEmail, "for organization:", booking.organizationId);

    // Fetch email identity (single source of truth) + full branding via shared loader
    const emailSettingsResult = await getOrgEmailSettings(booking.organizationId);
    if (!emailSettingsResult.success || !emailSettingsResult.settings) {
      console.error("Failed to get email settings:", emailSettingsResult.error);
      return new Response(JSON.stringify({
        error: emailSettingsResult.error || "Email settings not configured"
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const senderEmail = emailSettingsResult.settings.from_email;

    const brandResult = await loadOrgBrand(booking.organizationId);
    if (!brandResult.success) {
      return new Response(JSON.stringify({ error: brandResult.error }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const brand = brandResult.brand;
    const companyName = brand.companyName;

    // Load admin's custom template copy from business_settings
    let customConfirmationBody = "";
    let customConfirmationSubject = "";
    let customSections: any = null;
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: settings } = await supabase
        .from('business_settings')
        .select('confirmation_email_subject, confirmation_email_body, confirmation_email_sections')
        .eq('organization_id', booking.organizationId)
        .maybeSingle();
      if (settings) {
        customConfirmationBody = (settings as any).confirmation_email_body || "";
        customConfirmationSubject = (settings as any).confirmation_email_subject || "";
        const secs = (settings as any).confirmation_email_sections;
        if (Array.isArray(secs) && secs.length > 0) customSections = secs;
      }
    }

    console.log("[send-booking-email] using org", booking.organizationId, "sender:", senderEmail);

    const fullAddress = formatFullAddress({
      address: booking.address,
      apt_suite: booking.aptSuite,
      city: booking.city,
      state: booking.state,
      zip_code: booking.zipCode,
    });
    const safeExtras = Array.isArray(booking.extras) ? booking.extras : [];
    const extrasText = safeExtras.length > 0 ? safeExtras.join(", ") : "None";

    const defaultBody =
      `Hi {{customer_name}},\n\n` +
      `Thank you for booking with ${companyName}! You're all set.\n\n` +
      `Please review the appointment details below. Reply to this email if anything looks off.\n\n` +
      `We look forward to serving you!`;

    const bookingData = {
      customer_name: customerName || "there",
      booking_number: booking.confirmationNumber || "",
      service_name: booking.serviceName || "",
      scheduled_date: booking.appointmentDate || "",
      scheduled_time: booking.appointmentTime || "",
      address: fullAddress || booking.address || "",
      total_amount: String(booking.totalPrice ?? ""),
      company_name: companyName,
    };

    const { subject: emailSubject, html: emailHtml } = renderBrandedEmail({
      brand,
      subject: customConfirmationSubject || "Booking Confirmed - {{scheduled_date}}",
      bodyText: customConfirmationBody || defaultBody,
      sections: customSections || undefined,
      data: bookingData,
      showAppointmentCard: true,
      bannerLabel: "Booking Confirmed",
    });


    


    // Send via unified org sender (Gmail SMTP → Resend fallback)
    const { sendOrgEmail } = await import("../_shared/send-org-email.ts");
    const customerSend = await sendOrgEmail({
      templateName: "booking_confirmation",
      organizationId: booking.organizationId,
      to: customerEmail,
      subject: emailSubject,
      html: emailHtml,
    });

    if (!customerSend.success) {
      if (/not verified/i.test(customerSend.error || "")) {
        const domain = senderEmail.split('@')[1];
        console.error(`Domain ${domain} is not verified`);
        throw new Error(`Your email domain (${domain}) is not verified. Please verify it to send emails.`);
      }
      throw new Error(customerSend.error || "Failed to send customer email");
    }
    const customerData: any = { id: customerSend.id };
    console.log("Customer email sent via", customerSend.method, "id:", customerSend.id);

    // Send notification to admin
    const adminNotificationHtml = `
      <h2>New Booking Received</h2>
      <p><strong>Customer:</strong> ${customerName || "N/A"}</p>
      <p><strong>Email:</strong> ${customerEmail}</p>
      <p><strong>Phone:</strong> ${booking.customerPhone || "N/A"}</p>
      <p><strong>Service:</strong> ${booking.serviceName || "N/A"}</p>
      <p><strong>Date:</strong> ${booking.appointmentDate || "N/A"}</p>
      <p><strong>Time:</strong> ${booking.appointmentTime || "N/A"}</p>
      <p><strong>Address:</strong> ${fullAddress || "N/A"}</p>
      <p><strong>Total:</strong> $${booking.totalPrice ?? "N/A"}</p>
      <p><strong>Extras:</strong> ${extrasText}</p>
    `;

    try {
      await sendOrgEmail({
        templateName: "booking_admin_copy",
        organizationId: booking.organizationId,
        to: senderEmail,
        subject: `New Booking - ${booking.serviceName || "Cleaning"} - ${booking.appointmentDate || ""}`,
        html: adminNotificationHtml,
      });
      console.log("Admin notification sent successfully");
    } catch (adminError) {
      console.error("Failed to send admin notification:", adminError);
    }


    // NOTE: Confirmation SMS is intentionally NOT sent here to avoid duplicate texts.
    // The booking form (BookingStepper) and public booking flow send their own
    // confirmation SMS via send-openphone-sms when the "Send confirmation SMS"
    // toggle is enabled. This function is responsible for the EMAIL only.
    void sendBookingSMS; // keep helper available for future use

    // Audit log: successful email send
    logAudit({
      action: AuditActions.EMAIL_BOOKING_CONFIRMATION,
      organizationId: booking.organizationId,
      resourceType: 'customer',
      resourceId: customerEmail,
      details: { confirmationNumber: booking.confirmationNumber, service: booking.serviceName },
      success: true,
    });

    return new Response(JSON.stringify({ success: true, emailId: customerData?.id }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-booking-email function:", error);

    // Audit log: failed email send (reuse already-parsed body — never call req.json() twice)
    logAudit({
      action: AuditActions.EMAIL_BOOKING_CONFIRMATION,
      organizationId: bookingBody.organizationId || 'unknown',
      success: false,
      error: error?.message,
    });

    return new Response(JSON.stringify({ error: error?.message || String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

};

serve(handler);

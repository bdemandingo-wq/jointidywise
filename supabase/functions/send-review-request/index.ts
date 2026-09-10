import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrgEmailSettings, formatEmailFrom, getReplyTo } from "../_shared/get-org-email-settings.ts";
import { resolveCallerOrg } from "../_shared/require-caller-org.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReviewRequestPayload {
  bookingId: string;
  customerId: string;
  customerEmail: string;
  customerName: string;
  serviceName: string;
  googleReviewUrl?: string;
  organizationId: string; // REQUIRED - no fallback allowed
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

  try {
    const payload: ReviewRequestPayload = await req.json();
    const { bookingId, customerId, customerEmail, customerName, serviceName, googleReviewUrl } = payload;

    if (!customerEmail || !bookingId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // SECURITY: never trust organizationId from the request body — resolve it
    // from the caller's own JWT + org_memberships/staff record instead
    // (this function is called from both the admin dashboard and the staff
    // portal's "request a review" action).
    const callerOrg = await resolveCallerOrg(req, payload.organizationId ?? null);
    if (!callerOrg.ok) {
      return new Response(JSON.stringify({ error: callerOrg.error }), {
        status: callerOrg.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const organizationId = callerOrg.ctx.organizationId;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Fetch email settings from organization_email_settings table (SINGLE SOURCE OF TRUTH)
    const emailSettingsResult = await getOrgEmailSettings(organizationId);
    
    if (!emailSettingsResult.success || !emailSettingsResult.settings) {
      console.error("Failed to get email settings:", emailSettingsResult.error);
      return new Response(JSON.stringify({ 
        error: emailSettingsResult.error || "Email settings not configured" 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const emailSettings = emailSettingsResult.settings;
    const companyName = emailSettings.from_name;
    
    console.log("Using org email settings - from:", emailSettings.from_email, "name:", companyName);
    
    // Get Google review URL and org-specific app URL from business_settings
    const { data: businessSettings } = await supabase
      .from('business_settings')
      .select('google_review_url, app_url')
      .eq('organization_id', organizationId)
      .maybeSingle();
    
    // Generate unique token for this review request
    const token = crypto.randomUUID();
    
    // Use org-specific app URL, fallback to global PROJECT_URL
    const projectUrl = (businessSettings?.app_url || Deno.env.get("APP_URL") || Deno.env.get("PROJECT_URL") || "https://jointidywise.com").replace(/\/+$/, '');
    const reviewPageUrl = `${projectUrl}/review/${token}`;

    // Get staff_id from booking to associate review with cleaner
    const { data: bookingData } = await supabase
      .from("bookings")
      .select("staff_id")
      .eq("id", bookingId)
      .single();

    // Get default Google review URL from business settings if not provided
    let finalGoogleUrl = googleReviewUrl;
    if (!finalGoogleUrl && businessSettings?.google_review_url) {
      finalGoogleUrl = businessSettings.google_review_url;
    }

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
        google_review_url: finalGoogleUrl,
      });

    if (insertError) {
      console.error("Failed to create review request:", insertError);
      throw new Error("Failed to create review request record");
    }

    console.log("Sending review request email to:", customerEmail, "for organization:", organizationId);

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>How did we do?</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#333333;line-height:1.6;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f5f5f5;">
    <tr>
      <td style="padding:20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin:0 auto;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background-color:#1e5bb0;padding:30px;text-align:center;">
              <div style="font-size:32px;font-weight:bold;color:#ffffff;">
                ${companyName}
              </div>
              <p style="color:#ffffff;font-size:14px;margin:5px 0 0 0;">Professional Cleaning Services</p>
            </td>
          </tr>
          
          <!-- Main Content -->
          <tr>
            <td style="padding:40px 30px;text-align:center;">
              <h1 style="margin:0 0 20px 0;color:#1e5bb0;font-size:28px;">How was your ${serviceName}?</h1>
              
              <p style="font-size:16px;margin:0 0 30px 0;color:#666;">
                Hi ${customerName}! We'd love to hear about your experience. Your feedback helps us improve and helps others find great cleaning services.
              </p>
              
              <p style="font-size:16px;margin:0 0 20px 0;color:#333;font-weight:600;">
                Tap a star to rate your experience:
              </p>
              
              <!-- Star Rating Buttons -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 30px auto;">
                <tr>
                  <td style="padding:0 5px;">
                    <a href="${reviewPageUrl}?rating=1" style="text-decoration:none;font-size:40px;">⭐</a>
                  </td>
                  <td style="padding:0 5px;">
                    <a href="${reviewPageUrl}?rating=2" style="text-decoration:none;font-size:40px;">⭐</a>
                  </td>
                  <td style="padding:0 5px;">
                    <a href="${reviewPageUrl}?rating=3" style="text-decoration:none;font-size:40px;">⭐</a>
                  </td>
                  <td style="padding:0 5px;">
                    <a href="${reviewPageUrl}?rating=4" style="text-decoration:none;font-size:40px;">⭐</a>
                  </td>
                  <td style="padding:0 5px;">
                    <a href="${reviewPageUrl}?rating=5" style="text-decoration:none;font-size:40px;">⭐</a>
                  </td>
                </tr>
                <tr>
                  <td style="text-align:center;font-size:12px;color:#999;">1</td>
                  <td style="text-align:center;font-size:12px;color:#999;">2</td>
                  <td style="text-align:center;font-size:12px;color:#999;">3</td>
                  <td style="text-align:center;font-size:12px;color:#999;">4</td>
                  <td style="text-align:center;font-size:12px;color:#999;">5</td>
                </tr>
              </table>
              
              <p style="font-size:14px;color:#999;margin:0;">
                It only takes a minute and means a lot to us!
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color:#333333;padding:20px;text-align:center;">
              <p style="color:#ffffff;font-size:14px;font-weight:600;margin:0 0 5px 0;">${companyName}</p>
              <p style="color:#999999;font-size:12px;margin:0;">
                © ${new Date().getFullYear()} ${companyName}. All rights reserved.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const { sendOrgEmail } = await import("../_shared/send-org-email.ts");
    const sendResult = await sendOrgEmail({
      templateName: "review_request",
      marketing: true,
      organizationId,
      to: customerEmail,
      subject: `How was your ${serviceName}? We'd love your feedback!`,
      html: emailHtml,
    });

    if (!sendResult.success) {
      if (/not verified/i.test(sendResult.error || "")) {
        const domain = emailSettings.from_email.split('@')[1];
        throw new Error(`Your email domain (${domain}) is not verified. Please verify it to send emails.`);
      }
      throw new Error(sendResult.error || "Failed to send email");
    }
    const emailData: any = { id: sendResult.id };
    console.log("Review request email sent via", sendResult.method, "id:", sendResult.id);


    return new Response(JSON.stringify({ success: true, emailId: emailData?.id }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-review-request function:", error);
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);

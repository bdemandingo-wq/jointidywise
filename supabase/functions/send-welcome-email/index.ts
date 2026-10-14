import { sendResendEmail } from "../_shared/send-resend.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { escapeHtml } from "../_shared/escapeHtml.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface WelcomeEmailRequest {
  email: string;
  fullName?: string;
  userId?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!RESEND_API_KEY) {
    console.error("[send-welcome-email] Missing RESEND_API_KEY secret");
    return new Response(JSON.stringify({ error: "Email service is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const { email, fullName, userId } = (await req.json()) as WelcomeEmailRequest;

    if (!email) {
      return new Response(JSON.stringify({ error: "Missing email" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    console.log("[send-welcome-email] Sending welcome email to:", email);

    // Welcome emails for new signups come from the public support inbox.
    // jointidywise.com is the verified Resend domain.
    const TIDYWISE_DEFAULT_EMAIL = tidywiseSupportEmail();
    const TIDYWISE_DEFAULT_NAME = "TidyWise";

    const senderEmail = TIDYWISE_DEFAULT_EMAIL;
    const companyName = TIDYWISE_DEFAULT_NAME;
    const primaryColor = "#1e5bb0";
    const accentColor = "#14b8a6";

    const userName = fullName || email.split('@')[0];

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to ${companyName}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#333333;line-height:1.6;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f5f5f5;">
    <tr>
      <td style="padding:20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin:0 auto;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%);padding:50px 30px;text-align:center;">
              <div style="font-size:36px;font-weight:bold;color:#ffffff;">${companyName}</div>
              <p style="color:rgba(255,255,255,0.9);font-size:16px;margin:15px 0 0 0;letter-spacing:0.5px;">Your Business Management Platform</p>
            </td>
          </tr>
          
          <!-- Welcome Banner -->
          <tr>
            <td style="background-color:#22c55e;padding:20px;text-align:center;">
              <span style="color:#ffffff;font-size:24px;font-weight:600;">🎉 Welcome Aboard!</span>
            </td>
          </tr>
          
          <!-- Main Content -->
          <tr>
            <td style="padding:40px 30px;">
              <p style="font-size:20px;margin:0 0 20px 0;color:#1f2937;">Hi ${escapeHtml(userName)},</p>
              
              <p style="margin:0 0 20px 0;font-size:16px;color:#4b5563;">Welcome to <strong>${companyName}</strong>! We're thrilled to have you join our community of cleaning professionals.</p>
              
              <p style="margin:0 0 25px 0;font-size:16px;color:#4b5563;">Your account has been successfully created and you're ready to start managing your cleaning business like a pro.</p>
              
              <!-- Features Card -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f9fafb;border-radius:12px;margin-bottom:25px;border:1px solid #e5e7eb;">
                <tr>
                  <td style="padding:25px;">
                    <h3 style="margin:0 0 20px 0;color:${primaryColor};font-size:14px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">What You Can Do</h3>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;">
                          <span style="color:${accentColor};font-size:18px;margin-right:10px;">📅</span>
                          <span style="color:#1f2937;font-size:15px;">Manage bookings and appointments</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;">
                          <span style="color:${accentColor};font-size:18px;margin-right:10px;">👥</span>
                          <span style="color:#1f2937;font-size:15px;">Track customers and their preferences</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;">
                          <span style="color:${accentColor};font-size:18px;margin-right:10px;">👷</span>
                          <span style="color:#1f2937;font-size:15px;">Manage your cleaning staff</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;">
                          <span style="color:${accentColor};font-size:18px;margin-right:10px;">💰</span>
                          <span style="color:#1f2937;font-size:15px;">Handle invoices and payments</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:12px 0;">
                          <span style="color:${accentColor};font-size:18px;margin-right:10px;">📊</span>
                          <span style="color:#1f2937;font-size:15px;">View reports and insights</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:30px 0;">
                <tr>
                  <td style="text-align:center;">
                    <a href="${Deno.env.get("APP_URL") || "https://jointidywise.com"}/dashboard" style="display:inline-block;background:linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%);color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:8px;font-size:16px;font-weight:600;box-shadow:0 4px 14px rgba(30,91,176,0.4);">Go to Dashboard</a>
                  </td>
                </tr>
              </table>

              <!-- Book a Demo Card -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:linear-gradient(135deg,#f0fdfa 0%,#eff6ff 100%);border-radius:12px;border:1px solid #99f6e4;margin-bottom:25px;">
                <tr>
                  <td style="padding:28px;text-align:center;">
                    <div style="font-size:30px;margin-bottom:6px;">🎥</div>
                    <h3 style="margin:0 0 10px 0;color:${primaryColor};font-size:20px;font-weight:700;">Want a personal walkthrough?</h3>
                    <p style="margin:0 0 18px 0;font-size:15px;color:#4b5563;line-height:1.5;">
                      Book a free 1-on-1 demo with our team. We'll show you how to set up your services, import customers, automate reminders, and start taking bookings — all in about 20 minutes.
                    </p>
                    <a href="${Deno.env.get("APP_URL") || "https://jointidywise.com"}/demo" style="display:inline-block;background-color:${accentColor};color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;box-shadow:0 4px 12px rgba(20,184,166,0.3);">Book My Free Demo</a>
                    <p style="margin:14px 0 0 0;font-size:12px;color:#6b7280;">No card required • Pick any time that works for you</p>
                  </td>
                </tr>
              </table>

              <!-- Get the app -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;margin-bottom:25px;">
                <tr>
                  <td style="padding:24px;text-align:center;">
                    <div style="font-size:28px;margin-bottom:6px;">📱</div>
                    <h3 style="margin:0 0 8px 0;color:${primaryColor};font-size:18px;font-weight:700;">Take TidyWise with you</h3>
                    <p style="margin:0 0 16px 0;font-size:14px;color:#4b5563;line-height:1.5;">
                      Run your day from your phone, or install TidyWise on your Mac or Windows desktop. Same account, same data, wherever you're working.
                    </p>
                    <a href="${Deno.env.get("APP_URL") || "https://jointidywise.com"}/get-the-app" style="display:inline-block;background-color:${primaryColor};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;">Get the app</a>
                  </td>
                </tr>
              </table>

              <!-- Tips Box -->
              <div style="background-color:#eff6ff;padding:20px;border-radius:8px;border-left:4px solid ${primaryColor};margin-bottom:30px;">
                <h4 style="margin:0 0 10px 0;color:${primaryColor};font-size:14px;">💡 Quick Tip</h4>
                <p style="margin:0;font-size:14px;color:#1e40af;">Start by setting up your services and staff members. Then you can begin accepting bookings right away!</p>
              </div>
              
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:30px 0;">
              
              <p style="margin:0 0 10px 0;text-align:center;font-size:14px;color:#6b7280;">
                Need help getting started? Reply to this email and we'll be happy to assist.
              </p>
              <p style="margin:0;text-align:center;font-size:16px;font-weight:bold;color:${primaryColor};">
                Let's grow your business together! 🚀
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color:#1f2937;padding:25px;text-align:center;">
              <p style="color:#ffffff;font-size:16px;font-weight:600;margin:0 0 5px 0;">${companyName}</p>
              <p style="color:#9ca3af;font-size:12px;margin:0 0 12px;">
                © ${new Date().getFullYear()} ${companyName}. All rights reserved.
              </p>
              <p style="color:#9ca3af;font-size:11px;margin:0;">
                <a href="mailto:${senderEmail}?subject=Unsubscribe" style="color:#9ca3af;">Unsubscribe</a>
                ·
                <a href="mailto:${senderEmail}" style="color:#9ca3af;">${senderEmail}</a>
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

    const res = await sendResendEmail( {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `${companyName} <${senderEmail}>`,
        reply_to: senderEmail,
        to: [email],
        subject: `Welcome to ${companyName}! 🎉`,
        html: emailHtml,
      }),
    });

    let data: any = null;
    try {
      data = await res.json();
    } catch (_e) {
      data = null;
    }

    if (!res.ok && data?.name === 'validation_error' && data?.message?.includes('not verified')) {
      const domain = senderEmail.split('@')[1];
      console.error(`[send-welcome-email] Domain ${domain} is not verified on Resend`);
      throw new Error(`Email domain (${domain}) is not verified. Please verify it at https://resend.com/domains`);
    }

    if (!res.ok) {
      console.error("[send-welcome-email] Resend API error:", { status: res.status, data });
      throw new Error(data?.message || `Failed to send welcome email (status ${res.status})`);
    }

    console.log("[send-welcome-email] Welcome email sent successfully:", data?.id);

    return new Response(JSON.stringify({ success: true, emailId: data?.id }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("[send-welcome-email] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);

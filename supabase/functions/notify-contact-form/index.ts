import { sendResendEmail } from "../_shared/send-resend.ts";
// Contact form notifier. Sends two emails per submission:
//   1. Admin alert to the public support inbox with the message
//   2. Confirmation reply to the submitter so they know we received it
//
// The contact form previously invoked notify-demo-request and silently
// failed because that function requires fullName/phone/businessName.
// This dedicated handler takes only { name, email, message }.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { tidywiseEmailFooterHtml, tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { PLATFORM_SENDER_EMAIL } from "../_shared/email-sender-resolution.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPPORT_EMAIL = tidywiseSupportEmail();
const TIDYWISE_ORG_ID = "e95b92d0-7099-408e-a773-e4407b34f8b4";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const name = (body?.name ?? "").toString().trim();
    const email = (body?.email ?? "").toString().trim().toLowerCase();
    const message = (body?.message ?? "").toString().trim();

    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (name.length > 100 || email.length > 200 || message.length > 4000) {
      return new Response(
        JSON.stringify({ success: false, error: "Field too long" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: emailSettings } = await supabase
      .from("organization_email_settings")
      .select("resend_api_key, from_email, from_name")
      .eq("organization_id", TIDYWISE_ORG_ID)
      .maybeSingle();

    const resendKey = emailSettings?.resend_api_key || Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.error("[notify-contact-form] No Resend API key configured");
      return new Response(
        JSON.stringify({ success: false, error: "Email is not configured on the server" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fromName = emailSettings?.from_name || "TidyWise";
    const fromEmail = emailSettings?.from_email || PLATFORM_SENDER_EMAIL;
    const from = `${fromName} <${fromEmail}>`;

    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeMessage = escapeHtml(message).replace(/\n/g, "<br/>");

    // 1. Admin alert
    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a1a1a; margin: 0 0 12px;">New contact form message</h2>
        <p style="margin: 4px 0;"><strong>From:</strong> ${safeName}</p>
        <p style="margin: 4px 0;"><strong>Email:</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
        <div style="color: #333; line-height: 1.6; white-space: pre-wrap;">${safeMessage}</div>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
        <p style="font-size: 12px; color: #888;">Reply directly to this email to respond to ${safeName}.</p>
      </div>`;

    const adminRes = await sendResendEmail( {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [SUPPORT_EMAIL],
        reply_to: email,
        subject: `[Contact form] ${name}`,
        html: adminHtml,
      }),
    });
    if (!adminRes.ok) {
      const errText = await adminRes.text().catch(() => "");
      console.error("[notify-contact-form] Admin email failed:", adminRes.status, errText);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to send notification" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.log("[notify-contact-form] Admin email sent");

    // 2. User confirmation
    const firstName = name.split(" ")[0] || name;
    const safeFirst = escapeHtml(firstName);
    const userHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a1a1a; margin: 0 0 12px;">Thanks ${safeFirst} — we got your message.</h2>
        <p style="color: #555; line-height: 1.6;">We'll get back to you within 24 business hours.</p>
        <p style="color: #555; line-height: 1.6;">For your records, here's what you sent:</p>
        <div style="background: #f5f5f5; border-left: 3px solid #2563eb; padding: 12px 16px; margin: 16px 0; color: #333; line-height: 1.6; white-space: pre-wrap;">${safeMessage}</div>
        <p style="color: #555; line-height: 1.6;">
          Need us sooner? Reply to this email or write us at
          <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
        </p>
        <p style="color: #555; line-height: 1.6; margin-top: 24px;">
          — The TidyWise team<br/>
          <a href="https://jointidywise.com" style="color: #2563eb;">jointidywise.com</a>
        </p>
        ${tidywiseEmailFooterHtml()}
      </div>`;

    try {
      const userRes = await sendResendEmail( {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [email],
          reply_to: SUPPORT_EMAIL,
          subject: "We got your message — TidyWise",
          html: userHtml,
        }),
      });
      if (!userRes.ok) {
        const errText = await userRes.text().catch(() => "");
        console.error("[notify-contact-form] User confirmation failed:", userRes.status, errText);
      } else {
        console.log("[notify-contact-form] User confirmation sent to", email);
      }
    } catch (err) {
      // Non-fatal — admin already got the message
      console.error("[notify-contact-form] User confirmation error:", err);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[notify-contact-form] Unhandled error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Contact form notifier. Sends two emails per submission:
//   1. Admin alert to the public support inbox with the message
//   2. Confirmation reply to the submitter so they know we received it
//
// The contact form previously invoked notify-demo-request and silently
// failed because that function requires fullName/phone/businessName.
// This dedicated handler takes only { name, email, message }.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { PLATFORM_SENDER_EMAIL } from "../_shared/email-sender-resolution.ts";
import { renderCrmEmail } from "../_shared/crm-email/render.ts";

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

    const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");

    // 1. Admin alert
    const adminMail = renderCrmEmail("internal-contact-form", {
      vars: { name, email, message: safeMessage },
      rawKeys: ["message"],
    });

    const adminRes = await fetch("https://api.resend.com/emails", {
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
        html: adminMail.html,
        text: adminMail.text,
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

    // 2. User confirmation. The design greets by name; it does not echo the message.
    const firstName = name.split(" ")[0] || name;
    const userMail = renderCrmEmail("contact-auto-reply", {
      vars: { name: firstName },
    });

    try {
      const userRes = await fetch("https://api.resend.com/emails", {
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
          html: userMail.html,
          text: userMail.text,
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

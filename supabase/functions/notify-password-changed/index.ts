import { sendResendEmail } from "../_shared/send-resend.ts";
// Sends a "your password was changed" confirmation email after a successful
// password reset. SECURITY: recipient is derived from the authenticated user's
// own auth record — a body-supplied email is IGNORED so an attacker can't use
// this endpoint to blast arbitrary addresses.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { tidywiseEmailFooterHtml, tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { PLATFORM_SENDER_FROM } from "../_shared/email-sender-resolution.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Require an authenticated user; ignore any body-supplied email.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.slice(7).trim();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user?.email) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const email = userData.user.email;
    const meta = (userData.user.user_metadata ?? {}) as { full_name?: string; name?: string };
    const name = meta.full_name || meta.name || null;

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.warn("[notify-password-changed] RESEND_API_KEY not set — skipping");
      return new Response(JSON.stringify({ success: false, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const firstName = (name?.split(" ")[0] || "there").trim();
    const when = new Date().toLocaleString("en-US", {
      dateStyle: "long", timeStyle: "short",
    });

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a1a1a; margin: 0 0 12px;">Your TidyWise password was changed</h2>
        <p style="color: #333; line-height: 1.6;">
          Hi ${escapeHtml(firstName)}, this is a confirmation that the password
          for your TidyWise account was successfully changed on
          <strong>${escapeHtml(when)}</strong>.
        </p>
        <p style="color: #333; line-height: 1.6;">
          If you made this change, no further action is needed.
        </p>
        <div style="background: #fff7ed; border-left: 4px solid #f59e0b; padding: 12px 16px; margin: 16px 0;">
          <p style="color: #92400e; margin: 0; line-height: 1.5;">
            <strong>Didn't change your password?</strong> Reset it immediately at
            <a href="https://www.jointidywise.com/forgot-password" style="color: #92400e;">jointidywise.com/forgot-password</a>
            and contact <a href="mailto:${tidywiseSupportEmail()}" style="color: #92400e;">${tidywiseSupportEmail()}</a>.
          </p>
        </div>
        <p style="color: #555; margin-top: 24px;">— The TidyWise team</p>
        ${tidywiseEmailFooterHtml()}
      </div>`;

    try {
      await sendResendEmail( {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: PLATFORM_SENDER_FROM,
          to: [email],
          reply_to: tidywiseSupportEmail(),
          subject: "Your TidyWise password was changed",
          html,
        }),
      });
    } catch (err) {
      console.error("[notify-password-changed] send failed:", err);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[notify-password-changed] error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

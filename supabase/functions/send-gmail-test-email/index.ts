// Sends a test email through the org's configured Gmail SMTP credentials.
// Used by the "Send Test Email" button in the Email Settings UI.
// Does NOT increment the daily counter and does NOT fall back to Resend —
// admins want to see the real SMTP error.
//
// DO NOT route this through sendOrgEmail. Its entire purpose is to verify the
// org's Gmail credentials *directly*. sendOrgEmail's Gmail→Resend fallback
// would deliver the test via Resend when Gmail is misconfigured, reporting a
// false "Gmail works" and defeating the test. This must stay Gmail-direct.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { getOrgEmailSettings, formatEmailFrom, getReplyTo } from "../_shared/get-org-email-settings.ts";
import { renderCrmEmail } from "../_shared/crm-email/render.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabase = createClient(supabaseUrl, serviceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) throw new Error("Unauthorized");

    const { organizationId, to } = await req.json();
    if (!organizationId || !to) throw new Error("Missing organizationId or to");

    // Verify admin membership
    const { data: mem } = await supabase
      .from("org_memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!mem || !["owner", "admin"].includes((mem as any).role)) {
      throw new Error("Only org admins/owners can send test emails");
    }

    const settingsResult = await getOrgEmailSettings(organizationId);
    if (!settingsResult.success || !settingsResult.settings) {
      throw new Error(settingsResult.error || "Email settings not configured");
    }
    const settings = settingsResult.settings;
    if (!settings.smtp_email || !settings.smtp_app_password) {
      throw new Error("Gmail SMTP is not configured. Add your Gmail address and app password first.");
    }

    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: { username: settings.smtp_email, password: settings.smtp_app_password },
      },
    });

    const from = formatEmailFrom(settings);
    const replyTo = getReplyTo(settings);
    const testMail = renderCrmEmail("gmail-smtp-test", {
      vars: { APP_URL: Deno.env.get("APP_URL") || "https://jointidywise.com" },
    });
    const html = testMail.html;
    const text = testMail.text;
    const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
    try {
      await client.send({
        from,
        to: [to],
        replyTo,
        subject: "TidyWise: Gmail SMTP test",
        mimeContent: [
          { mimeType: 'text/plain; charset="utf-8"', content: b64(text), transferEncoding: "base64" },
          { mimeType: 'text/html; charset="utf-8"', content: b64(html), transferEncoding: "base64" },
        ],
      });
      await client.close();
    } catch (e: any) {
      try { await client.close(); } catch (_) { /* ignore */ }
      throw new Error(`Gmail SMTP error: ${e?.message ?? String(e)}. Common causes: (1) not using a Google App Password (16 chars, no spaces), (2) 2-Step Verification not enabled on the account, (3) Gmail address doesn't match the app password's account.`);
    }

    return new Response(JSON.stringify({ success: true, sentTo: to, from }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[send-gmail-test-email] Error:", e?.message ?? e);
    return new Response(JSON.stringify({ error: e?.message ?? "Failed to send test email" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

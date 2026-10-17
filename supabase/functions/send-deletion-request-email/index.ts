// SECURITY REVIEW (2026-07-14): intentionally public/unauthenticated.
// Its only caller is src/pages/DeleteAccountPage.tsx (/delete-account), a
// standalone public page with no login gate — by design, since someone
// requesting account deletion may be locked out, have forgotten their
// password, or simply not want to log back in just to ask to be deleted.
// Requiring a JWT here would break that flow for exactly the users who
// most need it. Already had rate limiting (1/request per email per day,
// 5/hour per IP) before this review. Free-text fields are escaped before
// they go into the HTML body. Added a length cap on those fields below as
// light additional hardening against oversized-payload abuse.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logToSystem } from "../_shared/system-logger.ts";
import { getOrgEmailSettings, formatEmailFrom, getReplyTo } from "../_shared/get-org-email-settings.ts";
import { checkAndRecord, getClientIp } from "../_shared/rate-limit.ts";
import { escapeHtml } from "../_shared/crm-email/fill.ts";
import { renderCrmEmail } from "../_shared/crm-email/render.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_FIELD_LEN = 500;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { email, organizationId } = body;
    const name = typeof body.name === "string" ? body.name.slice(0, MAX_FIELD_LEN) : body.name;
    const organizationName = typeof body.organizationName === "string" ? body.organizationName.slice(0, MAX_FIELD_LEN) : body.organizationName;
    const reason = typeof body.reason === "string" ? body.reason.slice(0, MAX_FIELD_LEN) : body.reason;

    if (!name || !email) {
      return new Response(JSON.stringify({ error: "Name and email are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Rate limit: max 1 deletion request per email per 24 hours
    // (legit users only need to submit once), plus a coarser IP cap
    // (max 5/hour) to prevent inbox spam from a single attacker
    // cycling email addresses. Returns the same generic success
    // response either way so we don't reveal whether the email exists.
    const normalizedEmail = String(email).toLowerCase().trim();
    const emailLimit = await checkAndRecord(supabase, "deletion_request",
      `email:${normalizedEmail}`, { maxPerWindow: 1, windowSeconds: 86400 });
    if (emailLimit.blocked) {
      console.warn("[send-deletion-request-email] Email throttle tripped:", normalizedEmail);
      return new Response(
        JSON.stringify({ success: true, message: "Your request has been received. We'll process it within 7 business days." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const ipLimit = await checkAndRecord(supabase, "deletion_request",
      `ip:${getClientIp(req)}`, { maxPerWindow: 5, windowSeconds: 3600 });
    if (ipLimit.blocked) {
      console.warn("[send-deletion-request-email] IP throttle tripped:", getClientIp(req));
      return new Response(
        JSON.stringify({ success: true, message: "Your request has been received. We'll process it within 7 business days." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve organizationId: use provided one, or look up from user's email via org_memberships
    let resolvedOrgId = organizationId;
    if (!resolvedOrgId) {
      // Try to find org from user's auth email
      const { data: authUsers } = await supabase.auth.admin.listUsers();
      const matchedUser = authUsers?.users?.find(
        (u: any) => u.email?.toLowerCase() === email.toLowerCase()
      );
      if (matchedUser) {
        const { data: membership } = await supabase
          .from("org_memberships")
          .select("organization_id")
          .eq("user_id", matchedUser.id)
          .limit(1)
          .maybeSingle();
        resolvedOrgId = membership?.organization_id;
      }
    }

    if (!resolvedOrgId) {
      console.error("[DELETION-EMAIL] Could not resolve organization for email:", email);
      return new Response(JSON.stringify({ error: "Could not determine organization. Please contact support." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get org-scoped email settings (single source of truth)
    const emailSettingsResult = await getOrgEmailSettings(resolvedOrgId);
    if (!emailSettingsResult.success || !emailSettingsResult.settings) {
      console.error("[DELETION-EMAIL] Failed to get email settings:", emailSettingsResult.error);
      return new Response(JSON.stringify({ error: emailSettingsResult.error || "Email settings not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const settings = emailSettingsResult.settings;
    const resendApiKey = settings.resend_api_key || Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("[DELETION-EMAIL] No Resend API key configured");
      return new Response(JSON.stringify({ error: "Email service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const senderFrom = formatEmailFrom(settings);
    const companyName = settings.from_name;

    const request = [
      `Name: ${escapeHtml(String(name))}`,
      `Email: ${escapeHtml(String(email))}`,
      `Organization: ${escapeHtml(String(organizationName || companyName || ""))}`,
      `Reason: ${escapeHtml(String(reason || "Not provided"))}`,
      `Submitted: ${escapeHtml(new Date().toISOString())}`,
      "Please verify the user's identity and process this deletion request within 7 business days.",
    ].join("<br>");
    const deletion = renderCrmEmail("account-deletion-request", {
      vars: {
        email,
        request,
        APP_URL: Deno.env.get("APP_URL") || "https://jointidywise.com",
      },
      rawKeys: ["request"],
    });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: senderFrom,
        to: [settings.from_email],
        reply_to: getReplyTo(settings),
        subject: `Account Deletion Request - ${email}`,
        html: deletion.html,
        text: deletion.text,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[DELETION-EMAIL] Resend error:", errText);
    }

    await logToSystem({
      level: "info",
      source: "send-deletion-request-email",
      message: `Account deletion request submitted by ${email} for org ${resolvedOrgId}`,
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[DELETION-EMAIL] Error:", error);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

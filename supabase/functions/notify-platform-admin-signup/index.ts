// Platform admin notification on a new TidyWise signup.
//
// Previously sent SMS via OpenPhone to two platform admin phone numbers.
// SMS removed for cost control — now sends a single email to
// the public support inbox via Resend.
//
// SECURITY (2026-07-14): previously trusted email/fullName/phone entirely
// from the request body with no caller-identity check — anyone could spam
// support@'s inbox with an officially-formatted "new signup" email
// carrying an attacker-controlled reply_to and free-text name/phone,
// impersonating a lead. Both call sites (SignupPage.tsx right after
// signUp() succeeds, OnboardingPage.tsx during onboarding) always have a
// live Supabase session by the time they call this — signup on this app
// auto-establishes a session with no email-confirmation gate — so this
// now requires a valid JWT and derives email/fullName from the caller's
// own auth record instead of trusting the body for those two fields.
// The branded signup alert only carries name and email. Phone and
// signup method are still accepted on the body for older clients, but
// the template has no tokens for them.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { checkAndRecord, getClientIp } from "../_shared/rate-limit.ts";
import { tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { PLATFORM_SENDER_FROM } from "../_shared/email-sender-resolution.ts";
import { renderCrmEmail } from "../_shared/crm-email/render.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAIL = tidywiseSupportEmail();

interface NotifySignupRequest {
  phone?: string;
  signupMethod?: string; // 'email' | 'google'
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.warn("[notify-platform-admin-signup] RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ success: false, error: "Email service not configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: userData, error: userError } = await supabase.auth.getUser(
      authHeader.slice("Bearer ".length).trim(),
    );
    if (userError || !userData?.user?.email) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const email = userData.user.email;
    const fullName = (userData.user.user_metadata as Record<string, unknown> | null)?.full_name as string | undefined
      ?? (userData.user.user_metadata as Record<string, unknown> | null)?.name as string | undefined;

    // Defense in depth even though this is now caller-identified — caps
    // how many admin-notification emails one account can trigger.
    const rateLimit = await checkAndRecord(supabase, "notify_platform_admin_signup",
      `user:${userData.user.id}|ip:${getClientIp(req)}`, { maxPerWindow: 5, windowSeconds: 3600 });
    if (rateLimit.blocked) {
      return new Response(
        JSON.stringify({ success: true, skipped: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Drain the body so a malformed payload still fails the same way.
    // Phone and signup method are not part of the branded template.
    await req.json() as NotifySignupRequest;

    const signupMail = renderCrmEmail("internal-new-signup", {
      vars: {
        fullName: fullName || email,
        email,
        APP_URL: Deno.env.get("APP_URL") || "https://jointidywise.com",
      },
    });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: PLATFORM_SENDER_FROM,
        to: [ADMIN_EMAIL],
        reply_to: email,
        subject: `🚀 New signup: ${fullName || email}`,
        html: signupMail.html,
        text: signupMail.text,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[notify-platform-admin-signup] Resend error:", res.status, errText);
      return new Response(
        JSON.stringify({ success: false, error: "Email send failed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[notify-platform-admin-signup] Admin email sent for", email);
    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[notify-platform-admin-signup] Error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

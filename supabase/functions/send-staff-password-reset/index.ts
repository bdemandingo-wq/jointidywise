import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkAndRecord, getClientIp } from "../_shared/rate-limit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// redirectUrl is user-controlled and gets baked into the Supabase
// recovery link. An open redirect here would let an attacker craft a
// reset SMS that bounces the staff member to a phishing site post-
// login. Hard-allow only the public TidyWise domains and the native
// app's capacitor:// scheme.
const ALLOWED_REDIRECT_HOSTS = new Set([
  "jointidywise.com",
  "www.jointidywise.com",
  "tidywisecleaning.com",
  "www.tidywisecleaning.com",
]);

function isAllowedRedirect(url: string | null | undefined): boolean {
  if (!url) return false;
  // capacitor:// is the native-app scheme — no host to check.
  if (url.startsWith("capacitor://")) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return ALLOWED_REDIRECT_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PasswordResetRequest {
  email: string;
  redirectUrl: string;
}

// Format phone to E.164
function formatPhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.startsWith('+') ? phone : `+${digits}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      SUPABASE_URL ?? "",
      SUPABASE_SERVICE_ROLE_KEY ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // SECURITY: the request body only ever identifies WHICH account wants a
    // reset (email). Destination phone and organization are always resolved
    // server-side from the staff record below — never trust a client-
    // supplied phone or organizationId here, or an attacker who knows a
    // staff member's email can redirect their real recovery link to a
    // phone number (or billing org) they control.
    const { email, redirectUrl }: PasswordResetRequest = await req.json();

    if (!email) {
      return new Response(JSON.stringify({ error: "Email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Redirect-URL whitelist — see ALLOWED_REDIRECT_HOSTS above.
    // Open redirect here = phishing vector (staff thinks they're going
    // to TidyWise, lands on attacker's clone).
    if (!isAllowedRedirect(redirectUrl)) {
      console.warn("[send-staff-password-reset] Rejected redirectUrl:", redirectUrl);
      return new Response(
        JSON.stringify({ error: "Invalid redirect URL" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Rate limit: max 3 reset attempts per email per 10 minutes, plus
    // max 10 per IP per hour as a coarser net against IP-based abuse.
    // Both fail-open if the throttle table is down (logged but allowed)
    // so a transient DB hiccup doesn't lock real users out.
    const normalizedEmail = email.toLowerCase().trim();
    const emailLimit = await checkAndRecord(supabaseAdmin, "password_reset",
      `email:${normalizedEmail}`, { maxPerWindow: 3, windowSeconds: 600 });
    if (emailLimit.blocked) {
      console.warn("[send-staff-password-reset] Email-scoped throttle tripped:", normalizedEmail);
      // Return the generic "if an account exists..." response — don't
      // tell the caller whether the email is real OR whether they tripped
      // the limit. Either signal helps attackers.
      return new Response(
        JSON.stringify({ success: true, message: "If an account exists, a reset link has been sent." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const ipLimit = await checkAndRecord(supabaseAdmin, "password_reset",
      `ip:${getClientIp(req)}`, { maxPerWindow: 10, windowSeconds: 3600 });
    if (ipLimit.blocked) {
      console.warn("[send-staff-password-reset] IP-scoped throttle tripped:", getClientIp(req));
      return new Response(
        JSON.stringify({ success: true, message: "If an account exists, a reset link has been sent." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Look up the staff member. Everything downstream (org, phone) is
    // resolved from THIS row only — the request body is never consulted
    // again past this point.
    //
    // One person can hold staff rows in several organizations (a cleaner
    // working for two businesses under one login), so this must NOT use
    // maybeSingle() — that errors PGRST116 on 2+ rows and used to fall
    // through into the generic "success" response with nothing sent.
    //
    // We deliberately pick the OLDEST active row (created_at ASC, id ASC
    // as a unique tiebreaker). This is a security requirement: any org
    // admin can invite an arbitrary email as staff and set a phone they
    // control, so preferring "whichever org has SMS configured" would let
    // an attacker capture a victim's recovery SMS. The oldest row cannot
    // be attacker-selected. Matches get_my_staff_profile()'s default.
    //
    // Filter on the normalized email (invite-staff stores lowercase), and
    // with .eq() not .ilike() — "_" is legal in emails and is a wildcard
    // in ILIKE, which could match a different person's row.
    const { data: staffRows, error: staffError } = await supabaseAdmin
      .from("staff")
      .select("id, name, user_id, organization_id, phone")
      .eq("email", normalizedEmail)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1);

    if (staffError) {
      // A real DB failure must never be disguised as the privacy response.
      console.error("[send-staff-password-reset] Error looking up staff:", staffError);
      return new Response(
        JSON.stringify({ error: "Unable to process password reset. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Zero rows is NOT an error — that's the genuine "no account" case.
    const staffMember = staffRows?.[0] ?? null;

    const organizationId = staffMember?.organization_id;
    const staffPhone = staffMember?.phone;
    const staffId = staffMember?.id ?? null;

    console.log("[send-staff-password-reset] Processing password reset", { orgId: organizationId ?? null, staffId });

    if (!organizationId) {
      console.log("[send-staff-password-reset] No organization found", { staffId });
      return new Response(
        JSON.stringify({ success: true, message: "If an account exists, a reset link has been sent." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get SMS settings for the organization
    const { data: smsSettings } = await supabaseAdmin
      .from('organization_sms_settings')
      .select('sms_enabled, openphone_api_key, openphone_phone_number_id')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (!smsSettings?.sms_enabled || !smsSettings?.openphone_api_key || !smsSettings?.openphone_phone_number_id) {
      console.log("[send-staff-password-reset] SMS not configured", { orgId: organizationId, staffId });
      return new Response(
        JSON.stringify({ error: "SMS is not configured for this organization. Please contact your administrator." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!staffPhone) {
      // Fail closed — never fall back to a client-supplied phone number.
      console.log("[send-staff-password-reset] No phone on file, failing closed", { orgId: organizationId, staffId });
      return new Response(
        JSON.stringify({ error: "No phone number on file. Please contact your administrator." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get business name
    const { data: businessSettings } = await supabaseAdmin
      .from('business_settings')
      .select('company_name')
      .eq('organization_id', organizationId)
      .maybeSingle();

    const companyName = businessSettings?.company_name || "Your Company";

    const origin = req.headers.get("origin") ?? "";
    const safeRedirectUrl =
      redirectUrl && origin && redirectUrl.startsWith(origin)
        ? redirectUrl
        : origin
          ? `${origin}/staff/reset-password`
          : redirectUrl;

    let staffName = staffMember?.name || "Team Member";
    let targetUserId: string | null = staffMember?.user_id || null;

    if (!targetUserId) {
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });

      const match = usersData?.users?.find(
        (u) => (u.email ?? "").toLowerCase() === email.toLowerCase()
      );
      if (match) {
        targetUserId = match.id;
        const metaName = (match.user_metadata as Record<string, unknown> | null)?.full_name;
        if (typeof metaName === "string" && metaName.trim()) staffName = metaName;
      }
    }

    if (!targetUserId) {
      console.log("[send-staff-password-reset] No auth account found", { orgId: organizationId, staffId });
      return new Response(
        JSON.stringify({ success: true, message: "If an account exists, a reset link has been sent." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify staff/admin role
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", targetUserId)
      .in("role", ["staff", "admin"]);

    if (!roleData || roleData.length === 0) {
      console.log("[send-staff-password-reset] User has no staff/admin role", { orgId: organizationId, staffId });
      return new Response(
        JSON.stringify({ success: true, message: "If an account exists, a reset link has been sent." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate recovery link
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: safeRedirectUrl },
    });

    if (linkError) {
      console.error("[send-staff-password-reset] Error generating recovery link:", linkError);
      return new Response(JSON.stringify({ error: "Failed to generate reset link" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resetLink = linkData.properties?.action_link;
    // Never log the reset link itself — it's a live, unauthenticated
    // recovery credential for this account.
    console.log("[send-staff-password-reset] Recovery link generated, sending via SMS", { orgId: organizationId, staffId });

    // Send SMS via OpenPhone
    const formattedPhone = formatPhoneE164(staffPhone);
    const message = `Hi ${staffName}! Reset your ${companyName} staff portal password here: ${resetLink}`;

    const authHeader = smsSettings.openphone_api_key.trim().replace(/^Bearer\s+/i, '');

    const response = await fetch("https://api.openphone.com/v1/messages", {
      method: "POST",
      headers: {
        "Authorization": authHeader,
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
      console.error(`[send-staff-password-reset] SMS delivery failed: ${response.status} - ${errorText}`, { orgId: organizationId, staffId });
      // 401/403 means the organization's stored OpenPhone API key is invalid
      // or revoked — that's a configuration problem, not a transient server
      // fault, and "please try again" sends staff into an infinite retry loop.
      const isAuthFailure = response.status === 401 || response.status === 403;
      return new Response(
        JSON.stringify({
          error: isAuthFailure
            ? "Your organization's text-messaging connection is no longer valid, so the reset link could not be sent. Please ask your administrator to reconnect OpenPhone in Settings."
            : "Failed to send SMS. Please try again.",
        }),
        { status: isAuthFailure ? 400 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }


    console.log("[send-staff-password-reset] SMS delivered", { orgId: organizationId, staffId });

    return new Response(JSON.stringify({ success: true, message: "Password reset link sent via SMS" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[send-staff-password-reset] Error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
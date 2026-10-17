import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrgEmailSettings, formatEmailFrom, getReplyTo } from "../_shared/get-org-email-settings.ts";
import { verifyPortalSession } from "../_shared/portal-session.ts";
import { verifyAdminAuth } from "../_shared/verify-admin-auth.ts";
import { renderCrmEmail, orgBrandVars, UNSUBSCRIBE_URL_SENTINEL } from "../_shared/crm-email/render.ts";
import { loadLooseBrand } from "../_shared/org-email-renderer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-portal-session",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { referralId } = await req.json();
    console.log("[send-referral-invite] Processing referral ID:", referralId);

    // Get referral details with referrer info
    const { data: referral, error: referralError } = await supabase
      .from("referrals")
      .select(`
        *,
        referrer:referrer_customer_id (
          first_name,
          last_name,
          email
        )
      `)
      .eq("id", referralId)
      .single();

    if (referralError || !referral) {
      throw new Error("Referral not found");
    }

    // AUTH: the client portal sends x-portal-session (no Supabase user JWT).
    // An org admin/manager may also send their own referral. Anyone else — 
    // including a bare anon key — must not send from this org's domain.
    if (req.headers.get("x-portal-session")) {
      const session = await verifyPortalSession(req, supabase);
      if (!session.ok) {
        return new Response(JSON.stringify({ error: session.error }), {
          status: session.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (
        session.organization_id !== referral.organization_id ||
        session.customer_id !== referral.referrer_customer_id
      ) {
        return new Response(JSON.stringify({ error: "Not allowed to send this invite" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      const authResult = await verifyAdminAuth(req.headers.get("Authorization"), {
        requireAdmin: true,
        requireOrganizationId: referral.organization_id,
      });
      if (!authResult.success) {
        const denied = /access denied/i.test(authResult.error || "");
        return new Response(JSON.stringify({ error: authResult.error || "Unauthorized" }), {
          status: denied ? 403 : 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // CRITICAL: organization_id is REQUIRED for multi-tenant isolation
    if (!referral.organization_id) {
      console.error("[send-referral-invite] Referral has no organization_id - cannot send email without organization context");
      return new Response(JSON.stringify({ 
        error: "Referral is not associated with an organization. Please update the referral." 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[send-referral-invite] Processing for organization:", referral.organization_id);

    // Get email settings from organization_email_settings table (SINGLE SOURCE OF TRUTH)
    const emailSettingsResult = await getOrgEmailSettings(referral.organization_id);
    if (!emailSettingsResult.success || !emailSettingsResult.settings) {
      console.error("[send-referral-invite] Failed to get email settings:", emailSettingsResult.error);
      return new Response(
        JSON.stringify({ error: emailSettingsResult.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailSettings = emailSettingsResult.settings;
    const senderFrom = formatEmailFrom(emailSettings);
    const companyName = emailSettings.from_name;

    console.log("[send-referral-invite] Using org email settings - from:", senderFrom, "company:", companyName);

    const referrerName = `${referral.referrer.first_name} ${referral.referrer.last_name}`;
    const creditAmount = referral.credit_amount || 25;

    // Resolve org slug for the booking URL
    const { data: orgData } = await supabase
      .from("organizations")
      .select("slug")
      .eq("id", referral.organization_id)
      .single();
    const orgSlug = orgData?.slug || "";

    // Build booking URL using APP_URL env var (falls back to production domain)
    const appUrl = Deno.env.get("APP_URL") || "https://jointidywise.com";
    const bookingUrl = orgSlug
      ? `${appUrl}/book/${orgSlug}?ref=${referral.referral_code}`
      : `${appUrl}/book?ref=${referral.referral_code}`;

    const brand = await loadLooseBrand(referral.organization_id);
    const rendered = renderCrmEmail("referral-invite", {
      vars: {
        ...orgBrandVars(brand),
        ...(companyName ? { companyName } : {}),
        referrerName,
        creditAmount,
        bookingUrl,
        referral_code: referral.referral_code || "",
        UNSUBSCRIBE_URL: UNSUBSCRIBE_URL_SENTINEL,
      },
      rawKeys: ["email_footer"],
    });

    const { sendOrgEmail } = await import("../_shared/send-org-email.ts");
    const sendResult = await sendOrgEmail({
      templateName: "referral_invite",
      marketing: true,
      organizationId: referral.organization_id,
      to: referral.referred_email,
      subject: `${referrerName} thinks you'd love ${companyName}! Get $${creditAmount} off`,
      html: rendered.html,
      text: rendered.text,
    });

    if (!sendResult.success) {
      if (/not verified/i.test(sendResult.error || "")) {
        const domain = emailSettings.from_email.split('@')[1];
        throw new Error(`Your email domain (${domain}) is not verified. Please verify it to send emails.`);
      }
      throw new Error(sendResult.error || "Failed to send email");
    }
    console.log("[send-referral-invite] Sent via", sendResult.method, "id:", sendResult.id);


    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("[send-referral-invite] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrgEmailSettings, formatEmailFrom, getReplyTo } from "../_shared/get-org-email-settings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    const html = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">You've Been Referred! 🎉</h1>
            </div>
            <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 12px 12px;">
              <p style="font-size: 16px;">Hi${referral.referred_name ? ` ${referral.referred_name}` : ''}!</p>
              <p style="font-size: 16px;">
                Your friend <strong>${referrerName}</strong> thinks you'd love our cleaning services,
                and we're thrilled to offer you a special welcome gift:
              </p>
              <div style="background: #10b981; color: white; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
                <p style="margin: 0; font-size: 14px; opacity: 0.9;">Your Welcome Credit</p>
                <p style="margin: 10px 0 0 0; font-size: 32px; font-weight: bold;">$${creditAmount} OFF</p>
              </div>
              <p style="font-size: 16px;">
                This credit will be automatically applied to your first booking.
                Plus, ${referrerName} will also receive a $${creditAmount} credit as a thank you!
              </p>
              <div style="text-align: center; margin-top: 30px;">
                <a href="${bookingUrl}"
                   style="display: inline-block; background: #10b981; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                  Book Your First Clean
                </a>
              </div>
              <p style="font-size: 12px; color: #666; margin-top: 30px; text-align: center;">
                Your referral code: <strong>${referral.referral_code}</strong>
              </p>
            </div>
          </body>
          </html>
        `;

    const { sendOrgEmail } = await import("../_shared/send-org-email.ts");
    const sendResult = await sendOrgEmail({
      templateName: "referral_invite",
      marketing: true,
      organizationId: referral.organization_id,
      to: referral.referred_email,
      subject: `${referrerName} thinks you'd love ${companyName}! Get $${creditAmount} off`,
      html,
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
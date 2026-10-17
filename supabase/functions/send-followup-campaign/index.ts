import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAdminAuth, createUnauthorizedResponse, createForbiddenResponse } from "../_shared/verify-admin-auth.ts";
import { getOrgEmailSettings, formatEmailFrom } from "../_shared/get-org-email-settings.ts";
import { escapeHtml } from "../_shared/escapeHtml.ts";
import { renderCrmEmail, orgBrandVars, UNSUBSCRIBE_URL_SENTINEL } from "../_shared/crm-email/render.ts";
import { loadLooseBrand } from "../_shared/org-email-renderer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const { campaignId, targetAudience } = await req.json();

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get campaign details
    const { data: campaign, error: campaignError } = await supabase
      .from("automated_campaigns")
      .select("*")
      .eq("id", campaignId)
      .single();

    if (campaignError || !campaign) {
      throw new Error("Campaign not found");
    }

    // CRITICAL: Campaign must have organization_id for multi-tenant isolation
    if (!campaign.organization_id) {
      console.error("[send-followup-campaign] Campaign has no organization_id - cannot send emails without organization context");
      return new Response(JSON.stringify({
        error: "Campaign is not associated with an organization. Please update the campaign."
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // SECURITY: Verify authenticated user has admin privileges IN THE
    // CAMPAIGN'S org — not an arbitrary first membership (multi-org users).
    const authResult = await verifyAdminAuth(req.headers.get("Authorization"), {
      requireAdmin: true,
      requireOrganizationId: campaign.organization_id,
    });

    if (!authResult.success) {
      return createForbiddenResponse(authResult.error || "Unauthorized", corsHeaders);
    }

    console.log("[send-followup-campaign] Running campaign for organization:", campaign.organization_id);

    // Get email settings from organization_email_settings table
    const emailSettingsResult = await getOrgEmailSettings(campaign.organization_id);
    if (!emailSettingsResult.success || !emailSettingsResult.settings) {
      console.error("[send-followup-campaign] Failed to get email settings:", emailSettingsResult.error);
      return new Response(
        JSON.stringify({ error: emailSettingsResult.error }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const emailSettings = emailSettingsResult.settings;
    const senderFrom = formatEmailFrom(emailSettings);

    // Get business settings for branding
    const { data: businessSettings } = await supabase
      .from("business_settings")
      .select("company_name")
      .eq("organization_id", campaign.organization_id)
      .maybeSingle();

    const companyName = businessSettings?.company_name || emailSettings.from_name;
    
    console.log("[send-followup-campaign] Using sender:", senderFrom, "company:", companyName);

    const audience: string = targetAudience || "inactive_clients";

    // Find recipients based on campaign type and audience
    let recipients: any[] = [];

    if (campaign.type === "inactive_customer" || campaign.type === "custom") {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - (campaign.days_inactive || 30));

      // Get all customers for this org first
      const { data: allCustomers } = await supabase
        .from("customers")
        .select("id, email, first_name, last_name")
        .eq("organization_id", campaign.organization_id)
        .not("email", "is", null);

      if (allCustomers) {
        for (const customer of allCustomers) {
          if (!customer.email) continue;

          const { data: lastBooking } = await supabase
            .from("bookings")
            .select("scheduled_at")
            .eq("customer_id", customer.id)
            .eq("organization_id", campaign.organization_id)
            .eq("status", "completed")
            .order("scheduled_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          const isInactive = lastBooking
            ? new Date(lastBooking.scheduled_at) < cutoffDate
            : true; // no completed booking → treat as inactive

          const isActive = lastBooking
            ? new Date(lastBooking.scheduled_at) >= cutoffDate
            : false;

          // Apply audience filter
          let include = false;
          if (audience === "all_customers") {
            include = true;
          } else if (audience === "inactive_clients" || audience === "inactive_customer") {
            include = isInactive;
          } else if (audience === "active_clients") {
            include = isActive;
          } else if (audience === "leads") {
            // Leads: customers with no completed bookings at all
            include = !lastBooking;
          } else {
            include = true;
          }

          if (!include) continue;

          // De-duplicate: skip if already emailed for this campaign in last 30 days
          const { data: recentEmail, error: recentEmailErr } = await supabase
            .from("campaign_emails")
            .select("id")
            .eq("campaign_id", campaignId)
            .eq("customer_id", customer.id)
            .gte("sent_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
            .maybeSingle();

          if (recentEmailErr) {
            console.error(`[send-followup-campaign] dedupe check failed for customer ${customer.id}, skipping to avoid a possible duplicate send:`, recentEmailErr);
            continue;
          }

          if (!recentEmail) {
            recipients.push(customer);
          }
        }
      }
    }

    console.log(`[send-followup-campaign] Found ${recipients.length} recipients for org ${campaign.organization_id} audience=${audience}`);

    const emailsSent: string[] = [];
    const emailsFailed: string[] = [];

    // Build the booking URL using APP_URL (same pattern as send-referral-invite)
    const appUrl = Deno.env.get("APP_URL") || "https://jointidywise.com";
    const { data: orgData } = await supabase
      .from("organizations")
      .select("slug")
      .eq("id", campaign.organization_id)
      .single();
    const orgSlug = orgData?.slug || "";
    const bookingUrl = orgSlug ? `${appUrl}/book/${orgSlug}` : `${appUrl}/book`;
    const brand = await loadLooseBrand(campaign.organization_id);

    // Throttle Gmail SMTP: pace sends and cap per run so we don't trip Gmail's
    // burst rate limits. The daily cap (500/2000) is enforced separately in
    // sendOrgEmail. 300ms × 200 ≈ 60s worst case; deferred recipients are
    // reported so the caller can re-run to continue a large campaign.
    const SEND_DELAY_MS = 300;
    const MAX_SENDS_PER_RUN = 200;

    // Send emails to recipients
    for (const customer of recipients) {
      // Replace placeholders — support both {single} and {{double}} brace formats
      const substitutions = (text: string) =>
        text
          // Double-brace format (legacy)
          .replace(/\{\{customer_name\}\}/g, customer.first_name)
          .replace(/\{\{company_name\}\}/g, companyName)
          // Single-brace format (current UI)
          .replace(/\{first_name\}/g, customer.first_name)
          .replace(/\{last_name\}/g, customer.last_name || "")
          .replace(/\{company_name\}/g, companyName)
          .replace(/\{booking_link\}/g, bookingUrl);

      const subject = substitutions(campaign.subject);
      const body = substitutions(campaign.body || "");

      // Escape before **bold** so an owner body cannot inject tags.
      // Braces in the owner body stay literal; fill.ts neutralizes them.
      const bodyHtml = escapeHtml(body)
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");

      try {
        const { sendOrgEmail } = await import("../_shared/send-org-email.ts");
        const rendered = renderCrmEmail("followup-campaign", {
          vars: {
            ...orgBrandVars(brand),
            ...(companyName
              ? { company_name: companyName, companyName, orgName: companyName }
              : {}),
            booking_link: bookingUrl,
            first_name: customer.first_name || "",
            UNSUBSCRIBE_URL: UNSUBSCRIBE_URL_SENTINEL,
          },
          slots: [bodyHtml],
          rawKeys: ["email_footer"],
        });
        const sendResult = await sendOrgEmail({
          templateName: "followup_campaign",
          marketing: true,
          organizationId: campaign.organization_id,
          to: customer.email,
          subject,
          html: rendered.html,
          text: rendered.text,
        });
        if (sendResult.success) {
          const { error: logErr } = await supabase.from("campaign_emails").insert({
            campaign_id: campaignId,
            customer_id: customer.id,
            email: customer.email,
            status: "sent",
          });
          if (logErr) {
            console.error(`[send-followup-campaign] email sent but campaign_emails insert failed for customer ${customer.id} — dedupe will not catch this next run:`, logErr);
          }
          emailsSent.push(customer.email);
        } else {
          console.error(`[send-followup-campaign] send failed for ${customer.email}:`, sendResult.error);
          emailsFailed.push(customer.email);
        }
      } catch (error) {
        console.error(`[send-followup-campaign] Failed to send email to ${customer.email}:`, error);
        emailsFailed.push(customer.email);
      }

      // Per-run cap + pacing (see constants above).
      if (emailsSent.length + emailsFailed.length >= MAX_SENDS_PER_RUN) break;
      await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
    }


    // Update campaign last_run_at
    await supabase
      .from("automated_campaigns")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", campaignId);

    const deferred = recipients.length - (emailsSent.length + emailsFailed.length);
    return new Response(
      JSON.stringify({
        success: true,
        sentCount: emailsSent.length,
        emailsSent: emailsSent.length,
        emailsFailed: emailsFailed.length,
        deferred,
        totalRecipients: recipients.length,
        details: { sent: emailsSent, failed: emailsFailed },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("[send-followup-campaign] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

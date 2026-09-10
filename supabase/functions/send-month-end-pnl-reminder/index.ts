import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrgEmailSettings } from "../_shared/get-org-email-settings.ts";
import { sendOrgEmail } from "../_shared/send-org-email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REMINDER_TYPE = "month_end_pnl";
const PNL_LINK = "/admin/reports?tab=pnl";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Determine if today is the last day of the month (in UTC).
    // Cron is scheduled 28-31 daily; only run on actual last day.
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(now.getUTCDate() + 1);
    const isLastDay = tomorrow.getUTCDate() === 1;

    // Allow ?force=1 to bypass for manual testing
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";

    if (!isLastDay && !force) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "Not the last day of month" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const monthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const dedupeKey = `month_end_pnl_${now.getUTCFullYear()}_${now.getUTCMonth() + 1}`;

    // Get all active organizations
    const { data: orgs, error: orgsErr } = await supabase
      .from("organizations")
      .select("id, name");

    if (orgsErr) throw orgsErr;

    const results: any[] = [];

    for (const org of orgs || []) {
      try {
        // 1) Insert in-app notification (deduped per org per month)
        const { error: notifErr } = await supabase
          .from("admin_system_notifications")
          .insert({
            organization_id: org.id,
            type: REMINDER_TYPE,
            title: "Month-end P&L reminder",
            message: `It's the end of ${monthLabel} — don't forget to update your P&L Overview with your revenue, marketing budget, and expenses.`,
            link: PNL_LINK,
            dedupe_key: dedupeKey,
          });

        if (notifErr && !String(notifErr.message).toLowerCase().includes("duplicate")) {
          console.error(`[month-end-pnl] notif error for org ${org.id}:`, notifErr);
        }

        // 2) Send email to organization
        const emailSettingsResult = await getOrgEmailSettings(org.id);
        if (!emailSettingsResult.success || !emailSettingsResult.settings) {
          results.push({ org_id: org.id, email_sent: false, reason: "no email settings" });
          continue;
        }

        const settings = emailSettingsResult.settings;
        const toEmail = settings.from_email;

        if (!toEmail) {
          results.push({ org_id: org.id, email_sent: false, reason: "no recipient email" });
          continue;
        }

        // app_url lives on business_settings, not organization_email_settings —
        // read it from the right table so the P&L link points at the org's app.
        const { data: bizSettings } = await supabase
          .from("business_settings")
          .select("app_url")
          .eq("organization_id", org.id)
          .maybeSingle();
        const appUrl = (bizSettings?.app_url || Deno.env.get("APP_URL") || "https://jointidywise.com").replace(/\/$/, "");

        const html = `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
            <h1 style="font-size:20px;margin:0 0 12px">Month-end P&amp;L reminder</h1>
            <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 16px">
              It's the end of <strong>${monthLabel}</strong> — don't forget to update your
              P&amp;L Overview with your revenue, marketing budget, and expenses.
            </p>
            <p style="margin:24px 0">
              <a href="${appUrl}${PNL_LINK}"
                 style="background:#0f172a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">
                Open P&amp;L Overview
              </a>
            </p>
            <p style="font-size:12px;color:#64748b;margin-top:24px">
              ${org.name || "Your organization"} · Automated reminder
            </p>
          </div>
        `;

        const sent = await sendOrgEmail({
          templateName: "pnl_reminder",
          organizationId: org.id,
          to: toEmail,
          subject: `Month-end P&L reminder — ${monthLabel}`,
          html,
        });

        results.push({ org_id: org.id, email_sent: sent.success, error: sent.error, method: sent.method });
      } catch (e: any) {
        console.error(`[month-end-pnl] org ${org.id} failed:`, e);
        results.push({ org_id: org.id, email_sent: false, error: e.message });
      }
    }

    return new Response(
      JSON.stringify({ success: true, month: monthLabel, processed: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[month-end-pnl] fatal:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

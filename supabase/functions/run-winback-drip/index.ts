import {
  resolveTemplate,
  resolveSubject,
  type AutomationKey,
} from "../_shared/automation-templates.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Throttle Gmail SMTP: pace sends and cap volume per org per run so we don't
// trip Gmail's burst rate limits. The daily cap (500/2000) is enforced
// separately in sendOrgEmail. 300ms × 200 ≈ 60s worst case, within the 120s
// cron timeout.
const SEND_DELAY_MS = 300;
const MAX_SENDS_PER_ORG = 200;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STEPS = [
  { step: 1, daysInactive: 30, offerPercent: 10, subject: "We miss you — here's 10% off your next clean" },
  { step: 2, daysInactive: 60, offerPercent: 15, subject: "Still thinking of you — 15% off inside" },
  { step: 3, daysInactive: 90, offerPercent: 20, subject: "Last chance — 20% off before we stop reaching out" },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // Cron auth gate
  const cronGate = requireCronSecret(req);
  if (cronGate) return cronGate;


  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date();
  const results: Record<string, number> = { step1: 0, step2: 0, step3: 0, skipped: 0 };

  try {
    // Get all organizations
    const { data: orgs } = await supabase.from("organizations").select("id").eq("is_active", true);
    if (!orgs?.length) return jsonOk({ results });

    for (const org of orgs) {
      // Opt-in gate: only send for orgs that have the winback_60day automation
      // explicitly enabled. Without this, the drip would send discount offers on
      // behalf of every org — including ones that turned it off. This keeps the
      // function safe-by-default if it's ever scheduled. (Whether winback should
      // be automatic at all, and its default-ON seed, are separate decisions.)
      const { data: automation } = await supabase
        .from("organization_automations")
        .select("is_enabled, settings")
        .eq("organization_id", org.id)
        .eq("automation_type", "winback_60day")
        .maybeSingle();
      if (!automation?.is_enabled) {
        results.skipped++;
        continue;
      }

      // Get email settings for org
      const { data: emailSettings } = await supabase
        .from("organization_email_settings")
        .select("from_email, from_name")
        .eq("organization_id", org.id)
        .maybeSingle();

      const { data: bizSettings } = await supabase
        .from("business_settings")
        .select("app_url")
        .eq("organization_id", org.id)
        .maybeSingle();

      const baseUrl = (bizSettings?.app_url || Deno.env.get("APP_URL") || "https://jointidywise.com").replace(/\/+$/, "");
      const companyName = emailSettings?.from_name || "Your Cleaning Company";
      const fromEmail = emailSettings?.from_email || "noreply@jointidywise.com";

      let sentThisOrg = 0;

      stepLoop: for (const { step, daysInactive, offerPercent, subject } of STEPS) {
        const cutoffDate = new Date(now);
        cutoffDate.setDate(cutoffDate.getDate() - daysInactive);

        const nextCutoff = new Date(now);
        nextCutoff.setDate(nextCutoff.getDate() - (daysInactive - 1));

        // Find customers whose last booking was exactly in the daysInactive window
        // and haven't already received this step
        const { data: customers } = await supabase.rpc("get_winback_candidates" as any, {
          p_organization_id: org.id,
          p_days_inactive: daysInactive,
          p_window_days: 1,
        }).catch(() => ({ data: null }));

        // Fallback: direct query if RPC doesn't exist
        const candidateList = customers || await getWinbackCandidatesDirect(supabase, org.id, cutoffDate, nextCutoff);

        for (const customer of (candidateList || [])) {
          if (!customer.email) { results.skipped++; continue; }

          // Check if this step was already sent
          const { data: existing, error: existingErr } = await supabase
            .from("winback_drip_log")
            .select("id")
            .eq("organization_id", org.id)
            .eq("customer_id", customer.id)
            .eq("step", step)
            .maybeSingle();

          if (existingErr) {
            // Fail closed: an unreadable dedupe check must not be treated as
            // "step never sent" — that's how a customer gets the same
            // winback offer emailed to them repeatedly.
            console.error(
              `[run-winback-drip] dedupe check failed org=${org.id} customer=${customer.id} step=${step}, skipping to avoid a possible duplicate send:`,
              existingErr,
            );
            results.skipped++;
            continue;
          }
          if (existing) { results.skipped++; continue; }

          // Send the email
          // All three steps live on the one winback_60day row, keyed by step,
          // so an owner rewording step 2 cannot disturb steps 1 and 3.
          const wbKey = `winback_step_${step}` as AutomationKey;
          const wbSettings = (automation?.settings ?? {}) as {
            templates?: Record<string, string>;
            template_subjects?: Record<string, string>;
          };
          const wbTokens = {
            customer_name: `${customer.first_name} ${customer.last_name}`.trim(),
            company_name: companyName,
            offer_percent: String(offerPercent),
          };
          const wbResolved = resolveTemplate(wbKey, wbSettings.templates?.[wbKey] ?? null, wbTokens);
          if (wbResolved.warning) {
            console.warn(`[run-winback-drip] org=${org.id} ${wbKey}: ${wbResolved.warning}`);
          }
          const resolvedSubject = resolveSubject(
            wbKey,
            wbSettings.template_subjects?.[wbKey] ?? null,
            wbTokens,
          );

          const html = buildWinbackEmail({
            customerName: `${customer.first_name} ${customer.last_name}`,
            companyName,
            offerPercent,
            bookingUrl: `${baseUrl}/book`,
            step,
            bodyText: wbResolved.text,
          });

          const { sendOrgEmail } = await import("../_shared/send-org-email.ts");
          const sendResult = await sendOrgEmail({
            templateName: "winback_drip",
            marketing: true,
            organizationId: org.id,
            to: customer.email,
            subject: resolvedSubject,
            html,
          });

          if (sendResult.success) {
            const { error: logErr } = await supabase.from("winback_drip_log").insert({
              organization_id: org.id,
              customer_id: customer.id,
              step,
            });
            if (logErr) {
              console.error(
                `[run-winback-drip] email sent but drip-log insert failed org=${org.id} customer=${customer.id} step=${step} — dedupe will not catch this next run:`,
                logErr,
              );
            }
            results[`step${step}`]++;
          }

          // Throttle + per-org cap. Counts every send attempt; the delay paces
          // Gmail SMTP, the cap is a safety ceiling (remainder drains next run).
          sentThisOrg++;
          if (sentThisOrg >= MAX_SENDS_PER_ORG) break stepLoop;
          await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
        }
      }
    }

    return jsonOk({ results });
  } catch (err: any) {
    console.error("[run-winback-drip] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function getWinbackCandidatesDirect(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  cutoffFrom: Date,
  cutoffTo: Date,
) {
  const { data } = await supabase
    .from("customers")
    .select("id, first_name, last_name, email")
    .eq("organization_id", orgId)
    .not("email", "is", null);

  if (!data?.length) return [];

  const results = [];
  for (const customer of data) {
    const { data: lastBooking } = await supabase
      .from("bookings")
      .select("completed_at, scheduled_at")
      .eq("customer_id", customer.id)
      .eq("status", "completed")
      .order("scheduled_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastBooking) continue;
    const lastDate = new Date(lastBooking.completed_at || lastBooking.scheduled_at);
    if (lastDate >= cutoffFrom && lastDate < cutoffTo) {
      results.push(customer);
    }
  }
  return results;
}

function buildWinbackEmail({ customerName, companyName, offerPercent, bookingUrl, step, bodyText }: {
  customerName: string; companyName: string; offerPercent: number; bookingUrl: string; step: number;
  /** Already resolved by the caller (org copy or shipped default). */
  bodyText?: string;
}) {
  // Kept only as a last-resort fallback for callers that pass no bodyText.
  // The live path always supplies it via resolveTemplate.
  const messages: Record<number, string> = {
    1: `It's been a month since we last cleaned your home, and we've been thinking about you! We'd love to welcome you back.`,
    2: `It's been two months and your home deserves the care it got before. We're still here and ready to help!`,
    3: `It's been three months since your last clean. This is our final check-in - we'd love one more chance to earn your business.`,
  };

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<table cellpadding="0" cellspacing="0" width="100%"><tr><td style="padding:20px;">
<table cellpadding="0" cellspacing="0" width="600" style="margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
  <tr><td style="background:#1e5bb0;padding:30px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;">${companyName}</h1>
  </td></tr>
  <tr><td style="padding:40px 30px;text-align:center;">
    <div style="font-size:48px;margin-bottom:16px;">🏠</div>
    <h2 style="color:#1e5bb0;margin:0 0 16px;">Hi ${customerName}!</h2>
    <p style="font-size:16px;color:#555;margin:0 0 24px;">${bodyText || messages[step]}</p>
    <div style="background:#f0f7ff;border-radius:8px;padding:20px;margin-bottom:24px;">
      <p style="font-size:14px;color:#777;margin:0 0 8px;">Special offer just for you</p>
      <p style="font-size:36px;font-weight:bold;color:#1e5bb0;margin:0;">${offerPercent}% OFF</p>
      <p style="font-size:13px;color:#999;margin:8px 0 0;">Your next cleaning service</p>
    </div>
    <a href="${bookingUrl}" style="display:inline-block;background:#1e5bb0;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:bold;">Book Now — ${offerPercent}% Off</a>
    <p style="font-size:12px;color:#aaa;margin-top:20px;">Just reply to this email and mention this offer when booking.</p>
  </td></tr>
  <tr><td style="background:#333;padding:20px;text-align:center;">
    <p style="color:#fff;font-size:13px;margin:0;">${companyName} &copy; ${new Date().getFullYear()}</p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}

function jsonOk(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

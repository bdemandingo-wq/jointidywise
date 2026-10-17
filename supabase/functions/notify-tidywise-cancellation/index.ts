// TidyWise SaaS subscription cancellation notifications.
//
// Fans out four messages on every cancellation:
//   1. Email to the customer — branded "sorry to see you go" with the
//      last day they retain access (period_end_date)
//   2. SMS to the customer — short version of the same, only if we
//      have their phone on file in profiles
//   3. Email to the public support inbox — admin alert
//      with reason / feedback so a personal save-call is possible
//   4. SMS to platform admin phones — same alert, mobile-first
//
// Triggered by self-cancel-subscription and admin-cancel-subscription
// AFTER Stripe accepts the cancel. Failures here are non-fatal — the
// cancellation itself still succeeds; the operator sees the missing
// notification in logs and can follow up manually.
//
// verify_jwt = false because some callers (admin-cancel) authenticate
// via platform-admin RPC and pass the user context in the body.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { PLATFORM_SENDER_EMAIL } from "../_shared/email-sender-resolution.ts";
import { renderCrmEmail } from "../_shared/crm-email/render.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAIL = tidywiseSupportEmail();

const REASON_LABELS: Record<string, string> = {
  not_enough_jobs: "Not enough jobs to justify it",
  going_manual: "Going back to manual/spreadsheets",
  switching_crm: "Switching to a different CRM",
  too_expensive: "Too expensive",
  too_complicated: "Too complicated to use",
  missing_feature: "Missing a feature they need",
  booking_didnt_work: "Booking flow did not work",
  payments_didnt_work: "Payments did not work",
  just_testing: "Just testing — never planned to use",
  pausing_slow_season: "Pausing for slow season",
  other: "Other (see feedback)",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPeriodEnd(iso: string | null | undefined): string {
  if (!iso) return "the end of your current billing month";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "the end of your current billing month";
  }
}

interface Body {
  user_id?: string;
  user_email?: string;
  user_name?: string | null;
  user_phone?: string | null;
  reason?: string;
  feedback_text?: string | null;
  kept_text?: string | null;
  competitor_name?: string | null;
  missing_feature?: string | null;
  period_end_date?: string | null;
  plan?: string | null;
  organization_id?: string | null;
  organization_name?: string | null;
  triggered_by?: "self" | "admin";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const email = (body.user_email ?? "").trim().toLowerCase();
    if (!email) {
      return new Response(
        JSON.stringify({ error: "user_email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Look up phone if caller didn't supply it
    let userPhone = body.user_phone?.trim() || null;
    let userName = body.user_name?.trim() || null;
    if ((!userPhone || !userName) && body.user_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("phone, full_name")
        .eq("id", body.user_id)
        .maybeSingle();
      if (!userPhone && profile?.phone) userPhone = profile.phone;
      if (!userName && profile?.full_name) userName = profile.full_name;
    }
    const firstName = (userName?.split(" ")[0] ?? "there").trim() || "there";

    const periodEndDisplay = formatPeriodEnd(body.period_end_date);
    const reasonLabel =
      body.reason && REASON_LABELS[body.reason]
        ? REASON_LABELS[body.reason]
        : body.reason || "—";

    // ── 1. Customer email ─────────────────────────────────────────────────
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromName = "TidyWise";
    const fromEmail = PLATFORM_SENDER_EMAIL;
    const from = `${fromName} <${fromEmail}>`;

    if (resendKey) {
      const appUrl = Deno.env.get("APP_URL") || "https://jointidywise.com";
      try {
        const customerMail = renderCrmEmail("cancellation-confirmed", {
          vars: {
            userName: firstName,
            email,
            plan: `${body.plan || "TidyWise"} · access until ${periodEndDisplay}`,
            APP_URL: appUrl,
          },
        });

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [email],
            reply_to: ADMIN_EMAIL,
            subject: "Your TidyWise cancellation is confirmed",
            html: customerMail.html,
            text: customerMail.text,
          }),
        });
        console.log("[notify-tidywise-cancellation] Customer email sent to", email);
      } catch (err) {
        console.error("[notify-tidywise-cancellation] Customer email failed:", err);
      }

      // ── 3. Admin alert email ─────────────────────────────────────────────
      try {
        const detailLines = [
          userPhone ? `Phone: ${escapeHtml(userPhone)}` : "",
          `Organization: ${escapeHtml(body.organization_name || "—")}`,
          `Reason: ${escapeHtml(reasonLabel)}`,
          `Access until: ${escapeHtml(periodEndDisplay)}`,
          `Cancelled by: ${escapeHtml(body.triggered_by === "admin" ? "Platform admin" : "User (self-serve)")}`,
          body.feedback_text ? `Feedback: ${escapeHtml(body.feedback_text)}` : "",
          body.kept_text ? `Would have kept them: ${escapeHtml(body.kept_text)}` : "",
          body.competitor_name ? `Switching to: ${escapeHtml(body.competitor_name)}` : "",
          body.missing_feature ? `Missing feature: ${escapeHtml(body.missing_feature)}` : "",
        ].filter(Boolean);
        const details = `<p style="margin:0;padding:0 0 16px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;color:#1b1b1b;">${detailLines.join("<br>")}</p>`;
        const adminMail = renderCrmEmail("internal-cancellation", {
          vars: {
            userName: userName || email,
            email,
            plan: body.plan || "—",
            details,
            APP_URL: appUrl,
          },
          rawKeys: ["details"],
        });

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [ADMIN_EMAIL],
            reply_to: email,
            subject: `📉 Cancellation: ${userName || email}`,
            html: adminMail.html,
            text: adminMail.text,
          }),
        });
        console.log("[notify-tidywise-cancellation] Admin email sent");
      } catch (err) {
        console.error("[notify-tidywise-cancellation] Admin email failed:", err);
      }
    } else {
      console.warn("[notify-tidywise-cancellation] RESEND_API_KEY not set — skipping emails");
    }

    // SMS removed — cost-control decision: TidyWise-paid OpenPhone
    // SMS adds up fast at scale, and the cancellation email above already
    // covers the same information. Both customer-facing SMS and admin
    // alert SMS dropped together to keep the policy simple.

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[notify-tidywise-cancellation] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

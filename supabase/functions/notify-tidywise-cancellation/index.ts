import { sendResendEmail } from "../_shared/send-resend.ts";
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
import { tidywiseEmailFooterHtml, tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { PLATFORM_SENDER_EMAIL } from "../_shared/email-sender-resolution.ts";

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
      try {
        const customerHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1a1a1a; margin: 0 0 12px;">We're sorry to see you go, ${escapeHtml(firstName)}.</h2>
            <p style="color: #333; line-height: 1.6;">
              We received your cancellation. Your TidyWise account stays fully active until
              <strong>${escapeHtml(periodEndDisplay)}</strong> — keep using everything until then.
            </p>
            <p style="color: #333; line-height: 1.6;">
              After that date, your account drops to read-only. Your data (customers, bookings,
              invoices, staff) stays safe and untouched. If you change your mind later, you can
              resubscribe with one click and pick up where you left off.
            </p>
            <p style="color: #333; line-height: 1.6;">
              If something specific pushed you to cancel, reply to this email — Emmanuel
              reads every one personally.
            </p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
            <p style="color: #555; line-height: 1.6;">
              — The TidyWise team<br/>
              <a href="mailto:${ADMIN_EMAIL}" style="color: #2563eb;">${ADMIN_EMAIL}</a>
            </p>
            ${tidywiseEmailFooterHtml()}
          </div>`;

        await sendResendEmail( {
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
            html: customerHtml,
          }),
        });
        console.log("[notify-tidywise-cancellation] Customer email sent to", email);
      } catch (err) {
        console.error("[notify-tidywise-cancellation] Customer email failed:", err);
      }

      // ── 3. Admin alert email ─────────────────────────────────────────────
      try {
        const adminHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1a1a1a; margin: 0 0 12px;">📉 TidyWise cancellation</h2>
            <table style="border-collapse: collapse; width: 100%;">
              <tr><td style="padding: 6px 0;"><strong>Customer:</strong></td><td>${escapeHtml(userName || "—")}</td></tr>
              <tr><td style="padding: 6px 0;"><strong>Email:</strong></td><td><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
              <tr><td style="padding: 6px 0;"><strong>Phone:</strong></td><td>${escapeHtml(userPhone || "—")}</td></tr>
              <tr><td style="padding: 6px 0;"><strong>Organization:</strong></td><td>${escapeHtml(body.organization_name || "—")}</td></tr>
              <tr><td style="padding: 6px 0;"><strong>Plan:</strong></td><td>${escapeHtml(body.plan || "—")}</td></tr>
              <tr><td style="padding: 6px 0;"><strong>Reason:</strong></td><td>${escapeHtml(reasonLabel)}</td></tr>
              <tr><td style="padding: 6px 0;"><strong>Access until:</strong></td><td>${escapeHtml(periodEndDisplay)}</td></tr>
              <tr><td style="padding: 6px 0;"><strong>Cancelled by:</strong></td><td>${escapeHtml(body.triggered_by === "admin" ? "Platform admin (you)" : "User (self-serve)")}</td></tr>
            </table>
            ${body.feedback_text ? `<h3 style="margin-top: 20px;">Feedback</h3><blockquote style="border-left: 3px solid #2563eb; padding: 8px 16px; background: #f5f5f5; white-space: pre-wrap;">${escapeHtml(body.feedback_text)}</blockquote>` : ""}
            ${body.kept_text ? `<h3 style="margin-top: 20px;">What would have kept them</h3><blockquote style="border-left: 3px solid #16a34a; padding: 8px 16px; background: #f0fdf4; white-space: pre-wrap;">${escapeHtml(body.kept_text)}</blockquote>` : ""}
            ${body.competitor_name ? `<p><strong>Switching to:</strong> ${escapeHtml(body.competitor_name)}</p>` : ""}
            ${body.missing_feature ? `<p><strong>Missing feature:</strong> ${escapeHtml(body.missing_feature)}</p>` : ""}
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
            <p style="font-size: 13px; color: #888;">Reply to this email to reach ${escapeHtml(userName || "the customer")} directly.</p>
          </div>`;

        await sendResendEmail( {
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
            html: adminHtml,
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

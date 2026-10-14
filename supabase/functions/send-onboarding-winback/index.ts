import { createStripeClient } from "../_shared/stripe-client.ts";
import { sendResendEmail } from "../_shared/send-resend.ts";
import { batchSendErrorPlan } from "../_shared/demo-org.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import { ensureOnboardingCoupon, type OnboardingCouponOffer } from "../_shared/onboarding-coupons.ts";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_URL = Deno.env.get("APP_URL") || "https://jointidywise.com";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/**
 * Same rules as src/lib/onboardingWinback.ts dueWinbackEmail.
 * A finished signup is skipped. After 7 days the offer is stale.
 * At 24 hours the free-month email replaces a missed 50% email.
 */
function dueWinbackEmail(opts: {
  startedAt: string;
  completedAt?: string | null;
  email1hSentAt?: string | null;
  email24hSentAt?: string | null;
  now: number;
}): "half_off_first_month" | "first_month_free" | null {
  if (opts.completedAt) return null;
  const started = Date.parse(opts.startedAt);
  if (!Number.isFinite(started)) return null;
  const age = opts.now - started;
  if (age < HOUR_MS || age > 7 * DAY_MS) return null;
  if (age >= DAY_MS && !opts.email24hSentAt) return "first_month_free";
  if (age < DAY_MS && !opts.email1hSentAt) return "half_off_first_month";
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const cronGate = requireCronSecret(req);
  if (cronGate) return cronGate;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const now = Date.now();
  const { data: rows, error } = await supabase
    .from("onboarding_winback")
    .select("id, user_id, organization_id, resume_token, started_at, email_1h_sent_at, email_24h_sent_at, completed_at")
    .is("completed_at", null)
    .gte("started_at", new Date(now - 7 * DAY_MS).toISOString());
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const orgIds = [...new Set((rows ?? []).map((row) => row.organization_id).filter(Boolean))] as string[];
  const finished = new Set<string>();
  for (let i = 0; i < orgIds.length; i += 100) {
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, needs_onboarding")
      .in("id", orgIds.slice(i, i + 100));
    for (const org of orgs ?? []) {
      if (org.needs_onboarding === false) finished.add(org.id);
    }
  }

  const userIds = [...new Set((rows ?? []).map((row) => row.user_id))];
  const emails = new Map<string, { email: string | null; unsubscribed: boolean }>();
  for (let i = 0; i < userIds.length; i += 100) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email, email_unsubscribed")
      .in("id", userIds.slice(i, i + 100));
    for (const profile of profiles ?? []) {
      emails.set(profile.id, {
        email: profile.email,
        unsubscribed: profile.email_unsubscribed === true,
      });
    }
  }

  let stripe: Stripe | null = null;
  const stripeKey = billingSecretKey();
  if (stripeKey) stripe = await createStripeClient(stripeKey, { apiVersion: "2025-08-27.basil" });

  let sent = 0;
  let skipped = 0;

  for (const row of rows ?? []) {
    if (row.organization_id && finished.has(row.organization_id)) {
      await supabase.from("onboarding_winback").update({
        completed_at: new Date().toISOString(),
      }).eq("id", row.id).is("completed_at", null);
      skipped++;
      continue;
    }
    const offer = dueWinbackEmail({
      startedAt: row.started_at,
      completedAt: row.completed_at,
      email1hSentAt: row.email_1h_sent_at,
      email24hSentAt: row.email_24h_sent_at,
      now,
    });
    if (!offer) {
      skipped++;
      continue;
    }

    const profile = emails.get(row.user_id);
    if (!profile?.email || profile.unsubscribed) {
      skipped++;
      continue;
    }

    const stamp = offer === "first_month_free"
      ? { email_24h_sent_at: new Date().toISOString(), email_1h_sent_at: row.email_1h_sent_at ?? new Date().toISOString() }
      : { email_1h_sent_at: new Date().toISOString() };
    const stampColumn = offer === "first_month_free" ? "email_24h_sent_at" : "email_1h_sent_at";
    const { data: claimed, error: claimError } = await supabase
      .from("onboarding_winback")
      .update(stamp)
      .eq("id", row.id)
      .is(stampColumn, null)
      .is("completed_at", null)
      .select("id");
    if (claimError || !claimed?.length) {
      skipped++;
      continue;
    }

    if (stripe) {
      try {
        await ensureOnboardingCoupon(stripe, offer as OnboardingCouponOffer);
      } catch (couponError) {
        console.error("[onboarding-winback] coupon create failed", couponError);
      }
    }

    const link = `${APP_URL}/onboarding?winback=${encodeURIComponent(row.resume_token)}&offer=${offer}`;
    const subject = offer === "first_month_free"
      ? "Your first month of TidyWise is free"
      : "50% off your first month of TidyWise";
    const headline = offer === "first_month_free"
      ? "Finish setup and your first month is free"
      : "Finish setup and your first month is half off";
    const detail = offer === "first_month_free"
      ? "You started setting up TidyWise yesterday. Come back and your first paid month is free. Your place in the setup is saved."
      : "You started setting up TidyWise about an hour ago. Finish now and the first month is 50% off. Your place in the setup is saved.";

    let emailed = false;
    if (RESEND_API_KEY) {
      try {
      const response = await sendResendEmail( {
        organizationId: row.organization_id,
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "TidyWise <billing@jointidywise.com>",
          to: [profile.email],
          subject,
          html: `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
            <h1 style="font-size:22px;margin:0 0 12px">${headline}</h1>
            <p style="color:#475569">${detail}</p>
            <p style="margin:24px 0"><a href="${link}" style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Continue setup</a></p>
            <p style="color:#94a3b8;font-size:12px">The discount is applied when you pick a plan. Nothing is charged for finishing setup.</p>
          </div>`,
        }),
      });
      emailed = response.ok;
      if (!response.ok) console.error("[onboarding-winback] resend error", response.status, await response.text());
      } catch (error) {
        const plan = batchSendErrorPlan(error);
        if (plan.demoSkip) {
          console.log("[onboarding-winback] skipped demo send", row.id);
        } else {
          console.error("[onboarding-winback] send failed", row.id, error);
        }
        emailed = false;
      }
    }

    if (!emailed) {
      await supabase.from("onboarding_winback").update({
        [stampColumn]: null,
      }).eq("id", row.id);
      skipped++;
      continue;
    }
    sent++;
  }

  return new Response(JSON.stringify({ sent, skipped, emailConfigured: Boolean(RESEND_API_KEY) }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

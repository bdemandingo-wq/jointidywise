import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import { tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_URL = Deno.env.get("APP_URL") || "https://jointidywise.com";
const SUPPORT_EMAIL = tidywiseSupportEmail();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/**
 * Daily cron: emails every TidyWise subscriber whose next renewal is in
 * ~3 days. Recognizable, branded reminders are the single best way to
 * prevent "I didn't recognize this charge" disputes.
 *
 * Auth: pg_cron job sends x-cron-secret; the function is listed in
 * config.toml with verify_jwt = false so no JWT is required. Without
 * that pair the cron used to 401 on every run — reminders were never
 * actually being sent.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const cronGate = requireCronSecret(req);
  if (cronGate) return cronGate;

  const stripeKey = billingSecretKey();
  if (!stripeKey || !RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "Missing required secrets" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const nowSec = Math.floor(Date.now() / 1000);
  const minSec = nowSec + 2 * 24 * 60 * 60; // 2 days
  const maxSec = nowSec + 4 * 24 * 60 * 60; // 4 days
  let sent = 0, skipped = 0;

  // Page through active subscriptions
  for await (const sub of stripe.subscriptions.list({ status: "active", limit: 100 }) as any) {
    // Stripe Basil moved current_period_end onto items.data[i]. The
    // top-level field still works for single-item subs but goes null
    // the moment a second item is added — fall back to it for
    // resilience while preferring the canonical item-level value.
    const subAny = sub as Stripe.Subscription;
    const renewAt =
      subAny.items.data[0]?.current_period_end ?? (subAny as any).current_period_end;
    if (!renewAt || renewAt < minSec || renewAt > maxSec) { skipped++; continue; }
    if (subAny.cancel_at_period_end) { skipped++; continue; }

    try {
      const cust = await stripe.customers.retrieve(sub.customer as string);
      const email = (cust as Stripe.Customer).email;
      if (!email) { skipped++; continue; }

      // Idempotency: skip if we've already logged a reminder for this
      // (sub, period_end) tuple. Lives in its own table so the dispute
      // pipeline's payment_evidence dataset stays clean.
      const { data: exists, error: existsErr } = await supabase
        .from("subscription_reminder_log")
        .select("id")
        .eq("stripe_subscription_id", sub.id)
        .eq("period_end_sec", renewAt)
        .maybeSingle();
      if (existsErr) {
        // Fail closed: an unreadable dedupe check must not be treated as
        // "never reminded" — that's how this sub would get a duplicate email.
        console.error("[renewal-reminder] dedupe check failed, skipping to avoid a possible duplicate send", sub.id, existsErr);
        skipped++;
        continue;
      }
      if (exists) { skipped++; continue; }

      const price = sub.items.data[0]?.price;
      const amount = price
        ? (price.unit_amount! / 100).toLocaleString("en-US", {
            style: "currency", currency: price.currency.toUpperCase(),
          })
        : "your subscription amount";
      const renewDate = new Date(renewAt * 1000).toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
      });

      const html = `
<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
  <h1 style="font-size:22px;margin:0 0 12px">Your TidyWise plan renews ${renewDate}</h1>
  <p style="color:#475569">Just a heads-up that your TidyWise subscription (${amount}) will renew on <strong>${renewDate}</strong> using the card on file. Charges appear as "TIDYWISE" on your statement.</p>
  <p style="margin:24px 0">
    <a href="${APP_URL}/dashboard/subscription" style="background:#0ea5e9;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Manage subscription</a>
  </p>
  <p style="color:#475569;font-size:13px">Need to cancel or change plans? You can do it in one click from your dashboard, or reply to this email and we'll take care of it.</p>
  <p style="color:#94a3b8;font-size:12px;margin-top:16px">Questions? ${SUPPORT_EMAIL}</p>
</div>`;

      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "TidyWise <billing@jointidywise.com>",
          reply_to: SUPPORT_EMAIL,
          to: [email],
          subject: `Heads up: your TidyWise plan renews ${renewDate}`,
          html,
        }),
      });

      if (r.ok) {
        sent++;
        // Log reminder so we don't double-send this cycle. Unique index
        // on (stripe_subscription_id, period_end_sec) is the hard guard
        // — the .maybeSingle() check above is a fast path.
        const { error: logErr } = await supabase.from("subscription_reminder_log").insert({
          email,
          stripe_customer_id: sub.customer as string,
          stripe_subscription_id: sub.id,
          period_end_sec: renewAt,
        });
        if (logErr) {
          console.error(
            "[renewal-reminder] email sent but reminder-log insert failed — dedupe will not catch this next run",
            sub.id, logErr,
          );
        }
      } else {
        console.error("[renewal-reminder] resend error", r.status, await r.text());
      }
    } catch (e) {
      console.error("[renewal-reminder] sub error", sub.id, e);
    }
  }

  return new Response(JSON.stringify({ sent, skipped }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
});

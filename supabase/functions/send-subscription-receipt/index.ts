// SECURITY (2026-07-14): previously had zero caller check — anyone could
// send an officially-branded "TidyWise receipt" email to any address with
// any dollar amount/invoice text (phishing vector), and hosted_invoice_url
// was interpolated unescaped into an <a href> (HTML injection). Its only
// legitimate callers are stripe-invoice-webhook and
// resend-subscription-receipt, both server-to-server — confirmed via a
// src/ + supabase/functions/ call-site trace (zero frontend callers), so
// this is now locked to service-role-only rather than JWT+org (there's no
// frontend flow to preserve here).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { isServiceRoleRequest } from "../_shared/require-caller-org.ts";
import { tidywiseSupportEmail } from "../_shared/email-footer.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_URL = Deno.env.get("APP_URL") || "https://jointidywise.com";
const SUPPORT_EMAIL = tidywiseSupportEmail();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReceiptReq {
  email: string;
  amount_cents: number;
  currency: string;
  invoice_id: string;
  hosted_invoice_url?: string | null;
  period_end?: number | null;
  // Tier metadata passed through from the invoice/subscription so the
  // receipt clearly states what the customer just bought — particularly
  // important for yearly plans where "next billing date" is a year out.
  plan?: string | null;
  interval?: string | null;
}

const PLAN_LABELS: Record<string, string> = {
  basic: "Basic",
  pro: "Pro",
  custom: "Custom",
  lifetime: "Lifetime",
};

function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&#039;",
  }[c] as string));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!isServiceRoleRequest(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const {
      email, amount_cents, currency, invoice_id, hosted_invoice_url, period_end,
      plan, interval,
    } = (await req.json()) as ReceiptReq;
    if (!email) throw new Error("email required");

    const amount = (amount_cents / 100).toLocaleString("en-US", {
      style: "currency", currency: (currency || "USD").toUpperCase(),
    });
    const nextDate = period_end
      ? new Date(period_end * 1000).toLocaleDateString("en-US", {
          year: "numeric", month: "long", day: "numeric",
        })
      : null;

    const planLabel = plan && PLAN_LABELS[plan] ? PLAN_LABELS[plan] : null;
    const intervalLabel = interval === "yearly"
      ? "Yearly"
      : interval === "monthly"
        ? "Monthly"
        : null;
    const planLine = planLabel
      ? `TidyWise ${planLabel}${intervalLabel ? ` · ${intervalLabel}` : ""}`
      : null;
    const subjectPlan = planLine ? ` (${planLine})` : "";

    const html = `
<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
  <h1 style="font-size:22px;margin:0 0 12px">TidyWise receipt</h1>
  <p style="color:#475569;margin:0 0 24px">Thanks — your TidyWise subscription payment was successful.</p>
  <div style="border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:24px">
    ${planLine ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span>Plan</span><strong>${escapeHtml(planLine)}</strong></div>` : ""}
    <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span>Amount paid</span><strong>${amount}</strong></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span>Invoice</span><span>${escapeHtml(String(invoice_id))}</span></div>
    ${nextDate ? `<div style="display:flex;justify-content:space-between"><span>Next billing date</span><span>${nextDate}</span></div>` : ""}
  </div>
  ${hosted_invoice_url && /^https:\/\//.test(hosted_invoice_url) ? `<p><a href="${escapeHtml(hosted_invoice_url)}" style="color:#0ea5e9">View full invoice</a></p>` : ""}
  <p style="color:#475569;font-size:13px;margin-top:24px">
    Manage your subscription anytime at
    <a href="${APP_URL}/dashboard/subscription">${APP_URL}/dashboard/subscription</a>.
  </p>
  <p style="color:#94a3b8;font-size:12px;margin-top:16px">
    Questions? Reply to this email or write to ${SUPPORT_EMAIL}. Charges appear as "TIDYWISE" on your statement.
  </p>
</div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "TidyWise <billing@jointidywise.com>",
        to: [email],
        subject: `TidyWise receipt — ${amount} paid${subjectPlan}`,
        html,
      }),
    });
    const body = await res.text();
    if (!res.ok) console.error("[send-subscription-receipt] Resend error", res.status, body);

    return new Response(JSON.stringify({ ok: res.ok }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

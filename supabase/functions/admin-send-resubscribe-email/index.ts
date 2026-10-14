// Platform-admin-only: generates a Stripe payment link for the TidyWise Pro
// $50/mo plan and emails it to the given customer so they can re-subscribe
// themselves (preserves consent / avoids chargebacks vs. force-charging a
// stored card).
//
// The email leads with what the owner built on TidyWise — real booking /
// customer / revenue numbers pulled from their org — because "your data is
// still here" is a stronger reason to return than the price. Falls back to a
// clean, stat-free version when the org can't be resolved or the numbers are
// too low to be motivating (never sends "your 0 bookings").
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { tidywiseSupportEmail, tidywiseSupportFrom } from "../_shared/email-footer.ts";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PRO_MONTHLY_PRICE_ID = "price_1SihrVJv857o86noT8NIIfrq";

// Below this many lifetime bookings we skip the stats block entirely — a
// handful of bookings isn't a compelling "look what you built" story.
const MIN_BOOKINGS_FOR_STATS = 5;

const log = (step: string, details?: unknown) => {
  const d = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[ADMIN-SEND-RESUB] ${step}${d}`);
};

interface OrgStats {
  bookings: number;
  customers: number;
  revenue: number;
  membershipLabel: string;
}
interface EmailContext {
  firstName: string | null;
  stats: OrgStats | null;
}

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");

function membershipLabel(createdAt: string): string {
  const months = Math.max(
    1,
    Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30.44)),
  );
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (!rem) return `${years} year${years === 1 ? "" : "s"}`;
  return `${years} yr${years === 1 ? "" : "s"} ${rem} mo`;
}

// ── Email building ──────────────────────────────────────────────────────────
// Table-based, fully inline styles, system font stack only. No <style> block,
// no web fonts, no external assets — renders in Gmail and Apple Mail.

function ctaButton(checkoutUrl: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;">
      <tr>
        <td align="center" bgcolor="#2563eb" style="border-radius:10px;">
          <a href="${checkoutUrl}" style="display:inline-block;padding:16px 40px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">Reactivate TidyWise Pro</a>
        </td>
      </tr>
    </table>`;
}

function statCards(stats: OrgStats): string {
  const cards: { value: string; label: string }[] = [
    { value: fmtInt(stats.bookings), label: "Jobs booked" },
  ];
  if (stats.customers > 0) cards.push({ value: fmtInt(stats.customers), label: "Customers" });
  if (stats.revenue > 0) cards.push({ value: `$${fmtInt(stats.revenue)}`, label: "Processed" });

  const w = Math.floor(100 / cards.length);
  const cells = cards
    .map((c, i) => {
      const padLeft = i === 0 ? 0 : 5;
      const padRight = i === cards.length - 1 ? 0 : 5;
      return `
        <td width="${w}%" valign="top" style="padding:0 ${padRight}px 0 ${padLeft}px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e6e9ef;border-radius:12px;">
            <tr>
              <td align="center" style="padding:20px 8px;">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:27px;line-height:1.1;font-weight:800;color:#2563eb;">${c.value}</div>
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:#64748b;margin-top:7px;">${c.label}</div>
              </td>
            </tr>
          </table>
        </td>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>`;
}

// Pro-plan capabilities (sourced from ChoosePlanPage's 'pro' tier), framed as
// what's switched off right now. Emoji are used as email-safe "icons" — no
// external images, renders in Gmail and Apple Mail.
const PRO_LOCKED_FEATURES: { icon: string; label: string }[] = [
  { icon: "⚡", label: "Automations — reviews, reminders, win-back" },
  { icon: "🤖", label: "AI Intelligence + Copilot" },
  { icon: "📍", label: "GPS tracking" },
  { icon: "📊", label: "Advanced reports" },
  { icon: "💵", label: "Payroll" },
  { icon: "📦", label: "Inventory" },
  { icon: "🔑", label: "Client portal" },
];

// "What's new since you left." No changelog source exists in the repo, so this
// is authored copy — leave empty to hide the section entirely. Each item below
// maps to a shipped, verified feature (component + edge function present).
const WHATS_NEW: { title: string; desc: string }[] = [
  { title: "Tidy AI Co-pilot", desc: "an in-app assistant that knows your business and answers questions, drafts messages, and helps you move faster." },
  { title: "AI text auto-reply", desc: "incoming customer texts get answered automatically, so leads don't sit waiting." },
  { title: "GPS arrival tracking", desc: "see cleaners en route and on-site, and share live arrival tracking with customers." },
  { title: "Automation Center", desc: "hands-off reminders, review requests, rebooking nudges, and win-back offers running in the background." },
];

// Dark panel listing the Pro toolkit as switched off — the emotional weight of
// the email. Dimmed rows on a dark card read as "the lights are off."
function lockedFeaturesPanel(): string {
  const rows = PRO_LOCKED_FEATURES.map((f, i) => `
    <tr>
      <td style="padding:13px 0;${i ? "border-top:1px solid #1e293b;" : ""}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="28" valign="middle" style="font-size:17px;line-height:1;">${f.icon}</td>
          <td valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#cbd5e1;">${f.label}</td>
          <td align="right" valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.8px;color:#f59e0b;">OFF</td>
        </tr></table>
      </td>
    </tr>`).join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:14px;margin:0 0 30px;">
      <tr><td style="padding:24px 22px 4px;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:800;color:#ffffff;">Your Pro toolkit is switched off</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#94a3b8;margin-top:6px;">Reactivating turns all of it back on — nothing was deleted.</div>
      </td></tr>
      <tr><td style="padding:8px 22px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      </td></tr>
    </table>`;
}

// "New since you left" — renders only when WHATS_NEW has items.
function whatsNewSection(): string {
  if (WHATS_NEW.length === 0) return "";
  const items = WHATS_NEW.map((n) => `
    <tr><td style="padding:0 0 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="52" valign="top">
          <span style="display:inline-block;background:#dcfce7;color:#15803d;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.6px;padding:4px 9px;border-radius:20px;">NEW</span>
        </td>
        <td valign="top" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#475569;">
          <strong style="color:#0f172a;">${n.title}</strong> — ${n.desc}
        </td>
      </tr></table>
    </td></tr>`).join("");
  return `
    <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;font-weight:700;">New since you left</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 30px;">${items}</table>`;
}

function innerBody(checkoutUrl: string, ctx: EmailContext): string {
  const p = (text: string) =>
    `<p style="margin:0 0 26px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#475569;">${text}</p>`;
  const eyebrow =
    `<p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#2563eb;font-weight:700;">Welcome back</p>`;

  // Shared tail: locked Pro toolkit, what's-new (if any), value line, CTA, link.
  const tail = `
    ${lockedFeaturesPanel()}
    ${whatsNewSection()}
    ${p("Reactivate your Pro plan and pick up right where you stopped — your customers, bookings, and invoices are waiting.")}

    ${ctaButton(checkoutUrl)}
    <p style="margin:14px 0 0;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#94a3b8;">$50/month · cancel anytime</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:30px 0 0;"><tr><td style="border-top:1px solid #eef1f5;font-size:0;line-height:0;">&nbsp;</td></tr></table>
    <p style="margin:20px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#94a3b8;word-break:break-all;">Button not working? Paste this link into your browser:<br/><a href="${checkoutUrl}" style="color:#2563eb;">${checkoutUrl}</a></p>`;

  if (ctx.stats) {
    const s = ctx.stats;
    const heading = ctx.firstName
      ? `Hi ${ctx.firstName}, your business is still here.`
      : `Your business is still here.`;
    return `
      ${eyebrow}
      <h1 style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:27px;line-height:1.25;color:#0f172a;font-weight:800;">${heading}</h1>
      ${p("Before you go for good, here's what you built on TidyWise. None of it has gone anywhere.")}

      <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;font-weight:700;">What you built</p>
      ${statCards(s)}

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 30px;">
        <tr>
          <td align="center" bgcolor="#0f172a" style="border-radius:10px;padding:13px 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#e2e8f0;">
            A TidyWise member for <strong style="color:#ffffff;">${s.membershipLabel}</strong>
          </td>
        </tr>
      </table>
      ${tail}`;
  }

  // Clean, stat-free fallback (org unresolved or < 5 bookings).
  const heading = ctx.firstName ? `${ctx.firstName}, come back to TidyWise` : `Come back to TidyWise`;
  return `
    ${eyebrow}
    <h1 style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:27px;line-height:1.25;color:#0f172a;font-weight:800;">${heading}</h1>
    ${p("Your account access ended when your Pro subscription was canceled — but everything you set up is still here, exactly where you left it.")}
    ${tail}`;
}

function buildEmailHtml(checkoutUrl: string, ctx: EmailContext): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">
          <tr>
            <td style="padding:8px 8px 20px;font-family:Arial,Helvetica,sans-serif;">
              <span style="font-size:20px;font-weight:800;letter-spacing:-0.4px;color:#0f172a;">Tidy<span style="color:#2563eb;">Wise</span></span>
              <span style="font-size:12px;color:#94a3b8;margin-left:8px;">Cleaning Business Management</span>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border-radius:16px;border:1px solid #e6e9ef;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="height:4px;background:#2563eb;border-radius:16px 16px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr><td style="padding:38px 36px 40px;">${innerBody(checkoutUrl, ctx)}</td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 20px 8px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#94a3b8;line-height:1.5;">
              Sent by the TidyWise team · Reply to this email with any questions.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Org lookup ──────────────────────────────────────────────────────────────
// Resolves the customer email to their org and pulls real numbers. Any failure
// returns a context with stats:null so the send never blocks on a bad lookup.
async function buildContext(admin: any, email: string): Promise<EmailContext> {
  try {
    const { data: profileRow } = await admin
      .from("profiles")
      .select("id, full_name")
      .ilike("email", email)
      .maybeSingle();
    const profile = profileRow as { id?: string; full_name?: string | null } | null;

    const firstName = (profile?.full_name || "").trim().split(/\s+/)[0] || null;
    if (!profile?.id) return { firstName: null, stats: null };

    const { data: membership } = await admin
      .from("org_memberships")
      .select("organization_id, organizations(created_at)")
      .eq("user_id", profile.id)
      .in("role", ["owner", "admin"])
      .limit(1)
      .maybeSingle();

    const orgId = (membership as any)?.organization_id as string | undefined;
    const orgCreatedAt = (membership as any)?.organizations?.created_at as string | undefined;
    if (!orgId) return { firstName, stats: null };

    const { count: bookings } = await admin
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .neq("status", "cancelled");

    if (!bookings || bookings < MIN_BOOKINGS_FOR_STATS) {
      return { firstName, stats: null };
    }

    const { count: customers } = await admin
      .from("customers")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId);

    // Revenue = sum of total_amount for confirmed/completed bookings — the
    // same definition the owner sees in their own dashboard (ai-analysis-center).
    const { data: revRows } = await admin
      .from("bookings")
      .select("total_amount")
      .eq("organization_id", orgId)
      .in("status", ["confirmed", "completed"]);
    const revenue = (revRows || []).reduce(
      (sum: number, r: any) => sum + (Number(r.total_amount) || 0),
      0,
    );

    return {
      firstName,
      stats: {
        bookings,
        customers: customers || 0,
        revenue,
        membershipLabel: orgCreatedAt ? membershipLabel(orgCreatedAt) : "a while",
      },
    };
  } catch (e) {
    log("Context lookup failed (sending clean version)", { msg: e instanceof Error ? e.message : String(e) });
    return { firstName: null, stats: null };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = billingSecretKey();
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!stripeKey) throw new Error("STRIPE_BILLING_SECRET_KEY is not set");
    if (!resendKey) throw new Error("RESEND_API_KEY is not set");

    // --- Auth: platform admin only ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: udata } = await userClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (!udata?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: isAdmin, error: adminErr } = await userClient.rpc("is_platform_admin");
    if (adminErr || !isAdmin) {
      return new Response(JSON.stringify({ error: "Platform admin access only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Body ---
    const body = await req.json().catch(() => ({}));
    const customerEmail = (body?.customerEmail ?? "").toString().trim().toLowerCase();
    if (!customerEmail || !customerEmail.includes("@")) {
      return new Response(JSON.stringify({ error: "Valid customerEmail required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    log("Request", { by: udata.user.email, customerEmail });

    // --- Service-role client for the cross-tenant org lookup (admin-gated above) ---
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const ctx = await buildContext(admin, customerEmail);
    log("Context", { firstName: ctx.firstName, hasStats: !!ctx.stats });

    // --- Create Stripe payment link (unchanged) ---
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: PRO_MONTHLY_PRICE_ID, quantity: 1 }],
      metadata: {
        purpose: "admin_resubscribe",
        target_email: customerEmail,
        sent_by_admin: udata.user.email ?? "",
      },
    });
    const url = paymentLink.url;
    log("Payment link created", { id: paymentLink.id, url });

    // --- Send email via Resend (platform-level, not org-scoped) ---
    const html = buildEmailHtml(url, ctx);
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: tidywiseSupportFrom(),
        to: [customerEmail],
        reply_to: tidywiseSupportEmail(),
        subject: "Reactivate your TidyWise subscription",
        html,
      }),
    });
    const resendData = await resendRes.json().catch(() => ({}));
    if (!resendRes.ok) {
      log("Resend error", resendData);
      return new Response(
        JSON.stringify({
          error: resendData?.message || "Failed to send email",
          paymentLinkUrl: url,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    log("Email sent", { to: customerEmail, resendId: resendData?.id });

    return new Response(
      JSON.stringify({
        success: true,
        url,
        emailId: resendData?.id ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("ERROR", { msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

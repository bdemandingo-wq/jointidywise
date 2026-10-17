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
import { renderCrmEmail } from "../_shared/crm-email/render.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

function renderResubscribe(checkoutUrl: string, ctx: EmailContext) {
  const stats = ctx.stats;
  return renderCrmEmail("admin-resubscribe", {
    vars: {
      firstName: ctx.firstName || "there",
      bookings: stats ? fmtInt(stats.bookings) : "—",
      customers: stats ? fmtInt(stats.customers) : "—",
      revenue: stats && stats.revenue > 0 ? `$${fmtInt(stats.revenue)}` : "—",
      membershipLabel: stats?.membershipLabel || "—",
      checkoutUrl,
      UNSUBSCRIBE_URL: `mailto:${tidywiseSupportEmail()}?subject=${encodeURIComponent("Unsubscribe")}`,
    },
  });
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

    // Price must be on the billing account. The old hard-coded price id
    // belongs to the previous Stripe account and is rejected there.
    const proMonthlyPriceId = (Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID") || "").trim();
    if (!proMonthlyPriceId) {
      return new Response(
        JSON.stringify({
          error: "Resubscribe checkout is not configured. STRIPE_PRO_MONTHLY_PRICE_ID is missing. No email was sent.",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: proMonthlyPriceId, quantity: 1 }],
      metadata: {
        purpose: "admin_resubscribe",
        target_email: customerEmail,
        sent_by_admin: udata.user.email ?? "",
      },
    });
    const url = paymentLink.url;
    log("Payment link created", { id: paymentLink.id, url });

    // --- Send email via Resend (platform-level, not org-scoped) ---
    const resubscribe = renderResubscribe(url, ctx);
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
        html: resubscribe.html,
        text: resubscribe.text,
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

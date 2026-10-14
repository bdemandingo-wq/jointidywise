// Submit a done-for-you request from a Custom-plan customer.
//
// Enforces the 1-request-per-billing-period cap by checking
// custom_work_requests for any existing row within the user's current
// Stripe billing period whose status isn't declined/cancelled. The
// table's RLS would let the user INSERT directly, but we want the
// cap + tier check enforced server-side so the client can't bypass
// it by dropping the count UI.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_TYPES = new Set([
  "website_build",
  "sms_setup",
  "email_marketing_setup",
  "customer_import",
  "scripts_documents_pack",
  "something_else",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );
    const { data: udata } = await userClient.auth.getUser(token);
    const user = udata?.user;
    if (!user?.email) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const requestType: string | undefined = body?.request_type;
    const details: string | undefined = body?.details?.toString().slice(0, 2000);
    if (!requestType || !ALLOWED_TYPES.has(requestType)) {
      return new Response(
        JSON.stringify({ error: "Invalid request_type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (requestType === "something_else" && !details?.trim()) {
      return new Response(
        JSON.stringify({
          error: "Tell us what you need — details are required for 'something else' requests.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Find org + verify Custom plan (or grandfathered)
    const { data: membership } = await admin
      .from("org_memberships")
      .select("organization_id, organizations(plan_type, grandfathered_lifetime)")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    const orgId = membership?.organization_id;
    const org = (membership as any)?.organizations;
    if (!orgId) {
      return new Response(JSON.stringify({ error: "No organization found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Done-for-you work requires an actual paid Custom subscription.
    // grandfathered_lifetime used to pass here, which let lifetime and
    // pre-launch orgs submit requests the pricing spec never granted them.
    // Must stay in step with canAccess in src/lib/features.ts.
    if (org?.plan_type !== "custom") {
      return new Response(
        JSON.stringify({
          error:
            "Done-for-you requests are a Custom-plan benefit. Upgrade to Custom to submit a request.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve current billing period from Stripe — if the user has a
    // subscription, use its current_period_start..end. Otherwise
    // (grandfathered with no Stripe sub) fall back to the calendar
    // month. The period boundary is what dedupes the 1/month cap.
    const stripeKey = billingSecretKey() ?? "";
    let periodStart: Date;
    let periodEnd: Date;
    if (stripeKey) {
      try {
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
        const customers = await stripe.customers.list({ email: user.email, limit: 1 });
        if (customers.data.length > 0) {
          const subs = await stripe.subscriptions.list({
            customer: customers.data[0].id,
            status: "active",
            limit: 1,
          });
          const sub = subs.data[0];
          const periodStartSec =
            sub?.items.data[0]?.current_period_start ??
            (sub as any)?.current_period_start;
          const periodEndSec =
            sub?.items.data[0]?.current_period_end ??
            (sub as any)?.current_period_end;
          if (periodStartSec && periodEndSec) {
            periodStart = new Date(periodStartSec * 1000);
            periodEnd = new Date(periodEndSec * 1000);
          } else {
            // Fall through to calendar month
            const now = new Date();
            periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
            periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          }
        } else {
          const now = new Date();
          periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
          periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        }
      } catch {
        const now = new Date();
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      }
    } else {
      const now = new Date();
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }

    // 1-per-period cap: any non-cancelled, non-declined request in the
    // current period counts.
    const { data: existing } = await admin
      .from("custom_work_requests")
      .select("id, status")
      .eq("organization_id", orgId)
      .gte("billing_period_start", periodStart.toISOString())
      .lt("billing_period_start", periodEnd.toISOString())
      .not("status", "in", '("declined","cancelled")')
      .limit(1)
      .maybeSingle();
    if (existing) {
      return new Response(
        JSON.stringify({
          error:
            "You've already used your request for this billing period. Your next request unlocks at the start of your next billing month.",
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: created, error: insertErr } = await admin
      .from("custom_work_requests")
      .insert({
        organization_id: orgId,
        user_id: user.id,
        request_type: requestType,
        details: details || null,
        billing_period_start: periodStart.toISOString(),
        billing_period_end: periodEnd.toISOString(),
        status: "submitted",
      })
      .select("id, status, request_type, submitted_at")
      .single();
    if (insertErr) throw insertErr;

    return new Response(
      JSON.stringify({ ok: true, request: created }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[submit-custom-work-request] error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

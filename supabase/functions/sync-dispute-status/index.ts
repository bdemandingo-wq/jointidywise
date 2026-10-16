import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { BILLING_KEY_MISSING, billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Terminal Stripe dispute statuses — no need to re-sync.
const TERMINAL = new Set([
  "won",
  "lost",
  "charge_refunded",
  "warning_closed",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Disputes are TidyWise subscription chargebacks on the billing account.
    // STRIPE_SECRET_KEY is the Connect platform key once that account is named.
    const stripeKey = billingSecretKey();
    if (!stripeKey) throw new Error(BILLING_KEY_MISSING);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: udata } = await userClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (!udata.user) throw new Error("Not authenticated");

    const { data: isAdmin, error: adminErr } = await userClient.rpc("is_platform_admin");
    if (adminErr || !isAdmin) {
      return new Response(
        JSON.stringify({ error: "Forbidden: platform admin only" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Optional: sync a specific dispute id via body
    let targetId: string | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        targetId = body?.stripe_dispute_id ?? null;
      } catch { /* ignore */ }
    }

    let query = supabase
      .from("disputes")
      .select("id, stripe_dispute_id, status");
    if (targetId) {
      query = query.eq("stripe_dispute_id", targetId);
    }
    const { data: rows, error: fetchErr } = await query;
    if (fetchErr) throw fetchErr;

    const pending = (rows ?? []).filter((r) =>
      !!r.stripe_dispute_id && (targetId ? true : !TERMINAL.has(String(r.status ?? "")))
    );

    const results: Array<Record<string, unknown>> = [];
    let updated = 0;
    let failed = 0;

    for (const row of pending) {
      try {
        const d = await stripe.disputes.retrieve(row.stripe_dispute_id);
        const patch = {
          status: d.status,
          reason: d.reason,
          amount_cents: d.amount,
          currency: d.currency,
          outcome: TERMINAL.has(d.status) ? d.status : null,
          updated_at: new Date().toISOString(),
        };
        const { error: upErr } = await supabase
          .from("disputes")
          .update(patch)
          .eq("id", row.id);
        if (upErr) throw upErr;
        updated++;
        results.push({ stripe_dispute_id: row.stripe_dispute_id, status: d.status });
      } catch (e) {
        failed++;
        results.push({
          stripe_dispute_id: row.stripe_dispute_id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return new Response(
      JSON.stringify({
        checked: pending.length,
        updated,
        failed,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

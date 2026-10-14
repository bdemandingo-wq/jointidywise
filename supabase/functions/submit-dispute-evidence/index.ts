import { createStripeClient } from "../_shared/stripe-client.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Submits the platform-admin-approved drafted_evidence for a stored dispute
 * to Stripe. Caller must be a platform admin.
 *
 * Body: { dispute_id: <UUID of public.disputes row>, submit?: boolean }
 * If submit=false, evidence is staged on the dispute (not finalized to the bank).
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const token = authHeader.replace("Bearer ", "");

    // User-scoped client: attach the Bearer token globally so RPC calls
    // see auth.uid() and is_platform_admin() can evaluate correctly.
    // The service-role admin client below has auth.uid() = NULL, so
    // calling is_platform_admin() through it always returns false.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: udata } = await userClient.auth.getUser(token);
    const user = udata.user;
    if (!user) throw new Error("Not authenticated");

    const { data: isAdmin, error: adminErr } = await userClient.rpc(
      "is_platform_admin",
    );
    if (adminErr || !isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden: platform admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client for the DB writes the gate just authorized.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { dispute_id, submit = true } = await req.json();
    if (!dispute_id) throw new Error("dispute_id required");

    const { data: row, error: rowErr } = await admin
      .from("disputes")
      .select("*")
      .eq("id", dispute_id)
      .maybeSingle();
    if (rowErr || !row) throw new Error("Dispute not found");

    const stripe = await createStripeClient(stripeKey, { apiVersion: "2025-08-27.basil" });
    const evidence = row.drafted_evidence || {};

    // Strip nulls — Stripe rejects null values for some fields
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(evidence)) {
      if (typeof v === "string" && v.trim().length > 0) clean[k] = v;
    }

    const updated = await stripe.disputes.update(row.stripe_dispute_id, {
      evidence: clean as any,
      submit,
    });

    await admin
      .from("disputes")
      .update({
        submitted_at: submit ? new Date().toISOString() : null,
        submitted_by: submit ? user.id : null,
        status: updated.status,
      })
      .eq("id", dispute_id);

    return new Response(
      JSON.stringify({ ok: true, submitted: submit, status: updated.status }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[submit-dispute-evidence] error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

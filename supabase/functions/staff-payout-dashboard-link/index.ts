import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Returns a one-time Stripe Express dashboard link for the CALLER's own payout
// account. Cleaners never get a Stripe password — this is how they see their
// balance, deposits and anything Stripe needs from them.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u, error: ue } = await supabase.auth.getUser(token);
    if (ue || !u.user) return json({ error: "Unauthorized" }, 401);

    const { staffId, organizationId } = await req.json();
    if (!staffId || !organizationId) return json({ error: "staffId and organizationId required" }, 400);

    // Only the cleaner themself — scoped to the org so dual-org cleaners work.
    const { data: staffRow } = await supabase
      .from("staff").select("id")
      .eq("id", staffId).eq("organization_id", organizationId).eq("user_id", u.user.id)
      .maybeSingle();
    if (!staffRow) return json({ error: "Forbidden" }, 403);

    const { data: acct } = await supabase
      .from("staff_payout_accounts").select("stripe_account_id, details_submitted")
      .eq("staff_id", staffId).eq("organization_id", organizationId).maybeSingle();
    if (!acct?.stripe_account_id) return json({ error: "Finish payout setup first." }, 400);

    const key = Deno.env.get("STRIPE_SECRET_KEY");
    if (!key) return json({ error: "Payouts are not configured. Please contact support." }, 500);
    const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });
    try {
      const link = await stripe.accounts.createLoginLink(acct.stripe_account_id);
      return json({ url: link.url });
    } catch (e) {
      console.error("[staff-payout-dashboard-link] createLoginLink failed", e);
      return json({ error: "Stripe can't open your payout page until setup is finished. Tap Continue Setup first." }, 400);
    }
  } catch (e) {
    console.error("[staff-payout-dashboard-link]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

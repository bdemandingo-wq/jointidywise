import { createStripeClient } from "../_shared/stripe-client.ts";
import { isDemoSendBlocked } from "../_shared/demo-org.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Cancel every active Stripe subscription tied to this org BEFORE
 * deleting the org. Otherwise Stripe keeps retrying failed charges
 * after the customer thinks they've cancelled.
 */
async function cancelOrgStripeSubscriptions(
  supabase: { from: (table: string) => any },
  organizationId: string,
): Promise<string[]> {
  const stripeKey = billingSecretKey();
  if (!stripeKey) return [];
  const stripe = await createStripeClient(stripeKey, { organizationId, apiVersion: "2025-08-27.basil" });
  const cancelled: string[] = [];
  try {
    const { data: subs } = await supabase
      .from("stripe_subscriptions")
      .select("stripe_subscription_id")
      .eq("organization_id", organizationId);
    for (const row of subs ?? []) {
      const subId = (row as { stripe_subscription_id?: string }).stripe_subscription_id;
      if (!subId) continue;
      try {
        const current = await stripe.subscriptions.retrieve(subId);
        if (["canceled", "incomplete_expired"].includes(current.status)) continue;
        await stripe.subscriptions.cancel(subId, { invoice_now: false, prorate: false });
        cancelled.push(subId);
        console.log(`[delete-my-organization] cancelled Stripe sub ${subId}`);
      } catch (e) {
        console.error(`[delete-my-organization] failed to cancel sub ${subId}:`, e);
      }
    }
  } catch (e) {
    console.error("[delete-my-organization] Stripe cleanup error:", e);
  }
  return cancelled;
}

/**
 * Owner-initiated organization deletion.
 *
 * Hard rules:
 * 1. Caller must be authenticated.
 * 2. Caller must hold role=owner in org_memberships for the target org.
 * 3. Caller must still belong to at least one OTHER org afterward — this
 *    endpoint refuses to delete the last remaining org so a user can never
 *    accidentally lock themselves out via the switcher. Full-account
 *    deletion lives in delete-my-account.
 * 4. Target org_id required and validated as a uuid.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const organizationId = body?.organizationId;
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!organizationId || !uuidRe.test(organizationId)) {
      return new Response(JSON.stringify({ error: "Invalid organizationId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller is owner of this org
    const { data: membership, error: memErr } = await supabase
      .from("org_memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (memErr || !membership) {
      return new Response(JSON.stringify({ error: "You are not a member of that organization" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (membership.role !== "owner") {
      return new Response(JSON.stringify({ error: "Only the owner can delete an organization" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ensure the caller has at least one OTHER org
    const { count, error: countErr } = await supabase
      .from("org_memberships")
      .select("organization_id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .neq("organization_id", organizationId);
    if (countErr) throw countErr;
    if (!count || count < 1) {
      return new Response(
        JSON.stringify({ error: "Cannot delete your only business. Add another first, or delete your account." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // CRITICAL: cancel any active Stripe subscriptions before nuking the org
    const cancelledSubs = await cancelOrgStripeSubscriptions(supabase, organizationId);

    // Cascade — same approach as delete-platform-account
    await supabase.from("org_memberships").delete().eq("organization_id", organizationId);
    const { error: delErr } = await supabase
      .from("organizations")
      .delete()
      .eq("id", organizationId);
    if (delErr) {
      console.error("[delete-my-organization] delete failed", delErr);
      return new Response(JSON.stringify({ error: delErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[delete-my-organization] org ${organizationId} deleted by user ${user.id}. Cancelled ${cancelledSubs.length} Stripe sub(s): ${cancelledSubs.join(', ') || 'none'}`);
    return new Response(JSON.stringify({ success: true, cancelledSubscriptions: cancelledSubs }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    if (isDemoSendBlocked(e)) {
      return new Response(JSON.stringify({ success: false, skipped: true, reason: "demo_mode" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[delete-my-organization] error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

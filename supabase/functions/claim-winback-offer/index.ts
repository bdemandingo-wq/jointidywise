// One-time win-back offer for users canceling because of price.
// Two actions:
//   - action="show"    → records the offer was shown (idempotent per user). Returns offer config.
//   - action="claim"   → applies the configured coupon to the user's subscription and marks claimed.
//   - action="decline" → marks the offer declined.
// Enforces "one offer per user, ever" via UNIQUE(user_id) on winback_offers.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { authenticateUser } from "../_shared/auth-org.ts";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface WinbackConfig {
  offer_type: string;
  percent_off: number;
  duration: "once" | "repeating" | "forever";
  duration_in_months: number | null;
  label: string;
}

async function getOfferConfig(supabase: any): Promise<WinbackConfig> {
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "winback_offer")
    .maybeSingle();
  const v = data?.value ?? {};
  return {
    offer_type: v.offer_type ?? "one_month_free",
    percent_off: typeof v.percent_off === "number" ? v.percent_off : 100,
    duration: v.duration ?? "once",
    duration_in_months: v.duration_in_months ?? null,
    label: v.label ?? "1 month free",
  };
}

// Build a coupon ID that includes a hash of the offer config so editing
// platform_settings.winback_offer mints a new coupon. Without this,
// the first time a config change tries to mint `winback_${type}` the
// retrieve succeeds (old coupon), we never create a fresh one, and the
// old percent_off/duration is applied forever — config edits in the
// admin UI silently take no effect.
function couponIdFor(cfg: WinbackConfig): string {
  const parts = [
    cfg.offer_type,
    `pct${cfg.percent_off}`,
    cfg.duration,
    cfg.duration === "repeating" && cfg.duration_in_months
      ? `m${cfg.duration_in_months}`
      : null,
  ].filter(Boolean);
  // Stripe coupon IDs allow [A-Za-z0-9_-], capped reasonably long. The
  // suffix is deterministic so the same config always resolves to the
  // same coupon (idempotent across cron / repeated claims).
  return `winback_${parts.join("_")}`.slice(0, 80);
}

async function ensureCoupon(stripe: Stripe, cfg: WinbackConfig): Promise<string> {
  const id = couponIdFor(cfg);
  try {
    const existing = await stripe.coupons.retrieve(id);
    if (existing && !(existing as any).deleted) return existing.id;
  } catch {
    // not found
  }
  const created = await stripe.coupons.create({
    id,
    percent_off: cfg.percent_off,
    duration: cfg.duration,
    ...(cfg.duration === "repeating" && cfg.duration_in_months
      ? { duration_in_months: cfg.duration_in_months }
      : {}),
    name: cfg.label,
  });
  return created.id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await authenticateUser(req);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error }), {
        status: auth.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { supabase, userId, userEmail, organizationId } = auth.ctx;

    const body = await req.json().catch(() => ({}));
    const action = (body?.action ?? "show") as "show" | "claim" | "decline";

    const cfg = await getOfferConfig(supabase);

    // Look up the user's most recent offer. The schema now allows
    // multiple historical rows per user (one active + accumulated
    // claimed/declined history); we care about the latest one for the
    // current action's eligibility decision.
    const { data: existing } = await supabase
      .from("winback_offers")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (action === "show") {
      if (existing) {
        return new Response(
          JSON.stringify({ eligible: false, reason: "already_offered", offer: cfg, status: existing.status }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      await supabase.from("winback_offers").insert({
        organization_id: organizationId,
        user_id: userId,
        offer_type: cfg.offer_type,
        status: "shown",
      });
      return new Response(JSON.stringify({ eligible: true, offer: cfg }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "decline") {
      if (!existing) {
        return new Response(JSON.stringify({ error: "No offer to decline" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await supabase
        .from("winback_offers")
        .update({ status: "declined", declined_at: new Date().toISOString() })
        .eq("id", existing.id);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // action === "claim"
    if (!existing) {
      return new Response(JSON.stringify({ error: "No offer to claim" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (existing.status === "claimed") {
      return new Response(JSON.stringify({ success: true, alreadyClaimed: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripeKey = billingSecretKey();
    if (!stripeKey) throw new Error("STRIPE_BILLING_SECRET_KEY is not set");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
    if (customers.data.length === 0) {
      return new Response(JSON.stringify({ error: "No subscription found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const customerId = customers.data[0].id;
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
    });
    const active = subs.data.find((s) =>
      ["active", "trialing", "past_due"].includes(s.status),
    );
    if (!active) {
      return new Response(JSON.stringify({ error: "No active subscription" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const couponId = await ensureCoupon(stripe, cfg);
    await stripe.subscriptions.update(active.id, {
      coupon: couponId,
      // If the user had set cancel_at_period_end earlier, undo it so they keep the plan.
      cancel_at_period_end: false,
    });

    // The Stripe discount is already live on the subscription at this
    // point — do not tell the customer this failed (it didn't, from
    // their side). But if this status write doesn't land, the re-claim
    // guard above (existing.status === "claimed") never trips, so the
    // same coupon can be re-applied indefinitely. Retry once, then log
    // loud enough for manual reconciliation rather than let it pass
    // silently either way.
    let claimRecorded = false;
    let lastClaimErr: string | undefined;
    for (let attempt = 1; attempt <= 2 && !claimRecorded; attempt++) {
      const { error: claimErr } = await supabase
        .from("winback_offers")
        .update({
          status: "claimed",
          claimed_at: new Date().toISOString(),
          coupon_id: couponId,
          stripe_customer_id: customerId,
          stripe_subscription_id: active.id,
        })
        .eq("id", existing.id);
      if (!claimErr) {
        claimRecorded = true;
      } else {
        lastClaimErr = claimErr.message;
        console.error(`[WINBACK] status update to 'claimed' failed (attempt ${attempt}/2):`, claimErr);
      }
    }
    if (!claimRecorded) {
      console.error(
        `[WINBACK] CRITICAL: coupon ${couponId} applied to Stripe subscription ${active.id} ` +
        `(customer ${customerId}, user ${userId}) but winback_offers row ${existing.id} was never ` +
        `marked claimed after 2 attempts (${lastClaimErr}) — the re-claim guard is bypassed for this ` +
        `user until manually reconciled.`,
      );
    }

    return new Response(JSON.stringify({ success: true, coupon_id: couponId, offer: cfg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log("[WINBACK] ERROR", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

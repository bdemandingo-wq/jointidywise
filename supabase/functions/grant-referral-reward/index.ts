// Grants the REFERRER their earned month(s) and reconciles them into a single
// Stripe coupon on the referrer's subscription.
//
// Called server-to-server from stripe-invoice-webhook once a referral vests
// (status 'qualified'). Gated on the internal cron secret, not a user JWT.
//
// SINGLE-COUPON DESIGN: a Stripe subscription carries at most ONE discount
// unless "multiple discounts" is enabled on the account. Rewards are therefore
// reconciled into one coupon whose duration_in_months equals the months still
// owed, replacing whatever coupon is currently recorded in active_coupon_id.
// The ledger (org_referral_credits) is what makes that reconciliation — and
// redemption counting — possible. Do not stack coupons.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
import { billingSecretKey } from "../_shared/billing-stripe.ts";
  isMonthlyPlan,
  isInGoodStanding,
  bonusMonthsOwed,
  monthsOwed,
} from "../_shared/referral-eligibility.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-internal-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const log = (step: string, details?: unknown) =>
  console.log(`[referral] grant: ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // ── 1. Internal auth ───────────────────────────────────────────────────
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return json({ error: "CRON_SECRET not configured on server" }, 500);
  const provided =
    req.headers.get("x-cron-secret") || req.headers.get("x-internal-secret");
  if (provided !== expected) return json({ error: "Unauthorized" }, 401);

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const referralId = typeof body.referral_id === "string" ? body.referral_id : null;
    if (!referralId) return json({ error: "referral_id is required" }, 400);

    // ── 2. Idempotency guard ─────────────────────────────────────────────
    const { data: referral } = await admin
      .from("org_referrals")
      .select("id, referrer_org_id, status, referrer_reward_granted_at")
      .eq("id", referralId)
      .maybeSingle();

    if (!referral) return json({ outcome: "already_granted", note: "no such referral" });
    if (referral.status !== "qualified" || referral.referrer_reward_granted_at) {
      log("already granted", { referralId, status: referral.status });
      return json({ outcome: "already_granted" });
    }

    const referrerOrgId = referral.referrer_org_id as string;

    // ── 3. A lifetime referrer has no subscription to discount ───────────
    const { data: referrerOrg } = await admin
      .from("organizations")
      .select("id, plan_type")
      .eq("id", referrerOrgId)
      .maybeSingle();

    if (!isMonthlyPlan(referrerOrg?.plan_type ?? null)) {
      await admin
        .from("org_referrals")
        .update({
          status: "rewarded",
          referrer_reward_granted_at: new Date().toISOString(),
          // No rejection — the referral was valid; there is simply nothing to
          // apply a monthly discount to. Recorded so it does not sit
          // 'qualified' forever.
          rejection_reason: "referrer_not_monthly",
        })
        .eq("id", referralId);
      log("referrer not monthly", { referrerOrgId });
      return json({ outcome: "referrer_not_monthly" });
    }

    // ── 4. Grant the per-referral month, and close the referral in the
    //       SAME step so a retry short-circuits at step 2. ────────────────
    await admin
      .from("org_referral_credits")
      .upsert({ organization_id: referrerOrgId }, { onConflict: "organization_id", ignoreDuplicates: true });

    const { data: creditsBefore } = await admin
      .from("org_referral_credits")
      .select("months_granted, months_redeemed, active_coupon_id")
      .eq("organization_id", referrerOrgId)
      .maybeSingle();

    let granted = (creditsBefore?.months_granted ?? 0) + 1;
    const redeemed = creditsBefore?.months_redeemed ?? 0;

    await admin
      .from("org_referral_credits")
      .update({ months_granted: granted, updated_at: new Date().toISOString() })
      .eq("organization_id", referrerOrgId);

    await admin
      .from("org_referrals")
      .update({
        status: "rewarded",
        referrer_reward_granted_at: new Date().toISOString(),
      })
      .eq("id", referralId);

    // ── 5. The bonus. Recount from scratch every time — a referral can fall
    //       OUT of good standing between converting and the third arriving,
    //       and a stored counter would not notice. ────────────────────────
    const { data: allReferrals } = await admin
      .from("org_referrals")
      .select("id, status, referred_org_id, referred_paid_invoice_count")
      .eq("referrer_org_id", referrerOrgId);

    const referredIds = (allReferrals ?? []).map((r: any) => r.referred_org_id);
    const { data: subs } = referredIds.length
      ? await admin
          .from("stripe_subscriptions")
          .select("organization_id, status, updated_at")
          .in("organization_id", referredIds)
          .order("updated_at", { ascending: false })
      : { data: [] as any[] };

    const subStatusByOrg = new Map<string, string>();
    for (const s of subs ?? []) {
      if (!subStatusByOrg.has(s.organization_id)) {
        subStatusByOrg.set(s.organization_id, s.status);
      }
    }

    const qualifyingIds: string[] = [];
    for (const r of allReferrals ?? []) {
      const good = isInGoodStanding({
        status: r.status,
        paidInvoiceCount: r.referred_paid_invoice_count ?? 0,
        subscriptionStatus: subStatusByOrg.get(r.referred_org_id) ?? "",
      });
      if (good) qualifyingIds.push(r.id);
    }

    const { data: existingBonus } = await admin
      .from("org_referral_bonuses")
      .select("id")
      .eq("organization_id", referrerOrgId)
      .maybeSingle();

    const bonus = bonusMonthsOwed(qualifyingIds.length, Boolean(existingBonus));
    if (bonus > 0) {
      const { error: bonusError } = await admin.from("org_referral_bonuses").insert({
        organization_id: referrerOrgId,
        months: bonus,
        qualifying_referral_ids: qualifyingIds,
      });
      if (bonusError && (bonusError as any).code !== "23505") throw bonusError;
      if (!bonusError) {
        // UNIQUE(organization_id) enforces "once ever"; 23505 means another
        // pass already granted it, which is not an error.
        granted += bonus;
        await admin
          .from("org_referral_credits")
          .update({ months_granted: granted, updated_at: new Date().toISOString() })
          .eq("organization_id", referrerOrgId);
        log("bonus granted", { referrerOrgId, bonus, goodStanding: qualifyingIds.length });
      }
    }

    // ── 6. Reconcile into ONE coupon ─────────────────────────────────────
    const owed = monthsOwed(granted, redeemed);
    if (owed <= 0) {
      log("nothing owed", { referrerOrgId, granted, redeemed });
      return json({ outcome: "nothing_owed", months_granted: granted });
    }

    const stripeKey = billingSecretKey();
    if (!stripeKey) throw new Error("STRIPE_BILLING_SECRET_KEY is not set");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const { data: referrerSub } = await admin
      .from("stripe_subscriptions")
      .select("stripe_subscription_id, status")
      .eq("organization_id", referrerOrgId)
      .in("status", ["active", "trialing", "past_due"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!referrerSub?.stripe_subscription_id) {
      log("no live subscription to discount", { referrerOrgId, owed });
      return json({ outcome: "granted", months_granted: granted, coupon_applied: false });
    }

    const coupon = await stripe.coupons.create({
      percent_off: 100,
      duration: "repeating",
      duration_in_months: owed,
      name: `TidyWise referral credit (${owed} month${owed === 1 ? "" : "s"})`,
      metadata: { organization_id: referrerOrgId, purpose: "tidywise_referral_reward" },
    });

    // Replace, never stack. Passing a single coupon overwrites the existing
    // discount recorded in active_coupon_id.
    await stripe.subscriptions.update(referrerSub.stripe_subscription_id, {
      coupon: coupon.id,
    });

    await admin
      .from("org_referral_credits")
      .update({ active_coupon_id: coupon.id, updated_at: new Date().toISOString() })
      .eq("organization_id", referrerOrgId);

    log("granted", { referrerOrgId, granted, redeemed, owed, coupon: coupon.id });
    return json({
      outcome: "granted",
      months_granted: granted,
      months_owed: owed,
      coupon_id: coupon.id,
    });
  } catch (e) {
    console.error("[referral] grant failed", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

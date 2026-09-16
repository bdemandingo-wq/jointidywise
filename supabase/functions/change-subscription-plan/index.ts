// Switch an existing Stripe subscription to a different tier.
//
//   mode = "upgrade"   → apply immediately with proration, charge now,
//                        update organizations.plan_type right away.
//   mode = "downgrade" → schedule via subscription schedule so the new
//                        price kicks in at period end. proration_behavior
//                        = "none" — the user keeps the current tier
//                        until the billing period ends. plan_type is
//                        updated by the existing Stripe webhook when
//                        the cycle rolls over.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PRICE_IDS: Record<string, Record<string, string | undefined>> = {
  basic: {
    monthly: Deno.env.get("STRIPE_BASIC_MONTHLY_PRICE_ID"),
    yearly: Deno.env.get("STRIPE_BASIC_YEARLY_PRICE_ID"),
  },
  pro: {
    monthly: Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID"),
    yearly: Deno.env.get("STRIPE_PRO_YEARLY_PRICE_ID"),
  },
  custom: {
    monthly: Deno.env.get("STRIPE_CUSTOM_MONTHLY_PRICE_ID"),
    yearly: Deno.env.get("STRIPE_CUSTOM_YEARLY_PRICE_ID"),
  },
};

const log = (s: string, d?: unknown) =>
  console.log(`[CHANGE-SUB-PLAN] ${s}${d ? " " + JSON.stringify(d) : ""}`);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr) throw new Error(userErr.message);
    const user = userData.user;
    if (!user?.email) throw new Error("Not authenticated");

    const body = (await req.json().catch(() => ({}))) as {
      plan?: string;
      interval?: string;
      mode?: string;
      discount_code?: string;
    };
    const interval = body.interval === "yearly" ? "yearly" : "monthly";
    const mode =
      body.mode === "downgrade"
        ? "downgrade"
        : body.mode === "cancel_downgrade"
          ? "cancel_downgrade"
          : "upgrade";
    const plan = body.plan;

    // For upgrade/downgrade, plan is required. cancel_downgrade doesn't need it.
    if (mode !== "cancel_downgrade") {
      if (!plan || !["basic", "pro", "custom"].includes(plan)) {
        return new Response(JSON.stringify({ error: "Invalid plan" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const newPriceId = plan ? PRICE_IDS[plan]?.[interval] : undefined;
    if (mode !== "cancel_downgrade" && !newPriceId) {
      return new Response(
        JSON.stringify({ error: `Stripe price for ${plan} ${interval} is not configured.` }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Trialing / past_due subscriptions are still upgradable. Filtering on
    // status:"active" only meant trial users got a bare 400 on upgrade.
    const CHANGEABLE = ["active", "trialing", "past_due", "unpaid"];
    const noSub = () =>
      new Response(
        JSON.stringify({
          error: "You don't have a paid subscription yet, so there's nothing to upgrade. Start a plan to continue.",
          code: "no_subscription",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (customers.data.length === 0) return noSub();
    const customerId = customers.data[0].id;

    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 20,
    });
    const subscription = subs.data.find((s) => CHANGEABLE.includes(s.status));
    if (!subscription) return noSub();
    const itemId = subscription.items.data[0].id;

    // Resolve WHICH organization this plan change applies to. A user can
    // belong to several orgs, so we never "guess" with maybeSingle() — that
    // returns null on multi-row and would silently skip the lifetime guard.
    const requestedOrgId = (body as { organization_id?: string }).organization_id;

    const { data: memberships, error: memErr } = await supabase
      .from("org_memberships")
      .select("organization_id, role, organizations(plan_type, grandfathered_lifetime, stripe_schedule_id)")
      .eq("user_id", user.id);

    if (memErr) {
      return new Response(
        JSON.stringify({ error: "Could not verify your organization access." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rows = (memberships ?? []) as any[];
    let membership: any = null;
    if (requestedOrgId) {
      membership = rows.find((m) => m.organization_id === requestedOrgId) ?? null;
      if (!membership) {
        return new Response(
          JSON.stringify({ error: "You are not a member of that organization." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else if (rows.length === 1) {
      membership = rows[0];
    }

    // Fail closed: if we can't tell which org's subscription is changing,
    // block rather than proceed without the lifetime guard.
    if (!membership) {
      return new Response(
        JSON.stringify({
          error:
            "Could not determine which business this plan change is for. Please reopen the billing page and try again.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const org = membership.organizations;
    if (org?.plan_type === "lifetime" || org?.grandfathered_lifetime) {
      return new Response(
        JSON.stringify({ error: "Lifetime plans cannot be changed." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }


    // Resolve discount (optional)
    let promotionCodeId: string | undefined;
    if (body.discount_code) {
      const promos = await stripe.promotionCodes.list({
        code: body.discount_code.trim(),
        active: true,
        limit: 1,
      });
      if (promos.data.length === 0) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired discount code." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      promotionCodeId = promos.data[0].id;
    }

    const orgId = (membership as any)?.organization_id;

    if (mode === "cancel_downgrade") {
      // Release the schedule so the subscription continues on its
      // current price indefinitely, and clear the org's pending fields.
      const scheduleId =
        (subscription.schedule as string | null) ||
        (org as any)?.stripe_schedule_id ||
        null;
      if (scheduleId) {
        try {
          await stripe.subscriptionSchedules.release(scheduleId);
        } catch (e) {
          console.error("[CHANGE-SUB-PLAN] release schedule failed:", e);
        }
      }
      if (orgId) {
        const { error: cancelDowngradeErr } = await supabase
          .from("organizations")
          .update({
            plan_downgrade_scheduled_to: null,
            plan_downgrade_date: null,
            stripe_schedule_id: null,
          })
          .eq("id", orgId);
        if (cancelDowngradeErr) {
          console.error("[CHANGE-SUB-PLAN] clearing downgrade fields failed (Stripe schedule already released):", { orgId, error: cancelDowngradeErr });
        }
      }
      log("downgrade cancelled", { scheduleId });
      return new Response(
        JSON.stringify({ success: true, mode: "cancel_downgrade" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (mode === "upgrade") {
      // Immediate switch with proration; Stripe will create + attempt to
      // pay the proration invoice automatically.
      const updated = await stripe.subscriptions.update(subscription.id, {
        items: [{ id: itemId, price: newPriceId }],
        proration_behavior: "always_invoice",
        payment_behavior: "error_if_incomplete",
        ...(promotionCodeId ? { promotion_code: promotionCodeId } : {}),
        metadata: {
          ...(subscription.metadata || {}),
          plan_tier: plan!,
          plan_interval: interval,
          tidywise_plan: plan!,
        },
      });

      // Reflect new plan immediately + clear any prior pending downgrade.
      // Stripe has already charged the proration by this point — a
      // failure here must not be reported as success, since the customer
      // paid for an upgrade whose feature-gates never actually opened.
      let planUpdateFailed = false;
      if (orgId) {
        const { error: planUpdateErr } = await supabase
          .from("organizations")
          .update({
            plan_type: plan,
            plan_downgrade_scheduled_to: null,
            plan_downgrade_date: null,
            stripe_schedule_id: null,
          })
          .eq("id", orgId);
        if (planUpdateErr) {
          planUpdateFailed = true;
          console.error("[CHANGE-SUB-PLAN] CRITICAL: customer charged for upgrade but plan_type update failed:", {
            orgId, subId: updated.id, plan, error: planUpdateErr,
          });
        }
      }

      log("upgraded", { subId: updated.id, plan, planUpdateFailed });
      if (planUpdateFailed) {
        return new Response(
          JSON.stringify({
            success: false,
            mode: "upgrade",
            subscription_id: updated.id,
            error: "Your payment went through, but we couldn't finish unlocking the new plan. This has been flagged — please refresh in a minute or contact support.",
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ success: true, mode: "upgrade", subscription_id: updated.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Downgrade: schedule at period end via subscription schedule ──
    let scheduleId = subscription.schedule as string | null;
    if (!scheduleId) {
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id,
      });
      scheduleId = schedule.id;
    }

    const existing = await stripe.subscriptionSchedules.retrieve(scheduleId);
    const currentPhase = existing.phases[existing.phases.length - 1];
    const periodEndSec = currentPhase.end_date as number | null;

    await stripe.subscriptionSchedules.update(scheduleId, {
      end_behavior: "release",
      proration_behavior: "none",
      phases: [
        {
          items: currentPhase.items.map((i) => ({
            price: i.price as string,
            quantity: i.quantity,
          })),
          start_date: currentPhase.start_date,
          end_date: currentPhase.end_date,
        },
        {
          items: [{ price: newPriceId!, quantity: 1 }],
          iterations: 1,
          proration_behavior: "none",
          ...(promotionCodeId ? { discounts: [{ promotion_code: promotionCodeId }] } : {}),
          metadata: { plan_tier: plan!, plan_interval: interval, tidywise_plan: plan! },
        },
      ],
    });

    const scheduledAtIso = periodEndSec
      ? new Date(periodEndSec * 1000).toISOString()
      : null;

    // Persist the pending downgrade so the UI can show a banner and
    // offer a cancel action.
    if (orgId) {
      const { error: downgradeScheduleErr } = await supabase
        .from("organizations")
        .update({
          plan_downgrade_scheduled_to: plan,
          plan_downgrade_date: scheduledAtIso,
          stripe_schedule_id: scheduleId,
        })
        .eq("id", orgId);
      if (downgradeScheduleErr) {
        // No immediate charge here (proration_behavior: "none"), so this
        // isn't a "customer paid, got nothing" case — but the UI's
        // downgrade banner/cancel action won't reflect the real Stripe
        // schedule until this is fixed, so still worth being loud about.
        console.error("[CHANGE-SUB-PLAN] downgrade scheduled at Stripe but organizations update failed:", {
          orgId, scheduleId, plan, error: downgradeScheduleErr,
        });
      }
    }

    log("downgrade scheduled", { scheduleId, plan, scheduledAtIso });
    return new Response(
      JSON.stringify({
        success: true,
        mode: "downgrade",
        scheduled_at: scheduledAtIso,
        target_plan: plan,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("ERROR", { msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

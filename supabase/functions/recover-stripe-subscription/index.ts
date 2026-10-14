import { createStripeClient } from "../_shared/stripe-client.ts";
// One-shot recovery for a Stripe subscription that never linked to an org.
//
// Built after the jigdahifash@gmail.com incident: customer paid, Stripe
// subscription was active, but no stripe_subscriptions row existed in our
// DB because the webhook's lookup chain failed silently.
//
// Modes:
//   { mode: "lookup", email?: string, stripe_customer_id?: string }
//     Read-only. Reports what exists in our DB + what's in Stripe.
//     Use this first to see the damage.
//
//   { mode: "recover", email?: string, stripe_customer_id?: string,
//     plan?: "basic"|"pro"|"custom" }
//     Provisions missing user/profile/org/membership as needed, then
//     upserts the stripe_subscriptions row. Idempotent — safe to re-run.
//     If plan isn't supplied, we infer it from the price ID against the
//     STRIPE_*_PRICE_ID env vars (falls back to 'standard').
//
//   { mode: "list_orphans" }
//     Returns every unresolved row from subscription_orphans so you can
//     see who else got stuck.
//
// Auth: platform admin only. Verifies via the is_platform_admin() RPC
// (same gate as admin-cancel-subscription) so non-admins can't trigger
// account provisioning.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RecoverBody {
  mode?: "lookup" | "recover" | "list_orphans";
  email?: string;
  stripe_customer_id?: string;
  plan?: "basic" | "pro" | "custom";
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Map a Stripe price ID to a TidyWise plan by checking env vars. */
function inferPlanFromPrice(priceId: string | null): string | null {
  if (!priceId) return null;
  const map: Record<string, string> = {
    [Deno.env.get("STRIPE_BASIC_MONTHLY_PRICE_ID") || ""]: "basic",
    [Deno.env.get("STRIPE_BASIC_YEARLY_PRICE_ID") || ""]: "basic",
    [Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID") || ""]: "pro",
    [Deno.env.get("STRIPE_PRO_YEARLY_PRICE_ID") || ""]: "pro",
    [Deno.env.get("STRIPE_CUSTOM_MONTHLY_PRICE_ID") || ""]: "custom",
    [Deno.env.get("STRIPE_CUSTOM_YEARLY_PRICE_ID") || ""]: "custom",
    [Deno.env.get("STRIPE_LIFETIME_PRICE_ID") || ""]: "lifetime",
  };
  return map[priceId] ?? null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const stripeKey = billingSecretKey();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!stripeKey || !supabaseUrl || !serviceKey || !anonKey) {
    return jsonResponse({ error: "Server misconfigured (missing env vars)" }, 500);
  }

  // ── AUTH: platform admin only ────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized — provide a logged-in platform admin token" }, 401);
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: udata } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
  if (!udata?.user) return jsonResponse({ error: "Invalid token" }, 401);
  const { data: isAdmin } = await userClient.rpc("is_platform_admin");
  if (!isAdmin) return jsonResponse({ error: "Platform admin access only" }, 403);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stripe = await createStripeClient(stripeKey, { apiVersion: "2025-08-27.basil" });

  const body = (await req.json().catch(() => ({}))) as RecoverBody;
  const mode = body.mode || "lookup";

  // ── LIST ORPHANS MODE ────────────────────────────────────────────────
  if (mode === "list_orphans") {
    const { data: orphans, error } = await admin
      .from("subscription_orphans")
      .select("*")
      .eq("resolved", false)
      .order("created_at", { ascending: false });
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({
      mode: "list_orphans",
      unresolved_count: orphans?.length ?? 0,
      orphans: orphans ?? [],
    });
  }

  // For lookup + recover, normalize identifiers
  const email = body.email?.toLowerCase().trim() || null;
  const stripeCustomerId = body.stripe_customer_id?.trim() || null;
  if (!email && !stripeCustomerId) {
    return jsonResponse({ error: "Provide email or stripe_customer_id" }, 400);
  }

  // ── STEP 1: DB lookup ───────────────────────────────────────────────
  const dbReport: Record<string, unknown> = {};

  // auth.users by email
  let authUser: { id: string; email?: string } | null = null;
  if (email) {
    try {
      const { data: existing } = await (admin.auth.admin as unknown as {
        getUserByEmail: (e: string) => Promise<{ data: { user?: { id: string; email?: string } | null } }>;
      }).getUserByEmail(email);
      authUser = existing?.user ?? null;
    } catch (e) {
      console.warn("getUserByEmail failed:", e);
    }
  }
  dbReport["auth_users"] = authUser
    ? { id: authUser.id, email: authUser.email ?? email }
    : "MISSING";

  // profiles (case-insensitive)
  let profileRow: { id: string; email: string } | null = null;
  if (email) {
    const { data } = await admin
      .from("profiles")
      .select("id, email")
      .ilike("email", email)
      .maybeSingle();
    profileRow = data ?? null;
  } else if (authUser?.id) {
    const { data } = await admin
      .from("profiles")
      .select("id, email")
      .eq("id", authUser.id)
      .maybeSingle();
    profileRow = data ?? null;
  }
  dbReport["profiles"] = profileRow ?? "MISSING";

  // org_memberships → organization
  let membershipRow: { organization_id: string; role: string } | null = null;
  let orgRow: { id: string; name: string; plan_type: string | null } | null = null;
  const lookupUserId = profileRow?.id || authUser?.id || null;
  if (lookupUserId) {
    const { data: mem } = await admin
      .from("org_memberships")
      .select("organization_id, role")
      .eq("user_id", lookupUserId)
      .limit(1)
      .maybeSingle();
    membershipRow = mem ?? null;
    if (mem?.organization_id) {
      const { data: org } = await admin
        .from("organizations")
        .select("id, name, plan_type")
        .eq("id", mem.organization_id)
        .maybeSingle();
      orgRow = org ?? null;
    }
  }
  dbReport["org_memberships"] = membershipRow ?? "MISSING";
  dbReport["organizations"] = orgRow ?? "MISSING";

  // stripe_subscriptions — by org OR by customer id
  let subRows: any[] = [];
  if (orgRow?.id) {
    const { data } = await admin
      .from("stripe_subscriptions")
      .select("*")
      .eq("organization_id", orgRow.id);
    subRows = data ?? [];
  }
  if (stripeCustomerId) {
    const { data: byCust } = await admin
      .from("stripe_subscriptions")
      .select("*")
      .eq("stripe_customer_id", stripeCustomerId);
    subRows = [...subRows, ...(byCust ?? [])];
    // Dedupe by stripe_subscription_id
    const seen = new Set<string>();
    subRows = subRows.filter((r) => {
      if (seen.has(r.stripe_subscription_id)) return false;
      seen.add(r.stripe_subscription_id);
      return true;
    });
  }
  dbReport["stripe_subscriptions"] = subRows.length > 0 ? subRows : "MISSING";

  // ── STEP 2: Pull from Stripe ────────────────────────────────────────
  let stripeCustomer: Stripe.Customer | null = null;
  let stripeSubscription: Stripe.Subscription | null = null;
  let allSubs: Stripe.Subscription[] = [];

  if (stripeCustomerId) {
    try {
      const c = await stripe.customers.retrieve(stripeCustomerId);
      if (!(c as any).deleted) stripeCustomer = c as Stripe.Customer;
    } catch (e) {
      return jsonResponse({
        error: `Stripe customer ${stripeCustomerId} not found`,
        detail: e instanceof Error ? e.message : String(e),
      }, 404);
    }
  } else if (email) {
    const list = await stripe.customers.list({ email, limit: 5 });
    stripeCustomer = list.data[0] ?? null;
  }

  if (stripeCustomer) {
    const subs = await stripe.subscriptions.list({
      customer: stripeCustomer.id,
      status: "all",
      limit: 10,
    });
    allSubs = subs.data;
    stripeSubscription = subs.data.find((s: any) =>
      ["active", "trialing", "past_due"].includes(s.status),
    ) || subs.data[0] || null;
  }

  const stripeReport = {
    customer: stripeCustomer
      ? {
          id: stripeCustomer.id,
          email: stripeCustomer.email,
          metadata: stripeCustomer.metadata,
        }
      : "NOT_FOUND",
    active_subscription: stripeSubscription
      ? {
          id: stripeSubscription.id,
          status: stripeSubscription.status,
          price_id: stripeSubscription.items.data[0]?.price?.id,
          unit_amount: stripeSubscription.items.data[0]?.price?.unit_amount,
          billing_interval: stripeSubscription.items.data[0]?.price?.recurring?.interval,
          current_period_end:
            (stripeSubscription as any).items?.data?.[0]?.current_period_end ??
            (stripeSubscription as any).current_period_end ?? null,
          metadata: stripeSubscription.metadata,
        }
      : "NONE",
    all_subscriptions_count: allSubs.length,
  };

  // ── LOOKUP MODE: stop here ──────────────────────────────────────────
  if (mode === "lookup") {
    return jsonResponse({
      mode: "lookup",
      query: { email, stripe_customer_id: stripeCustomerId },
      database: dbReport,
      stripe: stripeReport,
    });
  }

  // ── STEP 3: RECOVER MODE ────────────────────────────────────────────
  if (!stripeCustomer) {
    return jsonResponse({ error: "Cannot recover — Stripe customer not found", database: dbReport }, 404);
  }
  if (!stripeSubscription) {
    return jsonResponse({ error: "Cannot recover — Stripe customer has no subscriptions", database: dbReport }, 404);
  }

  const actions: string[] = [];
  let userId = authUser?.id ?? null;
  let orgId = orgRow?.id ?? null;
  const recoveryEmail = (stripeCustomer.email || email || "").toLowerCase().trim();
  if (!recoveryEmail) {
    return jsonResponse({ error: "No email available for provisioning" }, 400);
  }

  // 3a. Create auth user if missing
  if (!userId) {
    try {
      const inviteUrl = (Deno.env.get("APP_URL") || "https://jointidywise.com") + "/checkout/success?from_invite=1";
      const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(recoveryEmail, {
        redirectTo: inviteUrl,
        data: stripeCustomer.name ? { full_name: stripeCustomer.name } : undefined,
      });
      const msg = inviteErr?.message?.toLowerCase() ?? "";
      if (inviteErr && (msg.includes("already") || msg.includes("registered") || msg.includes("exists"))) {
        const { data: existing } = await (admin.auth.admin as unknown as {
          getUserByEmail: (e: string) => Promise<{ data: { user?: { id: string } | null } }>;
        }).getUserByEmail(recoveryEmail);
        userId = existing?.user?.id ?? null;
        actions.push(`auth user already existed: ${userId}`);
      } else if (inviteErr) {
        return jsonResponse({ error: `Invite failed: ${inviteErr.message}`, actions }, 500);
      } else if (invited?.user?.id) {
        userId = invited.user.id;
        actions.push(`auth user created via invite: ${userId}`);
      }
    } catch (e) {
      return jsonResponse({ error: `Invite exception: ${e instanceof Error ? e.message : String(e)}`, actions }, 500);
    }
  }
  if (!userId) return jsonResponse({ error: "Could not resolve userId after invite", actions }, 500);

  // 3b. Create profile if missing
  if (!profileRow) {
    const { error: profErr } = await admin
      .from("profiles")
      .upsert({ id: userId, email: recoveryEmail, full_name: stripeCustomer.name ?? null }, { onConflict: "id" });
    if (profErr) actions.push(`profile upsert WARN: ${profErr.message}`);
    else actions.push(`profile upserted: ${userId}`);
  }

  // 3c. Determine plan for org / sub
  const priceId = stripeSubscription.items.data[0]?.price?.id ?? null;
  const inferredPlan = body.plan
    || (stripeSubscription.metadata as any)?.tidywise_plan
    || inferPlanFromPrice(priceId)
    || "standard";
  const billingInterval =
    stripeSubscription.items.data[0]?.price?.recurring?.interval ?? null;
  const currentPeriodEndSec =
    (stripeSubscription as any).items?.data?.[0]?.current_period_end ??
    (stripeSubscription as any).current_period_end ?? null;
  const currentPeriodEndIso = currentPeriodEndSec
    ? new Date(currentPeriodEndSec * 1000).toISOString() : null;

  // 3d. Create org + membership if missing
  if (!orgId) {
    const orgName = stripeCustomer.name ? `${stripeCustomer.name}'s Business` : "My Cleaning Business";
    const { data: newOrg, error: orgErr } = await admin
      .from("organizations")
      .insert({ name: orgName, plan_type: inferredPlan, owner_id: userId })
      .select("id")
      .single();
    if (orgErr || !newOrg) {
      return jsonResponse({ error: `Org insert failed: ${orgErr?.message}`, actions }, 500);
    }
    orgId = newOrg.id;
    actions.push(`organization created: ${orgId} plan=${inferredPlan}`);
    const { error: memErr } = await admin
      .from("org_memberships")
      .insert({ organization_id: orgId, user_id: userId, role: "owner" });
    if (memErr) actions.push(`membership insert WARN: ${memErr.message}`);
    else actions.push(`membership created: ${userId} → ${orgId}`);
  } else {
    // Existing org — bump plan_type to match what they're actually paying for
    const { error: planErr } = await admin
      .from("organizations")
      .update({ plan_type: inferredPlan })
      .eq("id", orgId);
    if (planErr) actions.push(`org plan_type update WARN: ${planErr.message}`);
    else actions.push(`org plan_type set to ${inferredPlan}`);
  }

  // 3e. Upsert stripe_subscriptions
  const { error: subErr } = await admin
    .from("stripe_subscriptions")
    .upsert({
      organization_id: orgId,
      stripe_subscription_id: stripeSubscription.id,
      stripe_customer_id: stripeCustomer.id,
      stripe_price_id: priceId,
      status: stripeSubscription.status,
      plan: inferredPlan,
      billing_interval: billingInterval,
      current_period_end: currentPeriodEndIso,
      cancel_at_period_end: !!stripeSubscription.cancel_at_period_end,
      metadata: stripeSubscription.metadata,
      updated_at: new Date().toISOString(),
    }, { onConflict: "stripe_subscription_id" });
  if (subErr) {
    return jsonResponse({ error: `stripe_subscriptions upsert failed: ${subErr.message}`, actions }, 500);
  }
  actions.push(`stripe_subscriptions upserted: ${stripeSubscription.id} → ${orgId}`);

  // 3f. Mark orphan resolved if it was tracked
  await admin
    .from("subscription_orphans")
    .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_org_id: orgId })
    .eq("stripe_subscription_id", stripeSubscription.id);

  // ── STEP 4: Verify ──────────────────────────────────────────────────
  const { data: verifyData, error: verifyErr } = await admin.rpc("has_active_subscription", { _org_id: orgId });
  const hasAccess = verifyData === true;

  return jsonResponse({
    mode: "recover",
    success: hasAccess,
    user_id: userId,
    organization_id: orgId,
    stripe_subscription_id: stripeSubscription.id,
    plan: inferredPlan,
    billing_interval: billingInterval,
    current_period_end: currentPeriodEndIso,
    has_active_subscription: hasAccess,
    has_active_subscription_error: verifyErr?.message,
    actions,
  });
});

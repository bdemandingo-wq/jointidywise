import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { stripeKeyMode } from "../_shared/stripe-key-mode.ts";
import { billingSecretKey } from "../_shared/billing-stripe.ts";
import { extendShortCardFreeTrial, resolveCardFreeTrial } from "../_shared/trial-end.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Trial duration in days (from organization creation date)
const TRIAL_DURATION_DAYS = 60;

// Helper logging function
const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CHECK-SUBSCRIPTION] ${step}${detailsStr}`);
};

// Stripe can hang. A hung call makes the whole function 504 and the frontend
// gets no answer at all, so race every Stripe call against a deadline and
// answer with real JSON instead.
const STRIPE_TIMEOUT_MS = 8000;

class StripeTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`stripe_timeout: ${label} exceeded ${ms}ms`);
    this.name = "StripeTimeoutError";
  }
}

function withTimeout<T>(call: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StripeTimeoutError(label, ms)), ms);
  });
  // If the Stripe call loses the race and rejects later, swallow it here so it
  // cannot surface as an unhandled rejection after the response was sent.
  call.catch(() => {});
  return Promise.race([call, deadline]).finally(() => clearTimeout(timer));
}

// Login allowlist. The first address is the owner's account, not the public
// support inbox. Do not replace it.
const FREE_ACCOUNTS = new Set([
  "support@tidywisecleaning.com",
  "applereview@tidywise.com",
  "goldenroomcleaning@gmail.com",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Report the mode the key prefix implies. Do not log the key or switch it.
  const stripeKey = billingSecretKey() ?? "";
  const stripeMode = stripeKeyMode(stripeKey);

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Function started");

    if (!stripeKey) throw new Error("STRIPE_BILLING_SECRET_KEY is not set");
    logStep("Stripe key verified", { stripeMode });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      logStep("Missing Authorization header");
      return new Response(JSON.stringify({ stripe_mode: stripeMode, error: "Not authenticated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    logStep("Authorization header found");

    const token = authHeader.replace("Bearer ", "").trim();

    if (!token || token.split(".").length !== 3) {
      logStep("Invalid auth token format");
      return new Response(JSON.stringify({ stripe_mode: stripeMode, error: "Not authenticated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    logStep("Authenticating user with token");

    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) {
      logStep("Authentication failed", { message: userError.message });
      return new Response(
        JSON.stringify({ stripe_mode: stripeMode, error: `Authentication error: ${userError.message}` }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        }
      );
    }
    const user = userData.user;
    if (!user?.email) {
      logStep("User not authenticated or email not available");
      return new Response(JSON.stringify({ stripe_mode: stripeMode, error: "Not authenticated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    logStep("User authenticated", { userId: user.id, email: user.email });

    const normalizedEmail = user.email.toLowerCase();

    // Resolve org context once so every entitlement branch identifies the
    // organizations affected. A failed context lookup never blocks the
    // emergency free-account branch.
    const { data: contextMemberships, error: contextMembershipError } = await supabaseClient
      .from("org_memberships")
      .select("organization_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    const orgIds = (contextMemberships ?? [])
      .map((membership: any) => membership.organization_id)
      .filter(Boolean);
    if (contextMembershipError) {
      logStep("Organization context lookup failed", {
        orgIds,
        message: contextMembershipError.message,
        code: (contextMembershipError as any).code,
      });
    } else {
      logStep("Organization context resolved", { orgIds });
    }

    const logBranch = (branch: string, details: Record<string, unknown> = {}) =>
      logStep(`BRANCH ${branch}`, { orgIds, ...details });

    // Bypass subscription check for owner accounts and Apple review.
    // Keyed off the verified auth.users record
    // (NOT user-supplied input). Keep this list short.
    if (FREE_ACCOUNTS.has(normalizedEmail)) {
      logBranch("free_account_granted", { email: normalizedEmail });
      return new Response(JSON.stringify({ stripe_mode: stripeMode,
        subscribed: true,
        trial_active: false,
        product_id: "owner_free",
        subscription_end: null,
        trial_end: null
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    logBranch("free_account_not_applicable", { email: normalizedEmail });

    // NOTE: There is intentionally NO blanket "owner/admin bypass" here.
    // Granting subscribed=true to every org owner desynced the frontend from
    // the DB gate (has_active_subscription), letting post-cutoff owners into
    // the app where they hit RLS errors on every insert. Owners must qualify
    // through one of the real branches below: lifetime, active Stripe sub,
    // active comped_access grant, or an unexpired pre-cutoff org trial.




    // ── Step 0: Check for lifetime access ──────────────────────────────────
    // Two sources mean "lifetime":
    //   (a) a row in lifetime_access_purchases for this email (new buyers), OR
    //   (b) the user owns an organization flagged grandfathered_lifetime=true
    //       or plan_type='lifetime' (pre-pricing-launch users we promised
    //       permanent access to). Without this second check, all 78
    //       grandfathered owners get blocked by the AdminRoute paywall
    //       because check-subscription returns subscribed=false.
    const { data: lifetimePurchase } = await supabaseClient
      .from("lifetime_access_purchases")
      .select("id, created_at")
      .eq("email", normalizedEmail)
      .maybeSingle();

    let grandfatheredOrg = false;
    if (!lifetimePurchase) {
      const { data: gfMembership, error: gfError } = await supabaseClient
        .from("org_memberships")
        .select("organization_id, organizations!inner(grandfathered_lifetime, plan_type)")
        .eq("user_id", user.id)
        .or("grandfathered_lifetime.eq.true,plan_type.eq.lifetime", { foreignTable: "organizations" })
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (gfError) {
        // Do NOT throw: a failed lookup must not silently look like "no lifetime access".
        logStep("ERROR looking up grandfathered org membership", { message: gfError.message, code: (gfError as any).code });
      }
      grandfatheredOrg = !!gfMembership;
      logBranch("grandfathered_lookup_complete", {
        matched: grandfatheredOrg,
        matchedOrgId: gfMembership?.organization_id ?? null,
      });
    }

    if (lifetimePurchase || grandfatheredOrg) {
      logBranch("lifetime_access_granted", { email: normalizedEmail, source: lifetimePurchase ? "purchase" : "grandfathered_org" });
      return new Response(JSON.stringify({ stripe_mode: stripeMode,
        subscribed: true,
        trial_active: false,
        product_id: "lifetime",
        plan_type: "lifetime",
        subscription_end: null,
        trial_end: null,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    logBranch("lifetime_access_not_found");

    // ── Step 0.5: Check for active comped access grant on ANY of the user's
    // owner/admin/manager orgs. Checking only the first membership meant an
    // owner of several orgs could be denied while a sibling org held the comp.
    const { data: compMemberships, error: compMembershipError } = await supabaseClient
      .from("org_memberships")
      .select("organization_id")
      .eq("user_id", user.id)
      .in("role", ["owner", "admin", "manager"])
      .order("created_at", { ascending: true });

    if (compMembershipError) {
      // Log loudly, do not throw — but never treat a failed read as "no comp".
      logStep("ERROR looking up comped memberships", { message: compMembershipError.message, code: (compMembershipError as any).code });
    }

    const compOrgIds = (compMemberships ?? []).map((m: any) => m.organization_id).filter(Boolean);
    logBranch("comped_memberships_evaluated", { eligibleOrgIds: compOrgIds });

    if (compOrgIds.length > 0) {
      const { data: comp, error: compError } = await supabaseClient
        .from("comped_access")
        .select("expires_at")
        .in("organization_id", compOrgIds)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("expires_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (compError) {
        logStep("ERROR looking up comped_access", { message: compError.message, code: (compError as any).code });
      }

      if (comp) {
        logBranch("comped_access_granted", { eligibleOrgIds: compOrgIds, expiresAt: comp.expires_at });
        return new Response(JSON.stringify({ stripe_mode: stripeMode,
          subscribed: true,
          trial_active: false,
          product_id: "comped",
          plan_type: "comped",
          subscription_end: comp.expires_at,
          trial_end: null,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }
      logBranch("active_comped_access_not_found", { eligibleOrgIds: compOrgIds });
    } else {
      logBranch("no_comped_eligible_memberships");
    }


    // ── Step 1: Check Stripe for an active/trialing subscription first ──
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const customers = await withTimeout(
      stripe.customers.list({ email: user.email, limit: 1 }),
      STRIPE_TIMEOUT_MS,
      "stripe.customers.list"
    );

    if (customers.data.length > 0) {
      const customerId = customers.data[0].id;
      logBranch("stripe_customer_found", { customerId });

      const subscriptions = await withTimeout(
        stripe.subscriptions.list({
          customer: customerId,
          limit: 10,
        }),
        STRIPE_TIMEOUT_MS,
        "stripe.subscriptions.list"
      );

      const activeSubscription = subscriptions.data.find(
        (sub: any) => sub.status === "active" || sub.status === "trialing"
      );

      const pastDueSubscription = subscriptions.data.find(
        (sub: any) => sub.status === "past_due"
      );
      logBranch("stripe_subscriptions_evaluated", {
        customerId,
        statuses: subscriptions.data.map((subscription: any) => subscription.status),
      });

      // If past_due, block access
      if (!activeSubscription && pastDueSubscription) {
        logBranch("past_due_access_denied", { subscriptionId: pastDueSubscription.id });
        return new Response(JSON.stringify({ stripe_mode: stripeMode,
          subscribed: false,
          trial_active: false,
          product_id: null,
          subscription_end: null,
          trial_end: null,
          payment_failed: true,
          message: "Your subscription payment has failed. Please update your payment method to continue."
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      if (activeSubscription) {
        const isTrialing = activeSubscription.status === "trialing";

        let subscriptionEnd: string | null = null;
        if (activeSubscription.current_period_end && typeof activeSubscription.current_period_end === 'number') {
          try {
            subscriptionEnd = new Date(activeSubscription.current_period_end * 1000).toISOString();
          } catch (e) {
            logStep("Warning: Could not parse current_period_end", { value: activeSubscription.current_period_end });
          }
        }

        let trialEnd: string | null = null;
        if (activeSubscription.trial_end && typeof activeSubscription.trial_end === 'number') {
          try {
            trialEnd = new Date(activeSubscription.trial_end * 1000).toISOString();
          } catch (e) {
            logStep("Warning: Could not parse trial_end", { value: activeSubscription.trial_end });
          }
        }

        const productId = activeSubscription.items.data[0]?.price?.product;

        logBranch("active_stripe_access_granted", {
          subscriptionId: activeSubscription.id,
          status: activeSubscription.status,
          trialEnd,
          subscriptionEnd
        });

        return new Response(JSON.stringify({ stripe_mode: stripeMode,
          subscribed: true,
          trial_active: isTrialing,
          product_id: productId,
          plan_type: "standard",
          subscription_end: subscriptionEnd,
          trial_end: trialEnd
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      logBranch("stripe_customer_without_active_subscription", { customerId });
    } else {
      logBranch("stripe_customer_not_found");
    }

    // ── Step 2: No active Stripe subscription ──
    // The billing account often has no customer yet. That is not an
    // expired trial. limit(1) with no order, and an embed that comes
    // back as an array, used to miss plan_type and fall through to the
    // post-2026-04-06 cutoff, which denies every new org.
    const { data: membershipRows, error: membershipError } = await supabaseClient
      .from("org_memberships")
      .select("organization_id, role, created_at, organizations(id, created_at, plan_type)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    type OrgShape = { id?: string; created_at?: string | null; plan_type?: string | null };
    const orgFrom = (value: unknown): OrgShape | null => {
      if (!value) return null;
      if (Array.isArray(value)) return (value[0] as OrgShape) ?? null;
      return value as OrgShape;
    };
    const memberships = (membershipRows ?? []) as Array<{
      organization_id?: string;
      role?: string;
      organizations?: OrgShape | OrgShape[] | null;
    }>;

    if (membershipError || memberships.length === 0) {
      logBranch("organization_membership_missing_access_denied", { userId: user.id, error: membershipError?.message });
      return new Response(JSON.stringify({ stripe_mode: stripeMode,
        subscribed: false,
        trial_active: false,
        product_id: null,
        subscription_end: null,
        trial_end: null,
        message: "No organization found. Please contact support."
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const trialMembership = memberships.find((row) => orgFrom(row.organizations)?.plan_type === "trial");
    const ownerMembership = memberships.find((row) => row.role === "owner" || row.role === "admin");
    const membership = trialMembership ?? ownerMembership ?? memberships[0];
    const orgData = orgFrom(membership.organizations);
    const orgId = orgData?.id ?? membership.organization_id ?? null;
    const planType = orgData?.plan_type ?? null;

    const { data: trialProfile, error: trialProfileError } = await supabaseClient
      .from("profiles")
      .select("trial_ends_at, created_at")
      .eq("id", user.id)
      .maybeSingle();
    if (trialProfileError) {
      logStep("ERROR reading profile trial_ends_at", { message: trialProfileError.message });
    }

    const orgAgeMs = orgData?.created_at ? Date.now() - Date.parse(orgData.created_at) : NaN;
    const youngOrg = Number.isFinite(orgAgeMs) && orgAgeMs >= 0 && orgAgeMs < 30 * 24 * 60 * 60 * 1000;
    // trial/null, or a brand-new org whose default plan_type was not trial.
    // A future stored trial_ends_at is honored for any plan that has no
    // Stripe subscription. An old free/paid plan with no stamp is not
    // given a fresh 30 days.
    const mayStampTrial = planType === "trial" || planType == null || planType === "" || (planType === "free" && youngOrg);
    const storedTrialMs = trialProfile?.trial_ends_at ? Date.parse(trialProfile.trial_ends_at) : NaN;
    const futureStoredTrial = Number.isFinite(storedTrialMs) && Date.now() < storedTrialMs;

    if (mayStampTrial || futureStoredTrial) {
      const trialClockStart = orgData?.created_at ?? trialProfile?.created_at ?? null;
      let resolved = resolveCardFreeTrial({
        trialEndsAt: trialProfile?.trial_ends_at,
        createdAt: trialClockStart,
      });

      // A stored end from the old 14-day trigger is kept by resolveCardFreeTrial.
      // Trial-eligible orgs (not a paid plan that merely has a future stamp)
      // are lengthened to created_at + 30 days. The .lt filter cannot move
      // an end sooner.
      if (mayStampTrial) {
        const extended = extendShortCardFreeTrial({
          trialEndsAt: trialProfile?.trial_ends_at,
          createdAt: trialClockStart,
        });
        if (extended.extended && extended.trialEndIso) {
          const { error: extendError } = await supabaseClient
            .from("profiles")
            .update({ trial_ends_at: extended.trialEndIso })
            .eq("id", user.id)
            .lt("trial_ends_at", extended.trialEndIso);
          if (extendError) {
            logStep("ERROR extending profile trial_ends_at", { message: extendError.message });
          }
          resolved = {
            trialEndIso: extended.trialEndIso,
            active: extended.active,
            stampMissing: false,
          };
        } else if (resolved.stampMissing && resolved.active && resolved.trialEndIso) {
          const { error: stampError } = await supabaseClient
            .from("profiles")
            .update({ trial_ends_at: resolved.trialEndIso })
            .eq("id", user.id)
            .is("trial_ends_at", null);
          if (stampError) {
            logStep("ERROR stamping profile trial_ends_at", { message: stampError.message });
          }
        }
      }

      logBranch(resolved.active ? "profile_trial_active" : "profile_trial_expired", {
        orgId,
        planType,
        trialEndsAt: resolved.trialEndIso,
        stampMissing: resolved.stampMissing,
      });

      if (resolved.active && resolved.trialEndIso) {
        // The embed can omit plan_type, so a read of null used to update
        // only rows that were actually null and leave a stored "free" in place.
        // Match either stored value. Never touch basic/pro/custom/lifetime.
        if (orgId && (planType == null || planType === "" || planType === "free")) {
          const { error: planError } = await supabaseClient
            .from("organizations")
            .update({ plan_type: "trial" })
            .eq("id", orgId)
            .or("plan_type.is.null,plan_type.eq.free");
          if (planError) logStep("ERROR setting plan_type trial", { message: planError.message });
        }
        return new Response(JSON.stringify({
          stripe_mode: stripeMode,
          subscribed: true,
          trial_active: true,
          trial_end: resolved.trialEndIso,
          product_id: "org_trial",
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      if (planType === "trial" || mayStampTrial) {
        return new Response(JSON.stringify({
          stripe_mode: stripeMode,
          subscribed: false,
          trial_active: false,
          trial_end: resolved.trialEndIso,
          product_id: null,
          message: "Your free trial has ended. Subscribe to keep using TidyWise.",
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }
    }


    const orgCreatedAt = orgData?.created_at;

    if (!orgCreatedAt) {
      logBranch("organization_created_at_missing_access_denied", { orgId: membership.organization_id });
      return new Response(JSON.stringify({ stripe_mode: stripeMode,
        subscribed: false,
        trial_active: false,
        product_id: null,
        subscription_end: null,
        trial_end: null,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const orgCreatedMs = Date.parse(orgCreatedAt);
    const trialEndMs = orgCreatedMs + (TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
    const trialEndIso = new Date(trialEndMs).toISOString();
    const now = Date.now();
    const isWithinTrial = now < trialEndMs;

    logBranch("organization_trial_evaluated", {
      orgId: membership.organization_id,
      orgCreatedAt,
      trialEndIso,
      isWithinTrial,
      daysRemaining: isWithinTrial ? Math.ceil((trialEndMs - now) / (1000 * 60 * 60 * 24)) : 0,
    });

    // Orgs created on or after 2026-04-06 do NOT get a free auto-trial.
    // They must subscribe (pay) to get full access.
    const TRIAL_CUTOFF_DATE = "2026-04-06T00:00:00Z";
    const orgCreatedAfterCutoff = orgCreatedAt >= TRIAL_CUTOFF_DATE;

    if (isWithinTrial && !orgCreatedAfterCutoff) {
      logBranch("organization_trial_access_granted", {
        orgId: membership.organization_id,
        trialEnd: trialEndIso,
      });
      return new Response(JSON.stringify({ stripe_mode: stripeMode,
        subscribed: true,
        trial_active: true,
        product_id: "org_trial",
        subscription_end: null,
        trial_end: trialEndIso,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Trial has ended — must subscribe
    logBranch("organization_trial_access_denied", {
      orgId: membership.organization_id,
      isWithinTrial,
      orgCreatedAfterCutoff,
      trialEnd: trialEndIso,
    });
    return new Response(JSON.stringify({ stripe_mode: stripeMode,
      subscribed: false,
      trial_active: false,
      product_id: null,
      subscription_end: null,
      trial_end: trialEndIso,
      message: "Your 30-day money-back guarantee has ended. Please subscribe to continue.",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in check-subscription", { message: errorMessage });
    if (error instanceof StripeTimeoutError) {
      // Stripe did not answer inside the deadline. Reply with a real JSON body
      // instead of letting the gateway 504: the frontend needs
      // subscribed:false plus a machine-readable reason, not a missing response.
      logStep("BRANCH stripe_timeout_access_denied", { message: errorMessage });
      return new Response(JSON.stringify({
        stripe_mode: stripeMode,
        subscribed: false,
        trial_active: false,
        product_id: null,
        subscription_end: null,
        trial_end: null,
        error: "stripe_timeout",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    return new Response(JSON.stringify({ stripe_mode: stripeMode, error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

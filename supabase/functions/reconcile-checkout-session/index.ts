// Synchronously reconcile a Stripe Checkout session.
//
// Why this exists:
//   The Stripe webhook is the authoritative provisioner, but webhook
//   delivery can lag 5–60s (sometimes longer). During that window a
//   freshly-paid customer can hit AdminRoute / check-subscription and
//   get bounced to /pricing because their org isn't flagged yet. This
//   function lets the CheckoutSuccessPage pull the session directly
//   from Stripe and provision access immediately for ALL paid plans
//   (Lifetime, Basic, Pro, Custom) — fully idempotent, safe to run
//   before/after the webhook fires.
//
// Inputs: { session_id: string }
// Outputs: { ok, provisioned, plan, email, hasAccount }
//
// verify_jwt = false: anonymous-checkout buyers don't have a session
// when they land; their access is unblocked the moment they click the
// invite email. Authenticated buyers also call it, but we don't trust
// their JWT here — Stripe is the source of truth for the purchase.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { platformAdminPhones } from "../_shared/platform-admin-phones.ts";
import { billingSecretKey } from "../_shared/billing-stripe.ts";
import { sendOpenPhoneMessage, TIDYWISE_PLATFORM_ORG_ID } from "../_shared/send-sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const log = (msg: string, extra?: unknown) =>
  console.log(`[reconcile-checkout-session] ${msg}`, extra ?? "");

const ADMIN_PHONES = platformAdminPhones();

async function alertAdmin(reason: string, details: Record<string, unknown>): Promise<void> {
  try {
    const apiKey = Deno.env.get("OPENPHONE_API_KEY");
    const numberId = Deno.env.get("OPENPHONE_PHONE_NUMBER_ID");
    if (!apiKey || !numberId) {
      console.error("[reconcile-checkout-session] alertAdmin: OpenPhone not configured, alert not sent:", reason, details);
      return;
    }
    const message =
      `⚠️ CHECKOUT RECONCILE FAILED\n\n${reason}\n\n` +
      Object.entries(details).map(([k, v]) => `${k}: ${v}`).join("\n") +
      `\n\nCustomer may be paid but not provisioned — needs manual check.`;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    for (const phone of ADMIN_PHONES) {
      const sent = await sendOpenPhoneMessage({
        supabase,
        organizationId: TIDYWISE_PLATFORM_ORG_ID,
        to: phone,
        content: message,
        from: numberId,
        apiKey,
        tag: "reconcile-checkout-session",
      });
      if (sent.skipped) continue;
      if (!sent.response.ok) {
        console.error(
          "[reconcile-checkout-session] alertAdmin: OpenPhone send failed:",
          sent.response.status,
          await sent.response.text(),
        );
      }
    }
  } catch (e) {
    console.error("[reconcile-checkout-session] alertAdmin threw:", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { session_id } = await req.json().catch(() => ({ session_id: null }));
    if (!session_id || typeof session_id !== "string" || !session_id.startsWith("cs_")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid session_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const stripeKey = billingSecretKey();
    if (!stripeKey) throw new Error("STRIPE_BILLING_SECRET_KEY is not set");

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (!session) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only act on paid sessions. Subscriptions count as "paid" once
    // status flips to active/trialing OR the session is complete.
    const paid =
      session.payment_status === "paid" ||
      session.payment_status === "no_payment_required" ||
      session.status === "complete";
    if (!paid) {
      log("session not paid yet", { id: session.id, status: session.payment_status });
      return new Response(
        JSON.stringify({ ok: true, provisioned: false, reason: "not_paid" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const plan = (session.metadata?.plan as string | undefined) ?? "unknown";
    const email = (
      session.customer_details?.email ??
      session.customer_email ??
      (session.metadata?.email as string | undefined) ??
      ""
    ).toLowerCase() || null;

    let userId: string | null =
      (session.metadata?.user_id as string | undefined) ||
      (session.metadata?.account_id as string | undefined) ||
      null;

    // Resolve user by email if metadata didn't carry an id
    if (!userId && email) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .ilike("email", email)
        .maybeSingle();
      if (profile?.id) userId = profile.id;
    }

    // Provision a brand-new account if needed (anonymous checkout for
    // any paid plan — Lifetime/Basic/Pro/Custom). The invite email
    // doubles as the "set your password" link.
    const fullName = session.customer_details?.name ?? null;
    let isNewAccount = false;
    // Set when a write in the critical paid-access chain fails so the
    // final response can honestly report provisioned:false instead of
    // claiming success for a customer who actually can't get in.
    let provisioningError: string | null = null;
    const ensureAccount = async (planTypeForNewOrg: string) => {
      if (userId || !email) return;
      try {
        const appUrl = Deno.env.get("APP_URL") || "https://jointidywise.com";
        const nextUrl = `/dashboard`;
        const inviteUrl = `${appUrl}/set-password?next=${encodeURIComponent(nextUrl)}`;
        const { data: invited, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(
          email,
          {
            redirectTo: inviteUrl,
            data: fullName ? { full_name: fullName } : undefined,
          },
        );
        const inviteErrMsg = inviteErr?.message?.toLowerCase() ?? "";
        const alreadyRegistered =
          inviteErr && (
            inviteErrMsg.includes("already") ||
            inviteErrMsg.includes("registered") ||
            inviteErrMsg.includes("exists")
          );
        if (alreadyRegistered) {
          try {
            const { data: existing } = await (supabase.auth.admin as unknown as {
              getUserByEmail: (e: string) => Promise<{ data: { user?: { id: string } | null } }>
            }).getUserByEmail(email);
            if (existing?.user?.id) userId = existing.user.id;
          } catch (e) {
            console.error("[reconcile] getUserByEmail failed:", e);
          }
        } else if (!inviteErr && invited?.user?.id) {
          userId = invited.user.id;
          isNewAccount = true;
          const { error: profileErr } = await supabase.from("profiles").insert({
            id: userId,
            email,
            full_name: fullName,
          });
          if (profileErr) {
            console.error("[reconcile] profiles insert failed for a paid new account:", profileErr);
            provisioningError = "profile_insert_failed";
            await alertAdmin("profiles insert failed for a paid new account", {
              email, userId, sessionId: session.id, error: profileErr.message,
            });
          }
          const orgName = fullName ? `${fullName}'s Business` : "My Cleaning Business";
          const { data: newOrg, error: orgErr } = await supabase
            .from("organizations")
            .insert({ name: orgName, plan_type: planTypeForNewOrg })
            .select("id")
            .single();
          if (orgErr || !newOrg?.id) {
            console.error("[reconcile] organizations insert failed for a paid new account:", orgErr);
            provisioningError = "organization_insert_failed";
            await alertAdmin("organizations insert failed for a paid new account", {
              email, userId, sessionId: session.id, error: orgErr?.message ?? "no row returned",
            });
          } else {
            // org_memberships is the actual access gate — retry once
            // before giving up, since the webhook does not repair a
            // missing membership row for an org that already exists.
            let membershipOk = false;
            let lastMemErr: string | undefined;
            for (let attempt = 1; attempt <= 2 && !membershipOk; attempt++) {
              const { error: memErr } = await supabase.from("org_memberships").insert({
                organization_id: newOrg.id,
                user_id: userId,
                role: "owner",
              });
              if (!memErr) {
                membershipOk = true;
              } else {
                lastMemErr = memErr.message;
                console.error(`[reconcile] org_memberships insert failed (attempt ${attempt}/2):`, memErr);
              }
            }
            if (membershipOk) {
              log("provisioned new account", { userId, orgId: newOrg.id, plan: planTypeForNewOrg });
            } else {
              provisioningError = "org_membership_insert_failed";
              await alertAdmin("org_memberships insert failed twice — customer paid but cannot access their org", {
                email, userId, orgId: newOrg.id, sessionId: session.id, error: lastMemErr,
              });
            }
          }
          // Fire-and-forget welcome email (with "Book a demo" CTA) for
          // every brand-new account provisioned via Stripe checkout.
          // The set-password invite goes out separately via Supabase Auth.
          try {
            await supabase.functions.invoke("send-welcome-email", {
              body: { email, fullName, userId },
            });
          } catch (welcomeErr) {
            console.error("[reconcile] send-welcome-email failed:", welcomeErr);
          }
        } else if (inviteErr) {
          console.error("[reconcile] inviteUserByEmail failed:", inviteErr);
        }
      } catch (e) {
        console.error("[reconcile] account provisioning error:", e);
      }
    };

    const getOrgId = async (): Promise<string | null> => {
      if (!userId) return null;
      const { data: mem } = await supabase
        .from("org_memberships")
        .select("organization_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      return mem?.organization_id ?? null;
    };

    // ── Lifetime branch ────────────────────────────────────────────────
    if (plan === "lifetime") {
      if (!email) {
        return new Response(JSON.stringify({ error: "No email on session" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await ensureAccount("lifetime");

      const { error: purchaseErr } = await supabase
        .from("lifetime_access_purchases")
        .upsert(
          {
            email,
            user_id: userId,
            stripe_session_id: session.id,
            stripe_payment_intent_id: (session.payment_intent as string) || null,
            amount_cents: session.amount_total ?? 30000,
          },
          { onConflict: "stripe_session_id", ignoreDuplicates: true },
        );
      if (purchaseErr) {
        console.error("[reconcile] lifetime_access_purchases upsert failed:", purchaseErr);
        provisioningError = provisioningError ?? "lifetime_purchase_record_failed";
        await alertAdmin("lifetime_access_purchases upsert failed — payment record not saved", {
          email, userId, sessionId: session.id, error: purchaseErr.message,
        });
      }

      const orgId = await getOrgId();
      if (orgId) {
        // NOTE: do NOT set grandfathered_lifetime here. That flag is
        // reserved for original launch/founder users.
        const { error: planErr } = await supabase
          .from("organizations")
          .update({ plan_type: "lifetime" })
          .eq("id", orgId);
        if (planErr) {
          console.error("[reconcile] organizations.plan_type update failed (lifetime):", planErr);
          provisioningError = "plan_type_update_failed";
          await alertAdmin("organizations.plan_type update to lifetime failed — customer paid but paywall still up", {
            email, userId, orgId, sessionId: session.id, error: planErr.message,
          });
        }
        const { error: linkErr } = await supabase
          .from("lifetime_access_purchases")
          .update({ organization_id: orgId })
          .eq("stripe_session_id", session.id);
        if (linkErr) {
          console.error("[reconcile] lifetime_access_purchases org link update failed:", linkErr);
          await alertAdmin("lifetime_access_purchases org link update failed", {
            email, userId, orgId, sessionId: session.id, error: linkErr.message,
          });
        }
        const { error: subErr } = await supabase.from("stripe_subscriptions").upsert(
          {
            organization_id: orgId,
            stripe_subscription_id: `lifetime_${session.id}`,
            stripe_customer_id: (session.customer as string) || null,
            status: "active",
            plan: "lifetime",
            current_period_end: null,
          },
          { onConflict: "stripe_subscription_id", ignoreDuplicates: true },
        );
        if (subErr) {
          console.error("[reconcile] stripe_subscriptions upsert failed (lifetime):", subErr);
          await alertAdmin("stripe_subscriptions upsert failed (lifetime)", {
            email, userId, orgId, sessionId: session.id, error: subErr.message,
          });
        }
      } else if (!provisioningError) {
        // ensureAccount reported no error but we still couldn't resolve
        // an org — treat as a provisioning failure rather than silently
        // returning provisioned:true with no org actually set up.
        provisioningError = "no_org_resolved";
        await alertAdmin("lifetime checkout reconciled with no resolvable org", {
          email, userId, sessionId: session.id,
        });
      }

      try { await supabase.rpc("claim_lifetime_spot"); } catch (_) { /* ignored */ }

      log("lifetime reconciled", { email, userId, isNewAccount, provisioningError });
      return new Response(
        JSON.stringify({
          ok: !provisioningError,
          provisioned: !provisioningError,
          plan: "lifetime",
          email,
          hasAccount: !!userId,
          isNewAccount,
          ...(provisioningError ? { error: provisioningError } : {}),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Subscription branch (Basic / Pro / Custom / Standard) ──────────
    if (session.mode === "subscription" && session.subscription) {
      const planFromMetadata = session.metadata?.tidywise_plan as string | undefined;
      const targetPlanType =
        planFromMetadata && ["basic", "pro", "custom"].includes(planFromMetadata)
          ? planFromMetadata
          : (plan && ["basic", "pro", "custom"].includes(plan) ? plan : "standard");

      if (!email) {
        log("subscription session has no email — skipping provisioning");
        return new Response(
          JSON.stringify({ ok: true, provisioned: false, plan: targetPlanType, reason: "no_email" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      await ensureAccount(targetPlanType);

      const orgId = await getOrgId();
      if (orgId) {
        // Always set the org's plan_type so feature gates open
        // immediately — even if the org already existed.
        const { error: planErr } = await supabase
          .from("organizations")
          .update({ plan_type: targetPlanType })
          .eq("id", orgId);
        if (planErr) {
          console.error("[reconcile] organizations.plan_type update failed (subscription):", planErr);
          provisioningError = "plan_type_update_failed";
          await alertAdmin("organizations.plan_type update failed — customer paid but paywall still up", {
            email, userId, orgId, sessionId: session.id, plan: targetPlanType, error: planErr.message,
          });
        }

        // Mirror the live Stripe subscription into stripe_subscriptions
        // so the paywall opens before the webhook arrives.
        try {
          const stripeSubId = typeof session.subscription === "string"
            ? session.subscription
            : (session.subscription as { id?: string })?.id;
          if (stripeSubId) {
            const fullSub = await stripe.subscriptions.retrieve(stripeSubId);
            const currentPeriodEnd = fullSub.current_period_end
              ? new Date(fullSub.current_period_end * 1000).toISOString()
              : null;
            const { error: subErr } = await supabase.from("stripe_subscriptions").upsert(
              {
                organization_id: orgId,
                stripe_subscription_id: fullSub.id,
                stripe_customer_id: (fullSub.customer as string) || null,
                status: fullSub.status,
                plan: targetPlanType,
                current_period_end: currentPeriodEnd,
              },
              { onConflict: "stripe_subscription_id", ignoreDuplicates: false },
            );
            if (subErr) {
              console.error("[reconcile] stripe_subscriptions upsert failed (subscription):", subErr);
              await alertAdmin("stripe_subscriptions upsert failed (subscription)", {
                email, userId, orgId, sessionId: session.id, error: subErr.message,
              });
            }
          }
        } catch (mirrorErr) {
          console.error("[reconcile] mirror sub failed:", mirrorErr);
          await alertAdmin("stripe subscription mirror threw", {
            email, userId, orgId, sessionId: session.id,
            error: mirrorErr instanceof Error ? mirrorErr.message : String(mirrorErr),
          });
        }
      } else if (!provisioningError) {
        provisioningError = "no_org_resolved";
        await alertAdmin("subscription checkout reconciled with no resolvable org", {
          email, userId, sessionId: session.id, plan: targetPlanType,
        });
      }

      log("subscription reconciled", { email, userId, plan: targetPlanType, isNewAccount, provisioningError });
      return new Response(
        JSON.stringify({
          ok: !provisioningError,
          provisioned: !provisioningError,
          plan: targetPlanType,
          email,
          hasAccount: !!userId,
          isNewAccount,
          ...(provisioningError ? { error: provisioningError } : {}),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    log("session ack'd (no provisioning needed)", { plan, email });
    return new Response(
      JSON.stringify({
        ok: true,
        provisioned: false,
        plan,
        email,
        hasAccount: !!userId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[reconcile-checkout-session] error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

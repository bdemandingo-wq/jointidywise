import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { REFUND_POLICY, CANCELLATION_POLICY, POLICY_DISCLOSURE, TOS_VERSION } from "../_shared/policies.ts";
import { rejectReason, isVested } from "../_shared/referral-eligibility.ts";
import { recordReferralInvoicePaid, recordReferralReversal, type BalanceClient } from "../_shared/saas-referral-db.ts";
import { platformAdminPhone } from "../_shared/platform-admin-phones.ts";
import { verifyStripeWebhook } from "../_shared/billing-stripe.ts";
import { LIFETIME_SPOT_CAP } from "../_shared/lifetime-cap.ts";
import {
  cascadeCancelAdSubscriptionsIfDowngraded,
  downgradeOrgOnSubscriptionDeleted,
  subscriptionDeletedPlanFailure,
} from "../_shared/subscription-deleted-plan.ts";
import {
  classifySaasRefund,
  escapeIlikeExact,
  guardedBillingWrite,
  invoiceIdOf,
  isMissingBillingColumn,
  isMissingRelation,
  laterBillingEventAt,
  saasRefundDrafts,
  saasRefundInsertRows,
  unitemizedRefundId,
  subscriptionIdFromInvoice,
  shouldWriteSubscriptionState,
  subscriptionDeleteShouldDowngrade,
  stripeSubscriptionBillingPatch,
  subscriptionBillingSnapshot,
  subscriptionPersistHttpStatus,
  subscriptionPersistReleasesIdempotency,
  subscriptionStateFields,
  type SubscriptionPersistOutcome,
} from "../_shared/subscription-billing-snapshot.ts";

/**
 * Count a redeemed referral month.
 *
 * Fires when a subscription invoice settles at $0 against the 100% referral
 * coupon currently recorded in `org_referral_credits.active_coupon_id`.
 *
 * IDEMPOTENT BY INSERT, NOT BY INCREMENT: the invoice id is the primary key of
 * `org_referral_redemptions`, so a Stripe redelivery of the same invoice hits a
 * 23505 and the increment is skipped. Never blind-increments.
 */
async function countReferralRedemption(supabase: any, inv: any) {
  try {
    if (!inv.subscription || (inv.amount_paid ?? 0) !== 0) return;

    const discountCoupons: string[] = [
      ...((inv.discounts ?? []) as any[]).map((d: any) => (typeof d === "string" ? null : d?.coupon?.id)),
      (inv.discount as any)?.coupon?.id ?? null,
    ].filter(Boolean) as string[];
    if (discountCoupons.length === 0) return;

    const { data: subRow } = await supabase
      .from("stripe_subscriptions")
      .select("organization_id")
      .eq("stripe_subscription_id", inv.subscription as string)
      .maybeSingle();
    const orgId = subRow?.organization_id;
    if (!orgId) return;

    const { data: credits } = await supabase
      .from("org_referral_credits")
      .select("months_redeemed, active_coupon_id")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!credits?.active_coupon_id) return;
    if (!discountCoupons.includes(credits.active_coupon_id)) return;

    const { error: dupeError } = await supabase.from("org_referral_redemptions").insert({
      stripe_invoice_id: inv.id,
      organization_id: orgId,
      coupon_id: credits.active_coupon_id,
    });
    if (dupeError) {
      if ((dupeError as any).code === "23505") {
        console.log("[referral] redemption already counted for", inv.id);
      } else {
        console.error("[referral] redemption ledger insert failed", dupeError);
      }
      return;
    }

    await supabase
      .from("org_referral_credits")
      .update({
        months_redeemed: (credits.months_redeemed ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", orgId);
    console.log("[referral] redemption counted for", inv.id, orgId);
  } catch (e) {
    console.error("[referral] redemption counting failed (swallowed):", e);
  }
}


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

// Platform admin phone for notifications. Historical recipient was the
// second founder number; PLATFORM_ADMIN_PHONES overrides both.
const PLATFORM_ADMIN_PHONE = platformAdminPhone("secondary");

// Fire-and-forget Zapier dispatch. Never throws into the webhook flow.
async function fireZapier(
  supabase: any,
  orgId: string | null | undefined,
  invoiceId: string | undefined,
  stripeRef: string,
) {
  if (!orgId || !invoiceId) return;
  try {
    const { data: invoice } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .maybeSingle();
    await supabase.functions.invoke("zapier-dispatch", {
      headers: { "x-internal-secret": Deno.env.get("ZAPIER_DISPATCH_INTERNAL_SECRET") ?? "" },
      body: {
        organization_id: orgId,
        event_type: "invoice.paid",
        payload: { invoice, stripe_reference: stripeRef },
      },
    });
  } catch (e) {
    console.error("[stripe-invoice-webhook] zapier dispatch failed:", e);
  }
}

/**
 * STRIPE INVOICE WEBHOOK
 * 
 * This webhook handles Stripe events for invoice payments and new subscriptions.
 * When a new subscription is created, it notifies the platform admin via SMS.
 */
const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    // Either account may post here. The secret that verifies the body
    // chooses the Stripe client for every later API call in this request.
    // STRIPE_WEBHOOK_SECRET is the Connect platform. STRIPE_BILLING_WEBHOOK_SECRET
    // is TidyWise's own billing account. Fail closed if neither is set.
    if (!signature) {
      return new Response(
        JSON.stringify({ error: "Missing stripe-signature header" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    let event: Stripe.Event;
    let stripe: Stripe;
    let stripeAccount: "connect" | "billing";
    try {
      const verified = await verifyStripeWebhook(body, signature);
      event = verified.event;
      stripe = verified.stripe;
      stripeAccount = verified.account;
    } catch (err: any) {
      const message = err?.message || "Webhook signature verification failed";
      const status = message === "Webhook secret not configured" ? 500 : 400;
      console.error("[stripe-invoice-webhook]", message);
      return new Response(
        JSON.stringify({ error: message }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[stripe-invoice-webhook] Received Stripe event:", event.type, event.id, stripeAccount);

    // ── IDEMPOTENCY CHECK ───────────────────────────────────────────────────
    // Stripe may retry events; ensure we only process each event once.
    if (event.id) {
      const { error: idempotencyError } = await supabase
        .from("stripe_webhook_events")
        .insert({
          event_id: event.id,
          event_type: event.type,
          source: "stripe-invoice-webhook",
        });

      if (idempotencyError) {
        // Duplicate key violation = already processed
        if (idempotencyError.code === "23505") {
          console.log("[stripe-invoice-webhook] Event already processed, skipping:", event.id);
          return new Response(
            JSON.stringify({ received: true, duplicate: true }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // ANY other DB error means we can't guarantee single-execution
        // semantics. Returning 500 makes Stripe retry the delivery,
        // which is exactly what we want — better than silently
        // double-processing (eg two inviteUserByEmail calls → two
        // welcome emails to the same buyer).
        console.error("[stripe-invoice-webhook] Idempotency insert failed, refusing to process:", idempotencyError);
        return new Response(
          JSON.stringify({ error: "Idempotency lookup failed; Stripe will retry." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Extract organization_id from event metadata if available
    let organizationId: string | null = null;
    // A failed stripe_subscriptions / plan write must not acknowledge the
    // event. The flag is checked once, after every event branch.
    let subscriptionStateFailed = false;

    // Handle new subscription created - notify platform admin
    if (event.type === "customer.subscription.created") {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const subMeta = (subscription.metadata ?? {}) as Record<string, string>;

      console.log("[stripe-invoice-webhook] New subscription created:", subscription.id);

      // ── Ad-management retainer subscription ──────────────────────────
      // Distinct from the main TidyWise plan: metadata.purpose set by
      // buy-ad-management identifies these so we can record them in
      // ad_management_subscriptions for the cascade-cancel logic.
      if (subMeta.purpose === "tidywise_ad_management" && subMeta.organization_id) {
        try {
          const platform = subMeta.ad_platform;
          const userId = subMeta.account_id || null;
          const priceId = subscription.items.data[0]?.price?.id ?? null;
          const monthlyAmount =
            subscription.items.data[0]?.price?.unit_amount ?? 40000;

          const { error: adSubErr } = await supabase.from("ad_management_subscriptions").upsert(
            {
              organization_id: subMeta.organization_id,
              user_id: userId,
              platform,
              stripe_subscription_id: subscription.id,
              stripe_customer_id: customerId,
              stripe_price_id: priceId,
              status: "active",
              monthly_amount_cents: monthlyAmount,
            },
            { onConflict: "stripe_subscription_id", ignoreDuplicates: false },
          );

          if (adSubErr) {
            // The customer HAS been charged by Stripe at this point — this
            // is a real, paid subscription with no local record, meaning
            // the cascade-cancel-on-plan-churn safety net silently won't
            // find it either. Alert loudly rather than log-and-forget so
            // a human reconciles it, since a retry won't fix a schema
            // problem and Stripe will eventually stop retrying anyway.
            console.error(
              "[stripe-invoice-webhook] CRITICAL: ad-management subscription charged but NOT recorded (upsert failed):",
              { stripeSubscriptionId: subscription.id, platform, organizationId: subMeta.organization_id, error: adSubErr },
            );
            await sendAdminNotification(supabaseUrl, supabaseServiceKey, {
              organizationName: "Ad Management — RECORDING FAILED",
              ownerEmail: subMeta.email || "unknown",
              subscriptionType: `ALERT: customer charged for ${platform} ($${(monthlyAmount / 100).toFixed(0)}/mo, stripe_subscription_id=${subscription.id}) but ad_management_subscriptions upsert failed — needs manual reconciliation.`,
            }).catch((notifyErr) => {
              console.error("[stripe-invoice-webhook] admin failure-alert itself failed to send:", notifyErr);
            });
          } else {
            console.log(
              "[stripe-invoice-webhook] Ad mgmt sub recorded:",
              subscription.id,
              platform,
            );

            await sendAdminNotification(supabaseUrl, supabaseServiceKey, {
              organizationName: "Ad Management",
              ownerEmail: subMeta.email || "unknown",
              subscriptionType: `New ad-mgmt subscription: ${platform} ($${(monthlyAmount / 100).toFixed(0)}/mo)`,
            }).catch((notifyErr) => {
              console.error("[stripe-invoice-webhook] admin notification failed to send:", notifyErr);
            });
          }
        } catch (e) {
          console.error("[stripe-invoice-webhook] ad mgmt record failed:", e);
        }
        // Skip the rest of customer.subscription.created handling for
        // ad-mgmt subs — they're not the main TidyWise plan and don't
        // need the new-org admin SMS / Make webhook below.
        return new Response(JSON.stringify({ received: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Mirror this subscription into stripe_subscriptions so the org
      // immediately has an active row that the paywall gate can read.
      // If we can't resolve an org, log an orphan + admin SMS instead of
      // silently dropping (see jigdahifash incident).
      // The admin notice and confirmation email run only after this write
      // succeeds. A 500 retry must not send them again.
      let notifyAfterMirror = false;
      try {
        const resolved = await resolveOrgIdForSubscription(supabase, stripe, subscription);
        if (resolved.orgId) {
          const current = await readCurrentSaasSubscription(stripe, subscription.id);
          const outcome = await upsertStripeSubscription(
            supabase,
            resolved.orgId,
            current ?? subscription,
            event.created,
            current != null,
          );
          if (outcome === "failed") subscriptionStateFailed = true;
          else if (outcome === "wrote") notifyAfterMirror = true;
        } else {
          await logSubscriptionOrphan(
            supabase, supabaseUrl, supabaseServiceKey,
            subscription, event.id, event.type,
            resolved.customerEmail, resolved.attempts,
          );
        }
      } catch (mirrorErr) {
        console.error("[stripe-invoice-webhook] mirror to stripe_subscriptions failed:", mirrorErr);
        subscriptionStateFailed = true;
      }

      if (notifyAfterMirror) {
        try {
          const customer = await stripe.customers.retrieve(customerId);
          const email = (customer as Stripe.Customer).email || "Unknown";

          const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', email)
            .maybeSingle();

          let orgName = "New Business";
          if (profile?.id) {
            const { data: membership } = await supabase
              .from('org_memberships')
              .select('organization:organizations(name)')
              .eq('user_id', profile.id)
              .maybeSingle();

            if (membership?.organization) {
              const org = membership.organization as unknown as { name: string };
              if (org?.name) {
                orgName = org.name;
              }
            }
          }

          await sendAdminNotification(supabaseUrl, supabaseServiceKey, {
            organizationName: orgName,
            ownerEmail: email,
            subscriptionType: subscription.status === 'trialing' ? 'Trial Started' : 'Active',
          });

          try {
            const makeSubWebhookUrl = "https://hook.us2.make.com/1dcdsn08refadbtlbj1v1j8uxel4dwil";
            const profileData = await supabase
              .from('profiles')
              .select('full_name')
              .eq('email', email)
              .maybeSingle();

            await fetch(makeSubWebhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email,
                full_name: profileData?.data?.full_name || orgName,
                organization_name: orgName,
                subscription_status: subscription.status === 'trialing' ? 'Trial Started' : 'Active',
                subscribed_at: new Date().toISOString(),
              }),
            });
            console.log("[stripe-invoice-webhook] Make subscription confirmation webhook triggered");
          } catch (makeErr) {
            console.error("[stripe-invoice-webhook] Make webhook failed (non-critical):", makeErr);
          }
        } catch (notifyError) {
          console.error("[stripe-invoice-webhook] Failed to notify admin:", notifyError);
        }
      }
    }

    // Handle subscription updates (plan changes, renewals, cancellation
    // scheduled at period end, etc.) — keep stripe_subscriptions in sync
    // AND mirror the resolved plan into organizations.plan_type so the
    // app's feature gates respect the latest Stripe state.
    if (event.type === "customer.subscription.updated") {
      try {
        const subscription = event.data.object as Stripe.Subscription;
        const subMetaUpdate = (subscription.metadata ?? {}) as Record<string, string>;
        if (subMetaUpdate.purpose === "tidywise_ad_management") {
          return new Response(JSON.stringify({ received: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const resolved = await resolveOrgIdForSubscription(supabase, stripe, subscription);
        if (resolved.orgId) {
          const current = await readCurrentSaasSubscription(stripe, subscription.id);
          const outcome = await upsertStripeSubscription(
            supabase,
            resolved.orgId,
            current ?? subscription,
            event.created,
            current != null,
          );
          if (outcome === "failed") {
            subscriptionStateFailed = true;
          } else if (outcome === "wrote") {
            const synced = await syncOrgPlanFromSubscription(supabase, resolved.orgId, current ?? subscription);
            if (!synced) subscriptionStateFailed = true;
          }
        } else {
          await logSubscriptionOrphan(
            supabase, supabaseUrl, supabaseServiceKey,
            subscription, event.id, event.type,
            resolved.customerEmail, resolved.attempts,
          );
        }
      } catch (e) {
        console.error("[stripe-invoice-webhook] subscription.updated mirror error:", e);
        subscriptionStateFailed = true;
      }
    }

    // Handle checkout.session.completed event
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      
      console.log("[stripe-invoice-webhook] Checkout session completed:", session.id);
      console.log("[stripe-invoice-webhook] Session metadata:", session.metadata);

      organizationId = session.metadata?.organization_id || null;
      const invoiceId = session.metadata?.invoice_id;
      
      // Subscription checkout SMS and the Make email run after the mirror
      // further down. Sending them first meant a failed mirror released the
      // idempotency claim and the Stripe retry sent both again.

      // ── Lifetime access purchase ──────────────────────────────────────────
      if (session.mode === "payment" && session.metadata?.plan === "lifetime") {
        const email = (
          session.customer_details?.email ||
          session.customer_email ||
          (session.metadata?.email as string | undefined) ||
          ""
        ).toLowerCase();
        let userId: string | null =
          (session.metadata?.user_id as string | undefined) ||
          (session.metadata?.account_id as string | undefined) ||
          null;

        // Anonymous-checkout flow: no user_id in metadata (visitor wasn't
        // logged in). Look up by email; provision the account if it
        // doesn't exist yet.
        const lifetimeSignupFlow =
          (session.metadata?.signup_flow as string | undefined) || "legacy";
        if (!userId && email) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("id")
            .ilike("email", escapeIlikeExact(email))
            .maybeSingle();
          if (profile?.id) {
            userId = profile.id;
          } else if (lifetimeSignupFlow === "anonymous_checkout") {
            try {
              const fullName = session.customer_details?.name ?? null;
              const inviteUrl = `${Deno.env.get("APP_URL") || "https://jointidywise.com"}/checkout/success?from_invite=1`;
              const { data: invited, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(
                email,
                {
                  redirectTo: inviteUrl,
                  data: fullName ? { full_name: fullName } : undefined,
                },
              );
              if (inviteErr) {
                console.error("[stripe-invoice-webhook] lifetime invite failed:", inviteErr);
              } else if (invited?.user?.id) {
                userId = invited.user.id;
                await supabase.from("profiles").insert({
                  id: userId,
                  email,
                  full_name: fullName,
                });
                // Lifetime customers get grandfathered_lifetime=true so
                // they bypass all future feature gates — the "lifetime
                // = lifetime, forever" promise applies to paying
                // customers too, not just launch grandfathers.
                const orgName = fullName ? `${fullName}'s Business` : "My Cleaning Business";
                // NOTE: grandfathered_lifetime is reserved for original
                // launch/founder users — NOT for new lifetime buyers.
                // plan_type='lifetime' alone grants full access through
                // check-subscription; we don't tag new buyers as
                // grandfathered.
                const { data: newOrg } = await supabase
                  .from("organizations")
                  .insert({
                    name: orgName,
                    plan_type: "lifetime",
                  })
                  .select("id")
                  .single();
                if (newOrg?.id) {
                  await supabase.from("org_memberships").insert({
                    organization_id: newOrg.id,
                    user_id: userId,
                    role: "owner",
                  });
                  console.log(
                    "[stripe-invoice-webhook] Provisioned new lifetime account",
                    { userId, orgId: newOrg.id },
                  );
                }
              }
            } catch (inviteOuter) {
              console.error("[stripe-invoice-webhook] lifetime provisioning error:", inviteOuter);
            }
          }
        }

        console.log("[stripe-invoice-webhook] Lifetime purchase confirmed:", { email, userId });

        // Insert purchase record (idempotent via UNIQUE on stripe_session_id)
        const { error: insertError } = await supabase
          .from("lifetime_access_purchases")
          .upsert(
            {
              email,
              user_id: userId || null,
              stripe_session_id: session.id,
              stripe_payment_intent_id: session.payment_intent as string | null,
              // Pull amount from the session itself so price changes in
              // Stripe don't silently produce wrong records. Falls back
              // to $300 (the current lifetime price) if Stripe omits it.
              amount_cents: session.amount_total ?? 30000,
            },
            { onConflict: "stripe_session_id", ignoreDuplicates: true }
          );

        if (insertError) {
          console.error("[stripe-invoice-webhook] Failed to record lifetime purchase:", insertError);
          // Never let a bookkeeping failure block access provisioning.
          // Retry once with a plain insert (skips ON CONFLICT entirely),
          // then continue granting lifetime access regardless.
          const { error: retryError } = await supabase
            .from("lifetime_access_purchases")
            .insert({
              email,
              user_id: userId || null,
              stripe_session_id: session.id,
              stripe_payment_intent_id: session.payment_intent as string | null,
              amount_cents: session.amount_total ?? 30000,
            });
          if (retryError) {
            console.error("[stripe-invoice-webhook] Lifetime purchase retry failed:", retryError);
            try {
              await sendAdminNotification(supabaseUrl, supabaseServiceKey, {
                organizationName: "LIFETIME PURCHASE NOT RECORDED",
                ownerEmail: email,
                subscriptionType: `Paid lifetime session ${session.id} could not be saved: ${retryError.message}. Record it manually.`,
              });
            } catch (notifyErr) {
              console.error("[stripe-invoice-webhook] Lifetime failure alert failed:", notifyErr);
            }
          }
        } else {
          console.log("[stripe-invoice-webhook] Lifetime purchase recorded");
        }
        {


          // Update the organization's plan_type to 'lifetime'
          if (userId) {
            const { data: membership } = await supabase
              .from("org_memberships")
              .select("organization_id")
              .eq("user_id", userId)
              .limit(1)
              .maybeSingle();

            if (membership?.organization_id) {
              // Flip plan_type to 'lifetime'. Do NOT set
              // grandfathered_lifetime — that flag is reserved for
              // original launch/founder users only. plan_type='lifetime'
              // alone grants full access through check-subscription.
              await supabase
                .from("organizations")
                .update({
                  plan_type: "lifetime",
                })
                .eq("id", membership.organization_id);

              // Link purchase to org
              await supabase
                .from("lifetime_access_purchases")
                .update({ organization_id: membership.organization_id })
                .eq("stripe_session_id", session.id);

              // Mirror into stripe_subscriptions as a synthetic 'active'
              // row so any code path that still checks for an active
              // Stripe subscription (eg legacy gates or analytics
              // queries) sees lifetime customers as covered too. The
              // updated has_active_subscription() RPC also OR-matches
              // plan_type='lifetime' directly, so this is belt-and-
              // suspenders — but losing one doesn't lock the customer
              // out. Idempotent on stripe_subscription_id.
              await supabase.from("stripe_subscriptions").upsert(
                {
                  organization_id: membership.organization_id,
                  stripe_subscription_id: `lifetime_${session.id}`,
                  stripe_customer_id: (session.customer as string) || null,
                  status: "active",
                  plan: "lifetime",
                  current_period_end: null,
                },
                { onConflict: "stripe_subscription_id", ignoreDuplicates: true },
              );

              console.log("[stripe-invoice-webhook] Organization plan_type set to lifetime:", membership.organization_id);
            }
          }

          // ── Claim one lifetime spot (atomic) ─────────────────────────
          // claim_lifetime_spot() is a single-statement UPDATE; the
          // table's CHECK(sold_spots <= total_spots) raises when a
          // purchase past LIFETIME_SPOT_CAP tries to land. We catch
          // that and refund the unlucky-by-microseconds buyer.
          try {
            const { data: claimed, error: claimErr } = await supabase
              .rpc("claim_lifetime_spot");

            if (claimErr) {
              // Likely check_violation = oversold race lost.
              console.error(
                "[stripe-invoice-webhook] Lifetime oversold — refunding",
                claimErr.message,
              );
              if (session.payment_intent) {
                await stripe.refunds.create({
                  payment_intent: session.payment_intent as string,
                  reason: "duplicate",
                  metadata: { reason: "lifetime_oversold" },
                });
              }
              await sendAdminNotification(supabaseUrl, supabaseServiceKey, {
                organizationName: "LIFETIME OVERSOLD — refunded",
                ownerEmail: email,
                subscriptionType:
                  `Purchase past the ${LIFETIME_SPOT_CAP}-spot cap attempted, automatic refund issued. Reach out personally.`,
              });
            } else {
              const row = Array.isArray(claimed) ? claimed[0] : claimed;
              console.log(
                "[stripe-invoice-webhook] Lifetime spot claimed",
                row?.sold_spots,
                "/",
                row?.total_spots,
              );
              if (row?.sold_out) {
                console.log("[stripe-invoice-webhook] Lifetime is now SOLD OUT");
              }
            }
          } catch (counterE) {
            console.error("[stripe-invoice-webhook] counter update failed:", counterE);
          }

          // Notify platform admin
          await sendAdminNotification(supabaseUrl, supabaseServiceKey, {
            organizationName: "Lifetime Purchase",
            ownerEmail: email,
            subscriptionType: `Lifetime Access — $${((session.amount_total ?? 30000) / 100).toFixed(2)}`,
          });
        }
      }
      // ── Subscription checkout: anonymous (checkout-first) OR upgrade ──────
      else if (session.mode === "subscription" && session.subscription) {
        // /pricing flow goes straight to Stripe with no prior auth. The
        // visitor's email is collected by Stripe Checkout and stored on
        // session.customer_details.email. We provision (or upgrade) the
        // TidyWise account from this email here, after payment is
        // confirmed.
        const signupFlow = (session.metadata?.signup_flow as string | undefined) || "legacy";
        const planFromMetadata = (session.metadata?.tidywise_plan as string | undefined);
        const targetPlanType =
          planFromMetadata && ["basic", "pro", "custom"].includes(planFromMetadata)
            ? planFromMetadata
            : "standard";

        const checkoutEmail =
          (session.customer_details?.email || session.customer_email || (session.metadata?.email as string | undefined) || "")
            .toLowerCase();

        if (!checkoutEmail) {
          console.error("[stripe-invoice-webhook] Subscription checkout completed with no email");
        } else {
          // First check profiles by email — the common case for any user
          // who's signed up before. Profile rows are kept in sync with
          // auth.users via the existing signup flows, so a hit here means
          // the user exists and we can short-circuit straight to the
          // plan-update path.
          let userId: string | null = null;
          let isNewAccount = false;
          const { data: profile } = await supabase
            .from("profiles")
            .select("id")
            .ilike("email", escapeIlikeExact(checkoutEmail))
            .maybeSingle();
          if (profile?.id) {
            userId = profile.id;
          } else {
            // No profile → always try to provision. Previously this was
            // gated on signupFlow === "anonymous_checkout" which meant
            // any checkout with missing/wrong signupFlow metadata fell
            // through silently (jigdahifash incident — paid customer
            // never got a TidyWise account, sub orphaned).
            // inviteUserByEmail creates the auth user + sends a "set
            // your password" email. If the email already belongs to an
            // auth.users row (eg the profile row is missing but auth.users
            // is not), invite returns an error containing "already
            // registered" — we recover by looking up the existing user
            // via auth.admin.getUserByEmail (no pagination needed) and
            // then just upgrading their plan.
            //
            // The prior implementation paged through auth.admin.listUsers
            // with perPage:200, which silently missed any user beyond
            // page 1 — so once the project had >200 users, returning
            // customers got "already registered" errors and never had
            // their plan attached.
            try {
              const fullName = session.customer_details?.name ?? null;
              const inviteUrl = `${Deno.env.get("APP_URL") || "https://jointidywise.com"}/checkout/success?from_invite=1`;
              const { data: invited, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(
                checkoutEmail,
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
                // Look up the existing user directly — no pagination.
                try {
                  const { data: existing } = await (supabase.auth.admin as unknown as {
                    getUserByEmail: (e: string) => Promise<{ data: { user?: { id: string } | null } }>
                  }).getUserByEmail(checkoutEmail);
                  if (existing?.user?.id) {
                    userId = existing.user.id;
                  }
                } catch (lookupErr) {
                  console.error("[stripe-invoice-webhook] getUserByEmail failed:", lookupErr);
                }
              } else if (inviteErr) {
                console.error("[stripe-invoice-webhook] inviteUserByEmail failed:", inviteErr);
              } else if (invited?.user?.id) {
                userId = invited.user.id;
                isNewAccount = true;

                await supabase.from("profiles").insert({
                  id: userId,
                  email: checkoutEmail,
                  full_name: fullName,
                });

                const orgName = fullName ? `${fullName}'s Business` : "My Cleaning Business";
                const { data: newOrg, error: orgErr } = await supabase
                  .from("organizations")
                  .insert({ name: orgName, plan_type: targetPlanType })
                  .select("id")
                  .single();
                if (orgErr) {
                  console.error("[stripe-invoice-webhook] org insert failed:", orgErr);
                } else if (newOrg?.id) {
                  await supabase.from("org_memberships").insert({
                    organization_id: newOrg.id,
                    user_id: userId,
                    role: "owner",
                  });
                  console.log(
                    "[stripe-invoice-webhook] Provisioned new account from checkout",
                    { userId, orgId: newOrg.id, plan: targetPlanType },
                  );
                }
              }
            } catch (inviteOuter) {
              console.error("[stripe-invoice-webhook] account provisioning error:", inviteOuter);
            }
          }

          if (userId && !isNewAccount) {
            const { data: membership } = await supabase
              .from("org_memberships")
              .select("organization_id")
              .eq("user_id", userId)
              .limit(1)
              .maybeSingle();
            if (membership?.organization_id) {
              await supabase
                .from("organizations")
                .update({ plan_type: targetPlanType })
                .eq("id", membership.organization_id);
              console.log(
                "[stripe-invoice-webhook] Existing org plan updated",
                { orgId: membership.organization_id, plan: targetPlanType },
              );
            }
          }

          // Mirror the new/upgraded subscription into stripe_subscriptions
          // so the paywall gate opens immediately, without waiting for the
          // separate customer.subscription.created event. Admin SMS and the
          // Make email run only after this write succeeds.
          let checkoutMirrored = false;
          try {
            const stripeSubId = typeof session.subscription === "string"
              ? session.subscription
              : (session.subscription as any)?.id;
            if (stripeSubId) {
              const fullSub = await stripe.subscriptions.retrieve(stripeSubId);
              let orgId: string | null = null;
              if (userId) {
                const { data: mem } = await supabase
                  .from("org_memberships")
                  .select("organization_id")
                  .eq("user_id", userId)
                  .order("organization_id", { ascending: true })
                  .limit(1)
                  .maybeSingle();
                orgId = mem?.organization_id ?? null;
              }
              if (orgId) {
                const outcome = await upsertStripeSubscription(supabase, orgId, fullSub, event.created, true);
                if (outcome === "failed") subscriptionStateFailed = true;
                else if (outcome === "wrote") checkoutMirrored = true;
              }
            }
          } catch (mirrorErr) {
            console.error("[stripe-invoice-webhook] checkout mirror failed:", mirrorErr);
            subscriptionStateFailed = true;
          }

          if (checkoutMirrored) {
            try {
              const { data: profile } = await supabase
                .from("profiles")
                .select("id, full_name")
                .eq("email", checkoutEmail)
                .maybeSingle();

              let orgName = "New Business";
              if (profile?.id) {
                const { data: membership } = await supabase
                  .from("org_memberships")
                  .select("organization:organizations(name)")
                  .eq("user_id", profile.id)
                  .order("organization_id", { ascending: true })
                  .limit(1)
                  .maybeSingle();

                if (membership?.organization) {
                  const org = membership.organization as unknown as { name: string };
                  if (org?.name) orgName = org.name;
                }
              }

              await sendAdminNotification(supabaseUrl, supabaseServiceKey, {
                organizationName: orgName,
                ownerEmail: checkoutEmail,
                subscriptionType: "New Subscription",
              });

              try {
                const makeSubWebhookUrl = "https://hook.us2.make.com/1dcdsn08refadbtlbj1v1j8uxel4dwil";
                await fetch(makeSubWebhookUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    email: checkoutEmail,
                    full_name: profile?.full_name || orgName,
                    organization_name: orgName,
                    subscription_status: "New Subscription",
                    subscribed_at: new Date().toISOString(),
                  }),
                });
                console.log("[stripe-invoice-webhook] Make subscription confirmation webhook triggered (checkout)");
              } catch (makeErr) {
                console.error("[stripe-invoice-webhook] Make webhook failed (non-critical):", makeErr);
              }
            } catch (notifyError) {
              console.error("[stripe-invoice-webhook] Failed to notify admin on checkout:", notifyError);
            }
          }
        }
      }


      if (invoiceId) {
        // Update invoice status to paid
        const { error: updateError } = await supabase
          .from("invoices")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            stripe_payment_intent_id: session.payment_intent as string,
          })
          .eq("id", invoiceId);

        if (updateError) {
          console.error("[stripe-invoice-webhook] Failed to update invoice status:", updateError);
        } else {
          console.log("[stripe-invoice-webhook] Invoice marked as paid:", invoiceId);
          await fireZapier(supabase, organizationId, invoiceId, session.id);
        }
      }
    }

    // Handle invoice.paid event from Stripe Invoicing
    if (event.type === "invoice.paid") {
      const stripeInvoice = event.data.object as Stripe.Invoice;
      
      console.log("[stripe-invoice-webhook] Stripe invoice paid:", stripeInvoice.id);
      console.log("[stripe-invoice-webhook] Invoice metadata:", stripeInvoice.metadata);

      organizationId = stripeInvoice.metadata?.organization_id || null;
      const invoiceId = stripeInvoice.metadata?.invoice_id;
      
      if (invoiceId) {
        const { error: updateError } = await supabase
          .from("invoices")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            stripe_payment_intent_id: stripeInvoice.payment_intent as string,
          })
          .eq("id", invoiceId);

        if (updateError) {
          console.error("[stripe-invoice-webhook] Failed to update invoice status:", updateError);
        } else {
          console.log("[stripe-invoice-webhook] Invoice marked as paid:", invoiceId);
          await fireZapier(supabase, organizationId, invoiceId, stripeInvoice.id);
        }
      }
    }

    // Handle payment_intent.succeeded as fallback
    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      
      console.log("[stripe-invoice-webhook] Payment intent succeeded:", paymentIntent.id);
      console.log("[stripe-invoice-webhook] Payment metadata:", paymentIntent.metadata);

      organizationId = paymentIntent.metadata?.organization_id || null;
      const invoiceId = paymentIntent.metadata?.invoice_id;
      
      if (invoiceId) {
        const { error: updateError } = await supabase
          .from("invoices")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            stripe_payment_intent_id: paymentIntent.id,
          })
          .eq("id", invoiceId);

        if (updateError) {
          console.error("[stripe-invoice-webhook] Failed to update invoice status:", updateError);
        } else {
          console.log("[stripe-invoice-webhook] Invoice marked as paid:", invoiceId);

          // Send branded "thank you / receipt" email to the customer.
          // Fire-and-forget; never blocks the webhook ack.
          supabase.functions.invoke("notify-invoice-paid", {
            body: { invoice_id: invoiceId, organization_id: organizationId },
          }).catch((e) => console.error("[stripe-invoice-webhook] notify-invoice-paid failed:", e));

          await fireZapier(supabase, organizationId, invoiceId, paymentIntent.id);
        }
      }
    }

    // ── FRAUD-DEFENSE EVIDENCE CAPTURE (Visa CE 3.0 / reason 10.4) ──────────
    // For successful subscription charges, persist auth evidence and send a
    // branded receipt so the charge is recognizable. Gated on invoice.paid
    // only: Stripe sends both invoice.payment_succeeded AND invoice.paid
    // for the same renewal, with different event IDs. The webhook
    // idempotency check upstream is keyed on event_id so both events
    // pass through, which previously meant two evidence-capture passes,
    // two PI/charge retrieves, and two receipt emails per renewal.
    // invoice.paid is Stripe's recommended event for "this invoice is
    // confirmed paid"; invoice.payment_succeeded fires earlier and can
    // briefly precede a refund/dispute.
    if (event.type === "invoice.paid") {
      const inv = event.data.object as Stripe.Invoice;
      // Stripe API 2025-03-31+ (basil) moved invoice.subscription,
      // invoice.subscription_details and invoice.payment_intent under
      // invoice.parent / invoice.payments. Without this, every subscription
      // invoice looked like "not a subscription" and nothing below ran —
      // payment_evidence stayed empty and a fraud dispute had no evidence.
      // Normalise onto the legacy fields so the downstream code keeps working
      // under either payload shape.
      const invAny = inv as any;
      const parentSub = invAny.parent?.subscription_details ?? null;
      if (!invAny.subscription && parentSub?.subscription) {
        invAny.subscription = typeof parentSub.subscription === "string"
          ? parentSub.subscription
          : parentSub.subscription?.id ?? null;
      }
      if (!invAny.subscription_details && parentSub) invAny.subscription_details = parentSub;
      const meta = (inv.metadata || {}) as Record<string, string>;
      const subMeta = ((invAny.subscription_details?.metadata as any) || {}) as Record<string, string>;
      const combined = { ...subMeta, ...meta };

      if (combined.purpose === "tidywise_saas_subscription" || invAny.subscription) {
        try {
          if (!invAny.payment_intent && (inv.amount_paid ?? 0) > 0) {
            try {
              const full = await stripe.invoices.retrieve(inv.id, { expand: ["payments"] }) as any;
              const paid = (full.payments?.data ?? []).find((p: any) => p?.status === "paid") ?? full.payments?.data?.[0];
              const piRef = paid?.payment?.payment_intent;
              invAny.payment_intent = typeof piRef === "string" ? piRef : piRef?.id ?? null;
            } catch (e) {
              console.error("[stripe-invoice-webhook] invoice payments lookup failed:", e);
            }
          }
          const pi = invAny.payment_intent ? await stripe.paymentIntents.retrieve(invAny.payment_intent as string) : null;
          const charge = pi?.latest_charge ? await stripe.charges.retrieve(pi.latest_charge as string) : null;
          const threeDS = (charge?.payment_method_details as any)?.card?.three_d_secure?.result || null;

          // ── ORG-TO-ORG REFERRAL VESTING ─────────────────────────────────
          // Own try/catch: a referral bug must NEVER break receipt delivery or
          // the webhook acknowledgement back to Stripe.
          try {
            if (!inv.subscription) {
              // not a subscription invoice — nothing to vest
            } else if ((inv.amount_paid ?? 0) <= 0) {
              // A $0 trial invoice is not a payment. It MAY, however, be a
              // redemption of a 100% referral coupon — handled below.
              await countReferralRedemption(supabase, inv);
              console.log("[referral] skip vesting: zero-amount invoice", inv.id);
            } else {
              // Resolve the REFERRED organization.
              let referredOrgId: string | null = (combined.organization_id as string) || null;
              if (!referredOrgId) {
                const { data: subRow } = await supabase
                  .from("stripe_subscriptions")
                  .select("organization_id")
                  .eq("stripe_subscription_id", inv.subscription as string)
                  .maybeSingle();
                referredOrgId = subRow?.organization_id ?? null;
              }

              if (!referredOrgId) {
                console.log("[referral] skip: could not resolve organization for", inv.id);
              } else {
                const { data: referral } = await supabase
                  .from("org_referrals")
                  .select("id, status, referrer_org_id, referred_org_id, referred_first_payment_at, referred_card_fingerprint")
                  .eq("referred_org_id", referredOrgId)
                  .maybeSingle();

                if (!referral) {
                  // Common case: this org was not referred.
                } else if (referral.status === "rewarded" || referral.status === "rejected") {
                  console.log("[referral] skip: terminal status", referral.status);
                } else {
                  // COUNT ABSOLUTELY, NEVER INCREMENT. Stripe may redeliver a
                  // webhook; an increment would over-count and vest early, and
                  // would never recover from a missed delivery.
                  const paidInvoices = await stripe.invoices.list({
                    subscription: inv.subscription as string,
                    status: "paid",
                    limit: 100,
                  });
                  const paidCount = paidInvoices.data.filter((i: any) => (i.amount_paid ?? 0) > 0).length;

                  const patch: Record<string, unknown> = {
                    referred_paid_invoice_count: paidCount,
                  };
                  if (!referral.referred_first_payment_at && paidCount >= 1) {
                    patch.referred_first_payment_at = new Date().toISOString();
                  }

                  // First moment a card exists — record the fingerprint and
                  // re-run eligibility, which is why the card self-referral
                  // check lives here and not in claim-referral.
                  const fingerprint = (charge?.payment_method_details as any)?.card?.fingerprint ?? null;
                  if (fingerprint && !referral.referred_card_fingerprint) {
                    patch.referred_card_fingerprint = fingerprint;
                  }

                  const { data: orgs } = await supabase
                    .from("organizations")
                    .select("id, owner_id, plan_type")
                    .in("id", [referral.referrer_org_id, referral.referred_org_id]);
                  const referrerOrg = orgs?.find((o: any) => o.id === referral.referrer_org_id);
                  const referredOrg = orgs?.find((o: any) => o.id === referral.referred_org_id);

                  // The referrer's own card fingerprint: recorded on the
                  // referral where THEY were the referred party, if any.
                  const { data: referrerAsReferred } = await supabase
                    .from("org_referrals")
                    .select("referred_card_fingerprint")
                    .eq("referred_org_id", referral.referrer_org_id)
                    .not("referred_card_fingerprint", "is", null)
                    .order("updated_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();

                  const reason = referrerOrg && referredOrg
                    ? rejectReason(
                        {
                          orgId: referrerOrg.id,
                          ownerId: referrerOrg.owner_id,
                          planType: referrerOrg.plan_type ?? null,
                          cardFingerprint: referrerAsReferred?.referred_card_fingerprint ?? null,
                        },
                        {
                          orgId: referredOrg.id,
                          ownerId: referredOrg.owner_id,
                          planType: referredOrg.plan_type ?? null,
                          cardFingerprint: fingerprint ?? referral.referred_card_fingerprint ?? null,
                        },
                      )
                    : null;

                  if (reason) {
                    await supabase
                      .from("org_referrals")
                      .update({ ...patch, status: "rejected", rejection_reason: reason })
                      .eq("id", referral.id);
                    console.log("[referral] rejected at payment:", referral.id, reason);
                  } else {
                    if (isVested(paidCount) && referral.status === "pending") {
                      patch.status = "qualified";
                      patch.referred_second_payment_at = new Date().toISOString();
                    }
                    await supabase.from("org_referrals").update(patch).eq("id", referral.id);

                    if (patch.status === "qualified") {
                      console.log("[referral] vested:", referral.id, "paidCount", paidCount);
                      await supabase.functions
                        .invoke("grant-referral-reward", {
                          headers: { "x-cron-secret": Deno.env.get("CRON_SECRET") ?? "" },
                          body: { referral_id: referral.id },
                        })
                        .catch((e) => console.error("[referral] grant invoke failed", e));
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.error("[referral] vesting block failed (swallowed):", e);
          }

          // Org-owner referral programme: count the first invoice with
          // amount > 0, once, and apply or bank a free month per pair.
          try {
            const balance: BalanceClient = {
              createBalanceTransaction: (customerId, body, options) =>
                stripe.customers.createBalanceTransaction(customerId, body, {
                  idempotencyKey: options.idempotencyKey,
                }),
            };
            const subscriptionId = typeof invAny.subscription === "string"
              ? invAny.subscription
              : invAny.subscription?.id ?? null;
            const customerId = typeof inv.customer === "string"
              ? inv.customer
              : (inv.customer as { id?: string } | null)?.id ?? null;
            await recordReferralInvoicePaid(supabase, {
              invoiceId: inv.id,
              amountPaid: inv.amount_paid ?? 0,
              organizationId: (combined.organization_id as string) || null,
              subscriptionId,
              stripeCustomerId: customerId,
              chargeId: charge?.id ?? null,
              paidAt: new Date(((inv as any).status_transitions?.paid_at ?? event.created) * 1000).toISOString(),
              purpose: (combined.purpose as string) || null,
            }, balance);
          } catch (e) {
            console.error("[saas-referral] invoice.paid handler failed (swallowed):", e);
          }



          // Look up Supabase user by account_id metadata or customer email
          const customerEmail = inv.customer_email || (combined.email as string) || null;
          let userId: string | null = (combined.account_id as string) || null;
          let signupDate: string | null = (combined.signup_date as string) || null;
          let tosRow: any = null;
          if (userId) {
            const { data: tos } = await supabase
              .from("tos_acceptances")
              .select("accepted, tos_version, accepted_at")
              .eq("user_id", userId)
              .order("accepted_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            tosRow = tos;
          }

          const { error: evidenceErr } = await supabase.from("payment_evidence").upsert({
            user_id: userId,
            email: customerEmail || "",
            stripe_customer_id: inv.customer as string,
            stripe_payment_intent_id: (inv.payment_intent as string) || null,
            stripe_invoice_id: inv.id,
            stripe_subscription_id: (inv.subscription as string) || null,
            amount_cents: inv.amount_paid,
            currency: inv.currency,
            ip_address: combined.ip || null,
            user_agent: combined.device || null,
            device_fingerprint: combined.device_fingerprint || null,
            signup_date: signupDate,
            tos_accepted: tosRow?.accepted ?? null,
            tos_version: tosRow?.tos_version ?? null,
            tos_accepted_at: tosRow?.accepted_at ?? null,
            three_d_secure_status: threeDS,
            metadata: combined,
          }, { onConflict: "stripe_payment_intent_id" });

          if (evidenceErr) console.error("[stripe-invoice-webhook] payment_evidence upsert FAILED:", inv.id, evidenceErr);
          else console.log("[stripe-invoice-webhook] Payment evidence captured for", inv.id);

          // Branded receipt email. Yearly subscribers in particular need
          // a clear "next billing date" so they know when the renewal
          // hits — pass plan + interval through so the receipt can
          // render the right copy.
          if (customerEmail) {
            await supabase.functions.invoke("send-subscription-receipt", {
              body: {
                email: customerEmail,
                amount_cents: inv.amount_paid,
                currency: inv.currency,
                invoice_id: inv.id,
                hosted_invoice_url: inv.hosted_invoice_url,
                period_end: inv.period_end,
                plan: combined.tidywise_plan || null,
                interval: combined.tidywise_interval || null,
              },
            }).catch((e) => console.error("[stripe-invoice-webhook] receipt invoke failed", e));
          }

        } catch (e) {
          console.error("[stripe-invoice-webhook] evidence capture error (non-fatal):", e);
        }
      }
    }

    // A refund of the qualifying charge undoes the referral count when it
    // lands inside 30 days. The balance transaction is a debit of the credit
    // already given — it does not create a new charge.
    if (event.type === "charge.refunded") {
      const refundedCharge = event.data.object as Stripe.Charge;
      try {
        const balance: BalanceClient = {
          createBalanceTransaction: (customerId, body, options) =>
            stripe.customers.createBalanceTransaction(customerId, body, {
              idempotencyKey: options.idempotencyKey,
            }),
        };
        const refundInvoice = refundedCharge.invoice;
        await recordReferralReversal(supabase, {
          chargeId: refundedCharge.id,
          invoiceId: invoiceIdOf(refundInvoice),
          subscriptionId: subscriptionIdFromInvoice(refundInvoice),
          eventAt: new Date(event.created * 1000).toISOString(),
          reason: "refund",
        }, balance);
      } catch (e) {
        console.error("[saas-referral] refund reversal failed (swallowed):", e);
      }

      // Store the refund date for the account-metrics view. The charge
      // object is already on the event. A failed insert must not ack the
      // event: the idempotency row is released below so Stripe's retry
      // writes the refund.
      try {
        const saved = await persistSaasRefunds(supabase, stripe, refundedCharge, event.created, event.account);
        if (!saved) subscriptionStateFailed = true;
      } catch (e) {
        console.error("[stripe-invoice-webhook] saas refund persist failed:", e);
        subscriptionStateFailed = true;
      }
    }

    // ── DISPUTE / CHARGEBACK HANDLING (Visa CE 3.0, reason 10.4) ────────────
    if (event.type === "charge.dispute.created" || event.type === "charge.dispute.updated") {
      try {
        const dispute = event.data.object as Stripe.Dispute;

        const charge = await stripe.charges.retrieve(dispute.charge as string);

        if (event.type === "charge.dispute.created") {
          try {
            const balance: BalanceClient = {
              createBalanceTransaction: (customerId, body, options) =>
                stripe.customers.createBalanceTransaction(customerId, body, {
                  idempotencyKey: options.idempotencyKey,
                }),
            };
            await recordReferralReversal(supabase, {
              chargeId: typeof dispute.charge === "string" ? dispute.charge : charge.id,
              invoiceId: invoiceIdOf(charge.invoice),
              subscriptionId: subscriptionIdFromInvoice(charge.invoice),
              eventAt: new Date(event.created * 1000).toISOString(),
              reason: "dispute",
            }, balance);
          } catch (e) {
            console.error("[saas-referral] dispute reversal failed (swallowed):", e);
          }
        }
        const paymentIntentId = (charge.payment_intent as string) || null;
        const customerId = (charge.customer as string) || null;
        const customerEmail = charge.billing_details?.email || charge.receipt_email || null;
        const disputeCreatedSec = dispute.created;

        // Look up the disputed charge's stored evidence
        const { data: disputedEvidence } = await supabase
          .from("payment_evidence")
          .select("*")
          .eq("stripe_payment_intent_id", paymentIntentId || "")
          .maybeSingle();

        // Prior undisputed successful charges for this customer
        const { data: priors } = await supabase
          .from("payment_evidence")
          .select("*")
          .eq("stripe_customer_id", customerId || "")
          .neq("stripe_payment_intent_id", paymentIntentId || "__none__")
          .order("created_at", { ascending: false })
          .limit(50);

        // CE 3.0 window: 120-365 days BEFORE the dispute
        const disputeMs = disputeCreatedSec * 1000;
        const minMs = disputeMs - 365 * 24 * 60 * 60 * 1000;
        const maxMs = disputeMs - 120 * 24 * 60 * 60 * 1000;

        const matchElements = (a: any, b: any) => {
          const m: string[] = [];
          if (a?.email && b?.email && a.email === b.email) m.push("email");
          if (a?.ip_address && b?.ip_address && a.ip_address === b.ip_address) m.push("ip_address");
          if (a?.user_agent && b?.user_agent && a.user_agent === b.user_agent) m.push("device");
          if (a?.user_id && b?.user_id && a.user_id === b.user_id) m.push("account_id");
          if (a?.device_fingerprint && b?.device_fingerprint && a.device_fingerprint === b.device_fingerprint) m.push("device_fingerprint");
          return m;
        };

        const qualifying = (priors || [])
          .map((p: any) => {
            const createdMs = new Date(p.created_at).getTime();
            const inWindow = createdMs >= minMs && createdMs <= maxMs;
            const matched = matchElements(p, disputedEvidence || {});
            return { row: p, inWindow, matched };
          })
          .filter((x) => x.inWindow && x.matched.length >= 2);

        const qualifiesForCe3 = qualifying.length >= 2;

        // Tos record
        let tos: any = null;
        if (disputedEvidence?.user_id) {
          const { data: tosRow } = await supabase
            .from("tos_acceptances")
            .select("accepted, tos_version, accepted_at, ip_address, user_agent")
            .eq("user_id", disputedEvidence.user_id)
            .order("accepted_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          tos = tosRow;
        }

        // ── Post-charge usage evidence ("they used what they paid for") ──
        // Resolve the account even when no payment_evidence row exists
        // (older charges) by falling back to the profile email.
        let usageUserId: string | null = disputedEvidence?.user_id ?? null;
        const lookupEmail = (customerEmail || disputedEvidence?.email || "").toLowerCase();
        if (!usageUserId && lookupEmail) {
          const { data: prof } = await supabase
            .from("profiles").select("id").ilike("email", escapeIlikeExact(lookupEmail)).limit(1).maybeSingle();
          usageUserId = prof?.id ?? null;
        }
        let usageSummary: string | null = null;
        if (usageUserId && charge.created) {
          try {
            const sinceIso = new Date(charge.created * 1000).toISOString();
            const { count: sessionCount, data: lastSessions } = await supabase
              .from("user_sessions")
              .select("session_start", { count: "exact" })
              .eq("user_id", usageUserId)
              .gt("session_start", sinceIso)
              .order("session_start", { ascending: false })
              .limit(1);
            const { data: mem } = await supabase
              .from("org_memberships").select("organization_id")
              .eq("user_id", usageUserId).limit(1).maybeSingle();
            let bookingCount = 0;
            if (mem?.organization_id) {
              const { count } = await supabase
                .from("bookings").select("id", { count: "exact", head: true })
                .eq("organization_id", mem.organization_id)
                .gt("created_at", sinceIso);
              bookingCount = count ?? 0;
            }
            if ((sessionCount ?? 0) > 0 || bookingCount > 0) {
              usageSummary =
                `After this charge (${String(sinceIso).slice(0, 10)}), the account holder signed in ${sessionCount ?? 0} time(s)` +
                (lastSessions?.[0]?.session_start ? `, most recently on ${new Date(lastSessions[0].session_start).toISOString().slice(0, 10)}` : "") +
                ` and the business created ${bookingCount} booking(s) in the software — the service was actively used.`;
            }
          } catch (e) {
            console.error("[stripe-invoice-webhook] usage evidence lookup failed", e);
          }
        }

        // Compose draft evidence mapped to Stripe dispute evidence fields
        const fmt = (ts?: string | null) =>
          ts ? new Date(ts).toISOString().slice(0, 10) : "unknown";
        const matchSummary = qualifying
          .map((q) => `${fmt(q.row.created_at)} (matches: ${q.matched.join(", ")})`)
          .join("; ");

        const ce3Argument = qualifiesForCe3
          ? `Visa Compelling Evidence 3.0: cardholder completed ${qualifying.length} prior undisputed transactions on ${matchSummary}, each sharing 2+ matching elements with the disputed charge (account_id ${disputedEvidence?.user_id || "n/a"}, email ${disputedEvidence?.email || "n/a"}, IP ${disputedEvidence?.ip_address || "n/a"}). Account active since ${fmt(disputedEvidence?.signup_date)}.${tos?.accepted ? ` Terms of Service v${tos.tos_version} accepted on ${fmt(tos.accepted_at)} from IP ${tos.ip_address || "unknown"}.` : ""} This satisfies the CE 3.0 standard for fraud reason 10.4; liability should remain with the issuer.`
          : `CE 3.0 NOT QUALIFYING: only ${qualifying.length} prior undisputed transaction(s) within the 120-365 day window share 2+ matching elements with the disputed charge. Dispute likely unwinnable on CE 3.0 grounds — consider accepting.`;

        // ── Reason-specific narrative fields ────────────────────────────
        // 'fraudulent' and any unlisted reason fall through to the CE 3.0
        // argument unchanged; 'subscription_canceled' and the two
        // not-delivered reasons get a targeted rebuttal instead.
        //
        // customerSawPolicy: only cite the formal REFUND_POLICY /
        // CANCELLATION_POLICY text (and the policy-quote evidence fields)
        // when the disputing customer's OWN recorded ToS acceptance is at
        // or after the version that contains that language. Older
        // acceptances (or none on file) predate the policy rollout — those
        // customers never saw it, so asserting it as something they agreed
        // to would be overclaiming to the bank. Version strings are
        // YYYY-MM-DD, so lexical >= is chronological >=.
        const customerSawPolicy =
          !!tos?.accepted &&
          typeof tos.tos_version === "string" &&
          tos.tos_version >= TOS_VERSION;

        let cancellationRebuttal: string | null = null;
        let refundRefusalExplanation: string | null = null;
        let uncategorizedText = ce3Argument;

        if (dispute.reason === "subscription_canceled") {
          // Genuine post-charge usage signal: actual login sessions after
          // this charge, not a policy quote. Falls back gracefully if the
          // account or session history isn't available.
          let recentSessions: Array<{ session_start: string }> = [];
          if (disputedEvidence?.user_id && charge.created) {
            const chargeDate = new Date(charge.created * 1000).toISOString();
            const { data: sessions } = await supabase
              .from("user_sessions")
              .select("session_start")
              .eq("user_id", disputedEvidence.user_id)
              .gt("session_start", chargeDate)
              .order("session_start", { ascending: false })
              .limit(5);
            recentSessions = sessions || [];
          }

          cancellationRebuttal =
            `Our records show no cancellation was made before this charge's renewal date. ` +
            `Cancellation is self-serve, available any time from Settings → Billing inside ` +
            `the TidyWise dashboard — no support request is required to cancel. ` +
            (recentSessions.length > 0
              ? `The account logged in and used the Service ${recentSessions.length} time(s) after this charge, most recently on ${fmt(recentSessions[0].session_start)}, confirming the subscription was not cancelled and continued to be used.`
              : `See access_activity_log for this account's prior payment and access history.`) +
            (customerSawPolicy ? ` ${CANCELLATION_POLICY}` : "");

          uncategorizedText =
            (tos?.accepted
              ? `Terms of Service v${tos.tos_version} accepted on ${fmt(tos.accepted_at)} from IP ${tos.ip_address || "unknown"}.`
              : "Account has no recorded Terms of Service acceptance on file.") +
            (customerSawPolicy ? ` ${CANCELLATION_POLICY}` : "");
        } else if (
          dispute.reason === "product_not_received" ||
          dispute.reason === "product_unacceptable"
        ) {
          refundRefusalExplanation =
            `The account's access_activity_log evidences continued use of the ` +
            `TidyWise SaaS platform after this charge — service was delivered ` +
            `and used, not withheld.` +
            (customerSawPolicy ? ` ${REFUND_POLICY}` : "");
        }

        const draftedEvidence = {
          product_description:
            "TidyWise SaaS subscription — cleaning business management software (CRM, scheduling, invoicing, payroll). Recurring monthly billing, cancellable any time from the in-app subscription page.",
          customer_email_address: customerEmail || disputedEvidence?.email || null,
          customer_purchase_ip: disputedEvidence?.ip_address || null,
          customer_signature: tos?.accepted
            ? `Terms of Service v${tos.tos_version} accepted ${fmt(tos.accepted_at)} from IP ${tos.ip_address || "unknown"}, user-agent: ${tos.user_agent || "unknown"}.`
            : null,
          billing_address: charge.billing_details?.address
            ? JSON.stringify(charge.billing_details.address)
            : null,
          access_activity_log: JSON.stringify(
            (priors || []).slice(0, 10).map((p: any) => ({
              date: p.created_at,
              ip: p.ip_address,
              email: p.email,
              amount_cents: p.amount_cents,
              payment_intent: p.stripe_payment_intent_id,
            })),
          ),
          // Policy-quote fields: only populated when this specific customer's
          // accepted ToS version actually contained this language (see
          // customerSawPolicy above). Never asserted against an
          // acceptance that predates it.
          refund_policy: customerSawPolicy ? REFUND_POLICY : null,
          refund_policy_disclosure: customerSawPolicy ? POLICY_DISCLOSURE : null,
          cancellation_policy: customerSawPolicy ? CANCELLATION_POLICY : null,
          cancellation_policy_disclosure: customerSawPolicy ? POLICY_DISCLOSURE : null,
          cancellation_rebuttal: cancellationRebuttal,
          refund_refusal_explanation: refundRefusalExplanation && usageSummary ? `${refundRefusalExplanation} ${usageSummary}` : refundRefusalExplanation,
          uncategorized_text: usageSummary ? `${usageSummary} ${uncategorizedText}` : uncategorizedText,
          service_date: charge.created ? fmt(new Date(charge.created * 1000).toISOString()) : null,
        };

        await supabase
          .from("disputes")
          .upsert(
            {
              stripe_dispute_id: dispute.id,
              stripe_payment_intent_id: paymentIntentId,
              stripe_charge_id: dispute.charge as string,
              stripe_customer_id: customerId,
              customer_email: customerEmail,
              amount_cents: dispute.amount,
              currency: dispute.currency,
              reason: dispute.reason,
              status: dispute.status,
              qualifies_for_ce3: qualifiesForCe3,
              matching_prior_count: qualifying.length,
              drafted_evidence: draftedEvidence,
              raw_event: event.data.object,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "stripe_dispute_id" },
          );

        // Alert platform admin on creation
        if (event.type === "charge.dispute.created") {
          const amount = (dispute.amount / 100).toFixed(2);
          await sendAdminNotification(supabaseUrl, supabaseServiceKey, {
            organizationName: "DISPUTE / CHARGEBACK",
            ownerEmail: customerEmail || "unknown",
            subscriptionType: `Dispute ${dispute.id} • $${amount} ${dispute.currency.toUpperCase()} • reason: ${dispute.reason} • CE3.0 qualifying: ${qualifiesForCe3 ? "YES" : "NO"} (${qualifying.length} priors). Review at /dashboard/disputes`,
          }).catch((e) => console.error("[stripe-invoice-webhook] dispute alert failed", e));
        }
      } catch (e) {
        console.error("[stripe-invoice-webhook] dispute handling error:", e);
      }
    }

    // ── DISPUTE CLOSED (finalized in Stripe) ────────────────────────────────
    // Stripe fires charge.dispute.closed when a dispute reaches a terminal
    // state (won / lost / warning_closed). Sync the local row's status and
    // outcome so the Chargeback Disputes panel can't keep showing a stale
    // "needs_response" / "under_review" after it's actually resolved. Mirrors
    // the field mapping in sync-dispute-status so the poller and the webhook
    // can't disagree.
    if (event.type === "charge.dispute.closed") {
      try {
        const dispute = event.data.object as Stripe.Dispute;
        const TERMINAL = new Set(["won", "lost", "warning_closed"]);

        const { data: updated, error: closeErr } = await supabase
          .from("disputes")
          .update({
            status: dispute.status,
            outcome: TERMINAL.has(dispute.status) ? dispute.status : null,
            raw_event: event.data.object,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_dispute_id", dispute.id)
          .select("id");

        if (closeErr) {
          console.error("[stripe-invoice-webhook] dispute close update failed:", closeErr);
        } else if (!updated || updated.length === 0) {
          // No local row — dispute closed before we ever recorded it. The
          // sync-dispute-status poller / next created event will reconcile.
          console.warn(`[stripe-invoice-webhook] dispute ${dispute.id} closed (${dispute.status}) but no local row found`);
        } else {
          console.log(`[stripe-invoice-webhook] dispute ${dispute.id} closed → ${dispute.status}`);
        }
      } catch (e) {
        console.error("[stripe-invoice-webhook] dispute close handling error:", e);
      }
    }


    // ── SUBSCRIPTION CANCELLED / ENDED ──────────────────────────────────────
    // When Stripe finalizes a subscription deletion (either user-initiated
    // cancel after period end, or terminal dunning failure), revoke paid
    // plan access on the org. Without this branch the org's plan_type
    // stayed "standard" forever after cancellation — users kept full
    // access to the paid product for free until something else updated it.
    // Lifetime and grandfathered orgs are excluded: deleting the old
    // recurring subscription must not wipe plan_type lifetime.
    if (event.type === "customer.subscription.deleted") {
      try {
        const sub = event.data.object as Stripe.Subscription;
        const subMeta = (sub.metadata ?? {}) as Record<string, string>;

        // Branch 1: ad-management retainer cancelled (its own Stripe sub).
        // Just mark the row inactive; no cascade or plan-type change.
        if (subMeta.purpose === "tidywise_ad_management") {
          const { error: cancelErr } = await supabase
            .from("ad_management_subscriptions")
            .update({
              status: "cancelled",
              cancelled_at: new Date().toISOString(),
              cancellation_reason: "stripe_subscription_deleted",
            })
            .eq("stripe_subscription_id", sub.id);
          if (cancelErr) {
            console.error(
              "[stripe-invoice-webhook] failed to mark ad-management subscription cancelled locally (Stripe side is already cancelled):",
              { stripeSubscriptionId: sub.id, error: cancelErr },
            );
          } else {
            console.log(
              "[stripe-invoice-webhook] Ad-management subscription cancelled:",
              sub.id,
            );
          }
          return new Response(JSON.stringify({ received: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Branch 2: main TidyWise subscription cancelled — revoke paid
        // plan access and, only when that downgrade writes a row,
        // cascade-cancel ad-management retainers. Lifetime and
        // grandfathered orgs keep their ad subscriptions.
        // The customer read is only for the admin notice. A Stripe error
        // here must not skip the downgrade or be swallowed as a 200.
        let email: string | null = null;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
        if (customerId) {
          try {
            const customer = await stripe.customers.retrieve(customerId);
            if (customer && !(customer as { deleted?: boolean }).deleted) {
              email = (customer as Stripe.Customer).email ?? null;
            }
          } catch (retrieveErr) {
            console.error("[stripe-invoice-webhook] subscription delete customer retrieve failed:", retrieveErr);
          }
        }

        const organizationId = await organizationIdForDeletedSubscription(supabase, sub);
        if (!organizationId) {
          // A subscription that was never mirrored has no org to downgrade.
          // 500 would make Stripe retry it for days. Record the orphan and
          // ack, the same way created and updated do.
          console.error("[stripe-invoice-webhook] subscription delete could not resolve an org", { subscriptionId: sub.id });
          await logSubscriptionOrphan(
            supabase,
            supabaseUrl,
            supabaseServiceKey,
            sub,
            event.id,
            event.type,
            email,
            [{ step: "organizationIdForDeletedSubscription", result: "miss" }],
          );
        } else {
              // Mark the org's subscription row from the SaaS subscription
              // as it is now. An older delete must not rewind a newer
              // status. retrieve is read-only; the event guard is the fallback.
              const current = await readCurrentSaasSubscription(stripe, sub.id);
              const authoritative = current != null;
              const source = current ?? sub;
              const snap = subscriptionBillingSnapshot(source);
              const state = subscriptionStateFields(source);
              const { data: existingBilling, error: billingReadErr } = await supabase
                .from("stripe_subscriptions")
                .select("billing_event_at, updated_at")
                .eq("stripe_subscription_id", sub.id)
                .maybeSingle();
              const billingColumnsMissing = !!billingReadErr && isMissingBillingColumn(billingReadErr);
              const applyState = billingColumnsMissing
                ? true
                : shouldWriteSubscriptionState(
                  authoritative,
                  billingReadErr ? null : existingBilling,
                  event.created,
                ) && !billingReadErr;
              const stateUpdate = {
                status: state.status || "canceled",
                current_period_end: state.current_period_end,
                cancel_at_period_end: state.cancel_at_period_end,
                trial_end: state.trial_end,
                updated_at: new Date().toISOString(),
              };
              if (billingReadErr && !billingColumnsMissing) {
                console.error("[stripe-invoice-webhook] subscription delete guard read failed:", billingReadErr);
                subscriptionStateFailed = true;
              } else if (!applyState) {
                console.log("[stripe-invoice-webhook] older or duplicate delete; status and period left unchanged", sub.id);
              } else {
                const billingPatch = billingColumnsMissing
                  ? {}
                  : authoritative
                    ? {
                      ...stripeSubscriptionBillingPatch(snap),
                      billing_event_at: laterBillingEventAt(existingBilling, event.created),
                    }
                    : guardedBillingWrite(existingBilling, snap, event.created);
                const { error: cancelWriteErr } = await supabase
                  .from("stripe_subscriptions")
                  .update({ ...stateUpdate, ...billingPatch })
                  .eq("stripe_subscription_id", sub.id);
                if (cancelWriteErr && isMissingBillingColumn(cancelWriteErr)) {
                  const { error: fallbackErr } = await supabase
                    .from("stripe_subscriptions")
                    .update({
                      status: stateUpdate.status,
                      cancel_at_period_end: stateUpdate.cancel_at_period_end,
                      updated_at: stateUpdate.updated_at,
                    })
                    .eq("stripe_subscription_id", sub.id);
                  if (fallbackErr) {
                    console.error("[stripe-invoice-webhook] subscription cancel mirror failed:", fallbackErr);
                    subscriptionStateFailed = true;
                  }
                } else if (cancelWriteErr) {
                  console.error("[stripe-invoice-webhook] subscription cancel mirror failed:", cancelWriteErr);
                  subscriptionStateFailed = true;
                }
              }

              // Billing columns stay behind applyState. The free-plan write
              // still runs for a terminal status when this delete is not a
              // strictly older replay, including an equal timestamp whose
              // retrieve failed. A retrieve that shows the subscription
              // still active does not downgrade. Lifetime and grandfathered
              // orgs are refused inside the helper. A failed plan write
              // returns 500 so Stripe retries.
              if (subscriptionDeleteShouldDowngrade({
                authoritative,
                status: state.status,
                stored: billingReadErr ? null : existingBilling,
                incomingCreatedSec: event.created,
                blocked: subscriptionStateFailed,
              })) {
              const { error: planErr, downgraded } = await downgradeOrgOnSubscriptionDeleted(
                supabase,
                organizationId,
              );
              if (planErr) {
                console.error(
                  "[stripe-invoice-webhook] failed to revert org plan after subscription delete:",
                  { organizationId, error: planErr },
                );
                // Same release as a failed refund write: drop this event's
                // stripe_webhook_events row and return 500 so Stripe retries
                // the downgrade and the ad cancel.
                const failure = await subscriptionDeletedPlanFailure(supabase, event.id);
                return new Response(
                  JSON.stringify({ error: failure.error }),
                  { status: failure.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
                );
              } else if (downgraded) {
                console.log(
                  "[stripe-invoice-webhook] Subscription deleted, org reverted to free:",
                  organizationId,
                );
                // Same gate as the plan write: ads are cancelled only when
                // the free-plan update affected a row.
                await cascadeCancelAdSubscriptionsIfDowngraded(
                  supabase,
                  organizationId,
                  downgraded,
                  {
                    cancelStripeSubscription: (stripeSubscriptionId) =>
                      stripe.subscriptions.cancel(stripeSubscriptionId),
                    notifyAdmin: (activeCount) =>
                      sendAdminNotification(supabaseUrl, supabaseServiceKey, {
                        organizationName: "Ad Mgmt Cascade-Cancelled",
                        ownerEmail: email ?? "unknown",
                        subscriptionType: `${activeCount} ad-mgmt sub(s) cancelled along with TidyWise sub`,
                      }),
                  },
                );
              } else {
                console.log(
                  "[stripe-invoice-webhook] Subscription deleted, left plan unchanged (lifetime or grandfathered):",
                  organizationId,
                );
              }
              }
        }
      } catch (e) {
        console.error("[stripe-invoice-webhook] subscription.deleted handler error:", e);
        subscriptionStateFailed = true;
      }
    }

    // ── PAYMENT FAILED ──────────────────────────────────────────────────────
    // Dunning event: card decline on a renewal invoice. Notify the platform
    // admin so they can reach out before Stripe gives up and cancels the
    // sub. Capture the failure in payment_evidence with a special marker so
    // the dispute path can later tell "we tried and failed" from "we never
    // charged". Without this, failed payments are invisible until the sub
    // is auto-cancelled by Stripe's dunning policy.
    if (event.type === "invoice.payment_failed") {
      try {
        const inv = event.data.object as Stripe.Invoice;
        const email = inv.customer_email || (inv.metadata as any)?.email || "unknown";
        const amount = ((inv.amount_due ?? 0) / 100).toFixed(2);
        const attemptCount = inv.attempt_count ?? 0;
        const nextAttempt = inv.next_payment_attempt
          ? new Date(inv.next_payment_attempt * 1000).toLocaleString("en-US", {
              timeZone: "America/New_York",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })
          : "no further attempts";

        await sendAdminNotification(supabaseUrl, supabaseServiceKey, {
          organizationName: "PAYMENT FAILED",
          ownerEmail: email,
          subscriptionType: `Renewal failed (attempt ${attemptCount}) • $${amount} ${inv.currency.toUpperCase()} • next try: ${nextAttempt} • invoice ${inv.id}`,
        }).catch((e) =>
          console.error("[stripe-invoice-webhook] payment_failed alert failed", e),
        );
      } catch (e) {
        console.error("[stripe-invoice-webhook] payment_failed handler error:", e);
      }
    }

    // Log organization context if available
    if (organizationId) {
      console.log("[stripe-invoice-webhook] Event processed for organization:", organizationId);
    }

    if (subscriptionStateFailed) {
      const retry = subscriptionPersistHttpStatus("failed");
      if (subscriptionPersistReleasesIdempotency("failed") && event.id) {
        const { error: releaseErr } = await supabase
          .from("stripe_webhook_events")
          .delete()
          .eq("event_id", event.id)
          .eq("source", "stripe-invoice-webhook");
        if (releaseErr) {
          console.error("[stripe-invoice-webhook] failed to release idempotency claim; a Stripe retry would be skipped:", releaseErr);
        }
      }
      return new Response(
        JSON.stringify({ error: "subscription state was not saved; Stripe will retry." }),
        { status: retry, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ received: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[stripe-invoice-webhook] Webhook error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

// Helper function to send admin notification
async function sendAdminNotification(
  supabaseUrl: string, 
  supabaseServiceKey: string,
  data: { organizationName: string; ownerEmail: string; subscriptionType: string }
): Promise<void> {
  const openphoneApiKey = Deno.env.get("OPENPHONE_API_KEY");
  const openphonePhoneNumberId = Deno.env.get("OPENPHONE_PHONE_NUMBER_ID");

  if (!openphoneApiKey || !openphonePhoneNumberId) {
    console.log("[stripe-invoice-webhook] OpenPhone not configured - skipping admin notification");
    return;
  }

  const timestamp = new Date().toLocaleString('en-US', { 
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true 
  });

  const message = `🎉 NEW SUBSCRIPTION!\n\n` +
    `Business: ${data.organizationName}\n` +
    `Email: ${data.ownerEmail}\n` +
    `Status: ${data.subscriptionType}\n` +
    `Time: ${timestamp}`;

  console.log(`[stripe-invoice-webhook] Sending admin notification to ${PLATFORM_ADMIN_PHONE}`);

  const response = await fetch("https://api.openphone.com/v1/messages", {
    method: "POST",
    headers: {
      "Authorization": openphoneApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: openphonePhoneNumberId,
      to: [PLATFORM_ADMIN_PHONE],
      content: message,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[stripe-invoice-webhook] Failed to send admin notification: ${response.status} - ${errorText}`);
  } else {
    console.log("[stripe-invoice-webhook] Admin notification sent successfully");
  }
}

/**
 * Org that owns this subscription. The stored stripe_subscriptions row is
 * the subscription's own org. Customer id is the fallback, ordered so two
 * rows cannot swap which org is chosen. Email membership is not used:
 * an unordered first membership can downgrade a different org.
 */
async function organizationIdForDeletedSubscription(
  supabase: any,
  sub: Stripe.Subscription,
): Promise<string | null> {
  const { data: own, error: ownErr } = await supabase
    .from("stripe_subscriptions")
    .select("organization_id")
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();
  if (ownErr) throw ownErr;
  if (own?.organization_id) return own.organization_id;

  const meta = (sub.metadata ?? {}) as Record<string, string>;
  if (meta.organization_id) return meta.organization_id;

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return null;
  const { data: byCustomer, error: customerErr } = await supabase
    .from("stripe_subscriptions")
    .select("organization_id")
    .eq("stripe_customer_id", customerId)
    .not("organization_id", "is", null)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (customerErr) throw customerErr;
  return byCustomer?.organization_id ?? null;
}

/**
 * Resolve the TidyWise organization for a Stripe subscription. Resilient
 * lookup chain — tries multiple fallbacks before giving up so we don't
 * silently drop subscriptions when one path breaks (eg email case
 * mismatch between Stripe customer and profiles.email).
 *
 * Order:
 *   1. metadata.organization_id (set by in-app upgrade paths)
 *   2. metadata.account_id → org_memberships
 *   3. Stripe customer email → profiles.email (case-insensitive ILIKE)
 *   4. Stripe customer email → auth.users (then membership lookup),
 *      catches the "auth user exists but profile row missing" case
 *      that broke jigdahifash@gmail.com's subscription provisioning.
 *
 * Returns null for ad-management retainers and for genuinely
 * unresolvable subscriptions. The caller is responsible for logging an
 * orphan row + admin SMS in that case via logSubscriptionOrphan().
 */
async function resolveOrgIdForSubscription(
  supabase: any,
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<{ orgId: string | null; attempts: Array<{ step: string; result: string }>; customerEmail: string | null }> {
  const meta = (subscription.metadata ?? {}) as Record<string, string>;
  const attempts: Array<{ step: string; result: string }> = [];

  if (meta.purpose === "tidywise_ad_management") {
    return { orgId: null, attempts: [{ step: "ad_management_skip", result: "not_a_tidywise_sub" }], customerEmail: null };
  }

  // 1. Direct organization_id on metadata (in-app upgrades).
  if (meta.organization_id) {
    attempts.push({ step: "metadata.organization_id", result: `hit:${meta.organization_id}` });
    return { orgId: meta.organization_id, attempts, customerEmail: null };
  }

  let customerEmail: string | null = null;

  try {
    // 2. metadata.account_id → membership (in-app upgrades that pass user id).
    if (meta.account_id) {
      const { data: byAccountId } = await supabase
        .from("org_memberships")
        .select("organization_id")
        .eq("user_id", meta.account_id)
        .order("organization_id", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (byAccountId?.organization_id) {
        attempts.push({ step: "metadata.account_id->membership", result: `hit:${byAccountId.organization_id}` });
        return { orgId: byAccountId.organization_id, attempts, customerEmail };
      }
      attempts.push({ step: "metadata.account_id->membership", result: "miss" });
    }

    // Pull the Stripe customer once so the rest of the steps can reuse it.
    const customer = await stripe.customers.retrieve(subscription.customer as string);
    customerEmail = (customer as Stripe.Customer).email?.toLowerCase() ?? null;

    if (!customerEmail) {
      attempts.push({ step: "stripe_customer_email", result: "missing" });
      return { orgId: null, attempts, customerEmail };
    }

    // 3. profiles.email (case-insensitive — fixes the jigdahifash bug
    // where Stripe sent lowercase but profiles had mixed-case email).
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("email", escapeIlikeExact(customerEmail))
      .maybeSingle();
    if (profile?.id) {
      const { data: membership } = await supabase
        .from("org_memberships")
        .select("organization_id")
        .eq("user_id", profile.id)
        .order("organization_id", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (membership?.organization_id) {
        attempts.push({ step: "profiles.email_ilike->membership", result: `hit:${membership.organization_id}` });
        return { orgId: membership.organization_id, attempts, customerEmail };
      }
      attempts.push({ step: "profiles.email_ilike->membership", result: "profile_found_no_membership" });
    } else {
      attempts.push({ step: "profiles.email_ilike", result: "miss" });
    }

    // 4. Last-ditch: auth.users may exist even when profiles row is
    // missing (eg invite-then-failed-profile-insert race). Look up via
    // the admin client which has direct auth.users access.
    try {
      const { data: existing } = await (supabase.auth.admin as unknown as {
        getUserByEmail: (e: string) => Promise<{ data: { user?: { id: string } | null } }>;
      }).getUserByEmail(customerEmail);
      const authUserId = existing?.user?.id;
      if (authUserId) {
        const { data: membership } = await supabase
          .from("org_memberships")
          .select("organization_id")
          .eq("user_id", authUserId)
          .order("organization_id", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (membership?.organization_id) {
          attempts.push({ step: "auth.users.email->membership", result: `hit:${membership.organization_id}` });
          return { orgId: membership.organization_id, attempts, customerEmail };
        }
        attempts.push({ step: "auth.users.email->membership", result: "user_found_no_membership" });
      } else {
        attempts.push({ step: "auth.users.email", result: "miss" });
      }
    } catch (e) {
      attempts.push({ step: "auth.users.email", result: `error:${e instanceof Error ? e.message : "unknown"}` });
    }

    return { orgId: null, attempts, customerEmail };
  } catch (e) {
    attempts.push({ step: "exception", result: e instanceof Error ? e.message : String(e) });
    console.error("[stripe-invoice-webhook] resolveOrgIdForSubscription failed:", e);
    return { orgId: null, attempts, customerEmail };
  }
}

/**
 * Records a subscription that couldn't be linked to an org. Idempotent
 * on stripe_subscription_id (unresolved unique index). Fires an admin
 * SMS the first time the orphan is recorded so operators can fix it
 * before the customer complains.
 */
async function logSubscriptionOrphan(
  supabase: any,
  supabaseUrl: string,
  supabaseServiceKey: string,
  subscription: Stripe.Subscription,
  eventId: string | null,
  eventType: string,
  customerEmail: string | null,
  attempts: Array<{ step: string; result: string }>,
): Promise<void> {
  try {
    const { error: insertErr, data: insertedRows } = await supabase
      .from("subscription_orphans")
      .insert({
        stripe_subscription_id: subscription.id,
        stripe_customer_id: subscription.customer as string,
        stripe_event_id: eventId,
        stripe_event_type: eventType,
        customer_email: customerEmail,
        resolution_attempts: attempts,
      })
      .select("id");

    // 23505 = already orphaned (the unique partial index on unresolved
    // rows). No need to re-alert; the operator already knows.
    if (insertErr && (insertErr as any).code !== "23505") {
      console.error("[stripe-invoice-webhook] orphan log insert failed:", insertErr);
      return;
    }
    if (!insertedRows || insertedRows.length === 0) return;

    console.error(
      "[stripe-invoice-webhook] ORPHAN SUBSCRIPTION — couldn't link to org:",
      { sub: subscription.id, customer: subscription.customer, email: customerEmail, attempts },
    );

    await sendAdminNotification(supabaseUrl, supabaseServiceKey, {
      organizationName: "ORPHAN SUBSCRIPTION",
      ownerEmail: customerEmail || "unknown",
      subscriptionType: `Couldn't auto-link ${subscription.id} (${subscription.customer}). Run fix-orphan SQL.`,
    }).catch(() => {});
  } catch (e) {
    console.error("[stripe-invoice-webhook] logSubscriptionOrphan failed:", e);
  }
}

/**
 * Read the subscription with the client that verified this event's
 * signature. Retrieve only — no update, invoice, or refund. Null when
 * Stripe cannot be read; the caller then keeps the event payload behind
 * the billing_event_at guard.
 */
async function readCurrentSaasSubscription(stripe: Stripe, id: string): Promise<Stripe.Subscription | null> {
  try {
    return await stripe.subscriptions.retrieve(id);
  } catch (err) {
    console.error("[stripe-invoice-webhook] subscriptions.retrieve failed; status falls back to the event guard:", err);
    return null;
  }
}

/**
 * Upsert a row into public.stripe_subscriptions. This is the source of truth
 * that has_active_subscription() reads to decide whether an org may create
 * bookings / customers / invoices. Called from subscription created,
 * subscription updated, and checkout.session.completed. invoice.paid does
 * not call it. eventCreatedSec and authoritative are required.
 */
async function upsertStripeSubscription(
  supabase: any,
  orgId: string,
  subscription: Stripe.Subscription,
  eventCreatedSec: number | null,
  authoritative: boolean,
): Promise<SubscriptionPersistOutcome> {
  const item = subscription.items?.data?.[0];
  const price = item?.price;
  const meta = (subscription.metadata ?? {}) as Record<string, string>;

  // Stripe Basil (2025-08-27) moved current_period_end onto each subscription
  // item. Fall back to the legacy root field for older API versions / events.
  const currentPeriodEndSec =
    ((item as any)?.current_period_end as number | undefined) ??
    ((subscription as any).current_period_end as number | undefined);
  const trialEndSec = (subscription as any).trial_end as number | undefined;

  const snap = subscriptionBillingSnapshot(subscription);
  const state = subscriptionStateFields(subscription);
  const legacyRow = {
    organization_id: orgId,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: subscription.customer as string,
    stripe_price_id: price?.id ?? null,
    status: state.status,
    plan: (meta.tidywise_plan as string | undefined) ?? null,
    billing_interval: snap.billingInterval ?? price?.recurring?.interval ?? null,
    current_period_end: currentPeriodEndSec
      ? new Date(currentPeriodEndSec * 1000).toISOString()
      : state.current_period_end,
    cancel_at_period_end: state.cancel_at_period_end,
    trial_end: trialEndSec ? new Date(trialEndSec * 1000).toISOString() : state.trial_end,
    metadata: meta,
    updated_at: new Date().toISOString(),
  };

  const { data: existingBilling, error: billingReadErr } = await supabase
    .from("stripe_subscriptions")
    .select("billing_event_at, updated_at")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();
  if (billingReadErr && isMissingBillingColumn(billingReadErr)) {
    const { error: fallbackError } = await supabase
      .from("stripe_subscriptions")
      .upsert(legacyRow, { onConflict: "stripe_subscription_id" });
    if (fallbackError) {
      console.error("[stripe-invoice-webhook] stripe_subscriptions upsert failed:", fallbackError);
      return "failed";
    }
    return "wrote";
  }
  if (billingReadErr) {
    console.error("[stripe-invoice-webhook] billing guard read failed; status and period left unchanged:", billingReadErr);
    return "failed";
  }
  if (!shouldWriteSubscriptionState(authoritative, existingBilling, eventCreatedSec)) {
    console.log("[stripe-invoice-webhook] older or duplicate subscription event; status and period left unchanged", {
      subId: subscription.id,
    });
    return "skipped";
  }

  const billingPatch = authoritative
    ? {
      ...stripeSubscriptionBillingPatch(snap),
      billing_event_at: laterBillingEventAt(existingBilling, eventCreatedSec),
    }
    : guardedBillingWrite(existingBilling, snap, eventCreatedSec);
  const { error } = await supabase
    .from("stripe_subscriptions")
    .upsert({ ...legacyRow, ...billingPatch }, { onConflict: "stripe_subscription_id" });
  if (error && isMissingBillingColumn(error)) {
    const { error: fallbackError } = await supabase
      .from("stripe_subscriptions")
      .upsert(legacyRow, { onConflict: "stripe_subscription_id" });
    if (fallbackError) {
      console.error("[stripe-invoice-webhook] stripe_subscriptions upsert failed:", fallbackError);
      return "failed";
    }
    return "wrote";
  }
  if (error) {
    console.error("[stripe-invoice-webhook] stripe_subscriptions upsert failed:", error);
    return "failed";
  }
  console.log("[stripe-invoice-webhook] stripe_subscriptions upserted", {
    orgId,
    subId: subscription.id,
    status: state.status,
    authoritative,
  });
  return "wrote";
}

/**
 * Writes charge.refunded onto platform_subscription_refunds.
 * Org linkage is a lookup on stripe_subscriptions, not a Stripe call.
 * A missing refunds table (42P01 / PGRST205) or a missing refund_kind
 * column (42703 / PGRST204) is logged and acknowledged, so deploying
 * the function before the SQL editor migration does not make Stripe
 * retry charge.refunded until the endpoint is disabled. A transient
 * invoice retrieve or lifetime-purchase lookup returns false so the
 * claim is released and Stripe retries. Any other write error does too.
 */
async function persistSaasRefunds(
  supabase: any,
  stripe: Stripe,
  charge: Stripe.Charge,
  eventCreatedSec: number,
  eventAccount: string | null | undefined,
): Promise<boolean> {
  if (typeof eventAccount === "string" && eventAccount.trim() !== "") {
    console.log("[stripe-invoice-webhook] skipping connected-account refund", { account: eventAccount, charge: charge.id });
    return true;
  }

  let resolvedSubscriptionId: string | null = null;
  let purpose: string | null = null;
  const invoice = charge.invoice as { metadata?: { purpose?: string } } | string | null;
  if (invoice && typeof invoice === "object") {
    purpose = invoice.metadata?.purpose ?? null;
    resolvedSubscriptionId = subscriptionIdFromInvoice(invoice);
  } else if (typeof invoice === "string" && invoice) {
    try {
      const loaded = await stripe.invoices.retrieve(invoice);
      resolvedSubscriptionId = subscriptionIdFromInvoice(loaded);
      purpose = loaded.metadata?.purpose ?? null;
    } catch (err) {
      console.error("[stripe-invoice-webhook] invoice retrieve failed; Stripe will retry the refund:", err);
      return false;
    }
  }

  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id ?? null;
  let linkedLifetimePurchase = false;
  let lifetimeOrgId: string | null = null;
  if (paymentIntentId) {
    const { data, error } = await supabase
      .from("lifetime_access_purchases")
      .select("organization_id")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .limit(1);
    if (error) {
      console.error("[stripe-invoice-webhook] lifetime purchase lookup failed; Stripe will retry the refund:", error);
      return false;
    } else if (data && data.length > 0) {
      linkedLifetimePurchase = true;
      lifetimeOrgId = data[0].organization_id ?? null;
    }
  }

  const classification = classifySaasRefund({
    account: eventAccount,
    charge,
    linkedLifetimePurchase,
    resolvedSubscriptionId,
    purpose,
  });
  if (!classification) return true;

  const drafts = saasRefundDrafts(charge, eventCreatedSec);
  if (drafts.length === 0) return true;

  let storedRefundIds: string[] = [];
  if (charge.id) {
    const { data: stored, error: storedErr } = await supabase
      .from("platform_subscription_refunds")
      .select("stripe_refund_id")
      .eq("stripe_charge_id", charge.id);
    if (storedErr && (isMissingRelation(storedErr) || isMissingBillingColumn(storedErr))) {
      console.log("[stripe-invoice-webhook] platform_subscription_refunds is not migrated yet");
      return true;
    }
    if (storedErr) {
      console.error("[stripe-invoice-webhook] refund id lookup failed:", storedErr);
      return false;
    }
    if (!storedErr) {
      storedRefundIds = (stored ?? [])
        .map((row: { stripe_refund_id?: string | null }) => row.stripe_refund_id)
        .filter((id: string | null | undefined): id is string => typeof id === "string" && id.length > 0);
    }
  }
  const customerId = drafts[0]?.stripeCustomerId ?? null;
  let organizationId: string | null = lifetimeOrgId;
  if (!organizationId && customerId) {
    const { data, error } = await supabase
      .from("stripe_subscriptions")
      .select("organization_id")
      .eq("stripe_customer_id", customerId)
      .not("organization_id", "is", null)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(1);
    if (error) {
      console.error("[stripe-invoice-webhook] refund org lookup failed:", error);
    } else {
      organizationId = data?.[0]?.organization_id ?? null;
    }
  }

  const decision = saasRefundInsertRows({
    drafts,
    storedRefundIds,
    organizationId,
    kind: classification.kind,
    subscriptionId: classification.subscriptionId,
  });
  if (decision.dropUnitemized && charge.id) {
    const { error: dropErr } = await supabase
      .from("platform_subscription_refunds")
      .delete()
      .eq("stripe_refund_id", unitemizedRefundId(charge.id));
    if (dropErr && (isMissingRelation(dropErr) || isMissingBillingColumn(dropErr))) {
      console.log("[stripe-invoice-webhook] platform_subscription_refunds is not migrated yet");
      return true;
    }
    if (dropErr) {
      console.error("[stripe-invoice-webhook] unitemized refund delete failed:", dropErr);
      return false;
    }
  }
  if (decision.rows.length === 0) return true;

  const rows = decision.rows;

  const { error } = await supabase
    .from("platform_subscription_refunds")
    .upsert(rows, { onConflict: "stripe_refund_id" });
  if (error && isMissingRelation(error)) {
    console.log("[stripe-invoice-webhook] platform_subscription_refunds is not migrated yet");
    return true;
  }
  if (error && isMissingBillingColumn(error)) {
    const withoutKind = rows.map(({ refund_kind: _kind, ...rest }) => rest);
    const { error: fallbackError } = await supabase
      .from("platform_subscription_refunds")
      .upsert(withoutKind, { onConflict: "stripe_refund_id" });
    if (fallbackError && (isMissingRelation(fallbackError) || isMissingBillingColumn(fallbackError))) {
      console.log("[stripe-invoice-webhook] platform_subscription_refunds is not migrated yet");
      return true;
    }
    if (fallbackError) {
      console.error("[stripe-invoice-webhook] platform_subscription_refunds upsert failed:", fallbackError);
      return false;
    }
    return true;
  }
  if (error) {
    console.error("[stripe-invoice-webhook] platform_subscription_refunds upsert failed:", error);
    return false;
  }
  return true;
}

// Resolve the active TidyWise plan tier ("basic" | "pro" | "custom") from
// a Stripe subscription. We prefer metadata (set by change-subscription-plan
// and reconcile-checkout-session) and fall back to matching the price id
// against the env-configured price ids.
function resolvePlanTierFromSubscription(
  subscription: Stripe.Subscription,
): "basic" | "pro" | "custom" | null {
  const meta = (subscription.metadata ?? {}) as Record<string, string>;
  const fromMeta =
    meta.tidywise_plan || meta.plan_tier || meta.plan || null;
  if (fromMeta && ["basic", "pro", "custom"].includes(fromMeta)) {
    return fromMeta as "basic" | "pro" | "custom";
  }
  const priceId = subscription.items?.data?.[0]?.price?.id ?? null;
  if (!priceId) return null;
  const priceMap: Record<string, "basic" | "pro" | "custom"> = {};
  for (const [tier, ids] of [
    ["basic", [Deno.env.get("STRIPE_BASIC_MONTHLY_PRICE_ID"), Deno.env.get("STRIPE_BASIC_YEARLY_PRICE_ID")]],
    ["pro", [Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID"), Deno.env.get("STRIPE_PRO_YEARLY_PRICE_ID")]],
    ["custom", [Deno.env.get("STRIPE_CUSTOM_MONTHLY_PRICE_ID"), Deno.env.get("STRIPE_CUSTOM_YEARLY_PRICE_ID")]],
  ] as const) {
    for (const id of ids) {
      if (id) priceMap[id] = tier as "basic" | "pro" | "custom";
    }
  }
  return priceMap[priceId] ?? null;
}

// Push the resolved plan from a Stripe subscription onto organizations.
// Also clears the scheduled-downgrade fields once the org reaches the
// previously scheduled tier (the schedule has rolled over).
async function syncOrgPlanFromSubscription(
  supabase: any,
  orgId: string,
  subscription: Stripe.Subscription,
): Promise<boolean> {
  // Don't downgrade a Lifetime/grandfathered org from Stripe updates.
  const { data: existingOrg, error: readErr } = await supabase
    .from("organizations")
    .select("plan_type, grandfathered_lifetime, plan_downgrade_scheduled_to")
    .eq("id", orgId)
    .maybeSingle();
  if (readErr) {
    console.error("[stripe-invoice-webhook] syncOrgPlanFromSubscription read failed:", readErr);
    return false;
  }
  if (
    existingOrg?.grandfathered_lifetime ||
    existingOrg?.plan_type === "lifetime"
  ) {
    return true;
  }

  const tier = resolvePlanTierFromSubscription(subscription);
  if (!tier) return true;
  if (!["active", "trialing", "past_due"].includes(subscription.status)) return true;

  const update: Record<string, unknown> = { plan_type: tier };
  // If we reached the scheduled tier, clear pending-downgrade markers.
  if (
    existingOrg?.plan_downgrade_scheduled_to &&
    existingOrg.plan_downgrade_scheduled_to === tier
  ) {
    update.plan_downgrade_scheduled_to = null;
    update.plan_downgrade_date = null;
    update.stripe_schedule_id = null;
  }

  const { error } = await supabase
    .from("organizations")
    .update(update)
    .eq("id", orgId);
  if (error) {
    console.error("[stripe-invoice-webhook] syncOrgPlanFromSubscription failed:", error);
    return false;
  }
  console.log("[stripe-invoice-webhook] organization plan_type synced", { orgId, tier });
  return true;
}

serve(handler);

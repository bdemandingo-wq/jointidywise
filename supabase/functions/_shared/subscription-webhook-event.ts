// customer.subscription.* handling for stripe-subscription-webhook.
// Stripe, Supabase, and plan-tier mapping are injected so this file does not
// import Deno or call Stripe itself. The caller verifies the webhook signature.

import {
  escapeIlikeExact,
  guardedBillingWrite,
  incomingBillingIsNewer,
  isMissingBillingColumn,
  laterBillingEventAt,
  stripeSubscriptionBillingPatch,
  subscriptionBillingSnapshot,
  subscriptionPersistHttpStatus,
  subscriptionStateFields,
} from "./subscription-billing-snapshot.ts";

export const subscriptionWebhookCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

export type SubscriptionPlanTier = "trial" | "basic" | "pro" | "custom";

export interface SubscriptionPlanTierResult {
  updated: boolean;
  skipped?: string;
}

export interface SubscriptionWebhookEvent {
  id?: string;
  type: string;
  created: number;
  data: {
    object: Record<string, any>;
    previous_attributes?: { status?: string };
  };
}

const log = (step: string, details?: unknown) => {
  const s = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[STRIPE-SUB-WEBHOOK] ${step}${s}`);
};

export async function handleSubscriptionWebhookEvent(deps: {
  event: SubscriptionWebhookEvent;
  stripe: any;
  supabase: any;
  subscriptionToPlanTier: (subscription: any) => SubscriptionPlanTier | null;
  updateOrgPlanTier: (
    supabase: any,
    organizationId: string,
    tier: SubscriptionPlanTier,
  ) => Promise<SubscriptionPlanTierResult>;
  syncLoyaltySubscription: (
    supabase: any,
    stripe: any,
    args: { organizationId: string; subscriptionId: string },
  ) => Promise<unknown>;
  adminPhones: readonly string[];
  env: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  const {
    event,
    stripe,
    supabase,
    subscriptionToPlanTier,
    updateOrgPlanTier,
    syncLoyaltySubscription,
    adminPhones,
    env,
  } = deps;
  const doFetch = deps.fetchImpl ?? fetch;
  const corsHeaders = subscriptionWebhookCorsHeaders;
  let claimedEventId: string | undefined;

  try {
    if (
      event.type !== "customer.subscription.created" &&
      event.type !== "customer.subscription.updated" &&
      event.type !== "customer.subscription.deleted"
    ) {
      return new Response(JSON.stringify({ ignored: event.type }), { status: 200, headers: corsHeaders });
    }

    const sub = event.data.object;
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
    if (!customerId) throw new Error("no customer id");

    const customer = await stripe.customers.retrieve(customerId);
    const email = customer?.email?.toLowerCase();
    if (!email) throw new Error("customer has no email");

    // The subscription's own org wins. Email is only the fallback, and a
    // missing profile must not ack 200 or Stripe will never retry.
    const orgId = await resolveWebhookOrganization(supabase, sub, email);
    if (!orgId) {
      log("subscription org was not resolved", { email, subId: sub.id });
      return new Response(
        JSON.stringify({ error: "subscription org was not resolved; Stripe will retry." }),
        { status: subscriptionPersistHttpStatus("failed"), headers: corsHeaders },
      );
    }

    const eventId = event.id;
    if (eventId) {
      const claim = await claimSubscriptionWebhookEvent(supabase, eventId, event.type);
      if (claim === "duplicate") {
        log("duplicate subscription event; side effects skipped", { eventId });
        return new Response(JSON.stringify({ ok: true, duplicate: true }), {
          status: 200,
          headers: corsHeaders,
        });
      }
      if (claim === "failed") {
        return new Response(
          JSON.stringify({ error: "Idempotency lookup failed; Stripe will retry." }),
          { status: subscriptionPersistHttpStatus("failed"), headers: corsHeaders },
        );
      }
      claimedEventId = eventId;
    }

    // Current SaaS subscription. Retrieve only — no update and no charge.
    // If it fails, status and period follow the event only when event.created
    // is strictly newer than the stored billing_event_at.
    let source = sub;
    let authoritative = false;
    try {
      source = await stripe.subscriptions.retrieve(sub.id);
      authoritative = true;
    } catch (err) {
      log("subscriptions.retrieve failed; status falls back to the event guard", { message: (err as Error).message });
    }

    let existingBilling: { billing_event_at?: string | null; updated_at?: string | null } | null = null;
    let billingReadErr: { message?: string } | null = null;
    try {
      const read = await supabase
        .from("stripe_subscriptions")
        .select("billing_event_at, updated_at")
        .eq("stripe_subscription_id", sub.id)
        .maybeSingle();
      existingBilling = read.data;
      billingReadErr = read.error;
    } catch (err) {
      billingReadErr = { message: (err as Error).message };
    }

    const columnsMissing = !!billingReadErr && isMissingBillingColumn(billingReadErr);
    let subscriptionStateFailed = false;
    const applyState = columnsMissing
      ? true
      : authoritative
        ? !billingReadErr
        : !billingReadErr && incomingBillingIsNewer(existingBilling, event.created);

    // Declared here, not inside the applyState branch. The success response
    // below reads them when the event is older, when the plan update is an
    // intentional skip, and when the tier was written. A block-scoped binding
    // throws ReferenceError on those paths, and the outer catch turns that
    // into a 500 Stripe retries forever.
    let tier: SubscriptionPlanTier | null = null;
    let result: SubscriptionPlanTierResult = { updated: false };

    if (!applyState) {
      log("older or duplicate subscription event; plan, status, and period left unchanged", { subId: sub.id });
    } else {
      // Decide tier from the subscription we are willing to trust.
      tier = "trial";
      const isTerminal = authoritative
        ? !(source.status === "active" || source.status === "trialing")
        : event.type === "customer.subscription.deleted" ||
          !(source.status === "active" || source.status === "trialing");

      if (isTerminal) {
        const all = await stripe.subscriptions.list({ customer: customerId, limit: 10 });
        const other = all.data.find(
          (s: { id?: string; status?: string }) => s.id !== source.id && (s.status === "active" || s.status === "trialing"),
        );
        if (other) tier = subscriptionToPlanTier(other) ?? "trial";
      } else {
        tier = subscriptionToPlanTier(source) ?? "trial";
      }

      result = await updateOrgPlanTier(supabase, orgId, tier);
      log("Updated plan_tier", { orgId, tier, ...result });
      if (result.skipped && result.skipped !== "org_not_found" && result.skipped !== "lifetime_locked") {
        log("plan_tier write failed", { message: result.skipped });
        subscriptionStateFailed = true;
      }
    }

    // Do not insert. A new row would change the paywall mirror. Status,
    // period, price, and cancel date are written only for current Stripe
    // state, or for a strictly newer event when retrieve failed.
    try {
      if (columnsMissing) {
        log("billing columns are not migrated yet; subscription row left unchanged");
      } else if (billingReadErr) {
        log("billing guard read failed; not writing status or period", { message: billingReadErr.message });
        subscriptionStateFailed = true;
      } else if (!existingBilling) {
        log("no stripe_subscriptions row yet; not inserting from the subscription webhook", { subId: sub.id });
      } else if (!applyState) {
        log("keeping stored status and period", { subId: sub.id });
      } else {
        const snap = subscriptionBillingSnapshot(source);
        const state = subscriptionStateFields(source);
        const billing = authoritative
          ? {
            ...stripeSubscriptionBillingPatch(snap),
            billing_event_at: laterBillingEventAt(existingBilling, event.created),
          }
          : guardedBillingWrite(existingBilling, snap, event.created);
        const { error: writeErr } = await supabase
          .from("stripe_subscriptions")
          .update({ ...state, ...billing })
          .eq("stripe_subscription_id", sub.id);
        if (writeErr && isMissingBillingColumn(writeErr)) {
          log("billing columns are not migrated yet; subscription row left unchanged");
        } else if (writeErr) {
          log("billing column update failed", { message: writeErr.message });
          subscriptionStateFailed = true;
        }
      }
    } catch (billingErr) {
      log("subscription billing snapshot failed", { message: (billingErr as Error).message });
      subscriptionStateFailed = true;
    }

    if (subscriptionStateFailed) {
      await releaseSubscriptionWebhookEvent(supabase, eventId);
      return new Response(
        JSON.stringify({ error: "subscription state was not saved; Stripe will retry." }),
        { status: subscriptionPersistHttpStatus("failed"), headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Trial -> paid conversion notification -------------------------------
    // Non-fatal by construction: everything below is inside its own try/catch
    // and runs AFTER updateOrgPlanTier, so a failed SMS can never roll back or
    // block the plan_tier sync this webhook exists to perform.
    const previousStatus = event.data.previous_attributes?.status;
    const converted = applyState && previousStatus === "trialing" && source.status === "active";

    if (converted) {
      try {
        const item = sub.items.data[0];
        const price = item?.price;
        const amount =
          typeof price?.unit_amount === "number"
            ? `${(price.unit_amount / 100).toFixed(2)} ${String(price.currency).toUpperCase()}`
            : "unknown amount";
        const interval = price?.recurring?.interval ?? "unknown interval";

        // create-subscription stamps tidywise_plan on the subscription's metadata.
        // Fall back to the price nickname rather than to a plan-name table.
        const planName =
          (sub.metadata as Record<string, string> | undefined)?.tidywise_plan ??
          price?.nickname ??
          "unknown plan";

        const { data: org } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", orgId)
          .maybeSingle();
        const organizationName = org?.name ?? orgId;

        const message =
          `TidyWise: trial converted to paid\n` +
          `Org: ${organizationName}\n` +
          `Plan: ${planName}\n` +
          `Price: ${amount} / ${interval}\n` +
          `Subscription: ${sub.id}`;

        const TIDYWISE_ORG_ID = "e95b92d0-7099-408e-a773-e4407b34f8b4";
        const { data: smsSettings } = await supabase
          .from("organization_sms_settings")
          .select("openphone_api_key, openphone_phone_number_id")
          .eq("organization_id", TIDYWISE_ORG_ID)
          .maybeSingle();

        const openphoneApiKey =
          smsSettings?.openphone_api_key || env("OPENPHONE_API_KEY");
        const openphonePhoneNumberId =
          smsSettings?.openphone_phone_number_id || env("OPENPHONE_PHONE_NUMBER_ID");

        if (openphoneApiKey && openphonePhoneNumberId) {
          for (const phone of adminPhones) {
            try {
              const res = await doFetch("https://api.openphone.com/v1/messages", {
                method: "POST",
                headers: {
                  Authorization: openphoneApiKey.trim().replace(/^Bearer\s+/i, ""),
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  from: openphonePhoneNumberId,
                  to: [phone],
                  content: message,
                }),
              });
              if (!res.ok) {
                log("Conversion SMS failed", { phone, status: res.status, body: await res.text() });
              } else {
                log("Conversion SMS sent", { phone, subscription: sub.id });
              }
            } catch (smsErr) {
              log("Conversion SMS error", { phone, message: (smsErr as Error).message });
            }
          }
        } else {
          log("Conversion SMS skipped - OpenPhone not configured");
        }
      } catch (notifyErr) {
        log("Conversion notification error (non-fatal)", {
          message: (notifyErr as Error).message,
        });
      }
    }


    // Clock only, and only after a write we actually applied. A duplicate
    // already returned. An older event must not sync the coupon again.
    // A failure here must not fail the plan_tier sync above.
    // The daily apply-loyalty-pricing job repeats this and is what attaches
    // the renewal coupon. proration_behavior is none inside the sync.
    if (applyState) {
      try {
        await syncLoyaltySubscription(supabase, stripe, {
          organizationId: orgId,
          subscriptionId: sub.id,
        });
      } catch (loyaltyErr) {
        log("Loyalty clock sync failed (non-fatal)", { message: (loyaltyErr as Error).message });
      }
    }

    return new Response(JSON.stringify({ ok: true, tier, ...result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    log("ERROR", { message: (err as Error).message });
    if (claimedEventId) {
      try {
        await releaseSubscriptionWebhookEvent(supabase, claimedEventId);
      } catch (releaseErr) {
        log("failed to release idempotency claim", { message: (releaseErr as Error).message });
      }
    }
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

const SUBSCRIPTION_WEBHOOK_SOURCE = "stripe-subscription-webhook";

async function claimSubscriptionWebhookEvent(
  supabase: any,
  eventId: string,
  eventType: string,
): Promise<"claimed" | "duplicate" | "failed"> {
  const { error } = await supabase.from("stripe_webhook_events").insert({
    event_id: eventId,
    event_type: eventType,
    source: SUBSCRIPTION_WEBHOOK_SOURCE,
  });
  if (!error) return "claimed";
  if (error.code === "23505") return "duplicate";
  log("idempotency insert failed", { message: error.message });
  return "failed";
}

async function releaseSubscriptionWebhookEvent(supabase: any, eventId: string | undefined): Promise<void> {
  if (!eventId) return;
  const { error } = await supabase
    .from("stripe_webhook_events")
    .delete()
    .eq("event_id", eventId)
    .eq("source", SUBSCRIPTION_WEBHOOK_SOURCE);
  if (error) log("failed to release idempotency claim", { message: error.message });
}

/**
 * Org for this subscription, not "the first membership of this email".
 * Same order as the invoice webhook's deleted-subscription resolver:
 * the stored stripe_subscriptions row, then metadata, then email.
 * A missing profile or membership is reported by returning null so the
 * caller can ask Stripe to retry instead of acknowledging the event.
 */
async function resolveWebhookOrganization(
  supabase: any,
  sub: { id?: string; metadata?: Record<string, string> },
  email: string,
): Promise<string | null> {
  if (sub.id) {
    const { data, error } = await supabase
      .from("stripe_subscriptions")
      .select("organization_id")
      .eq("stripe_subscription_id", sub.id)
      .maybeSingle();
    if (error) {
      if (!isMissingBillingColumn(error)) throw error;
    } else if (data?.organization_id) {
      return data.organization_id;
    }
  }

  const metaOrg = sub.metadata?.organization_id;
  if (typeof metaOrg === "string" && metaOrg.trim()) return metaOrg.trim();

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", escapeIlikeExact(email))
    .maybeSingle();
  if (profileErr) throw profileErr;
  if (!profile?.id) {
    log("No profile matches customer email", { email });
    return null;
  }

  const { data: membership, error: memberErr } = await supabase
    .from("org_memberships")
    .select("organization_id")
    .eq("user_id", profile.id)
    .in("role", ["owner", "admin"])
    .order("organization_id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (memberErr) throw memberErr;
  if (!membership?.organization_id) {
    log("No owning org", { email });
    return null;
  }
  return membership.organization_id;
}

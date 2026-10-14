/**
 * Drop an organization to the free plan when Stripe deletes its subscription.
 *
 * The exclusion is on the UPDATE itself. A prior read would race with the
 * lifetime purchase path and could still write plan_type free.
 *
 * - plan_type lifetime never matches (.neq)
 * - grandfathered_lifetime true never matches
 * - grandfathered_lifetime null still matches, so a normal org with a null
 *   flag is downgraded. .neq on the boolean would drop those rows, because
 *   NULL <> true is unknown in SQL.
 */
/** Rows that are not grandfathered, including a null flag. */
export const EXCLUDE_GRANDFATHERED_LIFETIME =
  "grandfathered_lifetime.is.null,grandfathered_lifetime.eq.false";

export interface PlanDowngradeResult {
  data: { id: string }[] | null;
  error: { message: string } | null;
}

/** Chain the webhook's service-role client actually uses for this update. */
export interface PlanDowngradeUpdate {
  eq(column: string, value: string): PlanDowngradeUpdate;
  neq(column: string, value: string): PlanDowngradeUpdate;
  or(filters: string): PlanDowngradeUpdate;
  select(columns: string): PromiseLike<PlanDowngradeResult>;
}

export interface PlanDowngradeClient {
  from(table: string): {
    update(values: { plan_type: "free" }): PlanDowngradeUpdate;
  };
}

export async function downgradeOrgOnSubscriptionDeleted(
  // The generated service-role client is not assignable to PlanDowngradeClient
  // (PostgrestFilterBuilder's generics). Same escape as updateOrgPlanTier.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  organizationId: string,
): Promise<{ downgraded: boolean; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("organizations")
    .update({ plan_type: "free" })
    .eq("id", organizationId)
    .neq("plan_type", "lifetime")
    .or(EXCLUDE_GRANDFATHERED_LIFETIME)
    .select("id");

  if (error) return { downgraded: false, error };
  return { downgraded: Array.isArray(data) && data.length > 0, error: null };
}

/** Body of the 500 Stripe retries after a failed subscription.deleted plan write. */
export const SUBSCRIPTION_DELETED_PLAN_RETRY_ERROR =
  "subscription state was not saved; Stripe will retry.";

/**
 * The webhook inserts stripe_webhook_events before the plan write. A 500
 * left in place would make Stripe's retry look like a duplicate and return
 * 200 without downgrading the org or cancelling its ad subscriptions.
 */
export async function subscriptionDeletedPlanFailure(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  eventId: string | null | undefined,
): Promise<{ status: 500; error: string }> {
  if (eventId) {
    const { error: releaseErr } = await supabase
      .from("stripe_webhook_events")
      .delete()
      .eq("event_id", eventId)
      .eq("source", "stripe-invoice-webhook");
    if (releaseErr) {
      console.error(
        "[stripe-invoice-webhook] failed to release idempotency claim; a Stripe retry would be skipped:",
        releaseErr,
      );
    }
  }
  return { status: 500, error: SUBSCRIPTION_DELETED_PLAN_RETRY_ERROR };
}

export interface AdCascadeEffects {
  cancelStripeSubscription: (stripeSubscriptionId: string) => Promise<unknown>;
  notifyAdmin: (activeCount: number) => Promise<void>;
}

/**
 * Cancel active ad-management retainers after the TidyWise plan actually
 * drops to free. Lifetime and grandfathered orgs pass downgraded=false and
 * this returns without reading or writing their ad subscriptions.
 */
export async function cascadeCancelAdSubscriptionsIfDowngraded(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  organizationId: string,
  downgraded: boolean,
  effects: AdCascadeEffects,
): Promise<void> {
  if (!downgraded) return;

  // Cascade: cancel any active ad-management subs for this org in Stripe
  // (which will fire their own customer.subscription.deleted events; the
  // ad-purpose branch marks them cancelled in our table) then mark them
  // cancelled locally as a defensive write in case the Stripe-side cancel
  // webhook is delayed.
  const { data: adSubs, error: adSubsErr } = await supabase
    .from("ad_management_subscriptions")
    .select("stripe_subscription_id, platform")
    .eq("organization_id", organizationId)
    .eq("status", "active");

  if (adSubsErr) {
    // If this lookup silently returns nothing, the cascade below runs
    // zero iterations and any active ad-management subs keep billing
    // after the parent plan is cancelled — exactly the safety net this
    // cascade exists to prevent.
    console.error(
      "[stripe-invoice-webhook] CRITICAL: could not look up ad-management subs to cascade-cancel — any active ones will keep billing:",
      { organizationId, error: adSubsErr },
    );
  }

  for (const ad of adSubs ?? []) {
    try {
      await effects.cancelStripeSubscription(ad.stripe_subscription_id);
      console.log(
        "[stripe-invoice-webhook] Cascade-cancelled ad sub:",
        ad.platform,
        ad.stripe_subscription_id,
      );
    } catch (cancelErr) {
      console.error(
        "[stripe-invoice-webhook] cascade cancel failed:",
        cancelErr,
      );
    }
  }
  if (adSubs && adSubs.length > 0) {
    const { error: markCancelledErr } = await supabase
      .from("ad_management_subscriptions")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: "tidywise_subscription_cancelled",
      })
      .eq("organization_id", organizationId)
      .eq("status", "active");
    if (markCancelledErr) {
      console.error(
        "[stripe-invoice-webhook] cascade-cancelled in Stripe but failed to mark cancelled locally:",
        { organizationId, error: markCancelledErr },
      );
    }

    await effects.notifyAdmin(adSubs.length).catch((notifyErr: unknown) => {
      console.error("[stripe-invoice-webhook] cascade-cancel admin notification failed to send:", notifyErr);
    });
  }
}

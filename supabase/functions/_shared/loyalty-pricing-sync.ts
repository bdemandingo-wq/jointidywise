/**
 * Writes the loyalty clock and, at the renewal boundary, the Stripe coupon.
 *
 * Stripe calls are limited to coupons.retrieve, coupons.create,
 * subscriptions.retrieve, subscriptions.list, and subscriptions.update.
 * The update sets discounts and proration_behavior "none". It does not
 * create a PaymentIntent, invoice, or charge.
 */
import {
  LOYALTY_PRICING,
  isLifetimePlan,
  loyaltyCouponChange,
  loyaltyCouponCreateParams,
  loyaltyPlanOf,
  nextLoyaltyClock,
  nextSubscriptionDiscounts,
  type DiscountRef,
} from "./loyalty-pricing.ts";
import { subscriptionToPlanTier } from "./plan-tier.ts";

const TERMINAL = new Set(["canceled", "cancelled", "unpaid", "incomplete_expired"]);

interface DbError {
  message: string;
}

interface LoyaltyDb {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: DbError | null }>;
      };
    };
    upsert(
      values: Record<string, unknown>,
      options: { onConflict: string },
    ): Promise<{ error: DbError | null }>;
  };
}

export interface LoyaltyStripe {
  subscriptions: {
    retrieve(id: string, params?: { expand?: string[] }): Promise<Record<string, unknown>>;
    update(
      id: string,
      params: Record<string, unknown>,
      opts?: { idempotencyKey?: string },
    ): Promise<Record<string, unknown>>;
    list(params: { customer: string; status: string; limit: number }): Promise<{ data: Array<Record<string, unknown>> }>;
  };
  coupons: {
    retrieve(id: string): Promise<Record<string, unknown>>;
    create(params: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<Record<string, unknown>>;
  };
}

interface LoyaltyRow {
  continuous_since: string | null;
  reset_at: string | null;
  applied_discount_cents: number | null;
  applied_coupon_id: string | null;
  plan: string | null;
  billing_interval: string | null;
  stripe_subscription_id: string | null;
  last_status: string | null;
}

export interface SyncLoyaltyInput {
  organizationId: string;
  subscriptionId: string;
  invoiceUpcoming?: boolean;
  dryRun?: boolean;
  now?: string;
}

export interface SyncLoyaltyResult {
  organizationId: string;
  subscriptionId: string;
  action: string;
  continuousSince: string | null;
  discountCents: number;
  dryRun: boolean;
}

function isMissing(err: unknown): boolean {
  const e = err as { statusCode?: number; code?: string; status?: number };
  return e?.statusCode === 404 || e?.status === 404 || e?.code === "resource_missing";
}

function isAlreadyExists(err: unknown): boolean {
  const e = err as { code?: string };
  return e?.code === "resource_already_exists";
}

function unixToIso(value: unknown): string | null {
  return typeof value === "number" ? new Date(value * 1000).toISOString() : null;
}

function discountRefs(sub: Record<string, unknown>): DiscountRef[] {
  const refs: DiscountRef[] = [];
  const list = Array.isArray(sub.discounts) ? sub.discounts : [];
  for (const entry of list) {
    if (typeof entry === "string") {
      refs.push({ id: entry, couponId: null });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const discount = entry as { id?: string; coupon?: { id?: string } | string };
    const couponId = typeof discount.coupon === "string"
      ? discount.coupon
      : discount.coupon?.id ?? null;
    if (discount.id) refs.push({ id: discount.id, couponId });
  }
  const single = sub.discount;
  if (single && typeof single === "object") {
    const discount = single as { id?: string; coupon?: { id?: string } | string };
    const couponId = typeof discount.coupon === "string"
      ? discount.coupon
      : discount.coupon?.id ?? null;
    if (discount.id && !refs.some((ref) => ref.id === discount.id)) {
      refs.push({ id: discount.id, couponId });
    }
  }
  return refs;
}

function planAndInterval(sub: Record<string, unknown>): { plan: string | null; interval: string | null } {
  const metadata = (sub.metadata ?? {}) as Record<string, string>;
  const fromMeta = metadata.tidywise_plan || metadata.plan || null;
  const plan = fromMeta === "basic" || fromMeta === "pro" || fromMeta === "custom"
    ? fromMeta
    : subscriptionToPlanTier(sub);
  const items = (sub.items as { data?: Array<{ price?: { recurring?: { interval?: string } } }> } | undefined)?.data;
  const interval = items?.[0]?.price?.recurring?.interval ?? null;
  return { plan, interval };
}

function renewalAt(sub: Record<string, unknown>): string | null {
  const items = (sub.items as { data?: Array<Record<string, unknown>> } | undefined)?.data;
  return unixToIso(items?.[0]?.current_period_end) ?? unixToIso(sub.current_period_end);
}

async function ensureCoupon(stripe: LoyaltyStripe, plan: "basic" | "pro", discountCents: number): Promise<void> {
  const params = loyaltyCouponCreateParams(plan, discountCents);
  let existing: Record<string, unknown> | null = null;
  try {
    existing = await stripe.coupons.retrieve(params.id);
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  if (!existing) {
    try {
      existing = await stripe.coupons.create(params, { idempotencyKey: `create-${params.id}` });
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
      existing = await stripe.coupons.retrieve(params.id);
    }
  }
  if (existing.amount_off !== params.amount_off || existing.currency !== "usd") {
    throw new Error(`Loyalty coupon ${params.id} already exists with a different amount`);
  }
}

export async function syncLoyaltySubscription(
  supabase: LoyaltyDb,
  stripe: LoyaltyStripe,
  input: SyncLoyaltyInput,
): Promise<SyncLoyaltyResult> {
  const now = input.now ?? new Date().toISOString();
  const dryRun = input.dryRun === true;
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("plan_type, grandfathered_lifetime")
    .eq("id", input.organizationId)
    .maybeSingle();
  if (orgError) throw new Error(orgError.message);

  const orgRow = org as { plan_type?: string | null; grandfathered_lifetime?: boolean } | null;
  const lifetime = isLifetimePlan({
    planType: orgRow?.plan_type ?? null,
    grandfatheredLifetime: orgRow?.grandfathered_lifetime === true,
  });

  const { data: existing, error: rowError } = await supabase
    .from("org_subscription_loyalty")
    .select("continuous_since, reset_at, applied_discount_cents, applied_coupon_id, plan, billing_interval, stripe_subscription_id, last_status")
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (rowError) throw new Error(rowError.message);
  const row = (existing ?? null) as LoyaltyRow | null;

  let sub: Record<string, unknown>;
  try {
    sub = await stripe.subscriptions.retrieve(input.subscriptionId, { expand: ["discounts.coupon"] });
  } catch (err) {
    if (!isMissing(err)) throw err;
    sub = { id: input.subscriptionId, status: "canceled", metadata: {}, items: { data: [] } };
  }

  const status = String(sub.status ?? "canceled");
  let otherPaid = false;
  if (TERMINAL.has(status)) {
    const customerId = typeof sub.customer === "string"
      ? sub.customer
      : (sub.customer as { id?: string } | undefined)?.id;
    if (customerId) {
      const listed = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
      otherPaid = listed.data.some((other) =>
        other.id !== input.subscriptionId && (other.status === "active" || other.status === "past_due")
      );
    }
  }

  if (TERMINAL.has(status) && otherPaid) {
    return {
      organizationId: input.organizationId,
      subscriptionId: input.subscriptionId,
      action: "kept_other_subscription",
      continuousSince: row?.continuous_since ?? null,
      discountCents: row?.applied_discount_cents ?? 0,
      dryRun,
    };
  }

  const { plan, interval } = planAndInterval(sub);
  const clock = nextLoyaltyClock({
    continuousSince: row?.continuous_since ?? null,
    previousResetAt: row?.reset_at ?? null,
    status,
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    lifetime,
    plan,
    interval,
    subscriptionStart: unixToIso(sub.start_date) ?? unixToIso(sub.created),
    otherPaidSubscription: otherPaid,
    now,
  });

  const appliedDiscountCents = clock.resetReason ? 0 : (row?.applied_discount_cents ?? 0);
  const appliedCouponId = clock.resetReason ? null : (row?.applied_coupon_id ?? null);
  const metadataChanged = !row
    || row.plan !== plan
    || row.billing_interval !== interval
    || row.last_status !== status
    || row.stripe_subscription_id !== input.subscriptionId
    || row.continuous_since !== clock.continuousSince
    || (clock.resetReason != null);

  if (metadataChanged && (clock.changed || clock.continuousSince || row)) {
    const { error: writeError } = await supabase.from("org_subscription_loyalty").upsert({
      organization_id: input.organizationId,
      continuous_since: clock.continuousSince,
      stripe_subscription_id: input.subscriptionId,
      plan,
      billing_interval: interval,
      applied_discount_cents: appliedDiscountCents,
      applied_coupon_id: appliedCouponId,
      last_status: status,
      reset_at: clock.resetReason ? now : (row?.reset_at ?? null),
      reset_reason: clock.resetReason,
      updated_at: now,
    }, { onConflict: "organization_id" });
    if (writeError) throw new Error(writeError.message);
  }

  const refs = discountRefs(sub);
  if (refs.some((ref) => ref.couponId == null)) {
    return {
      organizationId: input.organizationId,
      subscriptionId: input.subscriptionId,
      action: "discounts_unexpanded",
      continuousSince: clock.continuousSince,
      discountCents: appliedDiscountCents,
      dryRun,
    };
  }

  const decision = loyaltyCouponChange({
    lifetime,
    plan,
    interval,
    continuousSince: clock.continuousSince,
    appliedDiscountCents,
    existingCouponIds: refs.map((ref) => ref.couponId).filter((id): id is string => !!id),
    now,
    renewalAt: renewalAt(sub),
    invoiceUpcoming: input.invoiceUpcoming === true,
  });

  // Only an active, renewing subscription gets a coupon change. past_due keeps
  // the clock and the coupon it already has. A scheduled cancel has no next
  // invoice, so a new loyalty coupon would not change what they pay.
  if (decision.action === "noop" || status !== "active") {
    return {
      organizationId: input.organizationId,
      subscriptionId: input.subscriptionId,
      action: status !== "active" ? (clock.resetReason ?? status) : decision.reason,
      continuousSince: clock.continuousSince,
      discountCents: decision.discountCents,
      dryRun,
    };
  }
  if (decision.action === "set" && sub.cancel_at_period_end === true) {
    return {
      organizationId: input.organizationId,
      subscriptionId: input.subscriptionId,
      action: "cancel_scheduled",
      continuousSince: clock.continuousSince,
      discountCents: decision.discountCents,
      dryRun,
    };
  }

  if (dryRun) {
    return {
      organizationId: input.organizationId,
      subscriptionId: input.subscriptionId,
      action: `dry_run_${decision.action}`,
      continuousSince: clock.continuousSince,
      discountCents: decision.discountCents,
      dryRun,
    };
  }

  const loyaltyPlan = loyaltyPlanOf(plan, interval);
  if (decision.action === "set") {
    if (!loyaltyPlan || !decision.couponId) throw new Error("Loyalty coupon is missing a plan");
    await ensureCoupon(stripe, loyaltyPlan, decision.discountCents);
  }

  const discounts = nextSubscriptionDiscounts(refs, decision.action === "set" ? decision.couponId : null);
  const keptIds = refs
    .filter((ref) => !ref.couponId || !ref.couponId.startsWith(LOYALTY_PRICING.couponPrefix))
    .map((ref) => ref.id)
    .join(".");
  await stripe.subscriptions.update(input.subscriptionId, {
    discounts,
    proration_behavior: "none",
  }, {
    idempotencyKey: `loyalty-${input.subscriptionId}-${decision.couponId ?? "clear"}-${keptIds}`.slice(0, 255),
  });

  const { error: appliedError } = await supabase.from("org_subscription_loyalty").upsert({
    organization_id: input.organizationId,
    continuous_since: clock.continuousSince,
    stripe_subscription_id: input.subscriptionId,
    plan,
    billing_interval: interval,
    applied_discount_cents: decision.discountCents,
    applied_coupon_id: decision.couponId,
    last_status: status,
    reset_at: row?.reset_at ?? null,
    reset_reason: clock.resetReason,
    updated_at: now,
  }, { onConflict: "organization_id" });
  if (appliedError) throw new Error(appliedError.message);

  return {
    organizationId: input.organizationId,
    subscriptionId: input.subscriptionId,
    action: decision.action,
    continuousSince: clock.continuousSince,
    discountCents: decision.discountCents,
    dryRun,
  };
}

export const LOYALTY_COUPON_PREFIX = LOYALTY_PRICING.couponPrefix;

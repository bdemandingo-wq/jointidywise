/**
 * Fields to copy off a Stripe subscription webhook payload.
 *
 * The payload is already in memory. Nothing here calls Stripe. Keep the
 * monthly-amount math in sync with public.platform_monthly_billed_cents.
 */

export interface SubscriptionBillingSnapshot {
  unitAmountCents: number | null;
  quantity: number | null;
  billingInterval: string | null;
  intervalCount: number | null;
  /** Null when a discount id was present but the coupon was not on the payload. */
  discountAmountCents: number | null;
  discountPercent: number | null;
  /** False when the payload listed a discount we could not read. */
  discountKnown: boolean;
  canceledAt: string | null;
  endedAt: string | null;
}

export interface MonthlyBilledCents {
  monthlyAmountCents: number | null;
  /**
   * monthly — the invoice is already one month.
   * normalized_from_annual — a year (or 12 months) divided by 12.
   * normalized_from_multi_month / _weekly / _daily — same idea.
   * unknown_interval — a unit amount with an interval we do not recognize.
   */
  amountBasis: string | null;
}

interface CouponBits {
  amountOff: number;
  percentOff: number | null;
}

function unixToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function readCoupon(coupon: unknown): CouponBits | null {
  if (!coupon || typeof coupon !== "object") return null;
  const raw = coupon as { amount_off?: unknown; percent_off?: unknown };
  const amountOff = typeof raw.amount_off === "number" && Number.isFinite(raw.amount_off) ? raw.amount_off : 0;
  const percentOff = typeof raw.percent_off === "number" && Number.isFinite(raw.percent_off) ? raw.percent_off : null;
  if (raw.amount_off == null && raw.percent_off == null) return null;
  return { amountOff, percentOff };
}

/** One discount entry. "unknown" means an id without an expanded coupon. */
function readDiscountEntry(entry: unknown): CouponBits | "unknown" | "empty" {
  if (entry == null) return "empty";
  if (typeof entry === "string") return "unknown";
  if (typeof entry !== "object") return "unknown";
  const coupon = (entry as { coupon?: unknown }).coupon;
  if (coupon == null) return "unknown";
  if (typeof coupon === "string") return "unknown";
  const bits = readCoupon(coupon);
  return bits ?? "unknown";
}

function combineDiscounts(entries: unknown[]): { amountOff: number; percentOff: number | null; known: boolean } {
  let amountOff = 0;
  let percentOff: number | null = null;
  let sawCoupon = false;
  for (const entry of entries) {
    const bits = readDiscountEntry(entry);
    if (bits === "empty") continue;
    if (bits === "unknown") return { amountOff: 0, percentOff: null, known: false };
    sawCoupon = true;
    amountOff += bits.amountOff;
    if (bits.percentOff != null) {
      // Two percent-off coupons on one subscription are not a case we store.
      // Leave the price unknown rather than invent a combined rate.
      if (percentOff != null) return { amountOff: 0, percentOff: null, known: false };
      percentOff = bits.percentOff;
    }
  }
  if (!sawCoupon) return { amountOff: 0, percentOff: null, known: true };
  return { amountOff, percentOff, known: true };
}

export function subscriptionBillingSnapshot(sub: {
  items?: {
    data?: Array<{
      quantity?: number | null;
      price?: {
        unit_amount?: number | null;
        recurring?: { interval?: string | null; interval_count?: number | null } | null;
      } | null;
    } | null> | null;
  } | null;
  discount?: unknown;
  discounts?: unknown;
  canceled_at?: number | null;
  ended_at?: number | null;
}): SubscriptionBillingSnapshot {
  const item = sub.items?.data?.[0] ?? null;
  const price = item?.price ?? null;
  const unit = typeof price?.unit_amount === "number" && Number.isFinite(price.unit_amount)
    ? Math.round(price.unit_amount)
    : null;
  const interval = typeof price?.recurring?.interval === "string" && price.recurring.interval
    ? price.recurring.interval
    : null;
  const intervalCount = typeof price?.recurring?.interval_count === "number" && price.recurring.interval_count > 0
    ? Math.round(price.recurring.interval_count)
    : interval ? 1 : null;
  const quantity = typeof item?.quantity === "number" && Number.isFinite(item.quantity)
    ? Math.round(item.quantity)
    : unit != null ? 1 : null;

  const discountEntries = Array.isArray(sub.discounts)
    ? sub.discounts
    : sub.discount != null
      ? [sub.discount]
      : [];
  const discount = combineDiscounts(discountEntries);

  return {
    unitAmountCents: unit,
    quantity,
    billingInterval: interval,
    intervalCount,
    discountAmountCents: discount.known ? discount.amountOff : null,
    discountPercent: discount.known ? discount.percentOff : null,
    discountKnown: discount.known,
    canceledAt: unixToIso(sub.canceled_at),
    endedAt: unixToIso(sub.ended_at),
  };
}

/** Columns added for the account-metrics view. Spread onto a stripe_subscriptions write. */
export function stripeSubscriptionBillingPatch(snap: SubscriptionBillingSnapshot): Record<string, unknown> {
  return {
    unit_amount_cents: snap.unitAmountCents,
    quantity: snap.quantity,
    interval_count: snap.intervalCount,
    discount_amount_cents: snap.discountAmountCents,
    discount_percent: snap.discountPercent,
    discount_known: snap.discountKnown,
    canceled_at: snap.canceledAt,
    ended_at: snap.endedAt,
    billing_interval: snap.billingInterval,
  };
}

export interface BillingGuardRow {
  billing_event_at?: string | null;
  updated_at?: string | null;
}

/** Stripe event.created (unix seconds) as an ISO timestamp. Null when missing. */
export function billingEventIso(createdSec: number | null | undefined): string | null {
  if (typeof createdSec !== "number" || !Number.isFinite(createdSec) || createdSec <= 0) return null;
  return new Date(createdSec * 1000).toISOString();
}

/**
 * True only when this event is strictly newer than the stored snapshot.
 * Compares event.created to billing_event_at, then to updated_at when the
 * event time has not been stored yet. An equal timestamp is a duplicate
 * and must not overwrite. A missing incoming time must not overwrite a
 * snapshot that already has a time. No stored row means the first write.
 */
export function incomingBillingIsNewer(
  stored: BillingGuardRow | null | undefined,
  incomingCreatedSec: number | null | undefined,
): boolean {
  if (!stored) return true;
  const storedAt = stored.billing_event_at || stored.updated_at || null;
  if (!storedAt) return true;
  const storedMs = Date.parse(storedAt);
  if (!Number.isFinite(storedMs)) return true;
  if (typeof incomingCreatedSec !== "number" || !Number.isFinite(incomingCreatedSec)) return false;
  return incomingCreatedSec * 1000 > storedMs;
}

/**
 * Price and cancel columns to write. Empty when the event is a duplicate
 * or older than the stored snapshot, so those columns are left untouched.
 */
export function guardedBillingWrite(
  stored: BillingGuardRow | null | undefined,
  snap: SubscriptionBillingSnapshot,
  incomingCreatedSec: number | null | undefined,
): Record<string, unknown> {
  if (!incomingBillingIsNewer(stored, incomingCreatedSec)) return {};
  return {
    ...stripeSubscriptionBillingPatch(snap),
    billing_event_at: billingEventIso(incomingCreatedSec),
  };
}

export interface TestModeBillingEvent {
  livemode: boolean;
  created: number;
  subscription: Parameters<typeof subscriptionBillingSnapshot>[0];
}

export interface ReplayedBillingRow {
  billing_event_at: string | null;
  unit_amount_cents: number | null;
  discount_amount_cents: number | null;
  billing_interval: string | null;
  canceled_at: string | null;
}

/**
 * Fold subscription payloads in arrival order. Test mode only: a live
 * payload throws before any write. This function does not call Stripe
 * or the network. The production webhooks accept live events and call
 * the same guardedBillingWrite.
 */
export function replayTestModeBillingEvents(events: TestModeBillingEvent[]): ReplayedBillingRow | null {
  let row: ReplayedBillingRow | null = null;
  for (const event of events) {
    if (event.livemode !== false) {
      throw new Error("replay accepts test-mode payloads only");
    }
    const snap = subscriptionBillingSnapshot(event.subscription);
    const write = guardedBillingWrite(row, snap, event.created);
    if (!row) {
      row = {
        billing_event_at: (write.billing_event_at as string | null) ?? null,
        unit_amount_cents: snap.unitAmountCents,
        discount_amount_cents: snap.discountAmountCents,
        billing_interval: snap.billingInterval,
        canceled_at: snap.canceledAt,
      };
      continue;
    }
    if (Object.keys(write).length === 0) continue;
    row = {
      billing_event_at: (write.billing_event_at as string | null) ?? row.billing_event_at,
      unit_amount_cents: snap.unitAmountCents,
      discount_amount_cents: snap.discountAmountCents,
      billing_interval: snap.billingInterval,
      canceled_at: snap.canceledAt,
    };
  }
  return row;
}

/** True when the database has not had the billing columns or refund table applied yet. */
export function isMissingBillingColumn(error: { message?: string } | null | undefined): boolean {
  const message = error?.message ?? "";
  if (!message) return false;
  return /unit_amount_cents|discount_known|discount_amount_cents|discount_percent|interval_count|canceled_at|ended_at|billing_event_at|platform_subscription_refunds|schema cache|PGRST204|42703/i.test(message);
}

function intervalMonths(interval: string | null, intervalCount: number | null): number | null {
  const count = intervalCount && intervalCount > 0 ? intervalCount : 1;
  switch ((interval ?? "").toLowerCase()) {
    case "month":
    case "monthly":
      return count;
    case "year":
    case "yearly":
    case "annual":
      return count * 12;
    case "week":
    case "weekly":
      return count * 12 / 52;
    case "day":
    case "daily":
      return count * 12 / 365;
    default:
      return null;
  }
}

export function amountBasisFor(interval: string | null, intervalCount: number | null, unitAmountCents: number | null): string | null {
  if (unitAmountCents == null) return null;
  const months = intervalMonths(interval, intervalCount);
  if (months == null) return "unknown_interval";
  const normalized = (interval ?? "").toLowerCase();
  const count = intervalCount && intervalCount > 0 ? intervalCount : 1;
  if (normalized === "year" || normalized === "yearly" || normalized === "annual" || (normalized === "month" && count === 12) || (normalized === "monthly" && count === 12)) {
    return "normalized_from_annual";
  }
  if ((normalized === "month" || normalized === "monthly") && count === 1) return "monthly";
  if (normalized === "month" || normalized === "monthly") return "normalized_from_multi_month";
  if (normalized === "week" || normalized === "weekly") return "normalized_from_weekly";
  if (normalized === "day" || normalized === "daily") return "normalized_from_daily";
  return "unknown_interval";
}

/**
 * Recurring price after discount, divided into a month.
 *
 * The discount is taken off the invoice first, then the result is divided.
 * A $120 yearly coupon therefore reduces the monthly figure by $10.
 * Null discount inputs mean "no discount", not "unknown". Callers that
 * could not read a coupon pass a null unit amount instead.
 */
export function normalizeMonthlyBilledCents(input: {
  unitAmountCents: number | null;
  quantity?: number | null;
  billingInterval: string | null;
  intervalCount?: number | null;
  discountPercent?: number | null;
  discountAmountCents?: number | null;
}): MonthlyBilledCents {
  const basis = amountBasisFor(input.billingInterval, input.intervalCount ?? null, input.unitAmountCents);
  if (input.unitAmountCents == null || !Number.isFinite(input.unitAmountCents)) {
    return { monthlyAmountCents: null, amountBasis: null };
  }
  const months = intervalMonths(input.billingInterval, input.intervalCount ?? null);
  if (months == null || months <= 0) {
    return { monthlyAmountCents: null, amountBasis: "unknown_interval" };
  }
  const quantity = input.quantity == null ? 1 : input.quantity;
  const percent = input.discountPercent ?? 0;
  const amountOff = input.discountAmountCents ?? 0;
  const gross = input.unitAmountCents * quantity;
  const period = gross * (1 - percent / 100) - amountOff;
  const monthly = Math.round(period / months);
  return {
    monthlyAmountCents: Math.max(0, monthly),
    amountBasis: basis,
  };
}

export interface SaasRefundDraft {
  stripeRefundId: string;
  stripeChargeId: string;
  stripeCustomerId: string | null;
  stripeInvoiceId: string | null;
  amountCents: number | null;
  currency: string | null;
  refundedAt: string;
}

/**
 * Refund rows from a charge.refunded payload. No Stripe request.
 * When the payload omits the refund list, one row is stored under a
 * synthetic id so the date is not dropped.
 */
export function saasRefundDrafts(charge: {
  id?: string | null;
  customer?: unknown;
  invoice?: unknown;
  currency?: string | null;
  refunds?: { data?: Array<{ id?: string; amount?: number | null; currency?: string | null; created?: number | null }> | null } | null;
}, eventCreatedSec: number | null): SaasRefundDraft[] {
  if (!charge.id) return [];
  const customerId = typeof charge.customer === "string"
    ? charge.customer
    : (charge.customer && typeof charge.customer === "object" && "id" in charge.customer && typeof (charge.customer as { id?: unknown }).id === "string"
      ? (charge.customer as { id: string }).id
      : null);
  const invoiceId = typeof charge.invoice === "string" ? charge.invoice : null;
  const currency = typeof charge.currency === "string" ? charge.currency.toLowerCase() : null;
  const eventIso = unixToIso(eventCreatedSec) ?? new Date(0).toISOString();
  const listed = charge.refunds?.data ?? [];
  const drafts: SaasRefundDraft[] = [];
  for (const refund of listed) {
    if (!refund?.id) continue;
    drafts.push({
      stripeRefundId: refund.id,
      stripeChargeId: charge.id,
      stripeCustomerId: customerId,
      stripeInvoiceId: invoiceId,
      amountCents: typeof refund.amount === "number" ? refund.amount : null,
      currency: typeof refund.currency === "string" ? refund.currency.toLowerCase() : currency,
      refundedAt: unixToIso(refund.created) ?? eventIso,
    });
  }
  if (drafts.length > 0) return drafts;
  return [{
    stripeRefundId: `${charge.id}:unitemized`,
    stripeChargeId: charge.id,
    stripeCustomerId: customerId,
    stripeInvoiceId: invoiceId,
    amountCents: null,
    currency,
    refundedAt: eventIso,
  }];
}

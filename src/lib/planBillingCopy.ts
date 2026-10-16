import { formatInOrgTz } from "./orgDateRange.ts";
import { LIFETIME_PRICE } from "./publicPlans.ts";
import { MIN_STRIPE_TRIAL_LEAD_SEC } from "../../supabase/functions/_shared/trial-end.ts";

// orgDateRange.ts and publicPlans.ts have zero imports, so node:test can
// load this file without Vite or the @/ alias.

/**
 * Settings plan cards. Basic and Pro reuse the existing monthly checkout
 * and plan-change calls. Custom has no in-app checkout on this screen.
 */
export type PlanBillingAction = "checkout" | "contact";

export function planBillingAction(planId: string): PlanBillingAction {
  return planId === "custom" ? "contact" : "checkout";
}

export function renewalDisclosure(
  price: number,
  interval: "monthly" | "yearly" = "monthly",
): string {
  if (!(price > 0)) return "";
  const cadence = interval === "yearly" ? "yearly" : "monthly";
  return `Renews ${cadence} at $${price} until you cancel. Cancel anytime in Settings.`;
}

/** Shown under a downgrade button. The section footer stays as well. */
export const DOWNGRADE_EFFECT_NOTE = "Takes effect at your next renewal.";

/**
 * Calendar date of a stored trial end, in the organisation timezone.
 * A trial that ends Nov 13 at 11pm Eastern is Nov 13 there and Nov 14 in UTC.
 * A missing or invalid timestamp does not invent a date.
 */
export function trialEndDateLabel(
  trialEndIso: string | null | undefined,
  timeZone: string,
  withYear = false,
): string | null {
  if (!trialEndIso || !timeZone) return null;
  const end = Date.parse(trialEndIso);
  if (!Number.isFinite(end)) return null;
  try {
    return formatInOrgTz(new Date(end), timeZone, {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" as const } : {}),
    });
  } catch {
    return null;
  }
}

/**
 * Shown when the server preview says bill_now and the discounted amount
 * is missing. The dollar figure is never a catalog price.
 */
export const CHARGE_TODAY_NO_AMOUNT = "You'll be charged today.";

/** Drop null and blank copy so a caller does not render an empty paragraph. */
export function visibleBillingLine(line: string | null | undefined): string | null {
  if (typeof line !== "string") return null;
  const trimmed = line.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Dollars for a server preview. Whole dollars stay "$97". A half stays "$48.50". Thousands use a comma ("$1,970"). */
export function formatChargeDollars(cents: number): string | null {
  if (!Number.isInteger(cents) || cents < 0) return null;
  const dollars = cents / 100;
  const formatted = Number.isInteger(dollars)
    ? dollars.toLocaleString("en-US")
    : dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${formatted}`;
}

/**
 * Charge sentence from preview-subscription-charge. The browser does not
 * decide bill-now. The dollar amount is amount_cents_after_discounts.
 * Until that amount is known, a today charge has no dollar figure.
 */
export function chargeLineFromPreview(opts: {
  billNow: boolean;
  firstChargeAt: string | null;
  amountCents: number | null;
  timeZone: string;
}): string | null {
  if (opts.billNow) {
    if (opts.amountCents == null) return CHARGE_TODAY_NO_AMOUNT;
    const amount = formatChargeDollars(opts.amountCents);
    if (!amount) return CHARGE_TODAY_NO_AMOUNT;
    return `You'll be charged ${amount} today.`;
  }
  const date = trialEndDateLabel(opts.firstChargeAt, opts.timeZone, true);
  if (!date) return null;
  return `Your first charge is ${date}.`;
}

/**
 * How long to wait before asking preview-subscription-charge again.
 * The cached bill-now answer goes stale when the trial crosses the same
 * 48-hour lead create-subscription uses. A future boundary waits until
 * that moment. A boundary the client clock has already passed is asked
 * again in a minute, because the server clock is still the decision.
 */
export function chargePreviewRefetchMs(
  previews: Record<string, { bill_now: boolean; first_charge_at: string | null } | undefined> | null | undefined,
  nowMs = Date.now(),
): number | false {
  if (!previews) return false;
  const leadMs = MIN_STRIPE_TRIAL_LEAD_SEC * 1000;
  let wait = Infinity;
  for (const row of Object.values(previews)) {
    if (!row || row.bill_now || !row.first_charge_at) continue;
    const boundary = Date.parse(row.first_charge_at) - leadMs;
    if (!Number.isFinite(boundary)) continue;
    const delta = boundary - nowMs;
    wait = Math.min(wait, delta <= 0 ? 60_000 : delta);
  }
  if (!Number.isFinite(wait)) return false;
  return Math.max(1000, Math.min(wait, 24 * 60 * 60 * 1000));
}

/**
 * Per-card today sentence. Call it only for an org trial that can check
 * out on this plan. It renders only after preview-subscription-charge
 * returns bill_now true. A missing preview, a load, or an error returns
 * null so the card shows no charge line. When that preview bills today
 * and the discounted amount is missing, the sentence is "You'll be
 * charged today." A preview that bills later returns null so the date
 * line can stand on its own.
 */
export function todayChargeCopy(
  preview: {
    bill_now: boolean;
    first_charge_at: string | null;
    amount_cents_after_discounts: number | null;
  } | null | undefined,
  timeZone: string,
): string | null {
  if (!preview?.bill_now) return null;
  return chargeLineFromPreview({
    billNow: true,
    firstChargeAt: preview.first_charge_at,
    amountCents: preview.amount_cents_after_discounts,
    timeZone,
  });
}

/** Dashboard home copy when the account cannot use the product. */
export function expiredTrialNudgeCopy(
  trialEndIso: string | null | undefined,
  nowMs = Date.now(),
): {
  title: string;
  detail: string;
} {
  const end = trialEndIso ? Date.parse(trialEndIso) : NaN;
  // A future trial_end is still running. Only a timestamp at or before now
  // is an ended trial. hasFullAccess stays true while trial_active is set,
  // so this copy is not what an active trial sees.
  const ended = Number.isFinite(end) && end <= nowMs;
  const offer = `Lifetime is $${LIFETIME_PRICE} once.`;
  if (ended) {
    return {
      title: "Your trial has ended",
      detail: `Pick a plan to keep using the dashboard. Nothing here extends a trial that has already ended. ${offer}`,
    };
  }
  return {
    title: "Pick a plan to unlock the dashboard",
    detail: `Basic is $49 a month and Pro is $97 a month. ${offer}`,
  };
}

/**
 * Footer under the plan grid when the account cannot change a Stripe plan.
 * Native is first: a trial or a failed payment still cannot enter a card
 * in the app, so those orgs must not see Checkout or portal copy.
 */
export function planChoicesFooter(opts: {
  canShowPaymentFlows: boolean;
  paymentFailed: boolean;
  orgTrial: boolean;
}): string {
  if (!opts.canShowPaymentFlows) {
    return "Subscriptions are managed at jointidywise.com. This app cannot take a card.";
  }
  if (opts.paymentFailed) {
    return "The last payment failed. Update payment method opens Stripe's billing portal.";
  }
  if (opts.orgTrial) {
    return "Your trial is active. Choosing Basic or Pro opens Stripe Checkout when you want to upgrade. The card is entered on Stripe, and your trial stays in place until that checkout finishes.";
  }
  return "There is no card on file, so Basic and Pro open Stripe Checkout. The card is entered on Stripe, not in this screen.";
}

/** Lifetime and grandfathered accounts see the current plan only. */
export function showPlanChoices(opts: { lifetime: boolean; grandfathered: boolean }): boolean {
  return !opts.lifetime && !opts.grandfathered;
}

/**
 * Lifetime spots render only when both the remaining count and the cap
 * are real numbers, and the remaining count does not exceed the cap.
 * A missing or impossible read stays hidden. This does not invent a cap.
 */
export function lifetimeSpotsToShow(
  remaining: number | null | undefined,
  total: number | null | undefined,
): { remaining: number; total: number } | null {
  if (typeof remaining !== "number" || typeof total !== "number") return null;
  if (!Number.isInteger(remaining) || !Number.isInteger(total)) return null;
  if (total < 1 || remaining < 0 || remaining > total) return null;
  return { remaining, total };
}

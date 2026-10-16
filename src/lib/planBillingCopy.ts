import { formatInOrgTz } from "./orgDateRange.ts";
import { LIFETIME_PRICE } from "./publicPlans.ts";
import { stripeTrialEndUnix } from "../../supabase/functions/_shared/trial-end.ts";

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
 * True when checkout will bill on completion. Stripe rejects a trial_end
 * inside 48 hours, and create-subscription then charges immediately.
 * A missing or invalid timestamp is not treated as "charge today".
 */
export function trialChargesOnSelection(
  trialEndIso: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!trialEndIso || !Number.isFinite(Date.parse(trialEndIso))) return false;
  return stripeTrialEndUnix(trialEndIso, nowMs) == null;
}

/**
 * Trial users choosing a plan. The date is the org-local trial end already
 * stored on the subscription (profiles.trial_ends_at via check-subscription).
 * Inside 48 hours the first charge is today, at this plan's price.
 */
export function trialFirstChargeLine(opts: {
  trialEndIso: string | null | undefined;
  timeZone: string;
  price: number;
  nowMs?: number;
}): string | null {
  const nowMs = opts.nowMs ?? Date.now();
  if (!opts.trialEndIso || !Number.isFinite(Date.parse(opts.trialEndIso))) return null;
  if (trialChargesOnSelection(opts.trialEndIso, nowMs)) {
    if (!(opts.price > 0)) return null;
    return `You'll be charged $${opts.price} today.`;
  }
  const date = trialEndDateLabel(opts.trialEndIso, opts.timeZone, true);
  if (!date) return null;
  return `If you choose a plan now, your first charge is ${date}.`;
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

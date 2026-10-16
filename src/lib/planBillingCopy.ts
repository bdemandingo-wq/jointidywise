import { formatInOrgTz } from "./orgDateRange.ts";
import { LIFETIME_PRICE } from "./publicPlans.ts";

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

export function renewalDisclosure(monthlyPrice: number): string {
  return `Renews monthly at $${monthlyPrice} until you cancel.`;
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
): string | null {
  if (!trialEndIso || !timeZone) return null;
  const end = Date.parse(trialEndIso);
  if (!Number.isFinite(end)) return null;
  try {
    return formatInOrgTz(new Date(end), timeZone, { month: "short", day: "numeric" });
  } catch {
    return null;
  }
}

/**
 * Trial copy names when Pro access ends. It does not name a first charge.
 *
 * create-subscription already sets Stripe trial_end to profiles.trial_ends_at
 * only when that instant is at least 48 hours away. Inside 48 hours it bills
 * on completion. Promising "your first charge is {trial end}" would be wrong
 * for that case, so this line never says it.
 */
export function trialChargeLine(opts: {
  endDate: string | null;
  daysLeft: number | null;
}): string {
  const days = opts.daysLeft == null
    ? ""
    : opts.daysLeft === 1
      ? " 1 day left."
      : ` ${opts.daysLeft} days left.`;
  if (!opts.endDate) return `Free trial of Pro.${days}`;
  return `Free trial of Pro until ${opts.endDate}.${days}`;
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

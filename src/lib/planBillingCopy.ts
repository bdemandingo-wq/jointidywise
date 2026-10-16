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
 * Calendar date of a stored trial end. UTC so the label matches the
 * timestamp's date and does not shift with the device timezone.
 */
export function trialEndDateLabel(trialEndIso: string | null | undefined): string | null {
  if (!trialEndIso) return null;
  const end = Date.parse(trialEndIso);
  if (!Number.isFinite(end)) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(end));
}

/**
 * Trial copy names the real end date twice: when Pro access ends, and
 * when the first charge happens if they add a card. daysLeft stays.
 * A missing timestamp does not invent a date.
 */
export function trialChargeLine(opts: {
  chargeDate: string | null;
  daysLeft: number | null;
}): string {
  const days = opts.daysLeft == null
    ? ""
    : opts.daysLeft === 1
      ? " 1 day left."
      : ` ${opts.daysLeft} days left.`;
  if (!opts.chargeDate) return `Free trial of Pro.${days}`;
  return `Free trial of Pro until ${opts.chargeDate}. Add a card and your first charge is ${opts.chargeDate}.${days}`;
}

/** Lifetime and grandfathered accounts see the current plan only. */
export function showPlanChoices(opts: { lifetime: boolean; grandfathered: boolean }): boolean {
  return !opts.lifetime && !opts.grandfathered;
}

/**
 * Lifetime spots render only when both the remaining count and the cap
 * are real numbers. A missing read stays hidden. This does not invent a cap.
 */
export function lifetimeSpotsToShow(
  remaining: number | null | undefined,
  total: number | null | undefined,
): { remaining: number; total: number } | null {
  if (typeof remaining !== "number" || typeof total !== "number") return null;
  if (!Number.isInteger(remaining) || !Number.isInteger(total)) return null;
  if (total < 1 || remaining < 0) return null;
  return { remaining, total };
}

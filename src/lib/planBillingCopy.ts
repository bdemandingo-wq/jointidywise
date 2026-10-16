import { TRIAL_DAYS } from "./trialOffer.ts";

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

/**
 * New org trials are TRIAL_DAYS of Pro. daysLeft is the live clock
 * (null when the end timestamp is missing). The length and the clock
 * are both shown so a shortened existing trial is not described as
 * having the full length left.
 */
export function trialStatusLine(daysLeft: number | null): string {
  const offer = `Free trial: ${TRIAL_DAYS} days of Pro.`;
  if (daysLeft == null) return offer;
  const left = daysLeft === 1 ? "1 day left." : `${daysLeft} days left.`;
  return `${offer} ${left}`;
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

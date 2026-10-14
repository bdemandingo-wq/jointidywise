/**
 * In-app upgrade during an org trial.
 *
 * The card-free 30 days live on profiles.trial_ends_at. When that user
 * adds a card, Stripe's trial_end is that exact unix second — never a
 * later whole-day boundary, and never a fresh trial_period_days. Checkout
 * Stripe's checkout badge floors whole days ("29 days free" on day 0).
 * Display uses ceil and this function still returns the exact second.
 *
 * Stripe rejects trial_end inside 48 hours. That case returns null and
 * the caller collects a card and bills immediately.
 */

const DAY_SEC = 24 * 60 * 60;
export const MIN_STRIPE_TRIAL_LEAD_SEC = 48 * 60 * 60;

export function stripeTrialEndUnix(
  trialEndsAt: string | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!trialEndsAt) return null;
  const endsMs = Date.parse(trialEndsAt);
  if (!Number.isFinite(endsMs)) return null;
  const trialEnd = Math.floor(endsMs / 1000);
  const stripeNow = Math.floor(nowMs / 1000);
  if (trialEnd - stripeNow < MIN_STRIPE_TRIAL_LEAD_SEC) return null;
  return trialEnd;
}

const DAY_MS = DAY_SEC * 1000;
export const CARD_FREE_TRIAL_MS = 30 * DAY_MS;

export type CardFreeTrial = {
  trialEndIso: string | null;
  active: boolean;
  /** trial_ends_at was missing. The caller may persist trialEndIso when active. */
  stampMissing: boolean;
};

/**
 * Access clock when Stripe has no active subscription.
 * A stored trial_ends_at is kept, even if it is already past.
 * A missing stamp is created_at + 30 days. This function does not
 * lengthen a short stamp; extendShortCardFreeTrial does that, and only
 * when the caller has already decided the org is still on the card-free trial.
 */
export function resolveCardFreeTrial(opts: {
  trialEndsAt: string | null | undefined;
  createdAt: string | null | undefined;
  nowMs?: number;
}): CardFreeTrial {
  const now = opts.nowMs ?? Date.now();
  const stored = opts.trialEndsAt ? Date.parse(opts.trialEndsAt) : NaN;
  if (Number.isFinite(stored)) {
    return {
      trialEndIso: new Date(stored).toISOString(),
      active: now < stored,
      stampMissing: false,
    };
  }
  const start = opts.createdAt ? Date.parse(opts.createdAt) : NaN;
  if (!Number.isFinite(start)) {
    return { trialEndIso: null, active: false, stampMissing: true };
  }
  const end = start + CARD_FREE_TRIAL_MS;
  return {
    trialEndIso: new Date(end).toISOString(),
    active: now < end,
    stampMissing: true,
  };
}

export type ExtendedCardFreeTrial = CardFreeTrial & {
  /** Stored end was earlier than created_at + 30 days. Never true when that would move the end sooner. */
  extended: boolean;
};

/**
 * created_at + 30 days when that instant is later than the stored end
 * and still in the future. A longer stored end is returned unchanged.
 * A missing stamp is not "extended"; resolveCardFreeTrial already
 * fills it, and the caller inserts that once.
 */
export function extendShortCardFreeTrial(opts: {
  trialEndsAt: string | null | undefined;
  createdAt: string | null | undefined;
  nowMs?: number;
}): ExtendedCardFreeTrial {
  const resolved = resolveCardFreeTrial(opts);
  const now = opts.nowMs ?? Date.now();
  const start = opts.createdAt ? Date.parse(opts.createdAt) : NaN;
  const stored = opts.trialEndsAt ? Date.parse(opts.trialEndsAt) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(stored)) {
    return { ...resolved, extended: false };
  }
  const target = start + CARD_FREE_TRIAL_MS;
  if (target <= stored || target <= now) {
    return { ...resolved, extended: false };
  }
  return {
    trialEndIso: new Date(target).toISOString(),
    active: true,
    stampMissing: false,
    extended: true,
  };
}

/**
 * Days to show for a trial_end. Ceil, so a trial that ends in just under
 * 30 days shows 30. The timestamp itself is not rounded.
 */
export function stripeCheckoutTrialDays(trialEndUnix: number, nowMs: number): number {
  const remainingSec = trialEndUnix - Math.floor(nowMs / 1000);
  if (remainingSec <= 0) return 0;
  return Math.ceil(remainingSec / DAY_SEC);
}

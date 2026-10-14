/**
 * Onboarding qualifying answers — shape, plan recommendation, and DB payload.
 *
 * Deliberately ZERO imports and no browser globals, so `node:test` can load it
 * directly. Tests: src/lib/onboardingAnswers.test.ts
 *
 * WHY THIS EXISTS. Onboarding asks qualifying questions whose answers were
 * `string`. Making them multi-select turns them into `string[]`, and every
 * existing consumer breaks SILENTLY on that change — nothing throws, the page
 * renders, and the damage is invisible:
 *
 *   ChoosePlanPage:125  a.teamSize === 'large'       false for ['large']
 *   ChoosePlanPage:169  PAIN_PITCH[a.biggestPain]    undefined for an array
 *   ChoosePlanPage:361  personal.teamSize ? x : y    [] is TRUTHY
 *   OnboardingPage:531  PAIN_BUILD_LINE[...]         undefined, silent fallback
 *
 * Those live inside JSX and vitest is not installed, so they were untestable
 * where they sat. Moving the decisions here is what makes them assertable.
 *
 * See docs/superpowers/plans/2026-08-13-onboarding-acquisition-question.md
 */

/** The five qualifying questions, in the order they are asked. */
export const QUALIFYING_KEYS = [
  "teamSize",
  "bookingMethod",
  "biggestPain",
  "revenueGoal",
  "howHeard",
] as const;

export type QualifyingKey = (typeof QUALIFYING_KEYS)[number];

/** Every answer is an array — the questions are multi-select. */
export type OnboardingAnswers = Record<QualifyingKey, string[]>;

/** Options for "How did you hear about us?", in display order. */
export const HOW_HEARD_VALUES = [
  "fb_ad",
  "fb_group",
  "instagram",
  "tiktok",
  "google",
  "referral",
  "other",
] as const;

/**
 * Canonical pain order — the order the cards are declared in, NOT the order the
 * user tapped them. PAIN_PITCH and PAIN_BUILD_LINE are keyed by one pain, so
 * with multi-select the pick has to be deterministic or the same answers produce
 * different copy on different runs.
 */
const PAIN_ORDER = ["scheduling", "payments", "noshows", "everything"] as const;

/**
 * Turn anything into the internal shape.
 *
 * The only place untrusted input crosses the boundary, and it has two jobs
 * beyond type-narrowing:
 *
 *   1. Accept the LEGACY single-string shape. sessionStorage survives a deploy,
 *      so a user part-way through onboarding when the new build ships still has
 *      `{teamSize: "solo"}` sitting there. Dropping it would silently reset
 *      answers they already gave.
 *   2. Drop unknown keys. The result is written verbatim into a jsonb column and
 *      sessionStorage is user-writable, so anything it happens to contain would
 *      otherwise be persisted.
 */
export function normalizeAnswers(raw: unknown): OnboardingAnswers {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as OnboardingAnswers;
  for (const key of QUALIFYING_KEYS) {
    const value = source[key];
    if (typeof value === "string") {
      out[key] = value ? [value] : [];
    } else if (Array.isArray(value)) {
      out[key] = value.filter((v): v is string => typeof v === "string" && v.length > 0);
    } else {
      out[key] = [];
    }
  }
  return out;
}

/** True when the user actually selected something. `[]` is truthy — this is not. */
export function hasAnswer(v: string[] | undefined): boolean {
  return Array.isArray(v) && v.length > 0;
}

/** Every element of `values` is in `allowed`, and there is at least one. */
function nonEmptySubsetOf(values: string[], allowed: readonly string[]): boolean {
  return values.length > 0 && values.every((v) => allowed.includes(v));
}

/**
 * Which plan to recommend on the paywall.
 *
 * The middle rule is subset containment, not `.includes()`, and that is the whole
 * reason multi-select needed a decision rather than a find-and-replace. Someone
 * who ticks BOTH "Just me" and "5-15 cleaners" has told you the larger number.
 * Selling them the smallest plan on the strength of the smaller tick is wrong.
 *
 * Stated as an invariant, which the spec asserts directly: ticking one more box
 * can move you up a plan or leave you where you are. It must never move you down.
 */
export function recommendPlan(a: OnboardingAnswers): "basic" | "pro" | "custom" {
  if (a.teamSize.includes("large") || a.revenueGoal.includes("50k")) return "custom";
  if (nonEmptySubsetOf(a.teamSize, ["solo"]) && nonEmptySubsetOf(a.revenueGoal, ["5k"])) {
    return "basic";
  }
  return "pro";
}

/**
 * The single pain used for personalised copy, or null when none was selected.
 *
 * Null rather than undefined or "" so a caller's `pain ? PITCH[pain] : null`
 * falls through to the default line instead of rendering an empty pitch.
 */
export function primaryPain(a: OnboardingAnswers): string | null {
  for (const pain of PAIN_ORDER) {
    if (a.biggestPain.includes(pain)) return pain;
  }
  return a.biggestPain[0] ?? null;
}

/**
 * What gets written to organizations.onboarding_answers.
 *
 * All five keys are always present, even when unanswered, so a later query can
 * tell "skipped this question" from "signed up before the question existed" —
 * the second is NULL for the whole column.
 *
 * Plain arrays only. A Set or Map here would survive in memory and arrive in
 * Postgres as `{}` (CLAUDE.md rule 1, same failure as the persisted query cache).
 */
export function buildAnswersPayload(a: OnboardingAnswers): Record<QualifyingKey, string[]> {
  const payload = {} as Record<QualifyingKey, string[]>;
  for (const key of QUALIFYING_KEYS) {
    payload[key] = [...(a[key] ?? [])];
  }
  return payload;
}

// ─── ADMIN DISPLAY ──────────────────────────────────────────────────────────
// Used by the Signups tab of Platform Analytics. Everything below is read-only
// formatting of a value that arrives as `unknown` from an edge function.
//
// The governing fact: onboarding_answers is NULL for nearly every organisation
// and always will be. The column landed 2026-08-13 and was deliberately never
// backfilled, so "no data" is the normal case and must be presented as a stated
// fact rather than as an empty panel.

/**
 * Admin-facing labels. Deliberately SEPARATE from the wizard's conversational
 * labels in OnboardingPage — the two surfaces differ, and an admin table wants
 * short strings where the wizard wants persuasive ones.
 *
 * The duplication is real. It is mitigated rather than denied: labelForOption
 * falls back to the raw slug, so an option added to the wizard but not here
 * shows up as `fb_reels` — visible, actionable, and obviously ours to fix —
 * instead of rendering blank and reading as a bug.
 */
export const OPTION_LABELS: Record<QualifyingKey, Record<string, string>> = {
  teamSize: {
    solo: "Just me",
    small: "Me + 1-4 cleaners",
    mid: "5-15 cleaners",
    large: "15+ cleaners",
  },
  bookingMethod: {
    manual: "Calls & texts",
    dms: "Instagram / Facebook DMs",
    referrals: "Word of mouth",
    software: "Another software",
  },
  biggestPain: {
    scheduling: "Scheduling & dispatch",
    payments: "Chasing payments",
    noshows: "No-shows",
    everything: "Doing everything alone",
  },
  revenueGoal: {
    "5k": "First $5k/mo",
    "10k": "Steady $10k/mo",
    "25k": "Past $25k/mo",
    "50k": "$50k+/mo",
  },
  howHeard: {
    fb_ad: "Facebook ad",
    fb_group: "Facebook group",
    instagram: "Instagram",
    tiktok: "TikTok",
    google: "Google search",
    referral: "Friend or referral",
    other: "Other",
  },
};

/** Short question labels for the detail popover. */
export const QUESTION_LABELS: Record<QualifyingKey, string> = {
  teamSize: "Team size",
  bookingMethod: "Bookings arrive via",
  biggestPain: "Biggest pain",
  revenueGoal: "12-month goal",
  howHeard: "Heard about us via",
};

/**
 * Did this organisation answer anything at all?
 *
 * False for a null column AND for a row whose five arrays are all empty — those
 * are structurally identical after normalisation, and counting the second as
 * "has data" would make the coverage figure overstate itself. A number that
 * lies is worse than no number.
 */
export function hasOnboardingData(raw: unknown): boolean {
  const a = normalizeAnswers(raw);
  return QUALIFYING_KEYS.some((k) => a[k].length > 0);
}

/** A label, or the raw slug when the vocabulary has drifted. Never empty. */
export function labelForOption(key: QualifyingKey, value: string): string {
  return OPTION_LABELS[key]?.[value] ?? value;
}

/** Declared options in display order, used to make ordering deterministic. */
const CANONICAL_ORDER: Record<QualifyingKey, readonly string[]> = {
  teamSize: ["solo", "small", "mid", "large"],
  bookingMethod: ["manual", "dms", "referrals", "software"],
  biggestPain: ["scheduling", "payments", "noshows", "everything"],
  revenueGoal: ["5k", "10k", "25k", "50k"],
  howHeard: HOW_HEARD_VALUES,
};

/** Selected values in canonical order; anything unrecognised keeps its position at the end. */
function inCanonicalOrder(key: QualifyingKey, values: string[]): string[] {
  const known = CANONICAL_ORDER[key].filter((v) => values.includes(v));
  const unknown = values.filter((v) => !CANONICAL_ORDER[key].includes(v));
  return [...known, ...unknown];
}

/**
 * The one source to show in the row, plus how many more there were.
 *
 * Ordered canonically rather than by stored order, so the same organisation
 * never reads differently on two page loads.
 */
export function summariseSource(raw: unknown): { primary: string; extraCount: number } | null {
  const selected = inCanonicalOrder("howHeard", normalizeAnswers(raw).howHeard);
  if (selected.length === 0) return null;
  return {
    primary: labelForOption("howHeard", selected[0]),
    extraCount: selected.length - 1,
  };
}

/**
 * Every answered question, labelled, for the detail popover. Unanswered
 * questions are omitted rather than rendered blank — a row of empty values reads
 * as broken, which is the failure this whole display is designed around.
 */
export function describeAnswers(
  raw: unknown,
): Array<{ key: QualifyingKey; question: string; labels: string[] }> {
  const a = normalizeAnswers(raw);
  return QUALIFYING_KEYS.filter((k) => a[k].length > 0).map((k) => ({
    key: k,
    question: QUESTION_LABELS[k],
    labels: inCanonicalOrder(k, a[k]).map((v) => labelForOption(k, v)),
  }));
}

/**
 * How many rows carry any answers. This figure is what turns "almost everything
 * is blank" from looking like a defect into being a measured statement.
 */
export function countWithOnboardingData(rows: Array<{ onboarding_answers?: unknown }>): number {
  return rows.reduce((n, r) => (hasOnboardingData(r.onboarding_answers) ? n + 1 : n), 0);
}

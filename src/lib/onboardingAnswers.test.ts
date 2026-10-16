// Onboarding qualifying answers — shape, persistence payload, and the plan
// recommendation derived from them.
//
// Runner: node:test (vitest is not installed in this repo; 15 other specs in
// src/lib use this same runner). The module under test must have ZERO imports:
//
//   node --experimental-strip-types --test src/lib/onboardingAnswers.test.ts
//
// WHY THIS MODULE EXISTS. Onboarding asks four qualifying questions and throws
// every answer away — they go to sessionStorage and are read once by
// /choose-plan. This change adds a fifth question ("How did you hear about
// us?"), persists all five to organizations.onboarding_answers, and turns every
// question multi-select.
//
// That last part is what makes a spec necessary rather than nice-to-have. The
// answers change shape from string to string[], and EVERY existing consumer
// fails silently on the new shape:
//
//   ChoosePlanPage:125  a.teamSize === 'large'      -> false for ['large']
//   ChoosePlanPage:169  PAIN_PITCH[a.biggestPain]   -> undefined for an array
//   ChoosePlanPage:361  personal.teamSize ? ... : ..-> [] is TRUTHY, so an
//                                                      unanswered question
//                                                      reads as answered
//   OnboardingPage:531  PAIN_BUILD_LINE[...]        -> undefined, silent fallback
//
// Not one of those throws. The page renders, everyone quietly gets 'pro', and
// the personalised copy quietly disappears. Pulling the logic into one pure
// module is what makes those four cases assertable at all.
//
// See docs/superpowers/plans/2026-08-13-onboarding-acquisition-question.md
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUALIFYING_KEYS,
  HOW_HEARD_VALUES,
  normalizeAnswers,
  recommendPlan,
  primaryPain,
  hasAnswer,
  buildAnswersPayload,
  // Admin display — see the ADMIN DISPLAY section at the foot of this file.
  hasOnboardingData,
  labelForOption,
  summariseSource,
  describeAnswers,
  countWithOnboardingData,
  chosenHowHeard,
  hasHowHeardAnswer,
  howHeardAnsweredSummary,
  isHowHeardComplete,
  normalizeHowHeardOther,
  readHowHeardOther,
  shouldAskHowHeard,
  HOW_HEARD_OTHER_MAX,
  type OnboardingAnswers,
} from "./onboardingAnswers.ts";

/** Rank for the monotonicity invariant. Bigger = more expensive plan. */
const RANK: Record<string, number> = { basic: 0, pro: 1, custom: 2 };

// ─── the shape boundary ─────────────────────────────────────────────────────
// normalizeAnswers is the ONLY place the outside world's untrusted shape turns
// into the internal one. sessionStorage is user-writable and survives a deploy,
// so it can legitimately hold yesterday's format.

test("a legacy single-string answer is read as a one-element array", () => {
  // The deploy-window case, and the reason this cannot just be a cast: a user
  // part-way through onboarding when the new build ships has the OLD shape
  // sitting in sessionStorage. Dropping it would silently reset their answers.
  const r = normalizeAnswers({ teamSize: "solo", revenueGoal: "5k" });
  assert.deepEqual(r.teamSize, ["solo"]);
  assert.deepEqual(r.revenueGoal, ["5k"]);
});

test("an array answer passes through and non-strings inside it are dropped", () => {
  const r = normalizeAnswers({ teamSize: ["solo", 42, null, "mid"] });
  assert.deepEqual(r.teamSize, ["solo", "mid"]);
});

test("every key is always present as an array, never undefined", () => {
  // Consumers index these directly. One undefined turns a .includes() into a
  // TypeError at the paywall — the single worst place in the funnel to throw.
  const r = normalizeAnswers({});
  for (const k of QUALIFYING_KEYS) {
    assert.ok(Array.isArray(r[k]), `${k} should be an array, got ${typeof r[k]}`);
    assert.equal(r[k].length, 0);
  }
});

test("garbage input yields empty answers rather than throwing", () => {
  for (const junk of [null, undefined, "nonsense", 7, [], true]) {
    const r = normalizeAnswers(junk);
    assert.equal(r.teamSize.length, 0, `failed on ${JSON.stringify(junk)}`);
  }
});

test("unknown keys are dropped, not carried into the database", () => {
  // The normalised object is what gets written to organizations.onboarding_answers.
  // Anything sessionStorage happens to contain would otherwise be persisted
  // verbatim, and sessionStorage is user-writable.
  const r = normalizeAnswers({ teamSize: ["solo"], evil: ["x"], businessName: "Acme" });
  assert.deepEqual(Object.keys(r).sort(), [...QUALIFYING_KEYS].sort());
});

// ─── the new question ───────────────────────────────────────────────────────

test("howHeard is one of the five qualifying keys", () => {
  assert.ok(QUALIFYING_KEYS.includes("howHeard"));
  assert.equal(QUALIFYING_KEYS.length, 5);
});

test("howHeard offers the single-choice options, with organic social first", () => {
  assert.deepEqual(
    [...HOW_HEARD_VALUES],
    ["tiktok", "instagram", "facebook", "reddit", "google", "referral", "other"],
  );
});

test("a legacy howHeard array is still read", () => {
  const fromArray = normalizeAnswers({ howHeard: ["fb_ad", "tiktok"] });
  assert.deepEqual(fromArray.howHeard, ["fb_ad", "tiktok"]);
  const fromString = normalizeAnswers({ howHeard: "instagram" });
  assert.deepEqual(fromString.howHeard, ["instagram"]);
});

test("legacy facebook slugs display as Facebook", () => {
  assert.equal(labelForOption("howHeard", "fb_ad"), "Facebook");
  assert.equal(labelForOption("howHeard", "fb_group"), "Facebook");
  assert.equal(labelForOption("howHeard", "facebook"), "Facebook");
  assert.equal(labelForOption("howHeard", "referral"), "Friend/referral");
});

test("other is required text, capped at 200 characters", () => {
  assert.equal(isHowHeardComplete("tiktok", ""), true);
  assert.equal(isHowHeardComplete("other", "  "), false);
  assert.equal(isHowHeardComplete("other", "a podcast"), true);
  assert.equal(isHowHeardComplete("", ""), false);
  const long = "x".repeat(HOW_HEARD_OTHER_MAX + 40);
  assert.equal(normalizeHowHeardOther(`  ${long}  `).length, HOW_HEARD_OTHER_MAX);
  assert.equal(chosenHowHeard(["fb_group", "reddit"]), "facebook");
  const payload = buildAnswersPayload(
    normalizeAnswers({ howHeard: ["other", "tiktok"] }),
    long,
  );
  assert.deepEqual(payload.howHeard, ["tiktok"]);
  assert.equal(payload.howHeardOther, "");
  const otherPayload = buildAnswersPayload(normalizeAnswers({ howHeard: ["other"] }), "  from a reel  ");
  assert.deepEqual(otherPayload.howHeard, ["other"]);
  assert.equal(otherPayload.howHeardOther, "from a reel");
});

test("the owner prompt asks only when howHeard is empty and we have not asked", () => {
  assert.equal(shouldAskHowHeard(null), true);
  assert.equal(shouldAskHowHeard({ howHeard: [] }), true);
  assert.equal(shouldAskHowHeard({ howHeard: ["tiktok"] }), false);
  assert.equal(shouldAskHowHeard({ howHeard: [], howHeardAskedAt: "2026-10-16T00:00:00.000Z" }), false);
  assert.equal(hasHowHeardAnswer({ howHeard: "facebook" }), true);
  assert.equal(readHowHeardOther({ howHeard: ["other"], howHeardOther: "podcast" }), "podcast");
});

// ─── recommendPlan: no silent change for existing behaviour ─────────────────

test("every legacy single-answer combination recommends exactly what it did before", () => {
  // The regression guard. This reimplements the ORIGINAL ChoosePlanPage:124-128
  // and asserts the new array-aware version agrees on all 25 combinations of the
  // old shape. If this fails, the shape migration changed what real users are
  // sold — the exact silent failure this module exists to prevent.
  const legacy = (teamSize?: string, revenueGoal?: string) => {
    if (teamSize === "large" || revenueGoal === "50k") return "custom";
    if (teamSize === "solo" && revenueGoal === "5k") return "basic";
    return "pro";
  };
  const teamSizes = [undefined, "solo", "small", "mid", "large"];
  const goals = [undefined, "5k", "10k", "25k", "50k"];
  for (const t of teamSizes) {
    for (const g of goals) {
      const raw: Record<string, string> = {};
      if (t) raw.teamSize = t;
      if (g) raw.revenueGoal = g;
      assert.equal(
        recommendPlan(normalizeAnswers(raw)),
        legacy(t, g),
        `teamSize=${t} revenueGoal=${g}`,
      );
    }
  }
});

test("no answers at all still defaults to pro", () => {
  assert.equal(recommendPlan(normalizeAnswers({})), "pro");
});

// ─── recommendPlan: the multi-select rules ──────────────────────────────────

test("a large team anywhere in the selection recommends custom", () => {
  assert.equal(recommendPlan(normalizeAnswers({ teamSize: ["solo", "large"] })), "custom");
});

test("a 50k goal anywhere in the selection recommends custom", () => {
  assert.equal(recommendPlan(normalizeAnswers({ revenueGoal: ["5k", "50k"] })), "custom");
});

test("solo and 5k alone still recommends basic", () => {
  assert.equal(
    recommendPlan(normalizeAnswers({ teamSize: ["solo"], revenueGoal: ["5k"] })),
    "basic",
  );
});

test("solo PLUS a bigger team size does not get downgraded to basic", () => {
  // The rule multi-select makes necessary: someone who ticks both "just me" and
  // "5-15 cleaners" has told you they are the larger of the two. Selling them
  // the smallest plan on the strength of the smaller tick is the wrong answer.
  assert.equal(
    recommendPlan(normalizeAnswers({ teamSize: ["solo", "mid"], revenueGoal: ["5k"] })),
    "pro",
  );
});

test("adding a selection NEVER lowers the recommendation", () => {
  // The invariant behind the two tests above, stated once so it holds for
  // combinations nobody enumerated. Ticking one more box can move you up a plan
  // or leave you where you are; it must never move you down.
  const base: Record<string, string[]> = { teamSize: ["solo"], revenueGoal: ["5k"] };
  const additions: Array<[string, string]> = [
    ["teamSize", "small"], ["teamSize", "mid"], ["teamSize", "large"],
    ["revenueGoal", "10k"], ["revenueGoal", "25k"], ["revenueGoal", "50k"],
  ];
  const before = RANK[recommendPlan(normalizeAnswers(base))];
  for (const [key, value] of additions) {
    const grown = { ...base, [key]: [...base[key], value] };
    const after = RANK[recommendPlan(normalizeAnswers(grown))];
    assert.ok(after >= before, `adding ${key}=${value} dropped the plan (${after} < ${before})`);
  }
});

test("the other three questions do not affect the recommendation", () => {
  // howHeard especially: it is an attribution question for us, not a signal
  // about them, and it must not move what they are sold.
  const withNoise = normalizeAnswers({
    teamSize: ["solo"], revenueGoal: ["5k"],
    bookingMethod: ["manual", "dms"], biggestPain: ["everything"], howHeard: ["fb_ad", "tiktok"],
  });
  assert.equal(recommendPlan(withNoise), "basic");
});

// ─── copy pickers ───────────────────────────────────────────────────────────

test("primaryPain picks by canonical option order, not by tap order", () => {
  // PAIN_PITCH and PAIN_BUILD_LINE are keyed by ONE pain. With multi-select the
  // pick has to be deterministic, or the same answers produce different copy on
  // different runs depending on which card was tapped first.
  const a = normalizeAnswers({ biggestPain: ["everything", "scheduling"] });
  const b = normalizeAnswers({ biggestPain: ["scheduling", "everything"] });
  assert.equal(primaryPain(a), primaryPain(b));
  assert.equal(primaryPain(a), "scheduling");
});

test("primaryPain returns null when nothing was selected", () => {
  // Must be null, not undefined and not "", so the caller's `? :` falls through
  // to the default line rather than rendering an empty pitch.
  assert.equal(primaryPain(normalizeAnswers({})), null);
});

// ─── the truthiness trap ────────────────────────────────────────────────────

test("hasAnswer is false for an empty selection", () => {
  // ChoosePlanPage:361 does `personal.teamSize ? 'Recommended for you' : 'Most
  // popular'`. An empty ARRAY is truthy, so after this change that line would
  // claim a recommendation is personalised for someone who answered nothing.
  const a = normalizeAnswers({});
  assert.equal(hasAnswer(a.teamSize), false);
  assert.equal(hasAnswer(normalizeAnswers({ teamSize: ["solo"] }).teamSize), true);
});

// ─── what gets written to the database ──────────────────────────────────────

test("the payload carries all five keys even when unanswered", () => {
  // A missing key and an unanswered key must be distinguishable later. If
  // unanswered questions were omitted, a future query could not tell "skipped"
  // from "asked before this question existed".
  const payload = buildAnswersPayload(normalizeAnswers({ howHeard: ["tiktok"] }));
  for (const k of QUALIFYING_KEYS) {
    assert.ok(k in payload, `${k} missing from payload`);
  }
  assert.deepEqual(payload.howHeard, ["tiktok"]);
  assert.deepEqual(payload.teamSize, []);
});

test("the payload is JSON-round-trippable", () => {
  // It goes into a jsonb column. A Set or Map here would survive in memory and
  // arrive as {} in Postgres — the same class of bug as the persisted-query-cache
  // rule in CLAUDE.md.
  const payload = buildAnswersPayload(
    normalizeAnswers({ teamSize: ["solo"], howHeard: ["fb_ad", "other"] }),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload);
});

test("buildAnswersPayload does not mutate its input", () => {
  const a: OnboardingAnswers = normalizeAnswers({ teamSize: ["solo"] });
  const snapshot = JSON.parse(JSON.stringify(a));
  buildAnswersPayload(a);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), snapshot);
});

// ─── ADMIN DISPLAY ──────────────────────────────────────────────────────────
// The Signups tab of Platform Analytics reads onboarding_answers off each row
// returned by platform-analytics. Three things make this its own problem rather
// than a formatting detail:
//
//   1. NULL IS THE NORMAL CASE. The column was added 2026-08-13 and deliberately
//      never backfilled, so nearly every organisation has none and always will.
//      Absence must read as "no data", not as a broken panel.
//   2. THE VALUE IS UNTRUSTED. It arrives as `unknown` from an edge function and
//      is jsonb in Postgres. It can be null, a legacy shape, or something a
//      future migration put there.
//   3. THE VOCABULARY CAN DRIFT. A new option added to the onboarding wizard but
//      not to the label map here must degrade to something legible, not blank.
//
// See docs/superpowers/plans/2026-08-13-signups-acquisition-display.md

test("hasOnboardingData is false for a null column — the common case", () => {
  assert.equal(hasOnboardingData(null), false);
  assert.equal(hasOnboardingData(undefined), false);
});

test("hasOnboardingData is false when every question is present but unanswered", () => {
  // The subtle one. normalizeAnswers({}) produces five empty arrays, which is
  // structurally identical to a row that was written with nothing selected.
  // Neither should claim to have data, or the coverage count lies.
  assert.equal(
    hasOnboardingData({ teamSize: [], bookingMethod: [], biggestPain: [], revenueGoal: [], howHeard: [] }),
    false,
  );
});

test("hasOnboardingData is true when any single question was answered", () => {
  assert.equal(hasOnboardingData({ howHeard: ["fb_ad"] }), true);
  assert.equal(hasOnboardingData({ teamSize: ["solo"] }), true);
});

test("hasOnboardingData is false for junk rather than throwing", () => {
  for (const junk of ["nonsense", 7, true, []]) {
    assert.equal(hasOnboardingData(junk), false, `failed on ${JSON.stringify(junk)}`);
  }
});

test("every declared howHeard value has an admin label", () => {
  // Completeness, so a new option cannot ship unlabelled.
  for (const v of HOW_HEARD_VALUES) {
    const label = labelForOption("howHeard", v);
    assert.ok(label && label !== v, `no label for howHeard value ${v}`);
  }
});

test("an unknown option renders as its raw slug, never blank", () => {
  // Drift has to degrade to something an admin can act on. Seeing `fb_reels` in
  // the UI tells you exactly what to add to the label map; seeing an empty badge
  // tells you nothing and looks like a bug.
  assert.equal(labelForOption("howHeard", "fb_reels"), "fb_reels");
  assert.equal(labelForOption("teamSize", "enormous"), "enormous");
});

test("summariseSource returns null when there is no acquisition answer", () => {
  assert.equal(summariseSource(null), null);
  assert.equal(summariseSource({ teamSize: ["solo"] }), null, "other answers are not a source");
});

test("summariseSource names one source and counts the rest", () => {
  const s = summariseSource({ howHeard: ["fb_ad"] });
  assert.deepEqual(s, { primary: "Facebook", extraCount: 0, other: null });
  const multi = summariseSource({ howHeard: ["fb_ad", "tiktok", "other"], howHeardOther: "a podcast" });
  assert.equal(multi?.primary, "TikTok");
  assert.equal(multi?.extraCount, 2);
  assert.equal(multi?.other, "a podcast");
});

test("summariseSource picks the primary by canonical order, not stored order", () => {
  // Same answers must produce the same badge however they were tapped, or the
  // same org reads differently on two page loads.
  const a = summariseSource({ howHeard: ["other", "tiktok", "fb_ad"] });
  const b = summariseSource({ howHeard: ["fb_ad", "other", "tiktok"] });
  assert.deepEqual(a, b);
  assert.equal(a?.primary, "TikTok");
});

test("describeAnswers returns nothing to render when the column is null", () => {
  assert.deepEqual(describeAnswers(null), []);
});

test("describeAnswers omits unanswered questions rather than showing blanks", () => {
  const rows = describeAnswers({ howHeard: ["tiktok"], teamSize: [], biggestPain: ["payments"] });
  assert.deepEqual(rows.map((r) => r.key), ["biggestPain", "howHeard"]);
});

test("describeAnswers labels every value and keeps question order", () => {
  const rows = describeAnswers({
    howHeard: ["google"], teamSize: ["solo", "mid"], revenueGoal: ["10k"],
  });
  assert.deepEqual(rows.map((r) => r.key), ["teamSize", "revenueGoal", "howHeard"]);
  assert.deepEqual(rows[0].labels, ["Just me", "5-15 cleaners"]);
  assert.ok(rows[0].question.length > 0, "each row carries a human question label");
});

test("countWithOnboardingData reports coverage over a list of signup rows", () => {
  // This number is what turns "almost everything is blank" from looking broken
  // into being stated. It must count rows, not answers.
  const rows = [
    { onboarding_answers: { howHeard: ["fb_ad"] } },
    { onboarding_answers: null },
    { onboarding_answers: { teamSize: [], howHeard: [] } },
    { onboarding_answers: { teamSize: ["solo"], howHeard: ["google"] } },
    {},
  ];
  assert.equal(countWithOnboardingData(rows), 2);
});

test("countWithOnboardingData is 0 for an empty list, not NaN", () => {
  assert.equal(countWithOnboardingData([]), 0);
});

test("the answered rate is the share of rows that named a source", () => {
  const rows = [
    { onboarding_answers: { howHeard: ["tiktok"] } },
    { onboarding_answers: { howHeard: [] } },
    { onboarding_answers: null },
    { onboarding_answers: { howHeard: "reddit" } },
  ];
  assert.deepEqual(howHeardAnsweredSummary(rows), { answered: 2, total: 4, percent: 50 });
  assert.deepEqual(howHeardAnsweredSummary([]), { answered: 0, total: 0, percent: 0 });
});

test("display helpers do not mutate what they are given", () => {
  const input = { howHeard: ["tiktok", "fb_ad"], teamSize: ["solo"] };
  const snapshot = JSON.parse(JSON.stringify(input));
  summariseSource(input);
  describeAnswers(input);
  hasOnboardingData(input);
  assert.deepEqual(JSON.parse(JSON.stringify(input)), snapshot);
});

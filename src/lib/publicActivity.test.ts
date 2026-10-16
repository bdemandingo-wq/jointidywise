import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTIVITY_TICKER_INTERVAL_MS,
  activitySentence,
  enforceActivityOrder,
  lifetimeSpotsLabel,
  orderActivityEvents,
  parseActivityFeed,
  parseGrowthCounters,
  publicCity,
  publicRegion,
  publicStateName,
  roundPublicAmount,
  shouldShowTrustedBy,
  shouldShowWeeklySignups,
  tickerLines,
  trustedByLabel,
  weeklySignupLabel,
  type PublicActivityEvent,
} from "./publicActivity.ts";

const AT = "2026-10-16T12:00:00.000Z";

function event(partial: Partial<PublicActivityEvent> & Pick<PublicActivityEvent, "kind">): PublicActivityEvent {
  return {
    region: "FL",
    amount: null,
    service: null,
    at: AT,
    ...partial,
  };
}

test("rounds a real job total to the nearest ten dollars", () => {
  assert.equal(roundPublicAmount(180), 180);
  assert.equal(roundPublicAmount(184), 180);
  assert.equal(roundPublicAmount(185), 190);
  assert.equal(roundPublicAmount(0), null);
  assert.equal(roundPublicAmount(12), null);
});

test("keeps a city and drops an address", () => {
  assert.equal(publicCity("Tampa"), "Tampa");
  assert.equal(publicCity("St. Louis"), "St. Louis");
  assert.equal(publicCity("123 Main St"), null);
  assert.equal(publicCity("Main Street"), null);
  assert.equal(publicCity("test"), null);
});

test("place is a state name, never a city", () => {
  assert.equal(publicRegion("FL"), "FL");
  assert.equal(publicRegion("fl"), "FL");
  assert.equal(publicRegion("Florida"), "FL");
  assert.equal(publicRegion("District of Columbia"), "DC");
  assert.equal(publicStateName("FL"), "Florida");
  assert.equal(publicStateName("DC"), "DC");
  assert.equal(publicRegion("Tampa"), null);
  assert.equal(publicRegion("NA"), null);
  assert.equal(publicRegion("500 Oak Avenue"), null);
  assert.equal(publicStateName("Tampa"), null);
});

test("writes real event sentences at state level and nothing else", () => {
  assert.equal(activitySentence(event({
    kind: "booked",
    amount: 184,
    service: "deep clean",
  })), "A cleaning company in Florida just booked a $180 deep clean");

  assert.equal(activitySentence(event({
    kind: "joined",
    region: "TX",
  })), "A new cleaning business joined from Texas");

  assert.equal(activitySentence(event({
    kind: "completed",
    region: "DC",
  })), "A cleaner completed a job in DC");

  assert.equal(activitySentence(event({
    kind: "booked",
    region: "Tampa",
    amount: 180,
    service: "deep clean",
  })), null);

  assert.equal(activitySentence(event({ kind: "paid", amount: null })), null);
  assert.equal(activitySentence(event({ kind: "paid", amount: 12 })), null);
});

test("paid, review, and cleaner lines use a few fixed templates", () => {
  const paid = new Set<string>();
  const reviewed = new Set<string>();
  const cleaner = new Set<string>();
  for (let i = 0; i < 180; i++) {
    const at = new Date(Date.UTC(2026, 9, 1, 0, i, 0)).toISOString();
    const paidLine = activitySentence(event({ kind: "paid", amount: 184, at }));
    const reviewLine = activitySentence(event({ kind: "reviewed", at }));
    const cleanerLine = activitySentence(event({ kind: "cleaner", at }));
    if (paidLine) paid.add(paidLine);
    if (reviewLine) reviewed.add(reviewLine);
    if (cleanerLine) cleaner.add(cleanerLine);
    assert.equal(activitySentence(event({ kind: "paid", amount: 184, at })), paidLine);
  }

  assert.equal(paid.size, 3);
  assert.ok(paid.has("A cleaning business in Florida just got paid $180"));
  assert.ok(paid.has("A cleaning company in Florida received a $180 payment"));
  assert.ok(paid.has("A team in Florida just collected $180"));

  assert.equal(reviewed.size, 3);
  assert.ok(reviewed.has("A cleaning business in Florida just received a 5-star review"));
  assert.ok(reviewed.has("A cleaner in Florida earned a 5-star review"));
  assert.ok(reviewed.has("A 5-star review just came in for a business in Florida"));
  for (const line of reviewed) {
    assert.equal(line.includes("$"), false);
    assert.equal(line.toLowerCase().includes("tampa"), false);
  }

  assert.equal(cleaner.size, 3);
  assert.ok(cleaner.has("A cleaning business in Florida just added a cleaner"));
  assert.ok(cleaner.has("A new cleaner joined a team in Florida"));
  assert.ok(cleaner.has("A team in Florida added a new cleaner"));
  for (const line of cleaner) assert.equal(line.includes("$"), false);
});

test("parser ignores extra fields and drops a row with no real state", () => {
  const events = parseActivityFeed({
    events: [
      {
        kind: "booked",
        city: "Tampa",
        region: "FL",
        amount: 180,
        service: "deep clean",
        at: "2026-10-16T12:00:00.000Z",
        name: "Acme Cleaning",
        address: "1 Secret St",
        organization_id: "should-not-survive",
      },
      {
        kind: "booked",
        city: "12 King St",
        region: null,
        amount: 180,
        service: "clean",
        at: "2026-10-16T11:00:00.000Z",
      },
      {
        kind: "joined",
        city: "Dallas",
        region: "Texas",
        amount: null,
        service: null,
        at: "2026-10-16T10:00:00.000Z",
      },
      {
        kind: "paid",
        city: "Miami",
        region: "FL",
        amount: 184,
        service: "Jane's house",
        at: "2026-10-16T09:00:00.000Z",
        customer: "Jane",
      },
      {
        kind: "reviewed",
        region: "FL",
        at: "2026-10-16T08:00:00.000Z",
        review_text: "Jane at 500 Oak Avenue was great",
      },
      {
        kind: "reviewed",
        region: "FL",
        rating: 4,
        at: "2026-10-16T08:30:00.000Z",
      },
      {
        kind: "cleaner",
        region: "GA",
        at: "2026-10-16T07:00:00.000Z",
        name: "Sam Cleaner",
        email: "sam@example.com",
      },
      { kind: "made-up", region: "FL", at: "2026-10-16T06:00:00.000Z" },
    ],
  });

  assert.deepEqual(events.map((row) => row.kind), ["booked", "joined", "paid", "reviewed", "cleaner"]);
  assert.equal("city" in events[0], false);
  assert.equal("name" in events[0], false);
  assert.equal(events[0].region, "FL");
  assert.equal(events[1].region, "TX");
  assert.equal(events[2].amount, 180);
  assert.equal(events[2].service, null);
  assert.equal(events[3].service, null);
  const reviewLine = activitySentence(events[3]);
  assert.ok(reviewLine);
  assert.equal(reviewLine.includes("Jane"), false);
  assert.equal(reviewLine.includes("Oak"), false);
  assert.equal(activitySentence(events[4])?.includes("Sam"), false);
  assert.equal(activitySentence(events[0]), "A cleaning company in Florida just booked a $180 deep clean");
});

test("an empty feed stays empty", () => {
  assert.deepEqual(parseActivityFeed({ events: [] }), []);
  assert.deepEqual(parseActivityFeed(null), []);
});

test("ordering never repeats a kind and spreads orgs", () => {
  const ordered = orderActivityEvents([
    { kind: "booked", org: "a", at: "2026-10-16T05:00:00.000Z" },
    { kind: "booked", org: "a", at: "2026-10-16T04:00:00.000Z" },
    { kind: "paid", org: "a", at: "2026-10-16T03:00:00.000Z" },
    { kind: "completed", org: "b", at: "2026-10-16T02:00:00.000Z" },
    { kind: "reviewed", org: "b", at: "2026-10-16T01:00:00.000Z" },
    { kind: "cleaner", org: "c", at: "2026-10-16T00:00:00.000Z" },
  ]);

  assert.deepEqual(ordered.map((row) => `${row.org}:${row.kind}`), [
    "a:booked",
    "b:completed",
    "c:cleaner",
    "a:booked",
    "b:reviewed",
    "a:paid",
  ]);
  for (let i = 1; i < ordered.length; i++) {
    assert.notEqual(ordered[i].kind, ordered[i - 1].kind);
  }
  assert.ok(new Set(ordered.slice(0, 3).map((row) => row.org)).size >= 2);

  const onlyBooked = orderActivityEvents([
    { kind: "booked", org: "a", at: "2026-10-16T03:00:00.000Z" },
    { kind: "booked", org: "b", at: "2026-10-16T02:00:00.000Z" },
    { kind: "booked", org: "c", at: "2026-10-16T01:00:00.000Z" },
  ]);
  assert.equal(onlyBooked.length, 1);
  assert.equal(onlyBooked[0].org, "a");
});

test("a feed that already alternates kinds keeps its order", () => {
  const rows = [
    { kind: "paid", at: "2026-10-16T03:00:00.000Z" },
    { kind: "booked", at: "2026-10-16T01:00:00.000Z" },
    { kind: "reviewed", at: "2026-10-16T02:00:00.000Z" },
  ];
  assert.deepEqual(enforceActivityOrder(rows), rows);

  const repaired = parseActivityFeed({
    events: [
      { kind: "paid", region: "FL", amount: 80, at: "2026-10-16T03:00:00.000Z" },
      { kind: "paid", region: "TX", amount: 90, at: "2026-10-16T02:00:00.000Z" },
      { kind: "booked", region: "GA", amount: 100, service: "clean", at: "2026-10-16T01:00:00.000Z" },
    ],
  });
  assert.deepEqual(repaired.map((row) => row.kind), ["paid", "booked", "paid"]);
  for (let i = 1; i < repaired.length; i++) {
    assert.notEqual(repaired[i].kind, repaired[i - 1].kind);
  }
});

test("the ticker uses the last 24 hours and rotates every 8 seconds", () => {
  const now = Date.parse("2026-10-16T12:00:00.000Z");
  const recent = event({ kind: "paid", amount: 180, at: "2026-10-16T11:00:00.000Z" });
  const dayOld = event({ kind: "booked", region: "TX", amount: 100, service: "clean", at: "2026-10-15T11:00:00.000Z" });
  const edge = event({ kind: "joined", region: "GA", at: "2026-10-15T12:00:00.000Z" });
  const future = event({ kind: "cleaner", region: "NC", at: "2026-10-16T13:00:00.000Z" });
  const skew = event({ kind: "reviewed", at: "2026-10-16T12:01:00.000Z" });

  const lines = tickerLines([recent, dayOld, edge, future, skew], now);
  assert.equal(lines.length, 3);
  assert.ok(lines.some((line) => line.includes("Florida")));
  assert.equal(lines.some((line) => line.includes("Texas")), false);
  assert.deepEqual(tickerLines([dayOld], now), []);
  assert.equal(ACTIVITY_TICKER_INTERVAL_MS, 8_000);

  const source = readFileSync(new URL("../components/growth/ActivityTicker.tsx", import.meta.url), "utf8");
  assert.match(source, /ACTIVITY_TICKER_INTERVAL_MS/);
  assert.match(source, /tickerLines/);
  assert.equal(source.includes("5000"), false);
});

test("weekly signups stay hidden below the configured threshold", () => {
  assert.equal(shouldShowWeeklySignups(14), false);
  assert.equal(shouldShowWeeklySignups(15), true);
  assert.equal(shouldShowWeeklySignups(5, 15), false);
  assert.equal(shouldShowWeeklySignups(3, 3), true);
  assert.equal(shouldShowWeeklySignups(2, 3), false);
  assert.equal(weeklySignupLabel(4), "4 cleaning businesses joined this week");
  assert.equal(weeklySignupLabel(1), "1 cleaning business joined this week");
});

test("trusted-by uses the real organization count and hides when it is missing", () => {
  assert.equal(trustedByLabel(131), "Trusted by 131 cleaning businesses");
  assert.equal(trustedByLabel(1), "Trusted by 1 cleaning business");
  assert.equal(shouldShowTrustedBy(131), true);
  assert.equal(shouldShowTrustedBy(0), false);
  assert.equal(shouldShowTrustedBy(null), false);
});

test("lifetime spots use the real remaining count", () => {
  const counters = parseGrowthCounters({
    lifetime_total: 100,
    lifetime_sold: 12,
    weekly_signups: 5,
    organization_count: 131,
    weekly_signup_min: 15,
  });
  assert.ok(counters);
  assert.equal(lifetimeSpotsLabel(counters.lifetimeRemaining, counters.lifetimeTotal), "88 of 100 Lifetime spots left");
  assert.equal(counters.weeklySignups, 5);
  assert.equal(counters.organizationCount, 131);
  assert.equal(counters.weeklySignupMin, 15);
  assert.equal(shouldShowWeeklySignups(counters.weeklySignups, counters.weeklySignupMin), false);
  assert.equal(parseGrowthCounters({ lifetime_sold: 1 }), null);
});

test("an older counter payload does not invent an organization count", () => {
  const counters = parseGrowthCounters({
    lifetime_total: 100,
    lifetime_sold: 3,
    weekly_signups: 5,
  });
  assert.ok(counters);
  assert.equal(counters.organizationCount, null);
  assert.equal(counters.weeklySignupMin, 15);
  assert.equal(shouldShowTrustedBy(counters.organizationCount), false);
  assert.equal(shouldShowWeeklySignups(counters.weeklySignups, counters.weeklySignupMin), false);
});

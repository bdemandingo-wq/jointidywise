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
  publicPlace,
  publicRegion,
  publicRegionFromZip,
  publicStateName,
  ZIP3_RANGES,
  roundPublicAmount,
  shouldShowTrustedBy,
  shouldShowWeeklySignups,
  tickerIndexAfterChange,
  tickerLines,
  trustedByLabel,
  weeklySignupLabel,
  type PublicActivityEvent,
} from "./publicActivity.ts";

const AT = "2026-10-16T12:00:00.000Z";
const FEED_NOW = Date.parse("2026-10-16T18:00:00.000Z");

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
  assert.equal(publicRegion(" tx "), "TX");
  assert.equal(publicStateName("FL"), "Florida");
  assert.equal(publicStateName("DC"), "DC");
  assert.equal(publicRegion("Florida"), null);
  assert.equal(publicRegion("Texas"), null);
  assert.equal(publicRegion("District of Columbia"), null);
  assert.equal(publicRegion("Dallas, TX"), null);
  assert.equal(publicRegion("Dallas, Texas"), null);
  assert.equal(publicRegion("Washington, DC"), null);
  assert.equal(publicRegion("Charleston, West Virginia"), null);
  assert.equal(publicRegion("Tampa"), null);
  assert.equal(publicRegion("Dallas"), null);
  assert.equal(publicRegion("NA"), null);
  assert.equal(publicRegion("500 Oak Avenue"), null);
  assert.equal(publicStateName("Tampa"), null);
  assert.equal(publicStateName("Dallas"), null);
  assert.equal(publicStateName("Florida"), null);
});

test("a ZIP or booking state supplies the place, and a city name does not", () => {
  assert.equal(publicRegionFromZip("75201"), "TX");
  assert.equal(publicRegionFromZip("75201-1234"), "TX");
  assert.equal(publicRegionFromZip("Dallas"), null);
  assert.equal(publicRegionFromZip("73949"), "OK");
  assert.equal(publicRegionFromZip("00801"), "VI");
  assert.equal(publicRegionFromZip("96915"), null);
  assert.equal(publicRegionFromZip("T2P 1J9"), "AB");
  assert.equal(publicRegionFromZip("X0A 0H0"), null);

  assert.equal(publicPlace(null, "75201"), "TX");
  assert.equal(publicPlace("FL", "75201", "CA"), "FL");
  assert.equal(publicPlace("Dallas", null, "TX"), "TX");
  assert.equal(publicPlace("Dallas", null, "Texas"), null);
  assert.equal(publicPlace("Dallas, TX", null, null), null);
  assert.equal(publicPlace("Dallas", null, null), null);
  assert.equal(publicPlace("Dallas", "Dallas", "Dallas"), null);
});

test("the migration resolves place from state, zip, or booking state", () => {
  const sql = readFileSync(
    new URL("../../supabase/migrations/20261016190000_public_activity_state_events.sql", import.meta.url),
    "utf8",
  );
  for (const [lo, hi, code] of ZIP3_RANGES) {
    assert.ok(
      sql.includes(`WHEN zip3 BETWEEN ${lo} AND ${hi} THEN '${code}'`),
      `${lo}-${hi} ${code}`,
    );
  }
  assert.equal(sql.includes("company_city"), false);
  assert.equal(sql.includes("growth_public_region_token(p_"), false);
  assert.equal(sql.includes("CREATE OR REPLACE FUNCTION public.growth_public_region_token"), false);
  assert.ok(sql.includes("DROP FUNCTION IF EXISTS public.growth_public_region_token(text)"));
  assert.equal(sql.includes("interval '7 days'"), false);
  assert.equal(sql.includes("b.updated_at"), false);
  assert.equal(sql.includes("coalesce(b.completed_at, b.updated_at)"), false);
  assert.ok(sql.includes("WHEN upper(input.value) ~ '^[A-Z]{2}$'"));
  assert.equal(sql.includes("s.name = lower(input.value)"), false);
  assert.match(sql, /WHERE s\.abbr = upper\(input\.value\) LIMIT 1\s*\)\s*ELSE NULL/);
  assert.equal((sql.match(/interval '24 hours'/g) ?? []).length, 6);
  assert.equal((sql.match(/growth_public_place\(bs\.company_state, bs\.company_zip, b\.state\)/g) ?? []).length, 3);
  assert.equal((sql.match(/growth_public_place\(bs\.company_state, bs\.company_zip, NULL::text\)/g) ?? []).length, 3);
  assert.equal(sql.includes("20261016180000"), false);
  assert.ok(sql.includes("i.stripe_payment_intent_id IS NOT NULL"));
  assert.ok(sql.includes("b.completed_at AS at"));
  assert.ok(sql.includes("b.completed_at > now() - interval '24 hours'"));
  assert.ok(sql.includes("rr.booking_id IS NOT NULL"));
  assert.ok(sql.includes("public.booking_is_real_job(to_jsonb(b))"));
  assert.ok(sql.includes("NULLIF(btrim(rr.review_link_token), '') IS NOT NULL"));
  assert.ok(sql.includes("rr.sent_at IS NOT NULL"));
  assert.ok(sql.includes("rr.submitted_by_token = true"));
  assert.ok(sql.includes("PERFORM set_config('app.review_submit', 'on', true)"));
  assert.ok(sql.includes("submitted_by_token = true"));
  assert.ok(sql.includes("ordered -> -1"));
  assert.ok(sql.includes("ordered - (-1)"));
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
        region: "TX",
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
      {
        kind: "joined",
        city: "Dallas",
        region: "Dallas, TX",
        at: "2026-10-16T05:00:00.000Z",
      },
      {
        kind: "joined",
        region: "Florida",
        at: "2026-10-16T04:00:00.000Z",
      },
    ],
  }, FEED_NOW);

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

test("the client keeps a server state code and does not infer one", () => {
  const fromServer = parseActivityFeed({
    events: [
      {
        kind: "joined",
        city: "Dallas",
        region: "TX",
        zip: "75201",
        at: "2026-10-16T09:59:00.000Z",
      },
    ],
  }, FEED_NOW);
  assert.equal(fromServer.length, 1);
  assert.equal(fromServer[0].region, "TX");
  assert.equal("city" in fromServer[0], false);
  assert.equal("zip" in fromServer[0], false);
  assert.equal(activitySentence(fromServer[0]), "A new cleaning business joined from Texas");

  const cityOnly = parseActivityFeed({
    events: [
      { kind: "joined", city: "Dallas", region: "Dallas", at: "2026-10-16T09:59:00.000Z" },
      { kind: "joined", city: "Dallas", region: null, zip: "75201", at: "2026-10-16T09:30:00.000Z" },
      { kind: "joined", region: "Texas", at: "2026-10-16T09:00:00.000Z" },
      { kind: "booked", city: "Dallas", region: null, booking_state: "TX", amount: 180, service: "clean", at: "2026-10-16T08:00:00.000Z" },
    ],
  }, FEED_NOW);
  assert.deepEqual(cityOnly, []);
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
  }, FEED_NOW);
  assert.deepEqual(repaired.map((row) => row.kind), ["paid", "booked"]);
  for (let i = 1; i < repaired.length; i++) {
    assert.notEqual(repaired[i].kind, repaired[i - 1].kind);
  }
  assert.notEqual(repaired[0].kind, repaired[repaired.length - 1].kind);
});

test("events outside 24 hours are dropped before ordering", () => {
  const now = Date.parse("2026-10-16T12:00:00.000Z");
  const events = parseActivityFeed({
    events: [
      { kind: "paid", region: "FL", amount: 180, at: "2026-10-16T11:00:00.000Z" },
      { kind: "booked", region: "TX", amount: 120, service: "clean", at: "2026-10-15T10:00:00.000Z" },
      { kind: "paid", region: "GA", amount: 200, at: "2026-10-16T10:00:00.000Z" },
    ],
  }, now);
  assert.deepEqual(events.map((row) => row.region), ["FL"]);

  const lines = tickerLines([
    event({ kind: "paid", amount: 180, at: "2026-10-16T11:00:00.000Z" }),
    event({ kind: "booked", region: "TX", amount: 120, service: "clean", at: "2026-10-15T10:00:00.000Z" }),
    event({ kind: "paid", region: "GA", amount: 200, at: "2026-10-16T10:00:00.000Z" }),
  ], now);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text.includes("Florida"), true);
  assert.equal(lines[0].text.includes("Georgia"), false);
  assert.equal(lines[0].text.includes("Texas"), false);
});

test("the ticker wrap never shows the same kind twice in a row", () => {
  const rows = [
    { kind: "paid", at: "2026-10-16T03:00:00.000Z" },
    { kind: "reviewed", at: "2026-10-16T02:00:00.000Z" },
    { kind: "paid", at: "2026-10-16T01:00:00.000Z" },
  ];
  const ordered = enforceActivityOrder(rows);
  assert.deepEqual(ordered.map((row) => row.kind), ["paid", "reviewed"]);
  assert.notEqual(ordered[0].kind, ordered[ordered.length - 1].kind);

  const now = Date.parse("2026-10-16T12:00:00.000Z");
  const lines = tickerLines([
    event({ kind: "paid", amount: 180, at: "2026-10-16T11:00:00.000Z" }),
    event({ kind: "reviewed", at: "2026-10-16T10:00:00.000Z" }),
    event({ kind: "paid", region: "GA", amount: 200, at: "2026-10-16T09:00:00.000Z" }),
  ], now);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text.includes("$180"), true);
  assert.equal(lines[1].text.includes("5-star"), true);
  assert.equal(lines.some((line) => line.text.includes("Georgia")), false);
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
  assert.ok(lines.some((line) => line.text.includes("Florida")));
  assert.equal(lines.some((line) => line.text.includes("Texas")), false);
  assert.deepEqual(tickerLines([dayOld], now), []);
  assert.equal(ACTIVITY_TICKER_INTERVAL_MS, 8_000);
});

test("an aged-out event does not repeat the kind on screen", () => {
  const now = Date.parse("2026-10-16T12:00:00.000Z");
  const events = [
    event({ kind: "paid", region: "FL", amount: 180, at: "2026-10-16T11:00:00.000Z" }),
    event({ kind: "booked", region: "TX", amount: 120, service: "clean", at: "2026-10-16T10:00:00.000Z" }),
    event({ kind: "paid", region: "GA", amount: 200, at: "2026-10-16T09:00:00.000Z" }),
    event({ kind: "booked", region: "NC", amount: 100, service: "clean", at: "2026-10-16T08:00:00.000Z" }),
  ];
  const before = tickerLines(events, now);
  assert.deepEqual(before.map((line) => line.kind), ["paid", "booked", "paid", "booked"]);

  const showing = before[2];
  const later = Date.parse("2026-10-17T08:00:01.000Z");
  const after = tickerLines(events, later);
  assert.deepEqual(after.map((line) => line.kind), ["paid", "booked"]);
  assert.equal(after.some((line) => line.text === showing.text), false);

  const index = tickerIndexAfterChange(after, showing);
  assert.equal(after[index].kind, "booked");
  assert.notEqual(after[index].kind, showing.kind);

  const stillShown = before[0];
  const continued = tickerIndexAfterChange(after, stillShown);
  assert.equal(after[continued].text, after[1].text);
  assert.equal(after[continued].kind, "booked");
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

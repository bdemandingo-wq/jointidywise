import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activitySentence,
  lifetimeSpotsLabel,
  parseActivityFeed,
  parseGrowthCounters,
  publicCity,
  roundPublicAmount,
  shouldShowTrustedBy,
  shouldShowWeeklySignups,
  trustedByLabel,
  weeklySignupLabel,
} from "./publicActivity.ts";

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

test("writes the three real event shapes and nothing else", () => {
  assert.equal(activitySentence({
    kind: "booked",
    city: "Tampa",
    region: "FL",
    amount: 184,
    service: "deep clean",
    at: "2026-10-13T12:00:00.000Z",
  }), "A cleaning company in Tampa, FL just booked a $180 deep clean");

  assert.equal(activitySentence({
    kind: "joined",
    city: "Dallas",
    region: null,
    amount: null,
    service: null,
    at: "2026-10-13T12:00:00.000Z",
  }), "A new cleaning business joined from Dallas");

  assert.equal(activitySentence({
    kind: "completed",
    city: "Miami",
    region: null,
    amount: 90,
    service: "Jane's house",
    at: "2026-10-13T12:00:00.000Z",
  }), "A cleaner completed a job in Miami");
});

test("drops an event whose city is an address", () => {
  assert.equal(activitySentence({
    kind: "booked",
    city: "500 Oak Avenue",
    region: "FL",
    amount: 180,
    service: "deep clean",
    at: "2026-10-13T12:00:00.000Z",
  }), null);
});

test("parser ignores extra fields and unsafe rows", () => {
  const events = parseActivityFeed({
    events: [
      {
        kind: "booked",
        city: "Tampa",
        region: "FL",
        amount: 180,
        service: "deep clean",
        at: "2026-10-13T12:00:00.000Z",
        name: "Acme Cleaning",
        address: "1 Secret St",
        organization_id: "should-not-survive",
      },
      { kind: "booked", city: "12 King St", region: "FL", amount: 180, service: "clean", at: "2026-10-13T12:00:00.000Z" },
      { kind: "joined", city: "Dallas", region: "Texas", amount: null, service: null, at: "2026-10-12T12:00:00.000Z" },
    ],
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].city, "Tampa");
  assert.equal("name" in events[0], false);
  assert.equal(events[1].region, null);
  assert.equal(activitySentence(events[0]), "A cleaning company in Tampa, FL just booked a $180 deep clean");
});

test("an empty feed stays empty", () => {
  assert.deepEqual(parseActivityFeed({ events: [] }), []);
  assert.deepEqual(parseActivityFeed(null), []);
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
  assert.equal(trustedByLabel(131), "131 cleaning businesses have signed up");
  assert.equal(trustedByLabel(1), "1 cleaning business has signed up");
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

function latestFunction(name: string): string {
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  let body = "";
  for (const file of readdirSync(dir).filter((entry) => entry.endsWith(".sql")).sort()) {
    const sql = readFileSync(new URL(file, dir), "utf8");
    const at = sql.lastIndexOf(marker);
    if (at >= 0) body = sql.slice(at);
  }
  return body;
}

test("organization_count drops the owner orgs and keeps the existing test-org rule", () => {
  const counters = latestFunction("get_public_growth_counters");
  const detector = latestFunction("growth_org_is_public");
  const signupCount = [
    "COUNT(*) FILTER (",
    "      WHERE o.id IS DISTINCT FROM 'e95b92d0-7099-408e-a773-e4407b34f8b4'::uuid",
    "        AND o.name IS DISTINCT FROM 'Clean Collective'",
    "    )::int",
  ].join("\n");
  assert.equal(counters.includes("'organization_count', orgs"), true);
  assert.equal(counters.includes(signupCount), true);
  assert.equal(counters.includes("WHERE public.growth_org_is_public(o.id, false)"), true);
  assert.equal(
    counters.includes("COUNT(*) FILTER (WHERE o.created_at > now() - interval '7 days')::int"),
    true,
  );
  assert.equal(counters.includes("o.name IS DISTINCT FROM 'TIDYWISE'"), false);

  assert.equal(detector.includes("coalesce(ops.demo_mode_enabled, false) = false"), true);
  assert.equal(
    detector.includes("o.name !~* '(^|[^a-z])(test|qa|demo|sandbox)([^a-z]|$)'"),
    true,
  );
  assert.equal(detector.includes("coalesce(o.slug, '') !~* '^(test|qa|demo|sandbox)'"), true);
  assert.equal(
    detector.includes("coalesce(owner.email, '') !~* '(@tidywise1\\.com$|^applereview@|@example\\.com$|\\+(qa|test))'"),
    true,
  );
  assert.equal(
    detector.includes("coalesce(owner.email, '') <> 'support@tidywisecleaning.com'"),
    true,
  );

  const client = readFileSync(new URL("./publicActivity.ts", import.meta.url), "utf8");
  assert.equal(client.includes("e95b92d0-7099-408e-a773-e4407b34f8b4"), false);
  assert.equal(client.includes("Clean Collective"), false);
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

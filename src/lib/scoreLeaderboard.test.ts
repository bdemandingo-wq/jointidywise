import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildScoreLeaderboard,
  businessNameKey,
  dedupeScoreListings,
  isHouseCleaningListing,
  milesBetween,
  type ScoreListing,
} from "./scoreLeaderboard.ts";

function listing(partial: Partial<ScoreListing> & Pick<ScoreListing, "id" | "name">): ScoreListing {
  return {
    slug: partial.slug ?? partial.id,
    city: partial.city ?? "Pompano Beach",
    state: partial.state ?? "FL",
    city_slug: partial.city_slug ?? "pompano-beach-fl",
    score: partial.score ?? null,
    score_grade: partial.score_grade ?? null,
    google_rating: partial.google_rating ?? null,
    google_review_count: partial.google_review_count ?? null,
    latitude: partial.latitude ?? null,
    longitude: partial.longitude ?? null,
    county: partial.county ?? null,
    primary_type: partial.primary_type ?? null,
    ...partial,
  };
}

const POMPANO = { latitude: 26.2889009, longitude: -80.0960747 };

test("normalizes legal suffixes, punctuation, and case into one key", () => {
  assert.equal(businessNameKey("Open Arms Cleaning, LLC"), "open arms cleaning");
  assert.equal(businessNameKey("Open Arms Cleaning"), "open arms cleaning");
  assert.equal(businessNameKey("open arms cleaning, l.l.c."), "open arms cleaning");
  assert.equal(businessNameKey("Open Arms Cleaning Co."), "open arms cleaning");
});

test("keeps the higher real score when the same business is listed twice", () => {
  const rows = dedupeScoreListings([
    listing({
      id: "low",
      name: "Open Arms Cleaning",
      score: 41,
      score_grade: "F",
      google_review_count: 0,
    }),
    listing({
      id: "high",
      name: "Open Arms Cleaning, LLC",
      score: 70,
      score_grade: "C",
      google_rating: 4.9,
      google_review_count: 60,
    }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, "high");
  assert.equal(rows[0]?.score, 70);
});

test("house cleaning stays, window cleaning and pressure washing do not", () => {
  assert.equal(isHouseCleaningListing("Open Arms Cleaning, LLC", null), true);
  assert.equal(isHouseCleaningListing("The Prime Cleaner", null), true);
  assert.equal(isHouseCleaningListing("MaidPro Fort Myers", null), true);
  assert.equal(isHouseCleaningListing("Ace Window Cleaning", "house_cleaning_service"), false);
  assert.equal(isHouseCleaningListing("Pro Power Washing", null), false);
  assert.equal(isHouseCleaningListing("YOLO SPA", null), false);
  assert.equal(isHouseCleaningListing("TN Nails Spa", null), false);
  assert.equal(isHouseCleaningListing("TIDYWISE", null), false);
  assert.equal(isHouseCleaningListing("TIDYWISE", "house_cleaning_service"), true);
});

test("a city with ten real cleaners stays on that city", () => {
  const rows = Array.from({ length: 12 }, (_, i) => listing({
    id: `c${i}`,
    name: `House Cleaning ${i}`,
    score: 90 - i,
    city: "Austin",
    state: "TX",
    city_slug: "austin-tx",
    county: "Travis County",
  }));
  const board = buildScoreLeaderboard(rows, { city: "Austin", state: "TX" });
  assert.equal(board.entries.length, 10);
  assert.equal(board.title, "Top 10 this week");
  assert.equal(board.scope, "city");
  assert.equal(board.label, "Austin, TX");
  assert.equal(board.entries[0]?.name, "House Cleaning 0");
});

test("Pompano Beach collapses the duplicate and does not borrow nail salons", () => {
  const board = buildScoreLeaderboard([
    listing({
      id: "llc",
      name: "Open Arms Cleaning, LLC",
      score: 70,
      score_grade: "C",
      google_rating: 4.9,
      google_review_count: 60,
      ...POMPANO,
    }),
    listing({
      id: "plain",
      name: "Open Arms Cleaning",
      score: 41,
      score_grade: "F",
      ...POMPANO,
    }),
    listing({
      id: "nails",
      name: "TN Nails Spa",
      city: "Deerfield Beach",
      city_slug: "deerfield-beach-fl",
      score: 75,
      latitude: 26.3034433,
      longitude: -80.1317894,
    }),
    listing({
      id: "spa",
      name: "YOLO SPA",
      city: "Deerfield Beach",
      city_slug: "deerfield-beach-fl",
      score: 80,
      latitude: 26.3171465,
      longitude: -80.1512012,
    }),
  ], { city: "Pompano Beach", state: "FL" });

  assert.deepEqual(board.entries.map((row) => row.name), ["Open Arms Cleaning, LLC"]);
  assert.equal(board.title, "Top cleaners this week");
  assert.equal(board.scope, "city");
  assert.equal(board.label, "Pompano Beach, FL");
});

test("a thin city widens to its county when that fills ten real businesses", () => {
  const rows = [
    listing({ id: "city", name: "Open Arms Cleaning", score: 70, county: "Broward County", ...POMPANO }),
    ...Array.from({ length: 9 }, (_, i) => listing({
      id: `b${i}`,
      name: `Broward Maid ${i}`,
      city: "Fort Lauderdale",
      city_slug: "fort-lauderdale-fl",
      county: "Broward County",
      score: 80 - i,
      latitude: 26.12,
      longitude: -80.14,
    })),
    listing({
      id: "miami",
      name: "The Prime Cleaner",
      city: "Miami",
      city_slug: "miami-fl",
      county: "Miami-Dade County",
      score: 99,
      latitude: 25.7979951,
      longitude: -80.188572,
    }),
  ];
  const board = buildScoreLeaderboard(rows, { city: "Pompano Beach", state: "FL" });
  assert.equal(board.entries.length, 10);
  assert.equal(board.title, "Top 10 this week");
  assert.equal(board.scope, "county");
  assert.equal(board.label, "Broward County, FL");
  assert.equal(board.entries.some((row) => row.city === "Miami"), false);
});

test("businesses across Broward and Miami-Dade are labeled South Florida", () => {
  const rows = [
    listing({ id: "oa", name: "Open Arms Cleaning", score: 70, county: "Broward County", ...POMPANO }),
    ...Array.from({ length: 4 }, (_, i) => listing({
      id: `b${i}`,
      name: `Broward Cleaning ${i}`,
      city: "Hollywood",
      city_slug: "hollywood-fl",
      county: "Broward County",
      score: 60 - i,
      latitude: 26.01,
      longitude: -80.15,
    })),
    ...Array.from({ length: 5 }, (_, i) => listing({
      id: `m${i}`,
      name: `Miami Cleaning ${i}`,
      city: "Miami",
      city_slug: "miami-fl",
      county: "Miami-Dade County",
      score: 75 - i,
      latitude: 25.8,
      longitude: -80.2,
    })),
  ];
  const board = buildScoreLeaderboard(rows, { city: "Pompano Beach", state: "FL" });
  assert.equal(board.entries.length, 10);
  assert.equal(board.scope, "metro");
  assert.equal(board.label, "South Florida");
  assert.equal(board.title, "Top 10 this week");
});

test("nearby cleaners without a county use a distance label and stay inside 40 miles", () => {
  const fortMyers = milesBetween(POMPANO, { latitude: 26.5595199, longitude: -81.8864054 });
  assert.ok(fortMyers > 40);

  const board = buildScoreLeaderboard([
    listing({ id: "oa", name: "Open Arms Cleaning, LLC", score: 70, ...POMPANO }),
    listing({
      id: "prime",
      name: "The Prime Cleaner",
      city: "Miami",
      city_slug: "miami-fl",
      score: 75,
      latitude: 25.7979951,
      longitude: -80.188572,
    }),
    listing({
      id: "far",
      name: "MaidPro Fort Myers",
      city: "Fort Myers",
      city_slug: "fort-myers-fl",
      score: 88,
      latitude: 26.5595199,
      longitude: -81.8864054,
    }),
  ], { city: "Pompano Beach", state: "FL" });

  assert.deepEqual(board.entries.map((row) => row.id), ["prime", "oa"]);
  assert.equal(board.title, "Top cleaners this week");
  assert.equal(board.scope, "radius");
  assert.equal(board.label, "within 40 miles of Pompano Beach, FL");
});

test("fewer than ten stays fewer than ten", () => {
  const board = buildScoreLeaderboard([
    listing({ id: "a", name: "Alpha Cleaning", score: 10 }),
    listing({ id: "b", name: "Bravo Maids", score: 20 }),
    listing({ id: "c", name: "Charlie Housekeeping", score: 30 }),
  ], { city: "Pompano Beach", state: "FL" });
  assert.equal(board.entries.length, 3);
  assert.equal(board.title, "Top cleaners this week");
});

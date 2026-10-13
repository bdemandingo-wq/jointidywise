import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLACES_MAX_RADIUS_M,
  circlesForCounty,
  clampPlacesRadius,
  haversineMeters,
} from "./places-search-circles.ts";

const functionsDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const PLACES = {
  broward: [
    ["Deerfield Beach", 26.318, -80.1],
    ["Parkland", 26.31, -80.237],
    ["Weston", 26.1, -80.4],
    ["Pembroke Pines", 26.003, -80.296],
    ["Hallandale Beach", 25.981, -80.148],
    ["Fort Lauderdale", 26.122, -80.137],
    ["Coral Springs", 26.271, -80.271],
  ],
  "miami dade": [
    ["Aventura", 25.957, -80.139],
    ["Miami", 25.762, -80.192],
    ["Hialeah", 25.857, -80.278],
    ["Doral", 25.819, -80.355],
    ["Kendall", 25.68, -80.357],
    ["Homestead", 25.469, -80.477],
    ["Florida City", 25.447, -80.479],
    ["Key Largo", 25.086, -80.447],
    ["Islamorada", 24.924, -80.628],
    ["Marathon", 24.714, -81.09],
    ["Key West", 24.555, -81.78],
  ],
  "palm beach": [
    ["Boca Raton", 26.368, -80.128],
    ["Delray Beach", 26.461, -80.073],
    ["Boynton Beach", 26.525, -80.067],
    ["West Palm Beach", 26.715, -80.053],
    ["Jupiter", 26.934, -80.095],
    ["Wellington", 26.658, -80.241],
    ["Belle Glade", 26.684, -80.671],
    ["Pahokee", 26.82, -80.665],
  ],
} as const;

test("the seed function does not send a 64 km radius", () => {
  const source = readFileSync(join(functionsDir, "score-seed-house-cleaners/index.ts"), "utf8");
  assert.equal(source.includes("64000"), false);
  assert.match(source, /circlesForCounty/);
  assert.match(source, /errors/);
});

test("clamps a 64 km radius to the Places maximum of 50,000 m", () => {
  assert.equal(clampPlacesRadius(64_000), PLACES_MAX_RADIUS_M);
  assert.equal(clampPlacesRadius(50_000), 50_000);
  assert.equal(clampPlacesRadius(50_000.4), 50_000);
  assert.equal(clampPlacesRadius(12_000), 12_000);
  assert.equal(clampPlacesRadius(0), PLACES_MAX_RADIUS_M);
  assert.equal(clampPlacesRadius(Number.NaN), PLACES_MAX_RADIUS_M);
});

test("every search circle stays at or under 50,000 m", () => {
  for (const county of ["Broward County", "Miami-Dade County", "Palm Beach County"]) {
    const circles = circlesForCounty(county, null);
    assert.ok(circles.length > 0, county);
    for (const circle of circles) {
      assert.ok(circle.radius <= PLACES_MAX_RADIUS_M, `${county} radius ${circle.radius}`);
      assert.equal(circle.radius, PLACES_MAX_RADIUS_M);
    }
  }
});

test("Miami-Dade and Palm Beach use more than one center", () => {
  assert.equal(circlesForCounty("Broward", null).length, 1);
  assert.ok(circlesForCounty("Miami-Dade", null).length > 1);
  assert.ok(circlesForCounty("Palm Beach County", null).length > 1);
});

test("county circles cover the populated places in each county", () => {
  for (const [county, places] of Object.entries(PLACES)) {
    const circles = circlesForCounty(county, null);
    for (const [name, latitude, longitude] of places) {
      const nearest = Math.min(
        ...circles.map((circle) => haversineMeters(circle, { latitude, longitude })),
      );
      assert.ok(
        nearest <= PLACES_MAX_RADIUS_M,
        `${name} is ${Math.round(nearest)} m from the nearest ${county} center`,
      );
    }
  }
});

test("other counties get one clamped circle at the known point", () => {
  const circles = circlesForCounty("Lee County", { latitude: 26.64, longitude: -81.87 });
  assert.equal(circles.length, 1);
  assert.equal(circles[0]?.radius, PLACES_MAX_RADIUS_M);
  assert.equal(circles[0]?.latitude, 26.64);
  assert.equal(circles.length, circlesForCounty(null, { latitude: 26.64, longitude: -81.87 }).length);
  assert.deepEqual(circlesForCounty(null, null), []);
});

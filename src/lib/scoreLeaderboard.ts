/**
 * Landing-page leaderboard for the TidyWise Score.
 *
 * Every row has to already exist. This module drops duplicates, leaves out
 * businesses that are not house cleaning, and widens the label only as far
 * as the real rows reach. It never pads the list.
 *
 * Keep the name and exclusion rules aligned with
 * supabase/functions/score-seed-house-cleaners/index.ts.
 */

export const LEADERBOARD_LIMIT = 10;
export const NEARBY_RADIUS_MILES = 40;

const LEGAL_SUFFIX =
  /\b(?:l l c|llc|incorporated|inc|corporation|corp|company|co|limited|ltd|p l l c|pllc|pc|dba)\b/g;

const HOUSE_NAME = /\b(?:clean(?:ing|er|ers)?|maids?|maidpro|housekeep(?:ing|er|ers)?)\b/i;

const EXCLUDED_NAME =
  /\bwindows?\b[\s-]*(?:clean(?:ing|er|ers)?|wash(?:ing|er|ers)?)|\b(?:pressure|power|soft)[\s-]*wash(?:ing|er|ers)?\b|\bgutter\b|\broof\s*clean|\bdry\s*clean|\bcar\s*wash|\bpool\s*clean/i;

/** Tri-county South Florida. Used only when every listed business is in this set. */
const SOUTH_FLORIDA = new Set(["broward", "miami dade", "palm beach"]);

export type ScoreListing = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  state: string | null;
  city_slug: string | null;
  score: number | null;
  score_grade: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  latitude: number | null;
  longitude: number | null;
  county: string | null;
  primary_type: string | null;
};

export type LeaderboardScope = "city" | "county" | "metro" | "radius";

export type ScoreLeaderboard = {
  entries: ScoreListing[];
  scope: LeaderboardScope;
  /** Honest place name for the rows actually returned. */
  label: string;
  /** "Top 10 this week" only when 10 real businesses are shown. */
  title: string;
};

export type LeaderboardAnchor = {
  city: string;
  state: string;
};

export function businessNameKey(name: string): string {
  const spaced = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return spaced.replace(LEGAL_SUFFIX, " ").replace(/\s+/g, " ").trim();
}

export function isHouseCleaningListing(name: string, primaryType: string | null | undefined): boolean {
  const trimmed = name.trim();
  if (!trimmed || EXCLUDED_NAME.test(trimmed)) return false;
  const type = (primaryType ?? "").trim();
  if (type === "house_cleaning_service") return true;
  if (type === "cleaning_service") return HOUSE_NAME.test(trimmed);
  if (type) return false;
  return HOUSE_NAME.test(trimmed);
}

export function leaderboardTitle(count: number): string {
  return count >= LEADERBOARD_LIMIT ? "Top 10 this week" : "Top cleaners this week";
}

export function milesBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const earth = 3958.8;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function compareListings<T extends {
  id: string;
  score: number | null;
  google_rating: number | null;
  google_review_count: number | null;
}>(a: T, b: T): number {
  const scoreA = finite(a.score);
  const scoreB = finite(b.score);
  if (scoreA != null && scoreB != null && scoreA !== scoreB) return scoreB - scoreA;
  if ((scoreA != null) !== (scoreB != null)) return scoreA != null ? -1 : 1;
  const ratingA = finite(a.google_rating) ?? -1;
  const ratingB = finite(b.google_rating) ?? -1;
  if (ratingA !== ratingB) return ratingB - ratingA;
  const reviewsA = finite(a.google_review_count) ?? 0;
  const reviewsB = finite(b.google_review_count) ?? 0;
  if (reviewsA !== reviewsB) return reviewsB - reviewsA;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export function dedupeScoreListings<T extends {
  id: string;
  name: string;
  score: number | null;
  google_rating: number | null;
  google_review_count: number | null;
}>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const row of rows) {
    const key = businessNameKey(row.name) || `id:${row.id}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else {
      groups.set(key, [row]);
      order.push(key);
    }
  }
  const winners: T[] = [];
  for (const key of order) {
    const group = groups.get(key) ?? [];
    group.sort(compareListings);
    if (group[0]) winners.push(group[0]);
  }
  winners.sort(compareListings);
  return winners;
}

function sameText(a: string | null | undefined, b: string): boolean {
  return (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();
}

function placeSlug(city: string, state: string): string {
  return `${city}-${state}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function inAnchorCity(row: ScoreListing, anchor: LeaderboardAnchor): boolean {
  if (row.city_slug && row.city_slug === placeSlug(anchor.city, anchor.state)) return true;
  return sameText(row.city, anchor.city) && sameText(row.state, anchor.state);
}

function countyKey(county: string | null | undefined): string | null {
  if (!county) return null;
  const key = county.toLowerCase().replace(/\bcounty\b/g, "").replace(/[^a-z]+/g, " ").trim();
  return key || null;
}

function formatCounty(county: string, state: string): string {
  const trimmed = county.trim().replace(/\s+/g, " ");
  const labeled = /county$/i.test(trimmed) ? trimmed : `${trimmed} County`;
  return `${labeled}, ${state.trim().toUpperCase()}`;
}

function modeCounty(rows: ScoreListing[]): string | null {
  const counts = new Map<string, { label: string; n: number }>();
  for (const row of rows) {
    const key = countyKey(row.county);
    if (!key || !row.county) continue;
    const current = counts.get(key);
    if (current) current.n += 1;
    else counts.set(key, { label: row.county, n: 1 });
  }
  let best: { label: string; n: number } | null = null;
  for (const value of counts.values()) {
    if (!best || value.n > best.n) best = value;
  }
  return best && best.n >= 1 ? best.label : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (left == null || right == null) return null;
  return (left + right) / 2;
}

function centerOf(rows: ScoreListing[]): { latitude: number; longitude: number } | null {
  const latitudes: number[] = [];
  const longitudes: number[] = [];
  for (const row of rows) {
    if (finite(row.latitude) == null || finite(row.longitude) == null) continue;
    latitudes.push(row.latitude as number);
    longitudes.push(row.longitude as number);
  }
  const latitude = median(latitudes);
  const longitude = median(longitudes);
  if (latitude == null || longitude == null) return null;
  return { latitude, longitude };
}

function withinRadius(row: ScoreListing, center: { latitude: number; longitude: number }): boolean {
  if (finite(row.latitude) == null || finite(row.longitude) == null) return false;
  return milesBetween(center, { latitude: row.latitude as number, longitude: row.longitude as number })
    <= NEARBY_RADIUS_MILES;
}

function top(rows: ScoreListing[]): ScoreListing[] {
  return [...rows].sort(compareListings).slice(0, LEADERBOARD_LIMIT);
}

function labelFor(entries: ScoreListing[], anchor: LeaderboardAnchor, widened: boolean): { scope: LeaderboardScope; label: string } {
  const cityLabel = `${anchor.city}, ${anchor.state}`;
  if (!widened || entries.every((row) => inAnchorCity(row, anchor))) {
    return { scope: "city", label: cityLabel };
  }
  const counties = entries.map((row) => countyKey(row.county));
  if (counties.length > 0 && counties.every((key) => key && key === counties[0])) {
    const sample = entries.find((row) => countyKey(row.county) === counties[0]);
    if (sample?.county) {
      return { scope: "county", label: formatCounty(sample.county, anchor.state) };
    }
  }
  if (counties.length > 0 && counties.every((key) => key != null && SOUTH_FLORIDA.has(key)) && sameText(anchor.state, "FL")) {
    return { scope: "metro", label: "South Florida" };
  }
  return { scope: "radius", label: `within ${NEARBY_RADIUS_MILES} miles of ${cityLabel}` };
}

/**
 * Rank real house-cleaning listings around a city.
 * A shorter list keeps a shorter title. Nothing is added to fill ten spots.
 */
export function buildScoreLeaderboard(rows: ScoreListing[], anchor: LeaderboardAnchor): ScoreLeaderboard {
  const eligible = rows.filter((row) =>
    isHouseCleaningListing(row.name, row.primary_type) && sameText(row.state, anchor.state)
  );
  const unique = dedupeScoreListings(eligible);
  const cityRows = unique.filter((row) => inAnchorCity(row, anchor));
  let pool = cityRows;
  let widened = false;

  if (pool.length < LEADERBOARD_LIMIT) {
    const county = modeCounty(cityRows);
    const countyName = countyKey(county);
    if (countyName) {
      const countyRows = unique.filter((row) => countyKey(row.county) === countyName);
      if (countyRows.length > pool.length) {
        pool = countyRows;
        widened = true;
      }
    }
  }

  if (pool.length < LEADERBOARD_LIMIT) {
    const center = centerOf(cityRows);
    if (center) {
      const nearby = unique.filter((row) => inAnchorCity(row, anchor) || withinRadius(row, center));
      if (nearby.length > pool.length) {
        pool = nearby;
        widened = true;
      }
    }
  }

  const entries = top(pool);
  const place = labelFor(entries, anchor, widened);
  return {
    entries,
    scope: place.scope,
    label: place.label,
    title: leaderboardTitle(entries.length),
  };
}

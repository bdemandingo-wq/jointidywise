/**
 * Google Places Text Search (New) rejects a circle radius above 50,000 meters.
 * These centers stay inside that cap and, together, cover the populated land
 * of Broward, Miami-Dade (including the Keys), and Palm Beach (including the Glades).
 *
 * Centers are public county geography, not businesses. Other counties use one
 * clamped circle around the known point.
 */

export const PLACES_MAX_RADIUS_M = 50_000;

export type SearchCircle = {
  latitude: number;
  longitude: number;
  radius: number;
};

type LatLng = { latitude: number; longitude: number };

const COUNTY_CIRCLES: Record<string, LatLng[]> = {
  broward: [{ latitude: 26.16, longitude: -80.27 }],
  "miami dade": [
    { latitude: 25.8, longitude: -80.28 },
    { latitude: 25.09, longitude: -80.45 },
    { latitude: 24.72, longitude: -81.05 },
    { latitude: 24.555, longitude: -81.78 },
  ],
  "palm beach": [
    { latitude: 26.45, longitude: -80.12 },
    { latitude: 26.85, longitude: -80.1 },
    { latitude: 26.75, longitude: -80.67 },
  ],
};

export function clampPlacesRadius(meters: number): number {
  if (!Number.isFinite(meters) || meters <= 0) return PLACES_MAX_RADIUS_M;
  return Math.min(meters, PLACES_MAX_RADIUS_M);
}

export function normalizeCountyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/\bcounty\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const earth = 6_371_000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function circlesForCounty(
  countyName: string | null | undefined,
  origin: LatLng | null,
): SearchCircle[] {
  const key = countyName ? normalizeCountyName(countyName) : "";
  const centers = COUNTY_CIRCLES[key];
  if (centers) {
    return centers.map((center) => ({ ...center, radius: PLACES_MAX_RADIUS_M }));
  }
  if (
    origin &&
    Number.isFinite(origin.latitude) &&
    Number.isFinite(origin.longitude)
  ) {
    return [{ ...origin, radius: PLACES_MAX_RADIUS_M }];
  }
  return [];
}

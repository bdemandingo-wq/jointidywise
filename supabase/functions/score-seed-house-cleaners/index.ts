// Seeds the TidyWise Score directory with real house-cleaning businesses
// from Google Places. It never inserts a business that Google did not return.
//
// Secret: GOOGLE_PLACES_API_KEY
// The same secret already used by score-lookup, score-compute, geocode-address,
// address-autocomplete, get-driving-eta, and place-id-resolve. If it is not
// set, this function writes nothing and returns
// { reason: "GOOGLE_PLACES_API_KEY not configured" }.
//
// Public (verify_jwt = false) so the landing page can fill a thin city.
// Rate limited: one successful run per city per 24 hours, 40 runs per day,
// and a per-IP cap. Only house_cleaning_service listings are stored.
// Window cleaning and pressure washing are dropped by name and by type.
//
// Deploy this function after migration 20261013460000_growth_trust_count_and_score_geo.sql.
// Confirm deployed, not just committed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PLACES_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";
const CITY_RE = /^[A-Za-z][A-Za-z .'-]{0,40}$/;
const STATE_RE = /^[A-Za-z]{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const STARTED_MS = 10 * 60 * 1000;
const DAILY_CITY_CAP = 40;
const IP_LIMIT = 8;
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.location",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.addressComponents",
  "places.primaryType",
  "places.types",
].join(",");

// Keep aligned with src/lib/scoreLeaderboard.ts.
const HOUSE_NAME = /\b(?:clean(?:ing|er|ers)?|maids?|maidpro|housekeep(?:ing|er|ers)?)\b/i;
const EXCLUDED_NAME =
  /\bwindows?\b[\s-]*(?:clean(?:ing|er|ers)?|wash(?:ing|er|ers)?)|\b(?:pressure|power|soft)[\s-]*wash(?:ing|er|ers)?\b|\bgutter\b|\broof\s*clean|\bdry\s*clean|\bcar\s*wash|\bpool\s*clean/i;
const EXCLUDED_TYPE = /window|pressure|power_wash|car_wash|laundromat|dry_clean|gas_station|beauty_salon|hair_care|nail|spa|plumber|restaurant|doctor|dentist|gym/i;

type Bucket = { hits: number; resetAt: number };
const buckets = new Map<string, Bucket>();

type AddressComponent = { longText?: string; shortText?: string; types?: string[] };
type Place = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  location?: { latitude?: number; longitude?: number };
  websiteUri?: string;
  nationalPhoneNumber?: string;
  addressComponents?: AddressComponent[];
  primaryType?: string;
  types?: string[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("cf-connecting-ip")
    || "";
  return forwarded.slice(0, 64) || "unknown";
}

function limited(ip: string): boolean {
  const now = Date.now();
  const current = buckets.get(ip);
  if (!current || current.resetAt <= now) {
    buckets.set(ip, { hits: 1, resetAt: now + 10 * 60 * 1000 });
    return false;
  }
  current.hits += 1;
  return current.hits > IP_LIMIT;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 120);
}

function businessNameKey(name: string): string {
  const spaced = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return spaced
    .replace(/\b(?:l l c|llc|incorporated|inc|corporation|corp|company|co|limited|ltd|p l l c|pllc|pc|dba)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function component(place: Place, type: string): AddressComponent | null {
  return (place.addressComponents ?? []).find((item) => item.types?.includes(type)) ?? null;
}

function componentText(place: Place, type: string, form: "long" | "short"): string | null {
  const item = component(place, type);
  if (!item) return null;
  const value = form === "short" ? item.shortText ?? item.longText : item.longText ?? item.shortText;
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

const GENERIC_TYPE = new Set(["service", "point_of_interest", "establishment"]);

function acceptPlace(place: Place, strict: boolean): boolean {
  const name = place.displayName?.text?.trim() ?? "";
  if (!name || EXCLUDED_NAME.test(name)) return false;
  const types = [place.primaryType ?? "", ...(place.types ?? [])].filter(Boolean);
  if (types.some((type) => EXCLUDED_TYPE.test(type))) return false;
  if (types.includes("house_cleaning_service")) return true;
  if (types.includes("cleaning_service") && HOUSE_NAME.test(name)) return true;
  // A strict house_cleaning_service query already filtered the trade.
  // Keep the listing when Google omits the type field, and still drop
  // window or pressure names above.
  // Google's Text Search does not support the house_cleaning_service type,
  // so most real maid services come back typed only as generic "service".
  // Accept those when the business name clearly says cleaning/maid.
  if (types.every((type) => GENERIC_TYPE.has(type))) return HOUSE_NAME.test(name);
  return strict && types.length === 0;
}

function directoryHouseCleaner(name: string, primaryType: string | null): boolean {
  if (!name.trim() || EXCLUDED_NAME.test(name)) return false;
  if (primaryType === "house_cleaning_service") return true;
  if (primaryType === "cleaning_service") return HOUSE_NAME.test(name);
  if (primaryType) return false;
  return HOUSE_NAME.test(name);
}

async function searchPlaces(textQuery: string, extra: Record<string, unknown>): Promise<{ places: Place[]; strict: boolean }> {
  const run = async (strict: boolean) => {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": PLACES_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery,
        maxResultCount: 20,
        includePureServiceAreaBusinesses: true,
        regionCode: "us",
        ...(strict ? { includedType: "house_cleaning_service", strictTypeFiltering: true } : {}),
        ...extra,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`places ${response.status}: ${detail.slice(0, 180)}`);
    }
    const payload = await response.json();
    return Array.isArray(payload.places) ? payload.places as Place[] : [];
  };
  try {
    const strictPlaces = await run(true);
    if (strictPlaces.length > 0) return { places: strictPlaces, strict: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.startsWith("places 400")) throw error;
  }
  return { places: await run(false), strict: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (limited(clientIp(req))) return json({ inserted: 0, updated: 0, reason: "rate_limited" }, 429);

  const body = await req.json().catch(() => null) as { city?: unknown; state?: unknown } | null;
  const city = typeof body?.city === "string" ? body.city.trim() : "";
  const state = typeof body?.state === "string" ? body.state.trim().toUpperCase() : "";
  if (!CITY_RE.test(city) || !STATE_RE.test(state)) {
    return json({ error: "city and state are required" }, 400);
  }

  if (!PLACES_KEY) {
    return json({
      inserted: 0,
      updated: 0,
      reason: "GOOGLE_PLACES_API_KEY not configured",
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const citySlug = slugify(`${city}-${state}`);
  const since = new Date(Date.now() - DAY_MS).toISOString();

  const { count: dailyCount, error: dailyError } = await supabase
    .from("score_seed_runs")
    .select("id", { count: "exact", head: true })
    .eq("status", "ok")
    .gte("seeded_at", since);
  if (dailyError) return json({ inserted: 0, updated: 0, reason: dailyError.message }, 500);
  if ((dailyCount ?? 0) >= DAILY_CITY_CAP) {
    return json({ inserted: 0, updated: 0, reason: "daily_quota" });
  }

  const { data: recent, error: recentError } = await supabase
    .from("score_seed_runs")
    .select("status, seeded_at")
    .eq("city_slug", citySlug)
    .gte("seeded_at", since)
    .order("seeded_at", { ascending: false })
    .limit(8);
  if (recentError) return json({ inserted: 0, updated: 0, reason: recentError.message }, 500);

  const now = Date.now();
  const blocked = (recent ?? []).some((row) => {
    const at = new Date(row.seeded_at).getTime();
    if (row.status === "ok") return now - at < DAY_MS;
    if (row.status === "started") return now - at < STARTED_MS;
    return false;
  });
  if (blocked) return json({ inserted: 0, updated: 0, reason: "already_seeded" });

  const { data: started, error: startError } = await supabase
    .from("score_seed_runs")
    .insert({ city_slug: citySlug, status: "started" })
    .select("id")
    .single();
  if (startError || !started) {
    return json({ inserted: 0, updated: 0, reason: startError?.message ?? "seed log failed" }, 500);
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const seen = new Set<string>();

  const finish = async (status: string, reason: string | null, http = 200) => {
    await supabase
      .from("score_seed_runs")
      .update({ status, inserted_count: inserted, updated_count: updated })
      .eq("id", started.id);
    return json({ inserted, updated, skipped, reason }, http);
  };

  const upsertPlace = async (place: Place, strict: boolean) => {
    const placeId = place.id?.trim() ?? "";
    const name = place.displayName?.text?.trim() ?? "";
    if (!placeId || seen.has(placeId)) return;
    seen.add(placeId);
    if (!acceptPlace(place, strict)) {
      skipped += 1;
      return;
    }

    const placeCity = componentText(place, "locality", "long")
      ?? componentText(place, "postal_town", "long")
      ?? componentText(place, "sublocality", "long");
    const placeState = componentText(place, "administrative_area_level_1", "short");
    if (!placeCity || !placeState || !/^[A-Za-z]{2}$/.test(placeState)) {
      skipped += 1;
      return;
    }
    const county = componentText(place, "administrative_area_level_2", "long");
    const zip = componentText(place, "postal_code", "short");
    const latitude = typeof place.location?.latitude === "number" ? place.location.latitude : null;
    const longitude = typeof place.location?.longitude === "number" ? place.location.longitude : null;
    const rating = typeof place.rating === "number" ? place.rating : null;
    const reviewCount = typeof place.userRatingCount === "number" ? place.userRatingCount : null;
    // Generic types are stored as null so the directory falls back to the
    // name check, matching isHouseCleaningListing in the app.
    const rawPrimary = place.primaryType && !GENERIC_TYPE.has(place.primaryType) ? place.primaryType : null;
    const primaryType = rawPrimary ?? (place.types?.includes("house_cleaning_service") ? "house_cleaning_service" : null);

    const { data: existing, error: existingError } = await supabase
      .from("score_companies")
      .select("id, claimed")
      .eq("google_place_id", placeId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    const shared = {
      city: placeCity,
      state: placeState.toUpperCase(),
      city_slug: slugify(`${placeCity}-${placeState}`),
      county,
      zip,
      formatted_address: place.formattedAddress ?? null,
      latitude,
      longitude,
      website: place.websiteUri ?? null,
      phone: place.nationalPhoneNumber ?? null,
      primary_type: primaryType,
      ...(rating != null ? { google_rating: rating } : {}),
      ...(reviewCount != null ? { google_review_count: reviewCount } : {}),
    };

    if (existing) {
      const patch = existing.claimed ? shared : { ...shared, name };
      const { error } = await supabase.from("score_companies").update(patch).eq("id", existing.id);
      if (error) throw new Error(error.message);
      updated += 1;
      return;
    }

    const slug = `${slugify(name) || "cleaner"}-${placeId.slice(-6).toLowerCase()}`;
    const { error } = await supabase.from("score_companies").insert({
      ...shared,
      slug,
      name,
      google_place_id: placeId,
      source: "google_places",
    });
    if (error) throw new Error(error.message);
    inserted += 1;
  };

  try {
    const citySearch = await searchPlaces(`house cleaning service in ${city}, ${state}`, {});
    const cityPlaces = citySearch.places;
    for (const place of cityPlaces) await upsertPlace(place, citySearch.strict);

    const { data: cityRows } = await supabase
      .from("score_companies")
      .select("name, primary_type")
      .eq("city_slug", citySlug)
      .limit(80);
    const cityKeys = new Set(
      (cityRows ?? [])
        .filter((row) => directoryHouseCleaner(row.name ?? "", row.primary_type ?? null))
        .map((row) => businessNameKey(row.name ?? ""))
        .filter(Boolean),
    );

    if (cityKeys.size < 10) {
      const countyPlace = cityPlaces.find((place) => acceptPlace(place, citySearch.strict));
      const county = countyPlace ? componentText(countyPlace, "administrative_area_level_2", "long") : null;
      if (county) {
        const countySearch = await searchPlaces(`house cleaning service in ${county}, ${state}`, {});
        for (const place of countySearch.places) await upsertPlace(place, countySearch.strict);
      }

      const located = cityPlaces.find((place) =>
        typeof place.location?.latitude === "number" && typeof place.location?.longitude === "number"
      );
      if (located?.location?.latitude != null && located.location.longitude != null) {
        const radiusSearch = await searchPlaces(`house cleaning service in ${city}, ${state}`, {
          locationBias: {
            circle: {
              center: { latitude: located.location.latitude, longitude: located.location.longitude },
              radius: 50000,
            },
          },
        });
        for (const place of radiusSearch.places) await upsertPlace(place, radiusSearch.strict);
      }
    }

    console.log("[score-seed]", citySlug, "inserted", inserted, "updated", updated, "skipped", skipped);
    return await finish("ok", null);
  } catch (error) {
    const message = error instanceof Error ? error.message : "seed failed";
    console.error("[score-seed]", citySlug, message);
    return await finish("error", message, 502);
  }
});

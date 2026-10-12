// Google Places (New) v1 proxy for address autocomplete + details.
// Actions:
//   { action: "suggest", input: string, sessionToken?: string, bookingOrgSlug?: string }
//   { action: "details", placeId: string, sessionToken?: string, bookingOrgSlug?: string }
//
// Auth: a user JWT (org member or staff), a client-portal session, or — for
// the public booking page only — an anonymous call that names a real org
// slug. Anonymous calls are rate-limited per IP.
import { authorizeMapsProxy } from "../_shared/maps-proxy-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-portal-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PLACES_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!PLACES_KEY) return json({ error: "GOOGLE_PLACES_API_KEY not configured" }, 500);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const gate = await authorizeMapsProxy(req, corsHeaders, {
    bucket: "maps_autocomplete",
    authenticatedPerMinute: 90,
    anonymous: { perMinute: 40, perHour: 400 },
    requireBookingOrg: true,
    bookingOrgSlug: typeof body?.bookingOrgSlug === "string" ? body.bookingOrgSlug : null,
  });
  if (gate) return gate;

  const action = String(body?.action ?? "");
  const sessionToken =
    typeof body?.sessionToken === "string" && body.sessionToken.length > 0
      ? body.sessionToken
      : undefined;

  try {
    if (action === "suggest") {
      const input = String(body?.input ?? "").trim();
      if (!input) return json({ suggestions: [] });

      const rawRegion = typeof body?.regionCode === "string" ? body.regionCode.trim() : "";
      const regionCode = /^[A-Za-z]{2}$/.test(rawRegion) ? rawRegion.toLowerCase() : undefined;

      const reqBody: Record<string, unknown> = {
        input,
        includedPrimaryTypes: ["street_address", "premise", "subpremise", "route"],
      };
      if (sessionToken) reqBody.sessionToken = sessionToken;
      if (regionCode) reqBody.includedRegionCodes = [regionCode];

      const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": PLACES_KEY,
        },
        body: JSON.stringify(reqBody),
      });

      if (!r.ok) {
        const t = await r.text();
        console.error("places:autocomplete failed", r.status, t);
        return json({ error: "places autocomplete failed", details: t }, 502);
      }
      const data = await r.json();
      const suggestions = (data.suggestions ?? [])
        .map((s: any) => s.placePrediction)
        .filter(Boolean)
        .map((p: any) => ({
          placeId: p.placeId,
          text: p.text?.text ?? "",
          mainText: p.structuredFormat?.mainText?.text ?? "",
          secondaryText: p.structuredFormat?.secondaryText?.text ?? "",
        }));
      return json({ suggestions });
    }

    if (action === "details") {
      const placeId = String(body?.placeId ?? "").trim();
      if (!placeId) return json({ error: "placeId required" }, 400);

      const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${
        sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : ""
      }`;
      const r = await fetch(url, {
        headers: {
          "X-Goog-Api-Key": PLACES_KEY,
          "X-Goog-FieldMask":
            "id,formattedAddress,addressComponents,location",
        },
      });

      if (!r.ok) {
        const t = await r.text();
        console.error("places.details failed", r.status, t);
        return json({ error: "places details failed", details: t }, 502);
      }
      const p = await r.json();
      const comps: any[] = p.addressComponents ?? [];
      const get = (type: string, short = false) => {
        const c = comps.find((c) => (c.types ?? []).includes(type));
        if (!c) return "";
        return short ? c.shortText ?? c.longText ?? "" : c.longText ?? c.shortText ?? "";
      };

      const streetNumber = get("street_number");
      const route = get("route");
      const street = [streetNumber, route].filter(Boolean).join(" ").trim();
      const city =
        get("locality") ||
        get("postal_town") ||
        get("sublocality") ||
        get("sublocality_level_1") ||
        get("administrative_area_level_2");
      const state = get("administrative_area_level_1", true);
      const zip = get("postal_code");
      const country = get("country", true);

      return json({
        street,
        city,
        state,
        zip,
        country,
        lat: p.location?.latitude ?? null,
        lng: p.location?.longitude ?? null,
        formattedAddress: p.formattedAddress ?? "",
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("address-autocomplete error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

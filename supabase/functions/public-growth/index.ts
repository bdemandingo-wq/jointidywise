import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Public snapshot of lifetime spots, weekly signups, and the anonymous
 * activity feed. The SQL functions are the source of truth and already
 * return only aggregates or sanitized city-level fields. This wrapper
 * adds a 45s response cache and a per-IP limit so the marketing pages
 * are not a way to hammer the bookings table.
 *
 * Intentionally unauthenticated (verify_jwt = false). It never reads a
 * caller identity and never returns a name, address, or id.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const CACHE_MS = 45_000;
const LIMIT = 30;

type Bucket = { hits: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let snapshot: { at: number; body: unknown } | null = null;

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
    buckets.set(ip, { hits: 1, resetAt: now + 60_000 });
    if (buckets.size > 5000) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
    }
    return false;
  }
  current.hits += 1;
  return current.hits > LIMIT;
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=45",
      ...extra,
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const ip = clientIp(req);
  if (limited(ip)) {
    return json({ error: "rate_limited" }, 429, { "Cache-Control": "no-store" });
  }

  if (snapshot && Date.now() - snapshot.at < CACHE_MS) {
    return json(snapshot.body);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const [counters, feed] = await Promise.all([
    supabase.rpc("get_public_growth_counters"),
    supabase.rpc("get_public_activity_feed"),
  ]);

  if (counters.error || feed.error) {
    return json({
      error: counters.error?.message || feed.error?.message || "unavailable",
    }, 500, { "Cache-Control": "no-store" });
  }

  const body = { counters: counters.data, feed: feed.data };
  snapshot = { at: Date.now(), body };
  return json(body);
});

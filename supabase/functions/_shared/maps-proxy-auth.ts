// Auth + rate limit for the Google Maps proxies.
//
// Logged-in staff/admins (user JWT) and client-portal sessions are allowed
// at a human typing rate. Anonymous callers are allowed only when the
// function opts in, and are capped per IP so a public page cannot be used
// to drain the Places budget.
//
// address-autocomplete sets requireBookingOrg: the public booking page is
// the only anonymous caller, and it must name a real organization slug.
// place-id-resolve leaves that off: its anonymous caller is the public
// score page (/score/generate), which has no org slug.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { checkAndRecord, getClientIp } from "./rate-limit.ts";
import { verifyPortalSession } from "./portal-session.ts";

export interface MapsProxyOptions {
  /** Rate-limit bucket prefix, e.g. "maps_autocomplete". */
  bucket: string;
  /** Per-minute cap for a signed-in user or portal session. */
  authenticatedPerMinute: number;
  /** Anonymous caps. Omit to reject every unauthenticated caller. */
  anonymous?: { perMinute: number; perHour: number };
  /**
   * When set, an anonymous caller must also pass a bookingOrgSlug that
   * matches organizations.slug. Ignored for authenticated callers.
   */
  requireBookingOrg?: boolean;
  bookingOrgSlug?: string | null;
}

function json(corsHeaders: Record<string, string>, body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function limited(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  bucket: string,
  identifier: string,
  maxPerWindow: number,
  windowSeconds: number,
): Promise<boolean> {
  const result = await checkAndRecord(supabase, bucket, identifier, { maxPerWindow, windowSeconds });
  return result.blocked;
}

/**
 * Returns a Response when the caller must be rejected, or null when the
 * Google call may proceed.
 */
export async function authorizeMapsProxy(
  req: Request,
  corsHeaders: Record<string, string>,
  opts: MapsProxyOptions,
): Promise<Response | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json(corsHeaders, { error: "Server configuration error" }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";

  let identity: string | null = null;

  if (bearer) {
    const { data, error } = await supabase.auth.getUser(bearer);
    if (!error && data?.user) {
      const userId = data.user.id;
      const [{ data: memberships }, { data: staffRows }] = await Promise.all([
        supabase.from("org_memberships").select("organization_id").eq("user_id", userId).limit(1),
        supabase.from("staff").select("id").eq("user_id", userId).limit(1),
      ]);
      if ((memberships && memberships.length > 0) || (staffRows && staffRows.length > 0)) {
        identity = `user:${userId}`;
      }
    }
  }

  if (!identity && req.headers.get("x-portal-session")) {
    const session = await verifyPortalSession(req, supabase);
    if (session.ok) identity = `portal:${session.portal_user_id}`;
  }

  if (identity) {
    const blocked = await limited(
      supabase,
      opts.bucket,
      identity,
      opts.authenticatedPerMinute,
      60,
    );
    if (blocked) return json(corsHeaders, { error: "Too many requests" }, 429);
    return null;
  }

  if (!opts.anonymous) {
    return json(corsHeaders, { error: "Unauthorized" }, 401);
  }

  if (opts.requireBookingOrg) {
    const slug = (opts.bookingOrgSlug ?? "").trim();
    if (!slug || slug.length > 120) {
      return json(corsHeaders, { error: "Unauthorized" }, 401);
    }
    const { data: orgs, error: orgErr } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .limit(1);
    if (orgErr) {
      console.error("[maps-proxy-auth] org lookup failed", orgErr.message);
      return json(corsHeaders, { error: "Could not verify booking page" }, 500);
    }
    if (!orgs || orgs.length === 0) {
      return json(corsHeaders, { error: "Unauthorized" }, 401);
    }
  }

  const ip = getClientIp(req);
  const minuteBlocked = await limited(supabase, `${opts.bucket}_anon_min`, ip, opts.anonymous.perMinute, 60);
  if (minuteBlocked) return json(corsHeaders, { error: "Too many requests" }, 429);
  const hourBlocked = await limited(supabase, `${opts.bucket}_anon_hour`, ip, opts.anonymous.perHour, 3600);
  if (hourBlocked) return json(corsHeaders, { error: "Too many requests" }, 429);
  return null;
}

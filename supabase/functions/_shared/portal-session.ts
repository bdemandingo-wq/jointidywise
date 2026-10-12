// Signed session tokens for the client portal.
//
// The client portal has no Supabase auth session — logins are validated
// against the `client_portal_users` table via a bcrypt hash inside the
// `client-portal-login` edge function. Prior to this module, portal-facing
// edge functions trusted a `client_user_id` UUID sent in the request body,
// which meant anyone who obtained a valid UUID could impersonate that user.
//
// After login, `client-portal-login` mints a compact HS256 JWT signed with
// PORTAL_SESSION_SECRET containing the portal_user_id, customer_id, and
// organization_id. The client stores it in localStorage and sends it on
// every edge-function call as the `x-portal-session` header. Portal-facing
// functions call `verifyPortalSession(req, supabase)` which:
//   1) parses + HMAC-verifies the token,
//   2) checks it hasn't expired,
//   3) re-loads the client_portal_users row to confirm it's still active.
//
// Never trust portal_user_id / organization_id from the request body —
// always take them from the verified session.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const encoder = new TextEncoder();

function b64urlEncode(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string"
    ? btoa(bytes)
    : btoa(String.fromCharCode(...bytes));
  return raw.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export interface PortalSessionClaims {
  portal_user_id: string;
  customer_id: string;
  organization_id: string;
  iat: number;
  exp: number;
}

// The client portal tells the browser the session lasts 30 days
// (ClientPortalContext saveSession). A 7-day token logged people out
// while localStorage still considered them signed in.
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export async function mintPortalSession(
  input: { portal_user_id: string; customer_id: string; organization_id: string },
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const secret = Deno.env.get("PORTAL_SESSION_SECRET");
  if (!secret) throw new Error("PORTAL_SESSION_SECRET is not configured");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload: PortalSessionClaims = {
    portal_user_id: input.portal_user_id,
    customer_id: input.customer_id,
    organization_id: input.organization_id,
    iat: now,
    exp: now + ttlSeconds,
  };

  const headerB64 = b64urlEncode(JSON.stringify(header));
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput)),
  );
  return `${signingInput}.${b64urlEncode(sig)}`;
}

export type VerifyResult =
  | {
    ok: true;
    portal_user_id: string;
    customer_id: string;
    organization_id: string;
  }
  | { ok: false; status: number; error: string };

export async function verifyPortalSession(
  req: Request,
  // Deliberately loose: callers pin different supabase-js versions and the
  // structural types are incompatible across them.
  // deno-lint-ignore no-explicit-any
  supabaseOverride?: any,
): Promise<VerifyResult> {
  const token = req.headers.get("x-portal-session");
  if (!token) return { ok: false, status: 401, error: "Missing portal session" };

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, status: 401, error: "Malformed portal session" };
  }

  const secret = Deno.env.get("PORTAL_SESSION_SECRET");
  if (!secret) {
    // Fail closed if server misconfigured — do NOT accept any token.
    return { ok: false, status: 500, error: "Portal auth not configured" };
  }

  let key: CryptoKey;
  try {
    key = await importKey(secret);
  } catch {
    return { ok: false, status: 500, error: "Portal auth key error" };
  }

  const signingInput = `${parts[0]}.${parts[1]}`;
  let providedSig: Uint8Array;
  try {
    providedSig = b64urlDecode(parts[2]);
  } catch {
    return { ok: false, status: 401, error: "Invalid signature encoding" };
  }
  const expectedSig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput)),
  );
  if (!timingSafeEqual(providedSig, expectedSig)) {
    return { ok: false, status: 401, error: "Invalid portal session signature" };
  }

  let claims: PortalSessionClaims;
  try {
    const payloadJson = new TextDecoder().decode(b64urlDecode(parts[1]));
    claims = JSON.parse(payloadJson) as PortalSessionClaims;
  } catch {
    return { ok: false, status: 401, error: "Invalid portal session payload" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!claims.exp || claims.exp < now) {
    return { ok: false, status: 401, error: "Portal session expired" };
  }
  if (
    !claims.portal_user_id || !claims.customer_id || !claims.organization_id
  ) {
    return { ok: false, status: 401, error: "Portal session missing claims" };
  }

  // Re-verify the row is still active, so revoked/deactivated portal users
  // can't keep using a still-unexpired token.
  const supabase = supabaseOverride ?? createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const { data, error } = await supabase
    .from("client_portal_users")
    .select("id, customer_id, organization_id, is_active")
    .eq("id", claims.portal_user_id)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: "Session lookup failed" };
  if (!data || !data.is_active) {
    return { ok: false, status: 401, error: "Portal account is inactive" };
  }
  if (
    data.customer_id !== claims.customer_id ||
    data.organization_id !== claims.organization_id
  ) {
    // Row was reassigned/tampered — reject.
    return { ok: false, status: 401, error: "Portal session mismatch" };
  }

  return {
    ok: true,
    portal_user_id: data.id,
    customer_id: data.customer_id,
    organization_id: data.organization_id,
  };
}

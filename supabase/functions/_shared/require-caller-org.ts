// Shared helpers for locking down functions that used to trust a
// client-supplied organizationId with no check that the caller actually
// belongs to that org.
//
// Two building blocks:
//   - isServiceRoleRequest(req): true only when the bearer token IS the
//     project's service-role key. Use to gate server-to-server-only functions.
//   - resolveCallerOrg(req): validates the caller's JWT with auth.getUser()
//     (signature checked by GoTrue) and returns the organizationId derived
//     from THEIR OWN org_memberships (owner-first) or, if they have no
//     org_memberships row, their `staff` record. Never trusts an
//     organizationId/organization_id passed in the request body.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

/**
 * Constant-time string compare. Length is mixed into the accumulator so a
 * mismatch still walks the longer input.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  const len = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < len; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Reject a request that has no caller, before the handler reads the body.
 *
 * A missing or non-user token used to fall through into `req.json()` / field
 * checks and come back as 400 or 500 (`Cannot read properties of null`).
 * Anonymous probes should be 401 instead.
 *
 * Passes two legitimate non-browser callers through so the handler can apply
 * its own rules afterwards:
 *   - the service-role key (cron and other edge functions)
 *   - a user JWT that GoTrue accepts (web app, iOS app, staff portal)
 *
 * Returns a 401 Response, or null when the caller may continue.
 */
export async function rejectUnauthenticated(
  req: Request,
  headers: Record<string, string>,
  payload: Record<string, unknown> = { error: "Unauthorized" },
): Promise<Response | null> {
  if (isServiceRoleRequest(req)) return null;

  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  if (!token) {
    return new Response(JSON.stringify(payload), {
      status: 401,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return new Response(JSON.stringify(payload), {
      status: 401,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
  return null;
}

/**
 * True only for a genuine service-role caller (another edge function or cron
 * presenting SUPABASE_SERVICE_ROLE_KEY).
 *
 * Do NOT base64-decode the JWT and trust `role`. That payload is unsigned
 * from this function's point of view: anyone can mint `{"role":"service_role"}`.
 * auth.getUser() is the right check for a *user* JWT (see resolveCallerOrg)
 * but it rejects the service-role key, which is not a user session. The key
 * itself is the signed credential, so equality against the env value is the
 * signature check.
 */
export function isServiceRoleRequest(req: Request): boolean {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!token || !serviceKey) return false;
  return timingSafeEqualString(token, serviceKey);
}

export interface CallerOrgContext {
  userId: string;
  organizationId: string;
}

/**
 * Resolves the organization the CALLER belongs to, from their own JWT —
 * never blindly from the request body. If `requestedOrgId` is supplied (the
 * app's ACTIVE organization), it is honoured ONLY when the caller actually
 * has a membership/staff record in it — this is what keeps multi-org owners
 * from sending another org's branded email. Otherwise falls back to
 * org_memberships (owner role preferred) and then the `staff` record.
 */
export async function resolveCallerOrg(
  req: Request,
  requestedOrgId?: string | null,
): Promise<{ ok: true; ctx: CallerOrgContext } | { ok: false; status: number; error: string }> {

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const token = authHeader.slice("Bearer ".length).trim();

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return { ok: false, status: 401, error: "Invalid token" };
  }
  const userId = userData.user.id;

  const { data: memberships } = await supabaseAdmin
    .from("org_memberships")
    .select("organization_id, role")
    .eq("user_id", userId);

  if (memberships && memberships.length > 0) {
    if (requestedOrgId) {
      const match = memberships.find(
        (m: { organization_id: string }) => m.organization_id === requestedOrgId,
      );
      if (match) {
        return { ok: true, ctx: { userId, organizationId: requestedOrgId } };
      }
    }
    const owner = memberships.find((m: { role: string }) => m.role === "owner");
    const organizationId = (owner ?? memberships[0]).organization_id as string;
    return { ok: true, ctx: { userId, organizationId } };
  }

  // No admin-dashboard membership — check for a staff-portal record.
  const { data: staffRows } = await supabaseAdmin
    .from("staff")
    .select("organization_id")
    .eq("user_id", userId);

  if (staffRows && staffRows.length > 0) {
    if (requestedOrgId && staffRows.some((s: { organization_id: string }) => s.organization_id === requestedOrgId)) {
      return { ok: true, ctx: { userId, organizationId: requestedOrgId } };
    }
    return { ok: true, ctx: { userId, organizationId: staffRows[0].organization_id as string } };
  }

  return { ok: false, status: 403, error: "No organization membership found for this account" };
}


import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

export interface AuthResult {
  success: boolean;
  error?: string;
  userId?: string;
  organizationId?: string;
  role?: string;
}

/**
 * Verifies that the request has a valid authenticated user
 * and returns their organization membership info.
 * 
 * For admin-only functions, use requireAdmin: true
 */
export async function verifyAdminAuth(
  authHeader: string | null,
  options: { requireAdmin?: boolean; requireOwner?: boolean; requireOrganizationId?: string } = {}
): Promise<AuthResult> {
  if (!authHeader) {
    return { success: false, error: "Missing authorization header" };
  }

  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    return { success: false, error: "Invalid authorization token" };
  }

  // Create a client with the user's token to verify their identity
  const supabaseWithAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  // Verify the user's JWT using getUser() which validates the token
  const { data: userData, error: userError } = await supabaseWithAuth.auth.getUser();
  
  if (userError || !userData.user) {
    console.error("Auth verification failed:", userError);
    return { success: false, error: "Invalid or expired token" };
  }

  const userId = userData.user.id;

  // Use service role client to query org memberships (bypasses RLS)
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Get user's organization membership
  // When a specific org is required, filter by it directly to avoid multi-row errors
  let membershipQuery = supabaseAdmin
    .from("org_memberships")
    .select("organization_id, role")
    .eq("user_id", userId);

  if (options.requireOrganizationId) {
    membershipQuery = membershipQuery.eq("organization_id", options.requireOrganizationId);
  }

  const { data: memberships, error: membershipError } = await membershipQuery;

  if (membershipError) {
    console.error("Failed to fetch org membership:", membershipError);
    return { success: false, error: "Failed to verify organization membership" };
  }

  if (!memberships || memberships.length === 0) {
    if (options.requireOrganizationId) {
      return { success: false, error: "Access denied: organization mismatch" };
    }
    return { success: false, error: "User does not belong to any organization" };
  }

  // Postgres does not order rows without ORDER BY, so memberships[0] was a
  // different org on different calls for anyone in two organizations.
  // Callers that know the active org pass requireOrganizationId and the
  // query above already filtered to that row. Otherwise prefer owner, then
  // admin, then manager, and break remaining ties by organization_id so the
  // choice is stable.
  const roleRank: Record<string, number> = { owner: 0, admin: 1, manager: 2 };
  const membership = [...memberships].sort((a, b) => {
    const byRole = (roleRank[a.role] ?? 9) - (roleRank[b.role] ?? 9);
    if (byRole !== 0) return byRole;
    return String(a.organization_id).localeCompare(String(b.organization_id));
  })[0];

  // Role gate.
  // - Owner: everything
  // - Manager (and legacy "admin"): full admin workspace operations, including
  //   using the org's existing Stripe connection to charge/save cards.
  // - Owner-only actions (billing, connecting/disconnecting Stripe, replacing
  //   Stripe keys) must pass requireOwner: true instead of requireAdmin.
  const adminRoles = new Set(["owner", "admin", "manager"]);
  if (options.requireOwner && membership.role !== "owner") {
    return { success: false, error: "Access denied: owner privileges required" };
  }
  if (options.requireAdmin && !adminRoles.has(membership.role)) {
    return { success: false, error: "Access denied: admin privileges required" };
  }

  return {
    success: true,
    userId,
    organizationId: membership.organization_id,
    role: membership.role,
  };
}

/**
 * Creates an unauthorized response with proper headers
 */
export function createUnauthorizedResponse(error: string, corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ success: false, error }),
    { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
  );
}

/**
 * Creates a forbidden response with proper headers
 */
export function createForbiddenResponse(error: string, corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ success: false, error }),
    { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
  );
}

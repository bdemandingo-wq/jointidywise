import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAdminAuth, createUnauthorizedResponse, createForbiddenResponse } from "../_shared/verify-admin-auth.ts";
import { logAudit, AuditActions } from "../_shared/audit-log.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, newPassword, organizationId } = await req.json();

    // SECURITY: Verify the caller is an admin OF THE ORGANISATION THEY NAMED.
    // Without requireOrganizationId, memberships[0] was picked arbitrarily for
    // anyone in two orgs — the wrong org id (or undefined) then produced a
    // PostgREST error on the staff lookup and surfaced as a blanket 500.
    const authResult = await verifyAdminAuth(req.headers.get("Authorization"), {
      requireAdmin: true,
      ...(organizationId ? { requireOrganizationId: organizationId } : {}),
    });
    if (!authResult.success) {
      console.error("[RESET-STAFF-PASSWORD] Authorization failed:", authResult.error);
      return createUnauthorizedResponse(authResult.error || "Unauthorized", corsHeaders);
    }
    if (!authResult.organizationId) {
      console.error("[RESET-STAFF-PASSWORD] No organization resolved for caller", authResult.userId);
      return createForbiddenResponse("No organization found for this account", corsHeaders);
    }

    if (!userId || !newPassword) {
      console.error('[RESET-STAFF-PASSWORD] Missing required fields:', { userId: !!userId, newPassword: !!newPassword });
      return new Response(
        JSON.stringify({ error: 'Missing userId or newPassword' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (newPassword.length < 8) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 8 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create admin client with service role key
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // SECURITY: Verify the target staff member belongs to the caller's organization.
    // Scope by organization_id as well as user_id — one person can be staff in two
    // organizations, and an unscoped single-row lookup blew up with PGRST116
    // ("multiple rows returned"), which surfaced as a 500 in the admin UI.
    const { data: staffData, error: staffError } = await supabaseAdmin
      .from('staff')
      .select('id, organization_id, name, email')
      .eq('user_id', userId)
      .eq('organization_id', authResult.organizationId)
      .maybeSingle();

    if (staffError) {
      // Log the real PostgREST payload — "Failed to verify staff member" on
      // its own gave no way to tell a bad filter from a transient DB error.
      console.error('[RESET-STAFF-PASSWORD] Error finding staff:', {
        message: staffError.message,
        code: (staffError as any).code,
        details: (staffError as any).details,
        organizationId: authResult.organizationId,
      });
      return new Response(
        JSON.stringify({ error: 'Failed to verify staff member' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!staffData) {
      console.error('[RESET-STAFF-PASSWORD] Staff not found for user_id:', userId);
      return new Response(
        JSON.stringify({ error: 'Staff member not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // SECURITY: Ensure the staff member belongs to the admin's organization
    if (staffData.organization_id !== authResult.organizationId) {
      console.error('[RESET-STAFF-PASSWORD] Organization mismatch:', {
        staffOrg: staffData.organization_id,
        adminOrg: authResult.organizationId
      });
      
      logAudit({
        action: "STAFF_PASSWORD_RESET_BLOCKED",
        organizationId: authResult.organizationId || "unknown",
        userId: authResult.userId || "unknown",
        resourceType: "staff",
        resourceId: staffData.id,
        success: false,
        error: "Attempted to reset password for staff in different organization"
      });

      return createForbiddenResponse("Cannot reset password for staff outside your organization", corsHeaders);
    }

    console.log('[RESET-STAFF-PASSWORD] Resetting password for staff:', staffData.email);

    // Update the user's password using admin API
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword
    });

    if (error) {
      console.error('[RESET-STAFF-PASSWORD] Error resetting password:', error);
      
      logAudit({
        action: "STAFF_PASSWORD_RESET_FAILED",
        organizationId: authResult.organizationId || "unknown",
        userId: authResult.userId || "unknown",
        resourceType: "staff",
        resourceId: staffData.id,
        success: false,
        error: error.message
      });

      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Audit log the successful password reset
    logAudit({
      action: "STAFF_PASSWORD_RESET",
      organizationId: authResult.organizationId || "unknown",
      userId: authResult.userId || "unknown",
      resourceType: "staff",
      resourceId: staffData.id,
      success: true,
      details: { staffEmail: staffData.email, staffName: staffData.name }
    });

    console.log('[RESET-STAFF-PASSWORD] Password reset successful for staff:', staffData.email);

    return new Response(
      JSON.stringify({ success: true, message: 'Password updated successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[RESET-STAFF-PASSWORD] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

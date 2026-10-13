import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { logToSystem } from "../_shared/system-logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Owner login. Not the public support inbox.
const PLATFORM_ADMIN_EMAIL = "support@tidywisecleaning.com";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    const requestId = crypto.randomUUID();
    
    // Verify the user is the platform admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Authentication error: Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userEmail = user.email;
    const userId = user.id;
    
    if (!userEmail || userEmail !== PLATFORM_ADMIN_EMAIL) {
      await logToSystem({
        level: "warn",
        source: "delete-platform-account",
        message: "Unauthorized deletion attempt",
        userId,
        requestId,
      });
      return new Response(JSON.stringify({ error: "Unauthorized: Platform admin access only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request body
    const body = await req.json();
    const { userId: targetUserId, type } = body;

    if (!targetUserId || !type) {
      return new Response(JSON.stringify({ error: "Missing userId or type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[DELETE-ACCOUNT] Deleting ${type}: ${targetUserId}`);

    if (type === 'user') {
      // Delete owned organizations explicitly before deleting the auth user.
      // Relying on the auth.users -> organizations cascade makes GoTrue collapse
      // any deeper FK failure into the unhelpful "Database error deleting user".
      // This path both preserves the intended full-account cascade and surfaces
      // the actual table error if organization cleanup is blocked.
      const { data: ownedOrganizations, error: ownedOrganizationsError } = await supabaseClient
        .from('organizations')
        .select('id')
        .eq('owner_id', targetUserId);

      if (ownedOrganizationsError) {
        throw new Error(`Failed to inspect owned organizations: ${ownedOrganizationsError.message}`);
      }

      for (const organization of ownedOrganizations ?? []) {
        const { error: organizationDeleteError } = await supabaseClient
          .from('organizations')
          .delete()
          .eq('id', organization.id);

        if (organizationDeleteError) {
          throw new Error(
            `Failed to delete owned organization ${organization.id}: ${organizationDeleteError.message}`,
          );
        }
      }

      // Delete user from auth.users (remaining user-owned rows cascade or clear
      // their attribution through their FK deletion rules).
      const { error: deleteError } = await supabaseClient.auth.admin.deleteUser(targetUserId);
      
      if (deleteError) {
        console.error("[DELETE-ACCOUNT] Error deleting user:", deleteError);
        throw new Error(`Failed to delete user: ${deleteError.message}`);
      }

      await logToSystem({
        level: "info",
        source: "delete-platform-account",
        message: `User deleted successfully: ${targetUserId}`,
        userId,
        requestId,
      });

    } else if (type === 'organization') {
      // Delete organization and cascade to related data
      await supabaseClient.from('org_memberships').delete().eq('organization_id', targetUserId);
      
      const { error: deleteError } = await supabaseClient
        .from('organizations')
        .delete()
        .eq('id', targetUserId);
      
      if (deleteError) {
        console.error("[DELETE-ACCOUNT] Error deleting organization:", deleteError);
        throw new Error(`Failed to delete organization: ${deleteError.message}`);
      }

      await logToSystem({
        level: "info",
        source: "delete-platform-account",
        message: `Organization deleted successfully: ${targetUserId}`,
        userId,
        requestId,
      });
    } else {
      return new Response(JSON.stringify({ error: "Invalid type. Must be 'user' or 'organization'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[DELETE-ACCOUNT] Error:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "").trim()
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const { token, platform = "ios", apns_env, organization_id: requestedOrgId } = await req.json() as {
      token: string;
      platform?: string;
      apns_env?: string;
      organization_id?: string;
    };
    if (!token) {
      return new Response(JSON.stringify({ error: "token required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Attach the token to a company this user actually belongs to.
    // maybeSingle() on every membership failed (PGRST116) for an owner of
    // more than one business, the error was ignored, and the token was stored
    // with a null organization_id — send-push-notification then could not
    // find it. Prefer the org the app is signed into, then any
    // owner/admin/manager membership, then a staff row.
    let organizationId: string | null = null;
    if (requestedOrgId) {
      const { data: member } = await supabase
        .from("org_memberships")
        .select("organization_id")
        .eq("user_id", user.id)
        .eq("organization_id", requestedOrgId)
        .maybeSingle();
      if (member?.organization_id) organizationId = member.organization_id;

      if (!organizationId) {
        const { data: staffRows } = await supabase
          .from("staff")
          .select("organization_id")
          .eq("user_id", user.id)
          .eq("organization_id", requestedOrgId)
          .limit(1);
        const staffOrg = staffRows?.[0]?.organization_id;
        if (staffOrg) organizationId = staffOrg;
      }
    }

    if (!organizationId) {
      const { data: memberships } = await supabase
        .from("org_memberships")
        .select("organization_id, role")
        .eq("user_id", user.id);
      const rank = (role: string) =>
        role === "owner" ? 0 : role === "admin" ? 1 : role === "manager" ? 2 : 3;
      const preferred = [...(memberships ?? [])].sort((a, b) => rank(a.role) - rank(b.role))[0];
      if (preferred?.organization_id) organizationId = preferred.organization_id;
    }

    if (!organizationId) {
      const { data: staffRows } = await supabase
        .from("staff")
        .select("organization_id")
        .eq("user_id", user.id)
        .limit(1);
      const staffOrg = staffRows?.[0]?.organization_id;
      if (staffOrg) organizationId = staffOrg;
    }

    // Upsert token (one row per user+token pair). apns_env is only written
    // when the client knows it, so a later server-side correction (the push
    // function retries the other APNs host on BadDeviceToken) is not wiped
    // by a registration that omits the field.
    const row: Record<string, unknown> = {
      user_id: user.id,
      organization_id: organizationId,
      token,
      platform,
      updated_at: new Date().toISOString(),
    };
    if (apns_env === "sandbox" || apns_env === "production") {
      row.apns_env = apns_env;
    }

    let { error } = await supabase
      .from("device_push_tokens")
      .upsert(row, { onConflict: "user_id,token" });

    if (error && row.apns_env && /apns_env|42703/i.test(error.message ?? "")) {
      delete row.apns_env;
      ({ error } = await supabase
        .from("device_push_tokens")
        .upsert(row, { onConflict: "user_id,token" }));
    }

    if (error) throw error;

    console.log("[REGISTER-TOKEN] Saved token for user", user.id);
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[REGISTER-TOKEN] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

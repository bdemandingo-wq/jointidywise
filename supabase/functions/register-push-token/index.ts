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

    const { token, platform = "ios", apns_env } = await req.json() as {
      token: string;
      platform?: string;
      apns_env?: string;
    };
    if (!token) {
      return new Response(JSON.stringify({ error: "token required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Get user's org — try org_memberships first, then fall back to staff table
    // (cleaner accounts have no org_memberships row).
    let organizationId: string | null = null;
    const { data: membership } = await supabase
      .from("org_memberships")
      .select("organization_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (membership?.organization_id) {
      organizationId = membership.organization_id;
    } else {
      const { data: staffRow } = await supabase
        .from("staff")
        .select("organization_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (staffRow?.organization_id) organizationId = staffRow.organization_id;
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

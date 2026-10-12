import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { timingSafeEqualString } from "../_shared/require-caller-org.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json({ error: "Server configuration error" }, 500);
    }

    // Cron secret OR a platform-admin user JWT. The old x-service-key header
    // compared the service-role key with !== (not timing-safe) and put that
    // key on the wire as a caller credential.
    const expectedCron = Deno.env.get("CRON_SECRET") ?? "";
    const providedCron = req.headers.get("x-cron-secret") ?? "";
    const cronOk = !!expectedCron && !!providedCron && timingSafeEqualString(providedCron, expectedCron);

    if (!cronOk) {
      const authHeader = req.headers.get("Authorization") ?? "";
      if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const token = authHeader.slice("Bearer ".length).trim();
      const { data: userData, error: userErr } = await userClient.auth.getUser(token);
      if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
      const { data: isAdmin, error: adminErr } = await userClient.rpc("is_platform_admin");
      if (adminErr || !isAdmin) return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // Find orgs sharing the same stripe_account_id
    const { data: dupAccounts } = await supabase.rpc("stripe_duplicate_accounts");

    // Find orgs with display name containing "tidywise"
    const { data: suspiciousNames } = await supabase
      .from("org_stripe_settings")
      .select("organization_id, stripe_account_id, stripe_display_name, stripe_user_email")
      .ilike("stripe_display_name", "%tidywise%");

    return new Response(
      JSON.stringify({
        duplicate_accounts: dupAccounts || [],
        suspicious_names: suspiciousNames || [],
        checked_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[stripe-isolation-audit] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const fail = (message: string, status = 400) => new Response(JSON.stringify({ ok: false, error: message }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return fail("Password reset is unavailable right now.", 500);

    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!token || password.length < 8) return fail("Enter a password of at least 8 characters.");

    const supabase = createClient(supabaseUrl, serviceKey);
    const tokenHash = await sha256(token);
    const { data: row, error } = await supabase
      .from("client_portal_password_resets")
      .select("id, portal_user_id, expires_at, used_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (error || !row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
      return fail("This reset link is invalid or has expired. Request a new one.");
    }

    const { data: resetOk, error: rpcError } = await supabase.rpc("reset_client_portal_password", {
      p_user_id: row.portal_user_id,
      p_new_password: password,
    });
    if (rpcError || resetOk === false) {
      console.error("[complete-client-portal-reset]", rpcError?.message);
      return fail("Couldn't update the password. Request a new link.", 500);
    }

    await supabase.from("client_portal_users").update({ must_change_password: false }).eq("id", row.portal_user_id);
    await supabase.from("client_portal_password_resets").update({ used_at: new Date().toISOString() }).eq("id", row.id);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[complete-client-portal-reset]", error);
    return fail("Couldn't update the password. Request a new link.", 500);
  }
});

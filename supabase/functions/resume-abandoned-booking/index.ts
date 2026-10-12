import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const empty = new Response(JSON.stringify({ form_snapshot: null }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return empty;

    const body = await req.json().catch(() => ({}));
    const slug = typeof body.slug === "string" ? body.slug : "";
    const token = typeof body.token === "string" ? body.token : "";
    if (!slug || !token) return empty;

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!org?.id) return empty;

    const { data: row } = await supabase
      .from("abandoned_bookings")
      .select("form_snapshot, organization_id")
      .eq("session_token", token)
      .eq("organization_id", org.id)
      .maybeSingle();

    const snap = row?.form_snapshot;
    if (!snap || typeof snap !== "object" || (snap as { v?: unknown }).v !== 1) return empty;

    return new Response(JSON.stringify({ form_snapshot: snap }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[resume-abandoned-booking]", error);
    return empty;
  }
});

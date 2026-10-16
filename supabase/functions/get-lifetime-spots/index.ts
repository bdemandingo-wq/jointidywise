import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { LIFETIME_SPOT_CAP } from "../_shared/lifetime-cap.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { data: offerState, error } = await supabase
      .from("lifetime_offer_state")
      .select("total_spots, sold_spots, sold_out_at")
      .eq("id", 1)
      .maybeSingle();

    if (error) throw error;

    const total = offerState?.total_spots ?? LIFETIME_SPOT_CAP;
    const used = offerState?.sold_spots ?? 0;
    const remaining = Math.max(0, total - used);
    const available = !offerState?.sold_out_at && remaining > 0;

    return new Response(
      JSON.stringify({ total, used, remaining, available }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message, total: LIFETIME_SPOT_CAP, used: 0, remaining: LIFETIME_SPOT_CAP, available: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }
});

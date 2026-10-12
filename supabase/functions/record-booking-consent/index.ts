import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ recorded: false }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const sessionToken = typeof body.session_token === "string" ? body.session_token : "";
    const organizationId = typeof body.organization_id === "string" ? body.organization_id : "";
    if (!sessionToken || !organizationId) {
      return new Response(JSON.stringify({ recorded: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Anon updates are forced to keep sms_consent false. Only the service
    // role, and only when the session token matches this organization, grants it.
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data, error } = await supabase
      .from("abandoned_bookings")
      .update({ sms_consent: true })
      .eq("session_token", sessionToken)
      .eq("organization_id", organizationId)
      .select("id");

    if (error) {
      console.error("[record-booking-consent]", error.message);
      return new Response(JSON.stringify({ recorded: false }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ recorded: (data?.length ?? 0) > 0 }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[record-booking-consent]", error);
    return new Response(JSON.stringify({ recorded: false }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Records who referred a new organization.
//
// The client sends its own org id and the code it carried from /r/CODE.
// This function decides whether that pair is eligible, writes referral_signups,
// and sets organizations.referred_by. Authenticated users can read the ledger
// and nothing else — a client that could insert a referral could grant itself
// a free month.
//
// No config.toml entry on purpose. The gateway then requires a JWT, and the
// handler checks that JWT again and that the caller owns the org.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { claimSaasReferral } from "../_shared/saas-referral-db.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.slice("Bearer ".length).trim();
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const user = userData.user;

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const organizationId = typeof body.organization_id === "string" ? body.organization_id : null;
    if (!organizationId) return json({ error: "organization_id is required" }, 400);

    const { data: membership } = await admin
      .from("org_memberships")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .eq("role", "owner")
      .maybeSingle();
    if (!membership) return json({ error: "Forbidden" }, 403);

    const result = await claimSaasReferral(admin, {
      organizationId,
      userId: user.id,
      email: user.email ?? null,
      code: typeof body.referral_code === "string" ? body.referral_code : null,
    });
    if (result.outcome === "forbidden") return json({ error: "Forbidden" }, 403);
    return json(result);
  } catch (error) {
    console.error("[claim-saas-referral]", error);
    return json({ error: "Could not record referral" }, 500);
  }
});

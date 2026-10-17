// Recache trigger fired when a blog post is published or edited.
// Tells Encited (the pre-render layer in front of jointidywise.com) to re-render
// a single URL so crawlers/AI engines immediately see fresh content.
//
// SECURITY (2026-07-14): previously had zero caller check — anyone could
// trigger cost-bearing calls to the Encited/prerender.io API for arbitrary
// urls (not just this site's own blog posts, since `url` was accepted
// as-is with no domain restriction). Its only real callers are
// BlogAdminEditPage.tsx and BlogAdminListPage.tsx, both gated client-side
// by PlatformAdminRoute (owner/admin of the platform org). This is NOT
// cron-only — confirmed via a src/ call-site trace before locking it down,
// since a service-role-only gate would have broken blog publishing. Now
// mirrors PlatformAdminRoute's exact check (org_memberships role in
// owner/admin on PLATFORM_ORG_ID) and restricts `url`/`slug` to this
// site's own domain.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { pingBlogRecache } from "../_shared/pingBlogRecache.ts";

const SITE_DOMAIN = "https://www.jointidywise.com";
// Matches PLATFORM_ORG_ID in src/components/PlatformAdminRoute.tsx exactly.
const PLATFORM_ORG_ID = "e95b92d0-7099-408e-a773-e4407b34f8b4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RecacheBody { slug?: string; url?: string; }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(
      authHeader.slice("Bearer ".length).trim(),
    );
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: membership } = await supabaseAdmin
      .from("org_memberships")
      .select("role")
      .eq("organization_id", PLATFORM_ORG_ID)
      .eq("user_id", userData.user.id)
      .in("role", ["owner", "admin"])
      .maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = (await req.json().catch(() => ({}))) as RecacheBody;
    const targetUrl = body.url || (body.slug ? `${SITE_DOMAIN}/blog/post/${body.slug}` : null);
    if (!targetUrl) {
      return new Response(JSON.stringify({ ok: false, error: "Missing slug or url" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Restrict to this site's own domain — `url` was previously accepted
    // as-is, letting a caller point the Encited/prerender.io recache call
    // at any arbitrary domain.
    try {
      const parsedTarget = new URL(targetUrl);
      if (parsedTarget.hostname !== "www.jointidywise.com" && parsedTarget.hostname !== "jointidywise.com") {
        return new Response(JSON.stringify({ ok: false, error: "url must be on jointidywise.com" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "Invalid url" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const result = await pingBlogRecache(targetUrl);
    if (result.skipped) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "no recache provider configured", url: targetUrl }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!result.ok) console.error(`[recache-blog-post] ${result.provider} error`, result.status, result.response);
    else console.log(`[recache-blog-post] Recached via ${result.provider}:`, targetUrl);
    return new Response(JSON.stringify({ ok: result.ok, provider: result.provider, status: result.status, url: targetUrl, response: result.response }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[recache-blog-post] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

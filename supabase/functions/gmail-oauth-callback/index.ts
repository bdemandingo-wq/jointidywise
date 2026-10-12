import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptToken, verifyState } from "../_shared/gmail-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");

    if (errorParam) return redirectBack(false, `oauth_error=${encodeURIComponent(errorParam)}`);
    if (!code || !state) return redirectBack(false, "oauth_error=missing_params");

    const payload = await verifyState(state);
    if (!payload?.org_id || !payload?.user_id) return redirectBack(false, "oauth_error=invalid_state");

    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    const redirectUri = Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI")!;

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.refresh_token) {
      console.error("[gmail-oauth-callback] token exchange failed", tokens);
      return redirectBack(false, `oauth_error=${encodeURIComponent(tokens.error || "no_refresh_token")}`);
    }

    // Get connected email
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = await userInfoRes.json();
    if (!userInfo.email) return redirectBack(false, "oauth_error=no_email");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const refreshEnc = await encryptToken(tokens.refresh_token);
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
    const scopes = (tokens.scope as string | undefined)?.split(" ") ?? [];

    const { error: upsertErr } = await supabase
      .from("org_gmail_connections")
      .upsert({
        organization_id: payload.org_id,
        google_email: userInfo.email,
        refresh_token_encrypted: refreshEnc,
        access_token: tokens.access_token,
        access_token_expires_at: expiresAt,
        scopes,
        connected_by_user_id: payload.user_id,
        connected_at: new Date().toISOString(),
        last_refreshed_at: new Date().toISOString(),
        status: "active",
      }, { onConflict: "organization_id" });

    if (upsertErr) {
      console.error("[gmail-oauth-callback] upsert failed", upsertErr);
      return redirectBack(false, "oauth_error=db_error");
    }

    return redirectBack(true);
  } catch (e) {
    console.error("[gmail-oauth-callback]", e);
    return redirectBack(false, "oauth_error=server_error");
  }
});

function redirectBack(success: boolean, extra = "") {
  const base = Deno.env.get("APP_URL") || "https://jointidywise.com";
  const qs = success ? "tab=emails&gmail_connected=true" : `tab=emails&${extra}`;
  return new Response(null, {
    status: 302,
    headers: { Location: `${base}/dashboard/settings?${qs}` },
  });
}

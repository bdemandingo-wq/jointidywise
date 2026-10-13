import { createClient } from "npm:@supabase/supabase-js@2";
import { unsubscribePageUrl, unsubscribeTokenFromParts } from "../_shared/unsubscribe-links.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function readToken(req: Request, queryToken: string): Promise<string> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return queryToken;
  try {
    return unsubscribeTokenFromParts(queryToken, contentType, await req.json());
  } catch {
    // One-click posts application/x-www-form-urlencoded. The token is on the query.
    return queryToken;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const queryToken = (url.searchParams.get("token") ?? "").trim();
  const token = req.method === "POST" ? await readToken(req, queryToken) : queryToken;

  // A browser opening the function URL gets the app page. Supabase serves
  // function HTML as text/plain with a sandbox CSP, so the old page never
  // rendered in Gmail. One-click and the app both POST, and a GET must not
  // opt anyone out (link scanners prefetch GET).
  if (req.method === "GET" || req.method === "HEAD") {
    return Response.redirect(unsubscribePageUrl(token), 302);
  }
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  if (!token) return json({ ok: false, error: "missing_token" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data } = await supabase
    .from("email_unsubscribe_tokens")
    .select("email, organization_id")
    .eq("token", token)
    .maybeSingle();
  const tok = data as { email?: string | null; organization_id?: string | null } | null;

  // Test sends mint a real row. A token that does not match one — a preview
  // link, a row that was removed — still answers success. There is no address
  // to suppress, and a 404 makes Gmail's one-click button report a failure.
  if (!tok?.email) {
    return json({ ok: true, unsubscribed: true, unknownToken: true });
  }

  const email = tok.email.toLowerCase();
  const orgId: string | null = tok.organization_id ?? null;

  // Platform-wide opt-out. This ONLY runs for legacy tokens with no
  // organization_id (TidyWise's own Morning Brief / broadcast / winback
  // mail). An org-scoped token means the person is leaving ONE business's
  // marketing — writing the global suppressed_emails row there would also
  // silence TidyWise platform mail and every other org, which is not what
  // they asked for. If either write fails we do NOT mark the token used_at,
  // so the same link stays valid and re-clicking it is the retry.
  let profileError: unknown = null;
  let suppressError: unknown = null;

  if (!orgId) {
    const { error: pErr } = await supabase
      .from("profiles")
      .update({ email_unsubscribed: true, email_unsubscribed_at: new Date().toISOString() })
      .ilike("email", email);
    profileError = pErr;

    const { error: sErr } = await supabase
      .from("suppressed_emails")
      .upsert({ email, reason: "unsubscribe" }, { onConflict: "email" });
    suppressError = sErr;
  }

  // Org-scoped opt-out. Only runs when the token identifies an org — legacy
  // tokens (organization_id IS NULL) keep exactly today's global-only
  // behaviour. We never opt an address out across orgs: an unsubscribe from
  // one business must not silence the others.
  let orgError: unknown = null;
  let orgName: string | null = null;
  if (orgId) {
    const { error } = await supabase
      .from("customers")
      .update({ marketing_status: "opted_out" })
      .eq("organization_id", orgId)
      .ilike("email", email);
    orgError = error;

    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    orgName = org?.name ?? null;
  }

  if (profileError || suppressError || orgError) {
    console.error("[handle-email-unsubscribe] CRITICAL: opt-out write failed, NOT marking token used:", {
      email, token, profileError, suppressError, orgError,
    });
    return json({ ok: false, error: "opt_out_failed", email }, 500);
  }

  const { error: tokenUpdateError } = await supabase
    .from("email_unsubscribe_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token);
  if (tokenUpdateError) {
    // The actual opt-out already succeeded above — this is just token
    // housekeeping, so log but don't show a failure page for it (worst
    // case the token can be reused, which is a harmless no-op re-upsert).
    console.error("[handle-email-unsubscribe] token used_at update failed (opt-out itself already succeeded):", { token, error: tokenUpdateError });
  }

  return json({
    ok: true,
    unsubscribed: true,
    email,
    orgName,
  });
});

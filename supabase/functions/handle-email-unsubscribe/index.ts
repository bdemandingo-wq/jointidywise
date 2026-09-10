import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function page(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f9fafb;color:#111827;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#fff;padding:32px;border-radius:12px;max-width:480px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}
h1{margin:0 0 12px;font-size:20px}p{color:#6b7280;line-height:1.5}</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response(page("Invalid link", "This unsubscribe link is missing a token."), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "text/html" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: tok } = await supabase
    .from("email_unsubscribe_tokens")
    .select("email, organization_id")
    .eq("token", token)
    .maybeSingle();

  if (!tok?.email) {
    return new Response(page("Invalid link", "We couldn't find this unsubscribe request. It may have already been processed."), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "text/html" },
    });
  }

  const email = tok.email.toLowerCase();
  const orgId: string | null = (tok as any).organization_id ?? null;

  // Both writes below are the actual opt-out — one is safe to be
  // non-authoritative, but neither can be allowed to fail silently.
  // TCPA/CAN-SPAM carry per-message statutory damages, so continuing to
  // email someone whose opt-out write failed is not an acceptable
  // "best effort" outcome. If either write fails, we do NOT mark the
  // token used_at, so the same link remains valid — the user re-clicking
  // it (or clicking "try again" below) is the retry.
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ email_unsubscribed: true, email_unsubscribed_at: new Date().toISOString() })
    .ilike("email", email);

  const { error: suppressError } = await supabase
    .from("suppressed_emails")
    .upsert({ email, reason: "unsubscribe" }, { onConflict: "email" });

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
    return new Response(
      page(
        "Something went wrong",
        `We couldn't process your unsubscribe request for <strong>${email}</strong>. ` +
        `Please <a href="${req.url}">try this link again</a>, or contact support@tidywisecleaning.com if it keeps failing.`,
      ),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "text/html" } }
    );
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

  return new Response(
    page(
      "You're unsubscribed",
      orgName
        ? `<strong>${email}</strong> will no longer receive marketing emails from <strong>${orgName}</strong>. You'll still receive essential account and transactional emails, such as booking confirmations and invoices.`
        : `<strong>${email}</strong> will no longer receive Morning Briefs, End of Day Reports, or marketing emails from TidyWise. You'll still receive essential account and transactional emails.`,
    ),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "text/html" } }
  );
});

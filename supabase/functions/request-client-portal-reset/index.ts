import { sendResendEmail } from "../_shared/send-resend.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PLATFORM_SENDER_FROM } from "../_shared/email-sender-resolution.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GENERIC = {
  ok: true,
  message: "If a client portal account exists for that email, a reset link is on its way. If nothing arrives, ask the business to reset it for you.",
};

async function sha256(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const ok = () => new Response(JSON.stringify(GENERIC), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return ok();

    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) return ok();

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: customers } = await supabase
      .from("customers")
      .select("id")
      .ilike("email", email)
      .limit(10);

    const customerIds = (customers ?? []).map((c) => c.id);
    const byCustomer = customerIds.length
      ? await supabase.from("client_portal_users").select("id, is_active").in("customer_id", customerIds).eq("is_active", true)
      : { data: [] as { id: string }[] };
    const byUsername = await supabase
      .from("client_portal_users")
      .select("id, is_active")
      .ilike("username", email)
      .eq("is_active", true)
      .limit(5);

    const ids = new Set<string>();
    for (const row of byCustomer.data ?? []) ids.add(row.id);
    for (const row of byUsername.data ?? []) ids.add(row.id);
    if (ids.size === 0) return ok();

    const origin = (Deno.env.get("PUBLIC_SITE_URL") || "https://www.jointidywise.com").replace(/\/$/, "");
    const resendKey = Deno.env.get("RESEND_API_KEY");

    for (const portalUserId of ids) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      const tokenHash = await sha256(token);
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const { error: insertError } = await supabase.from("client_portal_password_resets").insert({
        portal_user_id: portalUserId,
        token_hash: tokenHash,
        expires_at: expires,
      });
      if (insertError) {
        console.error("[request-client-portal-reset] insert", insertError.message);
        continue;
      }

      if (!resendKey) {
        console.error("[request-client-portal-reset] RESEND_API_KEY is not set");
        continue;
      }

      const link = `${origin}/portal/reset-password?token=${encodeURIComponent(token)}`;
      const response = await sendResendEmail( {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: PLATFORM_SENDER_FROM,
          to: [email],
          subject: "Reset your client portal password",
          html: `<p>Use this link to choose a new client portal password. It expires in one hour.</p><p><a href="${link}">${link}</a></p><p>If you didn't ask for this, you can ignore this email.</p>`,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        console.error("[request-client-portal-reset] resend", response.status, text);
      }
    }

    return ok();
  } catch (error) {
    console.error("[request-client-portal-reset]", error);
    return ok();
  }
});

import { sendResendEmail } from "../_shared/send-resend.ts";
import { isDemoSendBlocked } from "../_shared/demo-org.ts";
// Broadcast worker. Cron-driven and resumable: it claims a slice of queued
// recipients, sends each through Resend, and writes the outcome back to the
// same row. Safe to invoke concurrently — the claim is per-row.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import { renderBroadcastHtml, renderBroadcastText } from "../_shared/broadcast-render.ts";
import { ensureUnsubscribeToken } from "../_shared/unsubscribe-token.ts";
import { tidywiseSupportFrom } from "../_shared/email-footer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const FROM = tidywiseSupportFrom();
const BATCH = 50;
const SEND_DELAY_MS = 200;   // 5/s — Resend allows 10/s per team
const MAX_ATTEMPTS = 3;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const gate = requireCronSecret(req);
  if (gate) return gate;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), { status: 500, headers: corsHeaders });
  }

  const { data: broadcasts } = await supabase
    .from("broadcasts")
    .select("id, subject, body_text, message_class, signature_text")
    .eq("status", "sending")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });   // rule 3: unique tiebreaker

  if (!broadcasts?.length) {
    return new Response(JSON.stringify({ processed: 0, reason: "nothing sending" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let processed = 0;

  for (const b of broadcasts) {
    const { data: batch } = await supabase
      .from("broadcast_recipients")
      .select("id, email, attempts")
      .eq("broadcast_id", b.id)
      .eq("status", "queued")
      .order("id", { ascending: true })     // rule 3
      .limit(BATCH);

    for (const r of batch ?? []) {
      // Claim. The status filter makes a concurrent worker lose the race.
      const { data: claimed } = await supabase
        .from("broadcast_recipients")
        .update({ status: "sending", attempts: r.attempts + 1, updated_at: new Date().toISOString() })
        .eq("id", r.id)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      // Never interpolate a null token. `?token=${null}` yields the literal
      // "?token=null" — a dead unsubscribe link on a marketing email, which is
      // the one output this feature must never produce. Fail the recipient
      // instead: they stay visible in the detail table with a reason, and
      // retry_failed can pick them up once the cause is fixed.
      let unsubscribeUrl: string | null = null;
      if (b.message_class === "marketing") {
        const token = await ensureUnsubscribeToken(supabase, r.email);
        if (!token) {
          await supabase
            .from("broadcast_recipients")
            .update({
              status: "failed",
              error_message: "could not mint unsubscribe token — not sending a marketing email without one",
              updated_at: new Date().toISOString(),
            })
            .eq("id", r.id);
          continue;
        }
        unsubscribeUrl = `${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${token}`;
      }

      try {
        const res = await sendResendEmail( {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: FROM,
            to: [r.email],
            subject: b.subject,
            html: renderBroadcastHtml({ bodyText: b.body_text, unsubscribeUrl, signature: b.signature_text }),
            text: renderBroadcastText({ bodyText: b.body_text, unsubscribeUrl, signature: b.signature_text }),
          }),
        });

        if (!res.ok) {
          const detail = (await res.text()).slice(0, 500);
          // NOT returned to 'queued'. Resend may have accepted before the
          // response failed; a duplicate broadcast is worse than a missing
          // one. Requeueing is the operator's explicit retry_failed action.
          await supabase
            .from("broadcast_recipients")
            .update({ status: "failed", error_message: `resend ${res.status}: ${detail}`, updated_at: new Date().toISOString() })
            .eq("id", r.id);
        } else {
          const payload = await res.json().catch(() => ({}));
          await supabase
            .from("broadcast_recipients")
            .update({
              status: "sent",
              provider_message_id: payload?.id ?? null,
              sent_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", r.id);
          // Mirror into the unified audit trail. message_id must be unique —
          // email_send_log has a partial unique index on it where status='sent'.
          //
          // Checked but deliberately NON-FATAL, and the asymmetry is the point.
          // The email has already been delivered by this line. Marking the
          // recipient failed because the *audit row* failed would send them a
          // second copy on retry — trading a lost log line for a duplicate
          // email, which is the worse of the two. So: log loudly, leave the
          // recipient 'sent'. Not swallowed (rule 5), just not fatal.
          const { error: logErr } = await supabase.from("email_send_log").insert({
            message_id: `broadcast:${b.id}:${r.id}`,
            template_name: `broadcast:${b.message_class}`,
            recipient_email: r.email,
            status: "sent",
          });
          if (logErr) {
            console.error("[broadcast-dispatch] audit row failed; email WAS sent", {
              broadcast_id: b.id,
              recipient_id: r.id,
              error: logErr.message,
            });
          }
          processed++;
        }
      } catch (err) {
        if (isDemoSendBlocked(err)) {
          await supabase
            .from("broadcast_recipients")
            .update({ status: "queued", updated_at: new Date().toISOString() })
            .eq("id", r.id);
          continue;
        }
        await supabase
          .from("broadcast_recipients")
          .update({
            status: "failed",
            error_message: String(err instanceof Error ? err.message : err).slice(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id);
      }

      await new Promise((r2) => setTimeout(r2, SEND_DELAY_MS));
    }

    // Recount and close out. A broadcast is complete when nothing is left
    // queued or sending; it is 'failed' only if every attempt failed.
    const { count: remaining } = await supabase
      .from("broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", b.id)
      .in("status", ["queued", "sending"]);

    const { count: sent } = await supabase
      .from("broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", b.id).eq("status", "sent");
    const { count: failed } = await supabase
      .from("broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", b.id).eq("status", "failed");

    await supabase
      .from("broadcasts")
      .update({
        sent_count: sent ?? 0,
        failed_count: failed ?? 0,
        status: (remaining ?? 0) > 0 ? "sending" : ((sent ?? 0) > 0 ? "sent" : "failed"),
        completed_at: (remaining ?? 0) > 0 ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", b.id);
  }

  return new Response(JSON.stringify({ processed }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

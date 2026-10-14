import { sendResendEmail } from "../_shared/send-resend.ts";
// Platform broadcast admin API. Four actions behind one entry point, because
// they share auth, validation and rendering.
//
// AUTH: is_platform_admin() through a USER-SCOPED client. PlatformAdminRoute
// is client-side only and is not a security boundary. No config.toml entry —
// default verify_jwt = true applies (CLAUDE.md rule 2).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  validateBroadcastInput,
  renderBroadcastHtml,
  renderBroadcastText,
} from "../_shared/broadcast-render.ts";
import { ensureUnsubscribeToken } from "../_shared/unsubscribe-token.ts";
import { tidywiseSupportFrom } from "../_shared/email-footer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FROM = tidywiseSupportFrom();

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // User-scoped: is_platform_admin() reads auth.uid(), so it must run as the
  // caller. A service-role client would make it return false for everyone.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

  const { data: isAdmin, error: adminErr } = await userClient.rpc("is_platform_admin");
  if (adminErr) {
    console.error("[broadcast-admin] admin check failed", adminErr);
    return json({ error: "Authorization check failed" }, 500);
  }
  if (!isAdmin) {
    console.warn("[SECURITY] non-platform-admin hit broadcast-admin", { userId: userData.user.id });
    return json({ error: "Forbidden" }, 403);
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const action = typeof body.action === "string" ? body.action : "";

  // ── create: validate, insert the draft, materialize every recipient ──
  if (action === "create") {
    const check = validateBroadcastInput({
      subject: body.subject,
      bodyText: body.body_text,
      messageClass: body.message_class,
      signature: body.signature_text,
    });
    if (!check.ok) return json({ error: "Validation failed", errors: check.errors }, 400);

    const subject = (body.subject as string).trim();
    const bodyText = (body.body_text as string).trim();
    const messageClass = body.message_class as string;
    const signatureText =
      typeof body.signature_text === "string" ? body.signature_text.trim() : "";

    const { data: broadcast, error: insErr } = await admin
      .from("broadcasts")
      .insert({
        subject,
        body_text: bodyText,
        message_class: messageClass,
        // Empty string becomes null so "no signature" has one representation.
        signature_text: signatureText || null,
        created_by: userData.user.id,

        status: "draft",
      })
      .select("id")
      .single();
    if (insErr) return json({ error: `create failed: ${insErr.message}` }, 500);

    // Resolve through the user-scoped client: broadcast_audience() gates on
    // is_platform_admin(), which needs auth.uid().
    const { data: audience, error: audErr } = await userClient.rpc("broadcast_audience", {
      p_message_class: messageClass,
    });
    if (audErr) return json({ error: `audience failed: ${audErr.message}` }, 500);

    const rows = (audience ?? []).map((a: Record<string, unknown>) => ({
      broadcast_id: broadcast.id,
      organization_id: a.organization_id,
      user_id: a.user_id,
      email: a.email,
      status: a.eligible ? "queued" : "skipped",
      skip_reason: a.eligible ? null : a.skip_reason,
    }));

    // An empty audience is never legitimate here — there are 96 orgs. It means
    // the resolver was called with the wrong client (service-role sees zero
    // rows, because broadcast_audience gates on auth.uid()) or the join broke.
    // Failing loudly beats returning 200 with a broadcast nobody will receive.
    if (rows.length === 0) {
      await admin.from("broadcasts").delete().eq("id", broadcast.id);
      return json(
        { error: "audience resolved to 0 recipients — refusing to create an empty broadcast" },
        500,
      );
    }

    const { error: recErr } = await admin.from("broadcast_recipients").insert(rows);
    if (recErr) return json({ error: `recipients failed: ${recErr.message}` }, 500);

    const skipped = rows.filter((r) => r.status === "skipped").length;

    // Checked, not fire-and-forget. These counters are what the Task 8 UI reads
    // to answer "did it finish". A silent failure here leaves recipient_count
    // at 0 while 96 recipient rows exist — the UI would report an empty
    // broadcast that is about to send to everyone. CLAUDE.md rule 5.
    const { error: countErr } = await admin
      .from("broadcasts")
      .update({
        recipient_count: rows.length,
        skipped_count: skipped,
        audience_resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", broadcast.id);
    if (countErr) {
      return json(
        { error: `recipients created but counters failed: ${countErr.message}`, broadcast_id: broadcast.id },
        500,
      );
    }

    return json({
      broadcast_id: broadcast.id,
      total: rows.length,
      queued: rows.length - skipped,
      skipped,
    });
  }

  // ── test_send: render exactly as production and send to the admin only ──
  if (action === "test_send") {
    const id = typeof body.broadcast_id === "string" ? body.broadcast_id : "";
    if (!id) return json({ error: "broadcast_id is required" }, 400);

    // Error and not-found are different answers. Collapsing them renders a
    // broken query as "broadcast not found", which sends the operator looking
    // for a missing row instead of a failing database. CLAUDE.md rule 5.
    const { data: b, error: bErr } = await admin
      .from("broadcasts")
      .select("subject, body_text, message_class, signature_text")
      .eq("id", id)
      .maybeSingle();
    if (bErr) return json({ error: `broadcast lookup failed: ${bErr.message}` }, 500);
    if (!b) return json({ error: "broadcast not found" }, 404);

    const to = userData.user.email!;

    // A null token must never be interpolated. `?token=${null}` yields the
    // literal string "?token=null", which is a dead unsubscribe link — a
    // marketing email with no working way out is the one thing this feature
    // must not produce. Fail the send instead, and say why.
    let unsubscribeUrl: string | null = null;
    if (b.message_class === "marketing") {
      const token = await ensureUnsubscribeToken(admin, to);
      if (!token) {
        return json({ error: "could not mint an unsubscribe token — marketing send aborted" }, 500);
      }
      unsubscribeUrl = `${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${token}`;
    }

    const res = await sendResendEmail( {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: `[TEST] ${b.subject}`,
        html: renderBroadcastHtml({ bodyText: b.body_text, unsubscribeUrl, signature: b.signature_text }),
        text: renderBroadcastText({ bodyText: b.body_text, unsubscribeUrl, signature: b.signature_text }),
      }),
    });
    if (!res.ok) return json({ error: `resend ${res.status}: ${await res.text()}` }, 502);

    // Stamped only after Resend accepted it. Stamping before the send
    // would unlock the real "email every owner" button on a test that
    // never actually left.
    const { error: stampErr } = await admin
      .from("broadcasts")
      .update({ last_test_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id);
    if (stampErr) {
      return json({ error: `test sent, but recording it failed: ${stampErr.message}` }, 500);
    }

    return json({ ok: true, sent_to: to });
  }

  // ── start: flip to sending. The dispatcher does the work. ──
  if (action === "start") {
    const id = typeof body.broadcast_id === "string" ? body.broadcast_id : "";
    if (!id) return json({ error: "broadcast_id is required" }, 400);

    // Only a draft WITH A RESOLVED AUDIENCE may start. Guarding in the WHERE
    // rather than with a read means a double-click cannot start the same
    // broadcast twice, and the audience_resolved_at check means a row whose
    // recipient materialization failed can never be sent as an empty blast.
    const { data: updated, error } = await admin
      .from("broadcasts")
      .update({ status: "sending", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft")
      .not("audience_resolved_at", "is", null)
      .select("id")
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!updated) {
      // Distinguish "no such broadcast" from "wrong state", so the operator is
      // not told a typo'd id is in the wrong status.
      // Checked, for exactly the reason test_send's lookup is checked: a
      // failing read must never render as "not found". An earlier revision of
      // this very block discarded the error and so answered 404 for a
      // broadcast that exists — the same defect, reintroduced by the fix that
      // removed it elsewhere. CLAUDE.md rule 5 applies to diagnostic reads too.
      const { data: exists, error: existsErr } = await admin
        .from("broadcasts")
        .select("status, audience_resolved_at")
        .eq("id", id)
        .maybeSingle();
      if (existsErr) return json({ error: `broadcast lookup failed: ${existsErr.message}` }, 500);
      if (!exists) return json({ error: "broadcast not found" }, 404);
      return json(
        {
          error: exists.audience_resolved_at
            ? `broadcast is ${exists.status}, not draft`
            : "broadcast has no resolved audience — re-create it",
        },
        409,
      );
    }

    return json({ ok: true, broadcast_id: id, status: "sending" });
  }

  // ── retry_failed: failed -> queued, and reopen the parent ──
  if (action === "retry_failed") {
    const id = typeof body.broadcast_id === "string" ? body.broadcast_id : "";
    if (!id) return json({ error: "broadcast_id is required" }, 400);

    const { data: reset, error } = await admin
      .from("broadcast_recipients")
      .update({ status: "queued", error_message: null, updated_at: new Date().toISOString() })
      .eq("broadcast_id", id)
      .eq("status", "failed")
      .select("id");
    if (error) return json({ error: error.message }, 500);

    // Checked, and the response depends on it. This is the worst place in the
    // function to swallow an error: the recipients are already back in
    // 'queued', but if the parent stays 'sent' the dispatcher never selects it
    // again — those people are silently never retried, and the caller was told
    // it worked. A confidently-wrong success. CLAUDE.md rule 5.
    const requeued = reset?.length ?? 0;
    if (requeued > 0) {
      const { error: reopenErr } = await admin
        .from("broadcasts")
        .update({ status: "sending", completed_at: null, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (reopenErr) {
        return json(
          {
            error: `requeued ${requeued} recipients but could not reopen the broadcast: ${reopenErr.message}. They will NOT be retried until its status is set back to 'sending'.`,
            requeued,
          },
          500,
        );
      }
    }
    return json({ ok: true, requeued });
  }

  return json({ error: `unknown action: ${action}` }, 400);
});

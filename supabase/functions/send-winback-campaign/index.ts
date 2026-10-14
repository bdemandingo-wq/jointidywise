import { sendResendEmail } from "../_shared/send-resend.ts";
// Churned-owner winback. Platform mail via Resend, on the verified
// jointidywise.com domain. founder@mail is not a verified sender in this
// repo, so the visible from-name is the founder's and the envelope address
// is support@ — the same address Reply-To points at.
//
// Auth: x-internal-secret matching INTERNAL_DISPATCH_SECRET, or a platform
// admin JWT (is_platform_admin). The service-role key is not accepted.
// verify_jwt is false so the cron header is enough at the gateway.
//
// There is no in-app or Tally winback survey. The draft's "8 quick questions
// / 2 minutes" line does not match a real form (the notes say the plan had
// 10 questions, and the product survey was removed). Each email asks the
// reader to reply instead. The visible unsubscribe link is the app page
// (jointidywise.com/unsubscribe). List-Unsubscribe is the function, because
// one-click is a POST the mail client sends itself.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqualString } from "../_shared/require-caller-org.ts";
import { ensureUnsubscribeToken } from "../_shared/unsubscribe-token.ts";
import { tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { buildWinbackEmail, WINBACK_SEGMENTS, type WinbackSegment, winbackPageUnsubscribeUrl } from "../_shared/winback-email.ts";
import { listUnsubscribeHeaders, oneClickUnsubscribeUrl } from "../_shared/unsubscribe-links.ts";

const FROM = "Emmanuel from TidyWise <support@jointidywise.com>";
const REPLY_TO = tidywiseSupportEmail();
const BATCH_LIMIT = 20;
const SEND_GAP_MS = 1500;
const STEP2_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

const SEGMENTS = WINBACK_SEGMENTS;
type Segment = WinbackSegment;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

type Candidate = {
  organization_id: string;
  user_id: string;
  business_name: string;
  first_name: string;
  email: string;
  segment: Segment;
  is_lifetime: boolean;
  signed_up_at: string;
  last_sign_in_at: string | null;
  bookings: number;
  last_booking_at: string | null;
};

type SendRow = {
  email: string;
  step: number;
  status: string;
  sent_at: string | null;
  segment: string;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isSegment(value: string): value is Segment {
  return (SEGMENTS as readonly string[]).includes(value);
}

function segmentRank(segment: string): number {
  const index = SEGMENTS.indexOf(segment as Segment);
  return index === -1 ? 99 : index;
}

function isExcludedEmail(email: string): boolean {
  const value = email.trim().toLowerCase();
  if (!value || !value.includes("@")) return true;
  if (value === "agencyfootprintllc@gmail.com" || value === "vitalnestinc@gmail.com") return true;
  if (value.startsWith("tidywise.qa+")) return true;
  if (value.endsWith("@jointidywise.com") || value.endsWith(".jointidywise.com")) return true;
  if (value.endsWith("@tidywisecleaning.com") || value.endsWith(".tidywisecleaning.com")) return true;
  if (value.includes("test") || value.includes("example")) return true;
  return false;
}

function oneLine(value: string | null | undefined, fallback: string): string {
  const cleaned = String(value ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function byValue(a: Candidate, b: Candidate): number {
  const rank = segmentRank(a.segment) - segmentRank(b.segment);
  if (rank !== 0) return rank;
  return Date.parse(b.signed_up_at) - Date.parse(a.signed_up_at);
}

function reputationProblem(status: number, raw: string): string | null {
  const text = raw.toLowerCase();
  const rate = /rate|threshold|too many|suspend|paused|disabled|blocked|reputation/;
  if (/complaint/.test(text) && rate.test(text)) return "resend_complaint_rate";
  if (/bounce/.test(text) && rate.test(text)) return "resend_bounce_rate";
  if (/reputation/.test(text) || /sending (has been |is )?(suspended|paused|disabled)/.test(text)) {
    return "resend_domain_reputation";
  }
  if (status === 403 && /domain|account/.test(text) && /suspend|disabled|blocked|paused/.test(text)) {
    return "resend_domain_reputation";
  }
  return null;
}

function hasDispatchSecret(req: Request): boolean {
  const expected = Deno.env.get("INTERNAL_DISPATCH_SECRET") ?? "";
  if (!expected) return false;
  const presented = req.headers.get("x-internal-secret") ?? "";
  if (!presented) return false;
  return timingSafeEqualString(presented, expected);
}

async function isPlatformAdmin(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!token) return false;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceKey && timingSafeEqualString(token, serviceKey)) return false;
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!url || !anon || !serviceKey) return false;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return false;

  const scoped = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: isAdmin, error: adminError } = await scoped.rpc("is_platform_admin");
  if (adminError) return false;
  return isAdmin === true;
}

function normalizeCandidate(row: Record<string, unknown>): Candidate | null {
  const email = oneLine(typeof row.email === "string" ? row.email : "", "").toLowerCase();
  const segment = typeof row.segment === "string" ? row.segment : "";
  const userId = typeof row.user_id === "string" ? row.user_id : "";
  const organizationId = typeof row.organization_id === "string" ? row.organization_id : "";
  if (!userId || !organizationId || !isSegment(segment) || isExcludedEmail(email)) return null;
  return {
    organization_id: organizationId,
    user_id: userId,
    business_name: oneLine(typeof row.business_name === "string" ? row.business_name : "", "your business"),
    first_name: oneLine(typeof row.first_name === "string" ? row.first_name : "", "there"),
    email,
    segment,
    is_lifetime: row.is_lifetime === true,
    signed_up_at: typeof row.signed_up_at === "string" ? row.signed_up_at : new Date(0).toISOString(),
    last_sign_in_at: typeof row.last_sign_in_at === "string" ? row.last_sign_in_at : null,
    bookings: Number(row.bookings ?? 0),
    last_booking_at: typeof row.last_booking_at === "string" ? row.last_booking_at : null,
  };
}

async function loadAudience(supabase: SupabaseClient): Promise<{ candidates: Candidate[]; sends: SendRow[]; halt: { reason: string; detail: string | null; halted_at: string } | null }> {
  const { data, error } = await supabase.rpc("winback_recipient_candidates");
  if (error) throw new Error(error.message);

  const candidates = ((data ?? []) as Record<string, unknown>[])
    .map(normalizeCandidate)
    .filter((row): row is Candidate => row !== null)
    .sort(byValue);

  const sends: SendRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error: sendError } = await supabase
      .from("winback_sends")
      .select("email, step, status, sent_at, segment")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (sendError) throw new Error(sendError.message);
    sends.push(...((page ?? []) as SendRow[]));
    if (!page || page.length < 1000) break;
  }

  const { data: haltRow, error: haltError } = await supabase
    .from("winback_campaign_halt")
    .select("reason, detail, halted_at")
    .eq("id", 1)
    .maybeSingle();
  if (haltError) throw new Error(haltError.message);

  return {
    candidates,
    sends,
    halt: haltRow
      ? {
          reason: String(haltRow.reason),
          detail: haltRow.detail == null ? null : String(haltRow.detail),
          halted_at: String(haltRow.halted_at),
        }
      : null,
  };
}

function previewOf(candidates: Candidate[]) {
  const counts: Record<Segment, number> = {
    S5_cancelled_paid: 0,
    S3_went_quiet: 0,
    S4_trial_no_pay: 0,
    S1_no_onboarding: 0,
    S2_no_bookings: 0,
  };
  const recipients: Record<Segment, Array<Record<string, unknown>>> = {
    S5_cancelled_paid: [],
    S3_went_quiet: [],
    S4_trial_no_pay: [],
    S1_no_onboarding: [],
    S2_no_bookings: [],
  };
  for (const candidate of candidates) {
    counts[candidate.segment] += 1;
    if (recipients[candidate.segment].length < 5) {
        recipients[candidate.segment].push({
        email: candidate.email,
        first_name: candidate.first_name,
        business_name: candidate.business_name,
        user_id: candidate.user_id,
        organization_id: candidate.organization_id,
        is_lifetime: candidate.is_lifetime,
        signed_up_at: candidate.signed_up_at,
        last_sign_in_at: candidate.last_sign_in_at,
        bookings: candidate.bookings,
        last_booking_at: candidate.last_booking_at,
      });
    }
  }
  return { counts, recipients, total: candidates.length };
}

function unsentStep1(candidates: Candidate[], sends: SendRow[]): Candidate[] {
  const taken = new Set(sends.filter((row) => row.step === 1).map((row) => row.email.toLowerCase()));
  return candidates.filter((candidate) => !taken.has(candidate.email)).sort(byValue);
}

function readyStep2(candidates: Candidate[], sends: SendRow[]): Candidate[] {
  const byEmail = new Map(candidates.map((candidate) => [candidate.email, candidate]));
  const step2Taken = new Set(sends.filter((row) => row.step === 2).map((row) => row.email.toLowerCase()));
  const cutoff = Date.now() - STEP2_AFTER_MS;
  const ready: Candidate[] = [];
  for (const sent of sends) {
    if (sent.step !== 1 || sent.status !== "sent" || !sent.sent_at) continue;
    const email = sent.email.toLowerCase();
    if (step2Taken.has(email)) continue;
    if (Date.parse(sent.sent_at) > cutoff) continue;
    const candidate = byEmail.get(email);
    if (!candidate || !isSegment(sent.segment)) continue;
    // Still on the candidate list means not unsubscribed, not suppressed
    // (bounce/complaint/unsubscribe), and not active in the last 30 days.
    if (candidate.last_sign_in_at && Date.parse(candidate.last_sign_in_at) > Date.parse(sent.sent_at)) {
      continue;
    }
    if (candidate.last_booking_at && Date.parse(candidate.last_booking_at) > Date.parse(sent.sent_at)) {
      continue;
    }
    ready.push({ ...candidate, segment: sent.segment });
  }
  return ready.sort(byValue);
}

const REPLY_DETECTION =
  "Replies to the support inbox are not stored in the database, so a reply cannot be detected. Step 2 still skips anyone who unsubscribed, whose address is on suppressed_emails (unsubscribe, bounce, or complaint), whose last_sign_in_at or last booking is after the step-1 send, or who has been active in the last 30 days.";

async function haltCampaign(supabase: SupabaseClient, reason: string, detail: string): Promise<void> {
  const { error } = await supabase.from("winback_campaign_halt").upsert(
    {
      id: 1,
      halted_at: new Date().toISOString(),
      reason,
      detail: detail.slice(0, 500),
    },
    { onConflict: "id" },
  );
  if (error) console.error("[send-winback-campaign] halt insert failed", error);
}

async function deliver(
  supabase: SupabaseClient,
  supabaseUrl: string,
  apiKey: string,
  to: string,
  recipient: Candidate,
  step: 1 | 2,
): Promise<{ ok: true; id: string | null } | { ok: false; error: string; haltReason: string | null }> {
  // Test sends mint the same platform token as a real send, so the
  // link maps to a row. A token that does not is still a success page.
  const token = await ensureUnsubscribeToken(supabase, to);
  if (!token) {
    return { ok: false, error: "could not mint unsubscribe token", haltReason: null };
  }
  const pageUrl = winbackPageUnsubscribeUrl(token);
  const oneClickUrl = oneClickUnsubscribeUrl(supabaseUrl, token);
  const message = buildWinbackEmail(recipient, step, pageUrl);
  const response = await sendResendEmail( {
      organizationId: organizationId,
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      reply_to: REPLY_TO,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: listUnsubscribeHeaders(oneClickUrl),
      tags: [
        { name: "campaign", value: "winback" },
        { name: "segment", value: recipient.segment },
        { name: "step", value: String(step) },
      ],
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      error: `resend ${response.status}: ${raw.slice(0, 500)}`,
      haltReason: reputationProblem(response.status, raw),
    };
  }
  let id: string | null = null;
  try {
    const parsed = JSON.parse(raw) as { id?: string };
    id = parsed.id ?? null;
  } catch {
    id = null;
  }
  return { ok: true, id };
}

function sampleRecipient(segment: Segment, lifetime: boolean): Candidate {
  return {
    organization_id: "00000000-0000-0000-0000-000000000000",
    user_id: "00000000-0000-0000-0000-000000000000",
    business_name: "Sample Cleaning Co",
    first_name: "Sam",
    email: "sample@invalid",
    segment,
    is_lifetime: lifetime,
    signed_up_at: new Date(0).toISOString(),
    last_sign_in_at: null,
    bookings: 0,
    last_booking_at: null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase configuration missing" }, 500);

  const allowed = hasDispatchSecret(req) || await isPlatformAdmin(req);
  if (!allowed) return json({ error: "Unauthorized" }, 401);

  let body: { action?: string; to?: string; lifetime?: boolean; step?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected JSON body" }, 400);
  }
  if (!body || typeof body !== "object") return json({ error: "Expected JSON body" }, 400);
  const action = body.action;
  if (action !== "dry_run" && action !== "test" && action !== "batch") {
    return json({ error: "action must be dry_run, test, or batch" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let audience: Awaited<ReturnType<typeof loadAudience>>;
  try {
    audience = await loadAudience(supabase);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }

  if (action === "dry_run") {
    const preview = previewOf(audience.candidates);
    const pending = unsentStep1(audience.candidates, audience.sends);
    const pendingPreview = previewOf(pending);
    return json({
      ok: true,
      action: "dry_run",
      sent: false,
      total: preview.total,
      counts: preview.counts,
      recipients: preview.recipients,
      unsent_step1: pendingPreview.counts,
      step2_ready: readyStep2(audience.candidates, audience.sends).length,
      halted: audience.halt,
      reply_detection: REPLY_DETECTION,
    });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!apiKey) return json({ error: "RESEND_API_KEY not set" }, 500);

  if (action === "test") {
    const to = oneLine(body.to, "").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return json({ error: "test requires to: one email address" }, 400);
    }
    const step: 1 | 2 = body.step === 2 ? 2 : 1;
    const lifetime = body.lifetime === true;
    const sent: Segment[] = [];
    const failed: Array<{ segment: Segment; error: string }> = [];
    for (const segment of SEGMENTS) {
      let result: Awaited<ReturnType<typeof deliver>>;
      try {
        result = await deliver(
          supabase,
          supabaseUrl,
          apiKey,
          to,
          sampleRecipient(segment, lifetime),
          step,
        );
      } catch (error) {
        result = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          haltReason: null,
        };
      }
      if (!result.ok) {
        failed.push({ segment, error: result.error });
        if (result.haltReason) {
          await haltCampaign(supabase, result.haltReason, result.error);
          return json({
            ok: false,
            action: "test",
            to,
            step,
            lifetime,
            sent,
            failed,
            stopped: result.haltReason,
          });
        }
      } else {
        sent.push(segment);
      }
      if (segment !== SEGMENTS[SEGMENTS.length - 1]) {
        await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
      }
    }
    return json({ ok: failed.length === 0, action: "test", to, step, lifetime, sent, failed });
  }

  if (audience.halt) {
    return json({
      ok: false,
      action: "batch",
      sent: 0,
      stopped: audience.halt.reason,
      halted: audience.halt,
      resume: "DELETE FROM public.winback_campaign_halt;",
    });
  }

  const queue: Array<{ recipient: Candidate; step: 1 | 2 }> = [];
  for (const recipient of unsentStep1(audience.candidates, audience.sends)) {
    if (queue.length >= BATCH_LIMIT) break;
    queue.push({ recipient, step: 1 });
  }
  if (queue.length < BATCH_LIMIT) {
    for (const recipient of readyStep2(audience.candidates, audience.sends)) {
      if (queue.length >= BATCH_LIMIT) break;
      queue.push({ recipient, step: 2 });
    }
  }

  const summary = {
    ok: true,
    action: "batch" as const,
    attempted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    stopped: null as string | null,
    by_segment: {} as Record<string, number>,
    reply_detection: REPLY_DETECTION,
  };

  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    const recipient = item.recipient;
    if (isExcludedEmail(recipient.email)) {
      const { error: excludeError } = await supabase.from("winback_sends").insert({
        user_id: recipient.user_id,
        organization_id: recipient.organization_id,
        email: recipient.email,
        segment: recipient.segment,
        step: item.step,
        status: "failed",
        error: "excluded email",
      });
      if (excludeError && excludeError.code !== "23505") {
        return json({ ...summary, ok: false, error: excludeError.message }, 500);
      }
      summary.skipped += 1;
      continue;
    }

    const { data: claimed, error: claimError } = await supabase
      .from("winback_sends")
      .insert({
        user_id: recipient.user_id,
        organization_id: recipient.organization_id,
        email: recipient.email,
        segment: recipient.segment,
        step: item.step,
        status: "sending",
      })
      .select("id")
      .maybeSingle();

    if (claimError) {
      if (claimError.code === "23505") {
        summary.skipped += 1;
        continue;
      }
      return json({ ...summary, ok: false, error: claimError.message }, 500);
    }
    if (!claimed?.id) {
      summary.skipped += 1;
      continue;
    }

    summary.attempted += 1;
    let result: Awaited<ReturnType<typeof deliver>>;
    try {
      result = await deliver(supabase, supabaseUrl, apiKey, recipient.email, recipient, item.step);
    } catch (error) {
      result = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        haltReason: null,
      };
    }
    if (result.ok) {
      const { error: updateError } = await supabase
        .from("winback_sends")
        .update({ status: "sent", resend_id: result.id, sent_at: new Date().toISOString(), error: null })
        .eq("id", claimed.id);
      if (updateError) console.error("[send-winback-campaign] sent update failed", updateError);
      summary.sent += 1;
      summary.by_segment[recipient.segment] = (summary.by_segment[recipient.segment] ?? 0) + 1;
    } else {
      const { error: updateError } = await supabase
        .from("winback_sends")
        .update({ status: "failed", error: result.error.slice(0, 500) })
        .eq("id", claimed.id);
      if (updateError) console.error("[send-winback-campaign] failed update failed", updateError);
      summary.failed += 1;
      summary.ok = false;
      if (result.haltReason) {
        await haltCampaign(supabase, result.haltReason, result.error);
        summary.stopped = result.haltReason;
        return json(summary);
      }
    }

    if (index < queue.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
    }
  }

  return json(summary);
});

import { sendOpenPhoneMessage } from "../_shared/send-openphone.ts";
// process-campaign-queue
//
// PGMQ worker for campaign SMS. Modelled on process-email-queue: same
// read/delete/archive discipline, same retry budget, same visibility-timeout
// handling, same defensive logging.
//
// Takes no request body — the dispatcher invokes it with {}.
//
// Order of operations per invocation matters:
//   expire -> start -> skip paused -> throttle -> re-check opt-out -> send
// Expiring before reading any message means a stale run structurally cannot
// emit a message rather than relying on a check that might be skipped.
//
// CALLER CONTRACT: total_recipients MUST be set in the same INSERT that creates
// the campaign_runs row, never by a follow-up UPDATE. campaign_queue_wake fires
// AFTER INSERT, so this worker can observe the run before recipients are
// enqueued; completion is decided by
//   progress = sent_count + failed_count + skipped_opted_out_count
// against total_recipients, and a placeholder count would complete or
// stall-cancel the run before a single recipient was queued.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { isOptedOut } from '../_shared/marketing-guard.ts'
import { isServiceRoleRequest } from '../_shared/require-caller-org.ts'

const QUEUE = 'campaign_sms'
const DLQ = 'campaign_sms_dlq'
const VISIBILITY_TIMEOUT_SECONDS = 120
const MAX_RETRIES = 5
const PURGE_BATCH = 100
const PURGE_MAX_BATCHES = 50
// Completion race guards. campaign_queue_wake fires AFTER INSERT on
// campaign_runs, so the first tick can land before the caller has enqueued any
// recipients. An empty queue therefore is NOT completion — see the progress
// check below. total_recipients MUST be set in the same INSERT that creates the
// run, never by a follow-up UPDATE.
const EMPTY_RUN_GRACE_MS = 30_000
const STALL_TIMEOUT_MS = 5 * 60_000
const MAX_SKIPS_PER_TICK = 50
// Messages claimed per due run per tick: one send slot plus a small allowance
// for skipping opted-out recipients in the same tick. Deliberately tiny —
// every claim increments read_ct, and over-claiming is what dead-lettered
// healthy recipients for waiting their turn.
const CLAIM_PER_RUN = 4


interface CampaignMessage {
  run_id: string
  campaign_id: string
  organization_id: string
  customer_id: string
  phone: string
  first_name: string
  last_name: string
  message_template: string
}

interface QueueRow {
  msg_id: number
  read_ct: number
  message: CampaignMessage
}

interface CampaignRun {
  id: string
  campaign_id: string
  organization_id: string
  status: string
  throttle_seconds: number
  scheduled_at: string | null
  expires_at: string
  next_send_at: string | null
  created_at: string
  started_at: string | null
  total_recipients: number | null
  sent_count: number
  failed_count: number
  skipped_opted_out_count: number
}

// The generated Database types are not imported here; the untyped client keeps
// PostgREST calls permissive the same way the other queue workers do.
// deno-lint-ignore no-explicit-any
type Supa = any

function normalizePhone(raw: string): string {
  let digits = (raw || '').replace(/\D/g, '')
  if (!digits.startsWith('1') && digits.length === 10) digits = '1' + digits
  return '+' + digits
}

async function deleteMessage(supabase: Supa, msgId: number, runId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_email', { queue_name: QUEUE, message_id: msgId })
  if (error) {
    console.error('[process-campaign-queue] Failed to delete message from queue', {
      run_id: runId,
      msg_id: msgId,
      error: error.message,
    })
  }
}

// Release a claimed-but-unsent message so it is immediately visible again
// instead of sitting out the visibility timeout. Claiming must not gate
// sending — throttle_seconds/next_send_at is the only send gate.
async function releaseMessage(supabase: Supa, msgId: number): Promise<void> {
  const { error } = await supabase.rpc('set_message_vt', {
    queue_name: QUEUE,
    message_id: msgId,
    vt_seconds: 0,
  })
  if (error) {
    console.error('[process-campaign-queue] Failed to release message visibility', {
      msg_id: msgId,
      error: error.message,
    })
  }
}

// Atomic counter bump — never a read-modify-write from a value loaded at the
// start of the tick, since overlapping invocations would lose increments.
async function bumpRunCounter(
  supabase: Supa,
  runId: string,
  counter: 'sent_count' | 'failed_count' | 'skipped_opted_out_count',
  amount: number,
  nextSendAt: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('increment_campaign_run_counter', {
    p_run_id: runId,
    p_counter: counter,
    p_amount: amount,
    p_next_send_at: nextSendAt,
  })
  if (error) {
    console.error('[process-campaign-queue] Failed to increment run counter', {
      run_id: runId,
      counter,
      error: error.message,
    })
  }
}

// ---------------------------------------------------------------------------
// QUIET HOURS
// Marketing SMS must never go out late at night in the CUSTOMER's local time,
// which we approximate with the ORG's timezone from business_settings.
// Default window: no sends between 20:00 and 09:00 local. Per-org overridable.
// A run inside quiet hours is HELD (next_send_at pushed to the next opening),
// never failed — the queued messages stay put and resume in the morning.
// ---------------------------------------------------------------------------
interface QuietHours {
  enabled: boolean
  start: number // hour local time sending stops (inclusive)
  end: number // hour local time sending resumes
  timezone: string
}

const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: true,
  start: 20,
  end: 9,
  timezone: 'America/New_York',
}

const quietHoursCache = new Map<string, QuietHours>()

async function getQuietHours(supabase: Supa, organizationId: string): Promise<QuietHours> {
  const cached = quietHoursCache.get(organizationId)
  if (cached) return cached

  const { data, error } = await supabase
    .from('business_settings')
    .select(
      'timezone, campaign_quiet_hours_enabled, campaign_quiet_hours_start, campaign_quiet_hours_end',
    )
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (error) {
    // Fail CLOSED: if we cannot establish the org's window, use the safe default
    // rather than sending at an unknown local hour.
    console.error('[process-campaign-queue] Failed to load quiet hours, using defaults', {
      organization_id: organizationId,
      error: error.message,
    })
    quietHoursCache.set(organizationId, DEFAULT_QUIET_HOURS)
    return DEFAULT_QUIET_HOURS
  }

  const row = (data ?? {}) as Record<string, unknown>
  const hours: QuietHours = {
    enabled: row.campaign_quiet_hours_enabled !== false,
    start:
      typeof row.campaign_quiet_hours_start === 'number'
        ? row.campaign_quiet_hours_start
        : DEFAULT_QUIET_HOURS.start,
    end:
      typeof row.campaign_quiet_hours_end === 'number'
        ? row.campaign_quiet_hours_end
        : DEFAULT_QUIET_HOURS.end,
    timezone:
      typeof row.timezone === 'string' && row.timezone
        ? row.timezone
        : DEFAULT_QUIET_HOURS.timezone,
  }
  quietHoursCache.set(organizationId, hours)
  return hours
}

// Local wall-clock parts for a timezone, without pulling in a date library.
function localParts(now: Date, timeZone: string): { hour: number; minute: number } {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = fmt.formatToParts(now)
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
    return { hour: hour === 24 ? 0 : hour, minute }
  } catch {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_QUIET_HOURS.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = fmt.formatToParts(now)
    return {
      hour: Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24,
      minute: Number(parts.find((p) => p.type === 'minute')?.value ?? '0'),
    }
  }
}

// Returns null when sending is allowed, otherwise the UTC instant at which the
// quiet window opens back up.
function quietHoursHoldUntil(now: Date, hours: QuietHours): Date | null {
  if (!hours.enabled) return null
  if (hours.start === hours.end) return null // degenerate config = always allowed

  const { hour, minute } = localParts(now, hours.timezone)
  const inQuiet =
    hours.start > hours.end
      ? hour >= hours.start || hour < hours.end // window crosses midnight
      : hour >= hours.start && hour < hours.end

  if (!inQuiet) return null

  // Hours from "now" until the local clock reads hours.end.
  let hoursAhead = (hours.end - hour + 24) % 24
  if (hoursAhead === 0) hoursAhead = 24
  const resume = new Date(now.getTime() + hoursAhead * 3600_000 - minute * 60_000)
  // Never move the cursor backwards.
  return resume.getTime() > now.getTime() ? resume : new Date(now.getTime() + 60_000)
}


async function moveToDlq(
  supabase: Supa,
  msg: QueueRow,
  reason: string,
): Promise<void> {
  // Persist the reason INTO the payload — a DLQ row whose failure cause lives
  // only in an expired log line is not diagnosable.
  const payload = {
    ...(msg.message as unknown as Record<string, unknown>),
    dlq_reason: reason,
    dlq_at: new Date().toISOString(),
    dlq_read_ct: msg.read_ct ?? 0,
    dlq_attempt_count: attemptCount(msg),
  }
  const { error } = await supabase.rpc('move_to_dlq', {
    source_queue: QUEUE,
    dlq_name: DLQ,
    message_id: msg.msg_id,
    payload,
  })
  if (error) {
    console.error('[process-campaign-queue] Failed to move message to DLQ', {
      run_id: msg.message?.run_id,
      msg_id: msg.msg_id,
      reason,
      error: error.message,
    })
  } else {
    console.warn('[process-campaign-queue] Moved message to DLQ', {
      run_id: msg.message?.run_id,
      msg_id: msg.msg_id,
      reason,
    })
  }
}

// Real attempt counter. read_ct is a CLAIM counter — it increments every time
// the message is read, including reads that release it untouched because
// another message won the tick's single send slot. Gating the DLQ on read_ct
// dead-lettered perfectly healthy recipients for waiting their turn.
function attemptCount(msg: QueueRow): number {
  const n = (msg.message as unknown as Record<string, unknown>)?.attempt_count
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

// Increment the attempt counter by re-enqueueing the payload. pgmq has no
// in-place payload update, so a failed send is deleted and re-queued with
// attempt_count + 1. The message goes to the back of the queue, which is the
// correct behaviour: a failing recipient must not block the rest of the run.
async function requeueWithAttempt(supabase: Supa, msg: QueueRow): Promise<boolean> {
  const payload = {
    ...(msg.message as unknown as Record<string, unknown>),
    attempt_count: attemptCount(msg) + 1,
    last_attempt_at: new Date().toISOString(),
  }
  const { error } = await supabase.rpc('enqueue_email', { queue_name: QUEUE, payload })
  if (error) {
    console.error('[process-campaign-queue] Failed to re-enqueue for retry', {
      run_id: msg.message?.run_id,
      msg_id: msg.msg_id,
      error: error.message,
    })
    return false
  }
  await deleteMessage(supabase, msg.msg_id, msg.message?.run_id ?? 'unknown')
  return true
}


// Drain any queued messages that belong to a cancelled/expired run.
// Messages for other runs are read with a 1s visibility timeout so they come
// straight back and are not delayed by the purge.
async function purgeRunMessages(supabase: Supa, runId: string): Promise<number> {
  let purged = 0
  for (let batch = 0; batch < PURGE_MAX_BATCHES; batch++) {
    const { data, error } = await supabase.rpc('read_email_batch', {
      queue_name: QUEUE,
      batch_size: PURGE_BATCH,
      vt: 1,
    })
    if (error) {
      console.error('[process-campaign-queue] Purge read failed', { run_id: runId, error: error.message })
      return purged
    }
    const rows = (data ?? []) as QueueRow[]
    if (rows.length === 0) return purged

    const mine = rows.filter((r) => r?.message?.run_id === runId)
    for (const row of mine) {
      await deleteMessage(supabase, row.msg_id, runId)
      purged++
    }
    if (rows.length < PURGE_BATCH) return purged
    if (mine.length === 0) return purged
  }
  return purged
}

// Record the outbound campaign send into the Messages tab immediately, keyed on
// openphone_message_id. The openphone-webhook inserts the same message later —
// keying on that id makes the webhook update this row instead of duplicating it.
async function upsertOutboundMessage(
  supabase: Supa,
  organizationId: string,
  phone: string,
  customerName: string,
  content: string,
  openphoneMessageId: string | null,
  runId: string,
): Promise<void> {
  if (!openphoneMessageId) return
  try {
    const nowIso = new Date().toISOString()

    let { data: conv } = await supabase
      .from('sms_conversations')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('customer_phone', phone)
      .maybeSingle()

    let conversationId = conv?.id as string | undefined
    if (!conversationId) {
      const { data: newConv, error: convErr } = await supabase
        .from('sms_conversations')
        .insert({
          organization_id: organizationId,
          customer_phone: phone,
          customer_name: customerName || null,
          last_message_at: nowIso,
        })
        .select('id')
        .single()
      if (convErr) {
        console.error('[process-campaign-queue] Failed to create conversation', {
          run_id: runId,
          error: convErr.message,
        })
        return
      }
      conversationId = newConv?.id as string | undefined
    }
    if (!conversationId) return

    const { data: existing } = await supabase
      .from('sms_messages')
      .select('id')
      .eq('openphone_message_id', openphoneMessageId)
      .maybeSingle()

    const row = {
      conversation_id: conversationId,
      organization_id: organizationId,
      direction: 'outbound',
      content,
      status: 'sent',
      delivery_status: 'sent',
      openphone_message_id: openphoneMessageId,
      sent_at: nowIso,
    }

    if (existing?.id) {
      await supabase.from('sms_messages').update(row).eq('id', existing.id)
    } else {
      const { error: insErr } = await supabase.from('sms_messages').insert(row)
      if (insErr) {
        console.error('[process-campaign-queue] Failed to insert sms_messages row', {
          run_id: runId,
          error: insErr.message,
        })
      }
    }

    await supabase
      .from('sms_conversations')
      .update({ last_message_at: nowIso })
      .eq('id', conversationId)
  } catch (err) {
    console.error('[process-campaign-queue] Message mirror failed', {
      run_id: runId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[process-campaign-queue] Missing required environment variables')
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // The cron dispatcher sends the service-role key. Comparing to that key
  // rejects a forged {"role":"service_role"} payload, which a base64 decode
  // would accept.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!isServiceRoleRequest(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase: Supa = createClient(supabaseUrl, supabaseServiceKey)
  const projectUrl =
    Deno.env.get('APP_URL') || Deno.env.get('PROJECT_URL') || 'https://jointidywise.com'

  const summary = { expired: 0, started: 0, sent: 0, failed: 0, skipped_opted_out: 0, completed: 0, stalled: 0, quiet_held: 0 }

  // 1. Load candidate runs
  const { data: runsData, error: runsError } = await supabase
    .from('campaign_runs')
    .select(
      'id, campaign_id, organization_id, status, throttle_seconds, scheduled_at, expires_at, next_send_at, created_at, started_at, total_recipients, sent_count, failed_count, skipped_opted_out_count',
    )
    .in('status', ['pending', 'running', 'paused'])
    .order('created_at', { ascending: true })

  if (runsError) {
    console.error('[process-campaign-queue] Failed to load campaign runs', { error: runsError.message })
    return new Response(JSON.stringify({ error: 'Failed to load campaign runs' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const runs = (runsData ?? []) as unknown as CampaignRun[]

  // PHASE 1 — expire, start, skip paused, decide who is due.
  // Nothing is read off the queue in this phase: expiry must be able to purge a
  // run's messages while they are all still visible.
  const dueRuns: CampaignRun[] = []

  for (const run of runs) {
    // Isolation: one run blowing up must never abort the others.
    try {
      const now = new Date()
      const nowIso = now.toISOString()

      // 2. EXPIRE FIRST — before any send can happen.
      if (run.expires_at && now > new Date(run.expires_at)) {
        const { error: expErr } = await supabase
          .from('campaign_runs')
          .update({ status: 'cancelled', cancel_reason: 'expired', completed_at: nowIso })
          .eq('id', run.id)
        if (expErr) {
          console.error('[process-campaign-queue] Failed to mark run expired', {
            run_id: run.id,
            error: expErr.message,
          })
        }
        const purged = await purgeRunMessages(supabase, run.id)
        console.warn('[process-campaign-queue] Run expired and purged', {
          run_id: run.id,
          purged,
        })
        summary.expired++
        continue
      }

      // 4. SKIP PAUSED — queued messages stay untouched so the run resumes exactly
      // where it stopped.
      if (run.status === 'paused') continue

      let status = run.status
      let nextSendAt = run.next_send_at

      // 3. START pending runs that are due.
      if (status === 'pending') {
        if (run.scheduled_at && new Date(run.scheduled_at) > now) continue
        const { error: startErr } = await supabase
          .from('campaign_runs')
          .update({ status: 'running', started_at: nowIso, next_send_at: nowIso })
          .eq('id', run.id)
        if (startErr) {
          console.error('[process-campaign-queue] Failed to start run', {
            run_id: run.id,
            error: startErr.message,
          })
          continue
        }
        status = 'running'
        nextSendAt = nowIso
        summary.started++
      }

      if (status !== 'running') continue

      // 4b. COMPLETION IS NOT THROTTLED — a run whose progress has reached its
      // recipient total has nothing left to do, so finish it now rather than
      // waiting for the throttle cursor to come due.
      const progressNow =
        (run.sent_count ?? 0) + (run.failed_count ?? 0) + (run.skipped_opted_out_count ?? 0)
      if ((run.total_recipients ?? 0) > 0 && progressNow >= (run.total_recipients ?? 0)) {
        const { error: compErr } = await supabase
          .from('campaign_runs')
          .update({ status: 'completed', completed_at: nowIso })
          .eq('id', run.id)
          .eq('status', 'running')
        if (compErr) {
          console.error('[process-campaign-queue] Failed to complete run early', {
            run_id: run.id,
            error: compErr.message,
          })
        } else {
          summary.completed++
          console.log('[process-campaign-queue] Run completed (progress reached total)', {
            run_id: run.id,
            progress: progressNow,
            total_recipients: run.total_recipients,
          })
        }
        continue
      }

      // 4c. QUIET HOURS — hold, never fail. Messages stay queued; the cursor is
      // pushed to the moment the org's window reopens so the run resumes then.
      const quiet = await getQuietHours(supabase, run.organization_id)
      const holdUntil = quietHoursHoldUntil(now, quiet)
      if (holdUntil) {
        if (!nextSendAt || new Date(nextSendAt) < holdUntil) {
          const { error: holdErr } = await supabase
            .from('campaign_runs')
            .update({ next_send_at: holdUntil.toISOString() })
            .eq('id', run.id)
            .eq('status', 'running')
          if (holdErr) {
            console.error('[process-campaign-queue] Failed to apply quiet-hours hold', {
              run_id: run.id,
              error: holdErr.message,
            })
          }
        }
        console.log('[process-campaign-queue] Run held for quiet hours', {
          run_id: run.id,
          organization_id: run.organization_id,
          timezone: quiet.timezone,
          window: `${quiet.start}:00-${quiet.end}:00`,
          resumes_at: holdUntil.toISOString(),
        })
        summary.quiet_held++
        continue
      }

      // 5. THROTTLE — one message per run per tick, only when due.
      if (nextSendAt && new Date(nextSendAt) > now) continue


      dueRuns.push({ ...run, status: 'running', next_send_at: nextSendAt })

    } catch (err) {
      console.error('[process-campaign-queue] Unhandled error preparing run', {
        run_id: run.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // PHASE 2 — one queue read for the whole tick, grouped by run.
  // Claim ONLY what this tick can actually act on: at most one send per due
  // run, plus a small allowance so opted-out recipients can be skipped past
  // without waiting a whole throttle period. Claiming a large batch and
  // releasing the remainder was the root cause of false dead-lettering: every
  // release still increments read_ct, so a healthy message exhausted its retry
  // budget purely by waiting its turn.
  let rows: QueueRow[] = []
  const claimed = new Set<number>()
  if (dueRuns.length > 0) {
    const batchSize = Math.min(50, Math.max(1, dueRuns.length * CLAIM_PER_RUN))
    const { data: readData, error: readErr } = await supabase.rpc('read_email_batch', {
      queue_name: QUEUE,
      batch_size: batchSize,
      vt: VISIBILITY_TIMEOUT_SECONDS,
    })

    if (readErr) {
      console.error('[process-campaign-queue] Queue read failed', { error: readErr.message })
    } else {
      rows = (readData ?? []) as QueueRow[]
      for (const row of rows) claimed.add(row.msg_id)
    }
  }


  // Purge messages that belong to runs already completed or cancelled. Without
  // this, race-condition orphans are re-read forever (or DLQ'd as false failures).
  const runIdStatuses = new Map<string, string>()
  let runStatusLookupOk = false
  if (rows.length > 0) {
    const uniqueRunIds = [
      ...new Set(rows.map((r) => r.message?.run_id).filter((id): id is string => typeof id === 'string' && id.length > 0)),
    ]
    const { data: runStatusData, error: runStatusErr } = await supabase
      .from('campaign_runs')
      .select('id, status')
      .in('id', uniqueRunIds)
    if (runStatusErr) {
      console.error('[process-campaign-queue] Failed to look up run statuses for orphan purge', {
        error: runStatusErr.message,
      })
    } else {
      for (const runRow of (runStatusData ?? []) as { id: string; status: string }[]) {
        runIdStatuses.set(runRow.id, runRow.status)
      }
      runStatusLookupOk = true
    }
  }

  const remainingRows: QueueRow[] = []
  let purgedOrphans = 0
  const orphanRunIds = new Set<string>()
  for (const row of rows) {
    const runId = row.message?.run_id
    if (runStatusLookupOk) {
      const status = runId ? runIdStatuses.get(runId) : undefined
      if (status === 'completed' || status === 'cancelled' || status === undefined) {
        await deleteMessage(supabase, row.msg_id, runId || 'unknown')
        claimed.delete(row.msg_id)

        purgedOrphans++
        orphanRunIds.add(runId || 'unknown')
        continue
      }
    }
    remainingRows.push(row)
  }
  rows = remainingRows
  if (purgedOrphans > 0) {
    console.warn('[process-campaign-queue] Purged orphan messages for completed/cancelled runs', {
      run_ids: [...orphanRunIds],
      purged: purgedOrphans,
    })
  }

  try {
  for (const run of dueRuns) {

    try {
      const nowIso = new Date().toISOString()
      const mine = rows.filter((r) => r?.message?.run_id === run.id)


      // Progress is the only completion signal. An empty queue read means
      // nothing on its own: campaign_queue_wake arms the dispatcher on the
      // AFTER INSERT of campaign_runs, so the first tick reliably runs before
      // the caller has finished enqueueing recipients.
      const progress =
        (run.sent_count ?? 0) + (run.failed_count ?? 0) + (run.skipped_opted_out_count ?? 0)
      const totalRecipients = run.total_recipients ?? 0

      if (mine.length === 0) {
        // Only conclude "no messages remain" when the read was not saturated.
        // A full batch may simply have been filled by other runs' messages.
        if (rows.length >= 50) {
          console.log('[process-campaign-queue] Read saturated, deferring run', { run_id: run.id })
          continue
        }

        if (progress >= totalRecipients) {
          // Guard the degenerate case: a run inserted with total_recipients = 0
          // that is only seconds old may still be having its count written by a
          // caller that (incorrectly) updates after insert. Give it a grace
          // window rather than completing it instantly.
          const ageMs = Date.now() - new Date(run.created_at).getTime()
          if (totalRecipients === 0 && ageMs < EMPTY_RUN_GRACE_MS) {
            console.log('[process-campaign-queue] Empty run within grace window, deferring', {
              run_id: run.id,
              age_ms: ageMs,
            })
            continue
          }

          const { error: compErr } = await supabase
            .from('campaign_runs')
            .update({ status: 'completed', completed_at: nowIso })
            .eq('id', run.id)
          if (compErr) {
            console.error('[process-campaign-queue] Failed to complete run', {
              run_id: run.id,
              error: compErr.message,
            })
          } else {
            summary.completed++
            console.log('[process-campaign-queue] Run completed', {
              run_id: run.id,
              progress,
              total_recipients: totalRecipients,
            })
          }
          continue
        }

        // progress < total_recipients: the recipients have not landed yet.
        // Stall timeout — the enqueue never finished.
        const startedAtMs = run.started_at ? new Date(run.started_at).getTime() : null
        if (startedAtMs !== null && Date.now() - startedAtMs > STALL_TIMEOUT_MS) {
          const { error: stallErr } = await supabase
            .from('campaign_runs')
            .update({
              status: 'cancelled',
              cancel_reason: 'enqueue_stalled',
              completed_at: nowIso,
            })
            .eq('id', run.id)
          if (stallErr) {
            console.error('[process-campaign-queue] Failed to mark run stalled', {
              run_id: run.id,
              error: stallErr.message,
            })
          }
          const purged = await purgeRunMessages(supabase, run.id)
          console.warn('[process-campaign-queue] Run cancelled: enqueue stalled', {
            run_id: run.id,
            progress,
            total_recipients: totalRecipients,
            purged,
          })
          summary.stalled++
          continue
        }

        // Not finished, not stalled — leave it running and do NOT advance
        // next_send_at. A later tick picks it up once the messages land.
        console.log('[process-campaign-queue] Awaiting enqueue, run left running', {
          run_id: run.id,
          progress,
          total_recipients: totalRecipients,
        })
        continue
      }

      // 6. RE-CHECK OPT-OUT AT SEND TIME. A five-hour campaign must honour a STOP
      // sent at minute 20 for a message queued at minute 0. Fails closed.
      // Skipping an opted-out recipient is not a send, so it must not consume
      // throttle time: drop it and move to the next candidate in this same tick.
      let chosen: QueueRow | null = null
      let skippedThisTick = 0
      for (const candidate of mine) {
        if (skippedThisTick >= MAX_SKIPS_PER_TICK) break
        const optedOut = await isOptedOut(
          supabase,
          run.organization_id,
          candidate.message?.customer_id,
        )
        if (!optedOut) {
          chosen = candidate
          break
        }
        await deleteMessage(supabase, candidate.msg_id, run.id)
        claimed.delete(candidate.msg_id)
        skippedThisTick++
        summary.skipped_opted_out++
        console.log('[process-campaign-queue] Skipped opted-out recipient', {
          run_id: run.id,
          customer_id: candidate.message?.customer_id,
        })
      }

      if (skippedThisTick > 0) {
        // Counter only — next_send_at deliberately untouched.
        await bumpRunCounter(supabase, run.id, 'skipped_opted_out_count', skippedThisTick, null)
      }

      if (!chosen) continue

      const msg = chosen
      const payload = msg.message

      // Retry budget: gated on REAL attempts (payload.attempt_count), never on
      // read_ct. A dead-lettered message here is a genuine repeated send
      // failure, so it counts as a failure on the run — otherwise progress can
      // never reach total_recipients and the run cannot complete.
      if (attemptCount(msg) >= MAX_RETRIES) {
        await moveToDlq(supabase, msg, `Max attempts (${MAX_RETRIES}) exceeded`)
        claimed.delete(msg.msg_id)
        await bumpRunCounter(
          supabase,
          run.id,
          'failed_count',
          1,
          new Date(Date.now() + run.throttle_seconds * 1000).toISOString(),
        )
        summary.failed++
        continue
      }



      // 7. SEND — same credentials, tokens, tracked link and phone normalisation
      // as run-inactive-campaign.
      const { data: smsSettings, error: smsErr } = await supabase
        .from('organization_sms_settings')
        .select('openphone_api_key, openphone_phone_number_id, sms_enabled')
        .eq('organization_id', run.organization_id)
        .maybeSingle()

      if (smsErr || !smsSettings?.openphone_api_key || !smsSettings?.openphone_phone_number_id) {
        console.error('[process-campaign-queue] SMS not configured — pausing run', {
          run_id: run.id,
          error: smsErr?.message ?? 'missing credentials',
        })
        await supabase
          .from('campaign_runs')
          .update({ status: 'paused', paused_at: nowIso })
          .eq('id', run.id)
        continue
      }
      if (!smsSettings.sms_enabled) {
        console.error('[process-campaign-queue] SMS disabled for org — pausing run', { run_id: run.id })
        await supabase
          .from('campaign_runs')
          .update({ status: 'paused', paused_at: nowIso })
          .eq('id', run.id)
        continue
      }

      const { data: businessSettings } = await supabase
        .from('business_settings')
        .select('company_name')
        .eq('organization_id', run.organization_id)
        .maybeSingle()
      const companyName = businessSettings?.company_name || 'Your Cleaning Service'

      const { data: orgData } = await supabase
        .from('organizations')
        .select('slug')
        .eq('id', run.organization_id)
        .maybeSingle()
      const orgSlug = orgData?.slug || run.organization_id

      const trackingRef = crypto.randomUUID().replace(/-/g, '').substring(0, 12)
      const trackedBookingLink = `${projectUrl}/book/${orgSlug}?ref=${trackingRef}`

      const template = payload.message_template || ''
      const personalizedMessage = template
        .replace(/{first_name}/g, payload.first_name || '')
        .replace(/{last_name}/g, payload.last_name || '')
        .replace(/{company_name}/g, companyName)
        .replace(/{booking_link}/g, trackedBookingLink)

      const toPhone = normalizePhone(payload.phone)

      let sendOk = false
      let openphoneMessageId: string | null = null
      let sendError = ''

      try {
        const response = await sendOpenPhoneMessage( { organizationId: run.organization_id,
          method: 'POST',
          headers: {
            Authorization: smsSettings.openphone_api_key as string,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: smsSettings.openphone_phone_number_id,
            to: [toPhone],
            content: personalizedMessage,
          }),
        })

        if (response.ok) {
          sendOk = true
          const result = await response.json().catch(() => null)
          openphoneMessageId = result?.data?.id ?? null
        } else {
          sendError = `OpenPhone ${response.status}: ${await response.text()}`
        }
      } catch (err) {
        sendError = err instanceof Error ? err.message : String(err)
      }

      if (sendOk) {
        // 8. ON SUCCESS — the SMS is already out, so the message must never be
        // left in the queue to retry (that would text the customer twice).
        // Order: send → write the dedupe/compliance row (3 inline attempts) →
        // delete from the queue. If the row cannot be written, delete anyway
        // but push a replayable DLQ record so nothing is silently lost.
        const sendRow = {
          campaign_id: payload.campaign_id || null,
          customer_id: payload.customer_id,
          organization_id: run.organization_id,
          phone_number: toPhone,
          message_content: personalizedMessage,
          status: 'sent',
          campaign_type: 'queued_campaign',
        }

        let sendLogged = false
        let lastSendLogError = ''
        for (let attempt = 1; attempt <= 3; attempt++) {
          const { error: sendLogErr } = await supabase.from('campaign_sms_sends').insert(sendRow)
          if (!sendLogErr) {
            sendLogged = true
            break
          }
          lastSendLogError = sendLogErr.message
          console.error('[process-campaign-queue] campaign_sms_sends insert failed', {
            run_id: run.id,
            customer_id: payload.customer_id,
            attempt,
            error: sendLogErr.message,
          })
          if (attempt < 3) await new Promise((r) => setTimeout(r, 250 * attempt))
        }

        await deleteMessage(supabase, msg.msg_id, run.id)
        claimed.delete(msg.msg_id)

        if (!sendLogged) {
          console.error('[process-campaign-queue] CRITICAL: dedupe row lost', {
            run_id: run.id,
            customer_id: payload.customer_id,
            openphone_message_id: openphoneMessageId,
            error: lastSendLogError,
          })
          const { error: dlqErr } = await supabase.rpc('send_to_dlq', {
            dlq_name: DLQ,
            payload: {
              ...(payload as unknown as Record<string, unknown>),
              reason: 'dedupe_insert_failed',
              openphone_message_id: openphoneMessageId,
              campaign_sms_send: sendRow,
              error: lastSendLogError,
              failed_at: new Date().toISOString(),
            },
          })
          if (dlqErr) {
            console.error('[process-campaign-queue] Failed to record dedupe loss in DLQ', {
              run_id: run.id,
              customer_id: payload.customer_id,
              error: dlqErr.message,
            })
          }
        }

        if (template.includes('{booking_link}')) {
          const { error: trackErr } = await supabase.from('booking_link_tracking').insert({
            organization_id: run.organization_id,
            customer_id: payload.customer_id,
            tracking_ref: trackingRef,
            customer_name: `${payload.first_name ?? ''} ${payload.last_name ?? ''}`.trim(),
            customer_phone: payload.phone,
            customer_email: null,
            campaign_id: payload.campaign_id || null,
            link_sent_at: nowIso,
            status: 'sent',
            link_type: 'booking',
          })
          if (trackErr) {
            console.log('[process-campaign-queue] Link tracking insert skipped:', trackErr.message)
          }
        }

        await upsertOutboundMessage(
          supabase,
          run.organization_id,
          toPhone,
          `${payload.first_name ?? ''} ${payload.last_name ?? ''}`.trim(),
          personalizedMessage,
          openphoneMessageId,
          run.id,
        )

        await bumpRunCounter(
          supabase,
          run.id,
          'sent_count',
          1,
          new Date(Date.now() + run.throttle_seconds * 1000).toISOString(),
        )

        summary.sent++
        console.log('[process-campaign-queue] Sent campaign SMS', {
          run_id: run.id,
          customer_id: payload.customer_id,
          msg_id: msg.msg_id,
        })
      } else {
        // 9. ON FAILURE — record a REAL attempt by re-enqueueing with
        // attempt_count + 1 (pgmq cannot update a payload in place). Only the
        // terminal attempt increments failed_count, so one recipient counts
        // once towards progress no matter how many times it was retried.
        const attempts = attemptCount(msg) + 1
        console.error('[process-campaign-queue] Send failed', {
          run_id: run.id,
          msg_id: msg.msg_id,
          attempt_count: attempts,
          read_ct: msg.read_ct,
          customer_id: payload.customer_id,
          error: sendError,
        })

        const nextSendAt = new Date(Date.now() + run.throttle_seconds * 1000).toISOString()

        if (attempts >= MAX_RETRIES) {
          await moveToDlq(supabase, msg, `Max attempts (${MAX_RETRIES}) exceeded: ${sendError}`)
          claimed.delete(msg.msg_id)
          await bumpRunCounter(supabase, run.id, 'failed_count', 1, nextSendAt)
          summary.failed++
        } else {
          const requeued = await requeueWithAttempt(supabase, msg)
          if (requeued) claimed.delete(msg.msg_id)
          // A consumed send slot still costs throttle time.
          await supabase
            .from('campaign_runs')
            .update({ next_send_at: nextSendAt })
            .eq('id', run.id)
          summary.failed++
        }
      }

    } catch (err) {
      console.error('[process-campaign-queue] Unhandled error processing run', {
        run_id: run.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  } finally {
    // Release every message claimed but not sent/deleted this tick so it is
    // immediately visible again — claiming must never gate the throttle.
    for (const msgId of claimed) {
      await releaseMessage(supabase, msgId)
    }
  }


  return new Response(JSON.stringify({ runs: runs.length, ...summary }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

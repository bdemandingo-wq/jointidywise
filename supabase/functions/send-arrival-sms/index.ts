import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAudit, AuditActions } from "../_shared/audit-log.ts";
import { sendOpenPhoneMessage } from '../_shared/send-sms.ts';
import { formatFullAddress } from "../_shared/format-address.ts";
import { assertAssignedStaffEvent } from "../_shared/verify-staff-event.ts";
import { notifyOwner } from "../_shared/owner-alert.ts";
import { jobEventCopy, shouldSendArrival } from "../_shared/job-event-copy.ts";
import { arrivalOpenPhoneClaim, nextArrivalClaimAction, nextMarkSentStep, releaseArrivalClaimAfterError, type ArrivalClaimInsert, type ArrivalClaimRow } from "../_shared/arrival-claim.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ArrivalRequest {
  bookingId: string;
  staffId: string;
}

const createArrivalClient = (url: string, key: string) => createClient(url, key);
type ArrivalDb = ReturnType<typeof createArrivalClient>;

/** Claim the reminder row before any text. 23505 means another caller owns it. */
async function claimArrivalSend(
  supabase: ArrivalDb,
  bookingId: string,
  organizationId: string,
  staffId: string,
  recipientPhone: string,
): Promise<'send' | 'duplicate' | 'in_progress' | 'refuse'> {
  const reminderType = `arrived:${staffId}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.from('booking_reminder_log').insert({
      booking_id: bookingId,
      organization_id: organizationId,
      recipient_phone: recipientPhone,
      reminder_type: reminderType,
      status: 'pending',
    });
    const insertError: ArrivalClaimInsert = !error ? 'none' : error.code === '23505' ? 'conflict' : 'failed';
    if (insertError === 'none') return 'send';
    if (insertError === 'failed') {
      console.error(`[send-arrival-sms] claim insert failed for booking ${bookingId}:`, error);
      return 'refuse';
    }

    const { data: existingRows, error: readErr } = await supabase
      .from('booking_reminder_log')
      .select('id, status, created_at')
      .eq('booking_id', bookingId)
      .eq('reminder_type', reminderType)
      .limit(1);
    if (readErr || !existingRows?.length) {
      console.error(`[send-arrival-sms] claim read failed for booking ${bookingId}:`, readErr);
      return 'refuse';
    }
    const existing = existingRows[0] as { id: string; status: string | null; created_at: string };
    const row: ArrivalClaimRow = existing.status === 'pending' || existing.status === 'sent'
      ? existing.status
      : existing.status
        ? 'other'
        : 'none';
    const created = Date.parse(existing.created_at);
    const action = nextArrivalClaimAction({
      insertError: 'conflict',
      row,
      pendingAgeMs: Number.isFinite(created) ? Date.now() - created : null,
    });
    if (action === 'takeover') {
      const { error: delErr } = await supabase
        .from('booking_reminder_log')
        .delete()
        .eq('id', existing.id)
        .eq('status', 'pending');
      if (delErr) {
        console.error(`[send-arrival-sms] stale claim delete failed for booking ${bookingId}:`, delErr);
        return 'refuse';
      }
      continue;
    }
    if (action === 'duplicate' || action === 'in_progress' || action === 'refuse') return action;
  }
  return 'in_progress';
}

async function markArrivalClaimSent(supabase: ArrivalDb, bookingId: string, staffId: string): Promise<boolean> {
  let attempt = 0;
  let updateFailed = true;
  while (updateFailed) {
    const { data, error } = await supabase
      .from('booking_reminder_log')
      .update({ status: 'sent' })
      .eq('booking_id', bookingId)
      .eq('reminder_type', `arrived:${staffId}`)
      .eq('status', 'pending')
      .select('id');
    updateFailed = !!error || !data?.length;
    const step = nextMarkSentStep(attempt, updateFailed);
    if (step === 'done') return true;
    console.error(`[send-arrival-sms] claim mark-sent failed for booking ${bookingId} (attempt ${attempt + 1}):`, error ?? 'no pending row');
    if (step === 'give_up') {
      const forced = await supabase
        .from('booking_reminder_log')
        .update({ status: 'sent' })
        .eq('booking_id', bookingId)
        .eq('reminder_type', `arrived:${staffId}`)
        .select('id');
      if (!forced.error && forced.data?.length) return true;
      return false;
    }
    attempt += 1;
  }
  return false;
}

async function releaseArrivalClaim(supabase: ArrivalDb, bookingId: string, staffId: string): Promise<void> {
  const { error } = await supabase
    .from('booking_reminder_log')
    .delete()
    .eq('booking_id', bookingId)
    .eq('reminder_type', `arrived:${staffId}`)
    .eq('status', 'pending');
  if (error) console.error(`[send-arrival-sms] claim release failed for booking ${bookingId}:`, error);
}

/** OpenPhone must fail inside the 90s claim window so a hung request cannot be taken over mid-send. */
const OPENPHONE_TIMEOUT_MS = 20_000;

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  let releaseClaim: (() => Promise<void>) | null = null;
  let textDelivered = false;
  let supabaseForError: ArrivalDb | null = null;
  let bookingId = '';
  let staffId = '';
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createArrivalClient(supabaseUrl, supabaseServiceKey);
    supabaseForError = supabase;

    const body = (await req.json()) as ArrivalRequest;
    bookingId = body.bookingId;
    staffId = body.staffId;
    if (!bookingId || !staffId) {
      return new Response(JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: booking } = await supabase
      .from('bookings')
      .select('id, booking_number, organization_id, status, address, apt_suite, city, state, zip_code, customer:customers(first_name, last_name, phone)')
      .eq('id', bookingId)
      .single();
    if (!booking?.organization_id) {
      return new Response(JSON.stringify({ success: false, error: "Booking not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const customerData = booking.customer as unknown;
    const customer = (Array.isArray(customerData) ? customerData[0] : customerData) as
      { first_name: string; last_name: string; phone: string | null } | null;

    const { data: staff } = await supabase.from('staff').select('name').eq('id', staffId).single();
    if (!staff) {
      return new Response(JSON.stringify({ success: false, error: "Staff not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Auth and tenant check. The caller must be the assigned cleaner, an
    // owner/admin/manager of this org, or the service-role key (timing-safe
    // compare). A membership-only check is not used: cleaners often have no
    // org_memberships row, and that check would reject the person at the job.
    const auth = await assertAssignedStaffEvent(
      req,
      supabase as unknown as Parameters<typeof assertAssignedStaffEvent>[1],
      booking.organization_id,
      staffId,
      bookingId,
    );
    if (!auth.ok) {
      return new Response(JSON.stringify({ success: false, error: auth.error }),
        { status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!shouldSendArrival((booking as { status?: string | null }).status)) {
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        message: "This job is already finished, so no arrival notice was sent.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Claim the log row before any text, after auth so a stranger cannot probe it.
    // Two callers cannot both win the insert once (booking_id, reminder_type) is unique.
    const claim = await claimArrivalSend(
      supabase,
      bookingId,
      booking.organization_id,
      staffId,
      customer?.phone ?? '',
    );
    if (claim === 'duplicate') {
      return new Response(JSON.stringify({
        success: true,
        deduplicated: true,
        message: "Arrival already recorded.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (claim === 'in_progress') {
      return new Response(JSON.stringify({
        success: false,
        error: "Arrival send already in progress",
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (claim === 'refuse') {
      return new Response(JSON.stringify({ success: false, error: "Could not verify send status, please retry" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    releaseClaim = () => releaseArrivalClaim(supabase, bookingId, staffId);

    const customerName = `${customer?.first_name ?? ''} ${customer?.last_name ?? ''}`.trim() || 'the customer';
    const { data: businessSettings } = await supabase
      .from('business_settings')
      .select('company_name')
      .eq('organization_id', booking.organization_id)
      .maybeSingle();
    const companyName = businessSettings?.company_name || 'Your cleaning service';
    const copy = jobEventCopy('arrived', {
      staffName: staff.name,
      bookingNumber: booking.booking_number,
      customerLabel: customerName,
      companyName,
      address: formatFullAddress(booking as any) || 'N/A',
      amountSuffix: '',
    });

    const { data: smsSettings } = await supabase
      .from('organization_sms_settings')
      .select('openphone_api_key, openphone_phone_number_id, sms_enabled, notify_client_arrived')
      .eq('organization_id', booking.organization_id)
      .maybeSingle();

    let smsSkippedReason: string | null = null;
    if (!smsSettings?.sms_enabled || !smsSettings.openphone_api_key || !smsSettings.openphone_phone_number_id) {
      smsSkippedReason = "SMS not configured";
    }

    let clientSent = false;
    const openPhoneSends: boolean[] = [];

    if (!smsSkippedReason && smsSettings) {
    const notifyClient = (smsSettings as any).notify_client_arrived !== false;

    const formatPhoneNumber = (phone: string): string => {
      let f = phone.replace(/\D/g, '');
      if (f.length === 10) f = `+1${f}`;
      else if (!f.startsWith('+')) f = `+${f}`;
      return f;
    };

    let phoneNumberId = smsSettings.openphone_phone_number_id;
    if (phoneNumberId.includes('openphone.com')) {
      const m = phoneNumberId.match(/phone-numbers\/([A-Za-z0-9]+)/);
      if (m) phoneNumberId = m[1];
    }
    const authHeader = smsSettings.openphone_api_key.trim().replace(/^Bearer\s+/i, '');

    const sendSms = async (to: string, content: string, label: string) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), OPENPHONE_TIMEOUT_MS);
      try {
        const sent = await sendOpenPhoneMessage({
          supabase,
          organizationId: booking.organization_id,
          to,
          content,
          from: phoneNumberId,
          apiKey: authHeader,
          tag: `send-arrival-sms:${label}`,
          fetchImpl: async (input, init) => {
            const res = await fetch(input, { ...init, signal: ctrl.signal });
            const body = await res.text();
            return { ok: res.ok, status: res.status, text: async () => body };
          },
        });
        if (sent.skipped) return "skipped" as const;
        if (!sent.response.ok) {
          console.error(`[send-arrival-sms] ${label} SMS failed:`, sent.response.status, await sent.response.text());
          openPhoneSends.push(false);
          return "failed" as const;
        }
        textDelivered = true;
        openPhoneSends.push(true);
        return "sent" as const;
      } catch (err) {
        console.error(`[send-arrival-sms] ${label} SMS failed:`, err);
        openPhoneSends.push(false);
        return "failed" as const;
      } finally {
        clearTimeout(timer);
      }
    };

    if (notifyClient && customer?.phone && copy.customerSms) {
      const msg = copy.customerSms;
      const outcome = await sendSms(formatPhoneNumber(customer.phone), msg, 'customer');
      if (outcome === "sent") clientSent = true;
      else if (outcome === "skipped" && !smsSkippedReason) {
        smsSkippedReason = "This number opted out by texting STOP";
      }
    }
    }

    // Every OpenPhone call failed. One delivered text stays claimed.
    if (arrivalOpenPhoneClaim(openPhoneSends) === 'release') {
      await releaseArrivalClaim(supabase, bookingId, staffId);
      releaseClaim = null;
      return new Response(JSON.stringify({
        success: false,
        error: 'Arrival text failed',
        clientSent,
        adminSent: false,
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (openPhoneSends.some((ok) => !ok)) {
      console.warn(`[send-arrival-sms] a recipient text failed for booking ${bookingId}; delivered texts will not be retried`);
    }

    const markedSent = await markArrivalClaimSent(supabase, bookingId, staffId);
    if (!markedSent && !textDelivered) {
      await releaseArrivalClaim(supabase, bookingId, staffId);
      releaseClaim = null;
      return new Response(JSON.stringify({ success: false, error: 'Could not record the arrival send' }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // A delivered text must not be released, even if the sent write is still failing.
    releaseClaim = null;
    if (!markedSent) {
      console.error(`[send-arrival-sms] claim stayed pending after retries for booking ${bookingId}`);
    }

    let office: Awaited<ReturnType<typeof notifyOwner>> = {
      deduped: false,
      bell: false,
      push: false,
      sms: false,
      email: false,
      smsSkippedReason: null,
      emailSkippedReason: null,
    };
    try {
      office = await notifyOwner(
        { supabase, organizationId: booking.organization_id, bookingId, staffId },
        "job.arrived",
        {
          title: copy.pushTitle,
          body: copy.adminSms,
          link: "/dashboard/bookings",
        },
      );
    } catch (ownerErr) {
      console.error("[send-arrival-sms] owner alert failed:", ownerErr);
    }
    const adminSent = office.sms;

    logAudit({
      action: AuditActions.SMS_GENERIC,
      organizationId: booking.organization_id,
      resourceType: 'booking',
      resourceId: bookingId,
      success: true,
    });

    return new Response(JSON.stringify({
      success: true,
      clientSent,
      adminSent,
      smsSkippedReason,
      channels: {
        customerSms: clientSent,
        adminSms: adminSent,
        bell: office.bell,
        push: office.push,
      },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    if (textDelivered && supabaseForError && bookingId && staffId) {
      try { await markArrivalClaimSent(supabaseForError, bookingId, staffId); } catch { /* logged inside the retry */ }
    } else if (releaseClaim && releaseArrivalClaimAfterError(textDelivered)) {
      try { await releaseClaim(); } catch { /* the response below is the failure */ }
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[send-arrival-sms] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
};

serve(handler);

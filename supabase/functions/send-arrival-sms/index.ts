import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAudit, AuditActions } from "../_shared/audit-log.ts";
import { sendOpenPhoneMessage } from '../_shared/openphone-send.ts';
import { formatFullAddress } from "../_shared/format-address.ts";
import { assertAssignedStaffEvent } from "../_shared/verify-staff-event.ts";
import { notifyOwner } from "../_shared/owner-alert.ts";
import { jobEventCopy, shouldSendArrival } from "../_shared/job-event-copy.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ArrivalRequest {
  bookingId: string;
  staffId: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { bookingId, staffId } = (await req.json()) as ArrivalRequest;
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
    const auth = await assertAssignedStaffEvent(req, supabase, booking.organization_id, staffId, bookingId);
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

    // Dedupe per staff per booking, after auth so a stranger cannot probe it.
    const reminderType = `arrived:${staffId}`;
    const { data: existingLog, error: existingLogErr } = await supabase
      .from('booking_reminder_log')
      .select('id')
      .eq('booking_id', bookingId)
      .eq('reminder_type', reminderType)
      .limit(1);
    if (existingLogErr) {
      console.error(`[send-arrival-sms] dedupe check failed for booking ${bookingId}, refusing to send to avoid a possible duplicate:`, existingLogErr);
      return new Response(JSON.stringify({ success: false, error: "Could not verify send status, please retry" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (existingLog && existingLog.length > 0) {
      return new Response(JSON.stringify({
        success: true,
        deduplicated: true,
        message: "Arrival already recorded.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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
      const sent = await sendOpenPhoneMessage({
        supabase,
        organizationId: booking.organization_id,
        to,
        content,
        from: phoneNumberId,
        apiKey: authHeader,
        tag: `send-arrival-sms:${label}`,
      });
      if (sent.skipped) return false;
      if (!sent.response.ok) {
        console.error(`[send-arrival-sms] ${label} SMS failed:`, sent.response.status, await sent.response.text());
        return false;
      }
      return true;
    };

    if (notifyClient && customer?.phone && copy.customerSms) {
      const msg = copy.customerSms;
      clientSent = await sendSms(formatPhoneNumber(customer.phone), msg, 'customer');
    }
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

    const { error: logInsertErr } = await supabase.from('booking_reminder_log').insert({
      booking_id: bookingId,
      organization_id: booking.organization_id,
      recipient_phone: customer?.phone ?? '',
      reminder_type: reminderType,
    });
    if (logInsertErr) {
      console.error(`[send-arrival-sms] SMS sent but booking_reminder_log insert failed for booking ${bookingId} — dedupe will not catch this next call:`, logInsertErr);
    }

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
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[send-arrival-sms] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
};

serve(handler);

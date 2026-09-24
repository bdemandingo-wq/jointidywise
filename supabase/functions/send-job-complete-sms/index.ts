import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAudit, AuditActions } from "../_shared/audit-log.ts";
import { parseAlertPhones, sendToExtraAlertPhones } from '../_shared/alertPhones.ts';
import { formatFullAddress } from "../_shared/format-address.ts";

/**
 * Texts the owner's PERSONAL cell the moment a cleaner marks a job complete.
 *
 * Same shape as send-arrival-sms deliberately: staff-triggered, service-role
 * read, deduped per staff per booking through booking_reminder_log so a double
 * tap or an offline retry cannot send twice.
 *
 * Admin-only by design — the customer already gets the review request from a
 * separate path, and a second "we're done" text would be noise to them.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CompleteRequest {
  bookingId: string;
  staffId: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { bookingId, staffId } = (await req.json()) as CompleteRequest;
    if (!bookingId || !staffId) {
      return new Response(JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const reminderType = `job_complete:${staffId}`;
    const { data: existingLog, error: existingLogErr } = await supabase
      .from('booking_reminder_log')
      .select('id')
      .eq('booking_id', bookingId)
      .eq('reminder_type', reminderType)
      .limit(1);
    if (existingLogErr) {
      console.error(`[send-job-complete-sms] dedupe check failed for booking ${bookingId}:`, existingLogErr);
      return new Response(JSON.stringify({ success: false, error: "Could not verify send status, please retry" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (existingLog && existingLog.length > 0) {
      return new Response(JSON.stringify({ success: true, deduplicated: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: booking } = await supabase
      .from('bookings')
      .select('id, booking_number, organization_id, total_amount, address, apt_suite, city, state, zip_code, customer:customers(first_name, last_name)')
      .eq('id', bookingId)
      .single();
    if (!booking?.organization_id) {
      return new Response(JSON.stringify({ success: false, error: "Booking not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Cross-tenant guard: the staff row must belong to the booking's org.
    const { data: staff } = await supabase
      .from('staff')
      .select('id, name, organization_id')
      .eq('id', staffId)
      .maybeSingle();
    if (!staff || staff.organization_id !== booking.organization_id) {
      return new Response(JSON.stringify({ success: false, error: "Staff does not belong to this organization" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const customerData = booking.customer as unknown;
    const customer = (Array.isArray(customerData) ? customerData[0] : customerData) as
      { first_name: string; last_name: string } | null;
    const customerLabel = customer ? `${customer.first_name} ${customer.last_name}` : 'Customer';

    const { data: businessSettings } = await supabase
      .from('business_settings')
      .select('company_name, company_phone, notification_phone')
      .eq('organization_id', booking.organization_id)
      .maybeSingle();

    /* Personal cell first. company_phone is frequently the OpenPhone line, and
       OpenPhone texting its own number never reaches a handset. */
    const adminPhone = (businessSettings as { notification_phone?: string | null } | null)?.notification_phone
      || businessSettings?.company_phone;

    // The bell entry goes in regardless of whether SMS is set up at all.
    const { error: bellErr } = await supabase.from('admin_system_notifications').insert({
      organization_id: booking.organization_id,
      type: 'staff_activity',
      title: '✅ Job completed',
      message: `${staff.name} completed Booking #${booking.booking_number} for ${customerLabel}.`,
      link: '/dashboard/bookings',
      metadata: { booking_id: bookingId, staff_id: staffId },
    });
    if (bellErr) console.warn('[send-job-complete-sms] bell notification failed:', bellErr);

    const { data: smsSettings } = await supabase
      .from('organization_sms_settings')
      .select('openphone_api_key, openphone_phone_number_id, sms_enabled')
      .eq('organization_id', booking.organization_id)
      .maybeSingle();

    if (!smsSettings?.sms_enabled || !smsSettings.openphone_api_key || !smsSettings.openphone_phone_number_id || !adminPhone) {
      console.log('[send-job-complete-sms] SMS not configured or no alert phone — bell only');
      return new Response(JSON.stringify({ success: true, adminSent: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let phoneNumberId = smsSettings.openphone_phone_number_id;
    if (phoneNumberId.includes('openphone.com')) {
      const m = phoneNumberId.match(/phone-numbers\/([A-Za-z0-9]+)/);
      if (m) phoneNumberId = m[1];
    }
    const authHeader = smsSettings.openphone_api_key.trim().replace(/^Bearer\s+/i, '');

    const formatPhoneNumber = (phone: string): string => {
      let f = phone.replace(/\D/g, '');
      if (f.length === 10) f = `+1${f}`;
      else if (!f.startsWith('+')) f = `+${f}`;
      return f;
    };

    const amount = typeof booking.total_amount === 'number' ? `\nTotal: $${booking.total_amount.toFixed(2)}` : '';
    const message = `✅ ${staff.name} completed Job #${booking.booking_number}\n\n` +
      `Customer: ${customerLabel}\n` +
      `Address: ${formatFullAddress(booking as any) || 'N/A'}${amount}`;

    let adminSent = false;
    const r = await fetch("https://api.openphone.com/v1/messages", {
      method: "POST",
      headers: { "Authorization": authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ from: phoneNumberId, to: [parseAlertPhones(adminPhone)[0] || formatPhoneNumber(adminPhone)], content: message }),
    });
    await sendToExtraAlertPhones(parseAlertPhones(adminPhone).slice(1), phoneNumberId, authHeader, message, 'send-job-complete-sms');
    if (!r.ok) {
      console.error('[send-job-complete-sms] admin SMS failed:', r.status, await r.text());
    } else {
      adminSent = true;
    }

    const { error: logInsertErr } = await supabase.from('booking_reminder_log').insert({
      booking_id: bookingId,
      organization_id: booking.organization_id,
      recipient_phone: parseAlertPhones(adminPhone)[0] || formatPhoneNumber(adminPhone),
      reminder_type: reminderType,
    });
    if (logInsertErr) {
      console.error(`[send-job-complete-sms] log insert failed for booking ${bookingId} — dedupe will not catch this next call:`, logInsertErr);
    }

    logAudit({
      action: AuditActions.SMS_GENERIC,
      organizationId: booking.organization_id,
      resourceType: 'booking',
      resourceId: bookingId,
      success: adminSent,
    });

    return new Response(JSON.stringify({ success: true, adminSent }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[send-job-complete-sms] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
};

serve(handler);

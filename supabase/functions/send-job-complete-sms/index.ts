import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAudit, AuditActions } from "../_shared/audit-log.ts";
import { formatFullAddress } from "../_shared/format-address.ts";
import { assertAssignedStaffEvent } from "../_shared/verify-staff-event.ts";
import { notifyOwner, ownerAlertPhones } from "../_shared/owner-alert.ts";
import { jobEventCopy } from "../_shared/job-event-copy.ts";

/**
 * Tells the owner a cleaner marked a job complete: bell + push, email when
 * push cannot land, and an optional "Also text me" SMS.
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

    const { data: booking } = await supabase
      .from('bookings')
      .select('id, booking_number, organization_id, total_amount, address, apt_suite, city, state, zip_code, customer:customers(first_name, last_name)')
      .eq('id', bookingId)
      .single();
    if (!booking?.organization_id) {
      return new Response(JSON.stringify({ success: false, error: "Booking not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: staff } = await supabase
      .from('staff')
      .select('id, name, organization_id')
      .eq('id', staffId)
      .maybeSingle();
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
      return new Response(JSON.stringify({ success: true, deduplicated: true, message: "Job completion already recorded." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const customerData = booking.customer as unknown;
    const customer = (Array.isArray(customerData) ? customerData[0] : customerData) as
      { first_name: string; last_name: string } | null;
    const customerLabel = customer ? `${customer.first_name} ${customer.last_name}` : 'Customer';

    const { data: businessSettings } = await supabase
      .from('business_settings')
      .select('company_name, notification_phone, company_phone')
      .eq('organization_id', booking.organization_id)
      .maybeSingle();

    const address = formatFullAddress(booking as any) || 'N/A';
    const amountSuffix = typeof booking.total_amount === 'number' ? `\nTotal: $${booking.total_amount.toFixed(2)}` : '';
    const copy = jobEventCopy('completed', {
      staffName: staff.name,
      bookingNumber: booking.booking_number,
      customerLabel,
      companyName: businessSettings?.company_name || 'Your cleaning service',
      address,
      amountSuffix,
    });

    const office = await notifyOwner(
      { supabase, organizationId: booking.organization_id, bookingId, staffId },
      "job.completed",
      {
        title: copy.pushTitle,
        body: copy.adminSms,
        link: "/dashboard/bookings?status=completed",
      },
    );

    const adminSent = office.sms;
    // An owner who left "Also text me" off was still notified by push and the bell.
    // Only a missing texting setup belongs in the cleaner's "texting isn't set up" sentence.
    const textingUnavailable = office.smsSkippedReason === "SMS is not enabled"
      || office.smsSkippedReason === "SMS not configured"
      || office.smsSkippedReason === "No alert phone configured";
    const smsSkippedReason = office.sms || !textingUnavailable ? null : office.smsSkippedReason;
    const recipientPhone = ownerAlertPhones(
      businessSettings?.notification_phone,
      businessSettings?.company_phone,
    )[0] || 'push';
    const { error: logInsertErr } = await supabase.from('booking_reminder_log').insert({
      booking_id: bookingId,
      organization_id: booking.organization_id,
      recipient_phone: recipientPhone,
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

    return new Response(JSON.stringify({
      success: true,
      adminSent,
      smsSkippedReason,
      channels: {
        customerSms: false,
        adminSms: adminSent,
        bell: office.bell,
        push: office.push,
      },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[send-job-complete-sms] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
};

serve(handler);

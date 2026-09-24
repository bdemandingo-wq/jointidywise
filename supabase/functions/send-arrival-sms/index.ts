import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAudit, AuditActions } from "../_shared/audit-log.ts";
import { formatFullAddress } from "../_shared/format-address.ts";

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

    // Dedupe per staff per booking
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
      return new Response(JSON.stringify({ success: true, deduplicated: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: booking } = await supabase
      .from('bookings')
      .select('id, booking_number, organization_id, address, apt_suite, city, state, zip_code, customer:customers(first_name, last_name, phone)')
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

    const { data: smsSettings } = await supabase
      .from('organization_sms_settings')
      .select('openphone_api_key, openphone_phone_number_id, sms_enabled, notify_admin_arrived, notify_client_arrived')
      .eq('organization_id', booking.organization_id)
      .maybeSingle();

    if (!smsSettings?.sms_enabled || !smsSettings.openphone_api_key || !smsSettings.openphone_phone_number_id) {
      return new Response(JSON.stringify({ success: false, error: "SMS not configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: businessSettings } = await supabase
      .from('business_settings')
      .select('company_name, company_phone, notification_phone')
      .eq('organization_id', booking.organization_id)
      .maybeSingle();
    const companyName = businessSettings?.company_name || 'Your cleaning service';
    /* Personal cell wins. company_phone is often the OpenPhone line, and
       OpenPhone texting itself never lands on a handset. */
    const adminPhone = (businessSettings as { notification_phone?: string | null } | null)?.notification_phone
      || businessSettings?.company_phone;

    const notifyClient = (smsSettings as any).notify_client_arrived !== false;
    const notifyAdmin = (smsSettings as any).notify_admin_arrived !== false;

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
      const r = await fetch("https://api.openphone.com/v1/messages", {
        method: "POST",
        headers: { "Authorization": authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ from: phoneNumberId, to: [to], content }),
      });
      if (!r.ok) {
        console.error(`[send-arrival-sms] ${label} SMS failed:`, r.status, await r.text());
        return false;
      }
      return true;
    };

    let clientSent = false;
    if (notifyClient && customer?.phone) {
      const msg = `✅ ${staff.name} from ${companyName} has arrived for your appointment!\n\nBooking #${booking.booking_number}`;
      clientSent = await sendSms(formatPhoneNumber(customer.phone), msg, 'customer');
    }

    let adminSent = false;
    if (notifyAdmin && adminPhone) {
      const msg = `📍 ${staff.name} has arrived at Job #${booking.booking_number}\n\n` +
        `Customer: ${customer?.first_name ?? ''} ${customer?.last_name ?? ''}\n` +
        `Address: ${formatFullAddress(booking as any) || 'N/A'}`;
      adminSent = await sendSms(formatPhoneNumber(adminPhone), msg, 'admin');
    }

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

    return new Response(JSON.stringify({ success: true, clientSent, adminSent }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[send-arrival-sms] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
};

serve(handler);

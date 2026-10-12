import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAudit, AuditActions } from "../_shared/audit-log.ts";
import { parseAlertPhones } from '../_shared/alertPhones.ts';
import { formatFullAddress } from "../_shared/format-address.ts";
import { assertAssignedStaffEvent } from "../_shared/verify-staff-event.ts";
import { rejectUnauthenticated } from "../_shared/require-caller-org.ts";
import { notifyOffice } from "../_shared/office-notify.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OnTheWayRequest {
  bookingId: string;
  staffId: string;
  etaMinutes?: number;
  trackingToken?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[send-on-the-way-sms] Missing Supabase configuration");
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Caller before the body. Staff and admins send their user JWT.
    // Service-role still passes; assertAssignedStaffEvent allows it after the
    // booking id is known. An empty unauthenticated POST must be 401, not a
    // JSON parse 500.
    const denied = await rejectUnauthenticated(req, corsHeaders, {
      success: false,
      error: "Unauthorized",
    });
    if (denied) return denied;

    let bookingId: string | undefined;
    let staffId: string | undefined;
    let etaMinutes: number | undefined;
    let trackingToken: string | undefined;
    try {
      const parsed = await req.json() as OnTheWayRequest | null;
      bookingId = parsed?.bookingId;
      staffId = parsed?.staffId;
      etaMinutes = parsed?.etaMinutes;
      trackingToken = parsed?.trackingToken;
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!bookingId || !staffId) {
      console.error("[send-on-the-way-sms] Missing bookingId or staffId");
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch booking with customer info
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select(`
        id,
        booking_number,
        scheduled_at,
        organization_id,
        address,
        apt_suite,
        city,
        state,
        zip_code,
        customer:customers(
          first_name,
          last_name,
          phone
        )
      `)
      .eq('id', bookingId)
      .single();

    if (bookingError || !booking) {
      console.error("[send-on-the-way-sms] Failed to fetch booking:", bookingError);
      return new Response(
        JSON.stringify({ success: false, error: "Booking not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!booking.organization_id) {
      console.error("[send-on-the-way-sms] Booking has no organization_id");
      return new Response(
        JSON.stringify({ success: false, error: "Organization not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Caller must be this cleaner, or an owner/admin/manager, and the staff
    // row must be assigned to this booking in this organization.
    const auth = await assertAssignedStaffEvent(req, supabase as any, booking.organization_id, staffId, bookingId);
    if (!auth.ok) {
      return new Response(
        JSON.stringify({ success: false, error: auth.error }),
        { status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Deduplication: each staff member can send their own "on the way" once.
    // Team jobs: both cleaners can press "On The Way" (each sends one SMS to the customer).
    const staffReminderType = `on_the_way:${staffId}`;
    const { data: existingLog, error: existingLogErr } = await supabase
      .from('booking_reminder_log')
      .select('id')
      .eq('booking_id', bookingId)
      .eq('reminder_type', staffReminderType)
      .limit(1);

    if (existingLogErr) {
      console.error(`[send-on-the-way-sms] dedupe check failed for booking ${bookingId}, refusing to send to avoid a possible duplicate:`, existingLogErr);
      return new Response(
        JSON.stringify({ success: false, error: "Could not verify send status, please retry" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (existingLog && existingLog.length > 0) {
      console.log(`[send-on-the-way-sms] Already sent for booking ${bookingId} by staff ${staffId}, skipping duplicate`);
      return new Response(
        JSON.stringify({ success: true, deduplicated: true, message: "You've already sent the on-the-way notification for this booking." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle customer as array from join
    const customerData = booking.customer as unknown;
    const customer = Array.isArray(customerData) ? customerData[0] : customerData;
    const typedCustomer = customer as { first_name: string; last_name: string; phone: string | null } | null;
    
    /* A customer with no phone used to abort here with a 400. That silenced the
       ADMIN alert too — the owner never learned their cleaner was on the way
       because of a gap in the CUSTOMER's record. The customer text is now
       simply skipped; everything else still runs. */
    if (!typedCustomer?.phone) {
      console.log("[send-on-the-way-sms] Customer has no phone number — skipping customer SMS, still alerting admin");
    }

    // Fetch staff info
    const { data: staff, error: staffError } = await supabase
      .from('staff')
      .select('name')
      .eq('id', staffId)
      .single();

    if (staffError || !staff) {
      console.error("[send-on-the-way-sms] Failed to fetch staff:", staffError);
      return new Response(
        JSON.stringify({ success: false, error: "Staff not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch SMS settings
    const { data: smsSettings, error: settingsError } = await supabase
      .from('organization_sms_settings')
      .select('openphone_api_key, openphone_phone_number_id, sms_enabled, notify_admin_on_the_way, notify_client_on_the_way, notify_client_distance_eta')
      .eq('organization_id', booking.organization_id)
      .maybeSingle();

    // Bell + push happen whether or not SMS is configured. The previous
    // early return on "SMS notifications are disabled" skipped both, so the
    // office heard nothing and the cleaner was told the whole action failed.
    const customerLabelForOffice = typedCustomer
      ? `${typedCustomer.first_name} ${typedCustomer.last_name}`
      : 'Customer';
    const office = await notifyOffice(supabase as any, {
      organizationId: booking.organization_id,
      title: '🚗 Cleaner on the way',
      message: `${staff.name} is on the way to Booking #${booking.booking_number} for ${customerLabelForOffice}.`,
      metadata: { booking_id: bookingId, staff_id: staffId },
      pushTitle: `🚗 ${staff.name} is on the way`,
      pushBody: `Booking #${booking.booking_number}`,
      pushData: { booking_id: bookingId, kind: 'on_the_way' },
    });

    let smsSkippedReason: string | null = null;
    if (settingsError) {
      console.error("[send-on-the-way-sms] Error fetching SMS settings:", settingsError);
      smsSkippedReason = "Failed to fetch SMS settings";
    } else if (!smsSettings?.sms_enabled) {
      console.log("[send-on-the-way-sms] SMS disabled for organization");
      smsSkippedReason = "SMS notifications are disabled";
    } else if (!smsSettings.openphone_api_key || !smsSettings.openphone_phone_number_id) {
      console.log("[send-on-the-way-sms] OpenPhone not configured");
      smsSkippedReason = "OpenPhone not configured";
    }

    let customerSms = false;
    let adminSms = false;
    let messageId: string | undefined;
    let customerSmsError: string | null = null;
    const formatPhoneNumber = (phone: string): string => {
      let formatted = phone.replace(/\D/g, '');
      if (formatted.length === 10) formatted = `+1${formatted}`;
      else if (!formatted.startsWith('+')) formatted = `+${formatted}`;
      return formatted;
    };
    const formattedCustomerPhone = typedCustomer?.phone ? formatPhoneNumber(typedCustomer.phone) : '';

    if (!smsSkippedReason && smsSettings) {
    // Get business settings for company name, admin phone, and app URL
    const { data: businessSettings } = await supabase
      .from('business_settings')
      .select('company_name, company_phone, notification_phone, app_url')
      .eq('organization_id', booking.organization_id)
      .maybeSingle();

    const companyName = businessSettings?.company_name || 'Your cleaning service';
    /* notification_phone is the owner's personal cell. company_phone is often
       the OpenPhone line itself, and OpenPhone texting its own number never
       reaches a handset — which is why these alerts appeared to vanish. */
    const adminPhone = (businessSettings as { notification_phone?: string | null } | null)?.notification_phone
      || businessSettings?.company_phone;

    // Resolve the app URL for tracking link
    let appBaseUrl = businessSettings?.app_url || Deno.env.get("APP_URL") || Deno.env.get("PROJECT_URL") || '';
    appBaseUrl = appBaseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!appBaseUrl) {
      appBaseUrl = 'jointidywise.com';
    }

    // Check if distance/ETA should be included in client SMS
    const includeClientEta = smsSettings.notify_client_distance_eta !== false;

    // Build customer SMS message
    let customerMessage = `🚗 ${staff.name} from ${companyName} is on the way to your appointment!`;
    
    if (includeClientEta && etaMinutes && etaMinutes > 0) {
      customerMessage += `\n\nEstimated arrival: ~${etaMinutes} minutes`;
    }

    // Add tracking link if available
    if (trackingToken) {
      customerMessage += `\n\n📍 Track your cleaner live:\nhttps://${appBaseUrl}/track/${trackingToken}`;
    }
    
    customerMessage += `\n\nBooking #${booking.booking_number}`;
    
    const formattedAddress = formatFullAddress(booking as any);
    if (formattedAddress) {
      customerMessage += `\n📍 ${formattedAddress}`;
    }

    customerMessage += `\n\nQuestions? Reply to this message.`;

    // Build admin notification message
    const customerLabel = typedCustomer
      ? `${typedCustomer.first_name} ${typedCustomer.last_name}`
      : 'Customer';
    const adminMessage = `📍 ${staff.name} is on the way to Job #${booking.booking_number}\n\n` +
      `Customer: ${customerLabel}\n` +
      `Address: ${formattedAddress || 'N/A'}\n` +
      (etaMinutes ? `ETA: ~${etaMinutes} min` : '');

    // Extract phone number ID if full URL was provided
    let phoneNumberId = smsSettings.openphone_phone_number_id;
    if (phoneNumberId.includes('openphone.com')) {
      const match = phoneNumberId.match(/phone-numbers\/([A-Za-z0-9]+)/);
      if (match) {
        phoneNumberId = match[1];
      }
    }

    // OpenPhone expects the raw API key
    const authHeader = smsSettings.openphone_api_key.trim().replace(/^Bearer\s+/i, '');

    // Helper function to send SMS
    const sendSms = async (to: string, content: string, label: string): Promise<{ success: boolean; messageId?: string; error?: string }> => {
      console.log(`[send-on-the-way-sms] Sending ${label} SMS to ${to}`);
      
      const response = await fetch("https://api.openphone.com/v1/messages", {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: phoneNumberId,
          to: [to],
          content,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[send-on-the-way-sms] ${label} SMS failed: ${response.status} - ${errorText}`);
        const plain = response.status === 401 || response.status === 403
          ? "The texting account rejected the message. Check OpenPhone in Settings."
          : response.status === 429
            ? "Texting is rate-limited right now. Wait a moment and try again."
            : response.status >= 500
              ? "The texting service had a problem. Try again in a moment."
              : "The text to the customer was rejected. Check the phone number on file.";
        return { success: false, error: plain };
      }

      const result = await response.json();
      console.log(`[send-on-the-way-sms] ${label} SMS sent successfully:`, result);
      return { success: true, messageId: result.data?.id };
    };

    // Check notification preferences (default to true if not set)
    const notifyClient = smsSettings.notify_client_on_the_way !== false;
    const notifyAdmin = smsSettings.notify_admin_on_the_way !== false;

    /* Customer first, but a customer-side failure must NOT return early — the
       admin alert below is the one the owner actually relies on, and skipping
       it because the customer's carrier rejected a text is how "I pressed on
       the way and nobody got anything" happens. */
    if (notifyClient && formattedCustomerPhone) {
      const customerResult = await sendSms(formattedCustomerPhone, customerMessage, 'customer');
      customerSms = customerResult.success;
      messageId = customerResult.messageId;
      if (!customerResult.success) {
        customerSmsError = customerResult.error || "The text to the customer didn't go through.";
        console.warn("[send-on-the-way-sms] Customer SMS failed — continuing to admin alert:", customerSmsError);
      }
    } else if (notifyClient && !formattedCustomerPhone && !smsSkippedReason) {
      smsSkippedReason = "No phone number on file";
      console.log("[send-on-the-way-sms] Customer SMS skipped (no phone on file)");
    } else if (!notifyClient && !smsSkippedReason) {
      smsSkippedReason = "Customer on-the-way texts are turned off";
      console.log("[send-on-the-way-sms] Customer SMS skipped (disabled)");
    } else {
      console.log("[send-on-the-way-sms] Customer SMS skipped (disabled or no phone on file)");
    }

    // Send admin SMS if admin phone is configured and enabled
    if (notifyAdmin && adminPhone) {
      const phones = parseAlertPhones(adminPhone);
      const list = phones.length ? phones : [formatPhoneNumber(adminPhone)];
      const adminResult = await sendSms(list[0], adminMessage, 'admin');
      for (const extra of list.slice(1)) await sendSms(extra, adminMessage, 'admin');
      adminSms = adminResult.success;
      if (!adminResult.success) {
        console.warn(`[send-on-the-way-sms] Admin SMS failed, but the office bell and push were already sent`);
      }
    } else if (!notifyAdmin) {
      console.log(`[send-on-the-way-sms] Admin SMS disabled by org settings, skipping`);
    } else {
      console.log(`[send-on-the-way-sms] No admin phone configured, skipping admin SMS`);
    }
    }

    // Log only when the customer text went out, or was skipped on purpose
    // (no phone, SMS off, customer texts disabled). A failed OpenPhone send
    // must stay retryable — logging it made the next tap a duplicate.
    if (!customerSmsError) {
      const { error: logInsertErr } = await supabase.from('booking_reminder_log').insert({
        booking_id: bookingId,
        organization_id: booking.organization_id,
        recipient_phone: formattedCustomerPhone,
        reminder_type: staffReminderType,
      });
      if (logInsertErr) {
        console.error(`[send-on-the-way-sms] booking_reminder_log insert failed for booking ${bookingId} — dedupe will not catch this next call:`, logInsertErr);
      }
    }

    // Audit log
    logAudit({
      action: AuditActions.SMS_GENERIC,
      organizationId: booking.organization_id,
      resourceType: 'booking',
      resourceId: bookingId,
      success: true,
    });

    return new Response(
      JSON.stringify({
        success: true,
        messageId,
        adminNotified: adminSms,
        smsSkippedReason,
        customerSmsError,
        channels: {
          customerSms,
          adminSms,
          bell: office.bell,
          push: office.push,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[send-on-the-way-sms] Error:", errorMessage);

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyOwner } from "../_shared/owner-alert.ts";
import { resolveCallerOrg } from "../_shared/require-caller-org.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CancellationNotificationRequest {
  customerName: string;
  serviceName: string;
  scheduledAt: string;
  formattedDate?: string; // Pre-formatted date from client
  formattedTime?: string; // Pre-formatted time from client
  bookingNumber: number;
  bookingId?: string;
  organizationId: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[send-cancellation-sms-notification] Missing Supabase configuration");
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      customerName,
      serviceName,
      scheduledAt,
      formattedDate: preFormattedDate,
      formattedTime: preFormattedTime,
      bookingNumber,
      bookingId,
    }: CancellationNotificationRequest = await req.json();

    // SECURITY: never trust organizationId from the request body — resolve it
    // from the caller's own JWT + org_memberships instead.
    const callerOrg = await resolveCallerOrg(req);
    if (!callerOrg.ok) {
      return new Response(
        JSON.stringify({ success: false, error: callerOrg.error }),
        { status: callerOrg.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const organizationId = callerOrg.ctx.organizationId;

    console.log("[send-cancellation-sms-notification] Processing notification for org:", organizationId);

    const { data: businessSettings, error: businessError } = await supabase
      .from('business_settings')
      .select('timezone')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (businessError) {
      console.warn("[send-cancellation-sms-notification] timezone read failed, using Eastern:", businessError.message);
    }

    let formattedDate: string;
    let formattedTime: string;

    if (preFormattedDate && preFormattedTime) {
      formattedDate = preFormattedDate;
      formattedTime = preFormattedTime;
    } else {
      const orgTimezone = businessSettings?.timezone || "America/New_York";
      const bookingDate = new Date(scheduledAt);
      formattedDate = new Intl.DateTimeFormat('en-US', {
        timeZone: orgTimezone,
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }).format(bookingDate);
      formattedTime = new Intl.DateTimeFormat('en-US', {
        timeZone: orgTimezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }).format(bookingDate);
    }

    const message = `❌ BOOKING CANCELLED\n\n` +
      `Booking #${bookingNumber}\n` +
      `Customer: ${customerName}\n` +
      `Service: ${serviceName}\n` +
      `Was scheduled: ${formattedDate} at ${formattedTime}\n\n` +
      `Log in to your dashboard for details.`;

    let scopedBookingId: string | undefined;
    let occurrenceId: string | undefined;
    if (bookingId) {
      const { data: bookingRow, error: bookingError } = await supabase
        .from('bookings')
        .select('cancelled_at, updated_at')
        .eq('id', bookingId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (bookingError) {
        console.warn("[send-cancellation-sms-notification] booking lookup failed:", bookingError.message);
      } else if (!bookingRow) {
        console.warn("[send-cancellation-sms-notification] bookingId is not in this organization");
      } else {
        scopedBookingId = bookingId;
        occurrenceId = bookingRow.cancelled_at || bookingRow.updated_at || undefined;
      }
    }

    const owner = await notifyOwner(
      { supabase, organizationId, bookingId: scopedBookingId, occurrenceId },
      "booking.cancelled",
      {
        title: `Booking #${bookingNumber} cancelled`,
        body: message,
        link: "/dashboard/bookings?status=cancelled",
      },
    );

    return new Response(
      JSON.stringify({ success: true, channels: owner }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[send-cancellation-sms-notification] Error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);

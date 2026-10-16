// Shared booking-creation logic.
//
// PURE MOVE: this file contains the validation schema plus the customer upsert,
// double-booking conflict check, booking insert, lead insert and notification
// fan-out exactly as they were inside external-booking-webhook (its lines
// 133..461 before this extraction). No logic was altered — only relocated — so
// the integration path behaves identically.
import { z } from "npm:zod@3.25.76";
import { notifyOwner } from "./owner-alert.ts";

// Strict input validation schema
export const BookingSchema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255).transform(v => v.toLowerCase()),
  phone: z.string().trim().max(20).regex(/^\+?[0-9\s\-().]{7,20}$/).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  state: z.string().trim().max(100).optional().nullable(),
  zip_code: z.string().trim().max(20).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  service_name: z.string().trim().max(200).optional().nullable(),
  scheduled_at: z.string().datetime({ message: "scheduled_at must be a valid ISO 8601 datetime" }),
  duration: z.number().int().min(15).max(1440).optional().nullable(),
  total_amount: z.number().min(0).max(100000).optional().nullable(),
  bedrooms: z.string().trim().max(10).optional().nullable(),
  bathrooms: z.string().trim().max(10).optional().nullable(),
  square_footage: z.string().trim().max(20).optional().nullable(),
  frequency: z.string().trim().max(50).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  extras: z.record(z.unknown()).optional().nullable(),
  organization_slug: z.string().trim().min(1).max(100).optional().nullable(),
  organization_id: z.string().uuid().optional().nullable(),
  has_pets: z.boolean().optional().nullable(),
  room_reductions: z.object({
    bedroom: z.number().int().min(0).max(50).optional(),
    bathroom: z.number().int().min(0).max(50).optional(),
    full_bath: z.number().int().min(0).max(50).optional(),
  }).partial().optional().nullable(),
  is_arrival_window: z.boolean().optional().nullable(),
  arrival_window_start: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  arrival_window_end: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  referral_code: z.string().trim().min(1).max(64).optional().nullable(),
});

export type BookingPayload = z.infer<typeof BookingSchema>;

export async function createBookingFromPayload(opts: {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  payload: BookingPayload;
  organizationId: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  corsHeaders: Record<string, string>;
}): Promise<Response> {
  const { supabase, payload, organizationId, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, corsHeaders } = opts;

    console.log("[external-booking-webhook] Using organization:", organizationId);

    // Check if customer exists, create if not
    let customerId: string;
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('email', payload.email.toLowerCase())
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (existingCustomer) {
      customerId = existingCustomer.id;
      console.log("[external-booking-webhook] Found existing customer:", customerId);
    } else {
      // Create new customer
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          first_name: payload.first_name,
          last_name: payload.last_name,
          email: payload.email.toLowerCase(),
          phone: payload.phone || null,
          address: payload.address || null,
          city: payload.city || null,
          state: payload.state || null,
          zip_code: payload.zip_code || null,
          latitude: payload.latitude ?? null,
          longitude: payload.longitude ?? null,
          organization_id: organizationId,
          customer_status: 'active',
          marketing_status: 'active',
        })
        .select('id')
        .single();

      if (customerError || !newCustomer) {
        console.error("[external-booking-webhook] Failed to create customer:", customerError);
        return new Response(
          JSON.stringify({ success: false, error: "Failed to create customer" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      customerId = newCustomer.id;
      console.log("[external-booking-webhook] Created new customer:", customerId);

    }

    // Find service by name if provided
    let serviceId: string | null = null;
    if (payload.service_name) {
      // Escape SQL LIKE wildcards to prevent pattern injection
      const safeName = payload.service_name.replace(/%/g, '\\%').replace(/_/g, '\\_');
      const { data: service } = await supabase
        .from('services')
        .select('id')
        .eq('organization_id', organizationId)
        .ilike('name', `%${safeName}%`)
        .limit(1)
        .maybeSingle();
      
      if (service) {
        serviceId = service.id;
      }
    }

    // --- Server-side availability re-check to prevent double-booking ---
    try {
      const scheduledDate = new Date(payload.scheduled_at);

      // Get org timezone
      const { data: bizSettings } = await supabase
        .from('business_settings')
        .select('timezone, booking_buffer_minutes')
        .eq('organization_id', organizationId)
        .maybeSingle();

      const orgTimezone = bizSettings?.timezone || 'America/New_York';
      const bufferMinutes = bizSettings?.booking_buffer_minutes || 0;

      // Get service duration
      let serviceDuration = 120;
      if (serviceId) {
        const { data: svcData } = await supabase
          .from('services')
          .select('duration')
          .eq('id', serviceId)
          .maybeSingle();
        if (svcData?.duration) serviceDuration = svcData.duration;
      }

      // Check for overlapping bookings with any staff
      const slotStart = scheduledDate;
      const slotEnd = new Date(scheduledDate.getTime() + serviceDuration * 60000);

      // Find bookings that overlap with this slot
      const { data: conflictingBookings } = await supabase
        .from('bookings')
        .select('id, staff_id, scheduled_at, duration')
        .eq('organization_id', organizationId)
        .in('status', ['pending', 'confirmed'])
        .gte('scheduled_at', new Date(slotStart.getTime() - 24 * 60 * 60000).toISOString())
        .lte('scheduled_at', new Date(slotEnd.getTime() + 24 * 60 * 60000).toISOString());

      // Get all active staff
      const { data: activeStaff } = await supabase
        .from('staff')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('is_active', true);

      const staffIds = (activeStaff || []).map((s: any) => s.id);

      // Check if ANY staff is available for this slot
      const slotStartMs = slotStart.getTime();
      const slotEndMs = slotEnd.getTime();

      // Count ALL overlapping bookings — assigned or not — since each one
      // consumes a unit of org capacity. Mirrors check-availability so the
      // submit guard matches what the customer was shown.
      let overlappingCount = 0;
      for (const cb of (conflictingBookings || [])) {
        const cbStart = new Date(cb.scheduled_at).getTime();
        const cbEnd = cbStart + ((cb.duration || 120) + bufferMinutes) * 60000;
        if (slotStartMs < cbEnd && slotEndMs > cbStart) {
          overlappingCount++;
        }
      }

      if (staffIds.length > 0 && overlappingCount >= staffIds.length) {
        console.log("[external-booking-webhook] Slot conflict detected, no available staff");
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: "That time was just booked—pick another time.",
            conflict: true 
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } catch (conflictErr) {
      console.error("[external-booking-webhook] Conflict check error (non-blocking):", conflictErr);
      // Non-blocking - continue with booking creation
    }

    // Create the booking
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .insert({
        customer_id: customerId,
        organization_id: organizationId,
        service_id: serviceId,
        scheduled_at: payload.scheduled_at,
        duration: payload.duration || 120,
        total_amount: payload.total_amount || 0,
        address: payload.address || null,
        city: payload.city || null,
        state: payload.state || null,
        zip_code: payload.zip_code || null,
        latitude: payload.latitude ?? null,
        longitude: payload.longitude ?? null,
        bedrooms: payload.bedrooms || null,
        bathrooms: payload.bathrooms || null,
        square_footage: payload.square_footage || null,
        frequency: payload.frequency || 'one-time',
        notes: payload.notes ? `[From External Website] ${payload.notes}` : '[From External Website]',
        extras: payload.extras || null,
        has_pets: payload.has_pets ?? false,
        room_reductions: payload.room_reductions ?? null,
        is_arrival_window: payload.is_arrival_window ?? false,
        arrival_window_start: payload.arrival_window_start ?? null,
        arrival_window_end: payload.arrival_window_end ?? null,
        referral_code: payload.referral_code ? payload.referral_code.trim() : null,
        status: 'pending',
        payment_status: 'pending',
      })
      .select('id, booking_number')
      .single();

    if (bookingError || !booking) {
      console.error("[external-booking-webhook] Failed to create booking:", bookingError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create booking" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[external-booking-webhook] Created booking:", booking.id, "Number:", booking.booking_number);


    // Create a lead entry for this customer automatically
    try {
      const { data: existingLead, error: existingLeadErr } = await supabase
        .from('leads')
        .select('id')
        .eq('email', payload.email.toLowerCase())
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (existingLeadErr) {
        console.error("[external-booking-webhook] Lead dedupe check failed, skipping lead creation to avoid a possible duplicate:", existingLeadErr);
      } else if (!existingLead) {
        const { error: leadInsertErr } = await supabase
          .from('leads')
          .insert({
            first_name: payload.first_name,
            last_name: payload.last_name,
            email: payload.email.toLowerCase(),
            phone: payload.phone || null,
            source: 'booking_form',
            status: 'new',
            notes: `Auto-created from public booking form (BK-${booking.booking_number})`,
            organization_id: organizationId,
          });
        if (leadInsertErr) {
          console.error("[external-booking-webhook] Lead insert failed:", leadInsertErr);
        } else {
          console.log("[external-booking-webhook] Auto-created lead for customer");
        }
      }
    } catch (leadErr) {
      console.error("[external-booking-webhook] Failed to create lead:", leadErr);
      // Non-blocking
    }

    // Notify the admin on TWO always-on channels: SMS (OpenPhone) and email.
    //
    // Both fire unconditionally rather than email-as-SMS-fallback. Detecting an
    // SMS failure reliably is not possible — OpenPhone can accept a request and
    // silently drop the message (no A2P registration, SMS disabled downstream),
    // and a prepaid-credit 402 stops delivery for every booking until someone
    // notices. Two independent channels remove the single point of failure.
    //
    // Runs AFTER the response is handed back: the customer waits on the booking,
    // not on an SMTP handshake. Nothing in here can fail the booking.
    const notifications = runBookingNotifications({
      supabase,
      payload,
      organizationId,
      booking,
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
    }).catch((err) => {
      console.error("[booking-notify] Unhandled notification error:", err);
    });

    // deno-lint-ignore no-explicit-any
    const edgeRuntime = (globalThis as any).EdgeRuntime;
    if (typeof edgeRuntime?.waitUntil === "function") {
      edgeRuntime.waitUntil(notifications);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        booking_id: booking.id,
        booking_number: booking.booking_number,
        customer_id: customerId,
        message: "Booking created successfully"
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
}

/**
 * Queryable record of what each notification channel actually did.
 *
 * console.log is invisible from inside the app, which is precisely why an
 * OpenPhone billing failure went unnoticed until the provider emailed about it.
 * These rows are readable from the admin surface:
 *
 *   select created_at, level, message, details
 *   from public.system_logs
 *   where source = 'booking-notify'
 *   order by created_at desc;
 */
async function logNotification(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  entry: {
    organizationId: string;
    channel: "sms" | "email" | "push" | "bell";
    outcome: "sent" | "failed" | "skipped";
    bookingId: string;
    bookingNumber: string | number | null;
    detail?: string;
    // deno-lint-ignore no-explicit-any
    extra?: Record<string, any>;
  },
) {
  const level = entry.outcome === "failed" ? "error" : entry.outcome === "skipped" ? "warn" : "info";
  try {
    await supabase.from("system_logs").insert({
      level,
      source: "booking-notify",
      message: `Booking BK-${entry.bookingNumber ?? "?"} ${entry.channel} ${entry.outcome}`,
      organization_id: entry.organizationId,
      details: {
        channel: entry.channel,
        outcome: entry.outcome,
        booking_id: entry.bookingId,
        booking_number: entry.bookingNumber,
        detail: entry.detail ?? null,
        ...(entry.extra ?? {}),
      },
    });
  } catch (e) {
    // Logging must never break notification delivery, which must never break
    // the booking. Console is the last resort of the last resort.
    console.error("[booking-notify] Failed to write system_logs row:", e);
  }
}

async function runBookingNotifications(opts: {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  payload: BookingPayload;
  organizationId: string;
  // deno-lint-ignore no-explicit-any
  booking: any;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}): Promise<void> {
  const { supabase, payload, organizationId, booking } = opts;

  const { data: bizSettings } = await supabase
    .from('business_settings')
    .select('timezone')
    .eq('organization_id', organizationId)
    .maybeSingle();

  const orgTimezone = bizSettings?.timezone || "America/New_York";
  const bookingDate = new Date(payload.scheduled_at);
  const dateStr = new Intl.DateTimeFormat('en-US', { timeZone: orgTimezone, weekday: 'short', month: 'short', day: 'numeric' }).format(bookingDate);
  const timeStr = new Intl.DateTimeFormat('en-US', { timeZone: orgTimezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(bookingDate);

  const fullAddress = [payload.address, payload.city, payload.state, payload.zip_code]
    .filter(Boolean)
    .join(', ');

  // Bell + operator push always. Email only when push cannot land.
  // SMS only when this event's "Also text me" switch is on.
  const alertBody = `📋 New Online Booking #BK-${booking.booking_number}\n` +
    `Customer: ${payload.first_name} ${payload.last_name}\n` +
    `Service: ${payload.service_name || 'N/A'}\n` +
    `Date: ${dateStr} at ${timeStr}\n` +
    `Address: ${fullAddress || 'N/A'}\n` +
    `Total: $${payload.total_amount?.toFixed(2) || '0.00'}`;

  try {
    const owner = await notifyOwner(
      { supabase, organizationId, bookingId: booking.id },
      "booking.new",
      {
        title: `New booking #BK-${booking.booking_number}`,
        body: alertBody,
        link: "/dashboard/bookings",
      },
    );
    const logChannel = async (
      channel: "bell" | "push" | "sms" | "email",
      sent: boolean,
      reason: string | null,
    ) => {
      await logNotification(supabase, {
        organizationId,
        channel,
        outcome: sent ? "sent" : "skipped",
        bookingId: booking.id,
        bookingNumber: booking.booking_number,
        detail: sent ? undefined : (reason ?? undefined),
      });
    };
    await logChannel("bell", owner.bell, owner.deduped ? "Already sent" : null);
    await logChannel("push", owner.push, owner.push ? null : "Push not delivered");
    await logChannel("sms", owner.sms, owner.smsSkippedReason);
    await logChannel("email", owner.email, owner.emailSkippedReason);
  } catch (notifyErr) {
    const msg = notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
    console.error("[booking-notify] Owner alert threw:", msg);
    await logNotification(supabase, {
      organizationId, channel: "bell", outcome: "failed",
      bookingId: booking.id, bookingNumber: booking.booking_number,
      detail: msg.slice(0, 500),
    });
  }
}


import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { assertAssignedStaffEvent } from "../_shared/verify-staff-event.ts";
import { notifyOffice } from "../_shared/office-notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Keep in step with src/lib/usDistance.ts. Over ~0.25 miles is a far check-in.
const METERS_PER_MILE = 1609.344;
const FAR_CHECKIN_METERS = 0.25 * METERS_PER_MILE;

function formatMiles(meters: number): string {
  const miles = meters / METERS_PER_MILE;
  if (miles < 10) {
    const rounded = Math.round(miles * 10) / 10;
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${text} ${rounded === 1 ? "mile" : "miles"}`;
  }
  const whole = Math.round(miles);
  return `${whole.toLocaleString("en-US")} ${whole === 1 ? "mile" : "miles"}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const { bookingId, staffId } = await req.json() as { bookingId?: string; staffId?: string };
    if (!bookingId || !staffId) {
      return new Response(JSON.stringify({ error: "bookingId and staffId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, organization_id, booking_number")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError || !booking?.organization_id) {
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const auth = await assertAssignedStaffEvent(
      req,
      supabase,
      booking.organization_id,
      staffId,
      bookingId,
    );
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error }), {
        status: auth.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: checkins, error: checkinError } = await supabase
      .from("booking_checkins")
      .select("id, distance_meters")
      .eq("booking_id", bookingId)
      .eq("staff_id", staffId)
      .eq("checkin_type", "check_in")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);

    if (checkinError) throw checkinError;

    const latest = checkins?.[0];
    const meters = latest?.distance_meters;
    if (!latest || meters == null || meters <= FAR_CHECKIN_METERS) {
      return new Response(JSON.stringify({ flagged: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const distanceLabel = formatMiles(meters);
    const phrase = `Check-in far from property (${distanceLabel})`;
    const bookingLabel = booking.booking_number ? `Booking #${booking.booking_number}` : "A booking";

    const office = await notifyOffice(supabase, {
      organizationId: booking.organization_id,
      title: phrase,
      message: `${bookingLabel}: ${phrase}. The check-in was saved.`,
      link: "/dashboard/bookings",
      metadata: { booking_id: bookingId, staff_id: staffId, distance_meters: meters },
      dedupeKey: `far_checkin:${latest.id}`,
      pushTitle: phrase,
      pushBody: bookingLabel,
      pushData: { bookingId, kind: "far_checkin" },
    });

    return new Response(JSON.stringify({ flagged: true, bell: office.bell, push: office.push }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[flag-far-checkin]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

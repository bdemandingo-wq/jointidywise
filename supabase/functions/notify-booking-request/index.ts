import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyOwner } from "../_shared/owner-alert.ts";
import { verifyPortalSession } from "../_shared/portal-session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-portal-session, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface RequestBody {
  // organizationId comes from the verified portal session, not the body.
  customerName: string;
  requestedDate: string;
  serviceName?: string;
  notes?: string;
  /** client_booking_requests id, used to dedupe the owner alert. */
  requestId?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.error("[notify-booking-request] Missing backend configuration");
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Portal-only endpoint: caller must present a signed portal session.
    // Never trust org id from the body.
    const session = await verifyPortalSession(req, supabase);
    if (!session.ok) {
      return new Response(
        JSON.stringify({ success: false, error: session.error }),
        { status: session.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const organizationId = session.organization_id;

    const body: RequestBody = await req.json();
    const { customerName, requestedDate, serviceName, notes, requestId } = body;

    if (!customerName || !requestedDate) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: bizSettings, error: bizError } = await supabase
      .from("business_settings")
      .select("company_name, timezone")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (bizError) {
      console.warn("[notify-booking-request] business settings read failed, continuing:", bizError.message);
    }

    const companyName = bizSettings?.company_name || "Your Business";
    const orgTimezone = bizSettings?.timezone || "America/New_York";

    const dateObj = new Date(requestedDate);
    const formattedDate = new Intl.DateTimeFormat("en-US", {
      timeZone: orgTimezone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(dateObj);
    const formattedTime = new Intl.DateTimeFormat("en-US", {
      timeZone: orgTimezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(dateObj);

    let message = `📋 New Booking Request!\n\nCustomer: ${customerName}\nDate: ${formattedDate} at ${formattedTime}`;
    if (serviceName) message += `\nService: ${serviceName}`;
    if (notes) {
      const safeNotes = notes.substring(0, 100);
      message += `\nNotes: ${safeNotes}${notes.length > 100 ? "..." : ""}`;
    }
    message += `\n\nReview in ${companyName} dashboard.`;

    let scopedRequestId: string | undefined;
    if (requestId) {
      const { data: requestRow, error: requestError } = await supabase
        .from("client_booking_requests")
        .select("id, created_at")
        .eq("id", requestId)
        .eq("organization_id", organizationId)
        .eq("client_user_id", session.portal_user_id)
        .eq("customer_id", session.customer_id)
        .maybeSingle();
      const createdAt = requestRow?.created_at ? new Date(requestRow.created_at).getTime() : NaN;
      const ageMs = Date.now() - createdAt;
      const justCreated = Number.isFinite(ageMs) && ageMs >= -120_000 && ageMs <= 15 * 60_000;
      if (requestError || !requestRow || !justCreated) {
        console.warn("[notify-booking-request] requestId is not the request just created for this portal user");
      } else {
        scopedRequestId = requestRow.id;
      }
    }

    const owner = await notifyOwner(
      { supabase, organizationId, bookingId: scopedRequestId },
      "client.portal_request",
      {
        title: "New booking request",
        body: message,
        link: "/dashboard/client-portal",
      },
    );

    return new Response(
      JSON.stringify({ success: true, channels: owner }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[notify-booking-request] Error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

import { sendOpenPhoneMessage } from "../_shared/send-openphone.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ownerNewBookingSmsAllowed } from "../_shared/owner-notify-gates.ts";
import { verifyPortalSession } from "../_shared/portal-session.ts";
import { readOwnerChannels, type OwnerChannelReader } from "../_shared/read-owner-channels.ts";

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
}

const extractPhoneNumberId = (input: string): string => {
  const trimmed = (input || "").trim();
  const pnMatch = trimmed.match(/(PN[A-Za-z0-9]+)/);
  if (pnMatch) return pnMatch[1];
  const pathMatch = trimmed.match(/(?:phone-numbers|inbox)\/([A-Za-z0-9]+)$/);
  if (pathMatch) return pathMatch[1];
  return trimmed;
};

const formatE164US = (phone: string): string | null => {
  const raw = (phone || "").trim();
  if (!raw) return null;
  if (raw.startsWith("+")) return raw;

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
};

const deliverOpenPhone = async (payload: {
  apiKey: string;
  from: string;
  to: string;
  content: string;
  organizationId?: string | null;
}): Promise<Response> => {
  const authToken = payload.apiKey.trim().replace(/^Bearer\s+/i, "");

  // OpenPhone auth varies across tokens; try raw token first, then Bearer fallback on 401.
  const doSend = (authHeader: string) =>
    sendOpenPhoneMessage( {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        from: payload.from,
        to: [payload.to],
        content: payload.content,
      }),
      organizationId: payload.organizationId,
    });

  let resp = await doSend(authToken);
  if (resp.status === 401) {
    // Consume body before retry
    await resp.text();
    resp = await doSend(`Bearer ${authToken}`);
  }
  return resp;
};

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
    const { customerName, requestedDate, serviceName, notes } = body;

    if (!customerName || !requestedDate) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: smsSettings, error: smsError } = await supabase
      .from("organization_sms_settings")
      .select("openphone_api_key, openphone_phone_number_id, sms_enabled")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (smsError) {
      console.error("[notify-booking-request] Failed to load SMS settings:", smsError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to load SMS settings" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!smsSettings || !smsSettings.sms_enabled) {
      console.log("[notify-booking-request] SMS not enabled for org:", organizationId);
      return new Response(
        JSON.stringify({ success: true, message: "SMS not enabled - skipping" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = (smsSettings.openphone_api_key || "").trim();
    const phoneNumberId = extractPhoneNumberId(smsSettings.openphone_phone_number_id || "");

    if (!apiKey || !phoneNumberId) {
      console.log("[notify-booking-request] Missing OpenPhone credentials for org:", organizationId);
      return new Response(
        JSON.stringify({ success: true, message: "SMS not configured - skipping" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: bizSettings, error: bizError } = await supabase
      .from("business_settings")
      .select("company_phone, company_name, notify_new_booking, timezone")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (bizError) {
      console.error("[notify-booking-request] Failed to load business settings:", bizError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to load admin phone" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // This function texts the owner only. Customer confirmation SMS is elsewhere.
    const prefs = await readOwnerChannels(supabase as unknown as OwnerChannelReader, organizationId);
    if (prefs.error) {
      console.warn("[notify-booking-request] prefs read failed, SMS master stays on:", prefs.error);
    }
    const decision = ownerNewBookingSmsAllowed({
      notifyNewBooking: bizSettings?.notify_new_booking,
      channels: prefs.channels,
    });
    if (!decision.allowed) {
      console.log("[notify-booking-request] Owner SMS skipped:", decision.reason, organizationId);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: decision.reason, message: "Owner booking SMS disabled - skipping" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminPhone = formatE164US(bizSettings?.company_phone || "");
    if (!adminPhone) {
      console.log("[notify-booking-request] No valid admin phone configured for org:", organizationId);
      return new Response(
        JSON.stringify({ success: false, error: "No admin phone configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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

    const openPhoneResponse = await deliverOpenPhone({
      organizationId: organizationId,
      apiKey,
      from: phoneNumberId,
      to: adminPhone,
      content: message,
    });

    if (!openPhoneResponse.ok) {
      const errorText = await openPhoneResponse.text();
      console.error("[notify-booking-request] OpenPhone API error:", errorText);

      if (openPhoneResponse.status === 401) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Invalid OpenPhone API key. Please update your SMS settings.",
            errorCode: "AUTH_FAILED",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: false, error: "Failed to send SMS" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[notify-booking-request] SMS notification sent successfully");
    await openPhoneResponse.text();

    return new Response(
      JSON.stringify({ success: true }),
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
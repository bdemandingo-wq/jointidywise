import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyOwner } from "../_shared/owner-alert.ts";
import { verifyOrgAccess } from "../_shared/verify-org-access.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AdminNotificationRequest {
  customerName: string;
  serviceName: string;
  scheduledAt: string;
  formattedDate?: string; // Pre-formatted date from client
  formattedTime?: string; // Pre-formatted time from client
  totalAmount: number;
  address?: string;
  organizationId: string;
  bookingId?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[send-admin-sms-notification] Missing Supabase configuration");
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
      totalAmount,
      address,
      organizationId,
      bookingId,
    }: AdminNotificationRequest = await req.json();

    if (!organizationId) {
      console.error("[send-admin-sms-notification] Missing organizationId");
      return new Response(
        JSON.stringify({ success: false, error: "Missing organizationId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const auth = await verifyOrgAccess(req, organizationId);
    if (!auth.ok) {
      return new Response(
        JSON.stringify({ success: false, error: auth.error }),
        { status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }


    console.log("[send-admin-sms-notification] Processing notification for org:", organizationId);

    const { data: businessSettings, error: businessError } = await supabase
      .from('business_settings')
      .select('timezone')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (businessError) {
      console.warn("[send-admin-sms-notification] timezone read failed, using Eastern:", businessError.message);
    }

    // Use pre-formatted date/time if provided, otherwise fall back to parsing (for backwards compatibility)
    let formattedDate: string;
    let formattedTime: string;
    
    if (preFormattedDate && preFormattedTime) {
      formattedDate = preFormattedDate;
      formattedTime = preFormattedTime;
    } else {
      // Fallback: format in org timezone from business_settings
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

    // Build admin notification message
    const message = `🆕 NEW BOOKING!\n\n` +
      `Customer: ${customerName}\n` +
      `Service: ${serviceName}\n` +
      `Date: ${formattedDate} at ${formattedTime}\n` +
      `${address ? `Address: ${address}\n` : ''}` +
      `Total: $${totalAmount.toFixed(2)}\n\n` +
      `Log in to your dashboard to view details.`;

    const owner = await notifyOwner(
      { supabase, organizationId, bookingId },
      "booking.new",
      {
        title: "New booking",
        body: message,
        link: "/dashboard/bookings",
      },
    );

    return new Response(
      JSON.stringify({ success: true, channels: owner }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[send-admin-sms-notification] Error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { platformAdminPhones } from "../_shared/platform-admin-phones.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ADMIN_PHONES = platformAdminPhones();

interface NotifyAdminRequest {
  organizationId: string;
  organizationName: string;
  ownerEmail?: string;
  subscriptionType?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SECURITY: service-role only. This endpoint blasts SMS to platform admins,
  // so it must only be reachable from trusted server-to-server callers
  // (e.g. the Stripe webhook edge function) that carry the service role JWT.
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!serviceKey || !bearer || bearer !== serviceKey) {
    console.warn("[notify-platform-admin-subscription] Rejected non-service-role call");
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const { organizationId, organizationName, ownerEmail, subscriptionType } = await req.json() as NotifyAdminRequest;

    if (!organizationId || !organizationName) {
      console.error("[notify-platform-admin-subscription] Missing required fields");
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use platform-level OpenPhone settings (from secrets)
    const openphoneApiKey = Deno.env.get("OPENPHONE_API_KEY");
    const openphonePhoneNumberId = Deno.env.get("OPENPHONE_PHONE_NUMBER_ID");

    if (!openphoneApiKey || !openphonePhoneNumberId) {
      console.log("[notify-platform-admin-subscription] OpenPhone not configured at platform level");
      return new Response(
        JSON.stringify({ success: false, error: "Platform SMS not configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    });

    const message = `🎉 NEW SUBSCRIPTION!\n\n` +
      `Business: ${organizationName}\n` +
      `Email: ${ownerEmail || 'N/A'}\n` +
      `Plan: ${subscriptionType || 'Standard'}\n` +
      `Time: ${timestamp}\n\n` +
      `View in admin panel.`;

    const response = await fetch("https://api.openphone.com/v1/messages", {
      method: "POST",
      headers: {
        "Authorization": openphoneApiKey.startsWith('Bearer ') ? openphoneApiKey : `Bearer ${openphoneApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: openphonePhoneNumberId,
        to: ADMIN_PHONES,
        content: message,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[notify-platform-admin-subscription] OpenPhone API error: ${response.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to send SMS" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    console.log(`[notify-platform-admin-subscription] SMS sent successfully:`, result?.data?.id);

    return new Response(
      JSON.stringify({ success: true, messageId: result.data?.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[notify-platform-admin-subscription] Error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);

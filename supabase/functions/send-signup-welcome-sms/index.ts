import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOpenPhoneMessage, TIDYWISE_PLATFORM_ORG_ID } from "../_shared/send-sms.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SignupWelcomeSmsRequest {
  fullName?: string;
}

function normalizePhone(raw: string): string {
  let p = raw.replace(/\D/g, '');
  if (p.length === 10) p = `1${p}`;
  return `+${p}`;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // SECURITY: require an authenticated user. Destination phone is looked up
    // from the caller's own profile — never taken from the request body — so
    // this endpoint can't be abused to SMS arbitrary numbers.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const token = authHeader.slice(7).trim();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = userData.user.id;

    // Pull the phone from the user's own profile — do NOT trust body input.
    const { data: profile } = await admin
      .from("profiles")
      .select("phone, full_name")
      .eq("id", userId)
      .maybeSingle();

    const rawPhone = (profile?.phone ?? "").toString().trim();
    if (!rawPhone) {
      return new Response(
        JSON.stringify({ success: false, error: "No phone on profile" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const formattedPhone = normalizePhone(rawPhone);

    const apiKey = Deno.env.get("OPENPHONE_API_KEY");
    const phoneNumberId = Deno.env.get("OPENPHONE_PHONE_NUMBER_ID");
    if (!apiKey || !phoneNumberId) {
      console.error("[send-signup-welcome-sms] Missing platform OpenPhone credentials");
      return new Response(
        JSON.stringify({ success: false, error: "SMS service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let extractedPhoneNumberId = phoneNumberId;
    if (phoneNumberId.includes('openphone.com')) {
      const match = phoneNumberId.match(/phone-numbers\/([A-Za-z0-9]+)/);
      if (match) extractedPhoneNumberId = match[1];
    }

    const body = (await req.json().catch(() => ({}))) as SignupWelcomeSmsRequest;
    const fullName = (body.fullName || profile?.full_name || "").toString().trim();
    const greeting = fullName ? `Hi ${fullName}! ` : "Hi! ";
    const message = `${greeting}Welcome to TidyWise! 🎉

Your account is ready! Here's what you can do:

📅 Easy online booking & scheduling
💳 Accept payments & invoicing
👥 Manage staff & payroll
📊 Track customers & revenue
📱 Send automated reminders

Complete your setup to start managing your cleaning business like a pro. Questions? Reply to this text!`;

    console.log(`[send-signup-welcome-sms] Sending to user ${userId} at ${formattedPhone}`);

    const sent = await sendOpenPhoneMessage({
      supabase: admin,
      organizationId: TIDYWISE_PLATFORM_ORG_ID,
      to: formattedPhone,
      content: message,
      from: extractedPhoneNumberId,
      apiKey,
      tag: "send-signup-welcome-sms",
    });
    if (sent.skipped) {
      return new Response(
        JSON.stringify({ success: false, skipped: true, reason: "opted_out" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const response = sent.response;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[send-signup-welcome-sms] OpenPhone API error: ${response.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ success: false, error: `SMS failed but signup continues` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    return new Response(
      JSON.stringify({ success: true, messageId: result.data?.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[send-signup-welcome-sms] Error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);

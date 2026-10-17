import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { renderCrmEmail } from "../_shared/crm-email/render.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface WelcomeEmailRequest {
  email: string;
  fullName?: string;
  userId?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!RESEND_API_KEY) {
    console.error("[send-welcome-email] Missing RESEND_API_KEY secret");
    return new Response(JSON.stringify({ error: "Email service is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const { email, fullName, userId } = (await req.json()) as WelcomeEmailRequest;

    if (!email) {
      return new Response(JSON.stringify({ error: "Missing email" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    console.log("[send-welcome-email] Sending welcome email to:", email);

    // Welcome emails for new signups come from the public support inbox.
    // jointidywise.com is the verified Resend domain.
    const TIDYWISE_DEFAULT_EMAIL = tidywiseSupportEmail();
    const TIDYWISE_DEFAULT_NAME = "TidyWise";

    const senderEmail = TIDYWISE_DEFAULT_EMAIL;
    const companyName = TIDYWISE_DEFAULT_NAME;

    const userName = fullName || email.split('@')[0];
    const welcome = renderCrmEmail("welcome", {
      vars: {
        userName,
        companyName,
        APP_URL: Deno.env.get("APP_URL") || "https://jointidywise.com",
      },
    });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `${companyName} <${senderEmail}>`,
        reply_to: senderEmail,
        to: [email],
        subject: `Welcome to ${companyName}! 🎉`,
        html: welcome.html,
        text: welcome.text,
      }),
    });

    let data: any = null;
    try {
      data = await res.json();
    } catch (_e) {
      data = null;
    }

    if (!res.ok && data?.name === 'validation_error' && data?.message?.includes('not verified')) {
      const domain = senderEmail.split('@')[1];
      console.error(`[send-welcome-email] Domain ${domain} is not verified on Resend`);
      throw new Error(`Email domain (${domain}) is not verified. Please verify it at https://resend.com/domains`);
    }

    if (!res.ok) {
      console.error("[send-welcome-email] Resend API error:", { status: res.status, data });
      throw new Error(data?.message || `Failed to send welcome email (status ${res.status})`);
    }

    console.log("[send-welcome-email] Welcome email sent successfully:", data?.id);

    return new Response(JSON.stringify({ success: true, emailId: data?.id }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("[send-welcome-email] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { requireOrgAdmin } from "../_shared/requireOrgAdmin.ts";
import { sendOrgEmail } from "../_shared/send-org-email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const APP_URL = Deno.env.get("APP_URL") || "https://jointidywise.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Channel = "sms" | "email";

interface CardLinkRequest {
  email?: string;
  phone?: string;
  customerName: string;
  organizationId: string;
  channel?: Channel;
}

function generateShortCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function formatE164(phone: string): string {
  let p = phone.replace(/\D/g, "");
  if (!p.startsWith("1") && p.length === 10) p = "1" + p;
  return "+" + p;
}

async function sendViaOpenPhone(params: {
  supabase: any;
  organizationId: string;
  phone: string;
  message: string;
}): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string; code: string }> {
  const { supabase, organizationId, phone, message } = params;

  const { data: smsSettings, error: smsError } = await supabase
    .from("organization_sms_settings")
    .select("openphone_api_key, openphone_phone_number_id, sms_enabled")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (smsError) return { ok: false, code: "sms_settings_fetch_failed", error: smsError.message };
  if (!smsSettings || !smsSettings.sms_enabled)
    return { ok: false, code: "sms_disabled", error: "SMS is not enabled for this organization." };
  if (!smsSettings.openphone_api_key || !smsSettings.openphone_phone_number_id)
    return { ok: false, code: "sms_not_configured", error: "OpenPhone API key or phone number not configured." };

  let phoneNumberId = smsSettings.openphone_phone_number_id as string;
  if (phoneNumberId.includes("openphone.com")) {
    const match = phoneNumberId.match(/PN[a-zA-Z0-9]+/);
    if (!match) return { ok: false, code: "sms_bad_phone_id", error: "Invalid OpenPhone phone number ID format." };
    phoneNumberId = match[0];
  }

  const authHeader = smsSettings.openphone_api_key.trim().replace(/^Bearer\s+/i, "");
  const res = await fetch("https://api.openphone.com/v1/messages", {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ content: message, from: phoneNumberId, to: [formatE164(phone)] }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[send-card-collection-link] OpenPhone error", res.status, text);
    if (res.status === 402) return { ok: false, code: "sms_billing_required", error: "SMS service requires payment on the OpenPhone account." };
    if (res.status === 401) return { ok: false, code: "sms_auth_failed", error: "Invalid OpenPhone API key." };
    return { ok: false, code: "sms_send_failed", error: `OpenPhone send failed (${res.status})` };
  }
  const body = await res.json();
  return { ok: true, messageId: body?.data?.id ?? null };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: CardLinkRequest = await req.json();
    const { email, phone, customerName, organizationId } = body;
    const requestedChannel: Channel | undefined = body.channel;

    if (!customerName) {
      return new Response(JSON.stringify({ error: "Customer name is required" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    if (!organizationId) {
      return new Response(JSON.stringify({ error: "Missing organizationId - organization context is required" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    if (!phone && !email) {
      return new Response(JSON.stringify({ error: "A phone number or email is required" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Default channel: SMS if phone is present, otherwise email
    const channel: Channel = requestedChannel ?? (phone ? "sms" : "email");
    if (channel === "sms" && !phone) {
      return new Response(JSON.stringify({ error: "Phone number is required to send via SMS" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    if (channel === "email" && !email) {
      return new Response(JSON.stringify({ error: "Email is required to send via email" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const auth = await requireOrgAdmin(req, organizationId);
    if (auth instanceof Response) return auth;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Database connection not configured" }), {
        status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Business settings (used for both channels)
    const { data: settings } = await supabase
      .from("business_settings")
      .select("company_email, company_name")
      .eq("organization_id", organizationId)
      .maybeSingle();

    const companyName = settings?.company_name || "Your cleaning service";
    const senderEmail = settings?.company_email || "";

    // Stripe setup (shared across channels)
    const { data: secretRows } = await supabase.rpc("get_org_stripe_secret", { p_org_id: organizationId });
    const orgSecret = Array.isArray(secretRows) ? secretRows[0] : secretRows;
    const stripeSecretKey: string | null = orgSecret?.stripe_access_token || orgSecret?.stripe_secret_key || null;
    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured for this organization. Please connect your Stripe account in Settings → Payments." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-08-27.basil" });

    // Find or create Stripe customer scoped to organization
    let customerId: string;
    if (email) {
      const customers = await stripe.customers.list({ email, limit: 100 });
      const orgCustomer = customers.data.find((c: any) => c.metadata?.organization_id === organizationId);
      if (orgCustomer) customerId = orgCustomer.id;
      else {
        const created = await stripe.customers.create({
          email, name: customerName, phone: phone || undefined,
          metadata: { organization_id: organizationId },
        });
        customerId = created.id;
      }
    } else {
      const created = await stripe.customers.create({
        name: customerName, phone: phone!,
        metadata: { organization_id: organizationId },
      });
      customerId = created.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "setup",
      payment_method_types: ["card"],
      success_url: `${APP_URL}/card-saved?success=true`,
      cancel_url: `${APP_URL}/card-saved?cancelled=true`,
      metadata: {
        customerName, purpose: "card_collection", organizationId,
      },
    });

    // Prefer a short URL for SMS; email uses the full URL
    let shortLink = session.url as string;
    const shortCode = generateShortCode();
    const { error: shortErr } = await supabase.from("short_urls").insert({
      code: shortCode, target_url: session.url, organization_id: organizationId,
    });
    if (!shortErr) shortLink = `${APP_URL}/c/${shortCode}`;

    const smsMessage = `${companyName}: Add your card on file (not charged now): ${shortLink}`;

    // Try SMS first when requested; fall back to email on failure if email available
    let deliveredVia: Channel | null = null;
    let smsError: { code: string; error: string } | null = null;
    let emailId: string | null = null;
    let smsMessageId: string | null = null;

    if (channel === "sms") {
      const smsResult = await sendViaOpenPhone({
        supabase, organizationId, phone: phone!, message: smsMessage,
      });
      if (smsResult.ok) {
        deliveredVia = "sms";
        smsMessageId = smsResult.messageId;
      } else {
        smsError = { code: smsResult.code, error: smsResult.error };
        console.warn("[send-card-collection-link] SMS failed, will try email fallback:", smsError);
      }
    }

    if (!deliveredVia && (channel === "email" || (channel === "sms" && email))) {
      // Email path (primary or fallback) — routed through per-org sender (Gmail SMTP or Resend)
      const emailResult = await sendOrgEmail({
        templateName: "card_collection_link",
        organizationId,
        to: email!,
        subject: `Add Your Payment Card - ${companyName}`,
        html: `
          <!DOCTYPE html><html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;margin:0;padding:0;">
            <div style="max-width:600px;margin:0 auto;padding:20px;">
              <div style="background:linear-gradient(135deg,#10b981,#059669);color:white;padding:30px;text-align:center;border-radius:10px 10px 0 0;">
                <h1 style="margin:0;">🔒 Secure Card Setup</h1>
              </div>
              <div style="background:#f9fafb;padding:30px;border-radius:0 0 10px 10px;">
                <p>Hi ${customerName},</p>
                <p>We need your payment card on file to complete your booking with ${companyName}.</p>
                <div style="background:white;padding:20px;border-radius:8px;margin:20px 0;border-left:4px solid #10b981;">
                  <p><strong>Why do we need this?</strong></p>
                  <p style="margin:0;color:#666;">Your card will be securely saved for your upcoming service. You won't be charged until after your service is completed.</p>
                </div>
                <div style="text-align:center;">
                  <a href="${session.url}" style="display:inline-block;background:#10b981;color:white;padding:15px 40px;text-decoration:none;border-radius:8px;font-weight:bold;margin:20px 0;">Add My Card Securely</a>
                </div>
                <p style="text-align:center;color:#666;font-size:14px;">🔒 Secured by Stripe — Bank-level encryption</p>
                <p style="color:#666;font-size:14px;margin-top:20px;">This link will expire in 24 hours.</p>
              </div>
              <div style="text-align:center;color:#666;font-size:12px;margin-top:20px;">
                <p>&copy; ${new Date().getFullYear()} ${companyName}. All rights reserved.</p>
              </div>
            </div>
          </body></html>
        `,
      });
      if (!emailResult.success) {
        return new Response(
          JSON.stringify({
            error: smsError
              ? `SMS failed (${smsError.error}) and email fallback also failed: ${emailResult.error}`
              : `Email send failed: ${emailResult.error}`,
            smsError,
          }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      deliveredVia = "email";
      emailId = emailResult.id ?? null;
    }

    if (!deliveredVia) {
      return new Response(
        JSON.stringify({
          error: smsError ? `SMS failed: ${smsError.error}. No email on file to fall back to.` : "Delivery failed",
          smsError,
        }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Audit log (best-effort)
    try {
      await supabase.from("sms_send_log").insert({
        organization_id: organizationId,
        admin_user_id: auth.user.id,
        sms_type: "card_link",
        customer_phone: phone || null,
        status: deliveredVia === "sms" ? "sent" : "fallback_email",
        details: { channel: deliveredVia, requested_channel: channel, openphone_message_id: smsMessageId, email_id: emailId, sms_error: smsError },
      });
    } catch (logErr) {
      console.warn("sms_send_log insert failed:", logErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        deliveredVia,
        fellBackToEmail: channel === "sms" && deliveredVia === "email",
        smsError,
        sessionUrl: session.url,
        emailId,
        smsMessageId,
        message: deliveredVia === "sms"
          ? "Card collection link sent via SMS"
          : (channel === "sms" ? "SMS unavailable — link sent via email instead" : "Card collection link sent via email"),
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-card-collection-link function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);

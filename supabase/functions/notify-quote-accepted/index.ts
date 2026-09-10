// Fires when an admin marks a quote as accepted.
// Sends the CUSTOMER:
//   1. Email — "Your quote is approved, your service is booked"
//   2. SMS  — same, short form (if phone on file + OpenPhone configured)
// Org-scoped: uses organization_email_settings + organization_sms_settings.
// Non-fatal: failures are logged but don't block the accept action.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOrgEmail } from "../_shared/send-org-email.ts";
import { resolveCallerOrg } from "../_shared/require-caller-org.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface Body {
  organization_id: string;
  quote_id: string;
  quote_number?: string | number | null;
  booking_number?: string | number | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  total_amount?: number | null;
  scheduled_at?: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body.quote_id) {
      return new Response(JSON.stringify({ error: "quote_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SECURITY: never trust organization_id from the request body — resolve
    // it from the caller's own JWT + org_memberships instead.
    const callerOrg = await resolveCallerOrg(req, body.organization_id ?? null);
    if (!callerOrg.ok) {
      return new Response(JSON.stringify({ error: callerOrg.error }), {
        status: callerOrg.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    body.organization_id = callerOrg.ctx.organizationId;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Look up org branding for sender name
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", body.organization_id)
      .maybeSingle();
    const orgName = org?.name || "Your cleaning team";

    const firstName = (body.customer_name?.split(" ")[0] || "there").trim();
    const quoteLabel = body.quote_number ? `#${body.quote_number}` : "";
    const totalDisplay = typeof body.total_amount === "number"
      ? `$${body.total_amount.toFixed(2)}`
      : null;

    // ── Customer email ────────────────────────────────────────────────────
    if (body.customer_email) {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1a1a1a; margin: 0 0 12px;">Your quote ${escapeHtml(String(quoteLabel))} is approved 🎉</h2>
          <p style="color: #333; line-height: 1.6;">
            Hi ${escapeHtml(firstName)}, great news — we've approved your quote
            ${quoteLabel ? `(${escapeHtml(String(quoteLabel))})` : ""} and your
            service is now booked with <strong>${escapeHtml(orgName)}</strong>.
          </p>
          ${totalDisplay ? `<p style="color: #333;"><strong>Total:</strong> ${escapeHtml(totalDisplay)}</p>` : ""}
          ${body.booking_number ? `<p style="color: #333;"><strong>Booking #:</strong> ${escapeHtml(String(body.booking_number))}</p>` : ""}
          <p style="color: #333; line-height: 1.6;">
            We'll be in touch shortly with the exact arrival time. If you have
            any questions, just reply to this email.
          </p>
          <p style="color: #555; margin-top: 24px;">— ${escapeHtml(orgName)}</p>
        </div>`;
      try {
        await sendOrgEmail({
          templateName: "quote_accepted",
          organizationId: body.organization_id,
          to: body.customer_email,
          subject: `Quote ${quoteLabel} approved — your service is booked`,
          html,
        });
      } catch (err) {
        console.error("[notify-quote-accepted] email failed:", err);
      }
    }

    // ── Customer SMS ──────────────────────────────────────────────────────
    if (body.customer_phone) {
      const { data: sms } = await supabase
        .from("organization_sms_settings")
        .select("openphone_api_key, openphone_phone_number_id")
        .eq("organization_id", body.organization_id)
        .maybeSingle();

      if (sms?.openphone_api_key && sms?.openphone_phone_number_id) {
        let phoneNumberId = sms.openphone_phone_number_id;
        if (phoneNumberId.includes("openphone.com")) {
          const m = phoneNumberId.match(/phone-numbers\/([A-Za-z0-9]+)/);
          if (m) phoneNumberId = m[1];
        }
        const auth = sms.openphone_api_key.trim().replace(/^Bearer\s+/i, "");
        const to = body.customer_phone.startsWith("+")
          ? body.customer_phone
          : `+1${body.customer_phone.replace(/\D/g, "")}`;
        const msg = `Hi ${firstName}, your quote ${quoteLabel} with ${orgName} is approved — your service is booked${totalDisplay ? ` (${totalDisplay})` : ""}. We'll follow up shortly with timing.`;
        try {
          await fetch("https://api.openphone.com/v1/messages", {
            method: "POST",
            headers: { Authorization: auth, "Content-Type": "application/json" },
            body: JSON.stringify({ from: phoneNumberId, to: [to], content: msg }),
          });
        } catch (err) {
          console.error("[notify-quote-accepted] SMS failed:", err);
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[notify-quote-accepted] error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

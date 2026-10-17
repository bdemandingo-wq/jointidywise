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
import { sendOpenPhoneMessage } from "../_shared/send-sms.ts";
import { renderCrmEmail, orgBrandVars } from "../_shared/crm-email/render.ts";
import { loadLooseBrand } from "../_shared/org-email-renderer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
      const brand = await loadLooseBrand(body.organization_id);
      const rendered = renderCrmEmail("quote-approved", {
        vars: {
          ...orgBrandVars(brand),
          orgName,
          quoteLabel,
          booking_number: body.booking_number != null && body.booking_number !== ""
            ? String(body.booking_number)
            : "",
          firstName,
          totalDisplay: totalDisplay || "",
        },
        rawKeys: ["email_footer"],
      });
      try {
        await sendOrgEmail({
          templateName: "quote_accepted",
          organizationId: body.organization_id,
          to: body.customer_email,
          subject: `Quote ${quoteLabel} approved — your service is booked`,
          html: rendered.html,
          text: rendered.text,
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
          const sent = await sendOpenPhoneMessage({
            supabase,
            organizationId: body.organization_id,
            to,
            content: msg,
            from: phoneNumberId,
            apiKey: auth,
            tag: "notify-quote-accepted",
          });
          if (sent.skipped) {
            console.log(`[notify-quote-accepted] SMS skipped opted_out org=${body.organization_id}`);
          } else if (!sent.response.ok) {
            console.error(
              `[notify-quote-accepted] SMS failed:`,
              sent.response.status,
              await sent.response.text(),
            );
          }
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

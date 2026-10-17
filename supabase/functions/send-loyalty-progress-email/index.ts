import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrgEmailSettings, formatEmailFrom } from "../_shared/get-org-email-settings.ts";
import { isServiceRoleRequest } from "../_shared/require-caller-org.ts";
import { renderCrmEmail, orgBrandVars, UNSUBSCRIBE_URL_SENTINEL } from "../_shared/crm-email/render.ts";
import { loadLooseBrand } from "../_shared/org-email-renderer.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LoyaltyProgressRequest {
  customerEmail: string;
  customerName: string;
  pointsEarned: number;
  totalPoints: number;
  lifetimePoints: number;
  currentTier: string;
  nextTier: string | null;
  pointsToNextTier: number | null;
  bookingNumber: string;
  organizationId: string; // REQUIRED - no fallback allowed
}

function tierMinLabel(value: unknown): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  // min_spending is lifetime dollars. The column header is "Spend" and the
  // cell is `$` + this number + `+`.
  const num = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return num.replace(/^\$/, "");
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set");
    return new Response(
      JSON.stringify({ error: "Email service not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // SECURITY: no frontend or edge function currently calls this — internal
  // only until a caller is wired up, and that caller must send this org's
  // own organizationId, verified server-side, not trust it blind.
  if (!isServiceRoleRequest(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const {
      customerEmail,
      customerName,
      pointsEarned,
      totalPoints,
      lifetimePoints,
      currentTier,
      bookingNumber,
      organizationId,
    }: LoyaltyProgressRequest = await req.json();

    if (!customerEmail) {
      return new Response(
        JSON.stringify({ error: "Customer email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // CRITICAL: organizationId is REQUIRED for multi-tenant isolation
    if (!organizationId) {
      console.error("Missing organizationId - cannot send loyalty email without organization context");
      return new Response(JSON.stringify({ 
        error: "Missing organizationId - organization context is required" 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Fetch email settings from organization_email_settings table (SINGLE SOURCE OF TRUTH)
    const emailSettingsResult = await getOrgEmailSettings(organizationId);
    
    if (!emailSettingsResult.success || !emailSettingsResult.settings) {
      console.error("Failed to get email settings:", emailSettingsResult.error);
      return new Response(JSON.stringify({ 
        error: emailSettingsResult.error || "Email settings not configured" 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const emailSettings = emailSettingsResult.settings;
    const senderEmail = emailSettings.from_email;
    const companyName = emailSettings.from_name;
    const resendApiKey = emailSettings.resend_api_key || RESEND_API_KEY;
    console.log("Using organization settings - sender:", senderEmail, "company:", companyName);

    const brand = await loadLooseBrand(organizationId);
    let tierRows: Array<Record<string, string>> = [];
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: tierSettings, error: tierErr } = await supabase
        .from("client_tier_settings")
        .select("tier_name, min_spending, tier_order")
        .eq("organization_id", organizationId)
        .order("tier_order", { ascending: true });
      if (tierErr) {
        console.error("[send-loyalty-progress-email] tier lookup failed:", tierErr);
      } else if (tierSettings && tierSettings.length > 0) {
        tierRows = tierSettings.map((tier) => ({
          "tier.name": String(tier.tier_name ?? ""),
          "tier.min": tierMinLabel(tier.min_spending),
        }));
      }
    }
    // No org ladder: drop the sample row. A blank minimum renders as a lone
    // "+" because the design appends that character. currentTier still shows.

    const rendered = renderCrmEmail("loyalty-progress", {
      vars: {
        ...orgBrandVars(brand),
        ...(companyName ? { companyName } : {}),
        customerName: customerName || "",
        pointsEarned,
        totalPoints,
        lifetimePoints,
        currentTier: currentTier || "",
        bookingNumber: bookingNumber || "",
        UNSUBSCRIBE_URL: UNSUBSCRIBE_URL_SENTINEL,
      },
      repeats: [{ prefix: "tier.", rows: tierRows }],
      rawKeys: ["email_footer"],
    });

    const { sendOrgEmail } = await import("../_shared/send-org-email.ts");
    const sendResult = await sendOrgEmail({
      templateName: "loyalty_progress",
      marketing: true,
      organizationId,
      to: customerEmail,
      subject: `🎉 You earned ${pointsEarned} loyalty points!`,
      html: rendered.html,
      text: rendered.text,
    });
    if (!sendResult.success) {
      if (/not verified/i.test(sendResult.error || "")) {
        const domain = senderEmail.split('@')[1];
        throw new Error(`Your email domain (${domain}) is not verified. Please verify it to send emails.`);
      }
      return new Response(
        JSON.stringify({ error: sendResult.error || "Failed to send email" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const data = { id: sendResult.id, method: sendResult.method };


    return new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in send-loyalty-progress-email:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrgEmailSettings, formatEmailFrom, getReplyTo } from "../_shared/get-org-email-settings.ts";
import { resolveCallerOrg } from "../_shared/require-caller-org.ts";
import { renderCrmEmail, orgBrandVars, UNSUBSCRIBE_URL_SENTINEL } from "../_shared/crm-email/render.ts";
import { loadLooseBrand } from "../_shared/org-email-renderer.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReviewRequestPayload {
  bookingId: string;
  customerId: string;
  customerEmail: string;
  customerName: string;
  serviceName: string;
  googleReviewUrl?: string;
  organizationId: string; // REQUIRED - no fallback allowed
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!RESEND_API_KEY) {
    console.warn("Review request skipped: RESEND_API_KEY is not set");
    return new Response(JSON.stringify({
      success: false,
      skipped: true,
      reason: "email_not_configured",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const payload: ReviewRequestPayload = await req.json();
    const { bookingId, customerId, customerEmail, customerName, serviceName, googleReviewUrl } = payload;

    if (!customerEmail || !bookingId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // SECURITY: never trust organizationId from the request body — resolve it
    // from the caller's own JWT + org_memberships/staff record instead
    // (this function is called from both the admin dashboard and the staff
    // portal's "request a review" action).
    const callerOrg = await resolveCallerOrg(req, payload.organizationId ?? null);
    if (!callerOrg.ok) {
      return new Response(JSON.stringify({ error: callerOrg.error }), {
        status: callerOrg.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const organizationId = callerOrg.ctx.organizationId;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Fetch email settings from organization_email_settings table (SINGLE SOURCE OF TRUTH)
    const emailSettingsResult = await getOrgEmailSettings(organizationId);
    
    if (!emailSettingsResult.success || !emailSettingsResult.settings) {
      console.warn("Review request skipped:", emailSettingsResult.error || "Email settings not configured");
      return new Response(JSON.stringify({
        success: false,
        skipped: true,
        reason: "email_not_configured",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const emailSettings = emailSettingsResult.settings;
    const companyName = emailSettings.from_name;
    
    console.log("Using org email settings - from:", emailSettings.from_email, "name:", companyName);
    
    // Get Google review URL and org-specific app URL from business_settings
    const { data: businessSettings } = await supabase
      .from('business_settings')
      .select('google_review_url, app_url')
      .eq('organization_id', organizationId)
      .maybeSingle();
    
    // Generate unique token for this review request
    const token = crypto.randomUUID();
    
    // Use org-specific app URL, fallback to global PROJECT_URL
    const projectUrl = (businessSettings?.app_url || Deno.env.get("APP_URL") || Deno.env.get("PROJECT_URL") || "https://jointidywise.com").replace(/\/+$/, '');
    const reviewPageUrl = `${projectUrl}/review/${token}`;

    // Get staff_id from booking to associate review with cleaner
    const { data: bookingData } = await supabase
      .from("bookings")
      .select("staff_id")
      .eq("id", bookingId)
      .single();

    // Get default Google review URL from business settings if not provided
    let finalGoogleUrl = googleReviewUrl;
    if (!finalGoogleUrl && businessSettings?.google_review_url) {
      finalGoogleUrl = businessSettings.google_review_url;
    }

    // Completing the job again must not email the customer a second time.
    const { data: existingReview, error: existingReviewError } = await supabase
      .from("review_requests")
      .select("id")
      .eq("booking_id", bookingId)
      .limit(1);
    if (existingReviewError) {
      console.error("Failed to check existing review request:", existingReviewError);
    } else if (existingReview && existingReview.length > 0) {
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        reason: "already_sent",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Create review request record
    const { error: insertError } = await supabase
      .from("review_requests")
      .insert({
        booking_id: bookingId,
        customer_id: customerId,
        staff_id: bookingData?.staff_id || null,
        status: "sent",
        sent_at: new Date().toISOString(),
        review_link_token: token,
        google_review_url: finalGoogleUrl,
      });

    if (insertError) {
      const duplicate = (insertError as { code?: string }).code === "23505";
      if (duplicate) {
        return new Response(JSON.stringify({
          success: true,
          skipped: true,
          reason: "already_sent",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      console.error("Failed to create review request:", insertError);
      throw new Error("Failed to create review request record");
    }

    console.log("Sending review request email to:", customerEmail, "for organization:", organizationId);

    // Star links in the design are {{reviewPageUrl}}?rating=N. Pass the bare page URL.
    const brand = await loadLooseBrand(organizationId);
    const rendered = renderCrmEmail("review-request", {
      vars: {
        ...orgBrandVars(brand),
        ...(companyName ? { companyName } : {}),
        serviceName: serviceName || "",
        customerName: customerName || "",
        reviewPageUrl,
        UNSUBSCRIBE_URL: UNSUBSCRIBE_URL_SENTINEL,
      },
      rawKeys: ["email_footer"],
    });

    const { sendOrgEmail } = await import("../_shared/send-org-email.ts");
    const sendResult = await sendOrgEmail({
      templateName: "review_request",
      marketing: true,
      organizationId,
      to: customerEmail,
      subject: `How was your ${serviceName}? We'd love your feedback!`,
      html: rendered.html,
      text: rendered.text,
    });

    if (!sendResult.success) {
      if (/not verified/i.test(sendResult.error || "")) {
        const domain = emailSettings.from_email.split('@')[1];
        throw new Error(`Your email domain (${domain}) is not verified. Please verify it to send emails.`);
      }
      throw new Error(sendResult.error || "Failed to send email");
    }
    const emailData: any = { id: sendResult.id };
    console.log("Review request email sent via", sendResult.method, "id:", sendResult.id);


    return new Response(JSON.stringify({ success: true, emailId: emailData?.id }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-review-request function:", error);
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);

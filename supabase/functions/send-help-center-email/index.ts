import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "npm:zod@3.25.76";
import { getOrgEmailSettings, formatEmailFrom, getReplyTo } from "../_shared/get-org-email-settings.ts";
import { verifyOrgAccess } from "../_shared/verify-org-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const helpCenterEmailSchema = z.object({
  type: z.enum(["contact", "idea"]),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255),
  message: z.string().trim().min(1).max(2000),
  organization_id: z.string().uuid(),
});

type HelpCenterEmailRequest = z.infer<typeof helpCenterEmailSchema>;

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured");
    }

    const raw = await req.json().catch(() => null);
    const parsed = helpCenterEmailSchema.safeParse(raw);

    if (!parsed.success) {
      return new Response(
        JSON.stringify({
          error: "Invalid request",
          issues: parsed.error.issues,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    const { type, name, email, message, organization_id }: HelpCenterEmailRequest = parsed.data;

    // SECURITY: caller must be a member of the organization (or service-role).
    const gate = await verifyOrgAccess(req, organization_id);
    if (!gate.ok) {
      return new Response(
        JSON.stringify({ error: gate.error }),
        { status: gate.status, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("[send-help-center-email] Processing request for org:", organization_id);

    // Get email settings from organization_email_settings table
    const emailSettingsResult = await getOrgEmailSettings(organization_id);
    if (!emailSettingsResult.success || !emailSettingsResult.settings) {
      console.error("[send-help-center-email] Failed to get email settings:", emailSettingsResult.error);
      return new Response(
        JSON.stringify({ error: emailSettingsResult.error }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const emailSettings = emailSettingsResult.settings;
    const senderFrom = formatEmailFrom(emailSettings);
    // Help center emails go to the organization's email
    const recipientTo = emailSettings.from_email;

    const isIdea = type === "idea";
    const subject = isIdea
      ? `💡 New Feature Idea from ${name}`
      : `📬 Help Center Contact from ${name}`;

    const heading = isIdea
      ? "New Feature Idea Submission"
      : "New Support Request";

    console.log("[send-help-center-email] Sending to:", recipientTo, "from:", senderFrom);

    const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #333; border-bottom: 2px solid #4f46e5; padding-bottom: 10px;">${heading}</h1>
            <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0 0 10px 0;"><strong>From:</strong> ${name}</p>
              <p style="margin: 0 0 10px 0;"><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
              <p style="margin: 0;"><strong>Type:</strong> ${isIdea ? "Feature Idea" : "Support Request"}</p>
            </div>
            <h2 style="color: #333; margin-top: 30px;">Message:</h2>
            <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
              <p style="white-space: pre-wrap; margin: 0;">${message}</p>
            </div>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;" />
            <p style="color: #6b7280; font-size: 12px;">This email was sent from your Help Center.</p>
          </div>
        `;

    const { sendOrgEmail } = await import("../_shared/send-org-email.ts");
    const sendResult = await sendOrgEmail({
      templateName: "help_center_reply",
      organizationId: organization_id,
      to: recipientTo,
      replyTo: email,
      subject,
      html,
    });

    if (!sendResult.success) {
      throw new Error(sendResult.error || "Failed to send email");
    }


    console.log("[send-help-center-email] Email sent successfully to:", recipientTo);
    return new Response(JSON.stringify({ success: true, id: sendResult.id }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    const message = error?.message || "Failed to send email";
    console.error("[send-help-center-email] Error:", error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);

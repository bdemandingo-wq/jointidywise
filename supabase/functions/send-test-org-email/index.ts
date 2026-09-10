import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  loadOrgBrand,
  renderBrandedEmail,
  SAMPLE_BOOKING_DATA,
} from "../_shared/org-email-renderer.ts";
import { sendOrgEmail } from "../_shared/send-org-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  organizationId: string;
  templateType: "confirmation" | "reminder";
  toEmail: string;
  subject?: string;
  body?: string;
  sections?: unknown;
}

async function requireOrgAdmin(req: Request, organizationId: string): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return "Missing Authorization header";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) return "Not authenticated";
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: membership } = await admin
    .from("org_memberships")
    .select("role")
    .eq("user_id", userRes.user.id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!membership) return "You are not a member of this organization";
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return "Insufficient permissions";
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json()) as Body;
    if (!body.organizationId || !body.templateType || !body.toEmail) {
      return json({ error: "Missing organizationId, templateType, or toEmail" }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.toEmail)) {
      return json({ error: "Invalid recipient email" }, 400);
    }
    const authErr = await requireOrgAdmin(req, body.organizationId);
    if (authErr) return json({ error: authErr }, 403);

    const brandResult = await loadOrgBrand(body.organizationId);
    if (!brandResult.success) return json({ error: brandResult.error }, 400);
    const brand = brandResult.brand;

    let sections: any[] | undefined = Array.isArray(body.sections) && body.sections.length > 0
      ? (body.sections as any[])
      : undefined;
    let savedSubject: string | undefined;
    let savedBody: string | undefined;
    if (!sections) {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const col = body.templateType === "reminder"
        ? "reminder_email_subject, reminder_email_body, reminder_email_sections"
        : "confirmation_email_subject, confirmation_email_body, confirmation_email_sections";
      const { data: bs } = await admin
        .from("business_settings")
        .select(col)
        .eq("organization_id", body.organizationId)
        .maybeSingle();
      if (bs) {
        const secKey = body.templateType === "reminder" ? "reminder_email_sections" : "confirmation_email_sections";
        const subKey = body.templateType === "reminder" ? "reminder_email_subject" : "confirmation_email_subject";
        const bodyKey = body.templateType === "reminder" ? "reminder_email_body" : "confirmation_email_body";
        const secs = (bs as any)[secKey];
        if (Array.isArray(secs) && secs.length > 0) sections = secs;
        savedSubject = (bs as any)[subKey] || undefined;
        savedBody = (bs as any)[bodyKey] || undefined;
      }
    }

    const sample = { ...SAMPLE_BOOKING_DATA, company_name: brand.companyName };
    const isReminder = body.templateType === "reminder";
    const { subject, html } = renderBrandedEmail({
      brand,
      subject: body.subject || savedSubject || (isReminder
        ? "Reminder: {{service_name}} on {{scheduled_date}}"
        : "Booking Confirmation - {{booking_number}}"),
      bodyText: body.body || savedBody || "",
      sections,
      data: sample,
      showAppointmentCard: true,
      bannerLabel: isReminder ? "Appointment Reminder" : "Booking Confirmed",
    });

    const finalSubject = `[TEST] ${subject}`;
    const result = await sendOrgEmail({
      templateName: "test",
      organizationId: body.organizationId,
      to: body.toEmail,
      subject: finalSubject,
      html,
    });

    console.log("[send-test-org-email] sent", {
      organizationId: body.organizationId,
      templateType: body.templateType,
      to: body.toEmail,
      method: result.method,
      success: result.success,
    });

    if (!result.success) return json({ error: result.error, method: result.method }, 500);
    return json({ success: true, method: result.method, id: result.id }, 200);
  } catch (e) {
    console.error("[send-test-org-email] error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

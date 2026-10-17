import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOrgEmail } from "../_shared/send-org-email.ts";
import { renderCrmEmail, orgBrandVars } from "../_shared/crm-email/render.ts";
import { loadLooseBrand } from "../_shared/org-email-renderer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabase = createClient(supabaseUrl, serviceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const {
      organizationId,
      to,
      subject,
      body,
      attachments,
      crmTemplate,
      customerName,
      companyName,
      serviceName,
      address,
      bedrooms,
      bathrooms,
      extras,
      estimatedTotal,
    } = await req.json();
    if (!organizationId || !to || !subject || (crmTemplate !== "quote" && !body)) {
      throw new Error("Missing required fields: organizationId, to, subject, body");
    }

    const { data: membership } = await supabase
      .from("org_memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!membership) throw new Error("Unauthorized: not a member of this organization");

    let html: string = body;
    let text: string | undefined;
    if (crmTemplate === "quote") {
      const brand = await loadLooseBrand(organizationId);
      const { data: orgRow } = await supabase
        .from("organizations")
        .select("slug")
        .eq("id", organizationId)
        .maybeSingle();
      const appUrl = (Deno.env.get("APP_URL") || "https://jointidywise.com").replace(/\/+$/, "");
      const slug = typeof orgRow?.slug === "string" ? orgRow.slug.trim() : "";
      const bookingUrl = slug ? `${appUrl}/book/${slug}` : `${appUrl}/book`;
      const specificName = typeof companyName === "string" ? companyName.trim() : "";
      const rendered = renderCrmEmail("quote", {
        vars: {
          ...orgBrandVars(brand),
          ...(specificName
            ? {
                companyName: specificName,
                company_name: specificName,
                orgName: specificName,
                biz: specificName,
                businessName: specificName,
              }
            : {}),
          customerName: customerName ?? "",
          serviceName: serviceName ?? "",
          address: address ?? "",
          bedrooms: bedrooms ?? "",
          bathrooms: bathrooms ?? "",
          extras: extras ?? "",
          estimatedTotal: estimatedTotal ?? "",
          bookingUrl,
        },
        rawKeys: ["email_footer"],
      });
      html = rendered.html;
      text = rendered.text;
    }

    const result = await sendOrgEmail({
      templateName: "direct_email",
      organizationId,
      to,
      subject,
      html,
      ...(text ? { text } : {}),
      attachments: Array.isArray(attachments)
        ? attachments.map((a: { name: string; content: string; type: string }) => ({
            filename: a.name,
            content: a.content,
            content_type: a.type,
          }))
        : undefined,
    });

    if (!result.success) throw new Error(result.error || "Failed to send email");

    console.log("[send-direct-email] Sent via", result.method, "id:", result.id, "fellBack:", result.fellBack ?? false);
    return new Response(JSON.stringify({ success: true, id: result.id, method: result.method, fellBack: result.fellBack ?? false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[send-direct-email] Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


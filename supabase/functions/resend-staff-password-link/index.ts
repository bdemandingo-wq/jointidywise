import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAdminAuth, createUnauthorizedResponse, createForbiddenResponse } from "../_shared/verify-admin-auth.ts";
import { logAudit } from "../_shared/audit-log.ts";
import { tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { PLATFORM_SENDER_FROM } from "../_shared/email-sender-resolution.ts";
import { orgBrandVars, renderCrmEmail } from "../_shared/crm-email/render.ts";
import { loadLooseBrand } from "../_shared/org-email-renderer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ResendLinkRequest {
  staffId: string;
  redirectUrl?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // SECURITY: Verify the caller is an authenticated admin
    const authResult = await verifyAdminAuth(req.headers.get("Authorization"), { requireAdmin: true });
    if (!authResult.success) {
      console.error("[RESEND-STAFF-PASSWORD-LINK] Authorization failed:", authResult.error);
      return createUnauthorizedResponse(authResult.error || "Unauthorized", corsHeaders);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { staffId, redirectUrl }: ResendLinkRequest = await req.json();

    if (!staffId) {
      return new Response(JSON.stringify({ error: "Staff ID is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get staff member details
    const { data: staffMember, error: staffError } = await supabaseAdmin
      .from("staff")
      .select("*")
      .eq("id", staffId)
      .single();

    if (staffError || !staffMember) {
      console.error("[RESEND-STAFF-PASSWORD-LINK] Error finding staff:", staffError);
      return new Response(JSON.stringify({ error: "Staff member not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SECURITY: Verify staff belongs to the caller's organization
    if (staffMember.organization_id !== authResult.organizationId) {
      console.error("[RESEND-STAFF-PASSWORD-LINK] Organization mismatch:", {
        staffOrg: staffMember.organization_id,
        adminOrg: authResult.organizationId
      });
      
      logAudit({
        action: "STAFF_PASSWORD_LINK_BLOCKED",
        organizationId: authResult.organizationId || "unknown",
        userId: authResult.userId || "unknown",
        resourceType: "staff",
        resourceId: staffId,
        success: false,
        error: "Attempted to generate password link for staff in different organization"
      });

      return createForbiddenResponse("Cannot generate password link for staff outside your organization", corsHeaders);
    }

    if (!staffMember.user_id) {
      return new Response(JSON.stringify({ error: "Staff member has no associated user account" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const origin = req.headers.get("origin") ?? "";
    const safeRedirectUrl =
      redirectUrl && origin && redirectUrl.startsWith(origin)
        ? redirectUrl
        : origin
          ? `${origin}/staff/reset-password`
          : redirectUrl;

    // Generate password reset link
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: staffMember.email,
      options: {
        redirectTo: safeRedirectUrl,
      },
    });

    if (linkError) {
      console.error("Error generating recovery link:", linkError);
      return new Response(JSON.stringify({ error: "Failed to generate password reset link" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resetLink = linkData.properties?.action_link;
    // Never log the link itself — it is a live, unauthenticated credential.
    console.log("Generated reset link for staff id:", staffId);

    // A recovery link authenticates the AUTH USER, not this staff row. One
    // person can hold staff rows in several organizations under one login,
    // so handing the raw link to an admin at org A would also hand them
    // access to org B's staff portal. Count the target user's active staff
    // rows and withhold the link when it spans more than one business.
    const { data: allStaffRows, error: multiOrgError } = await supabaseAdmin
      .from("staff")
      .select("id")
      .eq("user_id", staffMember.user_id)
      .eq("is_active", true);

    if (multiOrgError) {
      console.error("[RESEND-STAFF-PASSWORD-LINK] Failed to count staff rows:", multiOrgError);
      return new Response(JSON.stringify({ error: "Unable to process request. Please try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isMultiOrg = (allStaffRows?.length ?? 0) > 1;

    // Who requested this, and from which business — used in the cleaner's notice.
    let adminIdentity = "an administrator";
    if (authResult.userId) {
      const { data: adminUser } = await supabaseAdmin.auth.admin.getUserById(authResult.userId);
      const metaName = (adminUser?.user?.user_metadata as Record<string, unknown> | null)?.full_name;
      adminIdentity =
        (typeof metaName === "string" && metaName.trim()) ||
        adminUser?.user?.email ||
        adminIdentity;
    }

    const { data: bizSettings } = await supabaseAdmin
      .from("business_settings")
      .select("company_name")
      .eq("organization_id", staffMember.organization_id)
      .maybeSingle();
    const businessName = bizSettings?.company_name || "your cleaning business";

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const brand = await loadLooseBrand(staffMember.organization_id);
    const staffName = staffMember.name || "there";
    const branded = {
      ...orgBrandVars(brand),
      businessName,
      adminIdentity,
      staffName,
    };
    const email = isMultiOrg
      ? renderCrmEmail("staff-password-link", {
          vars: { ...branded, resetLink: resetLink || "" },
          rawKeys: ["email_footer"],
        })
      : renderCrmEmail("staff-password-notice", {
          vars: branded,
          rawKeys: ["email_footer"],
        });

    // SECURITY DEPENDENCY: emailing staff.email is only safe because UPDATE on
    // staff.email is NOT granted to `authenticated` (commit 903f7e9b). If that
    // revoke is ever reverted, an org admin could repoint a cleaner's staff row
    // at an address they control and have this recovery link delivered to
    // themselves — silently re-opening a cross-organization account takeover.
    // Do not restore the column grant without also revisiting this function.
    const sendEmail = async (subject: string) => {
      if (!resendKey) return false;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: PLATFORM_SENDER_FROM,
          to: [staffMember.email],
          reply_to: tidywiseSupportEmail(),
          subject,
          html: email.html,
          text: email.text,
        }),
      });
      if (!res.ok) {
        console.error("[RESEND-STAFF-PASSWORD-LINK] Resend failed:", res.status, await res.text());
        return false;
      }
      return true;
    };

    const maskEmail = (addr: string) => {
      const [local, domain] = addr.split("@");
      if (!domain) return "•••";
      if (local.length <= 2) return `${local[0] ?? "•"}•••@${domain}`;
      return `${local[0]}•••${local[local.length - 1]}@${domain}`;
    };

    if (isMultiOrg) {
      const sent = await sendEmail(`Your ${businessName} staff password setup link`);
      if (!sent) {
        logAudit({
          action: "STAFF_PASSWORD_LINK_DELIVERY_FAILED",
          organizationId: authResult.organizationId || "unknown",
          userId: authResult.userId || "unknown",
          resourceType: "staff",
          resourceId: staffId,
          success: false,
          error: resendKey ? "Email provider rejected the send" : "RESEND_API_KEY not configured",
        });
        return new Response(
          JSON.stringify({
            error:
              "This staff member works for more than one business, so the link must be emailed to them — but the email could not be delivered. Please contact support.",
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      logAudit({
        action: "STAFF_PASSWORD_LINK_GENERATED",
        organizationId: authResult.organizationId || "unknown",
        userId: authResult.userId || "unknown",
        resourceType: "staff",
        resourceId: staffId,
        success: true,
        details: { delivery: "emailed_to_cleaner", multiOrg: true, requestedBy: adminIdentity },
      });

      return new Response(
        JSON.stringify({
          success: true,
          emailed: true,
          maskedEmail: maskEmail(staffMember.email),
          staffName: staffMember.name,
          message: "Password reset link emailed to the staff member",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Single-org: unchanged response shape. The cleaner still gets a notice
    // (without the link) so an unexpected link is visible to them.
    const noticeSent = await sendEmail(`A password setup link was created for your ${businessName} account`);
    if (!noticeSent) {
      console.warn("[RESEND-STAFF-PASSWORD-LINK] Notice email not delivered (non-fatal)");
    }

    logAudit({
      action: "STAFF_PASSWORD_LINK_GENERATED",
      organizationId: authResult.organizationId || "unknown",
      userId: authResult.userId || "unknown",
      resourceType: "staff",
      resourceId: staffId,
      success: true,
      details: {
        delivery: "returned_to_admin",
        multiOrg: false,
        requestedBy: adminIdentity,
        noticeEmailed: noticeSent,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        resetLink,
        staffName: staffMember.name,
        staffEmail: staffMember.email,
        message: "Password reset link generated successfully",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in resend-staff-password-link:", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

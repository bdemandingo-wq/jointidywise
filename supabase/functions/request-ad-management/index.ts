// Ad management intake — saves request and notifies platform admin via SMS.
// Does NOT charge or create a Stripe subscription.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { PLATFORM_SENDER_FROM } from "../_shared/email-sender-resolution.ts";
import { escapeHtml } from "../_shared/escapeHtml.ts";
import { renderCrmEmail } from "../_shared/crm-email/render.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ADMIN_PHONES removed — admin alerts are now email-only.

const SERVICE_LABEL: Record<string, string> = {
  google_search: "Google Search Ads",
  google_lsa: "Google Local Services Ads",
  facebook: "Facebook Ads",
};

type Readiness = "yes" | "no" | "not_sure";
function normReadiness(v: unknown): Readiness | null {
  return v === "yes" || v === "no" || v === "not_sure" ? v : null;
}

interface Body {
  service_type?: string;
  business_name?: string;
  service_area?: string;
  monthly_budget?: number | string;
  has_ad_accounts?: boolean;
  // New account-readiness questions: 'yes' / 'no' / 'not_sure'.
  // Stored so onboarding knows whether to CREATE or CONNECT each account.
  has_google_business?: Readiness;
  has_google_ads?: Readiness;
  has_lsa_verified?: Readiness;
  has_facebook_bm?: Readiness;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  notes?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );
    const { data: udata } = await userClient.auth.getUser(token);
    const user = udata?.user;
    if (!user?.email) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const service_type = body.service_type;
    if (!service_type || !SERVICE_LABEL[service_type]) {
      return new Response(JSON.stringify({ error: "Invalid service_type" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { data: membership } = await admin
      .from("org_memberships")
      .select("organization_id, role, organizations(name)")
      .eq("user_id", user.id)
      .in("role", ["owner", "admin"])
      .limit(1)
      .maybeSingle();

    const orgId = membership?.organization_id;
    if (!orgId) {
      return new Response(JSON.stringify({ error: "No organization found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const orgName = (membership as any)?.organizations?.name ?? "";

    // Gate: must have an active paid plan (or grandfathered/lifetime).
    // Without this, a free/trial user could submit ad-mgmt requests
    // even though the public copy promises "requires an active paid
    // TidyWise plan" — burning admin SMS quota and operator time.
    const { data: gate } = await admin.rpc("has_active_subscription", {
      _org_id: orgId,
    });
    if (!gate) {
      return new Response(
        JSON.stringify({
          error: "Ad management requires an active paid TidyWise plan. Please upgrade first.",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Server-side length caps so a direct call with a 1MB notes blob
    // can't bypass the form's maxLength. Conservative limits match
    // typical business-context fields.
    const sliceStr = (s: string | null | undefined, n: number) =>
      typeof s === "string" ? s.slice(0, n) : null;

    const budgetNum = body.monthly_budget != null && body.monthly_budget !== ""
      ? Number(body.monthly_budget) : null;
    const safeBudget = budgetNum !== null && Number.isFinite(budgetNum) && budgetNum >= 0 && budgetNum <= 100000
      ? budgetNum : null;

    const { data: inserted, error: insertErr } = await admin
      .from("ad_management_requests")
      .insert({
        organization_id: orgId,
        user_id: user.id,
        service_type,
        business_name: sliceStr(body.business_name, 160),
        service_area: sliceStr(body.service_area, 240),
        monthly_budget: safeBudget,
        has_ad_accounts: !!body.has_ad_accounts,
        has_google_business: normReadiness(body.has_google_business),
        has_google_ads: normReadiness(body.has_google_ads),
        has_lsa_verified: normReadiness(body.has_lsa_verified),
        has_facebook_bm: normReadiness(body.has_facebook_bm),
        contact_name: sliceStr(body.contact_name, 120),
        contact_email: sliceStr(body.contact_email ?? user.email, 200),
        contact_phone: sliceStr(body.contact_phone, 40),
        notes: sliceStr(body.notes, 2000),
        status: "new",
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("[request-ad-management] insert error:", insertErr);
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Notify platform admin via email (replaces previous OpenPhone SMS).
    try {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        const noteLine = (label: string, value: string) => `${label}: ${escapeHtml(value)}`;
        const contactBits = [body.contact_name, body.contact_email || user.email, body.contact_phone]
          .filter((part) => typeof part === "string" && part.trim())
          .join(" ");
        const noteLines = [
          noteLine("Org", orgName || orgId || "—"),
          noteLine("Area", body.service_area || "—"),
          noteLine("Budget", budgetNum ? `$${budgetNum}/mo` : "—"),
          noteLine("Has ad accounts", body.has_ad_accounts ? "Yes" : "No"),
          noteLine(
            "Readiness",
            `GBP:${body.has_google_business ?? "—"} • GAds:${body.has_google_ads ?? "—"} • LSA:${body.has_lsa_verified ?? "—"} • FBBM:${body.has_facebook_bm ?? "—"}`,
          ),
          noteLine("Contact", contactBits || "—"),
        ];
        const freeNotes = typeof body.notes === "string" ? body.notes.trim() : "";
        if (freeNotes) noteLines.push(noteLine("Notes", freeNotes));
        const notes = noteLines.join("\n").replace(/\n/g, "<br>") || "—";

        const adminMail = renderCrmEmail("internal-ad-management", {
          vars: {
            serviceLabel: SERVICE_LABEL[service_type],
            businessName: body.business_name || orgName,
            requesterEmail: body.contact_email || user.email,
            notes,
            APP_URL: Deno.env.get("APP_URL") || "https://jointidywise.com",
          },
          rawKeys: ["notes"],
        });
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: PLATFORM_SENDER_FROM,
            to: [tidywiseSupportEmail()],
            reply_to: body.contact_email || user.email,
            subject: `📣 Ad mgmt: ${SERVICE_LABEL[service_type]} — ${body.business_name || orgName}`,
            html: adminMail.html,
            text: adminMail.text,
          }),
        });
      } else {
        console.log("[request-ad-management] RESEND_API_KEY not set; skipping admin email");
      }
    } catch (notifyErr) {
      console.error("[request-ad-management] admin notify failed (non-critical):", notifyErr);
    }

    return new Response(JSON.stringify({ success: true, id: inserted?.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[request-ad-management] error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

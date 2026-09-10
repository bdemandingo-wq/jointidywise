// Sends a branded "thank you, here's your receipt" email to the CUSTOMER
// after their cleaning-job invoice is paid via Stripe. This duplicates
// Stripe's plain receipt but in the org's branding so the customer
// recognizes the charge.
//
// Invoked from stripe-invoice-webhook on payment_intent.succeeded after
// the invoice row is marked paid. Org-scoped via organization_email_settings.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOrgEmail } from "../_shared/send-org-email.ts";
import { verifyOrgAccess } from "../_shared/verify-org-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface Body {
  invoice_id: string;
  organization_id?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { invoice_id, organization_id: orgIdFromBody } =
      (await req.json().catch(() => ({}))) as Body;
    if (!invoice_id) {
      return new Response(JSON.stringify({ error: "invoice_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pre-check auth when the caller supplied organization_id, to avoid
    // leaking invoice existence via 404 to unauthenticated callers. The
    // stripe-invoice-webhook chain always includes organization_id.
    if (orgIdFromBody) {
      const pre = await verifyOrgAccess(req, orgIdFromBody);
      if (!pre.ok) {
        return new Response(JSON.stringify({ error: pre.error }), {
          status: pre.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select("id, invoice_number, total_amount, paid_at, organization_id, customer_id")
      .eq("id", invoice_id)
      .maybeSingle();
    if (invErr || !invoice) {
      return new Response(JSON.stringify({ error: "invoice not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const organizationId = invoice.organization_id || orgIdFromBody;
    if (!organizationId) {
      return new Response(JSON.stringify({ error: "missing organization_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller is either the service role (Stripe webhook chain) or an
    // authenticated member of this organization.
    const access = await verifyOrgAccess(req, organizationId);
    if (!access.ok) {
      console.warn("[notify-invoice-paid] Unauthorized:", access.error);
      return new Response(JSON.stringify({ error: access.error }), {
        status: access.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: customer } = await supabase
      .from("customers")
      .select("first_name, last_name, email")
      .eq("id", invoice.customer_id)
      .maybeSingle();

    if (!customer?.email) {
      return new Response(JSON.stringify({ success: false, skipped: "no_customer_email" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: org } = await supabase
      .from("organizations").select("name").eq("id", organizationId).maybeSingle();
    const orgName = org?.name || "Your cleaning team";

    const firstName = customer.first_name || "there";
    const amount = typeof invoice.total_amount === "number"
      ? `$${invoice.total_amount.toFixed(2)}` : "your payment";
    const invLabel = invoice.invoice_number ? `#${invoice.invoice_number}` : "";
    const paidWhen = invoice.paid_at
      ? new Date(invoice.paid_at).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })
      : new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a1a1a; margin: 0 0 12px;">Thank you — payment received ✅</h2>
        <p style="color: #333; line-height: 1.6;">
          Hi ${escapeHtml(firstName)}, we received your payment of
          <strong>${escapeHtml(amount)}</strong> for invoice
          ${escapeHtml(invLabel)} on ${escapeHtml(paidWhen)}.
        </p>
        <table style="border-collapse: collapse; margin: 16px 0; width: 100%; max-width: 360px;">
          <tr><td style="padding: 4px 0; color: #666;">Invoice:</td><td style="padding: 4px 0;"><strong>${escapeHtml(invLabel)}</strong></td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Amount:</td><td style="padding: 4px 0;"><strong>${escapeHtml(amount)}</strong></td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Paid on:</td><td style="padding: 4px 0;">${escapeHtml(paidWhen)}</td></tr>
        </table>
        <p style="color: #333; line-height: 1.6;">
          A Stripe receipt has also been sent to this address. If you have any
          questions about this charge, just reply to this email.
        </p>
        <p style="color: #555; margin-top: 24px;">— ${escapeHtml(orgName)}</p>
      </div>`;

    const r = await sendOrgEmail({
      templateName: "invoice_paid_receipt",
      organizationId: organizationId,
      to: customer.email,
      subject: `Payment received — invoice ${invLabel}`,
      html,
    });

    return new Response(JSON.stringify(r), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[notify-invoice-paid] error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

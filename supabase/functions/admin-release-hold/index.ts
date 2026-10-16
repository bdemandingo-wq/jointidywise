import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { requireOrgAdmin } from "../_shared/requireOrgAdmin.ts";
import { orgReconnectResponse } from "../_shared/get-org-stripe-settings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Admin-only function to release a held payment.
 * This is a direct action tool for emergencies.
 *
 * AUTH: Requires owner/admin of the supplied organizationId (enforced via
 * requireOrgAdmin). Returns 401 if no auth, 403 if user is not admin/owner of
 * the organization.
 */
const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { paymentIntentId, organizationId } = await req.json();

    console.log("Admin release hold request:", { paymentIntentId, organizationId });

    if (!paymentIntentId) {
      return new Response(
        JSON.stringify({ error: "Payment Intent ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: "Organization ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // SECURITY: Require caller to be an owner/admin of organizationId.
    const auth = await requireOrgAdmin(req, organizationId);
    if (auth instanceof Response) return auth;
    const { user, supabaseAdmin } = auth;

    // Get organization-specific Stripe credentials via audited RPC
    const { data: secretRows } = await supabaseAdmin.rpc("get_org_stripe_secret", {
      p_org_id: organizationId,
    });
    const blocked = await orgReconnectResponse(organizationId, corsHeaders);
    if (blocked) return blocked;

    const orgSecret = Array.isArray(secretRows) ? secretRows[0] : secretRows;

    // STRICT ISOLATION: Only use organization-specific key, never fallback to global keys
    const stripeSecretKey: string | null = orgSecret?.stripe_access_token || orgSecret?.stripe_secret_key || null;

    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured for this organization. Please connect your Stripe account in Settings → Payments." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-08-27.basil" });

    // First retrieve the payment intent to check its status
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    console.log("Payment intent current status:", paymentIntent.status);

    if (paymentIntent.status === "canceled") {
      // Idempotent: log and return success
      await supabaseAdmin.from("admin_action_audit_log").insert({
        organization_id: organizationId,
        admin_user_id: user.id,
        action: "hold_released_admin",
        payment_intent_id: paymentIntentId,
        details: { result: "already_canceled" },
      });
      return new Response(JSON.stringify({
        success: true,
        message: "Hold was already released",
        status: "already_canceled"
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (paymentIntent.status !== "requires_capture") {
      return new Response(
        JSON.stringify({
          error: `Cannot release hold. Current status: ${paymentIntent.status}`,
          status: paymentIntent.status
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Cancel the payment intent to release the hold
    const canceledPayment = await stripe.paymentIntents.cancel(paymentIntentId, {
      cancellation_reason: "requested_by_customer",
    });

    const heldAmount = paymentIntent.amount / 100;

    console.log("Hold released successfully:", canceledPayment.id, "Amount:", heldAmount);

    // Audit log
    await supabaseAdmin.from("admin_action_audit_log").insert({
      organization_id: organizationId,
      admin_user_id: user.id,
      action: "hold_released_admin",
      payment_intent_id: paymentIntentId,
      details: { amount_released: heldAmount, stripe_status: canceledPayment.status },
    });

    return new Response(JSON.stringify({
      success: true,
      paymentIntentId: canceledPayment.id,
      status: canceledPayment.status,
      amountReleased: heldAmount,
      message: `Hold of $${heldAmount.toFixed(2)} has been released. Funds will be returned to the customer within 1-5 business days.`
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in admin-release-hold function:", error);

    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyOrgAccess } from "../_shared/verify-org-access.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Send referral request to customers who gave 5-star reviews
const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { reviewRequestId, customerId, organizationId, rating } = await req.json();

    // SECURITY: caller must be a member of the organization (or service-role).
    const gate = await verifyOrgAccess(req, organizationId);
    if (!gate.ok) {
      return new Response(
        JSON.stringify({ success: false, error: gate.error }),
        { status: gate.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only send referral request for 5-star reviews
    if (rating !== 5) {
      console.log(`[send-referral-request] Skipping - rating ${rating} is not 5 stars`);
      return new Response(
        JSON.stringify({ success: true, message: "Referral only for 5-star reviews" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get customer details
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (customerError || !customer) {
      console.error("[send-referral-request] Customer not found:", customerError);
      return new Response(
        JSON.stringify({ success: false, error: "Customer not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!customer.phone) {
      console.log("[send-referral-request] No phone for customer:", customerId);
      return new Response(
        JSON.stringify({ success: false, error: "No customer phone" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get business settings
    const { data: settings } = await supabase
      .from('business_settings')
      .select('company_name')
      .eq('organization_id', organizationId)
      .maybeSingle();

    const companyName = settings?.company_name || 'Our Company';

    // Wait 2 hours after the review before sending referral request (handled by caller or delay)
    const message = `${customer.first_name}, thank you SO much for the amazing 5-star review! 🌟 You made our day! If you know anyone who needs cleaning services, we'd love to help them too. Share our number and they'll get $20 off their first clean. You'll get $20 off your next clean too! 💙 - ${companyName}`;

    // Send SMS
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-openphone-sms`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: customer.phone,
        message,
        organizationId,
      }),
    });

    const result = await response.json();

    if (result.skipped) {
      console.log(`[send-referral-request] Referral SMS skipped opted_out customer ${customerId}`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "opted_out" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (result.success) {
      console.log(`[send-referral-request] Referral SMS sent to customer ${customerId}`);
      
      // Log the referral request
      await supabase.from('campaign_sms_sends').insert({
        customer_id: customerId,
        organization_id: organizationId,
        phone_number: customer.phone,
        message_content: message,
        status: 'sent',
      });

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      console.error(`[send-referral-request] SMS failed:`, result.error);
      return new Response(
        JSON.stringify({ success: false, error: result.error }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[send-referral-request] Error:", errorMessage);

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);

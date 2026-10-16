import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Send SMS reminder 24 hours before quote expires
const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  // Cron auth gate (allows manual invocation only with x-cron-secret)
  const cronGate = requireCronSecret(req);
  if (cronGate) return cronGate;


  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get quotes expiring in 24-25 hours (run this hourly via cron)
    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in25Hours = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    console.log(`[quote-expiry-reminder] Checking quotes expiring between ${in24Hours.toISOString()} and ${in25Hours.toISOString()}`);

    const { data: expiringQuotes, error: quotesError } = await supabase
      .from('quotes')
      .select(`
        *,
        customer:customers(*),
        service:services(name)
      `)
      .eq('status', 'sent')
      .gte('valid_until', in24Hours.toISOString().split('T')[0])
      .lte('valid_until', in25Hours.toISOString().split('T')[0]);

    if (quotesError) {
      console.error("[quote-expiry-reminder] Error fetching quotes:", quotesError);
      throw quotesError;
    }

    console.log(`[quote-expiry-reminder] Found ${expiringQuotes?.length || 0} expiring quotes`);

    const sentReminders = [];

    for (const quote of expiringQuotes || []) {
      if (!quote.customer?.phone || !quote.organization_id) {
        console.log(`[quote-expiry-reminder] Skipping quote ${quote.id} - no phone or org`);
        continue;
      }

      // Get business settings for company name
      const { data: settings } = await supabase
        .from('business_settings')
        .select('company_name')
        .eq('organization_id', quote.organization_id)
        .maybeSingle();

      const companyName = settings?.company_name || 'Our Company';
      const customerName = quote.customer.first_name;
      const serviceName = quote.service?.name || 'cleaning service';
      const quoteAmount = quote.total_amount?.toFixed(2) || '0.00';

      const message = `Hi ${customerName}! Your quote for ${serviceName} ($${quoteAmount}) from ${companyName} expires tomorrow. Ready to book? Reply YES to confirm or call us to discuss. We'd love to help!`;

      // Send SMS via existing function
      try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/send-openphone-sms`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: quote.customer.phone,
            message,
            organizationId: quote.organization_id,
          }),
        });

        const result = await response.json();

        if (result.skipped) {
          console.log(`[quote-expiry-reminder] Skipped opted_out quote ${quote.id}`);
        } else if (result.success) {
          sentReminders.push({ quoteId: quote.id, customer: customerName });
          console.log(`[quote-expiry-reminder] Sent reminder for quote ${quote.id}`);
        } else {
          console.error(`[quote-expiry-reminder] Failed to send SMS for quote ${quote.id}:`, result.error);
        }
      } catch (smsError) {
        console.error(`[quote-expiry-reminder] SMS error for quote ${quote.id}:`, smsError);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        processed: expiringQuotes?.length || 0,
        sent: sentReminders.length,
        reminders: sentReminders 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[quote-expiry-reminder] Error:", errorMessage);

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);

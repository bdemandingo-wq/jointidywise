import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { isServiceRoleRequest } from "../_shared/require-caller-org.ts";
import { platformAdminPhone } from "../_shared/platform-admin-phones.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ADMIN_PHONE = platformAdminPhone("primary");

interface HelpInquiryRequest {
  type: 'question' | 'idea';
  name: string;
  email: string;
  message: string;
  organizationName?: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SECURITY: no frontend or edge function currently calls this. It sends
  // to a fixed admin phone number with zero rate limiting or auth — lock it
  // to internal callers until something legitimate is wired up.
  if (!isServiceRoleRequest(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const openPhoneApiKey = Deno.env.get('OPENPHONE_API_KEY');
    const openPhoneNumberId = Deno.env.get('OPENPHONE_PHONE_NUMBER_ID');

    if (!openPhoneApiKey || !openPhoneNumberId) {
      console.error('OpenPhone credentials not configured');
      return new Response(
        JSON.stringify({ error: 'SMS service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { type, name, email, message, organizationName } = await req.json() as HelpInquiryRequest;

    if (!type || !name || !email || !message) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format the SMS message
    const typeLabel = type === 'question' ? '❓ QUESTION' : '💡 FEATURE IDEA';
    const orgInfo = organizationName ? `\nBusiness: ${organizationName}` : '';
    
    const smsMessage = `${typeLabel}\n\nFrom: ${name}\nEmail: ${email}${orgInfo}\n\nMessage:\n${message.substring(0, 500)}`;

    console.log('Sending help inquiry SMS to admin:', ADMIN_PHONE);

    // OpenPhone expects the raw API key in the Authorization header
    const authHeader = openPhoneApiKey.trim().replace(/^Bearer\s+/i, '');

    // Send SMS via OpenPhone
    const openPhoneResponse = await fetch('https://api.openphone.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: smsMessage,
        from: openPhoneNumberId,
        to: [ADMIN_PHONE],
      }),
    });

    if (!openPhoneResponse.ok) {
      const errorText = await openPhoneResponse.text();
      console.error('OpenPhone API error:', openPhoneResponse.status, errorText);
      
      // Handle billing/payment issues gracefully
      if (openPhoneResponse.status === 402) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'SMS service requires payment. Please check your OpenPhone account billing.', 
            errorCode: 'BILLING_REQUIRED' 
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Handle auth issues
      if (openPhoneResponse.status === 401) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Invalid OpenPhone API key. Please update your SMS settings.', 
            errorCode: 'AUTH_FAILED' 
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'Failed to send message. Please try again later.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Help inquiry SMS sent successfully');

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error sending help inquiry:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

serve(handler);

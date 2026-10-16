import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { anthropicChat, MODEL_HAIKU } from "../_shared/anthropic.ts";
import { isInternalDispatchRequest } from "../_shared/internal-dispatch-auth.ts";
import { sendOpenPhoneMessage } from "../_shared/send-sms.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AiSmsReplyRequest {
  organizationId: string;
  conversationId: string;
  customerPhone: string;
  incomingMessage: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Internal-only. Once INTERNAL_DISPATCH_SECRET is set, the service-role
  // key is no longer accepted as a bearer (it is a database bypass key and
  // should not travel between functions). Until then, the service-role
  // bearer is still accepted so a partial deploy keeps replies working.
  if (!isInternalDispatchRequest(req)) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ success: false, error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!anthropicKey) {
      console.error("[ai-sms-reply] Missing ANTHROPIC_API_KEY");
      return new Response(JSON.stringify({ success: false, error: "AI not configured" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { organizationId, conversationId, customerPhone, incomingMessage } = await req.json() as AiSmsReplyRequest;

    if (!organizationId || !conversationId || !customerPhone || !incomingMessage) {
      return new Response(JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // AI rate limiting (per-org 200/hr). No user scope: this is a webhook-triggered flow.
    const { enforceAiRateLimit } = await import("../_shared/ai-rate-limit.ts");
    const limited = await enforceAiRateLimit(supabase, { orgId: organizationId, corsHeaders });
    if (limited) return limited;

    // Per-org AI credit consumption
    const { enforceAiCredit } = await import("../_shared/ai-credits.ts");
    const denied = await enforceAiCredit(supabase, { orgId: organizationId, corsHeaders });
    if (denied) return denied;

    console.log(`[ai-sms-reply] Processing for org=${organizationId}, conv=${conversationId}`);

    // 1. Check if ai_sms_reply automation is enabled
    const { data: automation } = await supabase
      .from('organization_automations')
      .select('is_enabled')
      .eq('organization_id', organizationId)
      .eq('automation_type', 'ai_sms_reply')
      .maybeSingle();

    if (!automation || !automation.is_enabled) {
      console.log(`[ai-sms-reply] Automation disabled for org=${organizationId}`);
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'disabled' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 2. Cooldown check — skip if any outbound message sent within last 5 minutes
    const cooldownCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data: recentOutbound, error: outboundErr } = await supabase
      .from('sms_messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('direction', 'outbound')
      .gte('sent_at', cooldownCutoff)
      .limit(1)
      .maybeSingle();

    if (outboundErr) {
      console.error(`[ai-sms-reply] Cooldown check (outbound) failed, skipping to avoid a possible duplicate reply:`, outboundErr);
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'cooldown_check_failed' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (recentOutbound) {
      console.log(`[ai-sms-reply] Cooldown active — outbound message sent within last 5 min, skipping`);
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'cooldown' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 3. Also check outgoing direction (some messages use 'outgoing' instead of 'outbound')
    const { data: recentOutgoing, error: outgoingErr } = await supabase
      .from('sms_messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('direction', 'outgoing')
      .gte('sent_at', cooldownCutoff)
      .limit(1)
      .maybeSingle();

    if (outgoingErr) {
      console.error(`[ai-sms-reply] Cooldown check (outgoing) failed, skipping to avoid a possible duplicate reply:`, outgoingErr);
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'cooldown_check_failed' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (recentOutgoing) {
      console.log(`[ai-sms-reply] Cooldown active — outgoing message sent within last 5 min, skipping`);
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'cooldown' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 4. Get company info
    const { data: bizSettings } = await supabase
      .from('business_settings')
      .select('company_name, company_phone, company_email')
      .eq('organization_id', organizationId)
      .maybeSingle();

    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .maybeSingle();

    const companyName = bizSettings?.company_name || org?.name || 'Our company';

    // 5. Load conversation history (last 30 messages for context)
    const { data: conversationHistory } = await supabase
      .from('sms_messages')
      .select('direction, content, sent_at')
      .eq('conversation_id', conversationId)
      .order('sent_at', { ascending: true })
      .limit(30);

    const historyText = (conversationHistory || [])
      .map((msg: any) => {
        const role = (msg.direction === 'inbound' || msg.direction === 'incoming') ? 'Customer' : companyName;
        return `${role}: ${msg.content}`;
      })
      .join('\n');

    // 6. Look up customer info from the conversation
    const { data: conv } = await supabase
      .from('sms_conversations')
      .select('customer_name, customer_id')
      .eq('id', conversationId)
      .maybeSingle();

    let customerContext = '';
    if (conv?.customer_id) {
      const { data: customer } = await supabase
        .from('customers')
        .select('first_name, last_name, address, city, notes')
        .eq('id', conv.customer_id)
        .maybeSingle();

      if (customer) {
        customerContext = `\nCustomer: ${customer.first_name} ${customer.last_name}`;
        if (customer.address) customerContext += `, Address: ${customer.address}${customer.city ? ', ' + customer.city : ''}`;
        if (customer.notes) customerContext += `\nCustomer notes: ${customer.notes}`;
      }
    }

    // 7. Check for any upcoming bookings with this customer
    let bookingContext = '';
    if (conv?.customer_id) {
      const { data: upcomingBookings } = await supabase
        .from('bookings')
        .select('scheduled_at, status, address')
        .eq('customer_id', conv.customer_id)
        .eq('organization_id', organizationId)
        .in('status', ['pending', 'confirmed'])
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(3);

      if (upcomingBookings?.length) {
        bookingContext = '\nUpcoming bookings:\n' + upcomingBookings.map((b: any) =>
          `- ${new Date(b.scheduled_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${b.status})`
        ).join('\n');
      }
    }

    // 8. Load recent outbound messages across ALL conversations for tone matching
    const { data: recentOrgMessages } = await supabase
      .from('sms_messages')
      .select('content')
      .eq('organization_id', organizationId)
      .in('direction', ['outbound', 'outgoing'])
      .order('sent_at', { ascending: false })
      .limit(15);

    const toneExamples = (recentOrgMessages || [])
      .map((m: any) => m.content)
      .filter((c: string) => c && c.length > 10 && c.length < 500)
      .slice(0, 8)
      .join('\n---\n');

    // 9. Build the AI prompt
    const systemPrompt = `You are the AI assistant for "${companyName}", a cleaning service business. You reply to customer SMS messages exactly as the business owner would — matching their tone, style, and level of formality.

CRITICAL RULES:
- Keep replies SHORT (1-3 sentences max). This is SMS, not email.
- Match the tone from the example messages below. If they use casual language, be casual. If formal, be formal.
- Never say you are an AI, bot, or automated system. Reply as if you ARE the business.
- If asked about pricing, scheduling, or anything you're unsure about, say something like "Let me check on that and get back to you!" or "I'll have our team reach out shortly!"
- Do NOT make up prices, availability, or specific details you don't have.
- If the customer seems upset or has a complaint, be empathetic and say you'll look into it personally.
- Always end on a helpful note.
- Do NOT use emojis unless the example messages show the business uses them.
- Do NOT include any greeting like "Hi [name]" unless the business examples show that pattern.
- Include "Reply STOP to opt out" ONLY if the conversation just started (1-2 messages total). Never include it in ongoing conversations.

${toneExamples ? `EXAMPLE MESSAGES FROM THIS BUSINESS (match this tone):\n${toneExamples}\n` : ''}
${customerContext}
${bookingContext}

CONVERSATION HISTORY:
${historyText}`;

    // 10. Call Lovable AI
    console.log(`[ai-sms-reply] Calling AI for response generation`);

    const aiResponse = await anthropicChat(
      {
        model: MODEL_HAIKU,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: incomingMessage },
        ],
        max_tokens: 200,
      },
      { corsHeaders },
    );

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error(`[ai-sms-reply] Anthropic error: ${aiResponse.status} - ${errText}`);
      return new Response(errText, {
        status: aiResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiResult = await aiResponse.json();
    const generatedReply = aiResult.choices?.[0]?.message?.content?.trim();

    if (!generatedReply) {
      console.error("[ai-sms-reply] AI returned empty response");
      return new Response(JSON.stringify({ success: false, error: "AI returned empty response" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[ai-sms-reply] Generated reply: ${generatedReply.substring(0, 100)}...`);

    // 11. Get OpenPhone credentials and send the reply
    const { data: smsSettings } = await supabase
      .from('organization_sms_settings')
      .select('openphone_api_key, openphone_phone_number_id, sms_enabled')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (!smsSettings?.openphone_api_key || !smsSettings?.openphone_phone_number_id) {
      console.error("[ai-sms-reply] No OpenPhone credentials for org");
      return new Response(JSON.stringify({ success: false, error: "OpenPhone not configured" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!smsSettings.sms_enabled) {
      console.log("[ai-sms-reply] SMS disabled for org");
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'sms_disabled' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Format phone number
    let formattedPhone = customerPhone.replace(/\D/g, '');
    if (formattedPhone.length === 10) formattedPhone = `+1${formattedPhone}`;
    else if (!formattedPhone.startsWith('+')) formattedPhone = `+${formattedPhone}`;

    // Extract clean phone number ID
    let phoneNumberId = smsSettings.openphone_phone_number_id;
    if (phoneNumberId.includes('/')) {
      const m = phoneNumberId.match(/(PN[A-Za-z0-9]+)/);
      if (m) phoneNumberId = m[1];
    }

    const sent = await sendOpenPhoneMessage({
      supabase,
      organizationId,
      to: formattedPhone,
      content: generatedReply,
      from: phoneNumberId,
      apiKey: smsSettings.openphone_api_key,
      tag: "ai-sms-reply",
    });
    if (sent.skipped) {
      return new Response(
        JSON.stringify({ success: false, skipped: true, reason: "opted_out" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const smsResp = sent.response;

    if (!smsResp.ok) {
      const errText = await smsResp.text();
      console.error(`[ai-sms-reply] OpenPhone send failed: ${smsResp.status} - ${errText}`);
      return new Response(JSON.stringify({ success: false, error: "Failed to send AI reply via OpenPhone" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const smsResult = await smsResp.json();
    console.log(`[ai-sms-reply] AI reply sent successfully`);

    // 12. Log the outbound message to conversation
    const { error: logMsgErr } = await supabase.from('sms_messages').insert({
      conversation_id: conversationId,
      organization_id: organizationId,
      direction: 'outbound',
      content: generatedReply,
      status: 'sent',
      openphone_message_id: smsResult?.data?.id || null,
      sent_at: new Date().toISOString(),
    });
    if (logMsgErr) {
      console.error(`[ai-sms-reply] reply sent but sms_messages log insert failed — cooldown check above will not see this reply next time:`, logMsgErr);
    }

    // Update conversation timestamp
    await supabase
      .from('sms_conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);

    return new Response(
      JSON.stringify({ success: true, reply: generatedReply }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[ai-sms-reply] Error:", errorMessage);
    return new Response(JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

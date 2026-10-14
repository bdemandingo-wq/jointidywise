import { OPENPHONE_MESSAGES_URL, sendOpenPhoneMessage } from "../_shared/send-openphone.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { anthropicChat, MODEL_HAIKU } from "../_shared/anthropic.ts";
import { isInternalDispatchRequest } from "../_shared/internal-dispatch-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AIReplyRequest {
  conversationId: string;
  organizationId: string;
  inboundMessage: string;
  customerPhone: string;
  customerName?: string | null;
}

/**
 * Fetch call summaries for a specific participant from OpenPhone API.
 * These are the "Powered by Quo AI" bullet-point summaries visible in the app.
 */
async function fetchCallSummaries(
  apiKey: string,
  phoneNumberId: string,
  participantPhone: string
): Promise<string[]> {
  try {
    const url = new URL('https://api.openphone.com/v1/call-transcripts');
    url.searchParams.set('phoneNumberId', phoneNumberId);
    url.searchParams.set('participants', participantPhone);
    url.searchParams.set('maxResults', '5');

    const resp = await fetch(url.toString(), {
      headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
    });

    if (!resp.ok) {
      console.log(`[ai-sms-reply] Call transcripts API ${resp.status}, skipping`);
      return [];
    }

    const data = await resp.json();
    const summaries: string[] = [];

    for (const item of (data.data || [])) {
      // Prefer the AI summary if available
      if (item.summary && typeof item.summary === 'string' && item.summary.trim()) {
        summaries.push(item.summary.trim().substring(0, 600));
        continue;
      }
      // Fall back to dialogue transcript
      if (Array.isArray(item.transcript)) {
        const lines = item.transcript
          .map((t: any) => `${t.speaker || 'Speaker'}: ${t.text || ''}`)
          .join('\n');
        if (lines.trim()) summaries.push(lines.substring(0, 600));
      } else if (typeof item.transcript === 'string' && item.transcript.trim()) {
        summaries.push(item.transcript.trim().substring(0, 600));
      }
    }

    return summaries;
  } catch (err) {
    console.error('[ai-sms-reply] Error fetching call summaries:', err);
    return [];
  }
}

/**
 * Fetch messages from "Done" (archived) conversations to use as style training.
 * These show how the team has handled and closed out real situations.
 */
async function fetchDoneConversationStyle(
  apiKey: string,
  phoneNumberId: string
): Promise<string[]> {
  try {
    const url = new URL('https://api.openphone.com/v1/conversations');
    url.searchParams.set('phoneNumbers', phoneNumberId);
    url.searchParams.set('status', 'done');
    url.searchParams.set('maxResults', '20');

    const resp = await fetch(url.toString(), {
      headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
    });

    if (!resp.ok) {
      console.log(`[ai-sms-reply] Done conversations API ${resp.status}, skipping`);
      return [];
    }

    const data = await resp.json();
    const styleMessages: string[] = [];

    for (const conv of (data.data || []).slice(0, 10)) {
      const participants: string[] = conv.participants || [];
      if (participants.length === 0) continue;

      try {
        const msgUrl = new URL(OPENPHONE_MESSAGES_URL);
        msgUrl.searchParams.set('phoneNumberId', phoneNumberId);
        for (const p of participants) msgUrl.searchParams.append('participants', p);
        msgUrl.searchParams.set('maxResults', '10');

        const msgResp = await fetch(msgUrl.toString(), {
          headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
        });

        if (!msgResp.ok) continue;

        const msgData = await msgResp.json();
        for (const msg of (msgData.data || [])) {
          const dir = msg.direction === 'incoming' || msg.direction === 'inbound' ? 'in' : 'out';
          if (dir === 'out' && msg.body?.trim()) {
            styleMessages.push(msg.body.trim());
          }
        }
      } catch (_) { /* skip this conversation */ }
    }

    return styleMessages;
  } catch (err) {
    console.error('[ai-sms-reply] Error fetching done conversations:', err);
    return [];
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // See ai-sms-reply: shared secret once configured, service-role bearer only as fallback.
  if (!isInternalDispatchRequest(req)) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!anthropicKey) {
      console.error('[ai-sms-reply] ANTHROPIC_API_KEY not configured');
      return new Response(JSON.stringify({ success: false, error: 'AI not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json() as AIReplyRequest;
    const { conversationId, organizationId, inboundMessage, customerPhone, customerName } = body;

    if (!conversationId || !organizationId || !inboundMessage) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[ai-sms-reply] Processing reply for org=${organizationId} conv=${conversationId}`);

    // Cooldown check: only block if an AI-generated reply was sent in the last 5 minutes.
    // Manual replies by the owner do NOT block the AI from responding to follow-up messages.
    const cooldownCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentAiReply, error: cooldownErr } = await supabase
      .from('sms_messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('direction', 'outbound')
      .gte('sent_at', cooldownCutoff)
      .filter('metadata->>ai_generated', 'eq', 'true')
      .limit(1)
      .maybeSingle();

    if (cooldownErr) {
      console.error(`[ai-sms-reply] Cooldown check failed, skipping to avoid a possible duplicate reply:`, cooldownErr);
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'cooldown_check_failed' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (recentAiReply) {
      console.log(`[ai-sms-reply] Cooldown active — AI already replied within last 5 min, skipping`);
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'cooldown' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Fetch all DB context in parallel
    const [
      smsSettingsRes,
      businessSettingsRes,
      servicesRes,
      conversationHistoryRes,
      dbStyleExamplesRes,
      staffPhonesRes,
    ] = await Promise.all([
      supabase.from('organization_sms_settings')
        .select('openphone_api_key, openphone_phone_number_id')
        .eq('organization_id', organizationId)
        .maybeSingle(),

      supabase.from('business_settings')
        .select('company_name, company_phone, company_email')
        .eq('organization_id', organizationId)
        .maybeSingle(),

      supabase.from('services')
        .select('name, description, price')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .limit(10),

      // This conversation's full history for context
      supabase.from('sms_messages')
        .select('direction, content, sent_at')
        .eq('conversation_id', conversationId)
        .order('sent_at', { ascending: false })
        .limit(15),

      // Past outbound messages from DB as style examples
      supabase.from('sms_messages')
        .select('content')
        .eq('organization_id', organizationId)
        .eq('direction', 'outbound')
        .not('conversation_id', 'eq', conversationId)
        .order('sent_at', { ascending: false })
        .limit(40),

      // Staff phone numbers so we can detect if this is a staff conversation
      supabase.from('staff')
        .select('phone, name')
        .eq('organization_id', organizationId)
        .not('phone', 'is', null),
    ]);

    const smsSettings = smsSettingsRes.data;
    const business = businessSettingsRes.data;
    const services = servicesRes.data || [];
    const conversationHistory = (conversationHistoryRes.data || []).reverse();
    const dbStyleExamples = dbStyleExamplesRes.data || [];
    const staffPhones = staffPhonesRes.data || [];

    if (!smsSettings?.openphone_api_key || !smsSettings?.openphone_phone_number_id) {
      console.error('[ai-sms-reply] OpenPhone not configured for org:', organizationId);
      return new Response(JSON.stringify({ success: false, error: 'OpenPhone not configured' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const apiKey = smsSettings.openphone_api_key.trim().replace(/^Bearer\s+/i, '');
    const pnMatch = smsSettings.openphone_phone_number_id.match(/(PN[A-Za-z0-9]+)/);
    const phoneNumberId = pnMatch ? pnMatch[1] : smsSettings.openphone_phone_number_id;
    const companyName = business?.company_name || 'our company';

    // Detect if this is a staff member or a client
    const normalizePhone = (p: string) => p.replace(/\D/g, '').replace(/^1/, '');
    const normalizedCustomerPhone = normalizePhone(customerPhone);
    const matchedStaff = staffPhones.find(s => s.phone && normalizePhone(s.phone) === normalizedCustomerPhone);
    const isStaff = !!matchedStaff;
    const contactLabel = matchedStaff?.name || customerName || (isStaff ? 'Staff member' : 'Customer');

    // Fetch OpenPhone data in parallel: call summaries for this contact + done conversation style
    const [callSummaries, doneStyleMessages] = await Promise.all([
      fetchCallSummaries(apiKey, phoneNumberId, customerPhone),
      fetchDoneConversationStyle(apiKey, phoneNumberId),
    ]);

    // Merge style examples: DB outbound messages + done conversation messages
    const allStyleExamples = [
      ...dbStyleExamples.map(m => m.content),
      ...doneStyleMessages,
    ].filter(Boolean).slice(0, 50);

    // Build prompt sections
    const styleSection = allStyleExamples.length > 0
      ? `Here are real examples of how ${companyName} texts people (from both active and completed conversations):\n` +
        allStyleExamples.map(m => `• "${m}"`).join('\n')
      : '';

    const callContext = callSummaries.length > 0
      ? `\nRECENT CALL HISTORY WITH THIS PERSON:\n` +
        callSummaries.map((s, i) => `[Call ${i + 1}]: ${s}`).join('\n\n')
      : '';

    const conversationContext = conversationHistory.length > 0
      ? conversationHistory.map(m =>
          `${m.direction === 'inbound' ? contactLabel : companyName}: ${m.content}`
        ).join('\n')
      : '(No prior messages in this conversation)';

    const servicesInfo = services.length > 0
      ? services.map(s => `• ${s.name}${s.price ? ` – $${s.price}` : ''}`).join('\n')
      : '';

    const contactTypeNote = isStaff
      ? `NOTE: You are texting a STAFF MEMBER / CLEANER named ${contactLabel}. Keep the tone direct and operational — scheduling, job assignments, check-ins, logistics.`
      : `NOTE: You are texting a CLIENT named ${contactLabel}. Be warm, professional, and helpful.`;

    const systemPrompt = `You are the messaging assistant for ${companyName}, a professional cleaning company. You reply to incoming texts on behalf of the owner.

${contactTypeNote}

${styleSection}
${callContext}

BUSINESS INFO:
- Company: ${companyName}
${business?.company_phone ? `- Phone: ${business.company_phone}` : ''}
${business?.company_email ? `- Email: ${business.company_email}` : ''}
${servicesInfo ? `\nSERVICES OFFERED:\n${servicesInfo}` : ''}

RULES:
- Match the exact tone and style shown in the examples — study how short, casual, or formal those messages are
- This is SMS — keep it SHORT (1-3 sentences max)
- Use the call history above to understand any ongoing situation or context with this person
- Do NOT use emojis unless they appear in the style examples above
- Do NOT add greetings like "Hi [name]!" unless that pattern shows up in the examples
- Reply ONLY with the SMS message text — no labels, no quotes, no explanation`;

    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `CONVERSATION SO FAR:\n${conversationContext}\n\nNEW MESSAGE FROM ${contactLabel.toUpperCase()}:\n${inboundMessage}\n\nWrite the reply:`,
      },
    ];

    console.log(`[ai-sms-reply] Calling AI (isStaff=${isStaff}, hasCalls=${callSummaries.length}, styleExamples=${allStyleExamples.length})`);

    const aiResp = await anthropicChat(
      {
        model: MODEL_HAIKU,
        messages: messages as any,
        max_tokens: 300,
        temperature: 0.7,
      },
      { corsHeaders },
    );

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error(`[ai-sms-reply] Anthropic error ${aiResp.status}: ${errText}`);
      return new Response(JSON.stringify({ success: false, error: 'AI generation failed' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const aiData = await aiResp.json();
    const generatedReply = aiData.choices?.[0]?.message?.content?.trim();

    if (!generatedReply) {
      console.error('[ai-sms-reply] Empty reply from AI');
      return new Response(JSON.stringify({ success: false, error: 'AI returned empty reply' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[ai-sms-reply] Generated reply: "${generatedReply}"`);

    // Format phone
    let formattedPhone = customerPhone.replace(/\D/g, '');
    if (formattedPhone.length === 10) formattedPhone = `+1${formattedPhone}`;
    else if (!formattedPhone.startsWith('+')) formattedPhone = `+${formattedPhone}`;

    // Send via OpenPhone
    const sendResp = await sendOpenPhoneMessage( {
      organizationId: organizationId,
      method: 'POST',
      headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: phoneNumberId,
        to: [formattedPhone],
        content: generatedReply,
      }),
    });

    if (!sendResp.ok) {
      const errText = await sendResp.text();
      console.error(`[ai-sms-reply] OpenPhone send error ${sendResp.status}: ${errText}`);
      return new Response(JSON.stringify({ success: false, error: 'Failed to send reply via OpenPhone' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const sendResult = await sendResp.json();
    const openphoneMessageId = sendResult.data?.id;

    console.log(`[ai-sms-reply] Reply sent, openphoneMessageId=${openphoneMessageId}`);

    // Save to DB with ai_generated flag for cooldown tracking
    const { error: logMsgErr } = await supabase.from('sms_messages').insert({
      conversation_id: conversationId,
      organization_id: organizationId,
      direction: 'outbound',
      content: generatedReply,
      status: 'sent',
      openphone_message_id: openphoneMessageId || null,
      sent_at: new Date().toISOString(),
      metadata: { ai_generated: true },
    });
    if (logMsgErr) {
      console.error(`[ai-sms-reply] reply sent but sms_messages log insert failed — cooldown check above will not see this reply next time:`, logMsgErr);
    }

    await supabase.from('sms_conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);

    return new Response(JSON.stringify({ success: true, reply: generatedReply }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ai-sms-reply] Error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
};

serve(handler);

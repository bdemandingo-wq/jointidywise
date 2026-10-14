import { OPENPHONE_MESSAGES_URL } from "../_shared/send-openphone.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAdminAuth, createUnauthorizedResponse } from "../_shared/verify-admin-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function normalizePhoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.substring(1);
  return digits;
}

function resolveCustomerPhone(msg: any): string {
  const dir = msg.direction === 'incoming' || msg.direction === 'inbound' ? 'inbound' : 'outbound';
  const rawPhone = dir === 'inbound' ? msg.from : msg.to;
  if (Array.isArray(rawPhone)) return rawPhone[0] || '';
  if (typeof rawPhone === 'string' && rawPhone.includes(',')) return rawPhone.split(',')[0].trim();
  return rawPhone || '';
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authResult = await verifyAdminAuth(req.headers.get('Authorization'), { requireAdmin: true });
    if (!authResult.success) {
      return createUnauthorizedResponse(authResult.error || 'Unauthorized', corsHeaders);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { organizationId, pageToken: resumeToken } = await req.json();

    if (!organizationId || organizationId !== authResult.organizationId) {
      return new Response(JSON.stringify({ success: false, error: "Organization mismatch" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get SMS settings
    const { data: smsSettings } = await supabase
      .from('organization_sms_settings')
      .select('openphone_api_key, openphone_phone_number_id')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (!smsSettings?.openphone_api_key || !smsSettings?.openphone_phone_number_id) {
      return new Response(JSON.stringify({ success: false, error: "OpenPhone not configured. Go to Settings → SMS to add your API key and Phone Number ID." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const apiKey = smsSettings.openphone_api_key.trim().replace(/^Bearer\s+/i, '');
    let phoneNumberId = smsSettings.openphone_phone_number_id;
    const pnMatch = phoneNumberId.match(/(PN[A-Za-z0-9]+)/);
    if (pnMatch) phoneNumberId = pnMatch[1];

    console.log(`[backfill] org=${organizationId} resume=${resumeToken || 'start'}`);

    // Load contacts for name resolution (single parallel query)
    const [customersRes, leadsRes, staffRes] = await Promise.all([
      supabase.from('customers').select('id, first_name, last_name, phone').eq('organization_id', organizationId).not('phone', 'is', null),
      supabase.from('leads').select('id, name, phone').eq('organization_id', organizationId).not('phone', 'is', null),
      supabase.from('staff').select('id, name, phone').eq('organization_id', organizationId).not('phone', 'is', null),
    ]);

    const contactLookup = new Map<string, { name: string; customerId: string | null }>();
    for (const c of customersRes.data || []) {
      if (c.phone) contactLookup.set(normalizePhoneDigits(c.phone), { name: `${c.first_name} ${c.last_name}`.trim(), customerId: c.id });
    }
    for (const l of leadsRes.data || []) {
      if (l.phone) {
        const key = normalizePhoneDigits(l.phone);
        if (!contactLookup.has(key)) contactLookup.set(key, { name: l.name, customerId: null });
      }
    }
    for (const s of staffRes.data || []) {
      if (s.phone) {
        const key = normalizePhoneDigits(s.phone);
        if (!contactLookup.has(key)) contactLookup.set(key, { name: s.name, customerId: null });
      }
    }

    // Fetch ONE page of conversations (max 50) — keep it small to avoid timeout
    const convUrl = new URL('https://api.openphone.com/v1/conversations');
    convUrl.searchParams.set('phoneNumbers', phoneNumberId);
    convUrl.searchParams.set('maxResults', '50');
    if (resumeToken) convUrl.searchParams.set('pageToken', resumeToken);

    const convResponse = await fetch(convUrl.toString(), {
      headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
    });

    if (!convResponse.ok) {
      const errText = await convResponse.text();
      console.error(`[backfill] Conversations API ${convResponse.status}: ${errText}`);
      return new Response(JSON.stringify({ success: false, error: `OpenPhone API error: ${convResponse.status}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const convData = await convResponse.json();
    const conversations = convData.data || [];
    const nextPageToken = convData.nextPageToken || null;

    console.log(`[backfill] Got ${conversations.length} conversations, hasMore=${!!nextPageToken}`);

    let totalInserted = 0;
    let totalErrors = 0;

    // Process each conversation — fetch messages and save immediately
    for (const conv of conversations) {
      const participants: string[] = conv.participants || [];
      if (participants.length === 0) continue;

      try {
        // Fetch 1 page of messages (50 max) per conversation
        const msgUrl = new URL(OPENPHONE_MESSAGES_URL);
        msgUrl.searchParams.set('phoneNumberId', phoneNumberId);
        for (const p of participants) msgUrl.searchParams.append('participants', p);
        msgUrl.searchParams.set('maxResults', '50');

        const msgResponse = await fetch(msgUrl.toString(), {
          headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
        });

        if (!msgResponse.ok) {
          await msgResponse.text();
          totalErrors++;
          continue;
        }

        const msgData = await msgResponse.json();
        const messages = (msgData.data || []).filter((m: any) => m.object === 'message' && m.body);

        if (messages.length === 0) continue;

        // Determine customer phone from first message
        const customerPhone = resolveCustomerPhone(messages[0]);
        if (!customerPhone) { totalErrors++; continue; }

        // Find or create conversation — save immediately
        let { data: dbConv } = await supabase
          .from('sms_conversations')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('customer_phone', customerPhone)
          .maybeSingle();

        if (!dbConv) {
          const contact = contactLookup.get(normalizePhoneDigits(customerPhone));
          const { data: newConv, error: convErr } = await supabase
            .from('sms_conversations')
            .insert({
              organization_id: organizationId,
              customer_phone: customerPhone,
              customer_name: contact?.name || null,
              customer_id: contact?.customerId || null,
              last_message_at: messages[0].createdAt || new Date().toISOString(),
              conversation_type: 'client',
            })
            .select('id')
            .single();

          if (convErr) { console.error(`[backfill] Conv error:`, convErr); totalErrors++; continue; }
          dbConv = newConv;
        }

        // Save messages immediately with upsert (incremental save)
        const rows = messages.map((msg: any) => {
          const dir = msg.direction === 'incoming' || msg.direction === 'inbound' ? 'inbound' : 'outbound';
          return {
            conversation_id: dbConv!.id,
            organization_id: organizationId,
            direction: dir,
            content: msg.body,
            status: dir === 'inbound' ? 'received' : 'sent',
            openphone_message_id: msg.id,
            sent_at: msg.createdAt || new Date().toISOString(),
          };
        });

        const { error: insertErr, data: inserted } = await supabase
          .from('sms_messages')
          .upsert(rows, { onConflict: 'openphone_message_id', ignoreDuplicates: true })
          .select('id');

        if (insertErr) {
          console.error(`[backfill] Insert error:`, insertErr);
          totalErrors++;
        } else {
          totalInserted += inserted?.length || 0;
        }

        // Update conversation timestamp
        const latestTime = messages.reduce((max: string, m: any) => {
          const t = m.createdAt || '';
          return t > max ? t : max;
        }, '');
        if (latestTime) {
          await supabase.from('sms_conversations').update({ last_message_at: latestTime }).eq('id', dbConv!.id);
        }
      } catch (convErr) {
        console.error(`[backfill] Conversation processing error:`, convErr);
        totalErrors++;
      }
    }

    const summary = {
      success: true,
      totalConversations: conversations.length,
      inserted: totalInserted,
      errors: totalErrors,
      nextPageToken: nextPageToken || null,
      hasMore: !!nextPageToken,
    };

    console.log(`[backfill] Done:`, summary);

    return new Response(JSON.stringify(summary),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[backfill] Error:", errorMessage);
    return new Response(JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
};

serve(handler);

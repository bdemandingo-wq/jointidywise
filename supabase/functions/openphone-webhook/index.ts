import {
  resolveTemplate,
  withStopSentence,
  AUTOMATION_DEFAULTS,
} from "../_shared/automation-templates.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findCustomerIdByPhone } from "../_shared/marketing-guard.ts";
import { internalDispatchHeaders } from "../_shared/internal-dispatch-auth.ts";
import {
  classifySmsOptOut,
  isExactResubscribe,
  nextSmsConsent,
  optOutReplyAddress,
  renderOptOutConfirmation,
  type SmsConsentState,
} from "../_shared/sms-opt-out.ts";
import { sendOpenPhoneMessage } from "../_shared/send-sms.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-openphone-signature',
};

interface OpenPhoneWebhookPayload {
  type: string;
  data: {
    object: {
      id: string;
      from: string;
      to: string;
      body: string;
      direction: string;
      createdAt: string;
      phoneNumberId: string;
      media?: Array<{ url: string; type?: string }>;
    };
  };
}

interface OpenPhoneContact {
  id: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  phoneNumbers?: Array<{ phoneNumber: string }>;
}

// Fetch contact name from OpenPhone API
async function fetchOpenPhoneContactName(
  phoneNumber: string,
  apiKey: string
): Promise<string | null> {
  try {
    // Format phone number for query (remove + if present)
    const formattedPhone = phoneNumber.replace(/^\+/, '');
    
    console.log(`[openphone-webhook] Fetching contact for phone: ${phoneNumber}`);
    
    const response = await fetch(
      `https://api.openphone.com/v1/contacts?phoneNumbers=${encodeURIComponent(phoneNumber)}`,
      {
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.log(`[openphone-webhook] OpenPhone API returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log(`[openphone-webhook] OpenPhone contacts response:`, JSON.stringify(data));
    
    // OpenPhone returns { data: [...contacts] }
    const contacts = data.data as OpenPhoneContact[] | undefined;
    
    if (!contacts || contacts.length === 0) {
      console.log(`[openphone-webhook] No contacts found for ${phoneNumber}`);
      return null;
    }

    const contact = contacts[0];
    const firstName = contact.firstName?.trim() || '';
    const lastName = contact.lastName?.trim() || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    
    if (fullName) {
      console.log(`[openphone-webhook] Found contact name: ${fullName}`);
      return fullName;
    }
    
    // Fallback to company name if no personal name
    if (contact.company) {
      console.log(`[openphone-webhook] Found company name: ${contact.company}`);
      return contact.company;
    }
    
    return null;
  } catch (error) {
    console.error(`[openphone-webhook] Error fetching contact:`, error);
    return null;
  }
}

/**
 * Normalize a phone number to its last 10 digits for comparison.
 * Handles formats like +15106465090, (510) 646-5090, 5106465090, etc.
 */
function normalizePhoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // If 11 digits starting with 1 (US country code), strip it
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.substring(1);
  }
  return digits;
}

/**
 * Find a contact name by searching customers, leads, and staff tables
 * using normalized phone number matching.
 */
async function findLocalContactName(
  supabase: any,
  organizationId: string,
  phone: string
): Promise<{ name: string | null; customerId: string | null }> {
  const normalizedPhone = normalizePhoneDigits(phone);
  
  // Fetch all org customers/leads/staff with phones in parallel
  const [customersRes, leadsRes, staffRes] = await Promise.all([
    supabase
      .from('customers')
      .select('id, first_name, last_name, phone')
      .eq('organization_id', organizationId)
      .not('phone', 'is', null),
    supabase
      .from('leads')
      .select('id, name, phone')
      .eq('organization_id', organizationId)
      .not('phone', 'is', null),
    supabase
      .from('staff')
      .select('id, name, phone')
      .eq('organization_id', organizationId)
      .not('phone', 'is', null),
  ]);

  // Check customers
  const customer = customersRes.data?.find((c: any) =>
    c.phone && normalizePhoneDigits(c.phone) === normalizedPhone
  );
  if (customer) {
    return { name: `${customer.first_name} ${customer.last_name}`.trim(), customerId: customer.id };
  }

  // Check leads
  const lead = leadsRes.data?.find((l: any) =>
    l.phone && normalizePhoneDigits(l.phone) === normalizedPhone
  );
  if (lead) {
    return { name: lead.name, customerId: null };
  }

  // Check staff
  const staffMember = staffRes.data?.find((s: any) =>
    s.phone && normalizePhoneDigits(s.phone) === normalizedPhone
  );
  if (staffMember) {
    return { name: staffMember.name, customerId: null };
  }

  return { name: null, customerId: null };
}

/**
 * One transactional opt-out confirmation. Not a campaign and not gated by
 * marketing_status — the customer is opted out by the time this runs, and a
 * marketing guard would swallow the receipt. Sent at most once per webhook
 * delivery; a failed send is logged and not retried, so a timeout cannot
 * deliver a second copy.
 */
async function sendSmsOptOutConfirmation(
  supabase: ReturnType<typeof createClient>,
  args: {
    organizationId: string;
    conversationId: string;
    customerPhone: string;
    openphoneApiKey: string | null | undefined;
    phoneNumberId: string | null | undefined;
  },
): Promise<void> {
  const { organizationId, conversationId, customerPhone, openphoneApiKey, phoneNumberId } = args;

  let businessName = '';
  let businessPhone: string | null = null;
  try {
    const [{ data: biz }, { data: org }] = await Promise.all([
      supabase
        .from('business_settings')
        .select('company_name, company_phone, business_line_phone')
        .eq('organization_id', organizationId)
        .maybeSingle(),
      supabase
        .from('organizations')
        .select('name')
        .eq('id', organizationId)
        .maybeSingle(),
    ]);
    const settings = biz as {
      company_name?: string | null;
      company_phone?: string | null;
      business_line_phone?: string | null;
    } | null;
    const orgRow = org as { name?: string | null } | null;
    businessName = settings?.company_name || orgRow?.name || '';
    businessPhone = (settings?.company_phone || settings?.business_line_phone || '').trim() || null;
  } catch (lookupErr) {
    console.error('[openphone-webhook] opt-out confirmation: business lookup failed', lookupErr);
  }

  const confirmation = renderOptOutConfirmation(businessName, businessPhone);
  const destination = optOutReplyAddress(customerPhone);
  let fromId = phoneNumberId ?? '';
  if (fromId.includes('/') || fromId.includes('openphone') || fromId.includes('.com')) {
    const pnMatch = fromId.match(/(PN[A-Za-z0-9]+)/);
    if (pnMatch) fromId = pnMatch[1];
  }

  if (!openphoneApiKey || !fromId || !destination) {
    console.error(
      `[openphone-webhook] CRITICAL: opt-out confirmation NOT sent for org ${organizationId} ` +
      `to ${customerPhone} — missing API key, from number, or a usable destination.`,
    );
    return;
  }

  const authHeader = openphoneApiKey.trim().replace(/^Bearer\s+/i, '');
  // The number is already suppressed. This is the one reply that is still allowed.
  const sent = await sendOpenPhoneMessage({
    supabase,
    organizationId,
    to: destination,
    content: confirmation,
    from: fromId,
    apiKey: authHeader,
    allowOptedOut: true,
    tag: 'openphone-webhook:opt-out-confirmation',
  });
  if (sent.skipped) {
    console.error(
      `[openphone-webhook] CRITICAL: opt-out confirmation was skipped for org ${organizationId}`,
    );
    return;
  }
  const response = sent.response;

  if (!response.ok) {
    const errText = await response.text();
    console.error(
      `[openphone-webhook] CRITICAL: opt-out confirmation send failed (${response.status}) ` +
      `for org ${organizationId}: ${errText}`,
    );
    return;
  }

  const result = await response.json().catch(() => ({}));
  const confirmationId = (result as { data?: { id?: string } })?.data?.id ?? null;

  const { error: logError } = await supabase.from('sms_messages').insert({
    conversation_id: conversationId,
    organization_id: organizationId,
    direction: 'outbound',
    content: confirmation,
    status: 'sent',
    openphone_message_id: confirmationId,
    sent_at: new Date().toISOString(),
  });
  if (logError) {
    console.error('[openphone-webhook] opt-out confirmation sent but not logged to the inbox:', logError);
  }

  await supabase
    .from('sms_conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  console.log(`[openphone-webhook] Opt-out confirmation sent to ${destination} for org ${organizationId}`);
}

function consentStateFromRow(row: {
  marketing_status?: string | null;
  opted_out_at?: string | null;
  opted_out_method?: string | null;
  opted_out_campaign_id?: string | null;
  marketing_status_before_sms_stop?: string | null;
}): SmsConsentState {
  return {
    marketing_status: row.marketing_status || 'active',
    opted_out_at: row.opted_out_at ?? null,
    opted_out_method: row.opted_out_method ?? null,
    opted_out_campaign_id: row.opted_out_campaign_id ?? null,
    marketing_status_before_sms_stop: row.marketing_status_before_sms_stop ?? null,
  };
}

async function loadSmsConsent(
  supabase: ReturnType<typeof createClient>,
  organizationId: string,
  customerId: string,
): Promise<SmsConsentState | null> {
  const full = await supabase
    .from('customers')
    .select('marketing_status, opted_out_at, opted_out_method, opted_out_campaign_id, marketing_status_before_sms_stop')
    .eq('id', customerId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (!full.error && full.data) return consentStateFromRow(full.data);
  if (full.error && /marketing_status_before_sms_stop/i.test(full.error.message ?? '')) {
    console.error(
      '[openphone-webhook] marketing_status_before_sms_stop is missing. ' +
      'Run migration 20261015040000 in the Supabase SQL editor. START cannot restore prior consent until then.',
    );
    const basic = await supabase
      .from('customers')
      .select('marketing_status, opted_out_at, opted_out_method, opted_out_campaign_id')
      .eq('id', customerId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (basic.error || !basic.data) return null;
    return consentStateFromRow(basic.data);
  }
  if (full.error) console.error('[openphone-webhook] consent lookup failed:', full.error);
  return null;
}

async function persistSmsConsent(
  supabase: ReturnType<typeof createClient>,
  organizationId: string,
  customerId: string,
  state: SmsConsentState,
): Promise<boolean> {
  let payload: Record<string, string | null> = { ...state };
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await supabase
      .from('customers')
      .update(payload)
      .eq('id', customerId)
      .eq('organization_id', organizationId);
    if (!error) return true;
    lastError = error.message ?? '';
    console.error(`[openphone-webhook] consent update failed (attempt ${attempt}/3):`, error);
    if (/marketing_status_before_sms_stop/i.test(lastError) && 'marketing_status_before_sms_stop' in payload) {
      const { marketing_status_before_sms_stop: _dropped, ...rest } = payload;
      payload = rest;
      console.error(
        '[openphone-webhook] marketing_status_before_sms_stop column is missing. ' +
        'Run migration 20261015040000 in the Supabase SQL editor.',
      );
    }
  }
  console.error(
    `[openphone-webhook] CRITICAL: consent for customer ${customerId} (org ${organizationId}) ` +
    `was not saved after 3 attempts (${lastError}).`,
  );
  return false;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[openphone-webhook] Missing Supabase configuration");
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Read raw body so we can verify HMAC signature before parsing
    const rawBody = await req.text();

    // SECURITY: verify OpenPhone HMAC signature when secret is configured.
    // Format from OpenPhone is: hmac;<version>;<timestamp>;<base64-signature>
    const OPENPHONE_WEBHOOK_SECRET = Deno.env.get("OPENPHONE_WEBHOOK_SECRET") ?? "";
    if (!OPENPHONE_WEBHOOK_SECRET) {
      console.error("[openphone-webhook] OPENPHONE_WEBHOOK_SECRET not set — rejecting request");
      return new Response(JSON.stringify({ error: "Webhook secret not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sigHeader = req.headers.get("openphone-signature") || req.headers.get("x-openphone-signature") || "";
    const parts = sigHeader.split(";");
    const ts = parts[2];
    const providedB64 = parts[3];
    if (!ts || !providedB64) {
      console.error("[openphone-webhook] Missing/invalid signature header");
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    try {
      const signedPayload = `${ts}.${rawBody}`;
      const keyBytes = Uint8Array.from(atob(OPENPHONE_WEBHOOK_SECRET), c => c.charCodeAt(0));
      const key = await crypto.subtle.importKey(
        "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
      );
      const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
      const expectedB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
      // timing-safe compare
      if (expectedB64.length !== providedB64.length) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let diff = 0;
      for (let i = 0; i < expectedB64.length; i++) diff |= expectedB64.charCodeAt(i) ^ providedB64.charCodeAt(i);
      if (diff !== 0) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // The signature covers the timestamp, but a captured valid request
      // could be replayed forever without a freshness window.
      const tsNum = Number(ts);
      const tsMs = Number.isFinite(tsNum) ? (tsNum > 1e12 ? tsNum : tsNum * 1000) : NaN;
      const MAX_SKEW_MS = 5 * 60 * 1000;
      if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > MAX_SKEW_MS) {
        console.error("[openphone-webhook] Signature timestamp outside 5 minute window");
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch (sigErr) {
      console.error("[openphone-webhook] Signature verification error:", sigErr);
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(rawBody) as OpenPhoneWebhookPayload;
    console.log("[openphone-webhook] Received payload:", JSON.stringify(payload, null, 2));

    // Detect if this is a call event vs a message event
    // Call events should NOT be treated as SMS messages
    const eventType = payload.type || '';
    const isCallEvent = eventType.startsWith('call.');
    const objectType = (payload.data?.object as any)?.object || '';

    // Process incoming messages, outgoing messages, and delivery status updates
    // OpenPhone event types vary; rely on payload direction when available.
    // Common types we see:
    // - message.received (inbound)
    // - message.sent / message.created / message.completed (outbound)
    // - message.delivered (delivery updates)
    const rawObjectDirection = payload.data?.object?.direction?.toLowerCase?.() || '';

    // IMPORTANT: Only use direction for SMS detection if it's NOT a call event
    const isInbound =
      !isCallEvent && (
        payload.type === 'message.received' ||
        rawObjectDirection === 'inbound' ||
        rawObjectDirection === 'incoming'
      );

    const isOutbound =
      !isCallEvent && (
        payload.type === 'message.sent' ||
        payload.type === 'message.created' ||
        payload.type === 'message.completed' ||
        rawObjectDirection === 'outbound' ||
        rawObjectDirection === 'outgoing'
      );

    const isDeliveryUpdate = payload.type === 'message.delivered';

    // Missed call detection
    const isMissedCall = payload.type === 'call.completed' && 
      (payload.data?.object as any)?.status === 'missed';

    console.log(
      `[openphone-webhook] Event type: ${payload.type}, objectType: ${objectType}, direction: ${rawObjectDirection || 'n/a'}, isCallEvent: ${isCallEvent}, isInbound: ${isInbound}, isOutbound: ${isOutbound}, isDeliveryUpdate: ${isDeliveryUpdate}, isMissedCall: ${isMissedCall}`
    );

    // Handle delivery status updates (read receipts)
    // Also insert the message if it doesn't exist (for messages sent directly from OpenPhone)
    if (isDeliveryUpdate) {
      const openphoneMessageId = payload.data.object.id;
      const messageObj = payload.data.object;
      console.log(`[openphone-webhook] Processing delivery status for message: ${openphoneMessageId}`);

      // Check if message already exists
      const { data: existingMsg } = await supabase
        .from('sms_messages')
        .select('id')
        .eq('openphone_message_id', openphoneMessageId)
        .maybeSingle();

      if (!existingMsg) {
        // Message doesn't exist - this was sent directly from OpenPhone, not through our app
        // We need to insert it first, then mark as delivered
        console.log(`[openphone-webhook] Message ${openphoneMessageId} not found, inserting as outbound message first`);

        const phoneNumberId = messageObj.phoneNumberId;
        // Handle group chats: use first phone number to avoid duplicate conversations
        const rawCustomerPhone = messageObj.to; // For outbound, 'to' is the customer
        const customerPhone = rawCustomerPhone.includes(',') 
          ? rawCustomerPhone.split(',')[0].trim() 
          : rawCustomerPhone;

        // Find organization by phone number ID
        const { data: smsSettings } = await supabase
          .from('organization_sms_settings')
          .select('organization_id')
          .eq('openphone_phone_number_id', phoneNumberId)
          .maybeSingle();

        let organizationId = smsSettings?.organization_id;

        if (!organizationId) {
          // Try partial match
          const { data: allSettings } = await supabase
            .from('organization_sms_settings')
            .select('organization_id, openphone_phone_number_id');

          if (allSettings) {
            for (const setting of allSettings) {
              if (
                setting.openphone_phone_number_id?.includes(phoneNumberId) ||
                phoneNumberId.includes(setting.openphone_phone_number_id || '')
              ) {
                organizationId = setting.organization_id;
                break;
              }
            }
          }
        }

        if (organizationId) {
          // Find or create conversation
          const { data: conv } = await supabase
            .from('sms_conversations')
            .select('id')
            .eq('organization_id', organizationId)
            .eq('customer_phone', customerPhone)
            .maybeSingle();

          let conversationId = conv?.id;

          if (!conversationId) {
            const { data: newConv } = await supabase
              .from('sms_conversations')
              .insert({
                organization_id: organizationId,
                customer_phone: customerPhone,
                customer_name: null,
              })
              .select('id')
              .single();
            conversationId = newConv?.id;
          }

          if (conversationId) {
            // Insert the outbound message
            const deliveryMediaUrls = (messageObj as any).media?.map((m: any) => m.url).filter(Boolean) || null;
            await supabase.from('sms_messages').insert({
              conversation_id: conversationId,
              organization_id: organizationId,
              direction: 'outbound',
              content: messageObj.body || '',
              status: 'delivered',
              delivery_status: 'delivered',
              openphone_message_id: openphoneMessageId,
              sent_at: messageObj.createdAt || new Date().toISOString(),
              delivered_at: new Date().toISOString(),
              media_urls: deliveryMediaUrls?.length ? deliveryMediaUrls : null,
            });

            // Update conversation timestamp
            await supabase
              .from('sms_conversations')
              .update({ last_message_at: new Date().toISOString() })
              .eq('id', conversationId);

            console.log(`[openphone-webhook] Inserted outbound message ${openphoneMessageId} for conversation ${conversationId}`);
          }
        } else {
          console.log(`[openphone-webhook] Could not find organization for phoneNumberId: ${phoneNumberId}`);
        }
      } else {
        // Message exists, just update delivery status
        const { error: updateError } = await supabase
          .from('sms_messages')
          .update({
            delivery_status: 'delivered',
            delivered_at: new Date().toISOString(),
            status: 'delivered',
          })
          .eq('openphone_message_id', openphoneMessageId);

        if (updateError) {
          console.error('[openphone-webhook] Error updating delivery status:', updateError);
        } else {
          console.log(`[openphone-webhook] Updated delivery status for message: ${openphoneMessageId}`);
        }
      }

      // Also update campaign_sms_sends delivery status if this message matches a campaign send.
      //
      // CROSS-TENANT SAFETY: this update was previously scoped ONLY by phone
      // number and status='sent', with no organization, recency or row limit.
      // A delivery webhook for one organization would rewrite EVERY historical
      // 'sent' row for that phone number in EVERY organization — the same
      // person is frequently a customer of more than one org on this platform.
      // It also rewrote send history going back to the beginning of time.
      // campaign_sms_sends is the legal record of what was sent to whom and
      // when, so it must only ever be narrowed to the single row this
      // particular delivery receipt actually refers to:
      //   - organization_id = this webhook's org
      //   - sent within the last 24h (a delivery receipt is never older)
      //   - the single most recent matching row
      // Resolve the owning org from this receipt's phoneNumberId. The
      // organizationId resolved above is scoped to the `!existingMsg` branch
      // and is not available for receipts on messages we already have, so it
      // is resolved independently here. If it cannot be resolved we do NOT
      // fall back to an unscoped update — we skip, because an unscoped update
      // is precisely the cross-tenant bug being fixed.
      const deliveredPhone = messageObj.to;
      const deliveryPhoneNumberId = messageObj.phoneNumberId;
      let deliveryOrgId: string | null = null;
      if (deliveredPhone && deliveryPhoneNumberId) {
        const { data: exactSetting } = await supabase
          .from('organization_sms_settings')
          .select('organization_id')
          .eq('openphone_phone_number_id', deliveryPhoneNumberId)
          .maybeSingle();
        deliveryOrgId = exactSetting?.organization_id ?? null;

        if (!deliveryOrgId) {
          const { data: allSettings } = await supabase
            .from('organization_sms_settings')
            .select('organization_id, openphone_phone_number_id');
          const partial = (allSettings || []).find(s =>
            s.openphone_phone_number_id?.includes(deliveryPhoneNumberId) ||
            deliveryPhoneNumberId.includes(s.openphone_phone_number_id || '')
          );
          deliveryOrgId = partial?.organization_id ?? null;
        }

        if (!deliveryOrgId) {
          console.warn(
            `[openphone-webhook] Skipping campaign delivery update — no org for phoneNumberId ${deliveryPhoneNumberId}`,
          );
        }
      }

      if (deliveredPhone && deliveryOrgId) {
        const organizationId = deliveryOrgId;
        // Normalize phone for matching
        const normalizedPhone = deliveredPhone.replace(/\D/g, '');
        const phoneVariants = [
          deliveredPhone,
          `+${normalizedPhone}`,
          `+1${normalizedPhone.length === 10 ? normalizedPhone : ''}`,
        ].filter(Boolean);

        const deliveryCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        // Resolve the single most recent matching send first, then update it
        // by primary key. Never issue a blind multi-row update on this table.
        const { data: matchingSend, error: matchLookupErr } = await supabase
          .from('campaign_sms_sends')
          .select('id')
          .eq('organization_id', organizationId)
          .in('phone_number', phoneVariants)
          .eq('status', 'sent')
          .gte('sent_at', deliveryCutoff)
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (matchLookupErr) {
          console.error('[openphone-webhook] Failed to resolve campaign send for delivery receipt', {
            organization_id: organizationId,
            error: matchLookupErr.message,
          });
        } else if (matchingSend?.id) {
          const { error: campaignUpdateErr } = await supabase
            .from('campaign_sms_sends')
            .update({ status: 'delivered' })
            .eq('id', matchingSend.id)
            .eq('organization_id', organizationId);

          if (campaignUpdateErr) {
            console.error('[openphone-webhook] Failed to mark campaign send delivered', {
              organization_id: organizationId,
              send_id: matchingSend.id,
              error: campaignUpdateErr.message,
            });
          } else {
            console.log(
              `[openphone-webhook] Marked campaign send ${matchingSend.id} delivered for org ${organizationId}`,
            );
          }
        }
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Delivery status processed' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Missed inbound call → send a one-time textback so the lead isn't lost.
    if (isMissedCall) {
      const callObj = payload.data.object as any;
      // Keep the raw call object logged so the first real miss confirms the shape.
      console.log('[openphone-webhook] Missed call object:', JSON.stringify(callObj));

      try {
        // Inbound-only: an outbound miss would text our own number.
        const callDirection = (callObj.direction || '').toLowerCase();
        if (callDirection && callDirection !== 'incoming' && callDirection !== 'inbound') {
          console.log(`[openphone-webhook] Missed ${callDirection} call — no textback (not inbound)`);
          return new Response(JSON.stringify({ success: true, message: 'Missed non-inbound call' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const callerPhone: string = callObj.from;
        const callPhoneNumberId: string = callObj.phoneNumberId;
        if (!callerPhone || !callPhoneNumberId) {
          console.log('[openphone-webhook] Missed call missing from/phoneNumberId — cannot textback');
          return new Response(JSON.stringify({ success: true, message: 'Missed call logged (insufficient data)' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Resolve the org by phoneNumberId (exact, then partial match).
        let mcOrgId: string | undefined;
        let mcApiKey: string | undefined;
        let mcPhoneNumberId: string | undefined;
        let mcSmsEnabled = false;
        const { data: mcExact } = await supabase
          .from('organization_sms_settings')
          .select('organization_id, openphone_api_key, openphone_phone_number_id, sms_enabled')
          .eq('openphone_phone_number_id', callPhoneNumberId)
          .maybeSingle();
        if (mcExact?.organization_id) {
          mcOrgId = mcExact.organization_id;
          mcApiKey = mcExact.openphone_api_key ?? undefined;
          mcPhoneNumberId = mcExact.openphone_phone_number_id ?? undefined;
          mcSmsEnabled = !!mcExact.sms_enabled;
        } else {
          const { data: mcAll } = await supabase
            .from('organization_sms_settings')
            .select('organization_id, openphone_api_key, openphone_phone_number_id, sms_enabled');
          for (const s of mcAll || []) {
            if (s.openphone_phone_number_id?.includes(callPhoneNumberId) ||
                callPhoneNumberId.includes(s.openphone_phone_number_id || '')) {
              mcOrgId = s.organization_id;
              mcApiKey = s.openphone_api_key ?? undefined;
              mcPhoneNumberId = s.openphone_phone_number_id ?? undefined;
              mcSmsEnabled = !!s.sms_enabled;
              break;
            }
          }
        }

        if (!mcOrgId || !mcApiKey || !mcPhoneNumberId || !mcSmsEnabled) {
          console.log('[openphone-webhook] Missed call: org unresolved or SMS not configured — no textback');
          return new Response(JSON.stringify({ success: true, message: 'Missed call logged' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Automation toggle (seeded on by default).
        const { data: mcAutomation } = await supabase
          .from('organization_automations')
          .select('is_enabled, settings')
          .eq('organization_id', mcOrgId)
          .eq('automation_type', 'missed_call_textback')
          .maybeSingle();
        if (!mcAutomation?.is_enabled) {
          console.log(`[openphone-webhook] Missed call: textback disabled for org ${mcOrgId}`);
          return new Response(JSON.stringify({ success: true, message: 'Missed call logged (textback off)' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Normalize (digits only, drop US country code) for internal-number
        // matching and the cooldown key.
        const normDigits = (p: string) => (p || '').replace(/\D/g, '').replace(/^1/, '');
        const callerKey = normDigits(callerPhone);

        // Skip if the caller is staff or the owner.
        const [{ data: mcStaff }, { data: mcBiz }, { data: mcOrg }] = await Promise.all([
          supabase.from('staff').select('phone').eq('organization_id', mcOrgId).not('phone', 'is', null),
          supabase.from('business_settings').select('company_name, company_phone').eq('organization_id', mcOrgId).maybeSingle(),
          supabase.from('organizations').select('owner_id').eq('id', mcOrgId).maybeSingle(),
        ]);
        const internalKeys = new Set<string>();
        for (const s of mcStaff || []) { if ((s as any).phone) internalKeys.add(normDigits((s as any).phone)); }
        if ((mcBiz as any)?.company_phone) internalKeys.add(normDigits((mcBiz as any).company_phone));
        if ((mcOrg as any)?.owner_id) {
          const { data: mcOwner } = await supabase
            .from('profiles').select('phone').eq('id', (mcOrg as any).owner_id).maybeSingle();
          if ((mcOwner as any)?.phone) internalKeys.add(normDigits((mcOwner as any).phone));
        }
        if (internalKeys.has(callerKey)) {
          console.log(`[openphone-webhook] Missed call from staff/owner (${callerPhone}) — no textback`);
          return new Response(JSON.stringify({ success: true, message: 'Missed call from internal number' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Per-caller cooldown (24h) — a second ring the same day already has the text.
        const mcCooldownSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: mcRecent } = await supabase
          .from('automation_fire_log')
          .select('id')
          .eq('organization_id', mcOrgId)
          .eq('automation_type', 'missed_call_textback')
          .eq('target_id', callerKey)
          .gte('fired_at', mcCooldownSince)
          .limit(1);
        if (mcRecent && mcRecent.length > 0) {
          console.log(`[openphone-webhook] Missed call: textback already sent to ${callerPhone} within 24h — skipping`);
          return new Response(JSON.stringify({ success: true, message: 'Textback cooldown active' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // No AI, no persona, no escalation — just the org's wording, which they
        // can reword in Automation Center > Messages.
        const companyName = (mcBiz as any)?.company_name || 'our team';
        const mcTemplate =
          ((mcAutomation?.settings as { templates?: Record<string, string> } | null)
            ?.templates?.missed_call_textback) ?? null;
        const mcResolved = resolveTemplate('missed_call_textback', mcTemplate, {
          company_name: companyName,
        });
        if (mcResolved.warning) {
          console.warn(`[openphone-webhook] missed-call template org=${mcOrgId}: ${mcResolved.warning}`);
        }
        const textbackMessage =
          AUTOMATION_DEFAULTS.missed_call_textback.message_class === 'marketing'
            ? withStopSentence(mcResolved.text)
            : mcResolved.text;

        // Send via OpenPhone using the org's own number.
        let sendPhoneId = mcPhoneNumberId;
        if (sendPhoneId.includes('/')) { const m = sendPhoneId.match(/(PN[A-Za-z0-9]+)/); if (m) sendPhoneId = m[1]; }
        const mcAuthHeader = mcApiKey.trim().replace(/^Bearer\s+/i, '');
        let toPhoneFmt = callerPhone.replace(/\D/g, '');
        if (toPhoneFmt.length === 10) toPhoneFmt = `+1${toPhoneFmt}`;
        else if (!toPhoneFmt.startsWith('+')) toPhoneFmt = `+${toPhoneFmt}`;

        const mcSent = await sendOpenPhoneMessage({
          supabase,
          organizationId: mcOrgId,
          to: toPhoneFmt,
          content: textbackMessage,
          from: sendPhoneId,
          apiKey: mcAuthHeader,
          tag: 'openphone-webhook:missed-call-textback',
        });
        if (mcSent.skipped) {
          console.log(`[openphone-webhook] Missed-call textback skipped; ${toPhoneFmt} opted out`);
          return new Response(JSON.stringify({ success: true, skipped: true, reason: 'opted_out' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const mcSendResp = mcSent.response;
        if (!mcSendResp.ok) {
          const errText = await mcSendResp.text();
          console.error(`[openphone-webhook] Missed-call textback send failed (${mcSendResp.status}): ${errText}`);
          return new Response(JSON.stringify({ success: true, message: 'Missed call logged (textback send failed)' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const mcSendResult = await mcSendResp.json().catch(() => ({}));
        const textbackMsgId = (mcSendResult as any)?.data?.id || null;

        // Log to the thread so it appears in the conversation.
        let mcConvId: string | undefined;
        const { data: mcConv } = await supabase
          .from('sms_conversations')
          .select('id')
          .eq('organization_id', mcOrgId)
          .eq('customer_phone', toPhoneFmt)
          .maybeSingle();
        if (mcConv?.id) {
          mcConvId = mcConv.id;
        } else {
          const local = await findLocalContactName(supabase, mcOrgId, toPhoneFmt);
          const { data: mcNewConv } = await supabase
            .from('sms_conversations')
            .insert({
              organization_id: mcOrgId,
              customer_phone: toPhoneFmt,
              customer_name: local.name,
              customer_id: local.customerId,
            })
            .select('id')
            .single();
          mcConvId = mcNewConv?.id;
        }
        if (mcConvId) {
          await supabase.from('sms_messages').insert({
            conversation_id: mcConvId,
            organization_id: mcOrgId,
            direction: 'outbound',
            content: textbackMessage,
            status: 'sent',
            openphone_message_id: textbackMsgId,
            sent_at: new Date().toISOString(),
          });
          await supabase.from('sms_conversations')
            .update({ last_message_at: new Date().toISOString() })
            .eq('id', mcConvId);
        }

        // Record for the cooldown + a fire trail.
        await supabase.from('automation_fire_log').insert({
          organization_id: mcOrgId,
          automation_type: 'missed_call_textback',
          target_id: callerKey,
          metadata: { caller: toPhoneFmt, openphone_message_id: textbackMsgId, sent_at: new Date().toISOString() },
        });

        console.log(`[openphone-webhook] Missed-call textback sent to ${toPhoneFmt} for org ${mcOrgId}`);
        return new Response(JSON.stringify({ success: true, message: 'Missed-call textback sent' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (mcErr) {
        // Never fail the webhook over a textback problem.
        console.error('[openphone-webhook] Missed-call textback error:', mcErr);
        return new Response(JSON.stringify({ success: true, message: 'Missed call logged (textback errored)' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    if (!isInbound && !isOutbound) {
      console.log('[openphone-webhook] Ignoring event type:', payload.type);
      return new Response(
        JSON.stringify({ success: true, message: 'Event type ignored' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const message = payload.data.object;
    const fromPhone = message.from;
    const toPhone = message.to;
    const phoneNumberId = message.phoneNumberId; // This is always the org's OpenPhone number ID
    const content = message.body;
    const openphoneMessageId = message.id;
    const direction = isInbound ? 'inbound' : 'outbound';
    
    // Handle group chats: OpenPhone may send comma-separated phone numbers
    // For group messages, use the first phone number as the primary identifier
    // to avoid creating duplicate conversations for the same group
    const rawCustomerPhone = isInbound ? fromPhone : toPhone;
    const customerPhone = rawCustomerPhone.includes(',') 
      ? rawCustomerPhone.split(',')[0].trim() 
      : rawCustomerPhone;

    console.log(`[openphone-webhook] ${direction} SMS - from ${fromPhone} to ${toPhone} (phoneNumberId: ${phoneNumberId})`);

    // Find the organization by the OpenPhone phone number ID and get API key
    const { data: smsSettings, error: settingsError } = await supabase
      .from('organization_sms_settings')
      .select('organization_id, openphone_api_key')
      .eq('openphone_phone_number_id', phoneNumberId)
      .maybeSingle();

    // Also try matching by partial phone number ID (in case URL was stored)
    let organizationId = smsSettings?.organization_id;
    let openphoneApiKey = smsSettings?.openphone_api_key;
    
    if (!organizationId) {
      // Try finding by partial match
      const { data: allSettings } = await supabase
        .from('organization_sms_settings')
        .select('organization_id, openphone_phone_number_id, openphone_api_key');

      if (allSettings) {
        for (const setting of allSettings) {
          if (setting.openphone_phone_number_id?.includes(phoneNumberId) ||
              phoneNumberId.includes(setting.openphone_phone_number_id || '')) {
            organizationId = setting.organization_id;
            openphoneApiKey = setting.openphone_api_key;
            break;
          }
        }
      }
    }

    if (!organizationId) {
      console.error("[openphone-webhook] Could not find organization for phone number ID:", phoneNumberId);
      return new Response(
        JSON.stringify({ success: false, error: "Organization not found for this phone number" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[openphone-webhook] Found organization: ${organizationId}`);

    // Find or create conversation using the customer phone (not the org's OpenPhone number)
    const { data: existingConversation } = await supabase
      .from('sms_conversations')
      .select('id, customer_name')
      .eq('organization_id', organizationId)
      .eq('customer_phone', customerPhone)
      .maybeSingle();

    let conversationId: string;
    let needsContactLookup = false;

    if (existingConversation) {
      conversationId = existingConversation.id;
      needsContactLookup = !existingConversation.customer_name;
      console.log(`[openphone-webhook] Found existing conversation: ${conversationId}, has name: ${!needsContactLookup}`);
    } else {
      // Try to find contact using normalized phone matching across customers, leads, staff
      const localContact = await findLocalContactName(supabase, organizationId, customerPhone);
      let customerName = localContact.name;
      let customerId = localContact.customerId;
      
      // If no local match found, try OpenPhone contacts API
      if (!customerName && openphoneApiKey) {
        customerName = await fetchOpenPhoneContactName(customerPhone, openphoneApiKey);
      }
      
      needsContactLookup = !customerName;

      // Create new conversation
      const { data: newConversation, error: createError } = await supabase
        .from('sms_conversations')
        .insert({
          organization_id: organizationId,
          customer_phone: customerPhone,
          customer_name: customerName,
          customer_id: customerId,
        })
        .select('id')
        .single();

      if (createError) {
        console.error("[openphone-webhook] Error creating conversation:", createError);
        return new Response(
          JSON.stringify({ success: false, error: "Failed to create conversation" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      conversationId = newConversation.id;
      console.log(`[openphone-webhook] Created new conversation: ${conversationId}, name: ${customerName || 'unknown'}`);
    }

    // If existing conversation has no name, try local DB + OpenPhone
    if (needsContactLookup && existingConversation) {
      // First try normalized local matching
      const localContact = await findLocalContactName(supabase, organizationId, customerPhone);
      let contactName = localContact.name;
      
      // Fallback to OpenPhone API
      if (!contactName && openphoneApiKey) {
        contactName = await fetchOpenPhoneContactName(customerPhone, openphoneApiKey);
      }
      
      if (contactName) {
        await supabase
          .from('sms_conversations')
          .update({ 
            customer_name: contactName,
            ...(localContact.customerId ? { customer_id: localContact.customerId } : {})
          })
          .eq('id', conversationId);
        console.log(`[openphone-webhook] Updated conversation with contact name: ${contactName}`);
      }
    }

    // Check if message already exists (avoid duplicates from our app sending)
    const { data: existingMessage } = await supabase
      .from('sms_messages')
      .select('id')
      .eq('openphone_message_id', openphoneMessageId)
      .maybeSingle();
    
    if (existingMessage) {
      console.log(`[openphone-webhook] Message ${openphoneMessageId} already exists, skipping`);
      return new Response(
        JSON.stringify({ success: true, message: "Message already exists" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract media URLs from OpenPhone MMS
    const mediaUrls = message.media?.map((m) => m.url).filter(Boolean) || null;

    // Classify before insert. A single-word CANCEL or END still opts out, and
    // it is still written to sms_messages so a person sees it in the inbox.
    // A keyword inside a normal sentence is not an opt-out; it is flagged.
    // START / UNSTOP use the same whole-message normalization. They resubscribe
    // only an sms_stop opt-out, and they do not send a second text.
    const inboundText = direction === 'inbound' && typeof content === 'string' ? content : null;
    const optOutClassification = inboundText
      ? classifySmsOptOut(inboundText)
      : { optOut: false, needsReview: false, matched: null };
    const resubscribeKeyword = inboundText ? isExactResubscribe(inboundText) : false;

    let consentStep: ReturnType<typeof nextSmsConsent> | null = null;
    let customerIdForConsent: string | null = null;
    let consentCampaignId: string | null = null;
    if (inboundText && (optOutClassification.optOut || resubscribeKeyword)) {
      try {
        const { data: lastSend } = await supabase
          .from('campaign_sms_sends')
          .select('campaign_id, customer_id')
          .eq('organization_id', organizationId)
          .eq('phone_number', customerPhone)
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const { data: convData } = await supabase
          .from('sms_conversations')
          .select('customer_id')
          .eq('id', conversationId)
          .maybeSingle();
        customerIdForConsent =
          convData?.customer_id ||
          lastSend?.customer_id ||
          (await findCustomerIdByPhone(supabase, organizationId, customerPhone));
        consentCampaignId = lastSend?.campaign_id || null;
        if (customerIdForConsent) {
          const current = await loadSmsConsent(supabase, organizationId, customerIdForConsent);
          if (current) {
            consentStep = nextSmsConsent(
              current,
              inboundText,
              new Date().toISOString(),
              optOutClassification.optOut ? consentCampaignId : null,
            );
          }
        }
      } catch (consentLookupErr) {
        console.error('[openphone-webhook] consent lookup failed:', consentLookupErr);
      }
    }

    const flagForReview = optOutClassification.needsReview || consentStep?.optOutReview === true;

    const messageRow: Record<string, unknown> = {
      conversation_id: conversationId,
      organization_id: organizationId,
      direction: direction,
      content: content,
      status: direction === 'inbound' ? 'received' : 'sent',
      openphone_message_id: openphoneMessageId,
      sent_at: message.createdAt || new Date().toISOString(),
      media_urls: mediaUrls?.length ? mediaUrls : null,
    };
    if (flagForReview) messageRow.opt_out_review = true;

    let messageError: { message?: string } | null = null;
    let savedMessageId: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const inserted = await supabase.from('sms_messages').insert(messageRow).select('id').maybeSingle();
      messageError = inserted.error;
      savedMessageId = (inserted.data as { id?: string } | null)?.id ?? null;
      if (!messageError) break;
      const missing = messageError.message?.match(/'([a-z0-9_]+)' column/i)?.[1];
      if (missing && missing === 'opt_out_review' && missing in messageRow) {
        console.error(
          '[openphone-webhook] opt_out_review column is missing — saving the message without the review flag. ' +
          'Run migration 20261015040000 in the Supabase SQL editor.',
        );
        delete messageRow[missing];
        continue;
      }
      break;
    }

    if (messageError) {
      console.error("[openphone-webhook] Error inserting message:", messageError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to save message" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update conversation's last_message_at and increment unread_count for inbound only
    if (direction === 'inbound') {
      // First get current unread count
      const { data: currentConv } = await supabase
        .from('sms_conversations')
        .select('unread_count')
        .eq('id', conversationId)
        .single();

      const newUnreadCount = (currentConv?.unread_count || 0) + 1;

      await supabase
        .from('sms_conversations')
        .update({
          last_message_at: new Date().toISOString(),
          unread_count: newUnreadCount,
        })
        .eq('id', conversationId);
    } else {
      // For outbound, just update last_message_at
      await supabase
        .from('sms_conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversationId);
    }

    console.log(`[openphone-webhook] Successfully saved ${direction} message`);

    // blockAiReply gates the AI auto-reply below regardless of whether the
    // opt-out row was saved. A customer who just texted STOP must not get an
    // automated reply from THIS webhook delivery. The confirmation text is
    // different: it is sent only after that save succeeds.
    const blockAiReply = optOutClassification.optOut || consentStep?.suppressAi === true;
    const matchedOptOut = optOutClassification.matched ?? '';

    if (optOutClassification.optOut) {
      let optOutSaved = false;
      try {
        if (customerIdForConsent && consentStep?.persist) {
          optOutSaved = await persistSmsConsent(
            supabase,
            organizationId,
            customerIdForConsent,
            consentStep.state,
          );
          if (optOutSaved) {
            console.log(`[openphone-webhook] Customer ${customerIdForConsent} opted out via SMS keyword "${matchedOptOut}"`);
          }
        } else if (!customerIdForConsent || !consentStep) {
          console.error(
            `[openphone-webhook] CRITICAL: STOP RECEIVED BUT NOT RECORDED — inbound "${matchedOptOut}" ` +
            `from phone ${customerPhone} (org ${organizationId}) could not be resolved to a customer ` +
            `via conversation, campaign send, or phone lookup. This opt-out must be applied by hand.`,
          );
        } else {
          console.log(
            `[openphone-webhook] Inbound "${matchedOptOut}" from ${customerPhone} (org ${organizationId}) ` +
            `left an existing non-sms opt-out in place. Confirmation not sent.`,
          );
        }
      } catch (optOutErr) {
        console.error('[openphone-webhook] Error processing opt-out:', optOutErr);
      }

      // One confirmation, and only after the opt-out row is saved. Not marketing.
      // allowOptedOut is what lets this receipt leave after marketing_status is opted_out.
      if (optOutSaved && consentStep?.sendConfirmation) {
        try {
          await sendSmsOptOutConfirmation(supabase, {
            organizationId,
            conversationId,
            customerPhone,
            openphoneApiKey,
            phoneNumberId,
          });
        } catch (confirmErr) {
          console.error('[openphone-webhook] opt-out confirmation failed:', confirmErr);
        }
      } else if (consentStep?.persist) {
        console.error(
          `[openphone-webhook] Opt-out confirmation NOT sent for org ${organizationId} ` +
          `("${matchedOptOut}") because the opt-out save did not succeed.`,
        );
      }
    }

    if (consentStep?.smsResubscribed && consentStep.persist && customerIdForConsent) {
      try {
        const resubscribed = await persistSmsConsent(
          supabase,
          organizationId,
          customerIdForConsent,
          consentStep.state,
        );
        if (resubscribed && savedMessageId) {
          const { error: flagError } = await supabase
            .from('sms_messages')
            .update({ sms_resubscribed: true })
            .eq('id', savedMessageId)
            .eq('organization_id', organizationId);
          if (flagError) {
            console.error(
              '[openphone-webhook] Resubscribe saved but sms_resubscribed was not set. ' +
              'Run migration 20261015040000 in the Supabase SQL editor.',
              flagError,
            );
          }
        }
        if (resubscribed) {
          console.log(`[openphone-webhook] Customer ${customerIdForConsent} resubscribed via SMS. No confirmation text.`);
        }
      } catch (resubErr) {
        console.error('[openphone-webhook] Error processing resubscribe:', resubErr);
      }
    }

    // Trigger AI auto-reply for inbound messages if automation is enabled
    // — never for a message that was just detected as an opt-out, and never
    // for START while a non-sms opt-out is still in place.
    if (direction === 'inbound' && !blockAiReply) {
      try {
        const { data: aiAutomation } = await supabase
          .from('organization_automations')
          .select('is_enabled')
          .eq('organization_id', organizationId)
          .eq('automation_type', 'ai_sms_reply')
          .maybeSingle();

        if (aiAutomation?.is_enabled === true) {
          // Fetch customer name for the AI context
          const { data: convData } = await supabase
            .from('sms_conversations')
            .select('customer_name')
            .eq('id', conversationId)
            .maybeSingle();

          const supabasePublicUrl = Deno.env.get("SUPABASE_URL");

          // Fire-and-forget: don't await so webhook returns immediately.
          // internalDispatchHeaders sends x-internal-secret when
          // INTERNAL_DISPATCH_SECRET is set, and only falls back to the
          // service-role bearer while that secret is still unset.
          fetch(`${supabasePublicUrl}/functions/v1/openphone-ai-sms-reply`, {
            method: 'POST',
            headers: internalDispatchHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              conversationId,
              organizationId,
              inboundMessage: content,
              customerPhone,
              customerName: convData?.customer_name || null,
            }),
          }).catch((err) => {
            console.error('[openphone-webhook] AI reply trigger error:', err);
          });

          console.log(`[openphone-webhook] AI auto-reply triggered for conversation ${conversationId}`);
        }
      } catch (aiErr) {
        // Non-fatal: log but don't fail the webhook
        console.error('[openphone-webhook] Error checking AI automation:', aiErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[openphone-webhook] Error:", errorMessage);

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
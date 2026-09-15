// Pulls recent OpenPhone messages into the app using only the org API key
// and OpenPhone phone number ID. This is the inbound path when webhooks are
// intentionally not used.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyOrgAccess } from "../_shared/verify-org-access.ts";
import { logAudit, AuditActions } from "../_shared/audit-log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type SyncRequest = {
  organizationId?: string;
  maxConversations?: number;
  daysBack?: number;
  pageToken?: string;
};

type ContactMatch = { name: string | null; customerId: string | null; type: "client" | "cleaner" };

function normalizePhoneDigits(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.substring(1) : digits;
}

function toE164(phone: string): string {
  const raw = String(phone || "").trim();
  if (raw.startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw;
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

function extractPhoneNumberId(value: string): string {
  const pnMatch = String(value || "").match(/(PN[A-Za-z0-9]+)/);
  return pnMatch ? pnMatch[1] : String(value || "").trim();
}

/**
 * The saved openphone_phone_number_id drifts: a number can be removed from the
 * OpenPhone workspace, or the saved value can be an E.164 number / an id that
 * belongs to a different API key. OpenPhone then answers the conversations
 * endpoint with 404 "No phone numbers found for the given input" and the whole
 * org sync aborts. So ask the account what it actually owns and reconcile.
 * Returns null when the key owns no numbers at all (a credentials/setup issue
 * the caller should report plainly).
 */
async function resolvePhoneNumberId(apiKey: string, stored: string): Promise<string | null> {
  const res = await fetch("https://api.openphone.com/v1/phone-numbers", {
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const numbers = Array.isArray(json?.data) ? json.data : [];
  if (numbers.length === 0) return null;

  const ids = numbers.map((n: any) => String(n?.id || "")).filter(Boolean);
  if (ids.includes(stored)) return stored;

  // Stored value may be the phone number itself rather than the PN id.
  const storedDigits = normalizePhoneDigits(stored);
  if (storedDigits) {
    const byNumber = numbers.find((n: any) => normalizePhoneDigits(String(n?.number || "")) === storedDigits);
    if (byNumber?.id) return String(byNumber.id);
  }

  // Single-number accounts are the common case — use the one number they own.
  return ids[0] || null;
}

function messageText(msg: any): string {
  const text = msg?.text ?? msg?.body ?? msg?.content ?? msg?.message ?? "";
  return typeof text === "string" ? text : String(text || "");
}

function messageMediaUrls(msg: any): string[] | null {
  const candidates = [msg?.mediaUrls, msg?.media, msg?.attachments, msg?.files].find(Array.isArray) || [];
  const urls = candidates
    .map((item: any) => typeof item === "string" ? item : item?.url ?? item?.fileUrl ?? item?.src)
    .filter((url: unknown): url is string => typeof url === "string" && url.length > 0);
  return urls.length > 0 ? urls : null;
}

function messageDirection(msg: any): "inbound" | "outbound" {
  const direction = String(msg?.direction || "").toLowerCase();
  return direction === "incoming" || direction === "inbound" ? "inbound" : "outbound";
}

function externalPhoneForMessage(msg: any, participants: string[]): string {
  const direction = messageDirection(msg);
  const raw = direction === "inbound" ? msg?.from : msg?.to;
  if (Array.isArray(raw)) return toE164(raw[0] || participants[0] || "");
  return toE164(raw || participants[0] || "");
}

async function buildContactLookup(supabase: any, organizationId: string) {
  const [customersRes, leadsRes, staffRes] = await Promise.all([
    supabase
      .from("customers")
      .select("id, first_name, last_name, phone")
      .eq("organization_id", organizationId)
      .not("phone", "is", null),
    supabase
      .from("leads")
      .select("id, name, phone")
      .eq("organization_id", organizationId)
      .not("phone", "is", null),
    supabase
      .from("staff")
      .select("id, name, phone")
      .eq("organization_id", organizationId)
      .not("phone", "is", null),
  ]);

  const lookup = new Map<string, ContactMatch>();
  for (const c of customersRes.data || []) {
    if (!c.phone) continue;
    lookup.set(normalizePhoneDigits(c.phone), {
      name: `${c.first_name || ""} ${c.last_name || ""}`.trim() || null,
      customerId: c.id,
      type: "client",
    });
  }
  for (const l of leadsRes.data || []) {
    if (!l.phone) continue;
    const key = normalizePhoneDigits(l.phone);
    if (!lookup.has(key)) lookup.set(key, { name: l.name || null, customerId: null, type: "client" });
  }
  for (const s of staffRes.data || []) {
    if (!s.phone) continue;
    const key = normalizePhoneDigits(s.phone);
    if (!lookup.has(key)) lookup.set(key, { name: s.name || null, customerId: null, type: "cleaner" });
  }
  return lookup;
}

async function syncOrganization(
  supabase: any,
  organizationId: string,
  options: { maxConversations: number; daysBack: number; pageToken?: string },
) {
  const summary = {
    organizationId,
    conversationsChecked: 0,
    messagesFetched: 0,
    inserted: 0,
    errors: 0,
    nextPageToken: null as string | null,
    latestInboundAt: null as string | null,
    latestOutboundAt: null as string | null,
  };

  const { data: settings, error: settingsError } = await supabase
    .from("organization_sms_settings")
    .select("openphone_api_key, openphone_phone_number_id, sms_enabled")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (settingsError) throw new Error("Failed to read SMS settings");
  if (!settings?.sms_enabled) throw new Error("SMS is disabled for this organization");
  if (!settings?.openphone_api_key || !settings?.openphone_phone_number_id) {
    throw new Error("OpenPhone API key and phone number ID are required");
  }

  const apiKey = String(settings.openphone_api_key).trim().replace(/^Bearer\s+/i, "");
  const storedPhoneNumberId = extractPhoneNumberId(settings.openphone_phone_number_id);
  const resolved = await resolvePhoneNumberId(apiKey, storedPhoneNumberId);
  if (!resolved) {
    throw new Error(
      "OpenPhone did not return any phone numbers for this API key. Reconnect OpenPhone in Settings → SMS.",
    );
  }
  if (resolved !== storedPhoneNumberId) {
    console.log(`[sync-openphone-messages] org=${organizationId} stored phone id ${storedPhoneNumberId} not owned by this key; using ${resolved}`);
  }
  const phoneNumberId = resolved;
  const createdAfter = new Date(Date.now() - options.daysBack * 24 * 60 * 60 * 1000).toISOString();
  const contactLookup = await buildContactLookup(supabase, organizationId);

  const { data: existingConversations } = await supabase
    .from("sms_conversations")
    .select("id, customer_phone")
    .eq("organization_id", organizationId);

  const conversationByPhone = new Map<string, string>();
  for (const conv of existingConversations || []) {
    conversationByPhone.set(normalizePhoneDigits(conv.customer_phone), conv.id);
  }

  const convUrl = new URL("https://api.openphone.com/v1/conversations");
  convUrl.searchParams.append("phoneNumbers", phoneNumberId);
  convUrl.searchParams.set("updatedAfter", createdAfter);
  convUrl.searchParams.set("maxResults", String(options.maxConversations));
  if (options.pageToken) convUrl.searchParams.set("pageToken", options.pageToken);

  const convResponse = await fetch(convUrl.toString(), {
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
  });

  if (!convResponse.ok) {
    const errText = await convResponse.text();
    throw new Error(`OpenPhone conversations API failed (${convResponse.status}): ${errText.slice(0, 160)}`);
  }

  const convData = await convResponse.json();
  const openPhoneConversations = Array.isArray(convData?.data) ? convData.data : [];
  summary.nextPageToken = convData?.nextPageToken || null;
  summary.conversationsChecked = openPhoneConversations.length;

  for (const openPhoneConversation of openPhoneConversations) {
    const participants = Array.isArray(openPhoneConversation?.participants)
      ? openPhoneConversation.participants.map((p: string) => toE164(p)).filter(Boolean)
      : [];
    if (participants.length === 0) continue;

    try {
      const msgUrl = new URL("https://api.openphone.com/v1/messages");
      msgUrl.searchParams.set("phoneNumberId", phoneNumberId);
      for (const participant of participants) msgUrl.searchParams.append("participants", participant);
      msgUrl.searchParams.set("createdAfter", createdAfter);
      msgUrl.searchParams.set("maxResults", "100");

      const msgResponse = await fetch(msgUrl.toString(), {
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
      });
      if (!msgResponse.ok) {
        await msgResponse.text();
        summary.errors++;
        continue;
      }

      const msgData = await msgResponse.json();
      const openPhoneMessages = (Array.isArray(msgData?.data) ? msgData.data : [])
        .filter((msg: any) => messageText(msg).trim().length > 0 || messageMediaUrls(msg));
      if (openPhoneMessages.length === 0) continue;
      summary.messagesFetched += openPhoneMessages.length;

      const customerPhone = externalPhoneForMessage(openPhoneMessages[0], participants);
      if (!customerPhone) {
        summary.errors++;
        continue;
      }

      const normalizedPhone = normalizePhoneDigits(customerPhone);
      let conversationId = conversationByPhone.get(normalizedPhone);
      if (!conversationId) {
        const contact = contactLookup.get(normalizedPhone);
        const latestMessageAt = openPhoneMessages.reduce((latest: string, msg: any) => {
          const createdAt = msg?.createdAt || msg?.created_at || "";
          return createdAt > latest ? createdAt : latest;
        }, openPhoneConversation?.lastActivityAt || new Date().toISOString());

        const { data: newConversation, error: conversationError } = await supabase
          .from("sms_conversations")
          .insert({
            organization_id: organizationId,
            customer_phone: customerPhone,
            customer_name: contact?.name || openPhoneConversation?.name || null,
            customer_id: contact?.customerId || null,
            conversation_type: contact?.type || "client",
            last_message_at: latestMessageAt,
          })
          .select("id")
          .single();

        if (conversationError) {
          console.error("[sync-openphone-messages] conversation insert error", conversationError);
          summary.errors++;
          continue;
        }

        const newConversationId = newConversation.id as string;
        conversationId = newConversationId;
        if (normalizedPhone) conversationByPhone.set(normalizedPhone, newConversationId);
      }

      const rows = openPhoneMessages.map((msg: any) => {
        const direction = messageDirection(msg);
        const sentAt = msg?.createdAt || msg?.created_at || new Date().toISOString();
        if (direction === "inbound" && (!summary.latestInboundAt || sentAt > summary.latestInboundAt)) {
          summary.latestInboundAt = sentAt;
        }
        if (direction === "outbound" && (!summary.latestOutboundAt || sentAt > summary.latestOutboundAt)) {
          summary.latestOutboundAt = sentAt;
        }
        return {
          conversation_id: conversationId,
          organization_id: organizationId,
          direction,
          content: messageText(msg),
          status: msg?.status || (direction === "inbound" ? "received" : "sent"),
          openphone_message_id: msg?.id || null,
          sent_at: sentAt,
          media_urls: messageMediaUrls(msg),
        };
      });

      const openPhoneIds = rows
        .map((row: any) => row.openphone_message_id)
        .filter((id: string | null): id is string => !!id);
      const existingMessageIds = new Set<string>();
      if (openPhoneIds.length > 0) {
        const { data: existingMessages } = await supabase
          .from("sms_messages")
          .select("openphone_message_id")
          .eq("organization_id", organizationId)
          .in("openphone_message_id", openPhoneIds);
        for (const existing of existingMessages || []) existingMessageIds.add(existing.openphone_message_id);
      }

      // Dedupe inside the batch too: OpenPhone can return the same message id
      // twice in one page, and the pre-check above only removes ids that are
      // ALREADY in the database.
      const seenInBatch = new Set<string>();
      const newlyInserted = rows.filter((row: any) => {
        if (!row.openphone_message_id) return false;
        if (existingMessageIds.has(row.openphone_message_id)) return false;
        if (seenInBatch.has(row.openphone_message_id)) return false;
        seenInBatch.add(row.openphone_message_id);
        return true;
      });

      let actuallyInserted = newlyInserted.length;
      if (newlyInserted.length > 0) {
        const { error: insertError } = await supabase
          .from("sms_messages")
          .insert(newlyInserted);

        if (insertError) {
          // A concurrent sync run can insert the same id between our SELECT and
          // this INSERT. Postgres aborts the WHOLE statement on 23505, which
          // used to drop every genuinely-new message in the batch. Fall back to
          // per-row inserts and skip only the real duplicates.
          console.error("[sync-openphone-messages] batch insert failed, retrying row-by-row", insertError);
          actuallyInserted = 0;
          for (const row of newlyInserted) {
            const { error: rowError } = await supabase.from("sms_messages").insert(row);
            if (!rowError) {
              actuallyInserted++;
            } else if ((rowError as any).code !== "23505") {
              console.error("[sync-openphone-messages] message insert error", rowError);
              summary.errors++;
            }
          }
        }
      }

      summary.inserted += actuallyInserted;

      const unreadDelta = newlyInserted.filter((row: any) => row.direction === "inbound").length;
      const latestMessageAt = rows.reduce((latest: string, row: any) => row.sent_at > latest ? row.sent_at : latest, "");
      if (latestMessageAt) {
        const updatePayload: Record<string, unknown> = { last_message_at: latestMessageAt };
        if (unreadDelta > 0) {
          const { data: currentConv } = await supabase
            .from("sms_conversations")
            .select("unread_count")
            .eq("id", conversationId)
            .maybeSingle();
          updatePayload.unread_count = (currentConv?.unread_count || 0) + unreadDelta;
        }
        await supabase.from("sms_conversations").update(updatePayload).eq("id", conversationId);
      }
    } catch (conversationError) {
      console.error("[sync-openphone-messages] conversation sync error", conversationError);
      summary.errors++;
    }
  }

  return summary;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const body = (await req.json().catch(() => ({}))) as SyncRequest;
    const cronSecret = Deno.env.get("CRON_SECRET");
    const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    const maxConversations = Math.min(Math.max(Number(body.maxConversations || (isCron ? 25 : 50)), 1), 100);
    const daysBack = Math.min(Math.max(Number(body.daysBack || (isCron ? 2 : 30)), 1), 180);

    let organizationIds: string[] = [];
    let callerId = "system";

    if (body.organizationId) {
      const access = await verifyOrgAccess(req, body.organizationId);
      if (!access.ok) {
        return new Response(JSON.stringify({ success: false, error: access.error }), {
          status: access.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      callerId = access.callerId;
      organizationIds = [body.organizationId];
    } else if (isCron) {
      const { data: settingsRows, error } = await supabase
        .from("organization_sms_settings")
        .select("organization_id")
        .eq("sms_enabled", true)
        .not("openphone_api_key", "is", null)
        .not("openphone_phone_number_id", "is", null);
      if (error) throw error;
      organizationIds = (settingsRows || []).map((row: any) => row.organization_id);
    } else {
      return new Response(JSON.stringify({ success: false, error: "organizationId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const reports = [];
    for (const organizationId of organizationIds) {
      try {
        const report = await syncOrganization(supabase, organizationId, {
          maxConversations,
          daysBack,
          pageToken: body.pageToken,
        });
        reports.push({ success: true, ...report });
        logAudit({
          action: AuditActions.SMS_GENERIC,
          organizationId,
          userId: callerId === "system" ? undefined : callerId,
          resourceType: "openphone_sync",
          success: true,
          details: { inserted: report.inserted, checked: report.conversationsChecked, errors: report.errors },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown sync error";
        reports.push({ success: false, organizationId, error: errorMessage });
        logAudit({
          action: AuditActions.SMS_GENERIC,
          organizationId,
          userId: callerId === "system" ? undefined : callerId,
          resourceType: "openphone_sync",
          success: false,
          error: errorMessage,
        });
      }
    }

    const inserted = reports.reduce((sum, report: any) => sum + (report.inserted || 0), 0);
    const errors = reports.reduce((sum, report: any) => sum + (report.errors || (report.success ? 0 : 1) || 0), 0);

    return new Response(JSON.stringify({ success: errors === 0, inserted, errors, reports }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[sync-openphone-messages] fatal", error);
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
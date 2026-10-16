import {
  resolveTemplate,
  withStopSentence,
  AUTOMATION_DEFAULTS,
} from "../_shared/automation-templates.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { filterOptedIn } from "../_shared/marketing-guard.ts";
import { sendOpenPhoneMessage } from "../_shared/send-sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  // Cron auth gate (allows manual invocation only with x-cron-secret)
  const cronGate = requireCronSecret(req);
  if (cronGate) return cronGate;


  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const now = new Date().toISOString();
    const BATCH = 50;
    const MAX_PER_RUN = 200;   // safety ceiling; remainder drains on the next cron run
    let sentCount = 0;
    let processedTotal = 0;

    // Drain the queue oldest-first. Deferred rows are excluded in SQL so they
    // don't consume the batch, and we page until nothing's ready (capped per run).
    while (processedTotal < MAX_PER_RUN) {
      const { data: batch, error: fetchError } = await supabase
        .from("recurring_offer_queue")
        .select("id, booking_id, customer_id, organization_id, defer_count, deferred_until")
        .eq("sent", false)
        .eq("cancelled", false)
        .lte("send_at", now)
        .or(`deferred_until.is.null,deferred_until.lte.${now}`)
        .order("send_at", { ascending: true })
        .limit(BATCH);

      if (fetchError) {
        console.error("[process-recurring-offers] Fetch error:", fetchError);
        throw fetchError;
      }
      if (!batch || batch.length === 0) break;

      console.log(`[process-recurring-offers] Processing ${batch.length} items`);

      // Pre-fetch automation settings for this batch's orgs
      const orgIds = [...new Set(batch.map(i => i.organization_id))];
      const { data: automationSettings } = await supabase
        .from("organization_automations")
        .select("organization_id, is_enabled, settings")
        .in("organization_id", orgIds)
        .eq("automation_type", "recurring_upsell");
      const automationMap = new Map((automationSettings || []).map(a => [a.organization_id, a.is_enabled]));
      const templateMap = new Map(
        (automationSettings || []).map(a => [
          a.organization_id,
          ((a.settings as { templates?: Record<string, string> } | null)?.templates
            ?.recurring_upsell) ?? null,
        ]),
      );

      // MARKETING CONSENT: this is a promotional upsell, so drop opted-out
      // customers before the send loop. filterOptedIn is org-scoped and fails
      // closed (empty list) on error, so group the batch by organization.
      const sendable: typeof batch = [];
      for (const orgId of orgIds) {
        const orgItems = batch.filter(i => i.organization_id === orgId);
        const optedIn = await filterOptedIn(
          supabase,
          orgId,
          orgItems.map(i => ({ id: i.customer_id, item: i })),
        );
        const keptIds = new Set(optedIn.map(r => r.id));
        for (const dropped of orgItems.filter(i => !keptIds.has(i.customer_id))) {
          console.info(
            `[process-recurring-offers] Skipping opted-out customer | org:${orgId} customer:${dropped.customer_id}`,
          );
        }
        sendable.push(...optedIn.map(r => r.item));
      }

    for (const item of sendable) {
      try {
        // Check if automation is enabled for this org
        if (automationMap.has(item.organization_id) && !automationMap.get(item.organization_id)) {
          await supabase.from("recurring_offer_queue")
            .update({ cancelled: true, cancelled_reason: "Automation disabled" })
            .eq("id", item.id);
          continue;
        }
        // 1. Re-check if customer now has active recurring service
        const { data: activeRecurring } = await supabase
          .from("recurring_bookings")
          .select("id")
          .eq("customer_id", item.customer_id)
          .eq("is_active", true)
          .limit(1);

        if (activeRecurring && activeRecurring.length > 0) {
          await supabase.from("recurring_offer_queue")
            .update({ cancelled: true, cancelled_reason: "Recurring service already active" })
            .eq("id", item.id);
          console.log(`[process-recurring-offers] Cancelled for customer ${item.customer_id}: recurring already active`);
          continue;
        }

        // 2. Check review rating
        const { data: review } = await supabase
          .from("review_requests")
          .select("rating")
          .eq("booking_id", item.booking_id)
          .not("rating", "is", null)
          .maybeSingle();

        const { data: portalFeedback } = await supabase
          .from("client_portal_feedback")
          .select("rating")
          .eq("booking_id", item.booking_id)
          .maybeSingle();

        const rating = review?.rating || portalFeedback?.rating || null;

        if (rating !== null) {
          if (rating <= 3) {
            await supabase.from("recurring_offer_queue")
              .update({ cancelled: true, cancelled_reason: `Low rating: ${rating} stars` })
              .eq("id", item.id);
            console.log(`[process-recurring-offers] Cancelled for customer ${item.customer_id}: rating ${rating} stars`);
            continue;
          }
          // 4-5 stars → proceed to send
        } else {
          // No review yet — defer up to 7 days
          if (item.defer_count === 0) {
            const deferUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            await supabase.from("recurring_offer_queue")
              .update({ deferred_until: deferUntil, defer_count: 1 })
              .eq("id", item.id);
            console.log(`[process-recurring-offers] Deferred customer ${item.customer_id} by 7 days (no review yet)`);
            continue;
          }
          // After 7-day deferral with no review → send anyway per requirements
        }

        // 3. Get customer details
        const { data: customer } = await supabase
          .from("customers")
          .select("first_name, last_name, phone")
          .eq("id", item.customer_id)
          .single();

        if (!customer?.phone) {
          await supabase.from("recurring_offer_queue")
            .update({ sent: true, sent_at: now, error: "No customer phone" })
            .eq("id", item.id);
          continue;
        }

        // 4. Get SMS settings
        const { data: smsSettings } = await supabase
          .from("organization_sms_settings")
          .select("openphone_api_key, openphone_phone_number_id, sms_enabled")
          .eq("organization_id", item.organization_id)
          .maybeSingle();

        if (!smsSettings?.sms_enabled || !smsSettings.openphone_api_key || !smsSettings.openphone_phone_number_id) {
          await supabase.from("recurring_offer_queue")
            .update({ sent: true, sent_at: now, error: "SMS not configured" })
            .eq("id", item.id);
          continue;
        }

        // 5. Get business settings for company name
        const { data: businessSettings } = await supabase
          .from("business_settings")
          .select("company_name")
          .eq("organization_id", item.organization_id)
          .maybeSingle();

        const companyName = businessSettings?.company_name || "Your cleaning service";

        // Build message
        const resolved = resolveTemplate(
          "recurring_upsell",
          templateMap.get(item.organization_id) ?? null,
          { customer_name: `${customer.first_name || ""}`.trim() || "there", company_name: companyName },
        );
        if (resolved.warning) {
          console.warn(`[process-recurring-offers] org=${item.organization_id}: ${resolved.warning}`);
        }
        const message =
          AUTOMATION_DEFAULTS.recurring_upsell.message_class === "marketing"
            ? withStopSentence(resolved.text)
            : resolved.text;

        // 6. Send via OpenPhone
        let phoneNumberId = smsSettings.openphone_phone_number_id;
        if (phoneNumberId.includes("/")) {
          const match = phoneNumberId.match(/(PN[A-Za-z0-9]+)/);
          if (match) phoneNumberId = match[1];
        }
        if (phoneNumberId.includes("openphone.com")) {
          const match = phoneNumberId.match(/phone-numbers\/([A-Za-z0-9]+)/);
          if (match) phoneNumberId = match[1];
        }

        const authHeader = smsSettings.openphone_api_key.trim().replace(/^Bearer\s+/i, "");

        let formattedPhone = customer.phone.replace(/\D/g, "");
        if (formattedPhone.length === 10) formattedPhone = `+1${formattedPhone}`;
        else if (!formattedPhone.startsWith("+")) formattedPhone = `+${formattedPhone}`;

        const offerSent = await sendOpenPhoneMessage({
          supabase,
          organizationId: item.organization_id,
          to: formattedPhone,
          content: message,
          from: phoneNumberId,
          apiKey: authHeader,
          tag: "process-recurring-offers",
        });
        if (offerSent.skipped) {
          await supabase.from("recurring_offer_queue")
            .update({ sent: true, sent_at: now, error: "opted_out" })
            .eq("id", item.id);
          continue;
        }
        const openPhoneResponse = offerSent.response;

        if (!openPhoneResponse.ok) {
          const errText = await openPhoneResponse.text();
          console.error(`[process-recurring-offers] OpenPhone error for customer ${item.customer_id}:`, errText);
          await supabase.from("recurring_offer_queue")
            .update({ sent: true, sent_at: now, error: `OpenPhone ${openPhoneResponse.status}: ${errText}` })
            .eq("id", item.id);
          continue;
        }

        const sendResult = await openPhoneResponse.json();

        // 7. Log in conversation history
        try {
          const customerName = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "Customer";

          let { data: conversation } = await supabase
            .from("sms_conversations")
            .select("id")
            .eq("organization_id", item.organization_id)
            .eq("customer_phone", formattedPhone)
            .maybeSingle();

          if (!conversation) {
            const { data: newConv } = await supabase
              .from("sms_conversations")
              .insert({
                organization_id: item.organization_id,
                customer_phone: formattedPhone,
                customer_name: customerName,
                last_message_at: now,
                conversation_type: "automated",
              })
              .select("id")
              .single();
            conversation = newConv;
          } else {
            await supabase.from("sms_conversations")
              .update({ last_message_at: now })
              .eq("id", conversation.id);
          }

          if (conversation) {
            await supabase.from("sms_messages").insert({
              conversation_id: conversation.id,
              organization_id: item.organization_id,
              direction: "outgoing",
              content: message,
              status: "sent",
              openphone_message_id: sendResult.data?.id || null,
              sent_at: now,
            });
          }
        } catch (logError) {
          console.error("[process-recurring-offers] Conversation log error:", logError);
        }

        // 8. Mark as sent
        const { error: markSentErr } = await supabase.from("recurring_offer_queue")
          .update({ sent: true, sent_at: now })
          .eq("id", item.id);
        if (markSentErr) {
          console.error(`[process-recurring-offers] SMS sent but failed to mark queue item ${item.id} as sent — next run will re-send this offer:`, markSentErr);
        }

        sentCount++;
        console.log(`[process-recurring-offers] Sent recurring offer to customer ${item.customer_id} at ${formattedPhone}`);
      } catch (itemError: any) {
        console.error(`[process-recurring-offers] Error processing item ${item.id}:`, itemError);
        const { error: markErrorErr } = await supabase.from("recurring_offer_queue")
          .update({ sent: true, sent_at: now, error: itemError?.message || "Unknown error" })
          .eq("id", item.id);
        if (markErrorErr) {
          console.error(`[process-recurring-offers] Failed to record error state on queue item ${item.id} — it may be retried indefinitely:`, markErrorErr);
        }
      }
    }

      processedTotal += batch.length;
      if (batch.length < BATCH) break;
    }

    return new Response(JSON.stringify({ processed: processedTotal, sent: sentCount }), {
      status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("[process-recurring-offers] Error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

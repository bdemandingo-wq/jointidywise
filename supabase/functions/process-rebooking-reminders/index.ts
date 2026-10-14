import { sendOpenPhoneMessage } from "../_shared/send-openphone.ts";
import {
  resolveTemplate,
  withStopSentence,
  AUTOMATION_DEFAULTS,
} from "../_shared/automation-templates.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
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
        .from("rebooking_reminder_queue")
        .select("id, booking_id, customer_id, organization_id, defer_count, deferred_until")
        .eq("sent", false)
        .eq("cancelled", false)
        .lte("send_at", now)
        .or(`deferred_until.is.null,deferred_until.lte.${now}`)
        .order("send_at", { ascending: true })
        .limit(BATCH);

      if (fetchError) {
        console.error("[process-rebooking-reminders] Fetch error:", fetchError);
        throw fetchError;
      }
      if (!batch || batch.length === 0) break;

      console.log(`[process-rebooking-reminders] Processing ${batch.length} items`);

      // Pre-fetch automation settings for this batch's orgs
      const orgIds = [...new Set(batch.map(i => i.organization_id))];
      const { data: automationSettings } = await supabase
        .from("organization_automations")
        .select("organization_id, is_enabled, settings")
        .in("organization_id", orgIds)
        .eq("automation_type", "rebooking_reminder");
      const automationMap = new Map((automationSettings || []).map(a => [a.organization_id, a.is_enabled]));
      // Custom copy, if the owner reworded it. A row with no template entry is
      // the normal case and resolves to the shipped default.
      const templateMap = new Map(
        (automationSettings || []).map(a => [
          a.organization_id,
          ((a.settings as { templates?: Record<string, string> } | null)?.templates
            ?.rebooking_reminder) ?? null,
        ]),
      );

    for (const item of batch) {
      try {
        // Check if automation is enabled for this org
        if (automationMap.has(item.organization_id) && !automationMap.get(item.organization_id)) {
          await supabase.from("rebooking_reminder_queue")
            .update({ cancelled: true, cancelled_reason: "Automation disabled" })
            .eq("id", item.id);
          continue;
        }
        // 1. Check if customer already has a future booking
        const { data: futureBookings } = await supabase
          .from("bookings")
          .select("id")
          .eq("customer_id", item.customer_id)
          .eq("organization_id", item.organization_id)
          .in("status", ["pending", "confirmed"])
          .gt("scheduled_at", now)
          .limit(1);

        if (futureBookings && futureBookings.length > 0) {
          await supabase.from("rebooking_reminder_queue")
            .update({ cancelled: true, cancelled_reason: "Future booking exists" })
            .eq("id", item.id);
          console.log(`[process-rebooking-reminders] Cancelled for booking ${item.booking_id}: future booking exists`);
          continue;
        }

        // 2. Check review rating from review_requests table
        const { data: review } = await supabase
          .from("review_requests")
          .select("rating")
          .eq("booking_id", item.booking_id)
          .not("rating", "is", null)
          .maybeSingle();

        // Also check client_portal_feedback
        const { data: portalFeedback } = await supabase
          .from("client_portal_feedback")
          .select("rating")
          .eq("booking_id", item.booking_id)
          .maybeSingle();

        const rating = review?.rating || portalFeedback?.rating || null;

        // Suppress rebooking nudges only for unhappy customers: a 3-or-below
        // rating cancels. Everyone else — including customers who left no
        // review — gets the nudge. (No more 7-day "wait for a review" defer.)
        if (rating !== null && rating <= 3) {
          await supabase.from("rebooking_reminder_queue")
            .update({ cancelled: true, cancelled_reason: `Low rating: ${rating} stars` })
            .eq("id", item.id);
          console.log(`[process-rebooking-reminders] Cancelled for booking ${item.booking_id}: rating ${rating} stars`);
          continue;
        }
        // No review, or 4-5 stars → proceed to send

        // 3. Get customer details
        const { data: customer } = await supabase
          .from("customers")
          .select("first_name, last_name, phone")
          .eq("id", item.customer_id)
          .single();

        if (!customer?.phone) {
          await supabase.from("rebooking_reminder_queue")
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
          await supabase.from("rebooking_reminder_queue")
            .update({ sent: true, sent_at: now, error: "SMS not configured" })
            .eq("id", item.id);
          continue;
        }

        // 5. Get business settings for company name and booking link
        const { data: businessSettings } = await supabase
          .from("business_settings")
          .select("company_name, app_url")
          .eq("organization_id", item.organization_id)
          .maybeSingle();

        const { data: org } = await supabase
          .from("organizations")
          .select("slug")
          .eq("id", item.organization_id)
          .single();

        const companyName = businessSettings?.company_name || "Your cleaning service";
        const projectUrl = (businessSettings?.app_url || Deno.env.get("APP_URL") || Deno.env.get("PROJECT_URL") || "https://jointidywise.com").replace(/\/+$/, '');
        const bookingLink = `${projectUrl}/book/${org?.slug || ""}`.replace(/^https?:\/\//, '');

        const customerName = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "there";

        // 6. Build Hormozi-style million dollar offer message
        const resolved = resolveTemplate(
          "rebooking_reminder",
          templateMap.get(item.organization_id) ?? null,
          { customer_name: customerName, company_name: companyName, booking_link: bookingLink },
        );
        if (resolved.warning) {
          console.warn(
            `[process-rebooking-reminders] org=${item.organization_id}: ${resolved.warning}`,
          );
        }
        // Marketing: the opt-out line is appended here, never part of the
        // editable body, so an owner cannot remove it.
        const message =
          AUTOMATION_DEFAULTS.rebooking_reminder.message_class === "marketing"
            ? withStopSentence(resolved.text)
            : resolved.text;

        // 7. Send via OpenPhone
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

        const openPhoneResponse = await sendOpenPhoneMessage( { organizationId: item.organization_id,
          method: "POST",
          headers: { Authorization: authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ content: message, from: phoneNumberId, to: [formattedPhone] }),
        });

        if (!openPhoneResponse.ok) {
          const errText = await openPhoneResponse.text();
          console.error(`[process-rebooking-reminders] OpenPhone error for ${item.booking_id}:`, errText);
          await supabase.from("rebooking_reminder_queue")
            .update({ sent: true, sent_at: now, error: `OpenPhone ${openPhoneResponse.status}: ${errText}` })
            .eq("id", item.id);
          continue;
        }

        const sendResult = await openPhoneResponse.json();

        // 8. Log in conversation history
        try {
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
          console.error("[process-rebooking-reminders] Conversation log error:", logError);
        }

        // 9. Mark as sent
        const { error: markSentErr } = await supabase.from("rebooking_reminder_queue")
          .update({ sent: true, sent_at: now })
          .eq("id", item.id);
        if (markSentErr) {
          console.error(`[process-rebooking-reminders] SMS sent but failed to mark queue item ${item.id} as sent — next run will re-send this reminder:`, markSentErr);
        }

        sentCount++;
        console.log(`[process-rebooking-reminders] Sent rebooking reminder for booking ${item.booking_id} to ${formattedPhone}`);
      } catch (itemError: any) {
        console.error(`[process-rebooking-reminders] Error processing item ${item.id}:`, itemError);
        const { error: markErrorErr } = await supabase.from("rebooking_reminder_queue")
          .update({ sent: true, sent_at: now, error: itemError?.message || "Unknown error" })
          .eq("id", item.id);
        if (markErrorErr) {
          console.error(`[process-rebooking-reminders] Failed to record error state on queue item ${item.id} — it may be retried indefinitely:`, markErrorErr);
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
    console.error("[process-rebooking-reminders] Error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);

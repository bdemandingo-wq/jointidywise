import { sendOpenPhoneMessage } from "../_shared/send-openphone.ts";
import {
  resolveTemplate,
  withStopSentence,
  AUTOMATION_DEFAULTS,
} from "../_shared/automation-templates.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { filterOptedIn } from "../_shared/marketing-guard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const BATCH = 50;
    const MAX_PER_RUN = 200;   // safety ceiling; remainder drains on the next cron run
    let successCount = 0;
    let processedTotal = 0;

    // Drain the queue oldest-first, paging until nothing's ready (capped per run).
    while (processedTotal < MAX_PER_RUN) {
      const now = new Date().toISOString();
      const { data: pendingItems, error: fetchError } = await supabase
        .from("automated_review_sms_queue")
        .select("id, booking_id, organization_id, customer_id")
        .eq("sent", false)
        .lte("send_at", now)
        .order("send_at", { ascending: true })
        .limit(BATCH);

      if (fetchError) {
        console.error("Error fetching queue:", fetchError);
        throw fetchError;
      }
      if (!pendingItems || pendingItems.length === 0) break;

      console.log(`Processing ${pendingItems.length} review SMS requests`);

      // Pre-fetch automation settings for this batch's orgs
      const orgIds = [...new Set(pendingItems.map(i => i.organization_id))];
      const { data: automationSettings } = await supabase
        .from("organization_automations")
        .select("organization_id, is_enabled, settings")
        .in("organization_id", orgIds)
        .eq("automation_type", "review_request");
      const automationMap = new Map((automationSettings || []).map(a => [a.organization_id, a.is_enabled]));
      const templateMap = new Map(
        (automationSettings || []).map(a => [
          a.organization_id,
          ((a.settings as { templates?: Record<string, string> } | null)?.templates
            ?.review_request) ?? null,
        ]),
      );

      // MARKETING CONSENT: review requests are marketing, so drop opted-out
      // customers before the send loop. filterOptedIn is org-scoped and fails
      // closed (empty list) on error, so group the batch by organization.
      const sendable: typeof pendingItems = [];
      for (const orgId of orgIds) {
        const orgItems = pendingItems.filter(i => i.organization_id === orgId);
        const optedIn = await filterOptedIn(
          supabase,
          orgId,
          orgItems.map(i => ({ id: i.customer_id, item: i })),
        );
        const keptIds = new Set(optedIn.map(r => r.id));
        for (const dropped of orgItems.filter(i => !keptIds.has(i.customer_id))) {
          console.info(
            `[process-review-sms-queue] Skipping opted-out customer | org:${orgId} customer:${dropped.customer_id}`,
          );
        }
        sendable.push(...optedIn.map(r => r.item));
      }

    for (const item of sendable) {
      try {
        // Check if automation is enabled for this org
        if (automationMap.has(item.organization_id) && !automationMap.get(item.organization_id)) {
          await supabase.from("automated_review_sms_queue")
            .update({ sent: true, sent_at: new Date().toISOString(), error: "Automation disabled" })
            .eq("id", item.id);
          continue;
        }
        // Safety check: verify booking is still completed before sending
        const { data: bookingCheck } = await supabase
          .from("bookings")
          .select("status")
          .eq("id", item.booking_id)
          .single();

        if (!bookingCheck || bookingCheck.status !== 'completed') {
          await supabase.from("automated_review_sms_queue")
            .update({ sent: true, sent_at: new Date().toISOString(), error: "Booking no longer completed" })
            .eq("id", item.id);
          continue;
        }

        // Get customer details + verify review request not already sent
        const { data: customer } = await supabase
          .from("customers")
          .select("first_name, last_name, phone, review_request_sent")
          .eq("id", item.customer_id)
          .single();

        if ((customer as any)?.review_request_sent) {
          await supabase.from("automated_review_sms_queue")
            .update({ sent: true, sent_at: new Date().toISOString(), error: "Customer already received a review request" })
            .eq("id", item.id);
          continue;
        }

        if (!customer?.phone) {
          await supabase.from("automated_review_sms_queue")
            .update({ sent: true, sent_at: new Date().toISOString(), error: "No customer phone" })
            .eq("id", item.id);
          continue;
        }

        // Get booking + service info
        const { data: booking } = await supabase
          .from("bookings")
          .select("booking_number, service_id, staff_id, services:service_id(name)")
          .eq("id", item.booking_id)
          .single();

        // Get SMS settings
        const { data: smsSettings } = await supabase
          .from("organization_sms_settings")
          .select("openphone_api_key, openphone_phone_number_id, sms_enabled")
          .eq("organization_id", item.organization_id)
          .maybeSingle();

        if (!smsSettings?.sms_enabled || !smsSettings.openphone_api_key || !smsSettings.openphone_phone_number_id) {
          await supabase.from("automated_review_sms_queue")
            .update({ sent: true, sent_at: new Date().toISOString(), error: "SMS not configured" })
            .eq("id", item.id);
          continue;
        }

        // Get business settings for Google review URL and app URL
        const { data: businessSettings } = await supabase
          .from("business_settings")
          .select("company_name, google_review_url, app_url")
          .eq("organization_id", item.organization_id)
          .maybeSingle();

        // Generate review token
        const token = crypto.randomUUID();
        const projectUrl = (businessSettings?.app_url || Deno.env.get("APP_URL") || Deno.env.get("PROJECT_URL") || "https://jointidywise.com").replace(/\/+$/, '');
        const reviewPageUrl = `${projectUrl}/review/${token}`.replace(/^https?:\/\//, '');

        // Create review request record
        const { error: insertError } = await supabase
          .from("review_requests")
          .insert({
            booking_id: item.booking_id,
            customer_id: item.customer_id,
            staff_id: booking?.staff_id || null,
            status: "sent",
            sent_at: new Date().toISOString(),
            review_link_token: token,
            google_review_url: businessSettings?.google_review_url || "",
          });

        if (insertError) {
          console.error("Failed to create review request:", insertError);
          await supabase.from("automated_review_sms_queue")
            .update({ sent: true, sent_at: new Date().toISOString(), error: insertError.message })
            .eq("id", item.id);
          continue;
        }

        // Build SMS message
        const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(" ") || "there";
        // The queued sender has no cleaner or service to hand, so those two
        // tokens resolve to empty here. Neither is required, so a template that
        // uses them still sends — just without that clause.
        const resolved = resolveTemplate("review_request", templateMap.get(item.organization_id) ?? null, {
          customer_name: customerName,
          company_name: businessSettings?.company_name || "Your cleaning service",
          review_link: reviewPageUrl,
          service_name: "",
          cleaner_name: "",
        });
        if (resolved.warning) {
          console.warn(`[process-review-sms-queue] org=${item.organization_id}: ${resolved.warning}`);
        }
        const message =
          AUTOMATION_DEFAULTS.review_request.message_class === "marketing"
            ? withStopSentence(resolved.text)
            : resolved.text;

        // Format phone
        let formattedPhone = customer.phone.replace(/\D/g, "");
        if (formattedPhone.length === 10) formattedPhone = `+1${formattedPhone}`;
        else if (!formattedPhone.startsWith("+")) formattedPhone = `+${formattedPhone}`;

        // Extract phone number ID
        let phoneNumberId = smsSettings.openphone_phone_number_id;
        if (phoneNumberId.includes("/")) {
          const pnMatch = phoneNumberId.match(/(PN[A-Za-z0-9]+)/);
          if (pnMatch) phoneNumberId = pnMatch[1];
        }

        const authHeader = smsSettings.openphone_api_key.trim().replace(/^Bearer\s+/i, "");

        // Send SMS via OpenPhone
        const openPhoneResponse = await sendOpenPhoneMessage( {
      organizationId: item.organization_id,
          method: "POST",
          headers: { "Authorization": authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ content: message, from: phoneNumberId, to: [formattedPhone] }),
        });

        if (!openPhoneResponse.ok) {
          const errText = await openPhoneResponse.text();
          console.error(`OpenPhone error for booking ${item.booking_id}:`, errText);
          await supabase.from("automated_review_sms_queue")
            .update({ sent: true, sent_at: new Date().toISOString(), error: `OpenPhone ${openPhoneResponse.status}: ${errText}` })
            .eq("id", item.id);
          continue;
        }

        // Log in SMS conversation history
        const { data: conversation } = await supabase
          .from("sms_conversations")
          .select("id")
          .eq("organization_id", item.organization_id)
          .eq("phone_number", formattedPhone)
          .maybeSingle();

        const conversationId = conversation?.id;
        if (conversationId) {
          await supabase.from("sms_messages").insert({
            conversation_id: conversationId,
            organization_id: item.organization_id,
            direction: "outgoing",
            content: message,
            phone_number: formattedPhone,
          });
        } else {
          // Create new conversation
          const { data: newConv } = await supabase.from("sms_conversations").insert({
            organization_id: item.organization_id,
            phone_number: formattedPhone,
            contact_name: customerName,
            last_message: message,
            last_message_at: new Date().toISOString(),
          }).select("id").single();

          if (newConv) {
            await supabase.from("sms_messages").insert({
              conversation_id: newConv.id,
              organization_id: item.organization_id,
              direction: "outgoing",
              content: message,
              phone_number: formattedPhone,
            });
          }
        }

        // Mark as sent + flag customer so they never get another review request
        const { error: markSentErr } = await supabase.from("automated_review_sms_queue")
          .update({ sent: true, sent_at: new Date().toISOString() })
          .eq("id", item.id);
        if (markSentErr) {
          console.error(`Review SMS sent but failed to mark queue item ${item.id} as sent — next run will re-send this review request:`, markSentErr);
        }

        const { error: flagCustomerErr } = await supabase.from("customers")
          .update({ review_request_sent: true, review_request_sent_at: new Date().toISOString() } as any)
          .eq("id", item.customer_id);
        if (flagCustomerErr) {
          console.error(`Review SMS sent but customer ${item.customer_id} was not flagged review_request_sent — they may receive another review request via a different path:`, flagCustomerErr);
        }

        successCount++;
        console.log(`Review SMS sent for booking ${item.booking_id} to ${formattedPhone}`);
      } catch (itemError: any) {
        console.error(`Error processing item ${item.id}:`, itemError);
        const { error: markErrorErr } = await supabase.from("automated_review_sms_queue")
          .update({ sent: true, sent_at: new Date().toISOString(), error: itemError?.message || "Unknown error" })
          .eq("id", item.id);
        if (markErrorErr) {
          console.error(`Failed to record error state on queue item ${item.id} — it may be retried indefinitely:`, markErrorErr);
        }
      }
    }

      processedTotal += pendingItems.length;
      if (pendingItems.length < BATCH) break;
    }

    return new Response(JSON.stringify({ processed: processedTotal, sent: successCount }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in process-review-sms-queue:", error);
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
